"""Membros de canal — o que dá para trancar sem banco."""
import asyncio
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.routers import channels as c


class Conexao:
    def __init__(self, tipo):
        self.tipo = tipo
        self.apagou = False

    async def fetchval(self, sql, *args):
        return self.tipo

    async def execute(self, sql, *args):
        self.apagou = True
        return "DELETE 1"


def _remover(monkeypatch, tipo, papel="administrador"):
    conn = Conexao(tipo)

    @asynccontextmanager
    async def falsa(**_):
        yield conn

    monkeypatch.setattr(c, "sessao", falsa)
    usuario = Usuario(id="erick", email="x@y", papel=papel)
    return conn, lambda: asyncio.run(c.remover_membro("canal", "lidisay", usuario))


def test_dm_nao_perde_membro_nem_pelo_admin(monkeypatch):
    """Em 29/10/2026 o painel de membros oferecia a lixeira na DM do Erick com a
    Lidisay, e a RLS deixava: quem criou o canal (e o admin) tira o outro. Um
    clique e sobrava uma DM de uma pessoa só, que a tela de DM não sabe
    desenhar. A recusa vem antes do DELETE — nada é apagado."""
    conn, remover = _remover(monkeypatch, "dm")
    with pytest.raises(HTTPException) as erro:
        remover()
    assert erro.value.status_code == 403
    assert conn.apagou is False


def test_canal_de_grupo_continua_removendo(monkeypatch):
    conn, remover = _remover(monkeypatch, "private")
    remover()
    assert conn.apagou is True
