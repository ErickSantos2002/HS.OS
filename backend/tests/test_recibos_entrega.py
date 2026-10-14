"""O "entregue" marcado pelo servidor (spec 2026-10-14).

Quem marca é cada worker, para quem está ligado nele. Se isto errar, ou o
cinza nunca acende (ninguém marca), ou o horário do "Dados da mensagem" anda
a cada aba aberta (marca de novo).
"""
import asyncio
from contextlib import asynccontextmanager

from app import recibos_entrega as e
from app.realtime import Hub


def test_usuarios_conectados_so_conta_topico_de_usuario():
    hub = Hub()
    fila = hub.assinar(["usuario:a", "canal:x", "tabela:y"])
    assert hub.usuarios_conectados() == {"a"}
    hub.cancelar(["usuario:a", "canal:x", "tabela:y"], fila)
    assert hub.usuarios_conectados() == set()


def test_entregar_nao_reescreve_horario_ja_gravado():
    """Duas abas da mesma pessoa em workers diferentes marcam as duas. Sem o
    `IS NULL`, a segunda empurraria o horário de entrega para a frente."""
    for sql in (e.SQL_ENTREGAR_PENDENTES, e.SQL_ENTREGAR_MENSAGEM):
        assert "entregue_em IS NULL" in sql


def test_entregar_mensagem_sem_ninguem_conectado_nao_abre_conexao(monkeypatch):
    """Toda mensagem de canal passa por aqui, nos dois workers. Abrir conexão
    para não marcar nada seria uma ida ao banco por mensagem, à toa."""
    monkeypatch.setattr(e.hub, "usuarios_conectados", lambda: set())

    @asynccontextmanager
    async def proibida(**_):
        raise AssertionError("não devia abrir conexão")
        yield

    monkeypatch.setattr(e, "sessao", proibida)
    asyncio.run(e.entregar_mensagem("6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10"))


def test_entregar_mensagem_marca_so_os_conectados_com_uuid(monkeypatch):
    uid = "6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10"
    monkeypatch.setattr(e.hub, "usuarios_conectados", lambda: {uid, "lixo"})
    chamadas = []

    class Conexao:
        async def execute(self, sql, *args):
            chamadas.append(args)

    @asynccontextmanager
    async def falsa(**_):
        yield Conexao()

    monkeypatch.setattr(e, "sessao", falsa)
    asyncio.run(e.entregar_mensagem("m"))
    assert chamadas == [("m", [uid])]


def test_falha_do_banco_nao_levanta(monkeypatch):
    """Recibo é acessório: erro aqui não pode derrubar o `/ws` nem a escuta."""
    @asynccontextmanager
    async def quebrada(**_):
        raise RuntimeError("banco fora")
        yield

    monkeypatch.setattr(e, "sessao", quebrada)
    asyncio.run(e.entregar_pendentes("u"))


def test_escuta_dispara_entrega_so_no_insert_de_mensagem_de_canal(monkeypatch):
    """É o caminho do cinza para quem está online com outra tela aberta: sem
    ele, a mensagem nova só viraria "entregue" quando a pessoa reconectasse."""
    import json

    from app import escuta_banco

    disparadas = []
    monkeypatch.setattr(e, "disparar", lambda coro: (disparadas.append(coro), coro.close()))

    def notificar(tabela, op):
        escuta_banco._ao_receber(None, 0, "hsos_mudancas", json.dumps(
            {"tabela": tabela, "op": op, "id": "m1", "channel_id": "c1"}))

    notificar("channel_messages", "UPDATE")
    notificar("conversations", "INSERT")
    assert disparadas == []
    notificar("channel_messages", "INSERT")
    assert len(disparadas) == 1
