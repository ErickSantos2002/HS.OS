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

    async def executor(email, bot, payload, dono=None):
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

    async def falha(email, bot, payload, dono=None):
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
    async def explode(email, bot, payload, dono=None):
        raise RuntimeError("timeout de rede")
    monkeypatch.setitem(acoes.EXECUTORES, ("taskhs", "comentar"), explode)
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 502
    assert amb["conn"].a["status"] == "erro" and amb["conn"].saiu_com_erro is False


def test_vencida_fica_gravada_mesmo_com_o_409(amb):
    """O 409 era levantado dentro da transação e desfazia o 'vencida'."""
    amb["conn"].a = _acao(criado_em=datetime.now(timezone.utc) - timedelta(hours=25))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.confirmar_acao("a1", ERICK))
    assert e.value.status_code == 409 and amb["conn"].saiu_com_erro is False


def test_criar_tarefa_poe_o_dono_como_membro(monkeypatch):
    """O card 2534 nasceu sem membro e o bot afirmou "responsável: você". O
    TaskHS não põe quem cria como membro — o executor põe."""
    from app.sistemas import taskhs
    chamadas = []

    async def chamar(email, bot, metodo, caminho, json=None, params=None, dono=None):
        chamadas.append((metodo, caminho))
        if caminho == "/auth/me":
            return {"id": 22}
        if metodo == "POST" and caminho == "/lists/368/cards":
            return {"id": 2534}
        return {}
    monkeypatch.setattr(taskhs, "chamar", chamar)
    r = asyncio.run(acoes.EXECUTORES[("taskhs", "criar")]("ti@x.com", "erick-bot",
                                                           {"list_id": 368, "title": "T"}, dono="u"))
    assert ("POST", "/lists/368/cards/2534/members/22") in chamadas and "membro" in r


def _gravar_chamadas(monkeypatch):
    feitas = []

    async def chamar(email, bot, metodo, caminho, json=None, params=None, dono=None):
        feitas.append((metodo, caminho, json))
        if caminho.endswith("/checklists"):
            return {"id": 5}
        if caminho == "/auth/me":
            return {"id": 1}
        if caminho.endswith("/cards") and metodo == "POST":
            return {"id": 9}
        return {}
    monkeypatch.setattr(acoes.taskhs, "chamar", chamar)
    return feitas


def test_criar_com_checklist_cria_o_checklist_do_taskhs(monkeypatch):
    feitas = _gravar_chamadas(monkeypatch)
    r = asyncio.run(acoes._taskhs_criar("e", "b", {"list_id": 3, "title": "T", "_exibir": {"lista": "X"},
                                                   "checklist": {"title": "Checklist", "items": ["a", "b"]}}))
    assert ("POST", "/lists/3/cards", {"title": "T"}) in feitas      # _exibir não vai ao TaskHS
    assert ("POST", "/lists/3/cards/9/checklists", {"title": "Checklist"}) in feitas
    assert [f[2] for f in feitas if f[1].endswith("/items")] == [{"text": "a"}, {"text": "b"}]
    assert "checklist com 2 itens" in r


def test_mover_chama_o_taskhs(monkeypatch):
    """`int(p["para_list_id"], dono=dono)` levantava TypeError: mover NUNCA funcionou."""
    feitas = _gravar_chamadas(monkeypatch)
    asyncio.run(acoes._taskhs_mover("e", "b", {"list_id": 3, "card_id": 9, "para_list_id": 4}))
    assert feitas == [("PATCH", "/lists/3/cards/9", {"list_id": 4})]


def test_atualizar_marca_item_sem_mexer_no_card(monkeypatch):
    feitas = _gravar_chamadas(monkeypatch)
    asyncio.run(acoes._taskhs_atualizar("e", "b", {"list_id": 3, "card_id": 9, "campos": {},
                "marcar_itens": [{"checklist_id": 5, "item_id": 50, "checked": True}]}))
    assert feitas == [("PATCH", "/lists/3/cards/9/checklists/5/items/50", {"checked": True})]
