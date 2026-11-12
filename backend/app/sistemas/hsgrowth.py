"""Cliente do HSGrowth (CRM) com token de agente (aud=hsgrowth) — spec
`docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`.

O Guardi lê (e, nas tarefas seguintes, escreve por cartão) no HSGrowth como o
DONO: e-mail resolvido pelo `dono_id`, nunca vindo do agente, com o papel que ele
tem lá. Mesmo molde do GestorHS (`app/sistemas/gestorhs.py`).

⚠️ Duas URLs: a API é `HSGROWTH_API_URL` (já com `/api/v1`); o front é
`HSGROWTH_URL` e serve só para os links. Chamar o front devolveria o HTML da SPA.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.sistemas.taskhs import ErroSistema, chamar_sistema

__all__ = ["ErroSistema", "chamar", "AUD"]

AUD = "hsgrowth"
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "o seu dono não tem conta ativa no HSGrowth (ou o acesso do Guardi ainda não foi ligado lá)",
    403: "o HSGrowth não deixa o Guardi ver isso com a função do seu dono",
    404: "não encontrado no HSGrowth",
}
# ⚠️ Na escrita, 403 é a FUNÇÃO do dono lá, não falta de leitura. 400/409/422 ficam
# de fora de propósito: o `detail` deles é a regra legível do CRM ("Este CNPJ está
# com o parceiro X") e precisa chegar à pessoa.
_MSG_ESCRITA = {**_MSG, 403: "o HSGrowth não deixa a sua função fazer isso"}


async def chamar(email: str, bot: str, caminho: str, params=None, dono: str | None = None,
                 metodo: str = "GET", json: dict | None = None) -> Any:
    """GET nas consultas (o `caminho` vem do catálogo, relativo à raiz da API) e
    escritas só pelos executores do clique do dono (`app/acoes.py`)."""
    mensagens = _MSG if metodo == "GET" else _MSG_ESCRITA
    return await chamar_sistema(AUD, "HSGrowth", settings.HSGROWTH_API_URL.rstrip("/"), _transporte,
                                mensagens, email, bot, metodo, caminho, json=json, params=params,
                                dono=dono)
