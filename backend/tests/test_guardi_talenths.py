"""Guardi no TalentHS (13/11/2026): lê o que o login do DONO lê, nada mais.

Spec `docs/superpowers/specs/2026-11-13-guardi-talenths-design.md`. Quem aplica
a permissão é o TalentHS (papel `user` × `manager`, que lá é o RH); daqui se
tranca o resto:
- o agente escolhe uma CONSULTA de uma lista fechada — nunca um caminho: um
  caminho livre alcançaria download de documento, prova e convites;
- os filtros são os DECLARADOS (tirados do `/openapi.json` público de lá) e os
  obrigatórios são cobrados aqui, antes de gastar uma chamada;
- "do time" no TalentHS é a empresa inteira — a ferramenta diz isso ao agente.
"""
import asyncio

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import agente_token as at
from app import talenths_consultas as th
from app.config import settings
from app.sistemas import talenths


def test_catalogo_sem_arquivo_prova_nem_convite():
    """Nenhum arquivo vai ao modelo, e o Guardi não vê nem ajuda a fazer prova.
    O allowlist do TalentHS é a segunda tranca, não a única."""
    proibidas = ("download", "attachments", "/take", "/invitations", "/logs", "/admin", "stream")
    for chave, (caminho, _d, _f, _o) in th.CONSULTAS.items():
        assert not any(p in caminho for p in proibidas), chave
        if caminho.startswith("/auth"):
            assert caminho == "/auth/me", chave
        if caminho.startswith("/tests"):
            assert caminho in ("/tests/available", "/tests/my-attempts"), chave
        if caminho.startswith("/videos"):
            assert caminho == "/videos/mine", chave


def test_obrigatorios_estao_entre_os_aceitos():
    for chave, (_c, _d, filtros, obrig) in th.CONSULTAS.items():
        assert set(obrig) <= set(filtros), chave


def test_caminho_vem_do_catalogo():
    """O `id` monta UM segmento: `1/../../auth` escaparia para outra rota com o
    token do dono."""
    assert th.caminho_da_consulta("meta", "abc-123") == "/goals/abc-123"
    assert th.caminho_da_consulta("beneficios_de_uma_pessoa", "u1") == "/benefits/employee/u1"
    for ruim in ("1/../../auth/me", "", None, "a b", ".."):
        with pytest.raises(ValueError):
            th.caminho_da_consulta("meta", ruim)
    with pytest.raises(ValueError):
        th.caminho_da_consulta("minhas_ausencias", "5")      # não leva id
    with pytest.raises(ValueError):
        th.caminho_da_consulta("/absences/team", None)       # caminho não é consulta


def test_filtros_declarados_validados_e_obrigatorios():
    assert th.params_da_consulta("meu_ponto", {"start_date": "2026-11-01", "end_date": "2026-11-13"}) == [
        ("start_date", "2026-11-01"), ("end_date", "2026-11-13")]
    assert th.params_da_consulta("metas", {"cycle_id": "c1", "month": 11}) == [
        ("cycle_id", "c1"), ("month", "11")]
    assert th.params_da_consulta("pdi_do_time", {"include_inactive": "TRUE"}) == [
        ("include_inactive", "true")]
    for chave, p in [("metas", {}),                                   # cycle_id obrigatório
                     ("notas_da_avaliacao", {"cycle_id": "c"}),        # evaluated_user_id também
                     ("meu_ponto", {"start_date": "13/11/2026"}),      # data fora do formato
                     ("metas", {"cycle_id": "c", "month": 13}),
                     ("colaboradores", {"status": "todos"}),
                     ("minhas_ausencias", {"user_id": "outro"}),       # filtro não declarado
                     ("ponto_do_time", {"user_id": "a/../b"})]:
        with pytest.raises(ValueError):
            th.params_da_consulta(chave, p)


def test_lista_pagina_do_nosso_lado():
    params, offset, limite = th.paginacao_local(
        th.params_da_consulta("ausencias_do_time", {"offset": 20, "limite": 10}))
    assert params == [] and (offset, limite) == (20, 10)


# --- o cliente ------------------------------------------------------------------

@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


def test_cliente_le_a_api_com_token_do_dono(chave, monkeypatch):
    """A API do TalentHS tem domínio próprio e NÃO tem prefixo. O token vai com
    `aud=talenths`, `sub` = e-mail do DONO, `act` = o Guardi; sempre GET."""
    reqs = []
    monkeypatch.setattr(talenths, "_transporte", httpx.MockTransport(
        lambda r: reqs.append(r) or httpx.Response(200, json={"id": "u1"})))
    assert asyncio.run(talenths.chamar("ana@hs.com", "ana-bot", "/auth/me")) == {"id": "u1"}
    r = reqs[0]
    assert r.method == "GET"
    assert str(r.url) == settings.TALENTHS_API_URL.rstrip("/") + "/auth/me"
    d = jwt.decode(r.headers["authorization"].removeprefix("Bearer "), at.chave_publica_pem(),
                   algorithms=["EdDSA"], audience="talenths")
    assert d["sub"] == "ana@hs.com" and d["act"] == {"sub": "ana-bot"}


def test_403_e_o_papel_do_dono(chave, monkeypatch):
    """Quase todo 403 lá é "essa visão é do RH". Dito como falha, o Guardi
    pediria para tentar de novo ou chamaria o administrador do HS.OS."""
    monkeypatch.setattr(talenths, "_transporte", httpx.MockTransport(lambda r: httpx.Response(403, json={})))
    with pytest.raises(talenths.ErroSistema) as e:
        asyncio.run(talenths.chamar("ana@hs.com", "ana-bot", "/absences/team"))
    assert "RH" in str(e.value)


# --- as ferramentas no hsos-bot-<bot> --------------------------------------------

_CTX = {"sistemas": ["talenths"], "email": "ana@hs.com", "dono": None, "primeiro": "Ana"}


def test_ferramentas_no_guardi():
    from app.email.regras import FERRAMENTAS_BOT
    assert {"talenths_consultas", "talenths_consultar"} <= set(FERRAMENTAS_BOT)


def test_sem_talenths_ligado_recusa_sem_rede(chave, monkeypatch):
    from app.routers import mcp_bot
    chamadas = []
    monkeypatch.setattr(talenths, "_transporte", httpx.MockTransport(
        lambda r: chamadas.append(r) or httpx.Response(200, json={})))
    for nome in ("talenths_consultas", "talenths_consultar"):
        with pytest.raises(mcp_bot._Recusa):
            asyncio.run(mcp_bot._talenths(None, "ana-bot", nome, {"consulta": "eu"},
                                          {**_CTX, "sistemas": ["taskhs"]}))
    assert chamadas == []


def test_consulta_vira_get_e_dado_externo(chave, monkeypatch):
    from app.routers import mcp_bot
    reqs = []
    monkeypatch.setattr(talenths, "_transporte", httpx.MockTransport(
        lambda r: reqs.append(r) or httpx.Response(200, json=[{"id": "a1", "status": "pending"}])))
    t = asyncio.run(mcp_bot._talenths(None, "ana-bot", "talenths_consultar",
                                      {"consulta": "minhas_ausencias"}, _CTX))
    assert reqs[0].url.path == "/absences/my" and reqs[0].url.query == b""
    assert "DADO_EXTERNO" in t and "origem: TalentHS" in t and "pending" in t


def test_filtro_errado_nao_gasta_chamada(chave, monkeypatch):
    from app.routers import mcp_bot
    reqs = []
    monkeypatch.setattr(talenths, "_transporte", httpx.MockTransport(
        lambda r: reqs.append(r) or httpx.Response(200, json={})))
    with pytest.raises(ValueError):
        asyncio.run(mcp_bot._talenths(None, "ana-bot", "talenths_consultar", {"consulta": "metas"}, _CTX))
    assert reqs == []


def test_lista_de_consultas_marca_obrigatorios(chave):
    from app.routers import mcp_bot
    t = asyncio.run(mcp_bot._talenths(None, "ana-bot", "talenths_consultas", {"consulta": "metas"}, _CTX))
    assert "cycle_id*" in t and "minhas_ausencias" not in t


def test_agents_md_aponta_para_o_talenths_e_cabe_no_teto():
    """Ferramenta disponível não é ferramenta usada: sem o ponteiro, o Guardi
    responderia "não tenho acesso ao RH"."""
    from app.bots_pessoais import arquivos_do_bot
    from app.gateway.client import TETO_ARQUIVO_AGENTE
    a = arquivos_do_bot({"full_name": "Lidisay Teste", "email": "x@y", "user_id": "u",
                         "cargo": "RH", "setor": "RH"})
    assert "talenths_consultas" in a["AGENTS.md"] and "empresa inteira" in a["AGENTS.md"]
    assert len(a["AGENTS.md"]) < TETO_ARQUIVO_AGENTE
