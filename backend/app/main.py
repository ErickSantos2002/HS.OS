import asyncio
import logging
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware

from app.auth.router import router as auth_router
from app.config import settings
from app.escuta_banco import escutar
from app.coletor_metricas import rodar as rodar_metricas
from app.coletor_uso import rodar as rodar_coletor
from app.vigia_sessoes import rodar as rodar_vigia
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
from app.routers.coletor import router as coletor_router
from app.routers.conversations import router as conversations_router
from app.routers.gateway import router as gateway_router
from app.routers.llm import router as llm_router
from app.routers.mcp_alerta import router as mcp_alerta_router
from app.routers.mcp_wiki import router as mcp_wiki_router
from app.routers.integracoes import router as integracoes_router
from app.routers.ia import router as ia_router
from app.routers.push import router as push_router
from app.routers.relatorios import router as relatorios_router
from app.routers.profiles import router as profiles_router
from app.routers.tarefas import router as tarefas_router
from app.routers.uso import router as uso_router
from app.routers.warroom import router as warroom_router
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

    # O consumo do gateway é estado vivo: sessão podada leva o histórico junto.
    # Este laço copia para `usage_events`, e a partir daí o `/consumo` prefere a
    # tabela sozinho. Desligar: `COLETOR_USO_SEGUNDOS=0`.
    parar_coletor = asyncio.Event()
    coletor = asyncio.create_task(rodar_coletor(parar_coletor))

    # ⚠️ **A sessão `main` não tem quem olhe por ela.** A auto-compactação mora
    # no `/reply`, que só roda com alguém esperando resposta na tela; a sessão
    # que os agentes usam entre si acumula até travar, e travada derruba todo
    # `sessions_send` para aquele agente. Este vigia compacta antes de estourar
    # — depois do estouro a compactação recusa. Desligar: `VIGIA_SESSOES_SEGUNDOS=0`.
    parar_vigia = asyncio.Event()
    vigia = asyncio.create_task(rodar_vigia(parar_vigia))

    # ⚠️ **As quatro tabelas de `/monitoring` nunca tiveram uma linha.** Quem as
    # enchia era um coletor na VPS chamando `POST /coletor/estatisticas`, e em
    # 31/08/2026 se confirmou que ele não existe mais — sumiu na migração. O
    # webhook continua de pé; este laço é o caminho de dentro, que não depende
    # de máquina nem segredo à parte. Desligar: `COLETOR_METRICAS_SEGUNDOS=0`.
    parar_metricas = asyncio.Event()
    metricas = asyncio.create_task(rodar_metricas(parar_metricas))

    yield

    parar_escuta.set()
    parar_coletor.set()
    parar_vigia.set()
    parar_metricas.set()
    escuta.cancel()
    coletor.cancel()
    vigia.cancel()
    metricas.cancel()
    # A conexão com o gateway é persistente; fechar no shutdown evita deixar
    # socket pendurado no OpenClaw a cada reinício.
    # Antes de tudo: solta os WebSockets abertos, senão o shutdown
    # gracioso espera por eles para sempre.
    sinalizar_desligamento()
    await encerrar_cliente()
    await close_db()


logger = logging.getLogger(__name__)

# ⚠️ **Lido uma vez, no import.** `APP_VERSION` vem do build arg `GIT_SHA` que o
# EasyPanel já mandava e o Dockerfile ignorava. Fora de container não existe, e
# `"dev"` é a resposta honesta — melhor que fingir uma versão.
#
# Sete caracteres porque é o que se digita: bate com o `git log --oneline` e com
# o que o painel mostra, sem obrigar ninguém a comparar quarenta hexadecimais.
_VERSAO = (os.environ.get("APP_VERSION") or "dev")[:7]

# Distingue "acabou de subir" de "está de pé há dias" — a segunda pergunta que
# se faz depois de um deploy, logo depois de "qual versão".
_INICIADO_EM = datetime.now(timezone.utc)

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
    """Vivo, e **qual versão**.

    ⚠️ **Sem a versão aqui não há como saber de fora qual commit está rodando**,
    e isso já custou tempo: em 17/08/2026 um deploy do EasyPanel construiu o
    commit anterior (o push não tinha saído), falhou pelo mesmo erro de antes, e
    a única pista foi o `GIT_SHA` no log do build — que só quem está no painel
    enxerga. Do lado de fora, backend novo e backend velho respondiam idênticos.

    O `GIT_SHA` já era mandado pelo EasyPanel como build arg e o Dockerfile o
    ignorava; agora ele vira `APP_VERSION` na imagem. Rodando fora de container
    o valor não existe e vem `"dev"` — o que é informação, não falha.

    Expor o SHA num endpoint aberto é deliberado e conversado (19/08/2026): o
    repositório é privado, o hash não abre nada, e o custo de não saber o que
    está no ar é maior. `iniciado_em` entra junto porque distingue "subiu agora"
    de "está de pé há dias" — as duas perguntas que se faz depois de um deploy.
    """
    return {
        "status": "ok",
        "service": "hsos-api",
        "versao": _VERSAO,
        "iniciado_em": _INICIADO_EM.isoformat(),
    }


@app.exception_handler(RequestValidationError)
async def registrar_validacao(request: Request, exc: RequestValidationError):
    """Loga qual campo o FastAPI recusou, e por quê.

    Sem isto um 422 não deixa rastro nenhum: o log de acesso mostra
    "422 Unprocessable Content" e mais nada, então o defeito só existe na tela
    de quem tentou. Em 13/08/2026 isso custou uma investigação inteira para um
    "Input should be a valid string" cujo campo ninguém sabia.

    ⚠️ **Nunca logamos o valor recebido.** O `input` do Pydantic viria junto, e
    numa rota de conector isso é senha em texto puro no log. O nome do campo e a
    razão bastam para achar o defeito.
    """
    campos = [
        {"campo": ".".join(str(p) for p in (e.get("loc") or [])), "erro": e.get("msg")}
        for e in exc.errors()
    ]
    logger.warning(
        "422 em %s %s — %s",
        request.method, request.url.path,
        "; ".join(f"{c['campo']}: {c['erro']}" for c in campos) or "(sem detalhe)",
    )
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


app.include_router(agents_router)
app.include_router(arenas_router)
app.include_router(artefatos_router)
app.include_router(automacoes_router)
app.include_router(agent_export_router)
app.include_router(auth_router)
app.include_router(branding_router)
app.include_router(coletor_router)
app.include_router(conversations_router)
app.include_router(channels_router)
app.include_router(broadcast_router)
app.include_router(chat_extras_router)
app.include_router(gateway_router)
app.include_router(ia_router)
app.include_router(integracoes_router)
app.include_router(llm_router)
app.include_router(mcp_alerta_router)
app.include_router(mcp_wiki_router)
app.include_router(profiles_router)
app.include_router(push_router)
app.include_router(relatorios_router)
app.include_router(skills_router)
app.include_router(storage_router)
app.include_router(uso_router)
app.include_router(warroom_router)
app.include_router(times_router)
app.include_router(wiki_router)
app.include_router(tarefas_router)
app.include_router(ws_router)
