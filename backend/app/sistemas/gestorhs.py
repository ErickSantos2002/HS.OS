"""Cliente do GestorHS com token de agente (aud=gestorhs) — spec
`docs/superpowers/specs/2026-11-11-guardi-gestorhs-design.md`.

O Guardi lê o GestorHS como o DONO (e-mail resolvido pelo `dono_id`, nunca vindo
do agente), com a função que ele tem lá. Só GET na fase 1: abrir caixa, lançar
aparelho, gerar certificado e montar proposta são a fase 2, com cartão.

Contrato do lado de lá (seção "Para o GestorHS" da spec): o GestorHS aceita o
token só em GET e só nas rotas do catálogo (`app/gestorhs_consultas.py`) e em
`/auth/me`. Sem `HSOS_AGENTE_CHAVE_PUBLICA` lá, todo token dá 401.

⚠️ Duas URLs: a API é `GESTORHS_API_URL` (gestorhsapi, sem prefixo); o front é
`GESTORHS_URL` e serve só para os links. Chamar o front devolveria o HTML da SPA.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.sistemas.taskhs import ErroSistema, chamar_sistema

__all__ = ["ErroSistema", "chamar", "AUD"]

AUD = "gestorhs"
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "o seu dono não tem conta ativa no GestorHS (ou o acesso do Guardi ainda não foi ligado lá)",
    403: "o GestorHS não deixa o Guardi ver isso com a função do seu dono",
    404: "não encontrado no GestorHS",
}


async def chamar(email: str, bot: str, caminho: str, params=None, dono: str | None = None) -> Any:
    """Sempre GET. `caminho` vem do catálogo, relativo à raiz da API."""
    return await chamar_sistema(AUD, "GestorHS", settings.GESTORHS_API_URL.rstrip("/"), _transporte,
                                _MSG, email, bot, "GET", caminho, params=params, dono=dono)
