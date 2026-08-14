"""Schemas compartilhados pelos routers de domínio."""

from pydantic import BaseModel, Field


class BrandingIn(BaseModel):
    """Todos os campos são obrigatórios: a tela de branding manda o objeto
    inteiro, não um patch. Assim não há como um campo sumir por omissão."""

    company_name: str = Field(min_length=1, max_length=120)
    # HSL no formato "H S% L%" — é como o CSS custom property --primary espera.
    primary_color: str = Field(min_length=1, max_length=40)
    logo: str = ""
    logo_light: str = ""
    logo_dark: str = ""
    mark_light: str = ""
    mark_dark: str = ""
    favicon_url: str = ""
    pwa_icon_url: str = ""


class BrandingOut(BrandingIn):
    pass


class PerfilOut(BaseModel):
    id: str
    email: str
    full_name: str | None = None
    avatar_url: str | None = None
    status: str = "active"
    # O papel vem junto porque a tela de usuários montava isso com uma segunda
    # consulta a `user_roles` e um mapa no cliente. Quando alguém tem mais de uma
    # linha lá, vale o mais alto — a regra de prioridade que o front aplicava.
    role: str = "sem_papel"
    # Presença e status personalizado: a lista de pessoas do chat deriva o
    # pontinho de online/ausente a partir de last_seen_at.
    last_seen_at: str | None = None
    custom_status: str | None = None
    custom_status_emoji: str | None = None
    custom_status_set_at: str | None = None


class PerfilPatch(BaseModel):
    """Só o que o próprio usuário edita. E-mail e status ficam de fora: mudar
    e-mail mexe na identidade (auth.users) e status é decisão administrativa."""

    full_name: str | None = Field(default=None, min_length=1, max_length=200)
    avatar_url: str | None = Field(default=None, max_length=2000)
    # Status personalizado ("em reunião ☕"). Entra aqui e não numa rota própria
    # porque é o mesmo gesto — a pessoa editando o próprio perfil.
    custom_status: str | None = Field(default=None, max_length=200)
    custom_status_emoji: str | None = Field(default=None, max_length=16)
