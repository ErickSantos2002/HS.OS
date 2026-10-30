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


# ── Conta desativada não entra em canal — 30/10/2026 ─────────────────────────
#
# O Erick criou o canal "Geral" marcando todo mundo e a Cláudia e a Karolaine,
# as duas desativadas, entraram junto: o seletor lista todo perfil e nenhuma
# das duas rotas que gravam membro olhava o status. Membro desativado recebe
# recibo de leitura que nunca vira azul e aparece na lista do canal.


class ConexaoInativos:
    def __init__(self, nomes):
        self.nomes = nomes
        self.args = None

    async def fetch(self, sql, *args):
        self.args = args
        return [{"nome": n} for n in self.nomes]


def test_conta_desativada_e_recusada_com_o_nome():
    conn = ConexaoInativos(["Cláudia Silva dos Santos", "Karolaine Martins"])
    with pytest.raises(HTTPException) as erro:
        asyncio.run(c._recusar_desativados(conn, ["a", "b", "c"]))
    assert erro.value.status_code == 400
    assert "Cláudia Silva dos Santos" in erro.value.detail
    assert "Karolaine Martins" in erro.value.detail


def test_so_gente_ativa_passa():
    conn = ConexaoInativos([])
    asyncio.run(c._recusar_desativados(conn, ["a"]))
    assert conn.args == (["a"],)


def test_lista_vazia_nem_consulta():
    conn = ConexaoInativos(["x"])
    asyncio.run(c._recusar_desativados(conn, []))
    assert conn.args is None
