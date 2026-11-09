"""Eventos do Outlook na agenda e detecção de conflito de horário.

O defeito que estes testes trancam: um lembrete marcado em cima de uma reunião
sem aviso, ou o Graph sendo chamado para quem nunca deu permissão de calendário
(erro 403 a cada consulta e token renovado à toa).
"""
import asyncio
from datetime import datetime, timedelta

from app.agenda import outlook
from app.agenda.regras import FUSO
from app.email import contas, graph


def _em(h, m=0):
    return datetime(2026, 11, 10, h, m, tzinfo=FUSO)


def _ev(ini, fim, ocupado=True, dia_inteiro=False):
    return {"titulo": "x", "inicio": ini, "fim": fim, "dia_inteiro": dia_inteiro,
            "local": "", "ocupado": ocupado}


class _Conn:
    def __init__(self, tem_conta=True):
        self.tem_conta = tem_conta

    async def fetchval(self, sql, *a):
        return 1 if self.tem_conta else None


def _bruto(show="busy", ini="2026-11-10T09:00:00.0000000", fim="2026-11-10T10:00:00.0000000"):
    return {"subject": "Reunião", "start": {"dateTime": ini, "timeZone": "E. South America Standard Time"},
            "end": {"dateTime": fim, "timeZone": "E. South America Standard Time"},
            "location": {"displayName": "Sala 1"}, "isAllDay": False, "showAs": show}


def test_reuniao_das_9_as_10_conflita_com_lembrete_as_9h30():
    assert len(outlook.conflitos([_ev(_em(9), _em(10))], _em(9, 30))) == 1


def test_evento_livre_nao_conflita():
    assert outlook.conflitos([_ev(_em(9), _em(10), ocupado=False)], _em(9, 30)) == []


def test_evento_distante_nao_conflita():
    assert outlook.conflitos([_ev(_em(11), _em(12))], _em(9, 30)) == []


def test_dia_inteiro_so_conta_se_ocupado():
    ini, fim = _em(0), _em(0) + timedelta(days=1)
    assert outlook.conflitos([_ev(ini, fim, ocupado=False, dia_inteiro=True)], _em(9)) == []
    assert len(outlook.conflitos([_ev(ini, fim, dia_inteiro=True)], _em(9))) == 1


def test_sem_permissao_nao_chama_graph(monkeypatch):
    async def explode(*a, **k):
        raise AssertionError("Graph chamado sem permissão")

    async def sem_cal(conn, uid):
        return False

    monkeypatch.setattr(graph, "calendario", explode)
    monkeypatch.setattr(contas, "access_token", explode)
    monkeypatch.setattr(contas, "tem_calendario", sem_cal)
    assert asyncio.run(outlook.eventos(_Conn(), "u", _em(0), _em(23))) == ("sem_permissao", [])


def test_sem_conta(monkeypatch):
    assert asyncio.run(outlook.eventos(_Conn(tem_conta=False), "u", _em(0), _em(23))) == ("sem_conta", [])


def _com_calendario(monkeypatch, itens=None, erro=None):
    async def sim(conn, uid):
        return True

    async def token(conn, uid):
        return "SEGREDO", "a@b.com"

    async def cal(access, conta, de, ate):
        if erro:
            raise erro
        return itens

    monkeypatch.setattr(contas, "tem_calendario", sim)
    monkeypatch.setattr(contas, "access_token", token)
    monkeypatch.setattr(graph, "calendario", cal)


def test_eventos_normaliza(monkeypatch):
    _com_calendario(monkeypatch, [_bruto(), _bruto(show="free")])
    estado, evs = asyncio.run(outlook.eventos(_Conn(), "u", _em(0), _em(23)))
    assert estado == "ok"
    assert evs[0] == {"titulo": "Reunião", "inicio": _em(9), "fim": _em(10),
                      "dia_inteiro": False, "local": "Sala 1", "ocupado": True}
    assert evs[1]["ocupado"] is False


def test_erro_do_graph_vira_estado_erro_sem_token_no_log(monkeypatch, caplog):
    _com_calendario(monkeypatch, erro=graph.ErroGraph(503, "indisponível"))
    with caplog.at_level("WARNING"):
        r = asyncio.run(outlook.eventos(_Conn(), "u", _em(0), _em(23)))
    assert r == ("erro", [])
    assert "SEGREDO" not in caplog.text


def test_erro_de_token_vira_estado_erro(monkeypatch):
    _com_calendario(monkeypatch)

    async def token(conn, uid):
        raise contas.ErroConta("expirou")

    monkeypatch.setattr(contas, "access_token", token)
    assert asyncio.run(outlook.eventos(_Conn(), "u", _em(0), _em(23))) == ("erro", [])
