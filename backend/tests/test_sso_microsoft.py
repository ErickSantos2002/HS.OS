"""Login com Microsoft: o callback nunca vira 500 e nunca abre conta que não existe.

O desenho é o do DataCoreHS (spec 2026-09-24 de lá), e estes testes trancam as
decisões que custariam caro se escorregassem:

- **`state` com acento na query.** `secrets.compare_digest` sobre `str` levanta
  `TypeError` com caractere não ASCII. Como o `state` vem da URL, comparar texto
  seria um 500 esperando o primeiro curioso — por isso a comparação é em bytes.
- **Conta Microsoft sem usuário aqui não entra.** O tenant inteiro da HS tem
  conta Microsoft; quem tem acesso aos agentes é quem foi cadastrado no HS.OS.
- **O ticket é de uso único.** O JWT nunca vai na URL; o ticket vai, e por isso
  não pode servir duas vezes.
- **Desativar a pessoa corta o SSO também**, inclusive entre o callback e a troca.

Banco e Microsoft são trocados por dublês: nada aqui sai da máquina.
"""
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.auth import microsoft, sso
from app.auth import router as modulo_router
from app.config import settings

FRONT = "https://hsos.healthsafetytech.com"
CALLBACK = "https://hsosapi.healthsafetytech.com/auth/microsoft/callback"

CONTA = {
    "id": "00000000-0000-4000-8000-000000000001",
    "email": "rh@exemplo.com",
    "is_active": True,
    "papel": "colaborador",
}


class BancoFalso:
    """O mínimo de `app.auth.sso` que as rotas usam, em memória."""

    def __init__(self, contas):
        self.contas = {c["email"]: dict(c) for c in contas}
        self.tickets: dict[str, str] = {}
        self.entradas: list[str] = []

    async def buscar_conta(self, email):
        return self.contas.get(email.lower())

    async def conta_por_id(self, user_id):
        return next((c for c in self.contas.values() if c["id"] == user_id), None)

    async def emitir_ticket(self, user_id):
        ticket = f"ticket-{len(self.tickets)}"
        self.tickets[ticket] = user_id
        return ticket

    async def resgatar_ticket(self, ticket):
        return self.tickets.pop(ticket, None)

    async def registrar_entrada(self, user_id):
        self.entradas.append(user_id)


@pytest.fixture
def sso_ligado(monkeypatch):
    monkeypatch.setattr(settings, "MS_TENANT_ID", "tenant-hs")
    monkeypatch.setattr(settings, "MS_CLIENT_ID", "cliente-hsos")
    monkeypatch.setattr(settings, "MS_CLIENT_SECRET", "segredo")
    monkeypatch.setattr(settings, "MS_REDIRECT_URI", CALLBACK)
    monkeypatch.setattr(settings, "FRONTEND_URL", f"{FRONT},http://localhost:8080")


@pytest.fixture
def banco(monkeypatch):
    falso = BancoFalso([CONTA])
    for nome in ("buscar_conta", "conta_por_id", "emitir_ticket", "resgatar_ticket", "registrar_entrada"):
        monkeypatch.setattr(sso, nome, getattr(falso, nome))
    return falso


@pytest.fixture
def microsoft_responde(monkeypatch):
    """A Microsoft devolve o e-mail que o teste mandar (em `.email`)."""

    class Dubl:
        email: str | None = "RH@exemplo.com"
        falhar = False

    async def trocar(code):
        if Dubl.falhar:
            raise microsoft.ErroMicrosoft("troca do code: HTTP 400")
        return "token-da-microsoft"

    async def email(token):
        assert token == "token-da-microsoft"
        return Dubl.email

    monkeypatch.setattr(microsoft, "trocar_code_por_token", trocar)
    monkeypatch.setattr(microsoft, "email_do_usuario", email)
    return Dubl


def cliente() -> TestClient:
    app = FastAPI()
    app.include_router(modulo_router.router)
    return TestClient(app, base_url="https://hsosapi.healthsafetytech.com", follow_redirects=False)


def destino(resposta) -> tuple[str, dict]:
    assert resposta.status_code == 302, resposta.text
    url = urlparse(resposta.headers["location"])
    return f"{url.scheme}://{url.netloc}{url.path}", {k: v[0] for k, v in parse_qs(url.query).items()}


def voltar_da_microsoft(c: TestClient, state="s1", cookie="s1", **params):
    if cookie is not None:
        c.cookies.set("sso_state", cookie, domain="hsosapi.healthsafetytech.com", path="/auth/microsoft")
    query = {"code": "codigo", "state": state, **params}
    query = {k: v for k, v in query.items() if v is not None}
    return c.get("/auth/microsoft/callback", params=query)


# ─── status e início ─────────────────────────────────────────────────────────

def test_status_desligado_sem_as_variaveis(monkeypatch):
    monkeypatch.setattr(settings, "MS_CLIENT_SECRET", "")
    assert cliente().get("/auth/sso/status").json() == {"ativo": False}


def test_status_ligado_com_as_variaveis(sso_ligado):
    assert cliente().get("/auth/sso/status").json() == {"ativo": True}


def test_inicio_manda_para_a_microsoft_com_state_no_cookie(sso_ligado):
    r = cliente().get("/auth/microsoft")
    url, q = destino(r)

    assert url == "https://login.microsoftonline.com/tenant-hs/oauth2/v2.0/authorize"
    assert q["client_id"] == "cliente-hsos"
    assert q["redirect_uri"] == CALLBACK
    assert q["scope"] == "openid email profile User.Read"
    cookie = r.headers["set-cookie"]
    assert f"sso_state={q['state']}" in cookie
    assert "HttpOnly" in cookie and "Path=/auth/microsoft" in cookie and "Secure" in cookie


def test_inicio_com_sso_desligado_volta_ao_login_com_o_motivo(monkeypatch):
    monkeypatch.setattr(settings, "MS_TENANT_ID", "")
    monkeypatch.setattr(settings, "FRONTEND_URL", FRONT)
    url, q = destino(cliente().get("/auth/microsoft"))
    assert url == f"{FRONT}/login" and q == {"erro_sso": "sso_desligado"}


# ─── callback ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("state,cookie", [
    ("s1", "outro"),      # diferentes
    (None, "s1"),         # state ausente
    ("s1", None),         # cookie ausente
    ("sãø", "s1"),        # não ASCII: com compare_digest sobre str seria 500
])
def test_state_que_nao_confere_nunca_vira_500(sso_ligado, banco, microsoft_responde, state, cookie):
    r = voltar_da_microsoft(cliente(), state=state, cookie=cookie)
    assert destino(r)[1] == {"erro_sso": "state_invalido"}
    assert banco.tickets == {}


def test_quem_cancela_na_microsoft_ve_cancelado(sso_ligado, banco, microsoft_responde):
    r = voltar_da_microsoft(cliente(), code=None, error="access_denied")
    assert destino(r)[1] == {"erro_sso": "cancelado"}


def test_falha_na_troca_do_code(sso_ligado, banco, microsoft_responde):
    microsoft_responde.falhar = True
    assert destino(voltar_da_microsoft(cliente()))[1] == {"erro_sso": "falha_microsoft"}


def test_conta_microsoft_sem_usuario_aqui_nao_entra(sso_ligado, banco, microsoft_responde):
    microsoft_responde.email = "ceo@exemplo.com"
    assert destino(voltar_da_microsoft(cliente()))[1] == {"erro_sso": "usuario_nao_encontrado"}
    assert banco.tickets == {}


def test_conta_desativada_nao_entra(sso_ligado, banco, microsoft_responde):
    banco.contas["rh@exemplo.com"]["is_active"] = False
    assert destino(voltar_da_microsoft(cliente()))[1] == {"erro_sso": "conta_desativada"}
    assert banco.tickets == {}


def test_caminho_feliz_manda_ticket_ao_front_e_apaga_o_cookie(sso_ligado, banco, microsoft_responde):
    """O e-mail vem com maiúsculas da Microsoft e casa com o cadastrado em minúsculas."""
    r = voltar_da_microsoft(cliente())
    url, q = destino(r)

    assert url == f"{FRONT}/auth/callback"   # a PRIMEIRA origem do FRONTEND_URL
    assert banco.tickets == {q["ticket"]: CONTA["id"]}
    assert "token" not in r.headers["location"].replace("ticket", "")  # nada de JWT na URL
    assert 'sso_state=""' in r.headers["set-cookie"] and "Max-Age=0" in r.headers["set-cookie"]


# ─── troca do ticket ─────────────────────────────────────────────────────────

def test_ticket_vira_o_mesmo_token_do_login_e_so_uma_vez(sso_ligado, banco, microsoft_responde):
    c = cliente()
    _, q = destino(voltar_da_microsoft(c))

    r = c.post("/auth/sso/exchange", json={"ticket": q["ticket"]})
    assert r.status_code == 200
    dados = jwt.decode(r.json()["access_token"], settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
    assert (dados["sub"], dados["papel"], dados["email"]) == (CONTA["id"], "colaborador", "rh@exemplo.com")
    assert banco.entradas == [CONTA["id"]]

    segunda = c.post("/auth/sso/exchange", json={"ticket": q["ticket"]})
    assert segunda.status_code == 400
    assert segunda.json()["detail"] == "Link de acesso inválido ou expirado."


def test_ticket_inventado_e_recusado(sso_ligado, banco):
    assert cliente().post("/auth/sso/exchange", json={"ticket": "nao-existe"}).status_code == 400


def test_desativada_entre_o_callback_e_a_troca_nao_recebe_token(sso_ligado, banco, microsoft_responde):
    c = cliente()
    _, q = destino(voltar_da_microsoft(c))
    banco.contas["rh@exemplo.com"]["is_active"] = False

    assert c.post("/auth/sso/exchange", json={"ticket": q["ticket"]}).status_code == 403
    assert banco.entradas == []
