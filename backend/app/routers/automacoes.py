"""Automações — resultado de execução vindo de fora.

Portado de `automation-result`. É o webhook que o executor (n8n, cron da VPS,
qualquer coisa que rode a automação) chama ao terminar.
"""

import json
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel

from app.database import sessao
from app.integracoes import exige_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/automacoes", tags=["automações"])

# Limites do original: o texto vai para a tela e a mensagem de erro para um
# balão. Sem corte, um executor verboso escreveria megabytes na linha.
_LIMITE_SAIDA = 20_000
_LIMITE_ERRO = 2_000

# O que conta como sucesso. Três palavras porque três executores diferentes
# reportam de jeitos diferentes, e era assim na edge.
_SUCESSO = {"ok", "success", "completed"}


class ResultadoIn(BaseModel):
    status: str | None = None
    output: Any = None
    error: Any = None
    meta: dict = {}


def _texto_da_saida(output: Any, erro: Any) -> str:
    """Extrai texto de um `output` que pode vir de qualquer formato.

    A cascata é a do original: string direta, depois `text`/`content`/`result`
    dentro de objeto, depois o JSON inteiro. É feia porque a realidade é —
    cada executor devolve de um jeito.
    """
    if isinstance(output, str) and output.strip():
        return output
    if isinstance(output, dict):
        for chave in ("text", "content", "result"):
            if isinstance(output.get(chave), str):
                return output[chave]
        try:
            return json.dumps(output, ensure_ascii=False)
        except (TypeError, ValueError):
            pass
    if isinstance(erro, str) and erro:
        return erro
    return "Sem resposta"


@router.post("/resultado", status_code=status.HTTP_204_NO_CONTENT)
async def registrar_resultado(
    dados: ResultadoIn,
    runId: str = Query(default=""),
    automationId: str = Query(default=""),
    _: None = Depends(exige_segredo("AUTOMATION_WEBHOOK_SECRET")),
):
    """Fecha uma execução de automação.

    Os identificadores podem vir no `meta` do corpo **ou** na query: quem chama
    é um executor externo, e nem todos deixam controlar o corpo do webhook —
    alguns só permitem acrescentar parâmetros à URL.
    """
    run_id = str(dados.meta.get("runId") or runId or "").strip()
    automation_id = str(dados.meta.get("automationId") or automationId or "").strip()
    if not run_id or not automation_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Faltam runId e automationId — mande em `meta` ou na query.",
        )

    sucesso = (dados.status or "").lower() in _SUCESSO
    situacao = "success" if sucesso else "error"
    texto = _texto_da_saida(dados.output, dados.error)
    mensagem_erro = None
    if not sucesso:
        mensagem_erro = (dados.error if isinstance(dados.error, str) else texto)[:_LIMITE_ERRO]

    async with sessao(role="service_role") as conn:
        async with conn.transaction():
            marca = await conn.execute(
                "UPDATE public.automation_runs SET status = $2, output = $3, "
                "error_message = $4, finished_at = now() WHERE id = $1::uuid",
                run_id, situacao, texto[:_LIMITE_SAIDA], mensagem_erro,
            )
            if marca.rsplit(" ", 1)[-1] == "0":
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, "Execução não encontrada."
                )
            await conn.execute(
                "UPDATE public.automations SET last_run_at = now(), last_run_status = $2 "
                "WHERE id = $1::uuid",
                automation_id, situacao,
            )

    logger.info("Automação %s: execução %s terminou em %s", automation_id, run_id, situacao)
