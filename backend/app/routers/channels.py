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

import asyncio
import json
import logging
import re
from datetime import datetime
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente, obter_cliente_de_espera
from app.realtime import hub, topico_canal
from app.routers.conversations import _texto_da_resposta

import asyncpg


def traduzir_hs001(erro: Exception) -> HTTPException | None:
    """O erro do trigger da 014, virado 403 com o texto que ele já traz.

    O trigger é a defesa e o Python é a cortesia: quando a validação daqui
    deixa passar um caminho que ninguém previu, é este tradutor que evita a
    pessoa receber um 500 com SQL dentro.

    ⚠️ `erro.message`, não `str(erro)`. `str()` de um `PostgresError` inclui o
    `DETAIL` (`pessoa=<uuid>;agente=<id>`) que o trigger anexa para quem for
    ler o log — e um 403 não é log, é resposta para a própria pessoa. `.message`
    devolve só a frase da `RAISE EXCEPTION`, sem o detalhe interno.
    """
    if isinstance(erro, asyncpg.PostgresError) and getattr(erro, "sqlstate", None) == "HS001":
        return HTTPException(status.HTTP_403_FORBIDDEN, getattr(erro, "message", str(erro)))
    return None


def traduzir_rls(erro: Exception) -> HTTPException | None:
    """A negativa de RLS na inserção de membro, virada 403.

    A policy `Users join allowed channels` só deixa o criador do canal (ou
    super_admin) inserir OUTRA pessoa; quem tenta e não é dono cai em
    `insufficient_privilege` (`42501`). Sem isto, adicionar alguém a um DM que
    não se criou vira 500 em vez de 403 — a checagem de "sou membro" que
    `adicionar_membros` já faz não cobre este caso, porque em DM ela não exige
    ser o criador, só estar dentro.
    """
    if isinstance(erro, asyncpg.PostgresError) and getattr(erro, "sqlstate", None) == "42501":
        return HTTPException(
            status.HTTP_403_FORBIDDEN, "Você não tem permissão para adicionar estes membros."
        )
    return None


def _normalizar_agent_id(agent_id: str) -> str:
    """Sem espaço nas pontas, minúsculo, sem o prefixo `openclaw:` — a forma
    que `agent_profiles.agent_id` guarda.

    `agent_ids` chega cru do corpo do request. Sem normalizar antes de checar
    E antes de gravar, `"Iris"` ou `"openclaw:iris"` não bate com a linha do
    agente numa comparação de string exata, cai em "agente sem perfil libera"
    (regra que existe para *exibir* lista, não para autorizar) e o invariante
    fura com uma letra maiúscula no corpo do request.
    """
    return agent_id.strip().lower().removeprefix("openclaw:")


async def _agentes_desconhecidos(conn, agent_ids: list[str]) -> list[str]:
    """Quais destes ids (já normalizados) não têm linha em `agent_profiles`.

    `pode_ver_agente` libera agente sem perfil de propósito — é a regra que
    deixa `GET /agents` exibir um agente recém-sincronizado do gateway e ainda
    sem configuração de acesso. Essa mesma regra falha aberto se for usada
    para *autorizar* entrada em canal: um id inventado ou mal digitado também
    "libera". Por isso quem exige agente conhecido é este portão — a função de
    acesso continua igual, ela é para exibição, não para isto.
    """
    if not agent_ids:
        return []
    linhas = await conn.fetch(
        "SELECT agent_id FROM public.agent_profiles WHERE agent_id = ANY($1::text[])",
        list(dict.fromkeys(agent_ids)),
    )
    conhecidos = {l["agent_id"] for l in linhas}
    return [a for a in dict.fromkeys(agent_ids) if a not in conhecidos]


# A mesma consulta que `_primeiro_par_sem_acesso` roda — extraída para
# constante porque `scripts/provar_invariante.py` a importa daqui para provar
# contra um banco de verdade, em vez de copiar o texto (duas cópias divergem
# sem avisar ninguém; ver o script para o motivo de ele existir).
SQL_PAR_SEM_ACESSO = """
    WITH humanos AS (
        SELECT user_id FROM public.channel_members
         WHERE channel_id = $1::uuid AND member_type = 'human'
        UNION
        SELECT unnest($2::text[])
    ), agentes AS (
        SELECT user_id FROM public.channel_members
         WHERE channel_id = $1::uuid AND member_type = 'agent'
        UNION
        SELECT unnest($3::text[])
    )
    SELECT COALESCE(NULLIF(p.full_name, ''), p.email, h.user_id) AS pessoa,
           COALESCE(ap.name, a.user_id)                          AS agente
      FROM humanos h
      CROSS JOIN agentes a
      LEFT JOIN public.profiles p ON p.id::text = h.user_id
      LEFT JOIN public.agent_profiles ap ON ap.agent_id = a.user_id
     WHERE NOT public.pode_ver_agente(h.user_id::uuid, a.user_id)
     LIMIT 1
"""


async def _primeiro_par_sem_acesso(
    conn, channel_id: str, user_ids: list[str], agent_ids: list[str]
) -> tuple[str, str] | None:
    """O primeiro par (pessoa, agente) do canal que não fecha, com nomes.

    O par pode ser entre quem entra e quem JÁ está no canal — por isso a
    consulta une as duas listas com os membros de hoje antes de cruzar. Validar
    só quem entra deixaria passar exatamente o caso que motivou a regra.
    """
    for uid in user_ids:
        try:
            UUID(uid)
        except (ValueError, AttributeError, TypeError):
            # `user_ids` chega cru do corpo do request. Sem isto, um id mal
            # formado só aparece dentro do `::uuid` da consulta como `22P02`
            # — 500 em vez do 400 que uma entrada ruim merece.
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"'{uid}' não é um id de pessoa válido."
            )
    linha = await conn.fetchrow(SQL_PAR_SEM_ACESSO, channel_id, user_ids, agent_ids)
    return (linha["pessoa"], linha["agente"]) if linha else None


logger = logging.getLogger(__name__)

router = APIRouter(prefix="/channels", tags=["channels"])

# Quanto se espera pelo agente numa menção. Bem mais que os 20s do chat: em
# canal ninguém está olhando a tela esperando, e a alternativa a esperar é
# publicar o aviso de falha para um agente que ainda vai responder.
_ESPERA_CANAL_MS = 140_000

# Tarefas de resposta em voo. O asyncio só guarda referência fraca — sem este
# conjunto o coletor de lixo pode encerrar a tarefa no meio da resposta.
_TAREFAS: set[asyncio.Task] = set()

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

            # ⚠️ Normalizado ANTES de checar e ANTES de gravar — é a mesma
            # forma que vai para o `INSERT` logo abaixo. Normalizar só na
            # checagem e gravar o valor cru divergiria checagem de dado.
            agentes_norm = [_normalizar_agent_id(a) for a in dados.agent_ids]

            desconhecidos = await _agentes_desconhecidos(conn, agentes_norm)
            if desconhecidos:
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, f"Agente {desconhecidos[0]} não existe."
                )

            # O criador entra sempre e primeiro: sem ele o RLS esconde o canal
            # do próprio autor.
            membros = [(usuario.id, "human")]
            membros += [(m, "human") for m in dados.member_ids if m != usuario.id]
            membros += [(a, "agent") for a in agentes_norm]

            # ⚠️ O trigger da 014 recusa canal que nasce com pessoa e agente
            # incompatíveis. A transação inteira volta atrás — que é o
            # comportamento certo: canal criado pela metade foi o defeito que
            # esta função foi escrita para evitar.
            try:
                for membro_id, tipo in membros:
                    await conn.execute(
                        """
                        INSERT INTO public.channel_members (channel_id, user_id, member_type)
                        VALUES ($1::uuid, $2, $3)
                        ON CONFLICT (channel_id, user_id) DO NOTHING
                        """,
                        canal_id, membro_id, tipo,
                    )
            except asyncpg.PostgresError as erro:
                traduzido = traduzir_hs001(erro)
                if traduzido is not None:
                    raise traduzido from erro
                raise
    logger.info("Canal %s criado por %s com %d membros", canal_id, usuario.id, len(membros))
    return CanalOut(**dict(linha))


class CanalEdicaoIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    type: str


@router.patch("/{channel_id}", response_model=CanalOut)
async def editar(
    channel_id: str,
    dados: CanalEdicaoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Renomeia o canal e troca entre público e privado."""
    if dados.type not in _TIPOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"type inválido. Use um de: {', '.join(sorted(_TIPOS))}.",
        )
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            UPDATE public.channels
               SET name = $2, description = $3, type = $4::public.channel_type
             WHERE id = $1::uuid
            RETURNING id::text AS id, name, description, type::text AS type,
                      created_by::text AS created_by,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS') || 'Z' AS created_at
            """,
            channel_id, dados.name.strip(), (dados.description or "").strip() or None,
            dados.type,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")
    return CanalOut(**dict(linha))


class InterlocutorOut(BaseModel):
    channel_id: str
    user_id: str
    full_name: str | None = None
    email: str | None = None
    avatar_url: str | None = None
    status: str | None = None


@router.get("/dms/interlocutores", response_model=list[InterlocutorOut])
async def interlocutores(usuario: Usuario = Depends(usuario_atual)):
    """Com quem eu falo em cada DM minha, já com o perfil da pessoa junto.

    ⚠️ **Antes de `GET /{channel_id}`**, senão "dms" vira id de canal.

    A tela fazia isto em duas consultas e um `Map` no navegador: buscar os
    membros de todas as DMs, descobrir quem não sou eu, e então buscar os
    perfis. O join é do banco — é literalmente para o que ele serve, e assim a
    lista de ids não faz a volta pela rede no meio do caminho.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT m.channel_id::text AS channel_id, m.user_id,
                   p.full_name, p.email, p.avatar_url, p.status
              FROM public.channel_members m
              JOIN public.channels c ON c.id = m.channel_id AND c.type = 'dm'
              LEFT JOIN public.profiles p ON p.id::text = m.user_id
             WHERE m.member_type = 'human'
               AND m.user_id <> $1
               AND EXISTS (
                     SELECT 1 FROM public.channel_members meu
                      WHERE meu.channel_id = m.channel_id AND meu.user_id = $1
                   )
            """,
            usuario.id,
        )
    return [InterlocutorOut(**dict(l)) for l in linhas]


class AgenteDeDmOut(BaseModel):
    channel_id: str
    agent_id: str


@router.get("/dms/agentes", response_model=list[AgenteDeDmOut])
async def agentes_de_dm(usuario: Usuario = Depends(usuario_atual)):
    """Qual DM minha pertence a qual agente.

    ⚠️ **Antes de `GET /{channel_id}`**, senão "dms" vira id de canal.

    A tela montava isso com duas consultas — achar os canais onde o agente é
    membro, depois cruzar com os canais onde eu sou — e um `Set` no meio. O
    cruzamento é do banco.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT a.channel_id::text AS channel_id, a.user_id AS agent_id
              FROM public.channel_members a
             WHERE a.member_type = 'agent'
               AND EXISTS (
                     SELECT 1 FROM public.channel_members eu
                      WHERE eu.channel_id = a.channel_id
                        AND eu.user_id = $1 AND eu.member_type = 'human'
                   )
            """,
            usuario.id,
        )
    return [AgenteDeDmOut(**dict(l)) for l in linhas]


class MembrosDeCanaisOut(BaseModel):
    channel_id: str
    agents: list[str] = []
    humans: list[str] = []


@router.get("/membros", response_model=list[MembrosDeCanaisOut])
async def membros_dos_meus_canais(usuario: Usuario = Depends(usuario_atual)):
    """Os membros de todos os canais de que participo, agrupados por canal.

    ⚠️ **Antes de `GET /{channel_id}`.**

    Existe para a detecção de canal fantasma — DM cujo agente já não existe. A
    tela pedia os membros de vários canais de uma vez e agrupava; agrupar aqui
    poupa a volta e o `Record` intermediário.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT m.channel_id::text AS channel_id,
                   -- ⚠️ `COALESCE(..., '{}')` por fora: quando o FILTER não casa
                   -- com nada, o `array_agg` devolve **NULL**, não array vazio —
                   -- e o `array_remove` de NULL continua NULL. Sem isto, canal
                   -- só de gente responde 500 na validação do `list[str]`.
                   COALESCE(array_remove(array_agg(m.user_id) FILTER (WHERE m.member_type = 'agent'), NULL), '{}') AS agents,
                   COALESCE(array_remove(array_agg(m.user_id) FILTER (WHERE m.member_type = 'human'), NULL), '{}') AS humans
              FROM public.channel_members m
             WHERE EXISTS (
                     SELECT 1 FROM public.channel_members eu
                      WHERE eu.channel_id = m.channel_id AND eu.user_id = $1
                   )
             GROUP BY m.channel_id
            """,
            usuario.id,
        )
    return [MembrosDeCanaisOut(**dict(l)) for l in linhas]


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
        try:
            await conn.execute(
                "INSERT INTO public.channel_members (channel_id, user_id, member_type) "
                "VALUES ($1::uuid, $2, 'human') ON CONFLICT (channel_id, user_id) DO NOTHING",
                channel_id, usuario.id,
            )
        except asyncpg.PostgresError as erro:
            # ⚠️ Quarta rota que insere em `channel_members` — o trigger da
            # 014 já a alcança sozinho (é o canal público com agente que este
            # usuário não pode ver). O que faltava era só a tradução: sem
            # isto, entrar num canal assim vira 500 com SQL dentro.
            traduzido = traduzir_hs001(erro)
            if traduzido is not None:
                raise traduzido from erro
            raise


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
            VALUES ($1::uuid, $2, $3::public.author_type, $4, $5, $6, $7, $8::text::jsonb,
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


# ─────────────────────────────────────────────────────────────────────────────
# Resposta de agente no canal — portado de `channel-agent-reply`
# ─────────────────────────────────────────────────────────────────────────────

# Respostas que o gateway devolve quando não tem o que dizer. Publicá-las no
# canal era ruído — pior, ruído com cara de resposta.
_RESPOSTAS_VAZIAS = {
    "no response from openclaw.", "no response from openclaw",
    "sem resposta do agente.", "no response from",
}

# Quantas mensagens de contexto o agente recebe. Eram 10 e viraram 30 na edge:
# com 10 o agente perdia o pedido original quando a conversa andava no meio da
# resposta e respondia à mensagem errada.
_CONTEXTO = 30

_AVISO_FALHA = (
    "⚠️ Não consegui responder agora (o gateway falhou ou expirou). "
    "Tente mencionar novamente em instantes."
)


def _nome_de_exibicao(agent_id: str) -> str:
    normal = _normalizar_agent_id(agent_id)
    return " ".join(p.capitalize() for p in re.split(r"[-_\s]+", normal) if p) or normal


async def _responder_no_canal(channel_id: str, agent_id: str) -> None:
    """Roda em segundo plano: monta o contexto, pergunta ao agente, publica.

    ⚠️ **Nunca levanta.** É uma tarefa solta — exceção aqui não chega a
    requisição nenhuma, só morreria no log do asyncio. Falha vira uma mensagem
    visível no canal, e o motivo é que silêncio é indistinguível de "o agente
    está pensando": a pessoa fica esperando para sempre.
    """
    nome = _nome_de_exibicao(agent_id)
    try:
        async with sessao(role="service_role") as conn:
            historico = await conn.fetch(
                """
                SELECT author_name, author_type, author_id, content,
                       to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
                  FROM public.channel_messages
                 WHERE channel_id = $1::uuid
                 ORDER BY created_at DESC
                 LIMIT $2
                """,
                channel_id, _CONTEXTO,
            )
        historico = list(reversed(historico))
        if not historico:
            return

        # Marco de deduplicação: se já existir resposta deste agente depois da
        # última mensagem de quem não é ele, outra chamada já respondeu. Duas
        # menções quase simultâneas disparavam duas tarefas.
        gatilho = next((m for m in reversed(historico) if m["author_id"] != agent_id), None)
        if gatilho is None:
            return
        marco = gatilho["created_at"]

        # O contexto vai como texto porque o `chat.send` manda uma mensagem a um
        # agente configurado — não existe array de `messages` como havia no
        # /v1/chat/completions que a edge usava.
        linhas = [
            f"{m['author_name'] or m['author_id']}: {m['content']}"
            for m in historico if (m["content"] or "").strip()
        ]
        pedido = (
            f"Você está no canal e foi mencionado. Responda à última mensagem.\n\n"
            f"--- conversa recente ---\n" + "\n".join(linhas)
        )

        c = await cfg.carregar()
        if not c.configurado:
            logger.warning("Menção a %s em %s ignorada: gateway não configurado.", agent_id, channel_id)
            return

        # Sessão nova a cada resposta, de propósito: o contexto vai inteiro na
        # mensagem, então uma sessão persistente receberia a mesma conversa de
        # novo a cada menção. A edge era stateless pelo mesmo motivo.
        chave = f"channel:{channel_id}:{agent_id}:{uuid4()}"
        run_id = f"hsos-{uuid4()}"
        cliente = obter_cliente(c.url, c.token)
        espera = obter_cliente_de_espera(c.url, c.token)

        texto = ""
        try:
            await cliente.chamar("chat.send", {
                "agentId": agent_id, "sessionKey": chave,
                "message": pedido, "idempotencyKey": run_id,
            })
            r = await espera.chamar("agent.wait", {"runId": run_id, "timeoutMs": _ESPERA_CANAL_MS})
            if r.get("status") != "timeout":
                hist = await cliente.chamar("chat.history", {"sessionKey": chave, "limit": 20})
                texto = _texto_da_resposta(hist.get("messages") or [], 0)
        except ErroGateway as e:
            logger.warning("Agente %s falhou em %s: %s", agent_id, channel_id, e)

        if texto.strip().lower() in _RESPOSTAS_VAZIAS:
            logger.info("Resposta vazia de %s em %s descartada.", agent_id, channel_id)
            texto = ""

        await _publicar_do_agente(channel_id, agent_id, nome, texto or _AVISO_FALHA, marco)
    except Exception:  # noqa: BLE001
        logger.exception("Resposta de %s em %s morreu", agent_id, channel_id)
    finally:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "UPDATE public.channel_agent_activity SET finished_at = now(), updated_at = now() "
                " WHERE channel_id = $1::uuid AND agent_id = $2",
                channel_id, agent_id,
            )


async def _publicar_do_agente(
    channel_id: str, agent_id: str, nome: str, texto: str, marco: str
) -> None:
    """Grava a mensagem do agente, a menos que ele já tenha respondido depois do marco.

    ⚠️ O marco vai como `$3::text::timestamptz`, não `$3::timestamptz`. Com o
    cast direto o asyncpg deduz timestamptz do parâmetro e recusa a string com
    `expected a datetime.date or datetime.datetime instance` — mesma armadilha
    do `::jsonb`. O `::text::` no meio é o que faz o Postgres converter.
    """
    async with sessao(role="service_role") as conn:
        ja = await conn.fetchval(
            """
            SELECT 1 FROM public.channel_messages
             WHERE channel_id = $1::uuid AND author_id = $2 AND author_type = 'agent'
               AND created_at > $3::text::timestamptz
             LIMIT 1
            """,
            channel_id, agent_id, marco,
        )
        if ja:
            logger.info("Duplicata evitada: %s já respondeu em %s.", agent_id, channel_id)
            return

        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.channel_messages
                (channel_id, author_id, author_type, author_name, content)
            VALUES ($1::uuid, $2, 'agent', $3, $4)
            RETURNING {_COLUNAS_MSG.replace('m.', '')}
            """,
            channel_id, agent_id, nome, texto,
        )
        # Notifica quem é gente. Agente não recebe notificação — ele não tem
        # tela para olhar, e as linhas só encheriam a tabela.
        await conn.execute(
            """
            INSERT INTO public.notifications (user_id, channel_id, author_name, content_preview)
            SELECT user_id::uuid, $1::uuid, $2, $3
              FROM public.channel_members
             WHERE channel_id = $1::uuid AND member_type = 'human'
            """,
            channel_id, nome, texto[:100],
        )

    saida = _msg_saida(linha)
    hub.publicar(topico_canal(channel_id), "mensagem", saida.model_dump())
    logger.info("Agente %s respondeu em %s.", agent_id, channel_id)


@router.post("/{channel_id}/agentes/{agent_id}/responder",
             status_code=status.HTTP_202_ACCEPTED)
async def acionar_agente(
    channel_id: str,
    agent_id: str,
    usuario: Usuario = Depends(usuario_atual),
):
    """Aciona um agente para responder no canal. Devolve 202 na hora.

    A resposta leva de segundos a minutos e não cabe numa requisição — a tela
    fica sabendo pelo WebSocket, como qualquer outra mensagem do canal.

    Marca `channel_agent_activity` **antes** de soltar a tarefa: é o que faz o
    canal inteiro ver que o agente está trabalhando. Antes disso só quem
    mencionou via o indicador, e para os outros o canal parecia parado.
    """
    agente = _normalizar_agent_id(agent_id)
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        canal = await conn.fetchval(
            "SELECT 1 FROM public.channels WHERE id = $1::uuid", channel_id
        )
        if not canal:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")

        pode = await conn.fetchval(
            "SELECT public.pode_ver_agente($1::uuid, $2)", usuario.id, agente
        )
        if not pode:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Você não tem acesso a este agente."
            )

    async with sessao(role="service_role") as conn:
        await conn.execute(
            """
            INSERT INTO public.channel_agent_activity
                (channel_id, agent_id, started_at, updated_at, passo, finished_at)
            VALUES ($1::uuid, $2, now(), now(), NULL, NULL)
            ON CONFLICT (channel_id, agent_id) DO UPDATE
                SET started_at = now(), updated_at = now(),
                    passo = NULL, finished_at = NULL
            """,
            channel_id, agente,
        )

    # `create_task` e não `BackgroundTasks`: o BackgroundTasks só começa depois
    # da resposta ser enviada, e queremos o agente andando enquanto o 202 volta.
    tarefa = asyncio.create_task(_responder_no_canal(channel_id, agente))
    _TAREFAS.add(tarefa)  # sem referência forte o coletor pode matar a tarefa no meio
    tarefa.add_done_callback(_TAREFAS.discard)
    return {"ok": True, "status": "processando"}


@router.get("/{channel_id}/arquivos", response_model=list[MensagemCanalOut])
async def arquivos(
    channel_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=500, ge=1, le=1000),
):
    """Só as mensagens do canal que carregam anexo — é o painel de arquivos.

    Filtrar aqui e não na tela importa: um canal ativo tem milhares de
    mensagens e o painel precisa de umas dezenas. Trazer tudo para peneirar no
    navegador era o que fazia o painel demorar a abrir em canal movimentado.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""
            SELECT {_COLUNAS_MSG}
              FROM public.channel_messages m
             WHERE m.channel_id = $1::uuid
               AND m.attachments IS NOT NULL
               AND jsonb_array_length(m.attachments) > 0
               AND m.deleted_at IS NULL
             ORDER BY m.created_at DESC
             LIMIT $2
            """,
            channel_id, limite,
        )
    return [_msg_saida(l) for l in linhas]


class NotificacaoIn(BaseModel):
    author_name: str
    content_preview: str = ""
    message_id: str | None = None


@router.post("/{channel_id}/notificar", status_code=status.HTTP_204_NO_CONTENT)
async def notificar(
    channel_id: str,
    dados: NotificacaoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Avisa os outros humanos do canal que há mensagem nova.

    Quem envia **não** se notifica, e agente nenhum recebe notificação — ele não
    tem tela para olhar e as linhas só encheriam a tabela. Era o mesmo filtro
    que a tela aplicava; aqui ele acompanha o INSERT, sem a lista de
    destinatários voltar pela rede antes.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            """
            INSERT INTO public.notifications
                (user_id, channel_id, message_id, author_name, content_preview)
            SELECT m.user_id::uuid, $1::uuid, NULLIF($2,'')::uuid, $3, $4
              FROM public.channel_members m
             WHERE m.channel_id = $1::uuid
               AND m.member_type = 'human'
               AND m.user_id <> $5
            """,
            channel_id, dados.message_id or "", dados.author_name,
            dados.content_preview[:100], usuario.id,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Threads
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/{channel_id}/threads", response_model=list[MensagemCanalOut])
async def threads(
    channel_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=1000, ge=1, le=2000),
):
    """Todas as respostas de thread do canal, em ordem cronológica.

    A tela deriva daqui a contagem e o último autor de cada thread. Ela faz essa
    agregação porque também precisa da lista de autores para buscar avatares —
    agregar no servidor devolveria menos e obrigaria a uma segunda consulta.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""
            SELECT {_COLUNAS_MSG}
              FROM public.channel_messages m
             WHERE m.channel_id = $1::uuid AND m.thread_id IS NOT NULL
               AND m.deleted_at IS NULL
             ORDER BY m.created_at
             LIMIT $2
            """,
            channel_id, limite,
        )
    return [_msg_saida(l) for l in linhas]


@router.get("/{channel_id}/threads/{raiz_id}", response_model=list[MensagemCanalOut])
async def thread(
    channel_id: str,
    raiz_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=200, ge=1, le=500),
):
    """As mensagens de uma thread."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"""
            SELECT {_COLUNAS_MSG}
              FROM public.channel_messages m
             WHERE m.channel_id = $1::uuid AND m.thread_id = $2::uuid
               AND m.deleted_at IS NULL
             ORDER BY m.created_at
             LIMIT $3
            """,
            channel_id, raiz_id, limite,
        )
    return [_msg_saida(l) for l in linhas]


# ─────────────────────────────────────────────────────────────────────────────
# Editar, apagar e membros
# ─────────────────────────────────────────────────────────────────────────────


class EdicaoMensagemIn(BaseModel):
    content: str = Field(min_length=1)


@router.patch("/{channel_id}/messages/{message_id}", response_model=MensagemCanalOut)
async def editar_mensagem(
    channel_id: str,
    message_id: str,
    dados: EdicaoMensagemIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Edita a própria mensagem, carimbando `edited_at`.

    O `author_id = $3` no WHERE não é redundância do RLS: é o que garante que
    editar mensagem alheia responda 404 em vez de depender de a policy estar
    escrita como se espera.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            UPDATE public.channel_messages m SET
                content = $4, edited_at = now()
             WHERE m.id = $2::uuid AND m.channel_id = $1::uuid AND m.author_id = $3
               AND m.deleted_at IS NULL
            RETURNING {_COLUNAS_MSG.replace('m.', '')}
            """,
            channel_id, message_id, usuario.id, dados.content,
        )
    if linha is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Mensagem não encontrada ou não é sua."
        )
    saida = _msg_saida(linha)
    hub.publicar(topico_canal(channel_id), "mensagem-editada", saida.model_dump())
    return saida


@router.delete("/{channel_id}/messages/{message_id}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_mensagem(
    channel_id: str,
    message_id: str,
    usuario: Usuario = Depends(usuario_atual),
):
    """Apaga a própria mensagem. **Exclusão lógica.**

    A linha fica porque outras podem referenciá-la como raiz de thread — apagar
    de verdade levaria as respostas junto, e "a conversa sumiu" é pior do que
    "esta mensagem foi removida".
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.channel_messages SET deleted_at = now() "
            " WHERE id = $2::uuid AND channel_id = $1::uuid AND author_id = $3 "
            "   AND deleted_at IS NULL RETURNING id",
            channel_id, message_id, usuario.id,
        )
    if achado is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Mensagem não encontrada ou não é sua."
        )
    hub.publicar(topico_canal(channel_id), "mensagem-removida", {"id": message_id})


@router.delete("/{channel_id}/members/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remover_membro(
    channel_id: str,
    user_id: str,
    usuario: Usuario = Depends(usuario_atual),
):
    """Tira alguém do canal. Serve também para sair sozinho."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.channel_members WHERE channel_id = $1::uuid AND user_id = $2",
            channel_id, user_id,
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Membro não encontrado neste canal.")


class MembrosIn(BaseModel):
    user_ids: list[str] = []
    agent_ids: list[str] = []


@router.post("/{channel_id}/members", status_code=status.HTTP_204_NO_CONTENT)
async def adicionar_membros(
    channel_id: str,
    dados: MembrosIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Acrescenta pessoas e agentes ao canal. Quem já está é ignorado.

    ⚠️ **Até 01/09/2026 esta rota não tinha checagem NENHUMA.** Qualquer pessoa
    autenticada adicionava qualquer pessoa ou agente a qualquer canal — com 4
    pessoas de confiança nunca teve consequência; com 26 dentro, é o caminho
    mais curto para furar o `allowed_user_ids`: basta me pôr num canal onde o
    agente está.

    Três guardas, e as três importam:

    - **ser membro do canal** — quem está fora não mexe em quem está dentro;
    - **administrador para canal que não é DM** — canal de grupo é do admin
      (decisão do Erick, 01/09/2026), e quem cria também é quem chama;
    - **o invariante** — nenhum par pessoa×agente sem acesso, contando quem já
      está no canal.
    """
    # ⚠️ Normalizado ANTES de checar e ANTES de gravar — é a mesma forma que
    # vai para o `INSERT` logo abaixo. Ver `_normalizar_agent_id`.
    agentes_norm = [_normalizar_agent_id(a) for a in dados.agent_ids]
    membros = [(u, "human") for u in dados.user_ids] + [(a, "agent") for a in agentes_norm]
    if not membros:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum membro informado.")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        tipo = await conn.fetchval(
            "SELECT c.type::text FROM public.channels c WHERE c.id = $1::uuid", channel_id
        )
        if tipo is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Canal não encontrado.")

        sou_membro = await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM public.channel_members "
            " WHERE channel_id = $1::uuid AND user_id = $2 AND member_type = 'human')",
            channel_id, usuario.id,
        )
        if not sou_membro:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN, "Só quem está no canal adiciona alguém a ele."
            )

        if tipo != "dm" and usuario.papel != "administrador":
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                "Só o administrador adiciona pessoas a um canal.",
            )

        desconhecidos = await _agentes_desconhecidos(conn, agentes_norm)
        if desconhecidos:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND, f"Agente {desconhecidos[0]} não existe."
            )

        par = await _primeiro_par_sem_acesso(conn, channel_id, dados.user_ids, agentes_norm)
        if par is not None:
            pessoa, agente = par
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                f"{pessoa} não tem acesso ao agente {agente}. "
                "Libere o acesso na tela do agente antes de juntar os dois no mesmo canal.",
            )

        try:
            for membro_id, tipo_membro in membros:
                await conn.execute(
                    "INSERT INTO public.channel_members (channel_id, user_id, member_type) "
                    "VALUES ($1::uuid, $2, $3) ON CONFLICT DO NOTHING",
                    channel_id, membro_id, tipo_membro,
                )
        except asyncpg.PostgresError as erro:
            traduzido = traduzir_hs001(erro) or traduzir_rls(erro)
            if traduzido is not None:
                raise traduzido from erro
            raise


@router.get("/{channel_id}/agentes-trabalhando")
async def agentes_trabalhando(channel_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Quais agentes estão trabalhando neste canal agora, e em que passo.

    "Agora" é `finished_at IS NULL`. O `POST /channels/{id}/agentes/{id}/responder`
    marca a linha ao começar e a fecha no fim, inclusive quando falha.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT agent_id, passo FROM public.channel_agent_activity "
            " WHERE channel_id = $1::uuid AND finished_at IS NULL",
            channel_id,
        )
    return [dict(l) for l in linhas]
