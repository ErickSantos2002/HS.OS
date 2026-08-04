import json
import logging
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
