"""Endpoints que a VPS chama — não o navegador.

Portados de `log-agent-activity`, `ingest-token-snapshot` e
`upsert-agent-guardrails`. Todos autenticam por segredo compartilhado, nunca por
JWT de usuário: quem chama é serviço do lado do OpenClaw.

Ficam juntos porque compartilham a forma (segredo + gravação idempotente) e
porque separá-los em três módulos de 40 linhas não ajudaria ninguém a achá-los.
"""

import json
import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.integracoes import exige_segredo
from app.realtime import hub, topico_usuario

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integracoes", tags=["integrações"])


# ─────────────────────────────────────────────────────────────────────────────
# Atividade de agente — o que ele está fazendo agora
# ─────────────────────────────────────────────────────────────────────────────


class AtividadeIn(BaseModel):
    agent_id: str = Field(min_length=1)
    activity_type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    user_id: str | None = None
    channel: str | None = None
    metadata: dict = {}
    steps: list = []
    status: str = "running"


class AtividadePatch(BaseModel):
    status: str | None = None
    steps: list | None = None
    result: dict | None = None
    metadata: dict | None = None


class AtividadeOut(BaseModel):
    id: str


@router.post("/agent-activity", response_model=AtividadeOut,
             status_code=status.HTTP_201_CREATED)
async def iniciar_atividade(
    dados: AtividadeIn,
    _: None = Depends(exige_segredo("BRIDGE_API_TOKEN")),
):
    """Abre um registro de atividade. É o que alimenta o \"está trabalhando\" na tela."""
    async with sessao(role="service_role") as conn:
        atividade_id = await conn.fetchval(
            """
            INSERT INTO public.agent_activity
                (agent_id, activity_type, title, status, steps, user_id, channel, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb, NULLIF($6,'')::uuid, $7, $8::jsonb)
            RETURNING id::text
            """,
            dados.agent_id, dados.activity_type, dados.title, dados.status,
            json.dumps(dados.steps), dados.user_id or "", dados.channel,
            json.dumps(dados.metadata),
        )
    if dados.user_id:
        hub.publicar(topico_usuario(dados.user_id), "atividade-agente",
                     {"id": atividade_id, "agent_id": dados.agent_id,
                      "title": dados.title, "status": dados.status})
    return AtividadeOut(id=atividade_id)


@router.patch("/agent-activity/{atividade_id}", response_model=AtividadeOut)
async def atualizar_atividade(
    atividade_id: str,
    dados: AtividadePatch,
    _: None = Depends(exige_segredo("BRIDGE_API_TOKEN")),
):
    """Atualiza o andamento. Só os campos enviados mudam."""
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")

    atribuicoes, valores = [], []
    for i, (nome, valor) in enumerate(campos.items(), start=1):
        if nome in ("steps", "result", "metadata"):
            atribuicoes.append(f"{nome} = ${i}::jsonb")
            valores.append(json.dumps(valor))
        else:
            atribuicoes.append(f"{nome} = ${i}")
            valores.append(valor)

    async with sessao(role="service_role") as conn:
        achado = await conn.fetchval(
            f"UPDATE public.agent_activity SET {', '.join(atribuicoes)}, updated_at = now() "
            f"WHERE id = ${len(valores) + 1}::uuid RETURNING id::text",
            *valores, atividade_id,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Atividade não encontrada.")
    return AtividadeOut(id=achado)


# ─────────────────────────────────────────────────────────────────────────────
# Métricas de consumo
# ─────────────────────────────────────────────────────────────────────────────


class SnapshotIn(BaseModel):
    agent_id: str = Field(min_length=1)
    snapshot_at: str
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    context_tokens: int = 0
    context_window: int | None = None
    cache_read: int = 0
    cache_write: int = 0
    estimated_cost_usd: float = 0
    model: str | None = None
    session_count: int = 0


@router.post("/token-snapshot", status_code=status.HTTP_204_NO_CONTENT)
async def registrar_consumo(
    dados: SnapshotIn,
    _: None = Depends(exige_segredo("INGEST_API_KEY")),
):
    """Grava uma medição de consumo do agente.

    Idempotente por `(agent_id, snapshot_at)`: o coletor da VPS reenvia o mesmo
    ponto quando a rede falha no meio, e sem isto o gráfico contaria duas vezes.
    """
    try:
        instante = datetime.fromisoformat(dados.snapshot_at)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "snapshot_at precisa ser um timestamp ISO válido."
        )

    async with sessao(role="service_role") as conn:
        await conn.execute(
            """
            INSERT INTO public.agent_token_snapshots
                (agent_id, snapshot_at, total_tokens, input_tokens, output_tokens,
                 context_tokens, context_window, cache_read, cache_write,
                 estimated_cost_usd, model, session_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (agent_id, snapshot_at) DO UPDATE SET
                total_tokens = EXCLUDED.total_tokens,
                input_tokens = EXCLUDED.input_tokens,
                output_tokens = EXCLUDED.output_tokens,
                context_tokens = EXCLUDED.context_tokens,
                context_window = EXCLUDED.context_window,
                cache_read = EXCLUDED.cache_read,
                cache_write = EXCLUDED.cache_write,
                estimated_cost_usd = EXCLUDED.estimated_cost_usd,
                model = EXCLUDED.model,
                session_count = EXCLUDED.session_count
            """,
            dados.agent_id, instante, dados.total_tokens, dados.input_tokens,
            dados.output_tokens, dados.context_tokens, dados.context_window,
            dados.cache_read, dados.cache_write, dados.estimated_cost_usd,
            dados.model, dados.session_count,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Guardrails
# ─────────────────────────────────────────────────────────────────────────────


class GuardrailsIn(BaseModel):
    agent_id: str = Field(min_length=1)
    guardrails: list = []


@router.put("/guardrails", status_code=status.HTTP_204_NO_CONTENT)
async def gravar_guardrails(
    dados: GuardrailsIn,
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Substitui os guardrails do agente pelo conjunto enviado.

    Substitui, não acrescenta: quem manda é a fonte da verdade do lado da VPS, e
    mesclar deixaria regra removida lá continuar valendo aqui — que é o oposto do
    que um guardrail deve fazer.
    """
    async with sessao(role="service_role") as conn:
        achado = await conn.fetchval(
            "UPDATE public.agent_profiles SET guardrails = $2::jsonb, updated_at = now() "
            "WHERE agent_id = $1 RETURNING agent_id",
            dados.agent_id, json.dumps(dados.guardrails),
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")
    logger.info("Guardrails de %s atualizados (%d regras)", dados.agent_id, len(dados.guardrails))


# ─────────────────────────────────────────────────────────────────────────────
# Estado das chaves de integração — portado de `check-integration-keys`
# ─────────────────────────────────────────────────────────────────────────────


class ChavesOut(BaseModel):
    checadas: int
    configuradas: int


@router.post("/checar-chaves", response_model=ChavesOut)
async def checar_chaves(_: None = Depends(exige_segredo("BRIDGE_API_TOKEN"))):
    """Marca cada integração como configurada ou não, olhando o ambiente.

    A tabela `integrations` guarda o **nome** da variável (`key_name`), nunca o
    valor. Este endpoint confere quais dessas variáveis existem de fato e grava
    o resultado, mais uma prévia mascarada, para a tela mostrar "configurada"
    sem nunca receber o segredo.

    A prévia mostra 4 caracteres de cada ponta: o suficiente para alguém
    reconhecer *qual* chave está lá, insuficiente para usá-la.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch("SELECT id, key_name FROM public.integrations")

        configuradas = 0
        for linha in linhas:
            valor = os.environ.get(linha["key_name"]) or ""
            if valor:
                configuradas += 1
                previa = (
                    f"{valor[:4]}●●●●●●●●{valor[-4:]}" if len(valor) > 8
                    else f"●●●●{valor[-4:]}"
                )
            else:
                previa = None
            await conn.execute(
                "UPDATE public.integrations SET is_configured = $2, key_preview = $3, "
                "updated_at = now() WHERE id = $1",
                linha["id"], bool(valor), previa,
            )

    logger.info("Chaves de integração: %d de %d configuradas", configuradas, len(linhas))
    return ChavesOut(checadas=len(linhas), configuradas=configuradas)
