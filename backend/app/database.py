import json
import logging
from contextlib import asynccontextmanager
from typing import Optional

import asyncpg

from app.config import settings

logger = logging.getLogger(__name__)

_pool: Optional[asyncpg.Pool] = None


async def _setup_conn(conn: asyncpg.Connection) -> None:
    await conn.set_type_codec("jsonb", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")
    await conn.set_type_codec("json", encoder=json.dumps, decoder=json.loads, schema="pg_catalog")


async def init_db() -> None:
    """Abre o pool. Enquanto o Postgres próprio não existe, a ausência de banco
    não impede a API de subir: o pool fica `None` e `get_db` responde 503. Isso
    mantém `/health` e o `/docs` utilizáveis durante a portagem."""
    global _pool

    if not settings.DATABASE_URL:
        logger.warning("DATABASE_URL vazio — subindo sem banco. Endpoints de dados vão responder 503.")
        return

    try:
        _pool = await asyncpg.create_pool(
            settings.DATABASE_URL,
            min_size=2,
            max_size=10,
            setup=_setup_conn,
        )
    except Exception as exc:  # noqa: BLE001 — falha de banco não derruba o processo
        logger.error("Falha ao conectar no Postgres: %s", exc)


async def close_db() -> None:
    if _pool:
        await _pool.close()


def get_pool() -> asyncpg.Pool:
    return _pool


# Os únicos papéis que uma sessão pode assumir. A lista existe porque
# `SET LOCAL ROLE` não aceita parâmetro — o nome vai concatenado na query, então
# ele nunca pode vir de entrada do usuário.
PAPEIS = frozenset({"anon", "authenticated", "service_role"})


@asynccontextmanager
async def sessao(role: str = "anon", user_id: str | None = None):
    """Conexão dentro de uma transação, com o contexto de RLS já aplicado.

    Toda query de dado precisa passar por aqui. O backend conecta como `hsos_app`,
    que é NOINHERIT e não tem privilégio nenhum em `public` — sem o `SET LOCAL
    ROLE` desta função, a query falha com permissão negada em vez de rodar sem
    contexto de usuário.

    `role="service_role"` tem BYPASSRLS: usar só para operação interna
    (bootstrap, jobs agendados), nunca para request de usuário.
    """
    if role not in PAPEIS:
        raise ValueError(f"papel inválido: {role!r}")

    pool = get_pool()
    if pool is None:
        raise RuntimeError("banco indisponível")

    async with pool.acquire() as conn:
        async with conn.transaction():
            # set_config com is_local=true equivale a SET LOCAL: reverte no fim
            # da transação, então a conexão volta limpa para o pool.
            await conn.execute(
                "SELECT set_config('app.current_user_id', $1, true)", str(user_id or "")
            )
            await conn.execute("SELECT set_config('app.user_role', $1, true)", role)
            await conn.execute(f"SET LOCAL ROLE {role}")
            yield conn
