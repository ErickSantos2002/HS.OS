"""`GET /warroom/feed` — o que a TV do escritório mostra.

A lógica de verdade está em `app.warroom`, testada isolada. Aqui só há consulta
e montagem: cada bloco lê a fonte que **de fato tem dado** neste sistema, que é
o que separa esta tela da `warroom-feed` original — ver o cabeçalho de
`app/warroom.py` para a medição que motivou a troca de fontes.

⚠️ **Roda como `service_role` de propósito.** A TV não tem usuário, então não há
`auth.uid()` para o RLS morder. A autorização é a deste endpoint —
`warroom.pode_ver` — e é ela que precisa ser lida e testada. É o modelo da casa:
FastAPI é a primeira camada, o RLS é a segunda.

⚠️ **Nenhuma consulta aqui seleciona `content`** (TV pública, 16/10/2026).
`tests/test_warroom_rota.py` lê o SQL e recusa a coluna.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app import warroom
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.escritorio import presenca as escritorio_presenca
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
    hoje = datetime.now(warroom.FUSO).replace(hour=0, minute=0, second=0, microsecond=0)

    estado = escritorio_presenca.presenca  # lido a cada chamada (o teste o troca)
    presentes = {p["email"] for p in estado.pessoas()} if estado.conectado else set()

    async with sessao(role="service_role") as conn:
        perfis_pessoa = await conn.fetch(
            "SELECT id::text AS id, email, full_name, departamento, custom_status "
            "FROM public.profiles")
        perfis = await conn.fetch(
            "SELECT agent_id, name, role, specialty FROM public.agent_profiles "
            "ORDER BY sort_order, name")
        contexto = await conn.fetch(
            "SELECT DISTINCT ON (agent_id) agent_id, total_tokens, context_tokens "
            "FROM public.agent_context_state ORDER BY agent_id, updated_at DESC")
        # Só papel, hora e quem — o texto não sai do banco.
        ultimas = await conn.fetch(
            """SELECT DISTINCT ON (agent_id) agent_id, role, created_at, user_id::text AS user_id
                 FROM public.conversations ORDER BY agent_id, created_at DESC""")
        publicados = await conn.fetch(
            "SELECT agent_id, title, created_at FROM public.wiki_documents "
            "WHERE created_at >= $1 ORDER BY created_at DESC", hoje)
        msgs_agente = await conn.fetch(
            "SELECT user_id::text AS user_id, agent_id, role, created_at "
            "FROM public.conversations WHERE created_at >= $1", hoje)
        dm_membros = await conn.fetch(
            """SELECT cm.channel_id::text AS channel_id, array_agg(cm.user_id) AS membros
                 FROM public.channel_members cm
                 JOIN public.channels c ON c.id = cm.channel_id
                WHERE c.type = 'dm' AND cm.member_type = 'human' AND cm.user_id IS NOT NULL
                GROUP BY cm.channel_id""")
        msgs_dm = await conn.fetch(
            """SELECT m.channel_id::text AS channel_id, m.author_id, m.created_at
                 FROM public.channel_messages m
                 JOIN public.channels c ON c.id = m.channel_id
                WHERE c.type = 'dm' AND m.deleted_at IS NULL AND m.created_at >= $1""", hoje)
        primeiro = await conn.fetchval("SELECT min(ts) FROM public.usage_events")

    pessoas, setores = warroom.montar_pessoas([dict(r) for r in perfis_pessoa], presentes)
    do_time = {p["id"] for p in pessoas}
    nomes = {p["id"]: p["nome"] for p in pessoas}
    nomes_agente = {r["agent_id"]: (r["name"] or r["agent_id"]) for r in perfis}
    membros = warroom.membros_do_time([dict(r) for r in dm_membros], do_time)
    msgs_agente_l = [dict(r) for r in msgs_agente]
    msgs_dm_l = [dict(r) for r in msgs_dm]

    return {
        "ts": agora.isoformat(),
        "diasNoAr": (agora - primeiro).days if primeiro else None,
        "setores": setores,
        "pessoas": pessoas,
        "agentes": warroom.montar_agentes(
            [dict(r) for r in perfis], [dict(r) for r in contexto],
            {r["agent_id"]: dict(r) for r in ultimas if r["agent_id"]}, agora, do_time),
        "conversasTime": warroom.dms_vivos(membros, msgs_dm_l, agora),
        "eventos": warroom.montar_eventos(
            [dict(r) for r in publicados],
            [m for m in msgs_agente_l if m["role"] == "user"],
            msgs_dm_l, membros, nomes, nomes_agente),
        "numeros": warroom.montar_numeros(len(publicados), msgs_agente_l, msgs_dm_l,
                                          membros, do_time),
    }
