from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import close_db, init_db

# Conforme os domínios forem portados das Edge Functions (backend/supabase/),
# registre os routers aqui. Um router por domínio, mesmo padrão do TalentHS:
#
# from app.routers.agents import router as agents_router
# from app.auth.router import router as auth_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    yield
    await close_db()


app = FastAPI(
    title="HS.OS API",
    description="API da plataforma de agentes de IA HS.OS",
    version="0.1.0",
    lifespan=lifespan,
)

_frontend_origin = settings.FRONTEND_URL.rstrip("/")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        _frontend_origin,
        "http://localhost:8080",
        "http://localhost:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "hsos-api"}


# app.include_router(auth_router)
# app.include_router(agents_router)
