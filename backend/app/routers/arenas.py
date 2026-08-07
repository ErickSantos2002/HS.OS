"""Arenas — os debates entre agentes com persona.

Uma arena guarda o elenco (`agents`), o roteiro (`prompt`, `react_code`) e a
configuração de voz. As mensagens e sessões vivem em tabelas próprias, com
`ON DELETE CASCADE` a partir daqui — apagar a arena leva o histórico junto, e é
o banco que garante isso.

⚠️ A parte de **voz** desta tela ainda depende da ElevenLabs e continua no
Supabase; o que sai aqui é a persistência, que é dado nosso.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/arenas", tags=["arenas"])


def _cru(linha) -> dict:
    """A tela conhece o formato da tabela e faz a tradução dela para o próprio.

    Devolver a linha como está evita inventar um terceiro formato no meio — o
    `rowToArena` do front já existia e continua sendo a única tradução.
    """
    return json.loads(json.dumps(dict(linha), default=str))


@router.get("")
async def listar(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.arenas ORDER BY created_at DESC"
        )
    return [_cru(l) for l in linhas]


@router.get("/modelos")
async def modelos(usuario: Usuario = Depends(usuario_atual)):
    """Os modelos prontos de arena. **Antes de `/{arena_id}`**, senão "modelos"
    vira um id."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch("SELECT * FROM public.arena_templates ORDER BY name")
    return [_cru(l) for l in linhas]


@router.get("/por-agente/{agent_id}")
async def arenas_do_agente(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Em quais arenas este agente participa, com o id de voz de cada uma.

    ⚠️ **Antes de `GET /{arena_id}`**, senão "por-agente" vira um id.

    Era um join embutido do PostgREST (`arenas:arena_id(...)`) — sintaxe que só
    existe lá. Aqui é o join de sempre.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT a.id::text AS arena_id, a.name AS arena_name, a.convai_agent_id
              FROM public.arena_agents ag
              JOIN public.arenas a ON a.id = ag.arena_id
             WHERE ag.agent_id = $1
            """,
            agent_id,
        )
    return [_cru(l) for l in linhas]


@router.get("/{arena_id}")
async def obter(arena_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT * FROM public.arenas WHERE id = $1::uuid", arena_id
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arena não encontrada.")
    return _cru(linha)


@router.get("/{arena_id}/agentes")
async def agentes(arena_id: str, usuario: Usuario = Depends(usuario_atual)):
    """O elenco da arena, com o papel de cada agente."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.arena_agents WHERE arena_id = $1::uuid", arena_id
        )
    return [_cru(l) for l in linhas]


class ArenaIn(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=200)
    description: str = ""
    emoji: str = ""
    agents: list = []
    react_code: str | None = None
    prompt: str | None = None
    created_at: str | None = None
    voice_id: str | None = None
    opening_message: str | None = None
    convai_agent_id: str | None = None


@router.put("/{arena_id}", status_code=status.HTTP_204_NO_CONTENT)
async def gravar(
    arena_id: str,
    dados: ArenaIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Cria ou substitui a arena. O dono sai do token, não do corpo.

    A tela mandava `created_by` junto porque o RLS exigia — e mandar o dono no
    corpo é abrir para gravar em nome de outra pessoa. Aqui ele vem do token, e
    o `DO UPDATE` preserva o dono original: editar arena de outro não a rouba.
    """
    if dados.id != arena_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "O id do corpo não bate com o da URL."
        )
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            """
            INSERT INTO public.arenas
                (id, name, description, emoji, agents, react_code, prompt,
                 created_at, created_by, voice_id, opening_message, convai_agent_id)
            VALUES ($1::uuid, $2, $3, $4, $5::text::jsonb, $6, $7,
                    COALESCE(NULLIF($8,'')::text::timestamptz, now()), $9::uuid,
                    $10, $11, $12)
            ON CONFLICT (id) DO UPDATE SET
                name = EXCLUDED.name, description = EXCLUDED.description,
                emoji = EXCLUDED.emoji, agents = EXCLUDED.agents,
                react_code = EXCLUDED.react_code, prompt = EXCLUDED.prompt,
                voice_id = EXCLUDED.voice_id,
                opening_message = EXCLUDED.opening_message,
                convai_agent_id = EXCLUDED.convai_agent_id
            """,
            arena_id, dados.name, dados.description, dados.emoji,
            json.dumps(dados.agents), dados.react_code, dados.prompt,
            dados.created_at or "", usuario.id, dados.voice_id,
            dados.opening_message, dados.convai_agent_id,
        )
    logger.info("Arena %s gravada por %s", arena_id, usuario.id)


@router.delete("/{arena_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(arena_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Apaga a arena. As sessões, mensagens e o elenco vão junto por cascata."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.arenas WHERE id = $1::uuid", arena_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Arena não encontrada.")


# ─────────────────────────────────────────────────────────────────────────────
# Elenco, sessões e mensagens
# ─────────────────────────────────────────────────────────────────────────────


class PapelDeAgenteIn(BaseModel):
    agent_id: str
    role_name: str | None = None
    role_description: str | None = None


@router.put("/{arena_id}/agentes", status_code=status.HTTP_204_NO_CONTENT)
async def definir_elenco(
    arena_id: str,
    papeis: list[PapelDeAgenteIn],
    usuario: Usuario = Depends(usuario_atual),
):
    """Substitui o elenco inteiro da arena.

    ⚠️ **Apagar e reinserir numa transação só.** A tela fazia os dois passos
    separados: se o INSERT falhasse depois do DELETE, a arena ficava sem elenco
    nenhum e o erro aparecia como "erro ao salvar" — sem dizer que o que existia
    já tinha ido embora.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM public.arena_agents WHERE arena_id = $1::uuid", arena_id
            )
            for p in papeis:
                await conn.execute(
                    "INSERT INTO public.arena_agents (arena_id, agent_id, role_name, role_description) "
                    "VALUES ($1::uuid, $2, $3, $4)",
                    arena_id, p.agent_id, p.role_name, p.role_description,
                )


@router.patch("/{arena_id}/agentes/{papel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def editar_papel(
    arena_id: str,
    papel_id: str,
    dados: PapelDeAgenteIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Muda o papel de um agente sem mexer no resto do elenco."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.arena_agents SET role_name = $3, role_description = $4 "
            " WHERE id = $2::uuid AND arena_id = $1::uuid RETURNING id",
            arena_id, papel_id, dados.role_name, dados.role_description,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Papel não encontrado nesta arena.")


@router.get("/{arena_id}/sessoes")
async def sessoes(arena_id: str, usuario: Usuario = Depends(usuario_atual)):
    """As sessões da arena, **com a contagem de mensagens de cada uma**.

    A contagem vem no mesmo SELECT. A tela fazia uma consulta por sessão só para
    isso — vinte sessões, vinte e uma idas ao banco.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT s.*, (
                     SELECT count(*) FROM public.arena_messages m
                      WHERE m.session_id = s.id
                   ) AS message_count
              FROM public.arena_sessions s
             WHERE s.arena_id = $1::uuid
             ORDER BY s.created_at DESC
            """,
            arena_id,
        )
    return [_cru(l) for l in linhas]


class SessaoIn(BaseModel):
    title: str | None = None
    # A sessão pode continuar outra: o resumo do contexto anterior viaja junto
    # para o debate não recomeçar do zero.
    parent_session_id: str | None = None
    context_summary: str | None = None


@router.post("/{arena_id}/sessoes", status_code=status.HTTP_201_CREATED)
async def criar_sessao(
    arena_id: str, dados: SessaoIn, usuario: Usuario = Depends(usuario_atual)
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            # `arena_sessions` não guarda quem criou — a arena já tem dono e a
            # sessão é dela, não de uma pessoa.
            "INSERT INTO public.arena_sessions "
            "    (arena_id, title, parent_session_id, context_summary) "
            "VALUES ($1::uuid, $2, NULLIF($3,'')::text::uuid, $4) RETURNING *",
            arena_id, dados.title or "Nova sessão",
            dados.parent_session_id or "", dados.context_summary,
        )
    return _cru(linha)


@router.patch("/{arena_id}/sessoes/{sessao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def renomear_sessao(
    arena_id: str,
    sessao_id: str,
    dados: SessaoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.arena_sessions SET title = $3, updated_at = now() "
            " WHERE id = $2::uuid AND arena_id = $1::uuid RETURNING id",
            arena_id, sessao_id, dados.title,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessão não encontrada.")


@router.get("/{arena_id}/sessoes/{sessao_id}/mensagens")
async def mensagens_da_sessao(
    arena_id: str, sessao_id: str, usuario: Usuario = Depends(usuario_atual)
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.arena_messages WHERE session_id = $1::uuid "
            " ORDER BY created_at",
            sessao_id,
        )
    return [_cru(l) for l in linhas]


@router.delete("/{arena_id}/sessoes/{sessao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_sessao(
    arena_id: str, sessao_id: str, usuario: Usuario = Depends(usuario_atual)
):
    """Apaga a sessão e as mensagens dela, numa transação.

    A tela apagava as mensagens primeiro "caso a FK não tenha CASCADE" — e o
    comentário dizia isso. Aqui os dois passos são um só: se o segundo falhar, o
    primeiro volta, em vez de deixar mensagens órfãs de uma sessão que ficou.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM public.arena_messages WHERE session_id = $1::uuid", sessao_id
            )
            marca = await conn.execute(
                "DELETE FROM public.arena_sessions WHERE id = $1::uuid AND arena_id = $2::uuid",
                sessao_id, arena_id,
            )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sessão não encontrada.")


class MensagemDeArenaIn(BaseModel):
    session_id: str
    agent_id: str | None = None
    role: str | None = None
    agent_role: str | None = None
    content: str = ""
    artifact_html: str | None = None


@router.post("/{arena_id}/mensagens", status_code=status.HTTP_201_CREATED)
async def registrar_mensagem(
    arena_id: str,
    dados: MensagemDeArenaIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Grava uma fala do debate."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "INSERT INTO public.arena_messages "
            "    (session_id, agent_id, role, agent_role, content, artifact_html) "
            "VALUES ($1::uuid, $2, $3, $4, $5, $6) RETURNING *",
            dados.session_id, dados.agent_id, dados.role, dados.agent_role,
            dados.content, dados.artifact_html,
        )
    return _cru(linha)
