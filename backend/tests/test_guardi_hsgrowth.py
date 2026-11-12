"""Guardi no HSGrowth (12/11/2026): cliente com token de agente e catálogo de
leitura. Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`."""
import asyncio

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import agente_token as at
from app.sistemas import hsgrowth
from app.sistemas.taskhs import ErroSistema


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


# --- o cliente ------------------------------------------------------------------

def test_chama_a_api_com_aud_hsgrowth(chave, monkeypatch):
    """Token com `aud` errado o HSGrowth recusa com 401 e a pessoa leria "sem
    conta lá". E a URL tem que ser a da API (`growthhsapi`, com `/api/v1`): o
    front devolveria o HTML da SPA com 200."""
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"id": 5})
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    assert asyncio.run(hsgrowth.chamar("ana@hs.com", "ana-bot", "/cards/5/expanded")) == {"id": 5}
    r = reqs[0]
    assert str(r.url) == "https://growthhsapi.healthsafetytech.com/api/v1/cards/5/expanded"
    token = r.headers["authorization"].removeprefix("Bearer ")
    d = jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="hsgrowth")
    assert d["sub"] == "ana@hs.com" and d["act"] == {"sub": "ana-bot"}


def test_403_na_leitura_e_na_escrita_dizem_coisas_diferentes(chave, monkeypatch):
    """Na escrita, 403 é a FUNÇÃO do dono; a mensagem de leitura mandaria a
    pessoa pedir um acesso que ela já tem (e vice-versa)."""
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(lambda r: httpx.Response(403, json={})))
    with pytest.raises(ErroSistema) as le:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards/1/expanded"))
    with pytest.raises(ErroSistema) as es:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards", metodo="POST", json={}))
    assert "ver" in str(le.value)
    assert "o HSGrowth não deixa a sua função fazer isso" in str(es.value)


def test_409_repassa_o_detail(chave, monkeypatch):
    """O `detail` do 409 é a regra do CRM ("Este CNPJ está com o parceiro X");
    uma mensagem genérica esconderia à pessoa o que fazer a seguir."""
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(
        lambda r: httpx.Response(409, json={"detail": "Este CNPJ está com o parceiro X"})))
    with pytest.raises(ErroSistema) as e:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards", metodo="POST", json={}))
    assert "Este CNPJ está com o parceiro X" in str(e.value)
