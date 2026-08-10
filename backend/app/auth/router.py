"""Autenticação — substitui o `supabase.auth` e a edge function bootstrap-first-admin.

Uma conta é composta por três linhas, em três tabelas:
  auth.users        identidade (e-mail, hash da senha) — alvo de 11 FKs
  public.profiles   perfil (nome, avatar, status)
  public.user_roles papel (super_admin | member | user)
Elas são criadas juntas, na mesma transação.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth.schemas import (
    BootstrapIn,
    LoginIn,
    StatusInstalacaoOut,
    TokenOut,
    UsuarioOut,
)
from pydantic import BaseModel, Field

from app.auth.security import conferir_senha, emitir_token, gerar_hash
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
    """Cria o primeiro super_admin. Só funciona com o banco sem nenhum usuário."""
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
            "INSERT INTO public.user_roles (user_id, role) VALUES ($1, 'super_admin')",
            user_id,
        )

    logger.info("Primeiro administrador criado: %s", dados.email)
    token, expira = emitir_token(str(user_id), "super_admin", dados.email)
    return TokenOut(access_token=token, expires_in=expira)


@router.post("/login", response_model=TokenOut)
async def login(dados: LoginIn):
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """
            SELECT u.id::text AS id, u.email, u.password_hash, u.is_active,
                   COALESCE(r.role::text, 'user') AS papel
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

    **Exigir a senha atual não é burocracia:** o token fica no navegador, e sem
    esta conferência quem sentasse numa máquina destravada trocaria a senha e
    tomaria a conta. O Supabase Auth não pedia — e essa era uma fragilidade
    herdada, não uma decisão.

    Mínimo de 8 caracteres. Não há regra de maiúscula ou símbolo de propósito:
    comprimento é o que mede força, e regra de composição só empurra a pessoa
    para "Senha@123".
    """
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
