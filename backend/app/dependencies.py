"""Dependências compartilhadas dos endpoints.

Aqui mora a autorização da aplicação. O RLS do banco é a segunda linha de
defesa, não a primeira: as policies dependem de `auth.uid()`, que só é
preenchido porque `database.sessao()` emite o `SET LOCAL`. Endpoint que não
depender de `usuario_atual` roda como `anon` e não enxerga dado de ninguém.

Papéis (tabela `public.user_roles`, enum `app_role`): administrador, member, user.
"""

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.security import ler_token
from app.database import sessao

# auto_error=False: sem header a gente devolve a própria mensagem, em português,
# em vez do 403 genérico do FastAPI.
_bearer = HTTPBearer(auto_error=False)


class Usuario:
    def __init__(self, id: str, email: str, papel: str, nome: str | None = None):
        self.id = id
        self.email = email
        self.papel = papel
        self.nome = nome

    def __repr__(self) -> str:  # facilita log e depuração
        return f"Usuario({self.email}, papel={self.papel})"


async def usuario_atual(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Usuario:
    if cred is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Autenticação necessária.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        dados = ler_token(cred.credentials)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido.")

    user_id = dados.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token sem identificação de usuário.")

    # O papel é relido do banco a cada request, não confiado ao token: revogar
    # um administrador precisa valer na hora, sem esperar o token expirar.
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """
            SELECT u.id::text AS id, u.email, u.is_active, p.full_name,
                   COALESCE(r.role::text, 'sem_papel') AS papel
            FROM auth.users u
            LEFT JOIN public.profiles   p ON p.id = u.id
            LEFT JOIN public.user_roles r ON r.user_id = u.id
            WHERE u.id = $1::uuid
            """,
            user_id,
        )

    if linha is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Usuário não existe mais.")
    if not linha["is_active"]:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Conta desativada.")

    return Usuario(
        id=linha["id"], email=linha["email"], papel=linha["papel"], nome=linha["full_name"]
    )


def exige_papel(*papeis: str):
    """Guard de papel — equivalente ao `allowedRoles` do ProtectedRoute no front."""

    async def _guard(usuario: Usuario = Depends(usuario_atual)) -> Usuario:
        if usuario.papel not in papeis:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Permissão insuficiente para esta operação.",
            )
        return usuario

    return _guard
