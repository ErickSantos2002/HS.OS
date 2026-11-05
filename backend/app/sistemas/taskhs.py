"""Cliente do TaskHS com token de agente (aud=taskhs).

Contrato do lado de lá: TaskHS main `48832b0` (v2.13.0). Sem a env
`HSOS_AGENTE_CHAVE_PUBLICA` no TaskHS, todo token dá 401.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.agente_token import token_de_agente
from app.config import settings

AUD = "taskhs"
TIMEOUT = 15
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "você não tem acesso ao TaskHS (ou o TaskHS ainda não aceita o bot)",
    403: "o TaskHS não deixa o agente fazer isso",
    404: "não encontrado no TaskHS",
}


class ErroSistema(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(mensagem)
        self.status = status


async def chamar(email: str, bot: str, metodo: str, caminho: str, json: Any = None,
                 params: dict | None = None) -> Any:
    url = settings.TASKHS_API_URL.rstrip("/") + caminho
    headers = {"Authorization": f"Bearer {token_de_agente(AUD, email, bot)}"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=_transporte) as c:
            r = await c.request(metodo, url, headers=headers, json=json, params=params)
    except httpx.HTTPError as e:
        raise ErroSistema(0, f"o TaskHS não respondeu ({type(e).__name__})") from e
    if r.status_code >= 400:
        detalhe = ""
        try:
            detalhe = str((r.json() or {}).get("detail") or "")[:200]
        except ValueError:
            pass
        raise ErroSistema(r.status_code, _MSG.get(r.status_code) or f"o TaskHS recusou ({r.status_code}) {detalhe}".strip())
    return r.json() if r.content else None
