"""Canais, membros e mensagens de canal — substitui `use-channels.ts`.

É o chat entre pessoas (e agentes) da instalação, separado do chat um-a-um com
agente, que vive em `/conversations`.

⚠️ **O tempo real fica pendente.** O hook assinava `postgres_changes` em três
eventos (INSERT, UPDATE e DELETE de `channel_messages`) e era isso que trocava a
mensagem otimista pela persistida. Sem Realtime, o `POST` passa a **devolver a
linha gravada** para a tela fazer essa troca sozinha — foi assim que
`/conversations` resolveu o mesmo problema. Mensagem de outra pessoa continua só
aparecendo ao recarregar até o Realtime ser portado.
"""

import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.realtime import hub, topico_canal

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/channels", tags=["channels"])

_TIPOS = {"public", "private", "dm"}
_TIPOS_MEMBRO = {"human", "agent"}
_PAGINA = 200

_COLUNAS_MSG = """
    m.id::text AS id, m.channel_id::text AS channel_id, m.author_id,
    m.author_type::text AS author_type, m.author_name, m.author_avatar,
    m.content, m.thread_id::text AS thread_id, m.audio_url, m.attachments,
    to_char(m.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at,
    to_char(m.edited_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS edited_at,
    to_char(m.deleted_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS deleted_at
"""


class CanalOut(BaseModel):
    id: str
    name: str
    description: str | None = None
    type: str
    created_by: str
    created_at: str


class CanalIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    type: str = "public"
    # Ids de pessoas e de agentes que entram junto com o canal. Separados porque
    # `channel_members.member_type` distingue os dois, e `user_id` da tabela é
    # `text` justamente para caber agent_id.
    member_ids: list[str] = []
    agent_ids: list[str] = []


class MembroOut(BaseModel):
    channel_id: str
    user_id: str
    member_type: str
    joined_at: str


class MensagemCanalOut(BaseModel):
    id: str
    channel_id: str
    author_id: str
    author_type: str
    author_name: str
    author_avatar: str | None = None
    content: str
    thread_id: str | None = None
    audio_url: str | None = None
    attachments: list[dict] | None = None
    created_at: str
    edited_at: str | None = None
    deleted_at: str | None = None


class MensagemCanalIn(BaseModel):
    content: str = ""
    author_type: str = "human"
    author_name: str | None = None
    author_avatar: str | None = None
    audio_url: str | None = None
    attachments: list[dict] | None = None
    thread_id: str | None = None
    # Quem assina a mensagem. Só é aceito diferente do usuário do token quando o
    # autor é agente — pessoa nenhuma manda mensagem no nome de outra.
    author_id: str | None = None


def _msg_saida(linha) -> MensagemCanalOut:
    d = dict(linha)
    bruto = d.get("attachments")
    if bruto:
        d["attachments"] = json.loads(bruto) if isinstance(bruto, str) else bruto
    return MensagemCanalOut(**d)


def _instante(valor: str | None, campo: str) -> datetime | None:
    if valor is None:
        return None
    try:
        return datetime.fromisoformat(valor)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"`{campo}` precisa ser um timestamp ISO válido."
        )


@router.get("", response_model=list[CanalOut])
async def listar(usuario: Usuario = Depends(usuario_atual)):
    """Canais que este usuário enxerga — o RLS decide quais.

    Ordem crescente de criação, como no hook: a lista lateral fica estável e
    canal novo aparece no fim, em vez de embaralhar tudo a cada criação.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT id::text AS id, name, description, type::text AS type,
                   created_by::text AS created_by,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
              FROM public.channels ORDER BY created_at
            """
        )
    return [CanalOut(**dict(l)) for l in linhas]


@router.post("", response_model=CanalOut, status_code=status.HTTP_201_CREATED)
async def criar(dados: CanalIn, usuario: Usuario = Depends(usuario_atual)):
    """Cria o canal e as associações numa transação só.

    No hook eram quatro chamadas independentes: cria o canal, adiciona o criador,
    adiciona as pessoas, adiciona os agentes. Cada uma podia falhar sozinha, e o
    log do erro era um `console.error` — dava para acabar com canal criado sem
    membro nenhum, inclusive sem o criador, e portanto invisível para todo mundo
    por causa do próprio RLS.
    """
    if dados.type not in _TIPOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"type inválido. Use um de: {', '.join(sorted(_TIPOS))}.",
        )

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        async with conn.transaction():
            linha = await conn.fetchrow(
                """
                INSERT INTO public.channels (name, description, type, created_by)
                VALUES ($1, $2, $3::public.channel_type, $4::uuid)
                RETURNING id::text AS id, name, description, type::text AS type,
                          created_by::text AS created_by,
                          to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
                """,
                dados.name, dados.description or None, dados.type, usuario.id,
            )
            canal_id = linha["id"]

            # O criador entra sempre e primeiro: sem ele o RLS esconde o canal
            # do próprio autor.
            membros = [(usuario.id, "human")]
            membros += [(m, "human") for m in dados.member_ids if m != usuario.id]
            membros += [(a, "agent") for a in dados.agent_ids]

            for membro_id, tipo in membros:
                await conn.execute(
                    """
                    INSERT INTO public.channel_members (channel_id, user_id, member_type)
                    VALUES ($1::uuid, $2, $3)
                    ON CONFLICT (channel_id, user_id) DO NOTHING
                    """,
                    canal_id, membro_id, tipo,
                )
    logger.info("Canal %s criado por %s com %d membros", canal_id, usuario.id, len(membros))
    return CanalOut(**dict(linha))


@router.delete("/{channel_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Apaga o canal. Quem pode é decidido pelo RLS, não por regra daqui."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.channels WHERE id = $1::uuid", channel_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        # Zero linhas pode ser inexistente ou sem permissão. Não distinguir é
        # deliberado: dizer "existe mas você não pode" entrega a existência.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")


@router.get("/{channel_id}/members", response_model=list[MembroOut])
async def membros(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT channel_id::text AS channel_id, user_id, member_type,
                   to_char(joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS joined_at
              FROM public.channel_members WHERE channel_id = $1::uuid
             ORDER BY joined_at
            """,
            channel_id,
        )
    return [MembroOut(**dict(l)) for l in linhas]


@router.put("/{channel_id}/members/me", status_code=status.HTTP_204_NO_CONTENT)
async def entrar(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Entra no canal. Repetir não é erro — era `upsert ignoreDuplicates`."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "INSERT INTO public.channel_members (channel_id, user_id, member_type) "
            "VALUES ($1::uuid, $2, 'human') ON CONFLICT (channel_id, user_id) DO NOTHING",
            channel_id, usuario.id,
        )


@router.get("/{channel_id}/messages", response_model=list[MensagemCanalOut])
async def mensagens(
    channel_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=_PAGINA, ge=1, le=500),
    desde: str | None = Query(
        default=None,
        description="Timestamp ISO. Traz deste ponto em diante — usado ao abrir uma "
        "mensagem antiga e precisar do trecho contíguo até agora.",
    ),
):
    """Mensagens do canal, em ordem cronológica.

    Só o nível de cima: `thread_id IS NULL`. As respostas de thread são
    carregadas à parte, pelo painel de thread — era assim no hook, e trazer tudo
    junto misturaria resposta com mensagem principal na tela.
    """
    condicoes = ["m.channel_id = $1::uuid", "m.thread_id IS NULL"]
    args: list = [channel_id]

    corte = _instante(desde, "desde")
    if corte is not None:
        condicoes.append(f"m.created_at >= ${len(args) + 1}")
        args.append(corte)
        ordem, limite_sql = "ASC", ""
    else:
        # Sem corte, queremos as últimas: ordena decrescente, limita, e a
        # inversão vem depois. Ordenar crescente traria as primeiras do canal.
        ordem, limite_sql = "DESC", f"LIMIT ${len(args) + 1}"
        args.append(limite)

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS_MSG} FROM public.channel_messages m "
            f"WHERE {' AND '.join(condicoes)} "
            f"ORDER BY m.created_at {ordem} {limite_sql}",
            *args,
        )
    saida = [_msg_saida(l) for l in linhas]
    return saida if corte is not None else list(reversed(saida))


@router.post("/{channel_id}/messages", response_model=MensagemCanalOut,
             status_code=status.HTTP_201_CREATED)
async def enviar(
    channel_id: str,
    dados: MensagemCanalIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Grava a mensagem e devolve a linha persistida.

    Devolver a linha é o que substitui o Realtime: a tela adiciona a mensagem de
    forma otimista com um id temporário e troca pelo que volta daqui. Sem isso,
    a bolha otimista ficaria para sempre e duplicaria ao recarregar.

    O nome e o avatar do autor humano são resolvidos **aqui** quando não vierem.
    O hook fazia uma consulta extra a `profiles` no navegador só para isso, e a
    justificativa dele era evitar resposta de thread sem avatar.
    """
    if dados.author_type not in _TIPOS_MEMBRO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"author_type inválido. Use um de: {', '.join(sorted(_TIPOS_MEMBRO))}.",
        )

    autor = dados.author_id or usuario.id
    if dados.author_type == "human" and autor != usuario.id:
        # Assinar mensagem com o id de outra pessoa. O RLS provavelmente barra,
        # mas isto é regra de negócio e merece erro claro.
        raise HTTPException(
            status.HTTP_403_FORBIDDEN, "Não é possível enviar mensagem em nome de outra pessoa."
        )

    nome, avatar = dados.author_name, dados.author_avatar
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        if dados.author_type == "human" and (not nome or not avatar or "@" in (nome or "")):
            perfil = await conn.fetchrow(
                "SELECT full_name, avatar_url FROM public.profiles WHERE id = $1::uuid", autor
            )
            if perfil:
                nome = nome if (nome and "@" not in nome) else (perfil["full_name"] or nome)
                avatar = avatar or perfil["avatar_url"]

        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.channel_messages
                (channel_id, author_id, author_type, author_name, author_avatar,
                 content, audio_url, attachments, thread_id)
            VALUES ($1::uuid, $2, $3::public.author_type, $4, $5, $6, $7, $8::jsonb,
                    NULLIF($9, '')::uuid)
            RETURNING {_COLUNAS_MSG.replace('m.', '')}
            """,
            channel_id, autor, dados.author_type, nome or autor, avatar,
            dados.content, dados.audio_url,
            json.dumps(dados.attachments) if dados.attachments else None,
            dados.thread_id or "",
        )
    saida = _msg_saida(linha)
    # Avisa quem está com o canal aberto. Publicar **depois** da transação é
    # essencial: avisar antes faria a tela buscar uma mensagem que ainda não
    # está visível para outra conexão.
    hub.publicar(topico_canal(channel_id), "mensagem", saida.model_dump())
    return saida


@router.get("/{channel_id}/messages/{message_id}", response_model=MensagemCanalOut)
async def mensagem(
    channel_id: str,
    message_id: str,
    usuario: Usuario = Depends(usuario_atual),
):
    """Uma mensagem pelo id.

    Existe para o link direto vindo da busca: a tela precisa saber o horário da
    mensagem alvo para então carregar o trecho contíguo dali até agora, com
    `?desde=`. Sem isto teria que varrer páginas para trás até topar com ela.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS_MSG} FROM public.channel_messages m "
            f"WHERE m.id = $1::uuid AND m.channel_id = $2::uuid",
            message_id, channel_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mensagem não encontrada.")
    return _msg_saida(linha)
