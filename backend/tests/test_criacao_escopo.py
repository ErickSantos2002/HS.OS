"""Tranca o fechamento do agente recém-criado: travas e escopo, juntos, ou nada.

⚠️ **O escopo de MCP do agente novo era fail-open.** A criação aplicava as
travas de especialista num `config.patch`, o escopo de MCP noutro, e cada um
num `try/except` que só registrava a falha em `conectores_com_falha`. Se o
segundo patch não passasse (rate limit, gateway reiniciando, conflito de hash),
a tela dizia "criado" e o agente ficava vivo sem `deny` de MCP — e como o
`alsoAllow` só acrescenta, enxergando as `hsos-anexos-<outro>`, cada uma com a
identidade (HMAC) de outro agente. Revisão de segurança, 13/10/2026.

Hoje é UM patch com as travas e o deny, e se ele falhar a criação é desfeita e
a resposta é erro. Não dá para ir além disso: `agents.create` não leva `tools`,
então existe um instante entre ele e o patch em que o agente está na config sem
escopo — mas ninguém conversa com ele nesse instante, e ele não sobrevive à
falha.

Async com `asyncio.run`, sem plugin; o gateway é um falso em memória.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.routers import agents as ag
from app.routers import integracoes as integ

ANEXOS = {"toolFilter": {"include": ["ler_anexo", "enviar_arquivo"]}}


def _conf():
    return {
        "mcp": {"servers": {
            "hsos-anexos-nina": ANEXOS,
            "hsos-alerta": {"toolFilter": {"include": ["avisar_administrador"]}},
        }},
        "agents": {"list": [
            {"id": "nina", "tools": {"alsoAllow": ["mcp__hsos-anexos-nina__ler_anexo"]}},
            {"id": "novo", "tools": {"alsoAllow": ["mcp__hsos-alerta__avisar_administrador"]}},
        ]},
    }


class GatewayFalso:
    def __init__(self, falhar=False):
        self.conf, self.patches, self.falhar = _conf(), [], falhar

    async def config_do_gateway(self):
        return self.conf, "hash-1"

    async def aplicar_patch(self, patch, base_hash, conferir=None):
        if self.falhar:
            raise RuntimeError("rate limit do config.patch")
        self.patches.append(patch)
        self.conf = {**self.conf, **patch}
        assert conferir is None or conferir(self.conf)


def _do_novo(gw):
    lista = gw.patches[-1]["agents"]["list"]
    return next(a for a in lista if a["id"] == "novo")["tools"]


def test_travas_e_deny_de_mcp_vao_no_mesmo_patch(monkeypatch):
    """Um patch só: não existe a ordem em que um passa e o outro não."""
    gw = GatewayFalso()
    monkeypatch.setattr(integ, "patch_gw", gw)
    asyncio.run(integ.aplicar_escopo_mcp("novo", travas=ag._TRAVAS_DE_ESPECIALISTA))
    assert len(gw.patches) == 1
    deny = _do_novo(gw)["deny"]
    assert "hsos-anexos-nina__ler_anexo" in deny
    assert "hsos-anexos-nina__enviar_arquivo" in deny
    for t in ag._TRAVAS_DE_ESPECIALISTA:
        assert t in deny
    assert "hsos-alerta__avisar_administrador" not in deny


def test_orquestradora_recebe_o_escopo_sem_as_travas(monkeypatch):
    gw = GatewayFalso()
    monkeypatch.setattr(integ, "patch_gw", gw)
    asyncio.run(integ.aplicar_escopo_mcp("novo"))
    deny = _do_novo(gw)["deny"]
    assert "hsos-anexos-nina__ler_anexo" in deny
    assert "sessions_send" not in deny


def test_falha_no_escopo_desfaz_a_criacao_e_vira_erro(monkeypatch):
    """O caso que vazava: o patch falha e a criação seguia como sucesso."""
    gw = GatewayFalso(falhar=True)
    monkeypatch.setattr(integ, "patch_gw", gw)
    desfeitos = []

    async def desfazer(aid):
        desfeitos.append(aid)

    monkeypatch.setattr(ag, "_desfazer_criacao", desfazer)
    with pytest.raises(HTTPException) as e:
        asyncio.run(ag._fechar_agente_novo("novo", especialista=True))
    assert e.value.status_code == 502
    assert "escopo" in e.value.detail.lower()
    assert desfeitos == ["novo"]


def test_sucesso_no_escopo_nao_desfaz_nada(monkeypatch):
    gw = GatewayFalso()
    monkeypatch.setattr(integ, "patch_gw", gw)

    async def desfazer(aid):
        raise AssertionError("não deveria desfazer")

    monkeypatch.setattr(ag, "_desfazer_criacao", desfazer)
    asyncio.run(ag._fechar_agente_novo("novo", especialista=True))
    assert "sessions_send" in _do_novo(gw)["deny"]
