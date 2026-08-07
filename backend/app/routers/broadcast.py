"""A API que o **agente** usa para agir na plataforma — portado de `channel-broadcast`.

O agente do lado do gateway não tem sessão de usuário: ele se identifica por
segredo compartilhado (`BROADCAST_API_KEY`) e age em nome próprio. É por aqui
que ele publica em canal, manda DM para uma pessoa e registra um resultado.

⚠️ **Tudo aqui grava em nome de um agente, não de uma pessoa.** O `author_type`
é sempre `agent` — não há caminho, nesta rota, para escrever como se fosse
alguém da equipe.
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.integracoes import exige_segredo
from app.realtime import hub, topico_canal, topico_usuario

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/broadcast", tags=["broadcast"])


class ResultadoIn(BaseModel):
    agent_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str = ""
    category: str = "task"
    value: float | None = None
    metadata: dict = {}


@router.post("/resultado", status_code=status.HTTP_201_CREATED)
async def registrar_resultado(
    dados: ResultadoIn,
    _: None = Depends(exige_segredo("BROADCAST_API_KEY")),
):
    """O agente registra algo que produziu — vai para o painel de resultados."""
    async with sessao(role="service_role") as conn:
        ident = await conn.fetchval(
            """
            INSERT INTO public.agent_results
                (agent_id, title, description, category, value, metadata)
            VALUES ($1, $2, $3, $4, $5, $6::text::jsonb)
            RETURNING id::text
            """,
            dados.agent_id, dados.title, dados.description, dados.category,
            dados.value, json.dumps(dados.metadata),
        )
    logger.info("Resultado de %s registrado: %s", dados.agent_id, dados.title)
    return {"id": ident}


class MensagemCanalIn(BaseModel):
    channel: str = Field(min_length=1, description="Nome ou id do canal.")
    agent_id: str = Field(min_length=1)
    sender_name: str = Field(min_length=1)
    message: str = Field(min_length=1)
    sender_avatar: str | None = None
    attachments: list[dict] | None = None


@router.post("/canal", status_code=status.HTTP_201_CREATED)
async def publicar_em_canal(
    dados: MensagemCanalIn,
    _: None = Depends(exige_segredo("BROADCAST_API_KEY")),
):
    """Publica no canal. Aceita **nome ou id**.

    Aceitar o nome não é conveniência: o agente conhece o canal como "#geral",
    não por uuid — exigir o id obrigaria a ensinar a ele uma tabela de-para que
    envelhece.
    """
    async with sessao(role="service_role") as conn:
        canal = await conn.fetchrow(
            "SELECT id::text AS id, name FROM public.channels "
            "WHERE name ILIKE $1 OR id::text = $1 LIMIT 1",
            dados.channel,
        )
        if canal is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f'Canal "{dados.channel}" não encontrado.'
            )
        linha = await conn.fetchrow(
            """
            INSERT INTO public.channel_messages
                (channel_id, author_id, author_type, author_name, author_avatar,
                 content, attachments)
            VALUES ($1::uuid, $2, 'agent', $3, $4, $5, $6::text::jsonb)
            RETURNING id::text AS id,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
            """,
            canal["id"], dados.agent_id, dados.sender_name, dados.sender_avatar,
            dados.message,
            json.dumps(dados.attachments) if dados.attachments else None,
        )

    hub.publicar(topico_canal(canal["id"]), "mensagem", {
        "id": linha["id"], "channel_id": canal["id"], "author_id": dados.agent_id,
        "author_type": "agent", "author_name": dados.sender_name,
        "author_avatar": dados.sender_avatar, "content": dados.message,
        "attachments": dados.attachments, "created_at": linha["created_at"],
        "thread_id": None, "audio_url": None, "edited_at": None, "deleted_at": None,
    })
    logger.info("Agente %s publicou em #%s", dados.agent_id, canal["name"])
    return {"id": linha["id"], "channel": canal["name"]}


class DiretaIn(BaseModel):
    to: str = Field(min_length=1, description="E-mail ou id do destinatário.")
    agent_id: str = Field(min_length=1)
    message: str = Field(min_length=1)
    media: list[dict] | None = None


@router.post("/dm", status_code=status.HTTP_201_CREATED)
async def mandar_dm(
    dados: DiretaIn,
    _: None = Depends(exige_segredo("BROADCAST_API_KEY")),
):
    """O agente manda mensagem direta a uma pessoa.

    Aceita e-mail ou id pelo mesmo motivo do canal: o agente sabe o e-mail de
    quem vai falar, raramente o uuid.

    A mensagem entra em `conversations`, que é onde a tela do chat um-a-um lê —
    não em `channel_messages`.
    """
    async with sessao(role="service_role") as conn:
        destino = await conn.fetchval(
            "SELECT id::text FROM public.profiles WHERE email ILIKE $1 OR id::text = $1 LIMIT 1",
            dados.to,
        )
        if not destino:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f'Destinatário "{dados.to}" não encontrado.'
            )
        linha = await conn.fetchrow(
            """
            INSERT INTO public.conversations (agent_id, user_id, role, content, media)
            VALUES ($1, $2::uuid, 'agent', $3, $4::text::jsonb)
            RETURNING id::text AS id,
                to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
            """,
            dados.agent_id, destino, dados.message,
            json.dumps(dados.media) if dados.media else None,
        )

    hub.publicar(topico_usuario(destino), "resposta-agente", {
        "agent_id": dados.agent_id,
        "message": {"id": linha["id"], "agent_id": dados.agent_id, "role": "agent",
                    "content": dados.message, "media": dados.media,
                    "created_at": linha["created_at"]},
    })
    logger.info("Agente %s mandou DM para %s", dados.agent_id, dados.to)
    return {"id": linha["id"], "para": destino}


@router.get("/canal/{channel}/mensagens")
async def ler_canal(
    channel: str,
    _: None = Depends(exige_segredo("BROADCAST_API_KEY")),
    limite: int = Query(default=50, ge=1, le=200),
):
    """O agente lê o que foi dito no canal — para responder com contexto."""
    async with sessao(role="service_role") as conn:
        canal = await conn.fetchval(
            "SELECT id::text FROM public.channels WHERE name ILIKE $1 OR id::text = $1 LIMIT 1",
            channel,
        )
        if not canal:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")
        linhas = await conn.fetch(
            """
            SELECT author_name, author_type::text AS author_type, content,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
              FROM public.channel_messages
             WHERE channel_id = $1::uuid AND thread_id IS NULL
             ORDER BY created_at DESC LIMIT $2
            """,
            canal, limite,
        )
    # Cronológica: o agente lê como conversa, não como feed.
    return {"messages": [dict(l) for l in reversed(linhas)]}


@router.get("/pessoas")
async def pessoas(_: None = Depends(exige_segredo("BROADCAST_API_KEY"))):
    """Quem existe na instalação — o agente usa para saber a quem escrever."""
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text AS id, email, full_name FROM public.profiles "
            "ORDER BY full_name NULLS LAST, email"
        )
    return {"users": [dict(l) for l in linhas]}
