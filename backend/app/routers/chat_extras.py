"""Acessórios do chat: recibos de leitura, reações e rascunhos.

Três tabelas pequenas que o front consultava direto — `dm_reads`,
`message_reactions` e `drafts`. Juntas num módulo porque nenhuma justifica um
arquivo próprio e as três compartilham o mesmo padrão: chave composta, escrita
idempotente, escopo do usuário do token.

⚠️ **A parte de tempo real continua pendente.** Os três hooks correspondentes
também assinam `postgres_changes` para receber mudança de outra aba ou de outra
pessoa. Isso é o subsistema de Realtime, que não foi portado (ver `ROADMAP.md`) —
o que sai daqui é a leitura e a escrita. Na prática já é ganho: o dado está no
nosso Postgres, então a assinatura antiga nunca dispararia de qualquer forma.
"""

import logging

from fastapi import APIRouter, Depends, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])


# ─────────────────────────────────────────────────────────────────────────────
# Recibos de leitura de DM
# ─────────────────────────────────────────────────────────────────────────────


class LeituraOut(BaseModel):
    last_read_at: str | None = None


@router.get("/dm-reads/{channel_id}", response_model=LeituraOut)
async def leitura_do_par(
    channel_id: str,
    user_id: str = Query(description="De quem se quer o recibo — normalmente o outro participante."),
    usuario: Usuario = Depends(usuario_atual),
):
    """Quando a outra pessoa leu o canal pela última vez."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        valor = await conn.fetchval(
            "SELECT to_char(last_read_at AT TIME ZONE 'UTC', "
            "'YYYY-MM-DD\"T\"HH24:MI:SS.MS') || 'Z' "
            "FROM public.dm_reads WHERE channel_id = $1::uuid AND user_id = $2::uuid",
            channel_id, user_id,
        )
    return LeituraOut(last_read_at=valor)


@router.put("/dm-reads/{channel_id}", response_model=LeituraOut)
async def marcar_lido(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Marca agora como o momento em que **eu** li este canal.

    O horário é do servidor, não do cliente: recibo de leitura com relógio de
    navegador atrasado ou adiantado mostra "lido" errado para o outro lado.
    O front já limitava a chamada a uma a cada 2s, e isso continua lá.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        valor = await conn.fetchval(
            """
            INSERT INTO public.dm_reads (channel_id, user_id, last_read_at)
            VALUES ($1::uuid, $2::uuid, now())
            ON CONFLICT (channel_id, user_id) DO UPDATE SET last_read_at = now()
            RETURNING to_char(last_read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z'
            """,
            channel_id, usuario.id,
        )
    return LeituraOut(last_read_at=valor)


# ─────────────────────────────────────────────────────────────────────────────
# Reações
# ─────────────────────────────────────────────────────────────────────────────


class ReacaoOut(BaseModel):
    message_id: str
    emoji: str
    user_ids: list[str]


class ReacaoIn(BaseModel):
    message_id: str
    emoji: str = Field(min_length=1, max_length=32)


@router.get("/channels/{channel_id}/reactions", response_model=list[ReacaoOut])
async def reacoes_do_canal(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Reações das mensagens recentes do canal, já agrupadas.

    O front fazia duas consultas — os ids das 200 últimas mensagens, depois as
    reações desses ids — e agrupava por (mensagem, emoji) no navegador. Aqui é
    uma consulta só, e o agrupamento sai do banco: é o mesmo resultado com uma
    ida a menos e sem carregar reação de mensagem que a tela nem mostra.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            WITH recentes AS (
                SELECT id FROM public.channel_messages
                 WHERE channel_id = $1::uuid
                 ORDER BY created_at DESC
                 LIMIT 200
            )
            SELECT r.message_id::text AS message_id, r.emoji,
                   array_agg(r.user_id::text ORDER BY r.created_at) AS user_ids
              FROM public.message_reactions r
              JOIN recentes m ON m.id = r.message_id
             GROUP BY r.message_id, r.emoji
            """,
            channel_id,
        )
    return [ReacaoOut(**dict(l)) for l in linhas]


@router.post("/reactions", status_code=status.HTTP_204_NO_CONTENT)
async def reagir(dados: ReacaoIn, usuario: Usuario = Depends(usuario_atual)):
    """Adiciona a minha reação. Repetir não duplica.

    O `ON CONFLICT DO NOTHING` cobre o clique duplo e a corrida entre duas abas —
    o front atualiza a tela de forma otimista antes da resposta, então a segunda
    chamada chegando é cenário normal, não erro.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "INSERT INTO public.message_reactions (message_id, user_id, emoji) "
            "VALUES ($1::uuid, $2::uuid, $3) ON CONFLICT DO NOTHING",
            dados.message_id, usuario.id, dados.emoji,
        )


@router.delete("/reactions", status_code=status.HTTP_204_NO_CONTENT)
async def desreagir(
    message_id: str = Query(),
    emoji: str = Query(),
    usuario: Usuario = Depends(usuario_atual),
):
    """Remove a minha reação. Só a minha — o `user_id` vem do token, não do
    cliente, então não há como apagar a reação de outra pessoa."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "DELETE FROM public.message_reactions "
            "WHERE message_id = $1::uuid AND user_id = $2::uuid AND emoji = $3",
            message_id, usuario.id, emoji,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Rascunhos
# ─────────────────────────────────────────────────────────────────────────────


class RascunhoOut(BaseModel):
    content: str = ""


class RascunhoIn(BaseModel):
    content: str = ""


@router.get("/drafts/{draft_key:path}", response_model=RascunhoOut)
async def ler_rascunho(draft_key: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        valor = await conn.fetchval(
            "SELECT content FROM public.drafts WHERE user_id = $1::uuid AND draft_key = $2",
            usuario.id, draft_key,
        )
    return RascunhoOut(content=valor or "")


@router.put("/drafts/{draft_key:path}", status_code=status.HTTP_204_NO_CONTENT)
async def gravar_rascunho(
    draft_key: str,
    dados: RascunhoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Grava o rascunho. Conteúdo vazio **apaga** a linha.

    Era o que o hook fazia: ao esvaziar o campo ele chamava o delete em vez do
    upsert. Guardar rascunho vazio faria a tela restaurar string vazia por cima
    do que o usuário digitou em outra aba.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        if not dados.content.strip():
            await conn.execute(
                "DELETE FROM public.drafts WHERE user_id = $1::uuid AND draft_key = $2",
                usuario.id, draft_key,
            )
            return
        await conn.execute(
            """
            INSERT INTO public.drafts (user_id, draft_key, content)
            VALUES ($1::uuid, $2, $3)
            ON CONFLICT (user_id, draft_key)
            DO UPDATE SET content = EXCLUDED.content, updated_at = now()
            """,
            usuario.id, draft_key, dados.content,
        )
