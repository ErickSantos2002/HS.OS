import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.config import settings
from app.escuta_banco import escutar
from app.database import close_db, init_db
from app.gateway.client import encerrar_cliente
from app.routers.agent_export import router as agent_export_router
from app.routers.agents import router as agents_router
from app.routers.automacoes import router as automacoes_router
from app.routers.artefatos import router as artefatos_router
from app.routers.arenas import router as arenas_router
from app.routers.branding import router as branding_router
from app.routers.broadcast import router as broadcast_router
from app.routers.channels import router as channels_router
from app.routers.chat_extras import router as chat_extras_router
from app.routers.conversations import router as conversations_router
from app.routers.gateway import router as gateway_router
from app.routers.llm import router as llm_router
from app.routers.integracoes import router as integracoes_router
from app.routers.ia import router as ia_router
from app.routers.push import router as push_router
from app.routers.profiles import router as profiles_router
from app.routers.tarefas import router as tarefas_router
from app.routers.uso import router as uso_router
from app.routers.times import router as times_router
from app.routers.wiki import router as wiki_router
from app.routers.skills import router as skills_router
from app.routers.storage import preparar_diretorios, router as storage_router
from app.routers.ws import router as ws_router, sinalizar_desligamento

# Conforme os domínios forem portados das Edge Functions (backend/supabase/),
# registre os routers aqui. Um router por domínio, mesmo padrão do TalentHS:
#


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    preparar_diretorios()

    # A escuta do banco é o que substitui o `postgres_changes`. Roda numa
    # conexão dedicada, fora do pool, e reconecta sozinha — ver
    # `app/escuta_banco.py`.
    parar_escuta = asyncio.Event()
    escuta = asyncio.create_task(escutar(parar_escuta))

    yield

    parar_escuta.set()
    escuta.cancel()
    # A conexão com o gateway é persistente; fechar no shutdown evita deixar
    # socket pendurado no OpenClaw a cada reinício.
    # Antes de tudo: solta os WebSockets abertos, senão o shutdown
    # gracioso espera por eles para sempre.
    sinalizar_desligamento()
    await encerrar_cliente()
    await close_db()


app = FastAPI(
    title="HS.OS API",
    description="API da plataforma de agentes de IA HS.OS",
    version="0.1.0",
    lifespan=lifespan,
)

# Em produção o front vive em hsos.healthsafetytech.com e a API em
# hsosapi.healthsafetytech.com — domínios diferentes, então toda chamada é
# cross-origin e o CORS deixa de ser detalhe. `FRONTEND_URL` aceita uma lista
# separada por vírgula para o caso de haver mais de uma origem legítima.
#
# A lista é explícita de propósito: com `allow_credentials=True` o navegador
# recusa `allow_origins=["*"]`, e um curinga aqui seria convite para qualquer
# site chamar a API com o token da vítima.
_origens = [o.strip().rstrip("/") for o in settings.FRONTEND_URL.split(",") if o.strip()]
_origens += ["http://localhost:8080", "http://localhost:5173"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(set(_origens)),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "hsos-api"}


app.include_router(agents_router)
app.include_router(arenas_router)
app.include_router(artefatos_router)
app.include_router(automacoes_router)
app.include_router(agent_export_router)
app.include_router(auth_router)
app.include_router(branding_router)
app.include_router(conversations_router)
app.include_router(channels_router)
app.include_router(broadcast_router)
app.include_router(chat_extras_router)
app.include_router(gateway_router)
app.include_router(ia_router)
app.include_router(integracoes_router)
app.include_router(llm_router)
app.include_router(profiles_router)
app.include_router(push_router)
app.include_router(skills_router)
app.include_router(storage_router)
app.include_router(uso_router)
app.include_router(times_router)
app.include_router(wiki_router)
app.include_router(tarefas_router)
app.include_router(ws_router)
