"""Cliente do TaskHS com token de agente (aud=taskhs).

Contrato do lado de lá: TaskHS main `48832b0` (v2.13.0). Sem a env
`HSOS_AGENTE_CHAVE_PUBLICA` no TaskHS, todo token dá 401.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.agente_token import token_e_jti
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


async def _registrar(dono, bot, sistema, metodo, caminho, st, jti) -> None:
    """Auditoria SEM corpo (`agente_chamadas`). Falhar aqui nunca derruba a chamada."""
    from app.database import sessao
    try:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO public.agente_chamadas (user_id, agent_id, sistema, metodo, caminho, status, jti) "
                "VALUES ($1::uuid, $2, $3, $4, $5, $6, $7)", dono, bot, sistema, metodo, caminho, st, jti)
    except Exception:  # noqa: BLE001
        import logging
        logging.getLogger(__name__).warning("auditoria de %s %s não gravada", metodo, caminho)


async def chamar(email: str, bot: str, metodo: str, caminho: str, json: Any = None,
                 params: dict | None = None, dono: str | None = None) -> Any:
    return await chamar_sistema(AUD, "TaskHS", settings.TASKHS_API_URL, _transporte, _MSG,
                                email, bot, metodo, caminho, json=json, params=params, dono=dono)


async def chamar_sistema(aud: str, nome: str, base: str, transporte, mensagens: dict,
                         email: str, bot: str, metodo: str, caminho: str, json: Any = None,
                         params: dict | None = None, dono: str | None = None,
                         files: dict | None = None) -> Any:
    """O miolo comum a todo sistema interno: token do `aud`, auditoria, erro legível.
    Usado pelo TaskHS e pelo DataCore (`app/sistemas/datacore.py`). `files` (multipart,
    só o HSGrowth usa) segue o mesmo caminho de token, auditoria e erro."""
    url = base.rstrip("/") + caminho
    token, jti = token_e_jti(aud, email, bot)
    headers = {"Authorization": f"Bearer {token}"}
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, transport=transporte) as c:
            r = await c.request(metodo, url, headers=headers, json=json, params=params, files=files)
    except httpx.HTTPError as e:
        if dono:
            await _registrar(dono, bot, aud, metodo, caminho, 0, jti)
        # ⚠️ Sem resposta não dá para afirmar que NÃO foi feito: o TaskHS pode ter
        # gravado antes de o tempo acabar. Num "criar", repetir duplicaria.
        msg = f"o {nome} não respondeu ({type(e).__name__}) — confira no {nome}"
        if metodo != "GET":
            msg += " antes de repetir: não sei se foi feito"
        raise ErroSistema(0, msg) from e
    if dono:
        await _registrar(dono, bot, aud, metodo, caminho, r.status_code, jti)
    if r.status_code >= 400:
        detalhe = ""
        try:
            detalhe = str((r.json() or {}).get("detail") or "")[:200]
        except ValueError:
            pass
        raise ErroSistema(r.status_code, mensagens.get(r.status_code) or f"o {nome} recusou ({r.status_code}) {detalhe}".strip())
    return r.json() if r.content else None
