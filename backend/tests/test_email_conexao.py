"""Conectar a conta Microsoft ao bot pessoal.

⚠️ O `state` é o que amarra a volta da Microsoft à pessoa certa — o JWT mora no
localStorage e a navegação até lá não o leva. Errar aqui é gravar o refresh
token da conta de A no usuário de B: o bot de B passaria a ler e enviar e-mail
como A. Por isso: uso único, 10 minutos, e só o hash no banco.

⚠️ O login NÃO pode passar a pedir escopo de e-mail: todo login ganharia um
refresh token de e-mail, que é exatamente o que a flag por bot existe para
evitar.
"""
import asyncio
import hashlib
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.auth import microsoft as login_ms
from app.dependencies import Usuario
from app.routers import email as rota

ERICK = Usuario("u-erick", "ti@healthsafetytech.com", "administrador")


class Conn:
    def __init__(self, estado=None, bot="erick-bot"):
        self.estado, self.bot, self.gravado, self.sql = estado, bot, None, []

    async def fetchval(self, sql, *a):
        self.sql.append(sql)
        if "email_ligado" in sql:
            return self.bot
        if "FROM public.profiles" in sql:
            return "ti@healthsafetytech.com"
        return None

    async def fetchrow(self, sql, *a):
        self.sql.append(sql)
        if "DELETE FROM public.email_oauth_estados" in sql:
            e, self.estado = self.estado, None
            return e if e and e["state"] == a[0] else None
        return None

    async def execute(self, sql, *a):
        self.sql.append(sql)
        if "email_contas" in sql and "INSERT" in sql:
            self.gravado = a

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def conn(monkeypatch):
    c = Conn()
    monkeypatch.setattr(rota, "sessao", lambda **k: c)
    monkeypatch.setattr(rota.contas, "cifrar", lambda t: "cifrado:" + t)
    return c


def test_login_continua_sem_escopo_de_email():
    assert login_ms.ESCOPOS == "openid email profile User.Read"


def test_conectar_sem_flag_recusa(conn):
    conn.bot = None
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.conectar(ERICK))
    assert e.value.status_code == 403


def test_conectar_grava_so_o_hash_do_state(conn):
    r = asyncio.run(rota.conectar(ERICK))
    assert "login.microsoftonline.com" in r["url"] and "Mail.Send.Shared" in r["url"]
    state = r["url"].split("state=")[1].split("&")[0]
    insert = next(s for s in conn.sql if "INSERT INTO public.email_oauth_estados" in s)
    assert state not in insert


def _cb(conn, monkeypatch, state="abc", idade_min=1, trocou=None):
    conn.estado = {"state": hashlib.sha256(state.encode()).hexdigest(), "user_id": "u-erick",
                   "criado_em": datetime.now(timezone.utc) - timedelta(minutes=idade_min)}

    async def trocar(code):
        trocou.append(code) if trocou is not None else None
        return {"access": "a", "refresh": "r", "conta": "ti@healthsafetytech.com"}
    monkeypatch.setattr(rota.graph, "trocar_code", trocar)


def test_callback_ok_grava_conta_cifrada(conn, monkeypatch):
    _cb(conn, monkeypatch)
    r = asyncio.run(rota.callback(code="c", state="abc", error=None))
    assert r.status_code == 302 and "email=conectado" in r.headers["location"]
    assert conn.gravado[0] == "u-erick" and conn.gravado[2] == "cifrado:r"


def test_callback_state_desconhecido_nao_troca_code(conn, monkeypatch):
    trocou = []
    _cb(conn, monkeypatch, state="certo", trocou=trocou)
    r = asyncio.run(rota.callback(code="c", state="outro", error=None))
    assert "email=erro_estado" in r.headers["location"] and trocou == []


def test_callback_state_vencido_nao_troca_code(conn, monkeypatch):
    trocou = []
    _cb(conn, monkeypatch, idade_min=11, trocou=trocou)
    r = asyncio.run(rota.callback(code="c", state="abc", error=None))
    assert "email=erro_estado" in r.headers["location"] and trocou == []


def test_callback_state_e_de_uso_unico(conn, monkeypatch):
    _cb(conn, monkeypatch)
    asyncio.run(rota.callback(code="c", state="abc", error=None))
    r = asyncio.run(rota.callback(code="c", state="abc", error=None))
    assert "email=erro_estado" in r.headers["location"]


def test_callback_cancelado(conn, monkeypatch):
    _cb(conn, monkeypatch)
    r = asyncio.run(rota.callback(code=None, state="abc", error="access_denied"))
    assert "email=cancelado" in r.headers["location"]


def test_conta_de_outra_pessoa_nao_e_gravada(conn, monkeypatch):
    """CSRF de vínculo: A gera o link para si e faz B autorizar. Sem esta
    checagem o refresh de B seria gravado em A, e o bot de A leria o e-mail de B."""
    _cb(conn, monkeypatch)

    async def trocar(code):
        return {"access": "a", "refresh": "r", "conta": "vitima@healthsafetytech.com"}
    monkeypatch.setattr(rota.graph, "trocar_code", trocar)
    r = asyncio.run(rota.callback(code="c", state="abc", error=None))
    assert "email=erro_conta" in r.headers["location"]
    assert conn.gravado is None


def test_url_leva_login_hint(conn):
    r = asyncio.run(rota.conectar(ERICK))
    assert "login_hint=ti%40healthsafetytech.com" in r["url"]
