"""Coletor de métricas — o que a VPS empurra para as telas de monitoramento.

Portado de `collect-agent-stats` (552 linhas). É um webhook: um coletor roda na
VPS, junta o estado do OpenClaw e faz `POST` aqui de tempos em tempos. Alimenta
`gateway_health`, `usage_daily`, `agent_stats` e `cron_jobs` — as tabelas por
trás de `/monitoring` e `/analytics`.

⚠️ **Três formatos de payload, e nenhum pode ser descartado.** O coletor foi
reescrito duas vezes e cada versão manda um formato diferente; a edge aceitava
os três, e qual está rodando na VPS hoje é coisa que só se descobre olhando lá.
Portar só o mais novo faria o monitoramento parar sem nenhuma mensagem de erro
— o coletor seguiria mandando 200 para um corpo que ninguém entende.

Os três, pela ordem em que são testados:

1. **Atual** — `{gateway, sessions, costs, crons, tasks}`, com os agentes em
   `sessions.summary.by_agent`
2. **VPS plano** — `{sessions_count, gateway_ok, agents[], cron[]}`, o
   `latest.json` que a VPS gerava
3. **Estruturado original** — `{agents, cron, health, usage}`

⚠️ **Falha parcial devolve 207, não 500.** Se `agent_stats` grava e
`cron_jobs` não, insistir no corpo inteiro perderia o que já deu certo. O
coletor não reenvia — ele manda o snapshot seguinte alguns minutos depois.
"""

import json
import logging
import re
from datetime import date, datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

from app.database import sessao
from app.integracoes import exige_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/coletor", tags=["coletor"])

_UUID = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I
)


# ─────────────────────────── normalização ───────────────────────────
#
# O coletor manda número como string ("1,234"), data como epoch e ausência como
# string vazia. Estas três funções são a tradução, e vieram tal e qual da edge.


def _num(valor: Any, padrao: float = 0) -> float:
    if isinstance(valor, bool):
        return padrao
    if isinstance(valor, (int, float)):
        return valor
    if isinstance(valor, str):
        limpo = re.sub(r"[^0-9.-]+", "", valor)
        try:
            return float(limpo)
        except ValueError:
            return padrao
    return padrao


def _int(valor: Any, padrao: int = 0) -> int:
    return int(_num(valor, padrao))


def _texto(valor: Any) -> str | None:
    """String não-vazia, ou nada. `""` do coletor vira `NULL` no banco."""
    return valor if isinstance(valor, str) and valor.strip() else None


def _instante(valor: Any, padrao: datetime | None = None) -> datetime | None:
    """Aceita ISO, epoch em segundos e epoch em milissegundos.

    O corte em 1e12 separa segundos de milissegundos: qualquer epoch em
    segundos posterior a 2001 é menor que isso, e qualquer um em
    milissegundos é maior.
    """
    if isinstance(valor, str):
        try:
            return datetime.fromisoformat(valor.replace("Z", "+00:00"))
        except ValueError:
            pass
    if isinstance(valor, (int, float)) and not isinstance(valor, bool):
        segundos = valor / 1000 if valor > 1e12 else valor
        try:
            return datetime.fromtimestamp(segundos, tz=timezone.utc)
        except (OverflowError, OSError, ValueError):
            pass
    return padrao


def _obj(fonte: dict, *chaves: str) -> dict:
    """Primeiro valor que for um dicionário, entre várias grafias da chave.

    Existe porque cada versão do coletor escolheu uma convenção diferente —
    `perAgent`, `per_agent` e `by_agent` são a mesma coisa.
    """
    for k in chaves:
        v = fonte.get(k)
        if isinstance(v, dict):
            return v
    return {}


def _primeiro(fonte: dict, *chaves: str, padrao: Any = None) -> Any:
    for k in chaves:
        if fonte.get(k) is not None:
            return fonte[k]
    return padrao


def _instante_do_snapshot(corpo: dict, agora: datetime) -> datetime:
    for chave in ("timestamp", "generated_at", "generatedAt", "collected_at", "collectedAt"):
        q = _instante(corpo.get(chave))
        if q:
            return q
    return agora


# ─────────────────────────── extração ───────────────────────────


def _gateway_atual(corpo: dict) -> dict:
    g = _obj(corpo, "gateway")
    estado = _texto(g.get("status"))
    if not estado:
        # `ok: false` é o jeito antigo de dizer offline. Ausência não é falha:
        # coletor que não mede o gateway não deve marcá-lo como fora do ar.
        estado = "offline" if g.get("ok") is False or g.get("gateway_ok") is False else "online"
    return {
        "status": estado,
        "version": _texto(g.get("version")) or _texto(g.get("openclaw_version")),
        "uptime_seconds": _primeiro(g, "uptime_seconds", "uptime"),
        "latency_ms": _primeiro(g, "latency_ms", "latency"),
    }


def _uso_atual(corpo: dict, quando: datetime) -> dict:
    sessoes, custos, tarefas = _obj(corpo, "sessions"), _obj(corpo, "costs"), _obj(corpo, "tasks")
    tokens = _obj(custos, "tokens")

    ok = _num(tarefas.get("succeeded"))
    estouradas = _num(_primeiro(tarefas, "timed_out", "timedOut"))
    falhas = _num(tarefas.get("failed"))
    total = ok + estouradas + falhas

    return {
        "date": quando.date(),
        "messages_total": _int(_primeiro(sessoes, "total", padrao=corpo.get("sessions_count"))),
        "tokens_total": _int(_primeiro(custos, "total_tokens", "tokens_total", padrao=tokens.get("total"))),
        "cost_total": _num(_primeiro(custos, "total_usd", "total_cost", "cost_total", "total")),
        "cache_hit_rate": _num(_primeiro(custos, "cache_hit_rate", padrao=tokens.get("cacheHitRate"))),
        # Divisão protegida: sem tarefa nenhuma a taxa de erro é 0, não NaN.
        "error_rate": falhas / total if total > 0 else 0,
        "tool_calls": _int(_primeiro(corpo, "tool_calls", "toolCalls")),
    }


def _agentes_atual(corpo: dict, quando: datetime) -> list[dict]:
    sessoes, custos = _obj(corpo, "sessions"), _obj(corpo, "costs")
    resumo = _obj(sessoes, "summary")
    # O caminho certo é `sessions.summary.by_agent`; os outros três são
    # coletores mais antigos, mantidos porque ainda podem estar rodando.
    por_agente = _obj(resumo, "by_agent") or _obj(sessoes, "perAgent", "per_agent", "by_agent")
    custo_por_agente = _obj(custos, "perAgent", "per_agent")
    tokens_por_agente = _obj(custos, "tokens_per_agent", "tokensPerAgent")

    linhas = []
    for agent_id, bruto in por_agente.items():
        s = bruto if isinstance(bruto, dict) else {}
        c_bruto = custo_por_agente.get(agent_id)
        c = c_bruto if isinstance(c_bruto, dict) else {}

        # O valor pode ser o objeto ou o número solto — coletor antigo mandava
        # `{lia: 1392}`, o atual manda `{lia: {count: 1392, …}}`.
        n_sessoes = _int(_primeiro(s, "count", "sessions", padrao=bruto))
        max_tokens = _int(_primeiro(s, "max_total_tokens", "maxTotalTokens"))
        visto_em = _instante(
            _primeiro(s, "latest_updated_at", "latestUpdatedAt", "last_active", "lastActive"),
            quando,
        )
        topo = s.get("top_sessions") or s.get("topSessions")
        topo = topo if isinstance(topo, list) else None

        # O id do usuário não vem em campo próprio: está enterrado nas sessões
        # do topo, e só vale se for um UUID de verdade — há entradas com o
        # nome da sessão nesse mesmo campo.
        user_id = None
        for entrada in topo or []:
            if isinstance(entrada, dict):
                cand = entrada.get("userId") or entrada.get("user_id")
                if isinstance(cand, str) and _UUID.match(cand):
                    user_id = cand
                    break

        linhas.append({
            "agent_id": agent_id,
            "status": _texto(s.get("status")) or "online",
            "model": _texto(s.get("model")) or _texto(c.get("model")),
            "last_active": visto_em,
            "last_channel": _texto(_primeiro(s, "last_channel", "lastChannel")),
            "messages_today": n_sessoes,
            "tokens_today": _int(_primeiro(
                c, "tokens_total", "tokens",
                padrao=tokens_por_agente.get(agent_id, max_tokens),
            )),
            "cost_today": _num(_primeiro(c, "total_usd", "cost_total", "cost", padrao=c_bruto)),
            "errors_today": _int(_primeiro(s, "errors_today", "errors")),
            "session_count": n_sessoes,
            "max_total_tokens": max_tokens,
            "latest_updated_at": visto_em,
            "top_sessions": topo,
            "user_id": user_id,
        })
    return linhas


def _crons(jobs: list, quando: datetime) -> list[dict]:
    linhas = []
    for i, j in enumerate(jobs):
        if not isinstance(j, dict):
            continue
        linhas.append({
            # `id` é a chave primária. Sem `id` nem `name`, o original gerava
            # um sufixo aleatório; aqui o índice serve e é estável dentro do
            # mesmo snapshot, o que evita criar linha nova a cada coleta.
            "id": str(_primeiro(j, "id", "name", padrao=f"cron-{i}")),
            "name": _texto(j.get("name")),
            "agent": _texto(_primeiro(j, "agent", "agent_id")),
            "cron_expression": _texto(_primeiro(
                j, "cronExpression", "cron_expression", "expression", "schedule"
            )),
            "status": _texto(j.get("status")) or ("disabled" if j.get("enabled") is False else "ok"),
            "enabled": j["enabled"] if isinstance(j.get("enabled"), bool) else True,
            "last_run": _instante(_primeiro(j, "lastRun", "last_run")),
            "next_run": _instante(_primeiro(j, "nextRun", "next_run")),
            "prompt": _texto(_primeiro(j, "prompt", "description")),
        })
    return linhas


def _lista_de_crons(corpo: dict) -> list:
    bruto = _primeiro(corpo, "crons", "cron", padrao=[])
    if isinstance(bruto, list):
        return bruto
    if isinstance(bruto, dict):
        for k in ("jobs", "list"):
            if isinstance(bruto.get(k), list):
                return bruto[k]
    return []


def _agentes_de_lista(agentes: list, quando: datetime) -> list[dict]:
    """Formato em que os agentes vêm como array, não como mapa."""
    linhas = []
    for a in agentes:
        if not isinstance(a, dict):
            continue
        aid = _primeiro(a, "id", "agent_id")
        if not aid:
            continue
        linhas.append({
            "agent_id": str(aid),
            "status": _texto(a.get("status")) or "online",
            "model": _texto(a.get("model")),
            "last_active": _instante(_primeiro(a, "lastActive", "last_active")),
            "last_channel": _texto(_primeiro(a, "lastChannel", "last_channel")),
            "messages_today": _int(_primeiro(a, "messagesToday", "messages_today", "sessions")),
            "tokens_today": _int(_primeiro(a, "tokensToday", "tokens_today")),
            "cost_today": _num(_primeiro(a, "costToday", "cost_today")),
            "errors_today": _int(_primeiro(a, "errorsToday", "errors_today")),
            "session_count": None, "max_total_tokens": None,
            "latest_updated_at": None, "top_sessions": None, "user_id": None,
        })
    return linhas


# ─────────────────────────── gravação ───────────────────────────


async def _gravar(conn, gateway: dict | None, uso: dict | None,
                  agentes: list[dict], crons: list[dict], quando: datetime) -> list[str]:
    """Grava cada bloco isolado do outro e devolve o que falhou.

    Um bloco que estoura não derruba os demais: o snapshot é independente por
    tabela, e perder as três que funcionaram porque a quarta veio malformada
    seria trocar dado parcial por dado nenhum.
    """
    erros: list[str] = []

    if gateway:
        try:
            await conn.execute(
                "INSERT INTO public.gateway_health "
                "(status, version, uptime_seconds, latency_ms, collected_at) "
                "VALUES ($1,$2,$3,$4,$5)",
                gateway["status"], gateway["version"],
                _int(gateway["uptime_seconds"]) if gateway["uptime_seconds"] is not None else None,
                _int(gateway["latency_ms"]) if gateway["latency_ms"] is not None else None,
                quando,
            )
        except Exception as e:
            erros.append(f"gateway_health: {e}")

    if uso:
        try:
            await conn.execute(
                """
                INSERT INTO public.usage_daily
                    (date, messages_total, tokens_total, cost_total,
                     cache_hit_rate, error_rate, tool_calls, collected_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
                ON CONFLICT (date) DO UPDATE SET
                    messages_total = EXCLUDED.messages_total,
                    tokens_total   = EXCLUDED.tokens_total,
                    cost_total     = EXCLUDED.cost_total,
                    cache_hit_rate = EXCLUDED.cache_hit_rate,
                    error_rate     = EXCLUDED.error_rate,
                    tool_calls     = EXCLUDED.tool_calls,
                    collected_at   = EXCLUDED.collected_at
                """,
                uso["date"], uso["messages_total"], uso["tokens_total"], uso["cost_total"],
                uso["cache_hit_rate"], uso["error_rate"], uso["tool_calls"], quando,
            )
        except Exception as e:
            erros.append(f"usage_daily: {e}")

    if agentes:
        try:
            await conn.executemany(
                """
                INSERT INTO public.agent_stats
                    (agent_id, status, model, last_active, last_channel,
                     messages_today, tokens_today, cost_today, errors_today,
                     session_count, max_total_tokens, latest_updated_at,
                     top_sessions, user_id, collected_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::text::jsonb,$14::uuid,$15)
                ON CONFLICT (agent_id) DO UPDATE SET
                    status = EXCLUDED.status, model = EXCLUDED.model,
                    last_active = EXCLUDED.last_active,
                    last_channel = EXCLUDED.last_channel,
                    messages_today = EXCLUDED.messages_today,
                    tokens_today = EXCLUDED.tokens_today,
                    cost_today = EXCLUDED.cost_today,
                    errors_today = EXCLUDED.errors_today,
                    -- COALESCE: o formato antigo não manda estes campos, e
                    -- sobrescrevê-los com NULL apagaria o que o formato novo
                    -- já tinha gravado.
                    session_count = COALESCE(EXCLUDED.session_count, agent_stats.session_count),
                    max_total_tokens = COALESCE(EXCLUDED.max_total_tokens, agent_stats.max_total_tokens),
                    latest_updated_at = COALESCE(EXCLUDED.latest_updated_at, agent_stats.latest_updated_at),
                    top_sessions = COALESCE(EXCLUDED.top_sessions, agent_stats.top_sessions),
                    user_id = COALESCE(EXCLUDED.user_id, agent_stats.user_id),
                    collected_at = EXCLUDED.collected_at
                """,
                [(
                    a["agent_id"], a["status"], a["model"], a["last_active"], a["last_channel"],
                    a["messages_today"], a["tokens_today"], a["cost_today"], a["errors_today"],
                    a["session_count"], a["max_total_tokens"], a["latest_updated_at"],
                    json.dumps(a["top_sessions"]) if a["top_sessions"] else None,
                    a["user_id"], quando,
                ) for a in agentes],
            )
        except Exception as e:
            erros.append(f"agent_stats: {e}")

    if crons:
        try:
            await conn.executemany(
                """
                INSERT INTO public.cron_jobs
                    (id, name, agent, cron_expression, status, enabled,
                     last_run, next_run, prompt, collected_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
                ON CONFLICT (id) DO UPDATE SET
                    name = EXCLUDED.name, agent = EXCLUDED.agent,
                    cron_expression = EXCLUDED.cron_expression,
                    status = EXCLUDED.status, enabled = EXCLUDED.enabled,
                    last_run = EXCLUDED.last_run, next_run = EXCLUDED.next_run,
                    prompt = EXCLUDED.prompt, collected_at = EXCLUDED.collected_at
                """,
                [(c["id"], c["name"], c["agent"], c["cron_expression"], c["status"],
                  c["enabled"], c["last_run"], c["next_run"], c["prompt"], quando)
                 for c in crons],
            )
        except Exception as e:
            erros.append(f"cron_jobs: {e}")

    return erros


@router.post("/estatisticas")
async def receber(
    request: Request,
    _: None = Depends(exige_segredo("COLLECTOR_API_TOKEN")),
):
    """Recebe um snapshot do coletor da VPS.

    O corpo é lido cru porque não há esquema fixo — são três formatos, e
    validar por Pydantic exigiria três modelos que rejeitariam campos novos do
    coletor em vez de ignorá-los.
    """
    try:
        corpo = await request.json()
    except Exception:
        return JSONResponse({"error": "corpo não é JSON"}, status_code=400)
    if not isinstance(corpo, dict):
        return JSONResponse({"error": "corpo deve ser um objeto"}, status_code=400)

    agora = datetime.now(timezone.utc)
    quando = _instante_do_snapshot(corpo, agora)

    tem_formato_atual = any(
        corpo.get(k) is not None for k in ("gateway", "sessions", "costs", "crons", "tasks")
    )
    tem_estruturado = any(
        corpo.get(k) is not None for k in ("agents", "cron", "health", "usage")
    )
    tem_vps_plano = corpo.get("sessions_count") is not None or corpo.get("gateway_ok") is not None

    if tem_formato_atual and not tem_estruturado:
        formato = "atual"
        gateway = _gateway_atual(corpo)
        uso = _uso_atual(corpo, quando)
        agentes = _agentes_atual(corpo, quando)
        crons = _crons(_lista_de_crons(corpo), quando)

    elif tem_vps_plano:
        formato = "vps-plano"
        gateway = {
            "status": "online" if corpo.get("gateway_ok") else "offline",
            "version": _texto(_primeiro(corpo, "version", "gateway_version")),
            "uptime_seconds": _primeiro(corpo, "uptime_seconds", "uptime"),
            "latency_ms": _primeiro(corpo, "latency_ms", "latency"),
        }
        custos, tokens = _obj(corpo, "costs"), _obj(corpo, "tokens")
        tarefas, chamadas = _obj(corpo, "tasks"), _obj(corpo, "toolCalls")
        total = _num(tarefas.get("succeeded")) + _num(tarefas.get("failed")) + _num(tarefas.get("timed_out"))
        uso = {
            "date": quando.date(),
            "messages_total": _int(corpo.get("sessions_count")),
            "tokens_total": _int(_primeiro(tokens, "total", padrao=corpo.get("tokens_total"))),
            "cost_total": _num(_primeiro(custos, "total", padrao=_primeiro(_obj(corpo, "cost"), "total", padrao=corpo.get("cost_total")))),
            "cache_hit_rate": _num(_primeiro(tokens, "cacheHitRate", padrao=corpo.get("cache_hit_rate"))),
            "error_rate": _num(tarefas.get("failed")) / max(1, total) if tarefas.get("failed") else 0,
            "tool_calls": _int(_primeiro(chamadas, "total", padrao=corpo.get("tool_calls"))),
        }
        lista = corpo.get("agents")
        if isinstance(lista, list) and lista:
            agentes = _agentes_de_lista(lista, quando)
        else:
            # Sem array de agentes, a contagem por agente vira o próprio
            # `agent_stats`: `{lia: 1392, kira: 181, …}`.
            por_agente = _obj(corpo, "sessions")
            custo_pa = _obj(custos, "perAgent", "per_agent")
            tokens_pa = _obj(tokens, "perAgent", "per_agent")
            erros_pa = _obj(_obj(corpo, "errors"), "perAgent", "per_agent")
            agentes = [{
                "agent_id": aid, "status": "online", "model": None,
                "last_active": quando, "last_channel": None,
                "messages_today": _int(n), "tokens_today": _int(tokens_pa.get(aid)),
                "cost_today": _num(custo_pa.get(aid)), "errors_today": _int(erros_pa.get(aid)),
                "session_count": None, "max_total_tokens": None,
                "latest_updated_at": None, "top_sessions": None, "user_id": None,
            } for aid, n in por_agente.items()]
        crons = _crons(_lista_de_crons(corpo), quando)

    else:
        formato = "estruturado"
        saude, consumo = _obj(corpo, "health"), _obj(corpo, "usage")
        gateway = {
            "status": _texto(saude.get("status")),
            "version": _texto(saude.get("version")),
            "uptime_seconds": _primeiro(saude, "uptimeSeconds", "uptime_seconds"),
            "latency_ms": _primeiro(saude, "latencyMs", "latency_ms"),
        } if saude else None
        if consumo:
            d = consumo.get("date")
            uso = {
                "date": date.fromisoformat(d) if isinstance(d, str) else quando.date(),
                "messages_total": _int(_primeiro(_obj(consumo, "messages"), "total", padrao=consumo.get("messages_total"))),
                "tokens_total": _int(_primeiro(_obj(consumo, "tokens"), "total", padrao=consumo.get("tokens_total"))),
                "cost_total": _num(_primeiro(_obj(consumo, "cost"), "total", padrao=consumo.get("cost_total"))),
                "cache_hit_rate": _num(_primeiro(_obj(consumo, "tokens"), "cacheHitRate", padrao=consumo.get("cache_hit_rate"))),
                "error_rate": _num(_primeiro(_obj(consumo, "errors"), "rate", padrao=consumo.get("error_rate"))),
                "tool_calls": _int(_primeiro(_obj(consumo, "toolCalls"), "total", padrao=consumo.get("tool_calls"))),
            }
        else:
            uso = None
        lista = corpo.get("agents")
        agentes = _agentes_de_lista(lista, quando) if isinstance(lista, list) else []
        crons = _crons(corpo["cron"], quando) if isinstance(corpo.get("cron"), list) else []

    async with sessao(role="service_role") as conn:
        erros = await _gravar(conn, gateway, uso, agentes, crons, quando)

    logger.info(
        "Coleta %s: %d agentes, %d crons, %d erro(s), snapshot %s",
        formato, len(agentes), len(crons), len(erros), quando.isoformat(),
    )
    if erros:
        return JSONResponse(
            {"success": False, "formato": formato, "errors": erros}, status_code=207
        )
    return {"success": True, "formato": formato, "agentes": len(agentes), "crons": len(crons)}
