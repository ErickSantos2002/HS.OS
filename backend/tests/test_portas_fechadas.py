"""Toda rota nova nasce exigindo autenticação — ou entra aqui com o motivo.

⚠️ **O que custou (PK-03, 24/11/2026):** a proteção era conferida rota a rota,
à mão, com token de colaborador emitido na hora. Funcionou até não funcionar:
`/agents/{id}/crons` e `/configuracoes/{chave}` ficaram semanas em "só logado"
(CLAUDE.md), e `/uso/eventos` e `/gateway/sessions` também, até a análise do
remix do DN.OS de novembro. O DN.OS tem um `portas-fechadas.mjs` que chama
toda função sem login e exige recusa; isto é o equivalente estático.

⚠️ **A armadilha que faria este teste passar vazio:** no FastAPI 0.141,
`app.routes` lista os routers incluídos como `_IncludedRouter` — 43 deles e uma
única `APIRoute` (`/health`). Sem descer em `original_router.routes`, o teste
veria uma rota e passaria. Por isso `test_enxerga_as_rotas_de_verdade` exige
centenas — é a âncora que confere que a varredura varre.

Uma rota pública nova entra em `PUBLICAS` com o motivo. "Esqueci o Depends" não
é motivo.
"""
from fastapi.routing import APIRoute, APIWebSocketRoute

from app.main import app

# Guards que autenticam. `_sessao_opcional` (warroom) NÃO está aqui: é opcional.
GUARDS = {
    "usuario_atual",                          # JWT
    "exige_papel.<locals>._guard",            # JWT + papel
    "exige_segredo.<locals>.dependencia",     # segredo de integração (MCP, ingestão)
    "_exige_token_wa",                        # Admin API do WorkAdventure
    "chamador",                               # /tarefas: segredo ou JWT
}

# (método, caminho) → por que pode não ter guard na assinatura.
PUBLICAS = {
    ("GET", "/health"): "saúde do contêiner",
    ("GET", "/auth/status"): "a tela de login pergunta se a instalação tem admin",
    ("POST", "/auth/bootstrap-admin"): "primeiro admin; recusa se já existe um",
    ("POST", "/auth/login"): "login",
    ("GET", "/auth/sso/status"): "a tela de login pergunta se o SSO está ligado",
    ("GET", "/auth/microsoft"): "começo do SSO",
    ("GET", "/auth/microsoft/callback"): "volta do SSO (state)",
    ("POST", "/auth/sso/exchange"): "troca do ticket de uso único do SSO",
    ("GET", "/email/oauth/callback"): "volta do OAuth do e-mail; confere o state, que amarra ao usuário",
    ("GET", "/branding"): "marca aparece antes do login",
    ("GET", "/push/chave-publica"): "chave PÚBLICA do VAPID",
    ("GET", "/agente/chave-publica"): "chave PÚBLICA de verificação das ações de agente",
    ("POST", "/agenda/lembretes/acao"): "botão do push; token assinado no corpo",
    ("GET", "/artefatos/publicados/{artefato_id}"): "link público de artefato, por desenho",
    ("GET", "/artefatos/vivos/publico/{slug}"): "artefato vivo público (/p/:slug), por desenho",
    ("GET", "/storage/{bucket}/{caminho:path}"): "buckets públicos respondem a <img src>; privado é recusado por dentro",
    ("GET", "/escritorio/meu-status"): "token da sala na query (o WA não manda cabeçalho)",
    ("GET", "/escritorio-wa/api/capabilities"): "WorkAdventure pergunta antes de autenticar; devolve {}",
    ("GET", "/warroom/feed"): "TV da sala: WARROOM_TOKEN ou sessão, conferidos por dentro",
    ("WS", "/ws"): "JWT na query (o navegador não manda cabeçalho no WebSocket); fecha 1008",
}


def _rotas(itens):
    for r in itens:
        if isinstance(r, (APIRoute, APIWebSocketRoute)):
            yield r
        elif hasattr(r, "original_router"):
            yield from _rotas(r.original_router.routes)
        elif hasattr(r, "routes"):
            yield from _rotas(r.routes)


def _chamadas(dep):
    for d in dep.dependencies:
        yield d.call
        yield from _chamadas(d)


def _chave(r):
    metodos = sorted(getattr(r, "methods", None) or {"WS"})
    return [(m, r.path) for m in metodos]


def _sem_guard():
    for r in _rotas(app.routes):
        if not any(getattr(c, "__qualname__", "") in GUARDS for c in _chamadas(r.dependant)):
            yield from _chave(r)


def test_enxerga_as_rotas_de_verdade():
    assert len(list(_rotas(app.routes))) > 300


def test_nenhuma_rota_nasce_aberta_sem_motivo():
    abertas = [k for k in _sem_guard() if k not in PUBLICAS]
    assert not abertas, (
        "Rota sem autenticação na assinatura. Ponha `Depends(usuario_atual)` / "
        f"`exige_papel(...)`, ou registre em PUBLICAS com o motivo: {abertas}"
    )


def test_a_lista_de_publicas_nao_apodrece():
    """Exceção que sobrou de rota apagada, ou que ganhou guard, sai da lista —
    senão ela vira licença para a próxima rota com o mesmo caminho."""
    sobrando = set(PUBLICAS) - set(_sem_guard())
    assert not sobrando, f"Tire de PUBLICAS: {sorted(sobrando)}"
