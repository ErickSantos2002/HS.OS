from pydantic import BaseModel, EmailStr, Field

from app.auth.security import LIMITE_SENHA_BYTES


class LoginIn(BaseModel):
    email: EmailStr
    senha: str = Field(min_length=1, max_length=LIMITE_SENHA_BYTES)


class BootstrapIn(BaseModel):
    """Criação do primeiro administrador. Só aceita numa instalação zerada."""

    email: EmailStr
    senha: str = Field(min_length=8, max_length=LIMITE_SENHA_BYTES)
    nome: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int


class UsuarioOut(BaseModel):
    id: str
    email: str
    nome: str | None = None
    papel: str
    avatar_url: str | None = None


class StatusInstalacaoOut(BaseModel):
    """Consumido pela tela de login para decidir entre entrar e criar o 1º admin."""

    precisa_bootstrap: bool
    total_usuarios: int
