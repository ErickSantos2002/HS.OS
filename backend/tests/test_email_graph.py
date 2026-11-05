"""O cliente Graph fala com a caixa certa e nunca vaza o token no erro.

⚠️ Caixa compartilhada é `/users/{caixa}/...`; a própria conta é `/me/...`.
Trocar um pelo outro faz o rascunho nascer (e o e-mail sair) pela caixa
errada — e a maioria do time envia pela compartilhada.
"""
import asyncio
import json

import httpx
import pytest

from app.email import graph as g

CONTA = "ti@healthsafetytech.com"


def _transporte(capturadas, status=200, corpo=None):
    def h(req: httpx.Request):
        capturadas.append(req)
        return httpx.Response(status, json=corpo if corpo is not None else {"id": "m1", "value": []})
    return httpx.MockTransport(h)


def test_caixa_compartilhada_usa_users(monkeypatch):
    reqs = []
    monkeypatch.setattr(g, "_transporte", _transporte(reqs))
    asyncio.run(g.criar_rascunho("tok", CONTA, "ti@healthsafety.com.br", ["a@y.com"], [], "Oi", "c"))
    assert reqs[0].url.path == "/v1.0/users/ti@healthsafety.com.br/messages"
    assert reqs[0].headers["authorization"] == "Bearer tok"
    corpo = json.loads(reqs[0].content)
    assert corpo["toRecipients"] == [{"emailAddress": {"address": "a@y.com"}}]
    assert corpo["body"]["contentType"] == "Text"


def test_a_propria_conta_usa_me(monkeypatch):
    reqs = []
    monkeypatch.setattr(g, "_transporte", _transporte(reqs))
    asyncio.run(g.listar("tok", CONTA, CONTA, "inbox", None, None, 5))
    assert reqs[0].url.path == "/v1.0/me/mailFolders/inbox/messages"
    assert reqs[0].url.params["$top"] == "5"


def test_erro_nao_carrega_token(monkeypatch):
    monkeypatch.setattr(g, "_transporte", _transporte([], status=403,
                        corpo={"error": {"code": "ErrorSendAsDenied", "message": "nope"}}))
    with pytest.raises(g.ErroGraph) as e:
        asyncio.run(g.enviar_rascunho("tok-secreto", CONTA, "ti@healthsafety.com.br", "m1"))
    assert e.value.status == 403 and "ErrorSendAsDenied" in str(e.value)
    assert "tok-secreto" not in str(e.value)


def test_id_e_pasta_nao_escapam_do_caminho(monkeypatch):
    """O id e a pasta vêm do agente — e o agente lê e-mail de terceiros.
    `../` não pode virar outro recurso do Graph."""
    reqs = []
    monkeypatch.setattr(g, "_transporte", _transporte(reqs))
    asyncio.run(g.ler("tok", CONTA, CONTA, "../../users/ceo@x.com/messages/1"))
    asyncio.run(g.listar("tok", CONTA, CONTA, "inbox/../../users/ceo@x.com", None, None, 5))
    for req in reqs:
        cru = req.url.raw_path.decode()
        assert "/users/ceo" not in cru and "/../" not in cru, cru


def test_desde_e_busca_validados(monkeypatch):
    """`desde` entra no $filter e `busca` no $search: argumento do agente.
    Data inválida é recusada antes do Graph; aspas na busca não quebram a sintaxe."""
    reqs = []
    monkeypatch.setattr(g, "_transporte", _transporte(reqs))
    with pytest.raises(ValueError):
        asyncio.run(g.listar("tok", CONTA, CONTA, "inbox", "2026-11-01 or true", None, 5))
    asyncio.run(g.listar("tok", CONTA, CONTA, "inbox", None, 'proposta "x"', 5))
    assert reqs[-1].url.params["$search"] == '"proposta x"'


def test_anexos_demais_falha_fechado(monkeypatch):
    """Listagem paginada: olhar só a 1ª página deixaria anexo fora do cartão."""
    monkeypatch.setattr(g, "_transporte", _transporte([], corpo={"value": [], "@odata.nextLink": "x"}))
    with pytest.raises(g.ErroGraph):
        asyncio.run(g.listar_anexos("tok", CONTA, CONTA, "m1"))


def test_listar_anexos_nao_pede_campo_de_tipo_derivado(monkeypatch):
    """05/11, 15:28: `$select=…contentId` em /attachments → Graph 400 "Could not
    find a property named 'contentId' on type 'microsoft.graph.attachment'".
    Nenhum e-mail saiu para ninguém depois do deploy. `contentId` é do
    `fileAttachment` (tipo derivado): não pode ir no $select da base."""
    reqs = []
    monkeypatch.setattr(g, "_transporte", _transporte(reqs, corpo={"value": []}))
    asyncio.run(g.listar_anexos("tok", CONTA, CONTA, "m1"))
    assert "contentId" not in reqs[0].url.params.get("$select", "")
