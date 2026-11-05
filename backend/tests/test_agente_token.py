"""Token de agente: o bot age como a pessoa no TaskHS (e depois nos outros).

⚠️ É a credencial mais forte que o HS.OS emite: abre o sistema como qualquer
colaborador. O que se tranca:
- vale para UM sistema (`aud`) e por 5 minutos — o TaskHS recusa `exp` a mais
  de 600 s;
- só a chave do HS.OS assina; outra chave não verifica;
- o cliente usa sempre o `aud` dele — token do TaskHS não serve no GestorHS.
"""
import asyncio

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import agente_token as at
from app.sistemas import taskhs


def _pem(k):
    return k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", _pem(k).replace("\n", "\\n"))
    return k


def test_token_verifica_com_a_publica_e_tem_os_claims(chave):
    t = at.token_de_agente("taskhs", "ti@healthsafetytech.com", "erick-bot")
    d = jwt.decode(t, at.chave_publica_pem(), algorithms=["EdDSA"], audience="taskhs", issuer="hsos")
    assert d["sub"] == "ti@healthsafetytech.com" and d["act"] == {"sub": "erick-bot"}
    assert d["exp"] - d["iat"] == 300 and d["jti"]


def test_outra_chave_nao_verifica(chave):
    t = at.token_de_agente("taskhs", "ti@healthsafetytech.com", "erick-bot")
    outra = Ed25519PrivateKey.generate().public_key().public_bytes(
        s.Encoding.PEM, s.PublicFormat.SubjectPublicKeyInfo)
    with pytest.raises(jwt.InvalidSignatureError):
        jwt.decode(t, outra, algorithms=["EdDSA"], audience="taskhs")


def test_sem_chave_recusa(monkeypatch):
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", "")
    with pytest.raises(at.ErroToken):
        at.token_de_agente("taskhs", "a@b.com", "x-bot")


def test_cliente_taskhs_manda_token_do_taskhs(chave, monkeypatch):
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json=[{"id": 1}])
    monkeypatch.setattr(taskhs, "_transporte", httpx.MockTransport(h))
    r = asyncio.run(taskhs.chamar("ti@healthsafetytech.com", "erick-bot", "GET", "/cards/minhas"))
    assert r == [{"id": 1}] and reqs[0].url.path.endswith("/api/cards/minhas")
    token = reqs[0].headers["authorization"].removeprefix("Bearer ")
    assert jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="taskhs")


def test_401_vira_mensagem_de_acesso(chave, monkeypatch):
    monkeypatch.setattr(taskhs, "_transporte", httpx.MockTransport(lambda r: httpx.Response(401, json={})))
    with pytest.raises(taskhs.ErroSistema) as e:
        asyncio.run(taskhs.chamar("ti@healthsafetytech.com", "erick-bot", "GET", "/auth/me"))
    assert e.value.status == 401 and "acesso" in str(e.value)
