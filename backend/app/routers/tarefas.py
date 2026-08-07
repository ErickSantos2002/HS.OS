"""Loop Architecture — tarefas longas de agente. Portado de `agent-task`.

Uma tarefa é trabalho que não cabe num turno de chat: o agente reporta progresso
com `checkpoint` e fecha com `complete`. O `checkpoint_data` é o que permite
**retomar de onde parou** em vez de refazer do zero.

Duas naturezas de chamador, e a autorização difere:

- **Agentes**, por segredo compartilhado: autonomia total sobre qualquer tarefa.
  É intencional — é assim que o orquestrador coordena os demais.
- **Pessoas**, por JWT: exige papel `member` ou `super_admin`.

⚠️ **A checagem de papel não é de dono, e isso é deliberado.** A tela de Tarefas
é um painel compartilhado de equipe, e tarefa criada por agente fica com
`created_by` nulo — checar "dono" quebraria o uso normal. O que se bloqueia é o
papel mínimo `user`, que não deveria mexer no Loop Architecture.
"""

import hmac
import json
import logging

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field

import jwt

from app.auth.security import ler_token
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/tarefas", tags=["tarefas"])

_STATUS = {"running", "checkpoint", "done", "failed"}
_PAPEIS_QUE_MUTAM = {"member", "super_admin"}

_COLUNAS = """
    id::text AS id, agent_id, title, status, chunks, checkpoint_data,
    created_by::text AS created_by,
    to_char(created_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at,
    to_char(updated_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS updated_at,
    to_char(completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS completed_at
"""


class TarefaOut(BaseModel):
    id: str
    agent_id: str
    title: str
    status: str
    chunks: list = []
    checkpoint_data: dict = {}
    created_by: str | None = None
    created_at: str
    updated_at: str
    completed_at: str | None = None


def _saida(linha) -> TarefaOut:
    d = dict(linha)
    for campo, vazio in (("chunks", []), ("checkpoint_data", {})):
        bruto = d.get(campo)
        d[campo] = (json.loads(bruto) if isinstance(bruto, str) else bruto) or vazio
    return TarefaOut(**d)


class Chamador:
    """Quem está chamando: um agente (segredo) ou uma pessoa (JWT)."""

    def __init__(self, agente: bool, usuario: Usuario | None):
        self.agente = agente
        self.usuario = usuario

    @property
    def user_id(self) -> str | None:
        return self.usuario.id if self.usuario else None


async def chamador(request: Request) -> Chamador:
    """Aceita os dois caminhos de autenticação.

    O segredo é conferido primeiro: se ele bate, nem se tenta ler JWT. Assim o
    agente não precisa carregar credencial de usuário nenhuma.
    """
    cabecalho = request.headers.get("authorization") or ""
    token = cabecalho[7:].strip() if cabecalho.lower().startswith("bearer ") else ""

    if not token:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Autenticação necessária.")

    esperado = await ler_segredo("GUARDRAILS_API_TOKEN")
    if esperado and hmac.compare_digest(token, esperado):
        return Chamador(agente=True, usuario=None)

    # Não é o segredo: tem que ser JWT de usuário. Decodifica aqui em vez de
    # reusar `usuario_atual`, que é dependência do FastAPI e espera credencial
    # já extraída — chamá-la à mão com o Request não funciona.
    try:
        dados = ler_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Sessão expirada. Entre novamente.")
    except jwt.PyJWTError:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token inválido.")

    user_id = dados.get("sub")
    if not user_id:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Token sem usuário.")
    return Chamador(
        agente=False,
        usuario=Usuario(id=user_id, email=dados.get("email", ""), papel=dados.get("papel", "user")),
    )


async def _pode_mutar(quem: Chamador) -> None:
    if quem.agente:
        return
    if quem.usuario is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Autenticação necessária.")
    if quem.usuario.papel not in _PAPEIS_QUE_MUTAM:
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "Você não tem permissão para modificar tarefas.",
        )


# ─────────────────────────────────────────────────────────────────────────────
# Leitura
# ─────────────────────────────────────────────────────────────────────────────


@router.get("", response_model=list[TarefaOut])
async def listar(
    usuario: Usuario = Depends(usuario_atual),
    agent_id: str | None = Query(default=None),
    status_: str | None = Query(default=None, alias="status"),
    limite: int = Query(default=100, ge=1, le=500),
):
    """Tarefas do painel. Ler é liberado a qualquer usuário autenticado —
    o painel é compartilhado; a restrição de papel vale só para mudar."""
    condicoes, args = [], []
    if agent_id:
        args.append(agent_id)
        condicoes.append(f"agent_id = ${len(args)}")
    if status_:
        if status_ not in _STATUS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"status inválido. Use um de: {', '.join(sorted(_STATUS))}.",
            )
        args.append(status_)
        condicoes.append(f"status = ${len(args)}")

    onde = f"WHERE {' AND '.join(condicoes)}" if condicoes else ""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS} FROM public.agent_tasks {onde} "
            f"ORDER BY created_at DESC LIMIT ${len(args) + 1}",
            *args, limite,
        )
    return [_saida(l) for l in linhas]


@router.get("/{tarefa_id}", response_model=TarefaOut)
async def obter(tarefa_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS} FROM public.agent_tasks WHERE id = $1::uuid", tarefa_id
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarefa não encontrada.")
    return _saida(linha)


# ─────────────────────────────────────────────────────────────────────────────
# Escrita
# ─────────────────────────────────────────────────────────────────────────────


class TarefaNovaIn(BaseModel):
    agent_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    checkpoint_data: dict = {}


@router.post("", response_model=TarefaOut, status_code=status.HTTP_201_CREATED)
async def criar(dados: TarefaNovaIn, quem: Chamador = Depends(chamador)):
    """Abre uma tarefa. Nasce `running`."""
    await _pode_mutar(quem)
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.agent_tasks (agent_id, title, checkpoint_data, created_by)
            VALUES ($1, $2, $3::text::jsonb, NULLIF($4,'')::uuid)
            RETURNING {_COLUNAS}
            """,
            dados.agent_id, dados.title, json.dumps(dados.checkpoint_data),
            quem.user_id or "",
        )
    logger.info("Tarefa %s aberta para %s", linha["id"], dados.agent_id)
    return _saida(linha)


class CheckpointIn(BaseModel):
    checkpoint_data: dict = {}
    chunk: dict | None = None
    notes: str | None = None


@router.post("/{tarefa_id}/checkpoint", response_model=TarefaOut)
async def checkpoint(
    tarefa_id: str,
    dados: CheckpointIn,
    quem: Chamador = Depends(chamador),
):
    """Registra progresso sem encerrar.

    O `checkpoint_data` faz **merge** com o que já havia; o `chunk` é
    **acrescentado** à lista. Substituir o checkpoint apagaria o progresso dos
    agentes que já passaram — foi exatamente o que fazia retomar significar
    refazer do zero.
    """
    await _pode_mutar(quem)
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""
            UPDATE public.agent_tasks SET
                status = 'checkpoint',
                checkpoint_data = checkpoint_data || $2::text::jsonb,
                chunks = CASE WHEN $3::text::jsonb IS NULL THEN chunks ELSE chunks || $3::text::jsonb END,
                updated_at = now()
             WHERE id = $1::uuid
            RETURNING {_COLUNAS}
            """,
            tarefa_id, json.dumps(dados.checkpoint_data),
            json.dumps([dados.chunk]) if dados.chunk else None,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarefa não encontrada.")
    return _saida(linha)


class DesfechoIn(BaseModel):
    checkpoint_data: dict = {}
    notes: str | None = None


@router.post("/{tarefa_id}/{desfecho}", response_model=TarefaOut)
async def encerrar(
    tarefa_id: str,
    desfecho: str,
    dados: DesfechoIn,
    quem: Chamador = Depends(chamador),
):
    """Fecha, pausa ou retoma a tarefa.

    `complete` e `fail` carimbam `completed_at`; `pause` volta para `checkpoint`
    (a tarefa continua retomável) e `resume` para `running`.

    Pausar **não** é falhar, e a diferença importa: tarefa pausada guarda o
    checkpoint e volta de onde parou; falhada é desfecho.
    """
    mapa = {
        "complete": ("done", True),
        "fail": ("failed", True),
        "pause": ("checkpoint", False),
        "resume": ("running", False),
    }
    if desfecho not in mapa:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Ação desconhecida. Use: {', '.join(sorted(mapa))} ou checkpoint.",
        )
    await _pode_mutar(quem)
    novo_status, encerra = mapa[desfecho]

    extra = dict(dados.checkpoint_data)
    if dados.notes:
        extra["notes"] = dados.notes

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            f"""
            UPDATE public.agent_tasks SET
                status = $2,
                checkpoint_data = checkpoint_data || $3::text::jsonb,
                completed_at = CASE WHEN $4 THEN now() ELSE completed_at END,
                updated_at = now()
             WHERE id = $1::uuid
            RETURNING {_COLUNAS}
            """,
            tarefa_id, novo_status, json.dumps(extra), encerra,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarefa não encontrada.")
    logger.info("Tarefa %s → %s", tarefa_id, novo_status)
    return _saida(linha)


@router.delete("/{tarefa_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir(tarefa_id: str, quem: Chamador = Depends(chamador)):
    await _pode_mutar(quem)
    async with sessao(role="service_role") as conn:
        marca = await conn.execute(
            "DELETE FROM public.agent_tasks WHERE id = $1::uuid", tarefa_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tarefa não encontrada.")
