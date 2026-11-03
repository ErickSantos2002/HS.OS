"""Rotas de push e de silenciar canal (spec 2026-11-03, B1/B3 e esclarecimento 4).

Chamadas direto, com usuário e conexão falsos.
"""
import asyncio
import inspect
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

from app import push_envio
from app.dependencies import Usuario, usuario_atual
from app.routers import channels, push

EU = "6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10"
OUTRO = "7a1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a11"
C1 = "9d1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a19"


def _eu():
    return Usuario(EU, "eu@x", "colaborador")


class Conn:
    def __init__(self, valor=None):
        self.valor = valor
        self.chamadas = []

    async def execute(self, sql, *a):
        self.chamadas.append((sql, a))
        return self.valor if isinstance(self.valor, str) else "DELETE 1"

    async def fetchval(self, sql, *a):
        self.chamadas.append((sql, a))
        return self.valor

    async def fetch(self, sql, *a):
        self.chamadas.append((sql, a))
        return self.valor or []


def _sessao(conn, papeis=None):
    @asynccontextmanager
    async def falsa(role="anon", user_id=None):
        if papeis is not None:
            papeis.append((role, user_id))
        yield conn
    return falsa


def test_enviar_para_outra_pessoa_e_403(monkeypatch):
    """Qualquer logado mandava push para qualquer `user_id`, com o título que
    quisesse — notificação falsa "do sistema" no celular de outra pessoa."""
    monkeypatch.setattr(push_envio, "chaves", lambda: ("pub", "priv", "mailto:x@y"))
    with pytest.raises(HTTPException) as e:
        asyncio.run(push.enviar(push.EnvioIn(user_id=OUTRO), _eu()))
    assert e.value.status_code == 403


def test_enviar_para_si_mesmo_usa_o_envio_do_servidor(monkeypatch):
    monkeypatch.setattr(push_envio, "chaves", lambda: ("pub", "priv", "mailto:x@y"))
    chamados = []

    async def falso(uid, payload):
        chamados.append((uid, payload))
        return {"enviados": 1, "inscricoes": 1, "removidas": 0}
    monkeypatch.setattr(push_envio, "enviar_para", falso)
    r = asyncio.run(push.enviar(push.EnvioIn(user_id=EU, title="T", body="b"), _eu()))
    assert r["enviados"] == 1
    assert chamados[0][0] == EU and chamados[0][1]["title"] == "T"


def test_cancelar_inscricao_exige_login_e_confere_o_dono(monkeypatch):
    """Sem login, quem soubesse o endpoint de outra pessoa a desinscrevia; e o
    logout precisa apagar só a inscrição deste aparelho, da própria pessoa."""
    deps = [p.default.dependency for p in
            inspect.signature(push.cancelar_inscricao).parameters.values()
            if hasattr(p.default, "dependency")]
    assert usuario_atual in deps

    conn = Conn()
    monkeypatch.setattr(push, "sessao", _sessao(conn))
    asyncio.run(push.cancelar_inscricao("https://e/1", _eu()))
    sql, args = conn.chamadas[0]
    assert "user_id = $2::uuid" in sql and args == ("https://e/1", EU)


def test_contagem_por_endpoint(monkeypatch):
    """A tela só deixa de mostrar a notificação local quando o servidor confirma
    ESTE aparelho — contar todos os aparelhos da pessoa não diz isso."""
    conn = Conn(valor=1)
    monkeypatch.setattr(push, "sessao", _sessao(conn))
    r = asyncio.run(push.contar_inscricoes(_eu(), endpoint="https://e/1"))
    assert r == {"count": 1}
    sql, args = conn.chamadas[0]
    assert "endpoint = $2" in sql and args == (EU, "https://e/1")


def test_silenciar_so_mexe_na_propria_linha(monkeypatch):
    conn = Conn(valor="UPDATE 1")
    papeis = []
    monkeypatch.setattr(channels, "sessao", _sessao(conn, papeis))
    asyncio.run(channels.silenciar(C1, channels.SilenciarIn(silenciado=True), _eu()))
    sql, args = conn.chamadas[0]
    assert "user_id = $2" in sql and args == (C1, EU, True)


def test_silenciar_canal_de_que_nao_e_membro_e_404(monkeypatch):
    monkeypatch.setattr(channels, "sessao", _sessao(Conn(valor="UPDATE 0")))
    with pytest.raises(HTTPException) as e:
        asyncio.run(channels.silenciar(C1, channels.SilenciarIn(silenciado=True), _eu()))
    assert e.value.status_code == 404


def test_lista_de_silenciados(monkeypatch):
    conn = Conn(valor=[{"channel_id": "c1"}, {"channel_id": "c2"}])
    monkeypatch.setattr(channels, "sessao", _sessao(conn))
    assert asyncio.run(channels.silenciados(_eu())) == ["c1", "c2"]
    assert conn.chamadas[0][1] == (EU,)


def test_inscricao_com_endpoint_fora_da_lista_e_400(monkeypatch):
    """SSRF: o servidor faz POST no endpoint inscrito. URL interna nunca entra."""
    conn = Conn()
    monkeypatch.setattr(push, "sessao", _sessao(conn))
    with pytest.raises(HTTPException) as e:
        asyncio.run(push.inscrever(
            push.InscricaoIn(endpoint="http://127.0.0.1:18789/x", p256dh="k", auth="a"), _eu()))
    assert e.value.status_code == 400
    assert conn.chamadas == []


def test_inscricao_de_servico_de_push_e_gravada(monkeypatch):
    conn = Conn()
    monkeypatch.setattr(push, "sessao", _sessao(conn))
    asyncio.run(push.inscrever(
        push.InscricaoIn(endpoint="https://fcm.googleapis.com/fcm/send/x", p256dh="k", auth="a"),
        _eu()))
    assert "INSERT INTO public.push_subscriptions" in conn.chamadas[0][0]
