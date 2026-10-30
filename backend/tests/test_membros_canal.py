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


# ── Canal de avisos: só alguns escrevem — 30/10/2026 ─────────────────────────
#
# O grupo de avisos do WhatsApp (só o Nicholson e o RH mandam) pode vir para o
# HS.OS. A trava é a policy da 021; o que se testa aqui é a recusa com nome e as
# regras de configurar. Spec: docs/superpowers/specs/2026-10-30-canal-so-alguns-escrevem-design.md


def test_frase_de_quem_escreve():
    assert c.frase_de_quem_escreve(["Nicholson"]) == "Só Nicholson envia mensagens neste canal."
    assert c.frase_de_quem_escreve(["Lidisay", "Nicholson"]) == \
        "Só Lidisay e Nicholson enviam mensagens neste canal."
    assert c.frase_de_quem_escreve(["A", "B", "C"]) == "Só A, B e C enviam mensagens neste canal."
    assert c.frase_de_quem_escreve([]) == "Só o administrador envia mensagens neste canal."


class ConexaoAvisos:
    def __init__(self, pode, restrito, nomes=()):
        self.respostas = [pode, restrito]
        self.nomes = nomes

    async def fetchval(self, sql, *args):
        return self.respostas.pop(0)

    async def fetch(self, sql, *args):
        return [{"nome": n} for n in self.nomes]


def test_quem_so_le_e_recusado_com_os_nomes_de_quem_escreve():
    conn = ConexaoAvisos(False, True, ["Lidisay", "Nicholson"])
    with pytest.raises(HTTPException) as erro:
        asyncio.run(c._recusar_quem_nao_escreve(conn, "canal", "eu"))
    assert erro.value.status_code == 403
    assert erro.value.detail == "Só Lidisay e Nicholson enviam mensagens neste canal."


def test_quem_escreve_passa_sem_consultar_mais_nada():
    conn = ConexaoAvisos(True, True)
    asyncio.run(c._recusar_quem_nao_escreve(conn, "canal", "eu"))
    assert conn.respostas == [True], "consultou o canal à toa"


def test_canal_comum_nao_decide_nada():
    """Não-membro num canal comum segue esbarrando onde sempre esbarrou (RLS)."""
    conn = ConexaoAvisos(False, False)
    asyncio.run(c._recusar_quem_nao_escreve(conn, "canal", "eu"))


def test_so_administrador_configura_quem_escreve():
    with pytest.raises(HTTPException) as erro:
        c._conferir_escritores(True, ["a"], ["eu", "a"], "public", "colaborador")
    assert erro.value.status_code == 403


def test_escritor_precisa_ser_membro():
    with pytest.raises(HTTPException) as erro:
        c._conferir_escritores(True, ["fora"], ["eu", "a"], "private", "administrador")
    assert erro.value.status_code == 400


def test_dm_nao_vira_canal_de_avisos():
    with pytest.raises(HTTPException):
        c._conferir_escritores(True, [], ["eu", "a"], "dm", "administrador")


def test_canal_comum_de_colaborador_nao_esbarra_na_regra():
    c._conferir_escritores(False, [], ["eu"], "public", "colaborador")
    c._conferir_escritores(True, ["a"], ["eu", "a"], "public", "administrador")
