"""Escopos do Graph por conta.

⚠️ O refresh NÃO pode pedir o escopo de calendário de quem conectou antes dele
existir: a Microsoft recusa escopo não concedido (`invalid_grant`) e o e-mail
de todo mundo quebraria no deploy. Calendário só no authorize/troca de code.
"""
import asyncio

import pytest

from app.email import contas, graph


def _captura(monkeypatch, resposta=None):
    visto = {}

    async def pedir(metodo, url, access=None, **kw):
        visto.update(metodo=metodo, url=url, data=kw.get("data"))
        return resposta or {"access_token": "a", "refresh_token": "r"}

    monkeypatch.setattr(graph, "_pedir", pedir)
    return visto


def test_renovar_de_conta_antiga_nao_pede_calendario(monkeypatch):
    """Conta conectada antes do calendário (`escopos` nulo) renova com os
    escopos de e-mail de sempre; sem isto o deploy quebrava o e-mail de todos."""
    visto = _captura(monkeypatch)
    asyncio.run(graph.renovar("refresh", None))
    assert visto["data"]["scope"] == graph.ESCOPOS_EMAIL
    assert "Calendars" not in visto["data"]["scope"]


REAL = ["https://graph.microsoft.com/calendars.read.shared",
        "https://graph.microsoft.com/mail.readwrite", "openid", "profile", "email"]


@pytest.mark.parametrize("escopos", [["Mail.Send", "Calendars.Read.Shared"], REAL])
def test_renovar_de_conta_com_calendario_manda_a_constante(monkeypatch, escopos):
    """Sem `offline_access` no pedido a rotação do refresh token para em
    silêncio e o e-mail cai em ~90 dias: o scope é a constante, nunca o cru."""
    visto = _captura(monkeypatch)
    asyncio.run(graph.renovar("refresh", escopos))
    assert visto["data"]["scope"] == graph.ESCOPOS_CONECTAR
    assert "offline_access" in visto["data"]["scope"]


@pytest.mark.parametrize("escopos,esperado", [
    (["https://graph.microsoft.com/Calendars.Read.Shared"], True),
    (["Calendars.Read.Shared"], True), (["calendars.read.shared"], True),
    (["Mail.Send"], False), ([], False), (None, False)])
def test_concedeu_calendario(escopos, esperado):
    """Prefixo e caixa variam na resposta v2."""
    assert graph.concedeu_calendario(escopos) is esperado


def test_calendario_exige_fuso(monkeypatch):
    """Datetime ingênuo vira UTC no Graph: 3 h de erro sem aviso."""
    from datetime import datetime
    with pytest.raises(ValueError):
        asyncio.run(graph.calendario("a", "c", datetime(2026, 1, 1), datetime(2026, 1, 2)))


def test_conectar_pede_calendario():
    """Sem pedir no authorize a pessoa nunca consente e a agenda não lê."""
    assert "Calendars.Read.Shared" in graph.url_autorizacao("st")
    assert graph.ESCOPOS_EMAIL + " " + graph.ESCOPO_CALENDARIO == graph.ESCOPOS_CONECTAR
    assert "Calendars" not in graph.ESCOPOS_EMAIL


def test_trocar_code_devolve_escopos(monkeypatch):
    """Os escopos concedidos vêm do `scope` do token e são guardados na conta."""
    async def pedir(metodo, url, access=None, **kw):
        if "/token" in url:
            return {"access_token": "a", "refresh_token": "r", "scope": " ".join(REAL)}
        return {"mail": "A@x.com"}

    monkeypatch.setattr(graph, "_pedir", pedir)
    t = asyncio.run(graph.trocar_code("c"))
    assert t["escopos"] == REAL


class _Conn:
    def __init__(self, escopos):
        self.escopos = escopos

    async def fetchval(self, sql, *a):
        return self.escopos


@pytest.mark.parametrize("escopos,esperado", [
    (["Mail.Send", "calendars.read.shared"], True),
    (["Mail.Send"], False), (None, False), ([], False)])
def test_tem_calendario_sem_caixa(escopos, esperado):
    """Comparação sem caixa: a Microsoft devolve a caixa que quiser."""
    assert asyncio.run(contas.tem_calendario(_Conn(escopos), "u")) is esperado
