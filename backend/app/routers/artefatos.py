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

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

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
