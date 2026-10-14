"""Marca "entregue" — o navegador da pessoa estava conectado (spec 2026-10-14).

Quem marca é o servidor, não um "recebi" do navegador: a tela não precisa
estar no canal, e o cliente não precisa lembrar de confirmar. Cada worker
marca para quem está ligado nele; o `entregue_em IS NULL` torna repetir inócuo.
"""
import asyncio
import logging

from app.database import sessao
from app.realtime import hub
from app.recibos import eh_uuid as _eh_uuid

logger = logging.getLogger(__name__)

SQL_ENTREGAR_PENDENTES = """
    UPDATE public.recibos_mensagem SET entregue_em = now()
     WHERE user_id = $1::uuid AND entregue_em IS NULL
"""

SQL_ENTREGAR_MENSAGEM = """
    UPDATE public.recibos_mensagem SET entregue_em = now()
     WHERE message_id = $1::uuid AND user_id = ANY($2::uuid[]) AND entregue_em IS NULL
"""

_TAREFAS: set[asyncio.Task] = set()


def disparar(coro) -> None:
    try:
        tarefa = asyncio.get_running_loop().create_task(coro)
    except RuntimeError:
        coro.close()
        return
    _TAREFAS.add(tarefa)
    tarefa.add_done_callback(_TAREFAS.discard)


async def entregar_pendentes(user_id: str) -> None:
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(SQL_ENTREGAR_PENDENTES, user_id)
    except Exception as e:  # noqa: BLE001 — recibo é acessório
        logger.warning("Recibo: entregar pendentes de %s falhou: %s", user_id, e)


async def entregar_mensagem(message_id: str) -> None:
    conectados = [u for u in hub.usuarios_conectados() if _eh_uuid(u)]
    if not conectados:
        return
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(SQL_ENTREGAR_MENSAGEM, message_id, conectados)
    except Exception as e:  # noqa: BLE001
        logger.warning("Recibo: entregar %s falhou: %s", message_id, e)
