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

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, status
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


# ─────────────────────────────────────────────────────────────────────────────
# Busca global
# ─────────────────────────────────────────────────────────────────────────────


class ResultadoBusca(BaseModel):
    tipo: str  # conversa | canal
    id: str
    origem: str  # agent_id na conversa, channel_id no canal
    autor: str | None = None
    content: str
    created_at: str


@router.get("/busca", response_model=list[ResultadoBusca])
async def busca(
    q: str = Query(min_length=2, description="Pelo menos 2 letras."),
    usuario: Usuario = Depends(usuario_atual),
):
    """Procura o texto nas conversas da pessoa e nas mensagens de canal.

    Duas fontes numa resposta só: a tela mostra as duas listas juntas e fazia
    duas consultas em paralelo do navegador.

    O `ilike` com `%` dos dois lados **não usa índice** — é varredura. Aceitável
    porque o limite é baixo e a busca é interativa, mas é o primeiro lugar a
    olhar quando a instalação crescer; a saída é `pg_trgm`, que já está entre as
    extensões do `000_compat_supabase.sql`.

    O RLS decide o que aparece de canal: a busca não é caminho para ver mensagem
    de canal do qual não se participa.
    """
    padrao = f"%{q}%"
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        conversas = await conn.fetch(
            """
            SELECT id::text AS id, agent_id, content,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
              FROM public.conversations
             WHERE user_id = $1::uuid AND content ILIKE $2
             ORDER BY created_at DESC LIMIT 8
            """,
            usuario.id, padrao,
        )
        canais = await conn.fetch(
            """
            SELECT id::text AS id, channel_id::text AS channel_id, author_name, content,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
              FROM public.channel_messages
             WHERE content ILIKE $1 AND deleted_at IS NULL
             ORDER BY created_at DESC LIMIT 12
            """,
            padrao,
        )
    return (
        [ResultadoBusca(tipo="conversa", id=c["id"], origem=c["agent_id"],
                        content=c["content"] or "", created_at=c["created_at"])
         for c in conversas]
        + [ResultadoBusca(tipo="canal", id=c["id"], origem=c["channel_id"],
                          autor=c["author_name"], content=c["content"] or "",
                          created_at=c["created_at"])
           for c in canais]
    )


@router.get("/analytics/atividade")
async def atividade(
    usuario: Usuario = Depends(usuario_atual),
    desde: str | None = Query(default=None, description="ISO-8601. Sem isto, vale `dias`."),
    dias: int = Query(default=30, ge=1, le=365),
):
    """Quem falou com qual agente nos últimos N dias, já com nome e e-mail.

    A agregação é a função `get_user_agent_activity` do banco, e o nome da
    pessoa vem no mesmo join — a tela buscava os perfis depois, numa segunda
    consulta com a lista de ids que ela acabava de montar.

    Aceita `desde` explícito porque a tela tem seletor de período; `dias` é o
    atalho para quem só quer a janela padrão.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT a.*, p.full_name, p.email
              FROM public.get_user_agent_activity(
                     COALESCE(NULLIF($1,'')::text::timestamptz,
                              now() - make_interval(days => $2))
                   ) a
              LEFT JOIN public.profiles p ON p.id = a.user_id
            """,
            desde or "", dias,
        )
    return json.loads(json.dumps([dict(l) for l in linhas], default=str))


# ─────────────────────────────────────────────────────────────────────────────
# Notificações
# ─────────────────────────────────────────────────────────────────────────────


class NotificacaoOut(BaseModel):
    id: str
    user_id: str
    channel_id: str | None = None
    message_id: str | None = None
    author_name: str | None = None
    content_preview: str | None = None
    read: bool = False
    created_at: str


_COLUNAS_NOTIF = """
    id::text AS id, user_id::text AS user_id, channel_id::text AS channel_id,
    message_id::text AS message_id, author_name, content_preview, read,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
"""


@router.get("/notificacoes", response_model=list[NotificacaoOut])
async def notificacoes(
    usuario: Usuario = Depends(usuario_atual),
    apenas_nao_lidas: bool = Query(default=True),
    limite: int = Query(default=50, ge=1, le=200),
):
    """As notificações desta pessoa. Só as dela — o `user_id` vem do token.

    Não há parâmetro de usuário de propósito: ler notificação alheia não é caso
    de uso de ninguém, e um parâmetro aqui seria uma porta a vigiar.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""
            SELECT {_COLUNAS_NOTIF} FROM public.notifications
             WHERE user_id = $1::uuid AND ($2 IS FALSE OR read = false)
             ORDER BY created_at DESC LIMIT $3
            """,
            usuario.id, apenas_nao_lidas, limite,
        )
    return [NotificacaoOut(**dict(l)) for l in linhas]


class MarcarLidasIn(BaseModel):
    ids: list[str] = []
    channel_id: str | None = None
    channel_ids: list[str] = []
    agent_ids: list[str] = []


@router.post("/notificacoes/lidas", status_code=status.HTTP_204_NO_CONTENT)
async def marcar_lidas(dados: MarcarLidasIn, usuario: Usuario = Depends(usuario_atual)):
    """Marca notificações como lidas, por id ou por canal inteiro.

    Por canal existe porque abrir uma conversa zera tudo dela de uma vez, e
    mandar 40 ids para isso seria a tela fazendo o trabalho do banco.

    `channel_ids` e `agent_ids` cobrem "li tudo deste agente": a DM dele pode ter
    sido criada com qualquer variação do id, então zerar por agente precisa
    aceitar os apelidos e os canais de uma vez. Eram duas chamadas.

    O `user_id` entra no WHERE mesmo com o RLS ativo: é barato e não depende de
    a policy estar como se espera.
    """
    if not (dados.ids or dados.channel_id or dados.channel_ids or dados.agent_ids):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Informe `ids`, `channel_id`, `channel_ids` ou `agent_ids`.",
        )
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            """
            UPDATE public.notifications SET read = true
             WHERE user_id = $1::uuid AND read = false
               AND ( ($2::text[] IS NOT NULL AND array_length($2::text[],1) > 0
                      AND id = ANY($2::uuid[]))
                  OR (NULLIF($3,'') IS NOT NULL AND channel_id = $3::uuid)
                  OR ($4::text[] IS NOT NULL AND array_length($4::text[],1) > 0
                      AND channel_id = ANY($4::uuid[]))
                  OR ($5::text[] IS NOT NULL AND array_length($5::text[],1) > 0
                      AND agent_id = ANY($5::text[])) )
            """,
            usuario.id, dados.ids or None, dados.channel_id or "",
            dados.channel_ids or None, dados.agent_ids or None,
        )


class MarcarNaoLidaIn(BaseModel):
    message_id: str
    channel_id: str | None = None
    agent_id: str | None = None
    author_name: str = "Mensagem"
    content_preview: str = ""


@router.post("/notificacoes/nao-lida", status_code=status.HTTP_201_CREATED)
async def marcar_nao_lida(
    dados: MarcarNaoLidaIn, usuario: Usuario = Depends(usuario_atual)
):
    """Cria uma notificação para si mesmo — o "marcar como não lida" da tela.

    O `user_id` sai do token: notificação é sempre para quem pediu. Marcar
    mensagem como não lida para outra pessoa não é caso de uso de ninguém.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        ident = await conn.fetchval(
            """
            INSERT INTO public.notifications
                (user_id, channel_id, agent_id, message_id, author_name,
                 content_preview, read)
            VALUES ($1::uuid, NULLIF($2,'')::text::uuid, $3, NULLIF($4,'')::text::uuid,
                    $5, $6, false)
            RETURNING id::text
            """,
            usuario.id, dados.channel_id or "", dados.agent_id,
            dados.message_id, dados.author_name, dados.content_preview[:200],
        )
    return {"id": ident}
