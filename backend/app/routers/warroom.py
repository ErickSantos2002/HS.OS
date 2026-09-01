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

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import warroom
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.integracoes import ler_segredo

router = APIRouter(prefix="/warroom", tags=["warroom"])

_bearer = HTTPBearer(auto_error=False)


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

    agora = datetime.now(timezone.utc)
    async with sessao(role="service_role") as conn:
        pessoas = await conn.fetch(
            "SELECT id::text AS id, COALESCE(full_name, '—') AS nome FROM public.profiles "
            "ORDER BY full_name")
        perfis = await conn.fetch(
            "SELECT agent_id, name, role FROM public.agent_profiles ORDER BY sort_order, name")
        contexto = await conn.fetch(
            "SELECT DISTINCT ON (agent_id) agent_id, total_tokens, context_tokens "
            "FROM public.agent_context_state ORDER BY agent_id, updated_at DESC")
        # A última fala por agente é o que decide estado e parceiro — e o nome
        # da pessoa vem junto, porque a curva aponta para o nó dela.
        ultimas = await conn.fetch(
            """SELECT DISTINCT ON (c.agent_id)
                      c.agent_id, c.role, c.content, c.created_at,
                      COALESCE(p.full_name, 'alguém') AS autor
                 FROM public.conversations c
                 LEFT JOIN public.profiles p ON p.id = c.user_id
                ORDER BY c.agent_id, c.created_at DESC""")
        publicados = await conn.fetch(
            "SELECT agent_id, title, created_at FROM public.wiki_documents "
            "WHERE created_at >= current_date ORDER BY created_at DESC")
        conversas = await conn.fetch(
            """SELECT c.agent_id, c.role, c.content, c.created_at,
                      COALESCE(p.full_name, 'alguém') AS autor
                 FROM public.conversations c
                 LEFT JOIN public.profiles p ON p.id = c.user_id
                ORDER BY c.created_at DESC LIMIT 20""")
        uso = await conn.fetchrow(
            "SELECT sum(total_tokens) tokens, sum(cost_usd) custo FROM public.usage_events "
            "WHERE ts >= current_date")
        conversas_hoje = await conn.fetchval(
            "SELECT count(*) FROM public.conversations WHERE created_at >= current_date")
        primeiro = await conn.fetchval("SELECT min(ts) FROM public.usage_events")

    return {
        "ts": agora.isoformat(),
        "diasNoAr": (agora - primeiro).days if primeiro else None,
        "pessoas": [dict(p) for p in pessoas],
        "agentes": warroom.montar_agentes(
            [dict(r) for r in perfis],
            [dict(r) for r in contexto],
            {r["agent_id"]: dict(r) for r in ultimas if r["agent_id"]},
            agora,
        ),
        "eventos": warroom.montar_eventos([dict(r) for r in publicados],
                                          [dict(r) for r in conversas]),
        "numeros": warroom.montar_numeros(dict(uso) if uso else {},
                                          entregas=len(publicados),
                                          conversas=int(conversas_hoje or 0)),
    }
