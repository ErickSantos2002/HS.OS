"""A rota do painel de TV não pode nem PERGUNTAR pelo conteúdo.

Em 16/10/2026 a War Room foi para a TV da empresa e o Fluxo mostrava a
pergunta do CEO a um agente. Tirar o texto da montagem não basta: basta uma
consulta voltar a selecionar `content` "só para o rótulo" e ele reaparece. Este
teste lê o SQL que a rota manda e recusa a coluna.
"""
import asyncio
import re

import pytest

from app.routers import warroom as rota


class _Conn:
    def __init__(self, sqls):
        self.sqls = sqls

    async def fetch(self, sql, *a):
        self.sqls.append(sql)
        return []

    async def fetchrow(self, sql, *a):
        self.sqls.append(sql)
        return None

    async def fetchval(self, sql, *a):
        self.sqls.append(sql)
        return None


class _Sessao:
    def __init__(self, sqls):
        self.sqls = sqls

    async def __aenter__(self):
        return _Conn(self.sqls)

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def sqls(monkeypatch):
    lista = []
    monkeypatch.setattr(rota, "sessao", lambda **k: _Sessao(lista))

    async def segredo(nome):
        return "tok"

    monkeypatch.setattr(rota, "ler_segredo", segredo)
    return lista


def test_nenhuma_consulta_seleciona_content(sqls):
    asyncio.run(rota.feed(t="tok", usuario=None))
    assert sqls, "a rota não consultou nada?"
    for sql in sqls:
        assert not re.search(r"\bcontent\b", sql, re.I), sql


def test_resposta_no_contrato_novo_mesmo_com_banco_vazio(sqls):
    r = asyncio.run(rota.feed(t="tok", usuario=None))
    assert set(r) == {"ts", "diasNoAr", "setores", "pessoas", "agentes",
                      "conversasTime", "eventos", "numeros"}
    assert r["numeros"] == {"entregas": 0, "atendidas": 0, "pessoasAtivas": 0, "conversasTime": 0}


def test_sem_token_e_sem_sessao_recusa(sqls):
    with pytest.raises(Exception) as e:
        asyncio.run(rota.feed(t="errado", usuario=None))
    assert getattr(e.value, "status_code", None) == 401
