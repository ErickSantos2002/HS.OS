#!/usr/bin/env python3
"""Prova, contra um Postgres de verdade, a consulta de `_primeiro_par_sem_acesso`.

Por que existir: a suíte do pytest não toca banco (regra da casa —
`backend/tests/` é só função pura com objeto falso, ver `tests/test_acesso_agente.py`),
e o teste gêmeo SQL da 014 (`backend/migrations/_testes/014_acesso_a_agente.test.sql`)
cobre a função `pode_ver_agente` e o trigger, não esta consulta — que é SQL
embutido em `channels.py`, novo desta tarefa e nunca antes rodado contra um
banco. Um erro de digitação nela só apareceria em produção, como 500 na
própria guarda que devia dar 403.

Importa `SQL_PAR_SEM_ACESSO` de `app.routers.channels` — não copia o texto: é
a mesma consulta que a rota roda, não uma segunda versão que pode divergir sem
avisar ninguém (é o mesmo motivo pelo qual a tabela de casos do
`test_acesso_agente.py` é gêmea, e não compartilhada, da do SQL).

Não entra no pytest — toca banco de propósito. Rodar contra um banco de
rascunho descartável:

    bash scripts/banco-rascunho.sh
    cd backend && ./.venv/bin/python scripts/provar_invariante.py \
        "$(bash ../scripts/banco-rascunho.sh --url)"

Tudo roda dentro de uma transação com ROLLBACK explícito no final — mesmo que
um caso falhe no meio, nada fica gravado no rascunho.

Prova quatro casos:
  1. par que fecha — ninguém é recusado quando todo mundo pode ver todo mundo;
  2. humano ENTRANDO × agente JÁ DENTRO — a direção que `adicionar_membros`
     cobre quando alguém tenta entrar num canal com agente que não vê;
  3. agente ENTRANDO × humano JÁ DENTRO — a direção oposta, quando se tenta
     trazer um agente para um canal com gente que não pode vê-lo;
  4. canal sem agente nenhum — o `CROSS JOIN` com o lado de agentes vazio não
     pode gerar par nenhum (nem falso positivo, nem erro de SQL).
"""
import asyncio
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg

from app.routers.channels import SQL_PAR_SEM_ACESSO


async def _canal(conn: asyncpg.Connection) -> str:
    linha = await conn.fetchrow(
        "INSERT INTO public.channels (name, type, created_by) "
        "VALUES ('prova-invariante', 'private', $1::uuid) RETURNING id::text",
        str(uuid4()),
    )
    return linha["id"]


async def _membro(conn: asyncpg.Connection, canal_id: str, membro_id: str, tipo: str) -> None:
    await conn.execute(
        "INSERT INTO public.channel_members (channel_id, user_id, member_type) "
        "VALUES ($1::uuid, $2, $3)",
        canal_id, membro_id, tipo,
    )


async def checar(conn: asyncpg.Connection) -> None:
    pessoa_a, pessoa_b = str(uuid4()), str(uuid4())
    aberto = f"prova-aberto-{uuid4().hex[:8]}"
    restrito = f"prova-restrito-{uuid4().hex[:8]}"

    await conn.execute(
        "INSERT INTO public.agent_profiles (agent_id, access_type, allowed_user_ids) "
        "VALUES ($1, 'all', '{}'::uuid[]), "
        "       ($2, 'specific_users', ARRAY[$3]::uuid[])",
        aberto, restrito, pessoa_a,
    )
    # pessoa_a está na lista de `restrito`; pessoa_b não está.

    # ── Caso 1: par que fecha ────────────────────────────────────────────────
    canal1 = await _canal(conn)
    await _membro(conn, canal1, pessoa_a, "human")
    par = await conn.fetchrow(SQL_PAR_SEM_ACESSO, canal1, [], [aberto])
    assert par is None, f"caso 1 (par que fecha): esperava None, veio {dict(par)}"
    print("caso 1 (par que fecha)                          — OK: nenhum par recusado")

    # ── Caso 2: humano ENTRANDO × agente JÁ DENTRO ──────────────────────────
    canal2 = await _canal(conn)
    await _membro(conn, canal2, restrito, "agent")  # já dentro
    par = await conn.fetchrow(SQL_PAR_SEM_ACESSO, canal2, [pessoa_b], [])  # pessoa_b entrando
    assert par is not None, "caso 2 (humano entrando × agente já dentro): esperava um par, veio None"
    assert par["pessoa"] == pessoa_b and par["agente"] == restrito, f"caso 2: par errado {dict(par)}"
    print(f"caso 2 (humano entrando × agente já dentro)     — OK: recusou {dict(par)}")

    # ── Caso 3: agente ENTRANDO × humano JÁ DENTRO ──────────────────────────
    canal3 = await _canal(conn)
    await _membro(conn, canal3, pessoa_b, "human")  # já dentro
    par = await conn.fetchrow(SQL_PAR_SEM_ACESSO, canal3, [], [restrito])  # restrito entrando
    assert par is not None, "caso 3 (agente entrando × humano já dentro): esperava um par, veio None"
    assert par["pessoa"] == pessoa_b and par["agente"] == restrito, f"caso 3: par errado {dict(par)}"
    print(f"caso 3 (agente entrando × humano já dentro)     — OK: recusou {dict(par)}")

    # ── Caso 4: canal sem agente nenhum ─────────────────────────────────────
    canal4 = await _canal(conn)
    await _membro(conn, canal4, pessoa_a, "human")
    par = await conn.fetchrow(SQL_PAR_SEM_ACESSO, canal4, [pessoa_b], [])
    assert par is None, f"caso 4 (canal sem agente): esperava None, veio {dict(par)}"
    print("caso 4 (canal sem agente nenhum)                 — OK: nenhum par (CROSS JOIN vazio)")


async def main() -> None:
    if len(sys.argv) != 2:
        print("uso: provar_invariante.py <DATABASE_URL>", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(sys.argv[1])
    tx = conn.transaction()
    await tx.start()
    try:
        await checar(conn)
    finally:
        await tx.rollback()  # nada fica gravado, nem quando um caso falha no meio
        await conn.close()
    print("\nOK — provar_invariante.py passou (4/4 casos)")


if __name__ == "__main__":
    asyncio.run(main())
