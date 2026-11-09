"""Disparador de lembretes do Guardi (spec 2026-11-09, "Disparador").

A cada `DISPARADOR_LEMBRETES_SEGUNDOS` (padrão 30; 0 desliga), cada worker
reserva até 20 lembretes vencidos e, para cada um:

1. **o recado, sem agente** — `⏰ Lembrete: <titulo>` em `conversations`,
   comitado antes de qualquer chamada ao gateway. O push nasce do trigger do
   INSERT (`trg_push_pendente`). ⚠️ É isto que garante o anti-objetivo
   "lembrete que some": com o gateway fora, a pessoa recebe o recado igual;
2. **o turno do Guardi**, se há `instrucao` e o teto diário permite, pela porta
   única `disparar_turno` em nome do dono. A resposta é colhida pelo
   `coletor_respostas` — nada a fazer aqui;
3. **avança**: único → `proximo_em` NULL; recorrente → o próximo pela regra.

⚠️ **Turno já aberto com o Guardi** (de qualquer pessoa): o recado sai na hora
e o turno é adiado de 2 em 2 min, até 30 min contados do disparo ORIGINAL
(`turno_pendente_desde`). Abrir o turno no meio de outro faria o coletor perder
a resposta em curso (ele só colhe o run mais novo) ou colar duas respostas numa
bolha. Passou dos 30 min, fica só o recado (`entregue_sem_agente`).

⚠️ **Reserva entre os 2 workers** por `disparando_em`, com a guarda repetida no
WHERE de fora — o mesmo desenho do `SQL_RESERVAR_RUNS` do coletor. Sem ela, o
recado e o turno saíam em dobro.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import asyncpg

from app.agenda.regras import ADIAMENTO, ADIAMENTO_MAX, ATRASO_MAX, TETO_TURNOS_DIA, proximo
from app.database import sessao
from app.dependencies import normalizar_agent_id
from app.gateway.client import ErroGateway
from app.routers.mcp_anexos import JANELA_TURNO_S

logger = logging.getLogger(__name__)

# Marca os runs abertos pelo disparador; é por ela que o teto diário conta.
PREFIXO_RUN = "hsos-lembrete-"

SQL_RESERVAR = """
    UPDATE public.lembretes l SET disparando_em = now()
     WHERE l.id IN (
           SELECT x.id FROM public.lembretes x
            WHERE x.ativo
              AND x.proximo_em <= now()
              AND (x.disparando_em IS NULL OR x.disparando_em < now() - interval '2 minutes')
            ORDER BY x.proximo_em
            LIMIT 20
            FOR UPDATE SKIP LOCKED)
       AND l.ativo
       AND (l.disparando_em IS NULL OR l.disparando_em < now() - interval '2 minutes')
    RETURNING l.id::text AS id, l.user_id::text AS user_id, l.agent_id, l.titulo,
              l.instrucao, l.regra, l.proximo_em, l.turno_pendente_desde
"""

# Run aberto com o agente, de QUALQUER pessoa — a regra do `turno_em_curso`
# (`routers/mcp_anexos.py`) sem o filtro de dono, e sem o run que o coletor já
# largou ou que a compactação redirecionou.
SQL_TURNO_ABERTO = """
    SELECT EXISTS (
        SELECT 1 FROM public.agent_runs
         WHERE regexp_replace(lower(btrim(agent_id)), '^openclaw:', '') = $1
           AND message_id IS NULL
           AND redireciona_para IS NULL
           AND coleta_encerrada_em IS NULL
           AND criado_em > now() - make_interval(secs => $2))
"""

SQL_TURNOS_HOJE = """
    SELECT count(*) FROM public.agent_runs
     WHERE user_id = $1::uuid
       AND run_id LIKE 'hsos-lembrete-%'
       AND criado_em >= (date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo')
                         AT TIME ZONE 'America/Sao_Paulo')
"""

SQL_NOME = "SELECT full_name FROM public.profiles WHERE id = $1::uuid"

SQL_RECADO = """
    INSERT INTO public.conversations (agent_id, user_id, role, content, media)
    VALUES ($1, $2::uuid, 'agent', $3, $4::text::jsonb)
"""

# `ultimo_disparo_em` e `ultimo_status` nulos mantêm o que estava (adiamento e
# perdido não são disparo novo).
SQL_CONCLUIR = """
    UPDATE public.lembretes
       SET proximo_em = $2,
           turno_pendente_desde = $3,
           ultimo_disparo_em = COALESCE($4, ultimo_disparo_em),
           ultimo_status = COALESCE($5, ultimo_status),
           disparando_em = NULL,
           atualizado_em = now()
     WHERE id = $1::uuid
"""

# Exceção inesperada: registra e AVANÇA como numa conclusão, sem nova tentativa.
# ⚠️ Soltar sem avançar fazia a passada seguinte regravar o recado a cada 30 s
# por até 6 h. Melhor perder um disparo que entrar em laço.
SQL_ERRO = """
    UPDATE public.lembretes
       SET ultimo_status = 'erro',
           proximo_em = $2,
           turno_pendente_desde = NULL,
           disparando_em = NULL,
           atualizado_em = now()
     WHERE id = $1::uuid
"""


@dataclass(frozen=True)
class Decisao:
    recado: bool
    turno: bool
    adiar_ate: datetime | None
    status: str | None


def decidir(l: dict, agora: datetime, turno_aberto: bool, turnos_hoje: int) -> Decisao:
    """O que fazer com um lembrete vencido. Pura.

    `status` None = adiado (ainda não concluiu).
    """
    if agora - l["proximo_em"] > ATRASO_MAX:
        return Decisao(False, False, None, "perdido")
    pendente_desde = l.get("turno_pendente_desde")
    recado = pendente_desde is None
    if not l.get("instrucao"):
        return Decisao(recado, False, None, "entregue")
    if turnos_hoje >= TETO_TURNOS_DIA:
        return Decisao(recado, False, None, "entregue_sem_agente")
    if turno_aberto:
        espera = agora - (pendente_desde or agora)
        if espera < ADIAMENTO_MAX:
            return Decisao(recado, False, agora + ADIAMENTO, None)
        return Decisao(recado, False, None, "entregue_sem_agente")
    return Decisao(recado, True, None, "entregue")


def _seguinte(regra: dict, agora: datetime) -> datetime | None:
    """Único encerra; recorrente vai para o próximo pela regra."""
    return None if regra.get("tipo") == "unico" else proximo(regra, agora)


def _primeiro_nome(full_name) -> str:
    partes = (full_name or "").split()
    return partes[0] if partes else "o dono"


def _mensagem(nome: str, titulo: str, instrucao: str) -> str:
    return f'[Lembrete agendado por {nome} — "{titulo}"] {instrucao}'


async def disparar_um(sessao_fn, l: dict, agora: datetime, disparar=None) -> None:
    """Aplica a `Decisao` a um lembrete reservado.

    Recebe a fábrica de sessão, não uma conexão: o recado tem que estar
    COMITADO antes do `chat.send`, e uma conexão dentro de transação só
    comitaria no fim. Cada passo é uma transação curta.
    """
    if disparar is None:
        # Importado aqui: o router importa muita coisa (mesmo motivo do coletor).
        from app.routers.conversations import disparar_turno as disparar

    async with sessao_fn(role="service_role") as conn:
        turno_aberto = bool(await conn.fetchval(
            SQL_TURNO_ABERTO, normalizar_agent_id(l["agent_id"]), float(JANELA_TURNO_S)))
        turnos_hoje = int(await conn.fetchval(SQL_TURNOS_HOJE, l["user_id"]) or 0)
        nome = _primeiro_nome(await conn.fetchval(SQL_NOME, l["user_id"]))

    dec = decidir(l, agora, turno_aberto, turnos_hoje)
    status = dec.status

    if dec.recado:
        media = json.dumps([{"type": "lembrete", "id": l["id"], "name": l["titulo"],
                             "mimeType": "", "base64": ""}], ensure_ascii=False)
        async with sessao_fn(role="service_role") as conn:
            await conn.execute(SQL_RECADO, l["agent_id"], l["user_id"],
                               f"⏰ Lembrete: {l['titulo']}", media)

    if dec.turno:
        try:
            await disparar(l["agent_id"], l["user_id"],
                           _mensagem(nome, l["titulo"], l["instrucao"]),
                           prefixo=PREFIXO_RUN)
        except ErroGateway as e:
            logger.warning("Lembrete %s: turno do agente falhou, ficou só o recado: %s",
                           l["id"], e)
            status = "entregue_sem_agente"

    if dec.adiar_ate is not None:
        # Mantém o instante ORIGINAL: é dele que a espera de 30 min é contada.
        args = (l["id"], dec.adiar_ate, l.get("turno_pendente_desde") or agora,
                agora if dec.recado else None, None)
    else:
        seguinte = _seguinte(l["regra"], agora)
        args = (l["id"], seguinte, None, None if status == "perdido" else agora, status)
    async with sessao_fn(role="service_role") as conn:
        await conn.execute(SQL_CONCLUIR, *args)


async def passada(sessao_fn, agora: datetime, disparar=None) -> int:
    """Reserva e dispara. Um lembrete ruim não para os outros.

    Exceção inesperada vira `erro` e avança — antes ou depois do recado: sem
    nova tentativa, porque repetir regravaria o recado a cada passada.
    """
    async with sessao_fn(role="service_role") as conn:
        lembretes = await conn.fetch(SQL_RESERVAR)
    for l in lembretes:
        l = dict(l)
        try:
            await disparar_um(sessao_fn, l, agora, disparar=disparar)
        except Exception:  # noqa: BLE001 — um lembrete não derruba a passada
            logger.exception("Lembrete %s quebrou no disparo.", l["id"])
            try:
                seguinte = _seguinte(l["regra"], agora)
            except Exception:  # noqa: BLE001 — regra quebrada: encerra, não laça
                seguinte = None
            try:
                async with sessao_fn(role="service_role") as conn:
                    await conn.execute(SQL_ERRO, l["id"], seguinte)
            except Exception as e:  # noqa: BLE001
                logger.warning("Lembrete %s: não registrei o erro: %s", l["id"], e)
    return len(lembretes)


def intervalo() -> int:
    try:
        return max(0, int(os.environ.get("DISPARADOR_LEMBRETES_SEGUNDOS", "30")))
    except ValueError:
        return 30


async def rodar(parar: asyncio.Event) -> None:
    """Laço de fundo do `lifespan`.

    Não espera o gateway estar configurado: o recado sai sem ele.
    """
    seg = intervalo()
    if not seg:
        logger.info("Disparador de lembretes desligado (DISPARADOR_LEMBRETES_SEGUNDOS=0).")
        return
    logger.info("Disparador de lembretes a cada %ds.", seg)
    avisou_sem_tabela = False
    while not parar.is_set():
        espera = seg
        try:
            await passada(sessao, datetime.now(timezone.utc))
        except (asyncpg.UndefinedTableError, asyncpg.UndefinedColumnError):
            # Código no ar antes da `032`: avisa uma vez e espera mais.
            if not avisou_sem_tabela:
                avisou_sem_tabela = True
                logger.warning("Disparador de lembretes parado: aplicar a migração 032.")
            espera = 60
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — o laço não pode morrer
            logger.warning("Disparador de lembretes: passada falhou: %s", e)
        try:
            await asyncio.wait_for(parar.wait(), timeout=espera)
        except asyncio.TimeoutError:
            pass
