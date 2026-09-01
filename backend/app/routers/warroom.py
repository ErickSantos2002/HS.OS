"""`GET /warroom/feed` — o que a TV do escritório mostra.

A lógica de verdade está em `app.warroom`, testada isolada. Aqui só há consulta
e montagem: cada bloco lê a fonte que **de fato tem dado** neste sistema, que é
o que separa esta tela da `warroom-feed` original — ver o cabeçalho de
`app/warroom.py` para a medição que motivou a troca de fontes.

⚠️ **Roda como `service_role` de propósito.** A TV não tem usuário, então não há
`auth.uid()` para o RLS morder. A autorização é a deste endpoint —
`warroom.pode_ver` — e é ela que precisa ser lida e testada. É o modelo da casa:
FastAPI é a primeira camada, o RLS é a segunda.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import warroom
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.integracoes import ler_segredo

router = APIRouter(prefix="/warroom", tags=["warroom"])

_bearer = HTTPBearer(auto_error=False)

# Quantas trocas cabem no bloco "agora" sem a parede virar mural de texto.
_ULTIMAS = 12


async def _sessao_opcional(
    cred: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Usuario | None:
    """A sessão, quando houver. A TV não tem — e isso não é erro aqui.

    Reusa `usuario_atual` em vez de reimplementar a leitura do JWT: um segundo
    caminho de autenticação divergiria em silêncio do primeiro, que é onde
    moram a revogação de papel e a conta desativada.
    """
    if cred is None:
        return None
    try:
        return await usuario_atual(cred)
    except HTTPException:
        return None


@router.get("/feed")
async def feed(
    t: str | None = Query(default=None, description="Token da TV."),
    usuario: Usuario | None = Depends(_sessao_opcional),
):
    if not warroom.pode_ver(t, await ler_segredo("WARROOM_TOKEN"), usuario is not None):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Painel não autorizado.")

    async with sessao(role="service_role") as conn:
        stats = await conn.fetch(
            "SELECT DISTINCT ON (agent_id) agent_id, status, last_active FROM public.agent_stats "
            "ORDER BY agent_id, collected_at DESC")
        contexto = await conn.fetch(
            "SELECT DISTINCT ON (agent_id) agent_id, total_tokens, context_tokens "
            "FROM public.agent_context_state ORDER BY agent_id, updated_at DESC")
        publicados = await conn.fetch(
            "SELECT agent_id, title, created_at FROM public.wiki_documents "
            "WHERE created_at >= current_date ORDER BY created_at")
        conversas = await conn.fetch(
            "SELECT role, agent_id, content, created_at FROM public.conversations "
            "ORDER BY created_at DESC LIMIT $1", _ULTIMAS)
        uso = await conn.fetchrow(
            "SELECT sum(total_tokens) tokens, sum(cost_usd) custo FROM public.usage_events "
            "WHERE ts >= current_date")

    return {
        "agentes": warroom.bloco_agentes([dict(r) for r in stats],
                                         [dict(r) for r in contexto]),
        "publicado": warroom.bloco_publicado([dict(r) for r in publicados]),
        "agora": warroom.bloco_agora([dict(r) for r in conversas]),
        "consumo": warroom.bloco_consumo(dict(uso) if uso else {}),
    }
