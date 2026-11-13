from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8")

    @property
    def redirect_email(self) -> str:
        if self.MS_EMAIL_REDIRECT_URI:
            return self.MS_EMAIL_REDIRECT_URI
        return self.MS_REDIRECT_URI.replace("/auth/microsoft/callback", "/email/oauth/callback")

    # Postgres próprio (VPS). Substitui o banco do Supabase.
    # Vazio por enquanto: o schema ainda vive no Supabase remoto. Sem ele a API
    # sobe mesmo assim e os endpoints de dados respondem 503.
    DATABASE_URL: str = ""

    # Auth própria — substitui supabase.auth
    JWT_SECRET: str = "dev-only-trocar-em-producao"
    JWT_ALGORITHM: str = "HS256"
    # Uma semana (decisão do Erick, 30/10/2026): com 24 h o time reclamava de
    # cair todo dia. Produção define a env no EasyPanel — mude lá também.
    JWT_EXPIRE_HOURS: int = 168

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

    # E-mail dos bots pessoais (spec 2026-11-05-bot-email-piloto) — reaproveita
    # o app do login acima, com escopos de e-mail pedidos SÓ no "Conectar
    # e-mail". O redirect vazio deriva do `MS_REDIRECT_URI`; no `.env` local
    # aponta para o localhost. A chave Fernet cifra o refresh token e TEM que
    # ser a mesma em todo lugar que lê a `email_contas` — perdida, todo mundo
    # reconecta.
    MS_EMAIL_REDIRECT_URI: str = ""
    EMAIL_CHAVE_CIFRA: str = ""

    # Token de agente (spec 2026-11-05-bot-sistemas-internos): chave Ed25519
    # PRIVADA, PEM com "\n" escapado. Assina o JWT de 5 min com que o bot
    # pessoal chama TaskHS/GestorHS como a pessoa. ⚠️ Abre esses sistemas como
    # qualquer colaborador — está também no `.env` local por decisão do Erick.
    AGENTE_CHAVE_PRIVADA: str = ""
    # Segredo do HMAC das entradas MCP por agente (anexos, e-mail, bot). Em
    # produção chega pelo EasyPanel e é lido por `ler_segredo`; declarado aqui
    # porque o `.env` local também o tem (o `publicar-bots-mcp.py` precisa) e o
    # pydantic-settings recusa chave desconhecida — mostrando o valor no erro.
    ANEXOS_MCP_SEGREDO: str = ""
    TASKHS_API_URL: str = "https://taskhsapi.healthsafetytech.com/api"
    DATACORE_API_URL: str = "https://tinyapi.healthsafetytech.com"
    # O front do DocsHS; a API é `DOCSHS_URL + "/api/v1"` (o nginx de lá repassa).
    # Também é a base dos links que o Guardi entrega (`/documentos/<id>`).
    DOCSHS_URL: str = "https://docshs.healthsafetytech.com"
    # TalentHS (RH): a API tem domínio próprio, sem prefixo. Spec 2026-11-13-guardi-talenths.
    TALENTHS_API_URL: str = "https://talenthsapi.healthsafetytech.com"
    # GestorHS: DUAS URLs, ao contrário do DocsHS. A API (chamadas, sem prefixo)
    # e o front (só a base dos links `/app/...` que o Guardi entrega). Trocar
    # uma pela outra quebra os links ou faz a chamada receber o HTML da SPA.
    GESTORHS_API_URL: str = "https://gestorhsapi.healthsafetytech.com"
    GESTORHS_URL: str = "https://gestorhs.healthsafetytech.com"
    # HSGrowth (CRM): também DUAS URLs. A API (com prefixo /api/v1) e o front, que
    # só serve de base dos links `/cards/<id>` que o Guardi entrega.
    HSGROWTH_API_URL: str = "https://growthhsapi.healthsafetytech.com/api/v1"
    HSGROWTH_URL: str = "https://hsgrowth.healthsafetytech.com"

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

    # DeepSeek — resume a resposta do agente para o áudio (`app/voz.py`). Os
    # agentes não passam por aqui; usam o provedor do OpenClaw. Declarada pelo
    # mesmo motivo da OPENAI_API_KEY: chave desconhecida no `.env` derruba o boot.
    DEEPSEEK_API_KEY: str = ""

    # Giphy — busca do seletor de GIF (`app/routers/gifs.py`). Declarada pelo
    # mesmo motivo: chave desconhecida no `.env` derruba o boot.
    GIPHY_API_KEY: str = ""

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

    # EscritorioHS (WorkAdventure) — Admin API e presença. Spec:
    # `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`.
    # Os dois tokens são segredo, lidos por `ler_segredo`; declarados aqui pelo
    # mesmo motivo da OPENAI_API_KEY (chave desconhecida no `.env` derruba o boot).
    # O ADMIN_API_TOKEN do `play`: o WA o manda cru no `Authorization`.
    ESCRITORIO_ADMIN_API_TOKEN: str = ""
    # O ADMIN_SOCKETS_TOKEN do `play`: assina o JWT do `/ws/admin/rooms` (presença).
    ESCRITORIO_ADMIN_SOCKETS_TOKEN: str = ""
    # E-mails por vírgula: quem edita o mapa (substitui o MAP_EDITOR_ALLOWED_USERS).
    ESCRITORIO_EDITORES: str = ""
    # Domínios por vírgula: quem entra no escritório.
    ESCRITORIO_DOMINIOS: str = "healthsafetytech.com"
    ESCRITORIO_URL: str = "https://escritoriohs.healthsafetytech.com"
    ESCRITORIO_MAP_STORAGE_URL: str = "https://escritoriohs.healthsafetytech.com/map-storage"
    # Para onde a raiz redireciona (substitui o START_ROOM_URL do WA).
    ESCRITORIO_SALA_INICIAL: str = "/~/hs/hs.wam"

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
