"""Consulta dos live artifacts — portado de `artifact-query`.

Um live artifact é HTML gerado por agente que roda no navegador e precisa ler
dados da plataforma. Ele não fala com o banco direto: pede por aqui.

⚠️ **A allowlist de tabelas é a barreira principal, e é do lado do servidor.**
Sem ela, um artefato alucinado (ou malicioso) consultaria qualquer tabela e o RLS
seria a única defesa. Ela **deve espelhar** a lista em
`frontend/src/lib/live-artifacts-context.ts`, que é o que o prompt do agente diz
existir — as duas fora de sincronia produzem artefato que pede tabela recusada.

A consulta roda como `authenticated` com o id do usuário, então o RLS continua
valendo por cima da allowlist: ver a tabela na lista não é ver a linha.
"""

import json
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from asyncpg.exceptions import UniqueViolationError

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/artefatos", tags=["artefatos"])

_TABELAS = {
    "agent_results", "agent_tasks", "agent_activity_log", "conversations",
    "channel_messages", "channels", "automations", "automation_runs",
    "profiles", "live_artifacts", "artifacts_published", "notifications",
    "drafts", "wiki_documents", "wiki_spaces", "teams", "team_agents",
    "skills", "agent_skills",
}

# Nome de coluna aceitável. Vai concatenado no SQL — o driver parametriza valor,
# não identificador —, então a validação aqui é o que impede injeção.
_IDENTIFICADOR = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")
_LIMITE_MAXIMO = 1000


class OrdemIn(BaseModel):
    column: str
    ascending: bool = True


class ConsultaIn(BaseModel):
    table: str
    select: str = "*"
    filters: dict = {}
    order: OrdemIn | None = None
    limit: int = Field(default=100, ge=1, le=_LIMITE_MAXIMO)


def _colunas(select: str) -> str:
    """Valida a lista de colunas. `*` passa; o resto vira lista conferida."""
    if select.strip() == "*":
        return "*"
    nomes = [c.strip() for c in select.split(",") if c.strip()]
    if not nomes or any(not _IDENTIFICADOR.match(c) for c in nomes):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Lista de colunas inválida.")
    return ", ".join(nomes)


@router.post("/consultar")
async def consultar(dados: ConsultaIn, usuario: Usuario = Depends(usuario_atual)):
    """Consulta uma tabela da allowlist.

    Erro de tabela responde **200 com corpo estruturado**, não 4xx. Era assim na
    edge e o motivo é bom: o artefato roda dentro do navegador, e um 4xx aparece
    como erro no console do usuário para algo que é apenas o agente pedindo
    tabela errada. O agente reage ao `code` do corpo.
    """
    if dados.table not in _TABELAS:
        return {
            "ok": False,
            "error": f"Tabela '{dados.table}' não é permitida para consulta.",
            "code": "table_not_allowed",
        }

    colunas = _colunas(dados.select)

    condicoes, valores = [], []
    for coluna, valor in dados.filters.items():
        if not _IDENTIFICADOR.match(coluna):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, f"Nome de coluna inválido: {coluna}."
            )
        valores.append(valor)
        condicoes.append(f"{coluna} = ${len(valores)}")

    sql = f"SELECT {colunas} FROM public.{dados.table}"
    if condicoes:
        sql += " WHERE " + " AND ".join(condicoes)
    if dados.order:
        if not _IDENTIFICADOR.match(dados.order.column):
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST, "Coluna de ordenação inválida."
            )
        sql += f" ORDER BY {dados.order.column} {'ASC' if dados.order.ascending else 'DESC'}"
    sql += f" LIMIT {min(dados.limit, _LIMITE_MAXIMO)}"

    try:
        async with sessao(role="authenticated", user_id=usuario.id) as conn:
            linhas = await conn.fetch(sql, *valores)
    except Exception as e:  # noqa: BLE001
        msg = str(e)
        if "does not exist" in msg.lower():
            return {
                "ok": False,
                "error": f"Tabela ou coluna não existe: {msg}",
                "code": "table_not_found",
            }
        logger.warning("Consulta de artefato falhou (%s): %s", dados.table, msg)
        return {"ok": False, "error": msg, "code": "query_failed"}

    # `default=str` porque o resultado é livre: uuid, timestamp e numeric não
    # são serializáveis direto, e a alternativa seria enumerar tipo por tipo de
    # 19 tabelas diferentes.
    return {"success": True, "data": json.loads(json.dumps([dict(l) for l in linhas], default=str))}


# ─────────────────────────────────────────────────────────────────────────────
# Ciclo de vida dos live artifacts
# ─────────────────────────────────────────────────────────────────────────────


class ArtefatoIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    html_content: str
    refresh_interval: int = Field(default=0, ge=0)


@router.post("", status_code=status.HTTP_201_CREATED)
async def criar(dados: ArtefatoIn, usuario: Usuario = Depends(usuario_atual)):
    """Publica o artefato que o agente gerou no chat. O dono é quem publica."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        artefato = await conn.fetchval(
            """
            INSERT INTO public.live_artifacts (user_id, title, html_content, refresh_interval)
            VALUES ($1::uuid, $2, $3, $4)
            RETURNING id::text
            """,
            usuario.id, dados.title, dados.html_content, dados.refresh_interval,
        )
    logger.info("Artefato %s publicado por %s", artefato, usuario.id)
    return {"id": artefato}


class IntervaloIn(BaseModel):
    refresh_interval: int = Field(ge=0)


@router.patch("/{artefato_id}", status_code=status.HTTP_204_NO_CONTENT)
async def ajustar_intervalo(
    artefato_id: str,
    dados: IntervaloIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Muda de quanto em quanto tempo o artefato se atualiza. Zero congela.

    Congelar é a razão de existir: um artefato que consulta a cada 30s custa
    banco e cota o dia inteiro em cima de dado que talvez já não interesse.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.live_artifacts SET refresh_interval = $2 WHERE id = $1::uuid "
            "RETURNING id",
            artefato_id, dados.refresh_interval,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artefato não encontrado.")


# ─────────────────────────────────────────────────────────────────────────────
# Artefatos publicados — a página `/p/{slug}`
# ─────────────────────────────────────────────────────────────────────────────


class PublicacaoIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    html_content: str
    is_public: bool = False
    expires_at: str | None = None


@router.post("/publicados", status_code=status.HTTP_201_CREATED)
async def publicar(dados: PublicacaoIn, usuario: Usuario = Depends(usuario_atual)):
    """Publica o artefato, **reaproveitando** a publicação anterior idêntica.

    Republicar o mesmo HTML devolve o link que já existia em vez de criar
    outro. Sem isso, clicar "publicar" duas vezes gerava dois links vivos para
    a mesma coisa e o primeiro, que já podia estar compartilhado, virava órfão
    silencioso — o dono achava que tinha um link e tinha dois.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        anterior = await conn.fetchrow(
            "SELECT id::text AS id, title FROM public.artifacts_published "
            " WHERE created_by = $1::uuid AND html_content = $2 "
            " ORDER BY created_at DESC LIMIT 1",
            usuario.id, dados.html_content,
        )
        if anterior:
            return {"id": anterior["id"], "title": anterior["title"], "reaproveitado": True}

        linha = await conn.fetchrow(
            """
            INSERT INTO public.artifacts_published
                (title, html_content, created_by, is_public, expires_at)
            VALUES ($1, $2, $3::uuid, $4, NULLIF($5,'')::text::timestamptz)
            RETURNING id::text AS id, title
            """,
            dados.title, dados.html_content, usuario.id, dados.is_public,
            dados.expires_at or "",
        )
    logger.info("Artefato publicado %s por %s", linha["id"], usuario.id)
    return {"id": linha["id"], "title": linha["title"], "reaproveitado": False}


class BuscaPublicacaoIn(BaseModel):
    html_content: str


@router.post("/publicados/procurar")
async def procurar_publicacao(
    dados: BuscaPublicacaoIn, usuario: Usuario = Depends(usuario_atual)
):
    """Diz se esta pessoa já publicou exatamente este HTML, sem publicar nada.

    É o que o diálogo consulta ao abrir, para já mostrar o link existente em vez
    de oferecer "publicar" para algo que já está publicado. Precisa ser POST
    apesar de só ler: o HTML é o critério de busca e não cabe numa query string.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT id::text AS id, title FROM public.artifacts_published "
            " WHERE created_by = $1::uuid AND html_content = $2 "
            " ORDER BY created_at DESC LIMIT 1",
            usuario.id, dados.html_content,
        )
    return dict(linha) if linha else None


@router.get("/publicados/{artefato_id}")
async def artefato_publicado(artefato_id: str):
    """Lê um artefato publicado. **Sem autenticação** — é a página pública.

    A validade é conferida aqui e não pelo RLS: um artefato expirado precisa
    responder "link expirado" e não "não encontrado", e o RLS só sabe esconder.

    Conta a visualização na mesma chamada. Era um `update` separado do
    navegador, que qualquer um podia repetir à vontade — e não contava nada
    quando a pessoa abria com JavaScript desligado.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            """
            UPDATE public.artifacts_published
               SET views = COALESCE(views, 0) + 1
             WHERE id = $1::uuid AND is_public = true
               AND (expires_at IS NULL OR expires_at > now())
            RETURNING id::text AS id, title, html_content, views, is_public,
                      to_char(expires_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS expires_at,
                      to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
            """,
            artefato_id,
        )
    if linha is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Artefato não encontrado ou link expirado."
        )
    return dict(linha)


# ─────────────────────────────────────────────────────────────────────────────
# Live artifacts — o ciclo de vida completo
# ─────────────────────────────────────────────────────────────────────────────

_COLUNAS_VIVO = """
    id::text AS id, user_id::text AS user_id, agent_id, title, html_content,
    refresh_interval, is_published, published_slug, is_public, view_count,
    to_char(created_at        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at,
    to_char(updated_at        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS updated_at,
    to_char(published_at      AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS published_at,
    to_char(expires_at        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS expires_at,
    to_char(last_refreshed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS last_refreshed_at,
    to_char(deleted_at        AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS deleted_at
"""


def _vivo(linha) -> dict:
    return json.loads(json.dumps(dict(linha), default=str))


@router.get("/vivos")
async def listar_vivos(
    usuario: Usuario = Depends(usuario_atual),
    agent_id: str | None = Query(default=None, description="Só os deste agente."),
    com_html: bool = Query(default=False, description="Inclui o `html_content`."),
    meus: bool = Query(default=False, description="Só os meus."),
):
    """Os artefatos vivos.

    ⚠️ **O `html_content` fica de fora por padrão.** São páginas inteiras, e
    trazer trinta delas para desenhar uma lista de títulos é o tipo de coisa que
    faz a tela demorar sem ninguém entender por quê. A aba de artefatos da
    conversa precisa do HTML (ela renderiza o painel ali mesmo) e pede
    `com_html=true`, mas aí são poucos e filtrados por agente.
    """
    colunas = """
        id::text AS id, agent_id, title, refresh_interval, is_published,
        published_slug, view_count,
        to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS updated_at
    """
    if com_html:
        colunas += ", html_content"

    condicoes, args = ["deleted_at IS NULL"], []
    if agent_id:
        args.append(agent_id)
        condicoes.append(f"agent_id = ${len(args)}")
    if meus:
        args.append(usuario.id)
        condicoes.append(f"user_id = ${len(args)}::uuid")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {colunas} FROM public.live_artifacts "
            f" WHERE {' AND '.join(condicoes)} ORDER BY updated_at DESC",
            *args,
        )
    return [_vivo(l) for l in linhas]


@router.get("/vivos/{artefato_id}")
async def obter_vivo(artefato_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Um artefato pelo id, com o HTML. Conta a visualização."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"UPDATE public.live_artifacts SET view_count = COALESCE(view_count,0) + 1 "
            f" WHERE id = $1::uuid AND deleted_at IS NULL RETURNING {_COLUNAS_VIVO}",
            artefato_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artefato não encontrado.")
    return _vivo(linha)


@router.get("/vivos/publico/{slug}")
async def obter_por_slug(slug: str):
    """Artefato publicado, pelo slug. **Sem autenticação** — é a página `/p/{slug}`.

    A validade e o `is_published` são conferidos aqui, não pelo RLS: expirado
    precisa dizer "expirou" e não "não existe", e o RLS só sabe esconder.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""
            UPDATE public.live_artifacts SET view_count = COALESCE(view_count,0) + 1
             WHERE published_slug = $1 AND is_published = true AND deleted_at IS NULL
               AND (expires_at IS NULL OR expires_at > now())
            RETURNING {_COLUNAS_VIVO}
            """,
            slug,
        )
    if linha is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND, "Artefato não encontrado ou link expirado."
        )
    return _vivo(linha)


class ArtefatoVivoIn(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    html_content: str
    agent_id: str | None = None
    refresh_interval: int = Field(default=0, ge=0)
    existing_id: str | None = Field(
        default=None, description="Atualiza este artefato em vez de criar."
    )
    deduplicar: bool = Field(
        default=False,
        description="Reaproveita artefato do mesmo (agente, título) em vez de criar outro.",
    )


@router.post("/vivos", status_code=status.HTTP_201_CREATED)
async def criar_vivo(dados: ArtefatoVivoIn, usuario: Usuario = Depends(usuario_atual)):
    """Cria — ou atualiza, quando o chamador pede.

    ⚠️ **A desduplicação por título é o que impede a galeria de encher de
    cópias.** O agente reemite `<live_artifact>` a cada turno em que atualiza o
    painel, e nem sempre com o id de antes; sem isto, cada atualização vira um
    artefato novo com o mesmo nome.

    Estava na tela, em três idas ao banco (procurar, decidir, gravar). Aqui é
    uma consulta e um `UPDATE`, e some a janela entre procurar e gravar em que
    dois turnos simultâneos criavam dois artefatos.

    **Artefato excluído não ressuscita.** Se o título bate com um que foi
    apagado, a resposta é 409: recriar sozinho desfaria uma exclusão que alguém
    pediu de propósito.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        alvo, apagado = dados.existing_id, False

        if not alvo and dados.deduplicar:
            anterior = await conn.fetchrow(
                "SELECT id::text AS id, deleted_at FROM public.live_artifacts "
                " WHERE user_id = $1::uuid AND agent_id IS NOT DISTINCT FROM $2 "
                "   AND title = $3 ORDER BY created_at DESC LIMIT 1",
                usuario.id, dados.agent_id, dados.title,
            )
            if anterior:
                alvo, apagado = anterior["id"], anterior["deleted_at"] is not None

        if apagado:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "Já existe um artefato com este título, e ele foi excluído. "
                "Use outro título ou restaure o anterior.",
            )

        if alvo:
            ident = await conn.fetchval(
                """
                UPDATE public.live_artifacts SET
                    html_content = $2, title = $3, refresh_interval = $4, updated_at = now()
                 WHERE id = $1::uuid AND user_id = $5::uuid AND deleted_at IS NULL
                RETURNING id::text
                """,
                alvo, dados.html_content, dados.title, dados.refresh_interval, usuario.id,
            )
            if ident is None:
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, "Artefato não encontrado ou já excluído."
                )
            return {"id": ident, "reaproveitado": True}

        ident = await conn.fetchval(
            """
            INSERT INTO public.live_artifacts
                (user_id, agent_id, title, html_content, refresh_interval)
            VALUES ($1::uuid, $2, $3, $4, $5)
            RETURNING id::text
            """,
            usuario.id, dados.agent_id, dados.title, dados.html_content,
            dados.refresh_interval,
        )
    return {"id": ident, "reaproveitado": False}


class EdicaoVivoIn(BaseModel):
    """Tudo opcional: a tela edita um campo por vez (título, HTML, intervalo)."""
    title: str | None = None
    html_content: str | None = None
    refresh_interval: int | None = Field(default=None, ge=0)
    tocar_refresh: bool = False


@router.patch("/vivos/{artefato_id}", status_code=status.HTTP_204_NO_CONTENT)
async def editar_vivo(
    artefato_id: str,
    dados: EdicaoVivoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Edita o que veio e ignora o que não veio.

    `COALESCE($n, coluna)` em vez de montar o SET dinamicamente: a consulta fica
    uma só, e `null` significa "não mexe" em vez de "apaga". A exceção é o
    `tocar_refresh`, que é ação e não valor.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            """
            UPDATE public.live_artifacts SET
                title            = COALESCE($2, title),
                html_content     = COALESCE($3, html_content),
                refresh_interval = COALESCE($4, refresh_interval),
                last_refreshed_at = CASE WHEN $5 THEN now() ELSE last_refreshed_at END,
                updated_at = now()
             WHERE id = $1::uuid AND deleted_at IS NULL
            RETURNING id
            """,
            artefato_id, dados.title, dados.html_content,
            dados.refresh_interval, dados.tocar_refresh,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artefato não encontrado.")


class PublicacaoVivoIn(BaseModel):
    title: str | None = None
    published_slug: str = Field(min_length=1, max_length=120)
    is_public: bool = False
    expires_at: str | None = None


@router.post("/vivos/{artefato_id}/publicar", status_code=status.HTTP_204_NO_CONTENT)
async def publicar_vivo(
    artefato_id: str,
    dados: PublicacaoVivoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Publica o artefato num slug. Slug repetido responde 409, não 500."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        try:
            achado = await conn.fetchval(
                """
                UPDATE public.live_artifacts SET
                    title = COALESCE($2, title), is_published = true,
                    published_slug = $3, published_at = now(), is_public = $4,
                    expires_at = NULLIF($5,'')::text::timestamptz, updated_at = now()
                 WHERE id = $1::uuid AND deleted_at IS NULL
                RETURNING id
                """,
                artefato_id, dados.title, dados.published_slug,
                dados.is_public, dados.expires_at or "",
            )
        except UniqueViolationError:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"O endereço '{dados.published_slug}' já está em uso.",
            )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artefato não encontrado.")


@router.delete("/vivos/{artefato_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_vivo(artefato_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Exclusão **lógica**: marca `deleted_at`, despublica e congela.

    Não apaga a linha porque o artefato pode estar linkado numa conversa, e um
    link que some sem explicação é pior do que um que diz "não existe mais".
    Congelar junto evita um artefato excluído continuar consultando o banco a
    cada 30 segundos para sempre.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.live_artifacts SET deleted_at = now(), is_published = false, "
            "       refresh_interval = 0, updated_at = now() "
            " WHERE id = $1::uuid AND deleted_at IS NULL RETURNING id",
            artefato_id,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Artefato não encontrado.")
