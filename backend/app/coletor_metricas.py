"""Preenche as quatro tabelas de `/monitoring` lendo o gateway daqui.

**Por que existe.** `gateway_health`, `usage_daily`, `agent_stats` e `cron_jobs`
são alimentadas por `POST /coletor/estatisticas`, um webhook que um coletor
rodando na VPS deveria chamar. O endpoint existe desde 10/08/2026 e aceita três
formatos de payload; o coletor **não existe mais**. Conferido em 31/08/2026 na
máquina do gateway: nenhum script, nenhum agendamento, nenhum serviço, nem
sequer o que apontava para o Supabase. Sumiu na migração, e por isso as quatro
tabelas estão em zero linha desde sempre — com as telas de Monitoramento e
Analytics vazias junto.

**Por que aqui e não um coletor novo na VPS.** O backend já mantém um laço que
lê o gateway a cada cinco minutos (`coletor_uso.py`). Ressuscitar um serviço
externo custaria máquina, segredo compartilhado e mais uma peça para descobrir
parada meses depois — exatamente o que aconteceu. O webhook continua de pé para
quem quiser empurrar de fora; isto é o caminho de dentro.

⚠️ **O formato do gateway NÃO é o do coletor antigo.** O `_crons` do router
espera campos planos (`agent`, `cronExpression`, `lastRun`), porque foi escrito
para o payload da VPS. O `cron.list` devolve `agentId`, `schedule.expr` e
`state.lastRunAtMs` aninhados. Daí os adaptadores deste módulo — a **escrita**
continua sendo a do router, que já trata cada tabela isolada da outra.

⚠️ **O consumo do dia sai da `usage_events`, não do gateway.** O gateway só
conhece o estado vivo das sessões; quem tem a série temporal é a nossa tabela,
que o `coletor_uso` alimenta. Somar as sessões vivas aqui daria um número que
encolhe sempre que alguém recomeça uma conversa.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone

from app.database import sessao
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente

logger = logging.getLogger(__name__)

# Chave do advisory lock. Duas réplicas coletando ao mesmo tempo escreveriam o
# mesmo retrato duas vezes — inofensivo nas tabelas com chave, desperdício nas
# outras.
_TRAVA = 815_140_019


def intervalo() -> int:
    """Segundos entre coletas. `0` desliga."""
    try:
        return max(0, int(os.environ.get("COLETOR_METRICAS_SEGUNDOS", "300")))
    except ValueError:
        return 300


def _instante(ms) -> datetime | None:
    """Milissegundos do gateway viram instante com fuso. `None` some."""
    if not isinstance(ms, (int, float)) or ms <= 0:
        return None
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _cron_do_gateway(job: dict) -> dict:
    """Um job do `cron.list` na forma que `_gravar` espera.

    ⚠️ **`status` carrega o resultado da última execução, não "existe".** É para
    isso que a tela serve: em 31/08/2026 dois dos cinco briefings estavam em
    `error` e ninguém via. Job desligado vira `disabled`, que é estado de
    configuração e não falha.
    """
    estado = job.get("state") or {}
    ligado = job.get("enabled") is not False
    agenda = job.get("schedule") or {}
    return {
        "id": str(job.get("id") or job.get("name") or ""),
        "name": job.get("name"),
        "agent": job.get("agentId") or job.get("agent"),
        "cron_expression": agenda.get("expr") or agenda.get("kind"),
        "status": "disabled" if not ligado else (estado.get("lastRunStatus") or "ok"),
        "enabled": ligado,
        "last_run": _instante(estado.get("lastRunAtMs")),
        "next_run": _instante(estado.get("nextRunAtMs")),
        "prompt": (job.get("payload") or {}).get("message"),
    }


# ⚠️ **Sessão abandonada não é sessão em uso, e são a maioria.** Medido no
# gateway em 31/08/2026: 100 sessões, **29** tocadas nos últimos sete dias. As
# outras 71 são de teste e diagnóstico da migração (`teste-*`, `diag-*`,
# `escopo-conf-*`), de até 17 dias atrás.
#
# Sem janela, o painel diria que o `atlas` tem 37 sessões para sempre, e o pico
# de tokens dele seria o de um teste de duas semanas. Ruído apresentado como
# sinal é pior que campo vazio — o vazio ninguém interpreta como saúde.
_JANELA_DE_SESSAO_MS = 7 * 24 * 60 * 60 * 1000


def _sessoes_por_agente(sessoes: list, agora_ms: int | None = None) -> dict[str, dict]:
    """Agrega o `sessions.list` por agente, olhando só a janela recente.

    A chave é `agent:<agentId>:<sufixo>`; qualquer outra coisa é descartada em
    silêncio — o gateway já devolveu chave fora do formato e derrubar a coleta
    inteira por causa de uma linha seria trocar dado parcial por dado nenhum.

    ⚠️ **Sessão sem carimbo de tempo conta.** Falha aberta de propósito: não dá
    para saber se está viva, e sumir com um agente do painel por falta de campo é
    pior que contar a mais.
    """
    if agora_ms is None:
        agora_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    por_agente: dict[str, dict] = {}
    for s in sessoes or []:
        if not isinstance(s, dict):
            continue
        partes = str(s.get("key") or "").split(":")
        if len(partes) < 3 or partes[0] != "agent" or not partes[1]:
            continue
        carimbo = s.get("updatedAt") or s.get("endedAt")
        if isinstance(carimbo, (int, float)) and carimbo > 0:
            if agora_ms - carimbo > _JANELA_DE_SESSAO_MS:
                continue
        tokens = s.get("totalTokens") or 0
        tokens = int(tokens) if isinstance(tokens, (int, float)) else 0
        atual = por_agente.setdefault(
            partes[1], {"session_count": 0, "max_total_tokens": 0, "latest_updated_at": None}
        )
        atual["session_count"] += 1
        atual["max_total_tokens"] = max(atual["max_total_tokens"], tokens)
        quando = _instante(carimbo)
        if quando and (atual["latest_updated_at"] is None or quando > atual["latest_updated_at"]):
            atual["latest_updated_at"] = quando
    return por_agente


def _agentes_do_gateway(agentes: list, sessoes: list, consumo: dict) -> list[dict]:
    """Uma linha por agente, na forma que `_gravar` espera.

    `consumo` é `agent_id → (tokens, custo)` do dia, vindo da `usage_events`.
    """
    por_agente = _sessoes_por_agente(sessoes)
    linhas = []
    for a in agentes or []:
        if not isinstance(a, dict):
            continue
        ident = str(a.get("id") or "")
        if not ident:
            continue
        modelo = a.get("model")
        if isinstance(modelo, dict):
            modelo = modelo.get("primary")
        agregado = por_agente.get(ident, {})
        tokens, custo = consumo.get(ident, (0, 0.0))
        linhas.append({
            "agent_id": ident,
            "status": a.get("status") or "ok",
            "model": modelo,
            "last_active": agregado.get("latest_updated_at"),
            "last_channel": None,
            "messages_today": 0,
            "tokens_today": int(tokens),
            "cost_today": float(custo),
            "errors_today": 0,
            "session_count": agregado.get("session_count"),
            "max_total_tokens": agregado.get("max_total_tokens"),
            "latest_updated_at": agregado.get("latest_updated_at"),
            "top_sessions": None,
            "user_id": None,
        })
    return linhas


async def _consumo_do_dia(conn, dia) -> tuple[dict, dict]:
    """`(por_agente, total)` do dia, da `usage_events`."""
    linhas = await conn.fetch(
        """SELECT agent_id, sum(total_tokens) tokens, sum(cost_usd) custo
             FROM public.usage_events
            WHERE ts >= $1::date AND ts < $1::date + 1
            GROUP BY agent_id""",
        dia,
    )
    por_agente = {
        str(l["agent_id"]): (int(l["tokens"] or 0), float(l["custo"] or 0))
        for l in linhas if l["agent_id"]
    }
    total = {
        "tokens": sum(t for t, _ in por_agente.values()),
        "custo": sum(c for _, c in por_agente.values()),
    }
    return por_agente, total


async def coletar_uma_vez() -> dict:
    """Uma passada: lê o gateway, escreve as quatro tabelas."""
    from app.routers.coletor import _gravar  # tardio: o router importa banco

    try:
        c = await cfg.carregar()
        if not c.configurado:
            return {"ok": False, "motivo": "gateway não configurado"}
        cliente = obter_cliente(c.url, c.token)

        # A latência é medida na chamada mais barata que já fazemos, não numa
        # sondagem à parte: o número tem que ser o do caminho real.
        inicio = asyncio.get_running_loop().time()
        r_agentes = await cliente.chamar("agents.list", {})
        latencia = int((asyncio.get_running_loop().time() - inicio) * 1000)

        r_sessoes = await cliente.chamar("sessions.list", {"limit": 1000})
        # ⚠️ `includeDisabled` de propósito: a tela precisa mostrar o que alguém
        # desligou, senão o job some e o botão de religar some junto.
        r_crons = await cliente.chamar("cron.list", {"includeDisabled": True})
    except (ErroGateway, OSError) as e:
        logger.warning("Coletor de métricas: gateway não respondeu: %s", e)
        # Gateway fora É a notícia de saúde — gravar isso vale mais que desistir.
        quando = datetime.now(timezone.utc)
        try:
            async with sessao(role="service_role") as conn:
                await _gravar(conn, {"status": "down", "version": None,
                                     "uptime_seconds": None, "latency_ms": None},
                              None, [], [], quando)
        except Exception:  # noqa: BLE001
            logger.exception("Coletor de métricas: nem a saúde consegui gravar.")
        return {"ok": False, "motivo": str(e)}

    quando = datetime.now(timezone.utc)
    agentes_brutos = (r_agentes.get("payload") or r_agentes).get("agents") or []
    sessoes = (r_sessoes.get("payload") or r_sessoes).get("sessions") or []
    jobs = (r_crons.get("payload") or r_crons).get("jobs") or []

    async with sessao(role="service_role") as conn:
        if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", _TRAVA):
            return {"ok": True, "pulado": True}
        try:
            por_agente, total = await _consumo_do_dia(conn, quando.date())
            erros = await _gravar(
                conn,
                {"status": "ok", "version": None, "uptime_seconds": None,
                 "latency_ms": latencia},
                {"date": quando.date(), "messages_total": 0,
                 "tokens_total": total["tokens"], "cost_total": total["custo"],
                 "cache_hit_rate": 0, "error_rate": 0, "tool_calls": 0},
                _agentes_do_gateway(agentes_brutos, sessoes, por_agente),
                [_cron_do_gateway(j) for j in jobs if isinstance(j, dict)],
                quando,
            )
        finally:
            await conn.execute("SELECT pg_advisory_unlock($1)", _TRAVA)

    if erros:
        logger.warning("Coletor de métricas: %s", "; ".join(erros))
    return {"ok": True, "agentes": len(agentes_brutos), "crons": len(jobs), "erros": erros}


async def rodar(parar: asyncio.Event) -> None:
    """O laço. Desligar com `COLETOR_METRICAS_SEGUNDOS=0`."""
    seg = intervalo()
    if not seg:
        logger.info("Coletor de métricas desligado (COLETOR_METRICAS_SEGUNDOS=0).")
        return
    while not parar.is_set():
        try:
            await coletar_uma_vez()
        except Exception:  # noqa: BLE001
            logger.exception("Coletor de métricas: ciclo falhou.")
        try:
            await asyncio.wait_for(parar.wait(), timeout=seg)
        except asyncio.TimeoutError:
            pass
