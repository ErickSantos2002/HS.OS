"""Autenticação — substitui o `supabase.auth` e a edge function bootstrap-first-admin.

Uma conta é composta por três linhas, em três tabelas:
  auth.users        identidade (e-mail, hash da senha) — alvo de 11 FKs
  public.profiles   perfil (nome, avatar, status)
  public.user_roles papel (administrador | member | user)
Elas são criadas juntas, na mesma transação.
"""

import logging
import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import RedirectResponse

from app.auth.schemas import (
    BootstrapIn,
    LoginIn,
    StatusInstalacaoOut,
    TokenOut,
    UsuarioOut,
)
from pydantic import BaseModel, Field

from app.auth import microsoft, sso
from app.auth.security import conferir_senha, emitir_token, gerar_hash
from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/auth", tags=["auth"])


@router.get("/status", response_model=StatusInstalacaoOut)
async def status_instalacao():
    """Instalação zerada não tem usuário e não há cadastro público — só convite,
    que exige um admin que ainda não existe. A tela de login usa isto para
    oferecer a criação do primeiro administrador."""
    async with sessao(role="service_role") as conn:
        total = await conn.fetchval("SELECT count(*) FROM auth.users")
    return StatusInstalacaoOut(precisa_bootstrap=(total == 0), total_usuarios=total)


@router.post("/bootstrap-admin", response_model=TokenOut, status_code=status.HTTP_201_CREATED)
async def bootstrap_admin(dados: BootstrapIn):
    """Cria o primeiro administrador. Só funciona com o banco sem nenhum usuário."""
    senha_hash = gerar_hash(dados.senha)

    async with sessao(role="service_role") as conn:
        # Trava a tabela para que duas chamadas simultâneas não criem dois
        # "primeiros" admins. A transação da sessão garante a liberação.
        await conn.execute("LOCK TABLE auth.users IN EXCLUSIVE MODE")

        if await conn.fetchval("SELECT count(*) FROM auth.users") > 0:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Esta instalação já tem usuários. Peça um convite a um administrador.",
            )

        user_id = await conn.fetchval(
            """
            INSERT INTO auth.users (email, password_hash, email_confirmed_at, last_sign_in_at)
            VALUES ($1, $2, now(), now())
            RETURNING id
            """,
            dados.email,
            senha_hash,
        )
        await conn.execute(
            "INSERT INTO public.profiles (id, email, full_name) VALUES ($1, $2, $3)",
            user_id,
            dados.email,
            dados.nome,
        )
        await conn.execute(
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'administrador')",
            user_id,
        )

    logger.info("Primeiro administrador criado: %s", dados.email)
    token, expira = emitir_token(str(user_id), "administrador", dados.email)
    return TokenOut(access_token=token, expires_in=expira)


@router.post("/login", response_model=TokenOut)
async def login(dados: LoginIn):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """
            SELECT u.id::text AS id, u.email, u.password_hash, u.is_active,
                   COALESCE(r.role::text, 'sem_papel') AS papel
            FROM auth.users u
            LEFT JOIN public.user_roles r ON r.user_id = u.id
            WHERE lower(u.email) = lower($1)
            """,
            dados.email,
        )

        # Mensagem única para e-mail inexistente e senha errada: dizer qual dos
        # dois falhou entrega a existência da conta a quem está tentando adivinhar.
        if linha is None or not conferir_senha(dados.senha, linha["password_hash"]):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "E-mail ou senha inválidos.")
        if not linha["is_active"]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")

        await conn.execute(
            "UPDATE auth.users SET last_sign_in_at = now() WHERE id = $1::uuid", linha["id"]
        )

    token, expira = emitir_token(linha["id"], linha["papel"], linha["email"])
    return TokenOut(access_token=token, expires_in=expira)


@router.get("/me", response_model=UsuarioOut)
async def eu(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        avatar = await conn.fetchval(
            "SELECT avatar_url FROM public.profiles WHERE id = $1::uuid", usuario.id
        )
    return UsuarioOut(
        id=usuario.id,
        email=usuario.email,
        nome=usuario.nome,
        papel=usuario.papel,
        avatar_url=avatar,
    )


class TrocaSenhaIn(BaseModel):
    senha_atual: str = Field(min_length=1)
    senha_nova: str = Field(min_length=8, max_length=200)


@router.post("/trocar-senha", status_code=status.HTTP_204_NO_CONTENT)
async def trocar_senha(dados: TrocaSenhaIn, usuario: Usuario = Depends(usuario_atual)):
    """Troca a própria senha, conferindo a atual antes.

    ⚠️ **Só `administrador` chega aqui.** Decisão do Erick em 14/08/2026: a
    Health & Safety é empresa fechada e as pessoas entram pelo **FortiPAM**, que
    guarda a credencial de cada uma. Quem define senha de colaborador é o
    administrador, por `POST /profiles/{id}/senha`. Se o colaborador trocasse a
    própria senha por aqui, o cofre passaria a guardar uma senha que não abre
    mais nada — e quem descobre é a pessoa, no pior momento.

    Não é regra de segurança genérica; é o desenho de acesso desta empresa. Numa
    instalação sem cofre, soltar esta rota para todo mundo seria o certo.

    **Exigir a senha atual não é burocracia:** o token fica no navegador, e sem
    esta conferência quem sentasse numa máquina destravada trocaria a senha e
    tomaria a conta. O Supabase Auth não pedia — e essa era uma fragilidade
    herdada, não uma decisão.

    Mínimo de 8 caracteres. Não há regra de maiúscula ou símbolo de propósito:
    comprimento é o que mede força, e regra de composição só empurra a pessoa
    para "Senha@123".
    """
    # A recusa é por papel, mas com mensagem própria em vez do genérico
    # "permissão insuficiente" do `exige_papel`: quem esbarra aqui está diante
    # de um campo de senha, e precisa saber para onde ir, não que foi barrado.
    if usuario.papel != "administrador":
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Sua senha é gerenciada pelo TI e fica guardada no FortiPAM. "
            "Para trocá-la, fale com o administrador.",
        )

    async with sessao(role="service_role") as conn:
        atual = await conn.fetchval(
            "SELECT password_hash FROM auth.users WHERE id = $1::uuid", usuario.id
        )
        if not conferir_senha(dados.senha_atual, atual):
            raise HTTPException(status.HTTP_403_FORBIDDEN, "A senha atual está incorreta.")
        await conn.execute(
            "UPDATE auth.users SET password_hash = $2, updated_at = now() "
            " WHERE id = $1::uuid",
            usuario.id, gerar_hash(dados.senha_nova),
        )
        # Trocar a senha ativa o perfil. Quem entra por convite do admin nasce
        # com `status='pending'` e uma senha temporária, e o `ProtectedRoute`
        # o manda para a tela de definir senha até que isso mude. Era a edge
        # de reset que virava a chave (`profiles.status = 'active'`); do lado
        # de cá é o mesmo ato, na mesma transação — antes dava para sair da
        # tela com a senha nova e o perfil ainda pendente, e voltar a cair
        # nela no login seguinte.
        await conn.execute(
            "UPDATE public.profiles SET status = 'active', updated_at = now() "
            " WHERE id = $1::uuid AND status IS DISTINCT FROM 'active'",
            usuario.id,
        )
    logger.info("Senha trocada por %s", usuario.id)


# ─────────────────────────────────────────────────────────────────────────────
# Login com Microsoft (Entra ID)
# ─────────────────────────────────────────────────────────────────────────────
# Desenho do DataCoreHS (spec 2026-09-24 de lá), já testado em produção:
#
#   tela ─(navegação)─▶ GET /auth/microsoft          state no cookie, 302 Microsoft
#   Microsoft ────────▶ GET /auth/microsoft/callback confere state, lê o e-mail,
#                                                    grava ticket, 302 para o front
#   front /auth/callback ─▶ POST /auth/sso/exchange  ticket → o mesmo token do /login
#
# ⚠️ **Não cria conta no primeiro acesso.** Quem entra é quem já tem usuário
# aqui com o mesmo e-mail; o tenant inteiro da HS não ganha acesso aos agentes.
# Desativar a pessoa no HS.OS continua sendo o que corta o acesso — desativar
# no Entra só impede logins novos, e o token já emitido vale até vencer.
#
# Qualquer falha no callback vira `302 → <front>/login?erro_sso=<código>`.

COOKIE_STATE = "sso_state"
CAMINHO_COOKIE = "/auth/microsoft"  # cobre também /auth/microsoft/callback
TICKET_INVALIDO = "Link de acesso inválido ou expirado."


def _para_o_front(caminho: str) -> RedirectResponse:
    return RedirectResponse(f"{settings.url_do_front}{caminho}", status_code=302)


def _erro_sso(codigo: str) -> RedirectResponse:
    return _para_o_front(f"/login?erro_sso={codigo}")


class SsoStatusOut(BaseModel):
    ativo: bool


class TicketIn(BaseModel):
    ticket: str = Field(min_length=1, max_length=200)


@router.get("/sso/status", response_model=SsoStatusOut)
async def sso_status():
    """A tela mostra o botão "Entrar com Microsoft" só com `ativo: true`."""
    return SsoStatusOut(ativo=settings.sso_ativo)


@router.get("/microsoft")
async def iniciar_login_microsoft():
    if not settings.sso_ativo:
        if not settings.url_do_front:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Login com Microsoft desligado.")
        return _erro_sso("sso_desligado")
    state = secrets.token_urlsafe(32)
    resposta = RedirectResponse(microsoft.url_de_autorizacao(state), status_code=302)
    # O `state` impede login CSRF: sem ele, alguém com conta poderia mandar um
    # link que faz OUTRA pessoa entrar na conta dele. `Lax` basta — a volta da
    # Microsoft é navegação de topo com GET, e nela o cookie vai junto.
    resposta.set_cookie(
        COOKIE_STATE, state,
        max_age=600, path=CAMINHO_COOKIE, httponly=True, samesite="lax",
        secure=settings.MS_REDIRECT_URI.startswith("https://"),
    )
    return resposta


async def _resultado_do_callback(
    code: str | None, state: str | None, error: str | None, cookie: str | None,
) -> RedirectResponse:
    if not settings.sso_ativo:
        return _erro_sso("sso_desligado")
    # `compare_digest` sobre `str` levanta TypeError com caractere não ASCII, e o
    # `state` vem da query string — seria um 500 esperando acontecer. Em bytes, não.
    if not state or not cookie or not secrets.compare_digest(state.encode(), cookie.encode()):
        return _erro_sso("state_invalido")
    if error == "access_denied":
        return _erro_sso("cancelado")
    if error or not code:
        logger.warning("SSO: a Microsoft devolveu erro %r", error)
        return _erro_sso("falha_microsoft")

    try:
        email_cru = await microsoft.email_do_usuario(await microsoft.trocar_code_por_token(code))
    except microsoft.ErroMicrosoft as erro:
        logger.warning("SSO: %s", erro)
        return _erro_sso("falha_microsoft")

    email = (email_cru or "").strip().lower()
    conta = await sso.buscar_conta(email) if "@" in email else None
    if conta is None:
        logger.info("SSO: conta Microsoft sem usuário no HS.OS: %s", email or "(sem e-mail)")
        return _erro_sso("usuario_nao_encontrado")
    if not conta["is_active"]:
        return _erro_sso("conta_desativada")

    ticket = await sso.emitir_ticket(conta["id"])
    return _para_o_front(f"/auth/callback?ticket={ticket}")


@router.get("/microsoft/callback")
async def callback_microsoft(
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
):
    resposta = await _resultado_do_callback(code, state, error, request.cookies.get(COOKIE_STATE))
    resposta.delete_cookie(COOKIE_STATE, path=CAMINHO_COOKIE)
    return resposta


@router.post("/sso/exchange", response_model=TokenOut)
async def trocar_ticket(dados: TicketIn):
    """O front troca o ticket do callback pelo mesmo token do `/auth/login`."""
    user_id = await sso.resgatar_ticket(dados.ticket)
    conta = await sso.conta_por_id(user_id) if user_id else None
    if conta is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, TICKET_INVALIDO)
    # Relida aqui, não confiada ao callback: entre os dois cabe uma desativação.
    if not conta["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")
    await sso.registrar_entrada(conta["id"])
    token, expira = emitir_token(conta["id"], conta["papel"], conta["email"])
    logger.info("SSO: %s entrou com a Microsoft", conta["email"])
    return TokenOut(access_token=token, expires_in=expira)
