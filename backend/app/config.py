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

    # Login com Microsoft (Entra ID) — registro de aplicativo "HS.OS", single
    # tenant. Com qualquer um vazio o SSO fica desligado: a API sobe normal, o
    # `/auth/sso/status` diz `ativo: false` e a tela esconde o botão. O desenho é
    # o do DataCoreHS (spec 2026-09-24 de lá); ver `app/auth/microsoft.py`.
    # Para onde a pessoa volta depois do login: a PRIMEIRA origem do FRONTEND_URL.
    MS_TENANT_ID: str = ""
    MS_CLIENT_ID: str = ""
    MS_CLIENT_SECRET: str = ""
    MS_REDIRECT_URI: str = ""

    # ⚠️ NÃO É MAIS USADO — o storage foi para o R2 em 13/10/2026. Continua
    # declarado só porque o pydantic-settings recusa chave desconhecida no
    # `.env` e derrubaria o boot de quem ainda a tem. Remover depois que sair
    # do EasyPanel e dos `.env`.
    UPLOADS_DIR: str = "/app/uploads"

    # Cloudflare R2 — onde todo arquivo mora. API compatível com S3. Sem as
    # quatro, a API sobe e as rotas de arquivo respondem 503.
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET: str = ""

    # OpenAI — usada pela plataforma **fora** do caminho dos agentes: transcrever
    # áudio, ler imagem colada no chat e extrair o perfil da empresa. Os agentes
    # não passam por aqui; eles usam o provedor configurado no OpenClaw.
    #
    # ⚠️ Precisa estar declarada mesmo sendo lida pelo `ler_segredo`: o
    # pydantic-settings recusa chave desconhecida no `.env` e derruba o boot
    # inteiro. Foi o que aconteceu em 10/08/2026.
    OPENAI_API_KEY: str = ""

    # Web Push. O par é gerado localmente e não custa nada; sem ele o envio
    # responde 503 e a tela não oferece notificação.
    VAPID_PUBLIC_KEY: str = ""
    VAPID_PRIVATE_KEY: str = ""
    VAPID_SUBJECT: str = ""

    # OpenClaw Gateway (VPS). O token NUNCA vai para o browser: toda chamada
    # ao gateway passa por este backend. Fallback para a tabela vps_config,
    # como já fazia a edge function _shared/gateway-config.ts.
    OPENCLAW_GATEWAY_URL: str = ""
    OPENCLAW_ADMIN_TOKEN: str = ""

    # Segredo compartilhado com os servidores MCP que o gateway consome
    # (`/mcp/alerta` e `/mcp/wiki`), conferido no header `X-Bridge-Token`.
    #
    # ⚠️ **Declarada aqui pelo mesmo motivo da OPENAI_API_KEY acima, e a
    # armadilha pegou de novo.** Em 17/08/2026 pedi que ela fosse posta no `.env`
    # para o `/mcp/*` funcionar em desenvolvimento, sem declará-la — e o backend
    # local parou de subir. O sintoma engana: em produção não há arquivo `.env`
    # (o EasyPanel injeta variáveis de ambiente), então lá nada quebrou, e a
    # única máquina afetada foi a de desenvolvimento.
    #
    # O erro do pydantic nomeia a chave, mas **imprime o valor junto** — se for
    # colado em algum lugar, é o segredo indo com ele.
    GUARDRAILS_API_TOKEN: str = ""

    @property
    def url_do_front(self) -> str:
        """A primeira origem do FRONTEND_URL — que também é lista do CORS."""
        origens = [o.strip().rstrip("/") for o in self.FRONTEND_URL.split(",") if o.strip()]
        return origens[0] if origens else ""

    @property
    def sso_ativo(self) -> bool:
        # Tenant genérico abriria o login a QUALQUER conta Microsoft do mundo,
        # e o e-mail delas não é controlado por nós. Só o tenant da HS liga.
        if self.MS_TENANT_ID.strip().lower() in ("common", "organizations", "consumers"):
            return False
        return all((
            self.MS_TENANT_ID, self.MS_CLIENT_ID, self.MS_CLIENT_SECRET,
            self.MS_REDIRECT_URI, self.url_do_front,
        ))


settings = Settings()
