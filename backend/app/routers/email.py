"""E-mail dos bots pessoais: conectar a conta, caixas e aprovação de envio.

Spec: docs/superpowers/specs/2026-11-05-bot-email-piloto-design.md.
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.email import contas, graph
from app.email.regras import anexos_extras, conteudo_do_rascunho, hash_rascunho

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
    # As caixas compartilhadas que o admin previu para a pessoa: conferidas
    # agora, com o token dela. Falha aqui não desfaz a conexão.
    try:
        await contas.conferir_previstas(linha["user_id"], t["access"], t["conta"])
    except Exception:  # noqa: BLE001
        logger.exception("Caixas previstas não conferidas para %s", linha["user_id"])
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
        # A lista do admin passa a ser esta: as previstas antigas não voltam.
        await conn.execute("DELETE FROM public.email_caixas_previstas WHERE user_id = $1::uuid", user_id)
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
            "       criado_em, assinatura FROM public.email_pendentes WHERE id = $1::uuid AND user_id = $2::uuid "
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
        anexos = (await graph.listar_anexos(access, conta, p["caixa_de"], p["graph_id"]))
    except graph.ErroGraph as e:
        raise HTTPException(status.HTTP_409_CONFLICT,
                            "O rascunho não está mais no Outlook (apagado ou movido).") from e
    return access, conta, msg, anexos


@router.get("/pendentes/{pend_id}")
async def ver_pendente(pend_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        p = await _pendente_do_dono(conn, pend_id, usuario)
        saida = {"id": p["id"], "status": p["status"], "erro": p["erro"], "de": p["caixa_de"],
                 "assinatura": bool(p.get("assinatura"))}
        if p["status"] != "pendente":
            return saida
        _, _, msg, anexos = await _rascunho(conn, p)
    return {**saida, **conteudo_do_rascunho(msg, anexos),
            "hash": hash_rascunho(p["caixa_de"], msg, anexos)}


class EnviarIn(BaseModel):
    hash: str


@router.post("/pendentes/{pend_id}/enviar")
async def enviar_pendente(pend_id: str, dados: EnviarIn, usuario: Usuario = Depends(usuario_atual)):
    """Envia EXATAMENTE o que o cartão mostrou: relê o rascunho e confere o hash."""
    async with sessao(role="service_role") as conn:
        p = await _pendente_do_dono(conn, pend_id, usuario)
        if p["status"] != "pendente":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Este e-mail já está {p['status']}.")
        access, conta, msg, anexos = await _rascunho(conn, p)
        if hash_rascunho(p["caixa_de"], msg, anexos) != dados.hash:
            raise HTTPException(status.HTTP_409_CONFLICT,
                                "O rascunho mudou desde que você abriu. Revise antes de enviar.")
        c = conteudo_do_rascunho(msg, anexos)
        # ⚠️ O 502 sai FORA da transação: dentro dela o rollback desfazia o
        # 'erro' e o e-mail voltava a 'pendente' (revisão de segurança).
        falha: str | None = None
        try:
            await graph.enviar_rascunho(access, conta, p["caixa_de"], p["graph_id"])
        except graph.ErroGraph as e:
            falha = f"A Microsoft recusou o envio: {e}"
        except Exception as e:  # noqa: BLE001
            logger.exception("Envio %s falhou", pend_id)
            falha = f"Falha ao enviar ({type(e).__name__})"
        if falha:
            await conn.execute("UPDATE public.email_pendentes SET status = 'erro', erro = $2, "
                               "decidido_em = now() WHERE id = $1::uuid AND status = 'pendente'",
                               pend_id, falha[:300])
            await contas.evento(conn, p["user_id"], None, "enviar_erro", p["caixa_de"], p["graph_id"])
        else:
            await conn.execute("UPDATE public.email_pendentes SET status = 'enviado', decidido_em = now() "
                               " WHERE id = $1::uuid AND status = 'pendente'", pend_id)
            await contas.evento(conn, p["user_id"], None, "enviar", p["caixa_de"], p["graph_id"],
                                [*c["para"], *c["cc"]])
    if falha:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, falha)
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


# ── Assinatura de e-mail (Perfil) — modelo do HSGrowth ───────────────────────

from app.email import assinatura as ass_mod  # noqa: E402


class AssinaturaTextoIn(BaseModel):
    texto_antes: str = ""
    texto_depois: str = ""


@router.get("/assinatura")
async def ver_assinatura(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow("SELECT texto_antes, texto_depois FROM public.email_assinaturas "
                                    " WHERE user_id = $1::uuid", usuario.id)
        imgs = await conn.fetch("SELECT ordem, mime, nome, length(dados) AS tamanho "
                                "  FROM public.email_assinatura_imagens WHERE user_id = $1::uuid "
                                " ORDER BY ordem", usuario.id)
    # Campo vazio ou nunca salvo já vem com o padrão da empresa preenchido.
    antes, depois = ass_mod.textos(linha)
    return {"texto_antes": antes, "texto_depois": depois,
            "imagens": [dict(i) for i in imgs]}


@router.put("/assinatura")
async def salvar_texto_assinatura(dados: AssinaturaTextoIn, usuario: Usuario = Depends(usuario_atual)):
    if len(dados.texto_antes) > 1000 or len(dados.texto_depois) > 3000:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Texto da assinatura longo demais.")
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "INSERT INTO public.email_assinaturas (user_id, texto_antes, texto_depois) VALUES ($1::uuid, $2, $3) "
            "ON CONFLICT (user_id) DO UPDATE SET texto_antes = EXCLUDED.texto_antes, "
            "texto_depois = EXCLUDED.texto_depois, atualizado_em = now()",
            usuario.id, dados.texto_antes, dados.texto_depois)
    return {"ok": True}


@router.post("/assinatura/imagem/{ordem}")
async def enviar_imagem_assinatura(ordem: int, arquivo: UploadFile = File(...),
                                   usuario: Usuario = Depends(usuario_atual)):
    if ordem not in (1, 2):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Só cabem duas imagens (1 e 2).")
    dados = await arquivo.read()
    mime = (arquivo.content_type or "").lower()
    async with sessao(role="service_role") as conn:
        outras = await conn.fetchval(
            "SELECT COALESCE(sum(length(dados)), 0) FROM public.email_assinatura_imagens "
            " WHERE user_id = $1::uuid AND ordem <> $2", usuario.id, ordem) or 0
        try:
            ass_mod.validar_imagem(mime, len(dados), int(outras))
        except ValueError as e:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        await conn.execute(
            "INSERT INTO public.email_assinatura_imagens (user_id, ordem, mime, nome, dados) "
            "VALUES ($1::uuid, $2, $3, $4, $5) ON CONFLICT (user_id, ordem) DO UPDATE SET "
            "mime = EXCLUDED.mime, nome = EXCLUDED.nome, dados = EXCLUDED.dados",
            usuario.id, ordem, mime, (arquivo.filename or f"assinatura-{ordem}")[:120], dados)
    return {"ok": True}


@router.get("/assinatura/imagem/{ordem}")
async def ver_imagem_assinatura(ordem: int, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        i = await conn.fetchrow("SELECT mime, dados FROM public.email_assinatura_imagens "
                                " WHERE user_id = $1::uuid AND ordem = $2", usuario.id, ordem)
    if not i:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sem imagem.")
    return Response(content=bytes(i["dados"]), media_type=i["mime"])


@router.delete("/assinatura/imagem/{ordem}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_imagem_assinatura(ordem: int, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        await conn.execute("DELETE FROM public.email_assinatura_imagens WHERE user_id = $1::uuid "
                           "AND ordem = $2", usuario.id, ordem)
