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
from app.email.regras import conteudo_do_rascunho, hash_rascunho

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
    return {"url": graph.url_autorizacao(state, login_hint=usuario.email)}


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
        # ⚠️ CSRF de vínculo: A gera o link para si e faz B autorizar. O state é
        # de A, a conta é de B — sem esta checagem o bot de A leria o e-mail de
        # B. Só aceita a conta Microsoft com o MESMO e-mail do usuário do HS.OS.
        meu = await conn.fetchval("SELECT lower(email) FROM public.profiles WHERE id = $1::uuid",
                                  linha["user_id"])
        if not meu or (t["conta"] or "").lower() != meu:
            logger.warning("E-mail: conta Microsoft de outra pessoa recusada para %s",
                           linha["user_id"])
            return _voltar("erro_conta")
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


# ── Aprovação: a única porta de saída para terceiros ─────────────────────────

VALIDADE_PENDENTE = timedelta(hours=24)


async def _pendente_do_dono(conn, pend_id: str, usuario: Usuario) -> dict:
    """404 para quem não é o dono — não confirma que o pendente existe."""
    try:
        linha = await conn.fetchrow(
            "SELECT id::text AS id, user_id::text AS user_id, caixa_de, graph_id, status, erro, "
            "       criado_em FROM public.email_pendentes WHERE id = $1::uuid AND user_id = $2::uuid "
            "   FOR UPDATE",
            pend_id, usuario.id)
    except Exception:  # noqa: BLE001 — id malformado
        linha = None
    if not linha:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "E-mail não encontrado.")
    linha = dict(linha)
    if linha["status"] == "pendente" and datetime.now(timezone.utc) - linha["criado_em"] > VALIDADE_PENDENTE:
        await conn.execute("UPDATE public.email_pendentes SET status = 'vencido', decidido_em = now() "
                           " WHERE id = $1::uuid AND status = 'pendente'", pend_id)
        linha["status"] = "vencido"
    return linha


async def _rascunho(conn, p: dict) -> tuple[str, str, dict]:
    try:
        access, conta = await contas.access_token(conn, p["user_id"])
    except contas.ErroConta as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    try:
        msg = await graph.ler(access, conta, p["caixa_de"], p["graph_id"], texto=True)
    except graph.ErroGraph as e:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "O rascunho não está mais no Outlook (apagado ou movido).") from e
    return access, conta, msg


@router.get("/pendentes/{pend_id}")
async def ver_pendente(pend_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        p = await _pendente_do_dono(conn, pend_id, usuario)
        saida = {"id": p["id"], "status": p["status"], "erro": p["erro"], "de": p["caixa_de"]}
        if p["status"] != "pendente":
            return saida
        _, _, msg = await _rascunho(conn, p)
    return {**saida, **conteudo_do_rascunho(msg), "hash": hash_rascunho(p["caixa_de"], msg)}


class EnviarIn(BaseModel):
    hash: str


@router.post("/pendentes/{pend_id}/enviar")
async def enviar_pendente(pend_id: str, dados: EnviarIn, usuario: Usuario = Depends(usuario_atual)):
    """Envia EXATAMENTE o que o cartão mostrou: relê o rascunho e confere o hash."""
    async with sessao(role="service_role") as conn:
        p = await _pendente_do_dono(conn, pend_id, usuario)
        if p["status"] != "pendente":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Este e-mail já está {p['status']}.")
        access, conta, msg = await _rascunho(conn, p)
        if hash_rascunho(p["caixa_de"], msg) != dados.hash:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "O rascunho mudou desde que você abriu. Revise antes de enviar.")
        c = conteudo_do_rascunho(msg)
        try:
            await graph.enviar_rascunho(access, conta, p["caixa_de"], p["graph_id"])
        except graph.ErroGraph as e:
            await conn.execute("UPDATE public.email_pendentes SET status = 'erro', erro = $2, "
                               "decidido_em = now() WHERE id = $1::uuid AND status = 'pendente'",
                               pend_id, str(e)[:300])
            await contas.evento(conn, p["user_id"], None, "enviar_erro", p["caixa_de"], p["graph_id"])
            raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"A Microsoft recusou o envio: {e}") from e
        await conn.execute("UPDATE public.email_pendentes SET status = 'enviado', decidido_em = now() "
                           " WHERE id = $1::uuid AND status = 'pendente'", pend_id)
        await contas.evento(conn, p["user_id"], None, "enviar", p["caixa_de"], p["graph_id"],
                            [*c["para"], *c["cc"]])
    return {"status": "enviado"}


@router.post("/pendentes/{pend_id}/descartar")
async def descartar_pendente(pend_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        p = await _pendente_do_dono(conn, pend_id, usuario)
        if p["status"] != "pendente":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Este e-mail já está {p['status']}.")
        try:
            access, conta = await contas.access_token(conn, p["user_id"])
            await graph.apagar(access, conta, p["caixa_de"], p["graph_id"])
        except (contas.ErroConta, graph.ErroGraph) as e:
            logger.warning("Descartar %s: rascunho não apagado no Outlook: %s", pend_id, e)
        await conn.execute("UPDATE public.email_pendentes SET status = 'descartado', "
                           "decidido_em = now() WHERE id = $1::uuid", pend_id)
        await contas.evento(conn, p["user_id"], None, "descartar", p["caixa_de"], p["graph_id"])
    return {"status": "descartado"}
