""""Apagar para mim" — a mensagem some só para quem apagou (30/10/2026).

Uma colaboradora recebeu um GIF que não queria ver e pediu o que o WhatsApp
tem: tirar da conversa só para ela, sem o autor perceber. O risco deste tipo de
recurso é o caminho esquecido — a mensagem escondida voltar pela busca, pela
lista de arquivos ou pela thread. Por isso o teste lê o SQL de cada leitura.
"""
import asyncio
import inspect
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.routers import channels as c
from app.routers import chat_extras


@pytest.mark.parametrize("rota", [c.mensagens, c.arquivos, c.threads, c.thread])
def test_toda_leitura_do_canal_filtra_o_que_eu_escondi(rota):
    assert "_VISIVEL_PARA_MIM" in inspect.getsource(rota)


def test_a_busca_tambem_filtra():
    assert "mensagens_ocultas" in inspect.getsource(chat_extras.busca)


def test_o_filtro_e_por_pessoa_e_nao_por_mensagem():
    """Esconder para todos seria o "Apagar" de sempre — e o autor perceberia."""
    assert "auth.uid()" in c._VISIVEL_PARA_MIM


class Conexao:
    def __init__(self, resultado):
        self.resultado = resultado
        self.args = None

    async def fetchval(self, sql, *args):
        self.args = args
        return self.resultado


def _rota(monkeypatch, resultado, rota):
    conn = Conexao(resultado)

    @asynccontextmanager
    async def falsa(**_):
        yield conn

    monkeypatch.setattr(c, "sessao", falsa)
    usuario = Usuario(id="lara", email="x@y", papel="colaborador")
    return conn, lambda: asyncio.run(rota("canal", "msg", usuario))


def test_esconder_grava_em_nome_de_quem_pediu(monkeypatch):
    conn, chamar = _rota(monkeypatch, True, c.apagar_para_mim)
    chamar()
    assert "lara" in conn.args


def test_mensagem_que_eu_nao_enxergo_e_404(monkeypatch):
    """O INSERT parte de `channel_messages` sob RLS: mensagem de canal alheio
    não aparece, e esconder o que não se vê não pode responder sucesso."""
    _, chamar = _rota(monkeypatch, None, c.apagar_para_mim)
    with pytest.raises(HTTPException) as erro:
        chamar()
    assert erro.value.status_code == 404


def test_desfazer_responde_sem_erro(monkeypatch):
    conn, chamar = _rota(monkeypatch, True, c.desfazer_apagar_para_mim)
    chamar()
    assert "lara" in conn.args
