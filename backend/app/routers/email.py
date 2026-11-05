"""E-mail dos bots pessoais: conectar a conta, caixas e aprovação de envio.

Spec: docs/superpowers/specs/2026-11-05-bot-email-piloto-design.md.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.email import contas, graph

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/email", tags=["email"])

VALIDADE_STATE = timedelta(minutes=10)


def _hash(state: str) -> str:
    return hashlib.sha256(state.encode()).hexdigest()


def _voltar(resultado: str) -> RedirectResponse:
    return RedirectResponse(f"{settings.url_do_front}/settings?tab=profile&email={resultado}",
                            status.HTTP_302_FOUND)


@router.post("/conectar")
async def conectar(usuario: Usuario = Depends(usuario_atual)):
    """Devolve a URL da Microsoft. ⚠️ POST autenticado, e não um link: o JWT
    mora no localStorage e a navegação até a Microsoft não o carrega — quem
    amarra a volta à pessoa é o `state` gravado aqui (só o hash)."""
    async with sessao(role="service_role") as conn:
        if not await contas.bot_com_email_do(conn, usuario.id):
            raise HTTPException(status.HTTP_403_FORBIDDEN,
                                "Seu bot ainda não tem e-mail liberado. Fale com o administrador.")
        state = secrets.token_urlsafe(32)
        await conn.execute(
            "DELETE FROM public.email_oauth_estados WHERE criado_em < now() - interval '1 hour'")
        await conn.execute(
            "INSERT INTO public.email_oauth_estados (state, user_id) VALUES ($1, $2::uuid)",
            _hash(state), usuario.id)
    return {"url": graph.url_autorizacao(state)}


@router.get("/oauth/callback")
async def callback(code: str | None = Query(default=None), state: str | None = Query(default=None),
                   error: str | None = Query(default=None)):
    if error:
        return _voltar("cancelado" if error == "access_denied" else "erro_microsoft")
    if not state:
        return _voltar("erro_estado")
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "DELETE FROM public.email_oauth_estados WHERE state = $1 RETURNING state, user_id::text "
            "AS user_id, criado_em", _hash(state))
    if not linha or datetime.now(timezone.utc) - linha["criado_em"] > VALIDADE_STATE:
        return _voltar("erro_estado")
    if not code:
        return _voltar("erro_microsoft")
    try:
        t = await graph.trocar_code(code)
    except graph.ErroGraph as e:
        logger.error("E-mail: troca do code falhou: %s", e)
        return _voltar("erro_microsoft")
    async with sessao(role="service_role") as conn:
        await contas.guardar_conta(conn, linha["user_id"], t["conta"], t["refresh"])
        await contas.evento(conn, linha["user_id"], None, "conectar", t["conta"])
    logger.info("E-mail conectado para %s", linha["user_id"])
    return _voltar("conectado")


@router.get("/estado")
async def estado(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        bot = await contas.bot_com_email_do(conn, usuario.id)
        conta, extras = await contas.caixas(conn, usuario.id)
    return {"liberado": bool(bot), "bot": bot, "conectado": bool(conta),
            "conta": conta, "caixas": extras}


@router.delete("/conexao", status_code=status.HTTP_204_NO_CONTENT)
async def desconectar(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM public.email_contas WHERE user_id = $1::uuid", usuario.id)
        await contas.evento(conn, usuario.id, None, "desconectar")


class CaixasIn(BaseModel):
    caixas: list[str]


@router.put("/caixas/{user_id}")
async def definir_caixas(user_id: str, dados: CaixasIn,
                         _: Usuario = Depends(exige_papel("administrador"))):
    """Caixas compartilhadas não se descobrem pelo Graph: o admin informa, e só
    entra a que abre com o token do PRÓPRIO dono (leitura de teste)."""
    from app.email.regras import validar_enderecos
    try:
        pedidas = validar_enderecos(dados.caixas, vazio_ok=True)
    except ValueError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    async with sessao(role="service_role") as conn:
        try:
            access, conta = await contas.access_token(conn, user_id)
        except contas.ErroConta as e:
            raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
        aceitas, recusadas = [], []
        for c in pedidas:
            if c != conta.lower() and await graph.conferir_caixa(access, conta, c):
                aceitas.append(c)
            else:
                recusadas.append(c)
        await conn.execute("DELETE FROM public.email_caixas WHERE user_id = $1::uuid", user_id)
        for c in aceitas:
            await conn.execute("INSERT INTO public.email_caixas (user_id, endereco) "
                               "VALUES ($1::uuid, $2)", user_id, c)
    return {"aceitas": aceitas, "recusadas": recusadas}
