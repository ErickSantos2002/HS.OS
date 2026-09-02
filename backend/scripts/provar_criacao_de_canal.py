#!/usr/bin/env python3
"""Prova que o criador entra no canal que acabou de nascer, com RLS ligado.

Por que existir: em 02/09/2026 `POST /channels` respondeu **500 para o
administrador** em produção — e o administrador é o único papel que pode
chamar essa rota desde a 015, então *ninguém* criava canal. A causa não estava
em policy nenhuma: estava na forma do `INSERT`.

    INSERT ... ON CONFLICT (channel_id, user_id) DO NOTHING   -- estourava
    INSERT ... ON CONFLICT DO NOTHING                          -- passa

Um **alvo de conflito explícito** faz o Postgres sondar o índice único, e a
sondagem exige SELECT na tabela. A policy de SELECT de `channel_members` é
`is_public_channel(channel_id) OR is_channel_member(channel_id, auth.uid())`:
num canal privado recém-criado o criador ainda não é membro — é justamente a
linha que ele está tentando inserir. Ovo e galinha, e só na PRIMEIRA linha de
um canal novo. Por isso `adicionar_membros`, que usa a forma sem alvo, nunca
mostrou o defeito, e por isso nenhum teste de unidade pegaria: some inteiro
quando se conecta como superusuário, que passa por cima do RLS.

⚠️ **Este script conecta como superusuário e desce para `authenticated` de
   propósito.** O `provar_invariante.py` roda como superusuário e está certo em
   fazê-lo — lá o que se prova é uma consulta. Aqui o que se prova é a interação
   com o RLS: rodar sem ele provaria nada.

Importa `SQL_INSERIR_MEMBRO` de `app.routers.channels` — a mesma constante que
as duas rotas usam, não uma cópia. Foi a divergência entre duas cópias desse
`INSERT` que abriu o defeito.

Não entra no pytest — toca banco de propósito. Rodar contra um rascunho:

    PORTA=5439 bash scripts/banco-rascunho.sh
    cd backend && ./.venv/bin/python scripts/provar_criacao_de_canal.py \
        "postgresql://postgres:rascunho@127.0.0.1:5439/hsos"

Tudo dentro de uma transação com ROLLBACK explícito: nada fica gravado.
"""
import asyncio
import sys
from pathlib import Path
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import asyncpg

from app.routers.channels import SQL_INSERIR_MEMBRO


async def _semear_admin(conn: asyncpg.Connection) -> str:
    """Um administrador de verdade, criado como superusuário (o RLS ainda não desceu)."""
    admin = str(uuid4())
    email = f"prova-admin-{uuid4().hex[:8]}@rascunho"
    await conn.execute("INSERT INTO auth.users (id, email) VALUES ($1::uuid, $2)", admin, email)
    await conn.execute(
        "INSERT INTO public.profiles (id, email, full_name) VALUES ($1::uuid, $2, 'Prova Admin')",
        admin, email,
    )
    await conn.execute(
        "INSERT INTO public.user_roles (user_id, role) VALUES ($1::uuid, 'administrador')", admin
    )
    return admin


async def checar(conn: asyncpg.Connection) -> None:
    admin = await _semear_admin(conn)
    outra_pessoa = await _semear_admin(conn)  # serve como segundo humano
    agente = f"prova-agente-{uuid4().hex[:8]}"
    await conn.execute(
        "INSERT INTO public.agent_profiles (agent_id, access_type) VALUES ($1, 'all')", agente
    )

    # ── Daqui para baixo é a sessão da rota: `authenticated` + app.current_user_id.
    await conn.execute("SELECT set_config('app.current_user_id', $1, true)", admin)
    await conn.execute("SELECT set_config('app.user_role', 'authenticated', true)")
    await conn.execute("SET LOCAL ROLE authenticated")

    assert await conn.fetchval("SELECT auth.uid()::text") == admin, "auth.uid() não é o admin"
    assert await conn.fetchval("SELECT has_role(auth.uid(), 'administrador')"), "não é admin"

    # ── Caso 1: o criador entra no canal recém-nascido ──────────────────────
    # Era exatamente aqui que produção dava 500.
    canal = await conn.fetchval(
        "INSERT INTO public.channels (name, type, created_by) "
        "VALUES ('prova-criacao', 'private', $1::uuid) RETURNING id::text",
        admin,
    )
    await conn.execute(SQL_INSERIR_MEMBRO, canal, admin, "human")
    assert await conn.fetchval(
        "SELECT EXISTS (SELECT 1 FROM public.channel_members "
        " WHERE channel_id = $1::uuid AND user_id = $2)", canal, admin
    ), "caso 1: o criador não entrou no próprio canal"
    print("caso 1 (criador no canal recém-nascido)      — OK: entrou")

    # ── Caso 2: os demais membros entram depois do criador ──────────────────
    await conn.execute(SQL_INSERIR_MEMBRO, canal, outra_pessoa, "human")
    await conn.execute(SQL_INSERIR_MEMBRO, canal, agente, "agent")
    assert await conn.fetchval(
        "SELECT count(*) FROM public.channel_members WHERE channel_id = $1::uuid", canal
    ) == 3, "caso 2: esperava criador + pessoa + agente"
    print("caso 2 (pessoa e agente depois do criador)   — OK: os três dentro")

    # ── Caso 3: o DO NOTHING continua fazendo o trabalho dele ───────────────
    # Sem alvo de conflito a cláusula ainda engole a violação de unicidade —
    # trocar a forma do INSERT não pode transformar reentrada em erro.
    await conn.execute(SQL_INSERIR_MEMBRO, canal, outra_pessoa, "human")
    assert await conn.fetchval(
        "SELECT count(*) FROM public.channel_members WHERE channel_id = $1::uuid", canal
    ) == 3, "caso 3: reinserir duplicou a linha"
    print("caso 3 (reinserir o mesmo membro)            — OK: ignorado, sem erro")

    await conn.execute("RESET ROLE")


async def main() -> None:
    if len(sys.argv) != 2:
        print("uso: provar_criacao_de_canal.py <DATABASE_URL>", file=sys.stderr)
        sys.exit(1)

    conn = await asyncpg.connect(sys.argv[1])
    tx = conn.transaction()
    await tx.start()
    try:
        await checar(conn)
    finally:
        await tx.rollback()  # nada fica gravado, nem quando um caso falha no meio
        await conn.close()
    print("\nOK — provar_criacao_de_canal.py passou (3/3 casos)")


if __name__ == "__main__":
    asyncio.run(main())
