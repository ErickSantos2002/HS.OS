"""Registro de uso medido — portado de `usage-import`.

Toda resposta do gateway traz o `usage` real (tokens de entrada, saída e cache).
Antes isso era descartado e o painel mostrava número auto-reportado pelo agente;
aqui o dado exato vira fato registrado, e o custo sai da tabela de preços.

Quem chama é o coletor da VPS, por segredo compartilhado.
"""

import logging
from datetime import datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.integracoes import exige_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/uso", tags=["uso"])

_LOTE_MAXIMO = 1000


class EventoUso(BaseModel):
    external_id: str
    ts: str
    agent_id: str
    model: str | None = None
    session_key: str | None = None
    label: str | None = None
    input: int = 0
    output: int = 0
    cache_read: int = 0
    total: int = 0


class LoteUso(BaseModel):
    events: list[EventoUso] = Field(default_factory=list)


class ImportacaoOut(BaseModel):
    ok: bool = True
    inseridos: int
    ignorados: int


def _tipo(session_key: str | None) -> str:
    """De onde veio o consumo, deduzido da chave da sessão.

    A ordem importa e é a do original: `subagent` antes de `cron`, porque um
    subagente disparado por cron tem as duas marcas e deve contar como
    subagente.
    """
    k = (session_key or "").lower()
    if not k:
        return "unknown"
    for marca, tipo in ((":subagent:", "subagent"), (":cron:", "cron"),
                        (":dm:", "dm"), (":channel:", "channel")):
        if marca in k:
            return tipo
    return "unknown"


@router.post("/importar", response_model=ImportacaoOut)
async def importar(
    lote: LoteUso,
    _: None = Depends(exige_segredo("INGEST_API_KEY")),
):
    """Registra eventos de consumo, calculando o custo pela tabela de preços.

    Idempotente por `external_id`: o coletor reenvia o lote quando a rede cai no
    meio, e sem isso o custo apareceria dobrado no painel.
    """
    if not lote.events:
        return ImportacaoOut(inseridos=0, ignorados=0)
    if len(lote.events) > _LOTE_MAXIMO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, f"Lote grande demais (máximo {_LOTE_MAXIMO})."
        )

    async with sessao(role="service_role") as conn:
        precos = {
            p["model"]: p
            for p in await conn.fetch(
                "SELECT model, input_per_1m, output_per_1m, cached_input_per_1m "
                "FROM public.model_pricing"
            )
        }

        inseridos = ignorados = 0
        for e in lote.events:
            cache = max(0, e.cache_read)
            novos = max(0, e.input)
            saida = max(0, e.output)
            entrada = novos + cache
            total = max(0, e.total or (entrada + saida))
            if total <= 0:
                # Evento sem consumo não é erro: é turno que não chamou modelo.
                ignorados += 1
                continue

            custo = None
            p = precos.get(e.model) if e.model else None
            if p:
                # Token de cache custa menos que token novo. Cobrar tudo pelo
                # preço de entrada inflaria o custo de conversa longa, que é
                # justamente onde o cache mais pega.
                preco_cache = (
                    p["input_per_1m"] if p["cached_input_per_1m"] is None
                    else p["cached_input_per_1m"]
                )
                custo = (
                    Decimal(novos) * p["input_per_1m"]
                    + Decimal(cache) * preco_cache
                    + Decimal(saida) * p["output_per_1m"]
                ) / Decimal(1_000_000)
                custo = round(custo, 6)

            try:
                instante = datetime.fromisoformat(e.ts)
            except ValueError:
                ignorados += 1
                continue

            marca = await conn.execute(
                """
                INSERT INTO public.usage_events
                    (external_id, ts, agent_id, model, kind, session_key, label,
                     input_tokens, output_tokens, cached_tokens, total_tokens,
                     cost_usd, source)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'trajectory')
                ON CONFLICT (external_id) DO NOTHING
                """,
                e.external_id, instante, e.agent_id, e.model, _tipo(e.session_key),
                e.session_key, e.label, entrada, saida, cache, total, custo,
            )
            if marca.rsplit(" ", 1)[-1] == "0":
                ignorados += 1
            else:
                inseridos += 1

    logger.info("Uso importado: %d inseridos, %d ignorados", inseridos, ignorados)
    return ImportacaoOut(inseridos=inseridos, ignorados=ignorados)
