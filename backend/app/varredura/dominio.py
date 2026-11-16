"""Operações de banco da varredura do Guardi (tabela `varreduras`, migração 037).

A linha é a fila e o registro. As regras (dias úteis, horários, tetos, novidade)
moram em `regras.py`, puras; aqui só há SQL e a cola entre elas.

⚠️ O resumo vai CIFRADO para o banco (o usuário de leitura da empresa enxerga as
tabelas). Falha ao decifrar nunca derruba a leitura: o resumo vem `None`.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime

from app.email.cifra import cifrar, decifrar
from app.varredura.regras import (FUSO, TETO_RESUMO, Config, config, dia_util,
                                  horario, novidade, pode_pedir, validar_numeros,
                                  velha)

logger = logging.getLogger(__name__)

# Quanto tempo um run "rodando" ainda vale como a varredura do par.
JANELA_RODANDO = "30 minutes"

SQL_CONFIG = "SELECT value FROM public.app_settings WHERE key = 'varredura'"

# Um Guardi com dono ativo = a pessoa tem `dono_id` e o login dela está ligado.
SQL_SEMEAR_GUARDIS = """
    INSERT INTO public.varreduras (user_id, agent_id, dia, tipo, proximo_em)
    SELECT ap.dono_id, ap.agent_id, $1::date, $2, $3
      FROM public.agent_profiles ap
      JOIN auth.users u ON u.id = ap.dono_id AND u.is_active
     WHERE ap.dono_id IS NOT NULL
    ON CONFLICT DO NOTHING
"""

# O quadro é da Nina: uma linha por pessoa que ela atende.
SQL_SEMEAR_QUADRO = """
    INSERT INTO public.varreduras (user_id, agent_id, dia, tipo, proximo_em)
    SELECT x.uid, 'nina', $1::date, 'quadro', $2
      FROM public.agent_profiles ap
      CROSS JOIN LATERAL unnest(ap.allowed_user_ids) AS x(uid)
      JOIN auth.users u ON u.id = x.uid AND u.is_active
     WHERE ap.agent_id = 'nina'
    ON CONFLICT DO NOTHING
"""

SQL_RESERVAR = """
    UPDATE public.varreduras v SET disparando_em = now()
     WHERE v.id IN (
           SELECT x.id FROM public.varreduras x
            WHERE x.status = 'agendada'
              AND x.proximo_em <= now()
              AND (x.disparando_em IS NULL OR x.disparando_em < now() - interval '10 minutes')
            ORDER BY x.proximo_em
            LIMIT 10
            FOR UPDATE SKIP LOCKED)
       AND v.status = 'agendada'
       AND (v.disparando_em IS NULL OR v.disparando_em < now() - interval '10 minutes')
    RETURNING v.id::text AS id, v.user_id::text AS user_id, v.agent_id, v.dia,
              v.tipo, v.pedida_por, v.proximo_em, v.turno_pendente_desde,
              v.disparando_em
"""

# Só quem ainda tem a posse (o carimbo) grava o desfecho.
SQL_MARCAR = """
    UPDATE public.varreduras
       SET status = $2,
           run_id = COALESCE($4, run_id),
           proximo_em = COALESCE($5, proximo_em),
           turno_pendente_desde = COALESCE($6, turno_pendente_desde)
     WHERE id = $1::uuid AND disparando_em = $3
    RETURNING id
"""

SQL_RODANDO = f"""
    SELECT id::text AS id, tipo, dia
      FROM public.varreduras
     WHERE agent_id = $1 AND user_id = $2::uuid
       AND status = 'rodando' AND tipo <> 'quadro'
       AND disparando_em > now() - interval '{JANELA_RODANDO}'
     ORDER BY disparando_em DESC
     LIMIT 1
"""

SQL_MANHA = """
    SELECT numeros FROM public.varreduras
     WHERE user_id = $1::uuid AND dia = $2 AND tipo = 'manha'
       AND status IN ('entregue', 'nada_novo')
     LIMIT 1
"""

SQL_REGISTRAR = """
    UPDATE public.varreduras
       SET resumo_cifrado = $2, numeros = $3::jsonb, status = $4, entregue_em = now()
     WHERE id = $1::uuid
"""

# Run que já respondeu (message_id), cujo coletor desistiu, ou que passou de
# 30 min: a varredura terminou sem o Guardi registrar.
SQL_FECHAR = """
    UPDATE public.varreduras v SET status = 'sem_registro'
     WHERE v.status = 'rodando'
       AND EXISTS (
           SELECT 1 FROM public.agent_runs r
            WHERE r.run_id = v.run_id
              AND (r.message_id IS NOT NULL
                   OR r.coleta_encerrada_em IS NOT NULL
                   OR r.criado_em < now() - interval '30 minutes'))
"""

SQL_GUARDIS = """
    SELECT ap.dono_id::text AS user_id, ap.agent_id,
           p.full_name AS nome, p.cargo, p.departamento
      FROM public.agent_profiles ap
      JOIN auth.users u ON u.id = ap.dono_id AND u.is_active
      LEFT JOIN public.profiles p ON p.id = ap.dono_id
     WHERE ap.dono_id IS NOT NULL
       AND ($1::uuid IS NULL OR ap.dono_id = $1::uuid)
     ORDER BY p.full_name
"""

SQL_DO_DIA = """
    SELECT user_id::text AS user_id, tipo, status, numeros, resumo_cifrado,
           COALESCE(entregue_em, criado_em) AS hora
      FROM public.varreduras
     WHERE dia = $1 AND tipo IN ('manha', 'tarde', 'pedida')
       AND ($2::uuid IS NULL OR user_id = $2::uuid)
"""

SQL_PEDIDAS = """
    SELECT criado_em FROM public.varreduras
     WHERE user_id = $1::uuid AND dia = $2 AND tipo = 'pedida' AND pedida_por = 'nina'
"""

SQL_GUARDI_DE = "SELECT agent_id FROM public.agent_profiles WHERE dono_id = $1::uuid LIMIT 1"

SQL_PEDIR = """
    INSERT INTO public.varreduras (user_id, agent_id, dia, tipo, pedida_por, proximo_em)
    VALUES ($1::uuid, $2, $3, 'pedida', $4, now())
"""


def _dia_local(agora: datetime):
    return agora.astimezone(FUSO).date()


def _inseridas(status: str) -> int:
    """`INSERT 0 N` do asyncpg → N."""
    try:
        return int(str(status).split()[-1])
    except (ValueError, IndexError):
        return 0


async def ler_config(conn) -> Config:
    valor = await conn.fetchval(SQL_CONFIG)
    if isinstance(valor, str):
        try:
            valor = json.loads(valor)
        except ValueError:
            valor = None
    return config(valor)


async def semear(conn, cfg: Config, agora: datetime) -> int:
    """Cria as agendadas de HOJE que ainda não passaram do limite.

    Dois workers semeando juntos não duplicam: índice único + ON CONFLICT.
    """
    dia = _dia_local(agora)
    if not dia_util(dia):
        return 0
    total = 0
    for tipo in ("manha", "tarde", "quadro"):
        quando = horario(cfg, tipo, dia)
        if velha(tipo, quando, agora):
            continue  # semear 'manha' às 15h seria criar linha já morta
        if tipo == "quadro":
            total += _inseridas(await conn.execute(SQL_SEMEAR_QUADRO, dia, quando))
        else:
            total += _inseridas(await conn.execute(SQL_SEMEAR_GUARDIS, dia, tipo, quando))
    return total


async def reservar(conn) -> list[dict]:
    rows = await conn.fetch(SQL_RESERVAR)
    return [dict(r) for r in rows]


async def marcar(conn, id: str, status: str, carimbo, run_id: str | None = None,
                 proximo_em=None, pendente_desde=None) -> bool:
    r = await conn.fetchval(SQL_MARCAR, id, status, carimbo, run_id, proximo_em, pendente_desde)
    return r is not None


async def registrar(conn, agent_id: str, user_id: str, resumo: str, numeros: dict) -> dict:
    """O Guardi entrega o resumo. Recusa fora de varredura (LookupError).

    ⚠️ Não exige `run_id`: o Guardi pode chamar antes de o disparo gravá-lo.
    """
    numeros = validar_numeros(numeros)
    linha = await conn.fetchrow(SQL_RODANDO, agent_id, user_id)
    if linha is None:
        raise LookupError("não há varredura em curso para este Guardi")
    linha = dict(linha)
    status, mudou = "entregue", ["primeira do dia"]
    if linha["tipo"] == "tarde":
        m = await conn.fetchrow(SQL_MANHA, user_id, linha["dia"])
        manha = None
        if m is not None:
            manha = m["numeros"]
            if isinstance(manha, str):
                manha = json.loads(manha)
        tem, mudou = novidade(manha, numeros)
        status = "entregue" if tem else "nada_novo"
    else:
        tem = True
    await conn.execute(SQL_REGISTRAR, linha["id"], cifrar(resumo[:TETO_RESUMO]),
                       json.dumps(numeros), status)
    return {"status": status, "novidade": tem, "o_que_mudou": mudou}


async def fechar_sem_registro(conn) -> int:
    return _inseridas(await conn.execute(SQL_FECHAR))


def _decifrar(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return decifrar(token)
    except Exception:  # noqa: BLE001 — o resumo é acessório, a lista não cai
        logger.warning("varredura: não consegui decifrar um resumo")
        return None


async def do_dia(conn, dia, user_id: str | None = None) -> list[dict]:
    """Uma linha por Guardi: a entrega mais recente, senão o que houver."""
    guardis = await conn.fetch(SQL_GUARDIS, user_id)
    linhas = await conn.fetch(SQL_DO_DIA, dia, user_id)
    por_pessoa: dict[str, list[dict]] = {}
    for r in linhas:
        r = dict(r)
        por_pessoa.setdefault(r["user_id"], []).append(r)
    saida = []
    for g in guardis:
        g = dict(g)
        cand = sorted(por_pessoa.get(g["user_id"], []), key=lambda r: r["hora"])
        entregues = [r for r in cand if r["status"] == "entregue"]
        escolhida = (entregues or cand or [None])[-1]
        item = {"user_id": g["user_id"], "nome": g["nome"], "cargo": g["cargo"],
                "departamento": g["departamento"], "agent_id": g["agent_id"]}
        if escolhida is None:
            item.update(tipo=None, status="sem_varredura", hora=None, numeros=None, resumo=None)
        else:
            n = escolhida["numeros"]
            if isinstance(n, str):
                n = json.loads(n)
            item.update(tipo=escolhida["tipo"], status=escolhida["status"],
                        hora=escolhida["hora"], numeros=n,
                        resumo=_decifrar(escolhida["resumo_cifrado"]))
        saida.append(item)
    return saida


async def pedir(conn, user_id: str, agora: datetime, por: str = "nina") -> tuple[bool, str]:
    """Registra uma varredura pedida; o teto de 2/dia vale só para a Nina."""
    dia = _dia_local(agora)
    if por == "nina":
        pedidas = [r["criado_em"] for r in await conn.fetch(SQL_PEDIDAS, user_id, dia)]
        ok, motivo = pode_pedir(pedidas, agora)
        if not ok:
            return False, motivo
    agent_id = await conn.fetchval(SQL_GUARDI_DE, user_id)
    if not agent_id:
        return False, "Essa pessoa não tem Guardi."
    await conn.execute(SQL_PEDIR, user_id, agent_id, dia, por)
    return True, ""
