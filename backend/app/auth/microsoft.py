"""Conversa com a Microsoft no login por Entra ID: autorização, token e e-mail.

Cópia do desenho do DataCoreHS (`backend/app/core/microsoft.py` de lá), trocando
`requests` por `httpx` assíncrono, que é o que este backend usa.

O token da Microsoft só serve para ler o e-mail no Graph e é descartado — nada
dele é guardado. Mensagens de `ErroMicrosoft` vão para o log: nunca pôr ali o
`code`, o token ou o segredo.
"""

from urllib.parse import urlencode

import httpx

from app.config import settings

ESCOPOS = "openid email profile User.Read"
GRAPH_ME = "https://graph.microsoft.com/v1.0/me"
TIMEOUT = 10


class ErroMicrosoft(Exception):
    """Falha de rede ou resposta inesperada da Microsoft."""


def _base() -> str:
    return f"https://login.microsoftonline.com/{settings.MS_TENANT_ID}/oauth2/v2.0"


def _corpo(resposta: httpx.Response, etapa: str) -> dict:
    if not resposta.is_success:
        raise ErroMicrosoft(f"{etapa}: HTTP {resposta.status_code}")
    try:
        corpo = resposta.json()
    except ValueError as erro:
        raise ErroMicrosoft(f"{etapa}: resposta não é JSON") from erro
    if not isinstance(corpo, dict):
        raise ErroMicrosoft(f"{etapa}: resposta inesperada")
    return corpo


def url_de_autorizacao(state: str) -> str:
    parametros = {
        "client_id": settings.MS_CLIENT_ID,
        "response_type": "code",
        "redirect_uri": settings.MS_REDIRECT_URI,
        "response_mode": "query",
        "scope": ESCOPOS,
        "state": state,
    }
    return f"{_base()}/authorize?{urlencode(parametros)}"


async def trocar_code_por_token(code: str) -> str:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            resposta = await cliente.post(
                f"{_base()}/token",
                data={
                    "grant_type": "authorization_code",
                    "client_id": settings.MS_CLIENT_ID,
                    "client_secret": settings.MS_CLIENT_SECRET,
                    "code": code,
                    "redirect_uri": settings.MS_REDIRECT_URI,
                    "scope": ESCOPOS,
                },
            )
    except httpx.HTTPError as erro:
        raise ErroMicrosoft(f"troca do code: {type(erro).__name__}") from erro
    token = _corpo(resposta, "troca do code").get("access_token")
    if not isinstance(token, str) or not token:
        raise ErroMicrosoft("troca do code: sem access_token")
    return token


async def email_do_usuario(access_token: str) -> str | None:
    """E-mail da conta, cru (quem chama normaliza). `mail` vem nulo em conta sem
    caixa de correio; aí vale o `userPrincipalName`, que no tenant da HS é o e-mail.

    ⚠️ **Conta convidada (guest) não entra** — é a porta do ataque "nOAuth". O
    `mail` de um convidado é o e-mail EXTERNO dele, escolhido fora do nosso
    controle; casar por ele entregaria a conta de quem tivesse aquele e-mail
    aqui. Membro do tenant tem `mail` que só o administrador do Entra muda.
    Convidado devolve `None`, que vira `usuario_nao_encontrado`."""
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT) as cliente:
            resposta = await cliente.get(
                GRAPH_ME,
                headers={"Authorization": f"Bearer {access_token}"},
                params={"$select": "mail,userPrincipalName,userType"},
            )
    except httpx.HTTPError as erro:
        raise ErroMicrosoft(f"Graph /me: {type(erro).__name__}") from erro
    corpo = _corpo(resposta, "Graph /me")
    upn = corpo.get("userPrincipalName") or ""
    if corpo.get("userType") != "Member" or "#EXT#" in upn.upper():
        return None
    return corpo.get("mail") or upn or None
