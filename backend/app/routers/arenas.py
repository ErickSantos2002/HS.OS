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
