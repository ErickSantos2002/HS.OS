"""Confirmar ou cancelar a ação que o bot pessoal preparou num sistema.

⚠️ Única porta para o bot ALTERAR algo num sistema interno. Só o dono (404
para os outros); executa o `payload` gravado; linha travada contra clique
duplo; validade de 24 h.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse

from app import acoes
from app.agente_token import chave_publica_pem
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.sistemas.taskhs import ErroSistema

logger = logging.getLogger(__name__)
router = APIRouter(tags=["acoes"])

VALIDADE = timedelta(hours=24)


@router.get("/agente/chave-publica", response_class=PlainTextResponse)
async def chave_publica():
    """A chave PÚBLICA do token de agente — o que os sistemas precisam para conferir."""
    return chave_publica_pem()


async def _acao_do_dono(conn, acao_id: str, usuario: Usuario) -> dict:
    try:
        a = await conn.fetchrow(
            "SELECT a.id::text AS id, a.user_id::text AS user_id, a.agent_id, a.sistema, a.acao, "
            "       a.payload, a.resumo, a.status, a.erro, a.resultado, a.criado_em, p.email "
            "  FROM public.acoes_pendentes a JOIN public.profiles p ON p.id = a.user_id "
            " WHERE a.id = $1::uuid AND a.user_id = $2::uuid FOR UPDATE OF a",
            acao_id, usuario.id)
    except Exception:  # noqa: BLE001 — id malformado
        a = None
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ação não encontrada.")
    a = dict(a)
    if isinstance(a["payload"], str):
        a["payload"] = json.loads(a["payload"])
    if a["status"] == "pendente" and datetime.now(timezone.utc) - a["criado_em"] > VALIDADE:
        await conn.execute("UPDATE public.acoes_pendentes SET status = 'vencida', decidido_em = now() "
                           " WHERE id = $1::uuid AND status = 'pendente'", acao_id)
        a["status"] = "vencida"
    return a


def _saida(a: dict) -> dict:
    return {k: a[k] for k in ("id", "status", "sistema", "acao", "resumo", "payload", "resultado", "erro")}


@router.get("/acoes/{acao_id}")
async def ver_acao(acao_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        return _saida(await _acao_do_dono(conn, acao_id, usuario))


@router.post("/acoes/{acao_id}/confirmar")
async def confirmar_acao(acao_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        a = await _acao_do_dono(conn, acao_id, usuario)
        if a["status"] != "pendente":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Esta ação já está {a['status']}.")
        executor = acoes.EXECUTORES.get((a["sistema"], a["acao"]))
        if not executor:
            raise HTTPException(status.HTTP_409_CONFLICT, "Ação desconhecida.")
        try:
            resultado = await executor(a["email"], a["agent_id"], a["payload"])
        except ErroSistema as e:
            await conn.execute("UPDATE public.acoes_pendentes SET status = 'erro', erro = $2, "
                               "decidido_em = now() WHERE id = $1::uuid AND status = 'pendente'",
                               acao_id, str(e)[:300])
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e)) from e
        await conn.execute("UPDATE public.acoes_pendentes SET status = 'feita', resultado = $2, "
                           "decidido_em = now() WHERE id = $1::uuid AND status = 'pendente'",
                           acao_id, resultado)
    return {"status": "feita", "resultado": resultado}


@router.post("/acoes/{acao_id}/cancelar")
async def cancelar_acao(acao_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        a = await _acao_do_dono(conn, acao_id, usuario)
        if a["status"] != "pendente":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Esta ação já está {a['status']}.")
        await conn.execute("UPDATE public.acoes_pendentes SET status = 'cancelada', decidido_em = now() "
                           " WHERE id = $1::uuid AND status = 'pendente'", acao_id)
    return {"status": "cancelada"}
