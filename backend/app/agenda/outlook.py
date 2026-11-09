"""Eventos do Outlook do usuário, só para consulta e checagem de conflito.

⚠️ Nada do evento é gravado no banco: título e local vêm de terceiros e voltam
ao agente apenas como dado externo. Falha do Outlook nunca derruba o lembrete —
o chamador recebe um estado e decide o que dizer.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta

from app.agenda.regras import FUSO
from app.email import contas, graph

logger = logging.getLogger(__name__)

_LIVRES = ("free", "workingElsewhere")


def _instante(bloco: dict) -> datetime:
    """`dateTime` do Graph vem sem offset, já na hora de Brasília, às vezes com
    7 casas de fração (o `fromisoformat` aceita até 6)."""
    texto = str(bloco["dateTime"])
    if "." in texto:
        base, fracao = texto.split(".", 1)
        texto = f"{base}.{fracao[:6]}"
    return datetime.fromisoformat(texto).replace(tzinfo=FUSO)


def _normalizar(bruto: dict) -> dict:
    return {
        "titulo": bruto.get("subject") or "",
        "inicio": _instante(bruto["start"]),
        "fim": _instante(bruto["end"]),
        "dia_inteiro": bool(bruto.get("isAllDay")),
        "local": (bruto.get("location") or {}).get("displayName") or "",
        "ocupado": bruto.get("showAs") not in _LIVRES,
    }


async def eventos(conn, user_id: str, de: datetime, ate: datetime) -> tuple[str, list[dict]]:
    """`(estado, eventos)`; estado: ok | sem_conta | sem_permissao | erro."""
    conta = await conn.fetchval(
        "SELECT 1 FROM public.email_contas WHERE user_id = $1::uuid", user_id)
    if not conta:
        return "sem_conta", []
    if not await contas.tem_calendario(conn, user_id):
        return "sem_permissao", []
    try:
        access, endereco = await contas.access_token(conn, user_id)
        brutos = await graph.calendario(access, endereco, de, ate)
        return "ok", [_normalizar(b) for b in brutos]
    except (graph.ErroGraph, contas.ErroConta) as e:
        # Só a classe e a mensagem: o token nunca entra no log.
        logger.warning("agenda: Outlook indisponível (%s: %s)", type(e).__name__, e)
        return "erro", []


def conflitos(eventos: list[dict], inicio: datetime,
              margem: timedelta = timedelta(minutes=30)) -> list[dict]:
    """Eventos ocupados que cruzam `[inicio - margem, inicio + margem]`."""
    de, ate = inicio - margem, inicio + margem
    return [e for e in eventos if e["ocupado"] and e["inicio"] < ate and e["fim"] > de]
