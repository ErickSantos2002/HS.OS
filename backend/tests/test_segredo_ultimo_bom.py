"""PK-08 — leitura de segredo que falha não vira "segredo não existe" (25/11/2026).

`ler_segredo` engolia a exceção do banco e gravava o resultado no cache por
60 s — inclusive `None`. Um soluço do Postgres virava um minuto de 503 em toda
rota `exige_segredo` (os MCP de todos os agentes), sem rastro do porquê. Era
o defeito que, no DN.OS, despachava o mesmo turno duas vezes.
"""
import asyncio
from contextlib import asynccontextmanager

import pytest

from app import integracoes


class _Conn:
    def __init__(self, valor):
        self.valor = valor

    async def fetchval(self, *_):
        return self.valor


def _banco(monkeypatch, estado):
    @asynccontextmanager
    async def sessao(**_):
        if estado["falha"]:
            raise ConnectionError("pool cheio")
        yield _Conn(estado["valor"])
    monkeypatch.setattr(integracoes, "sessao", sessao)


@pytest.fixture(autouse=True)
def limpo(monkeypatch):
    integracoes._cache.clear()
    integracoes._ultimo_bom.clear()
    monkeypatch.delenv("SEGREDO_X", raising=False)


def _expirar():
    for nome, (valor, _) in list(integracoes._cache.items()):
        integracoes._cache[nome] = (valor, -1e9)


def test_falha_do_banco_usa_o_ultimo_valor_bom(monkeypatch):
    estado = {"falha": False, "valor": "bom"}
    _banco(monkeypatch, estado)
    assert asyncio.run(integracoes.ler_segredo("SEGREDO_X")) == "bom"

    _expirar()
    estado["falha"] = True
    assert asyncio.run(integracoes.ler_segredo("SEGREDO_X")) == "bom"


def test_falha_nao_entra_no_cache(monkeypatch):
    """O banco voltou: a chamada seguinte já tem que vê-lo, não esperar 60 s."""
    estado = {"falha": True, "valor": "novo"}
    _banco(monkeypatch, estado)
    assert asyncio.run(integracoes.ler_segredo("SEGREDO_X")) is None

    estado["falha"] = False
    assert asyncio.run(integracoes.ler_segredo("SEGREDO_X")) == "novo"


def test_sem_valor_bom_cai_no_ambiente(monkeypatch):
    _banco(monkeypatch, {"falha": True, "valor": None})
    monkeypatch.setenv("SEGREDO_X", "do-env")
    assert asyncio.run(integracoes.ler_segredo("SEGREDO_X")) == "do-env"


def test_banco_respondeu_sem_valor_continua_valendo_o_ambiente(monkeypatch):
    """Comportamento de antes, mantido: tabela sem a linha → env, e isso cacheia."""
    _banco(monkeypatch, {"falha": False, "valor": None})
    monkeypatch.setenv("SEGREDO_X", "do-env")
    assert asyncio.run(integracoes.ler_segredo("SEGREDO_X")) == "do-env"
    assert integracoes._cache["SEGREDO_X"][0] == "do-env"
