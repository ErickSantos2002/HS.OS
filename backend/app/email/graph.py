"""Microsoft Graph para o e-mail dos bots — delegado, `httpx` assíncrono.

Reaproveita o app do login (`MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET`),
mas com escopos próprios, pedidos SÓ no fluxo "Conectar e-mail" — o login
continua em `openid email profile User.Read` (`app/auth/microsoft.py`).

⚠️ Erros nunca carregam token, `code` nem corpo de e-mail: vão para log e,
resumidos, para o agente.

⚠️ Caixa compartilhada é `/users/{caixa}`; a conta da pessoa é `/me`.
"""
from __future__ import annotations

from urllib.parse import quote, urlencode

import httpx

from app.config import settings

ESCOPOS_EMAIL = ("offline_access User.Read Mail.ReadWrite Mail.Send "
                 "Mail.ReadWrite.Shared Mail.Send.Shared")
GRAPH = "https://graph.microsoft.com/v1.0"
TIMEOUT = 15

# Trocável em teste (`httpx.MockTransport`).
_transporte: httpx.AsyncBaseTransport | None = None


class ErroGraph(Exception):
    def __init__(self, status: int, mensagem: str):
        super().__init__(f"Graph {status}: {mensagem}")
        self.status = status


def _cliente() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=TIMEOUT, transport=_transporte)


def _base_login() -> str:
    return f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}/oauth2/v2.0"


def _caixa(caixa: str, conta: str) -> str:
    if (caixa or "").lower() == (conta or "").lower():
        return f"{GRAPH}/me"
    return f"{GRAPH}/users/{quote(caixa, safe='@.')}"


async def _pedir(metodo: str, url: str, access: str | None = None, **kw) -> dict:
    headers = kw.pop("headers", {})
    if access:
        headers["Authorization"] = f"Bearer {access}"
    try:
        async with _cliente() as c:
            r = await c.request(metodo, url, headers=headers, **kw)
    except httpx.HTTPError as e:
        raise ErroGraph(0, f"rede: {type(e).__name__}") from e
    if r.status_code >= 400:
        try:
            err = r.json().get("error") or {}
        except ValueError:
            err = {}
        if isinstance(err, dict):
            msg = f"{err.get('code', '')} {str(err.get('message', ''))[:160]}"
        else:
            msg = str(err)[:160]
        raise ErroGraph(r.status_code, str(msg).strip())
    if r.status_code in (202, 204) or not r.content:
        return {}
    return r.json()


# ── OAuth ────────────────────────────────────────────────────────────────────

def url_autorizacao(state: str, login_hint: str | None = None) -> str:
    p = {"client_id": settings.MS_CLIENT_ID, "response_type": "code",
         "redirect_uri": settings.redirect_email, "response_mode": "query",
         "scope": ESCOPOS_EMAIL, "state": state, "prompt": "select_account"}
    if login_hint:
        p["login_hint"] = login_hint
    return f"{_base_login()}/authorize?" + urlencode(p)


async def _token(dados: dict) -> dict:
    corpo = await _pedir("POST", f"{_base_login()}/token", data={
        "client_id": settings.MS_CLIENT_ID, "client_secret": settings.MS_CLIENT_SECRET,
        "scope": ESCOPOS_EMAIL, **dados})
    if not corpo.get("access_token"):
        raise ErroGraph(0, "token: resposta sem access_token")
    return corpo


async def trocar_code(code: str) -> dict:
    t = await _token({"grant_type": "authorization_code", "code": code,
                      "redirect_uri": settings.redirect_email})
    if not t.get("refresh_token"):
        raise ErroGraph(0, "token: sem refresh_token (offline_access concedido?)")
    eu = await _pedir("GET", f"{GRAPH}/me?$select=mail,userPrincipalName", t["access_token"])
    conta = (eu.get("mail") or eu.get("userPrincipalName") or "").lower()
    return {"access": t["access_token"], "refresh": t["refresh_token"], "conta": conta}


async def renovar(refresh: str) -> tuple[str, str]:
    t = await _token({"grant_type": "refresh_token", "refresh_token": refresh})
    return t["access_token"], t.get("refresh_token") or refresh


# ── Caixa ────────────────────────────────────────────────────────────────────

_CAMPOS_LISTA = "id,subject,from,receivedDateTime,bodyPreview,isRead,hasAttachments"


async def listar(access, conta, caixa, pasta="inbox", desde=None, busca=None, limite=10) -> list[dict]:
    params = {"$top": str(max(1, min(int(limite or 10), 25))), "$select": _CAMPOS_LISTA}
    if busca:
        params["$search"] = f'"{busca}"'
    else:
        params["$orderby"] = "receivedDateTime desc"
        if desde:
            params["$filter"] = f"receivedDateTime ge {desde}"
    corpo = await _pedir("GET", f"{_caixa(caixa, conta)}/mailFolders/{quote(pasta or 'inbox', safe='')}/messages",
                         access, params=params,
                         headers={"ConsistencyLevel": "eventual"} if busca else {})
    return corpo.get("value") or []


async def ler(access, conta, caixa, mensagem_id, texto: bool = False) -> dict:
    """`texto=True` pede o corpo em texto puro (rascunho do cartão)."""
    return await _pedir("GET", f"{_caixa(caixa, conta)}/messages/{quote(mensagem_id, safe='')}", access,
                        params={"$select": "id,subject,from,toRecipients,ccRecipients,"
                                           "receivedDateTime,body,hasAttachments"},
                        headers={"Prefer": 'outlook.body-content-type="text"'} if texto else {})


def _destinos(lista) -> list[dict]:
    return [{"emailAddress": {"address": e}} for e in lista or []]


def _mensagem(para, cc, assunto, corpo) -> dict:
    return {"subject": assunto or "", "body": {"contentType": "Text", "content": corpo or ""},
            "toRecipients": _destinos(para), "ccRecipients": _destinos(cc)}


async def criar_rascunho(access, conta, de, para, cc, assunto, corpo) -> str:
    r = await _pedir("POST", f"{_caixa(de, conta)}/messages", access,
                     json=_mensagem(para, cc, assunto, corpo))
    if not r.get("id"):
        raise ErroGraph(0, "rascunho criado sem id")
    return r["id"]


async def enviar_rascunho(access, conta, de, mensagem_id) -> None:
    await _pedir("POST", f"{_caixa(de, conta)}/messages/{quote(mensagem_id, safe='')}/send", access)


async def apagar(access, conta, de, mensagem_id) -> None:
    await _pedir("DELETE", f"{_caixa(de, conta)}/messages/{quote(mensagem_id, safe='')}", access)


async def enviar_direto(access, conta, de, para, assunto, corpo) -> None:
    await _pedir("POST", f"{_caixa(de, conta)}/sendMail", access,
                 json={"message": _mensagem(para, [], assunto, corpo), "saveToSentItems": True})


async def conferir_caixa(access, conta, caixa) -> bool:
    try:
        await _pedir("GET", f"{_caixa(caixa, conta)}/mailFolders/inbox?$select=id", access)
        return True
    except ErroGraph:
        return False
