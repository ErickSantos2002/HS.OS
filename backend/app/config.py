from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    # Postgres próprio (VPS). Substitui o banco do Supabase.
    # Vazio por enquanto: o schema ainda vive no Supabase remoto. Sem ele a API
    # sobe mesmo assim e os endpoints de dados respondem 503.
    DATABASE_URL: str = ""

    # Auth própria — substitui supabase.auth
    JWT_SECRET: str = "dev-only-trocar-em-producao"
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24

    FRONTEND_URL: str = "http://localhost:8080"

    # Uploads — substitui supabase.storage. Em produção, volume persistente.
    UPLOADS_DIR: str = "/app/uploads"

    # OpenClaw Gateway (VPS). O token NUNCA vai para o browser: toda chamada
    # ao gateway passa por este backend. Fallback para a tabela vps_config,
    # como já fazia a edge function _shared/gateway-config.ts.
    OPENCLAW_GATEWAY_URL: str = ""
    OPENCLAW_ADMIN_TOKEN: str = ""


settings = Settings()
