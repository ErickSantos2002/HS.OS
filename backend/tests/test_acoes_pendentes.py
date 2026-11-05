"""Confirmação de ação do bot num sistema interno.

⚠️ O clique do dono é a única porta para o bot ALTERAR algo no TaskHS. O que
se tranca: só o dono vê e confirma (404 para os outros); o que executa é o
`payload` GRAVADO quando o bot preparou — nunca um argumento novo; não executa
duas vezes; vencida não executa; erro do sistema fica registrado.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app import acoes
from app.dependencies import Usuario
from app.routers import acoes as rota

ERICK = Usuario("u-erick", "ti@healthsafetytech.com", "administrador")
OUTRO = Usuario("u-outro", "x@healthsafetytech.com", "administrador")


def _acao(**k):
    base = {"id": "a1", "user_id": "u-erick", "agent_id": "erick-bot", "sistema": "taskhs",
            "acao": "comentar", "payload": {"list_id": 3, "card_id": 9, "texto": "ok"},
            "resumo": "Comentar no card 9", "status": "pendente", "erro": None, "resultado": None,
            "criado_em": datetime.now(timezone.utc), "email": "ti@healthsafetytech.com"}
    return {**base, **k}


class Conn:
    def __init__(self, a):
        self.a, self.sql = a, []

    async def fetchrow(self, sql, *args):
        self.sql.append(sql)
        if self.a and args[0] == self.a["id"] and args[1] == self.a["user_id"]:
            return self.a
        return None

    async def execute(self, sql, *args):
        self.sql.append(sql)
        for st in ("feita", "cancelada", "vencida", "erro"):
            if f"status = '{st}'" in sql and self.a["status"] == "pendente":
                self.a = {**self.a, "status": st}

    async def __aenter__(self):
        return self

    async def __aexit__(self, tipo, *a):
        # Registra se a transação terminou com exceção (= rollback de verdade).
        self.saiu_com_erro = tipo is not None
        return False


@pytest.fixture
def amb(monkeypatch):
    estado = {"conn": Conn(_acao()), "exec": []}
    monkeypatch.setattr(rota, "sessao", lambda **k: estado["conn"])

    async def executor(email, bot, payload):
        estado["exec"].append((email, bot, payload))
        return "comentado"
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), executor)
    return estado


def test_outro_usuario_recebe_404(amb):
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.ver_acao("a1", OUTRO))
    assert e.value.status_code == 404


def test_confirmar_executa_o_payload_gravado(amb):
    r = asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert r["status"] == "feita"
    assert amb["exec"] == [("ti@healthsafetytech.com", "erick-bot", {"list_id": 3, "card_id": 9, "texto": "ok"})]
    assert any("FOR UPDATE" in s for s in amb["conn"].sql)


def test_nao_executa_duas_vezes(amb):
    asyncio.run(rota.confirmar_acao("a1", ERICK))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 409 and len(amb["exec"]) == 1


def test_vencida_nao_executa(amb):
    amb["conn"].a = _acao(criado_em=datetime.now(timezone.utc) - timedelta(hours=25))
    with pytest.raises(HTTPException):
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert amb["exec"] == []


def test_erro_do_sistema_fica_registrado(amb, monkeypatch):
    from app.sistemas.taskhs import ErroSistema

    async def falha(email, bot, payload):
        raise ErroSistema(403, "o TaskHS não deixa o agente fazer isso")
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), falha)
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 502 and amb["conn"].a["status"] == "erro"


def test_cancelar(amb):
    asyncio.run(rota.cancelar_acao("a1", ERICK))
    assert amb["conn"].a["status"] == "cancelada" and amb["exec"] == []


def test_erro_e_gravado_fora_do_rollback(amb, monkeypatch):
    """O 502 era levantado DENTRO da transação: o rollback desfazia o
    status='erro' e a ação voltava a 'pendente', pronta para rodar de novo.
    Exceção qualquer (não só ErroSistema) também tem que virar 'erro'."""
    async def explode(email, bot, payload):
        raise RuntimeError("timeout de rede")
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), explode)
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 502
    assert amb["conn"].a["status"] == "erro" and amb["conn"].saiu_com_erro is False
