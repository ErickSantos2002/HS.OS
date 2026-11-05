"""A tela "Memória do bot": a pessoa vê e apaga o que o PRÓPRIO bot lembrou.

⚠️ Só o bot cujo `dono_id` é quem pede — ninguém lê nem apaga a memória do
bot de outra pessoa por aqui. Apagar uma linha não toca nas outras nem no
cabeçalho.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.routers import acoes as rota

ERICK = Usuario("u-erick", "ti@healthsafetytech.com", "administrador")
MEM = "# MEMORY.md\n- 05/11/2026: prefere sexta\n- 05/11/2026: assina Erick | TI\n"


class Conn:
    def __init__(self, bot):
        self.bot = bot

    async def fetchval(self, sql, *a):
        return self.bot

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def amb(monkeypatch):
    estado = {"mem": MEM, "bot": "erick-bot"}
    monkeypatch.setattr(rota, "sessao", lambda **k: Conn(estado["bot"]))

    async def ler(bot):
        return estado["mem"]

    async def gravar(bot, c):
        estado["mem"] = c
    monkeypatch.setattr(rota, "_ler_memoria", ler)
    monkeypatch.setattr(rota, "_gravar_memoria", gravar)
    return estado


def test_lista_so_as_linhas(amb):
    r = asyncio.run(rota.ver_memoria(ERICK))
    assert r["bot"] == "erick-bot" and r["linhas"] == ["05/11/2026: prefere sexta", "05/11/2026: assina Erick | TI"]


def test_apaga_uma_linha(amb):
    asyncio.run(rota.apagar_linha_memoria(0, ERICK))
    assert amb["mem"] == "# MEMORY.md\n- 05/11/2026: assina Erick | TI\n"


def test_apaga_tudo(amb):
    asyncio.run(rota.apagar_memoria(ERICK))
    assert amb["mem"] == "# MEMORY.md\n"


def test_quem_nao_tem_bot_recebe_404(amb):
    amb["bot"] = None
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.ver_memoria(ERICK))
    assert e.value.status_code == 404
