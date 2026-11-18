"""`varredura_registrar` no `hsos-bot-<bot>`: o Guardi entrega o resumo da varredura.

⚠️ O que se tranca: fora de varredura a ferramenta recusa SEM gravar (conversa
normal ou injeção pedindo para registrar); número inválido recusa com a mensagem
do validador; a tarde sem novidade manda o Guardi calar (NO_REPLY), para a
pessoa não receber o mesmo cardápio duas vezes.
"""
import asyncio
import json

import pytest

from app.email.regras import FERRAMENTAS_BOT
from app.routers import mcp_bot as m
from app.varredura import dominio

DONO = "u-erick"


class Conn:
    async def fetchrow(self, sql, *a):
        return {"dono_id": DONO, "email": "ti@healthsafetytech.com", "full_name": "Erick Santos",
                "sistemas_ligados": [], "email_ligado": False}


@pytest.fixture
def amb(monkeypatch):
    estado = {"registros": []}
    monkeypatch.setattr(m, "sessao", lambda **k: _Sessao())

    async def turno(conn, agent_id, user_id):
        return True
    monkeypatch.setattr(m, "turno_em_curso", turno)

    async def outro(conn, agent_id, dono):
        return False
    monkeypatch.setattr(m, "outro_turno_aberto", outro)
    return estado


class _Sessao:
    async def __aenter__(self):
        return Conn()

    async def __aexit__(self, *a):
        return False


def _registrar_falso(monkeypatch, retorno=None, erro=None):
    chamadas = []

    async def falso(conn, agent_id, user_id, resumo, numeros):
        chamadas.append((agent_id, user_id, resumo, numeros))
        if erro:
            raise erro
        return retorno
    monkeypatch.setattr(dominio, "registrar", falso)
    return chamadas


def _run(args):
    return asyncio.run(m.executar("erick-bot", "varredura_registrar", args))


def test_fora_de_varredura_recusa_sem_gravar(amb, monkeypatch):
    chamadas = _registrar_falso(monkeypatch, erro=LookupError("não há varredura"))
    texto, erro = _run({"resumo": "oi", "numeros": {}})
    assert erro and texto == "Não há varredura em curso para registrar."
    assert len(chamadas) == 1  # tentou; o domínio recusou antes de qualquer UPDATE


def test_fora_do_turno_do_dono_recusa_sem_chamar_o_registro(amb, monkeypatch):
    """O registro só vale dentro do turno que o disparador abriu em nome do
    dono. Sem turno (sessão da Nina, admin conversando com o bot alheio,
    instrução plantada que roda depois), a guarda de `_contexto` recusa antes
    de o domínio ser chamado — nada chega à `varreduras`."""
    async def sem_turno(conn, agent_id, user_id):
        return False
    monkeypatch.setattr(m, "turno_em_curso", sem_turno)
    chamadas = _registrar_falso(
        monkeypatch, retorno={"status": "entregue", "novidade": True, "o_que_mudou": []})
    texto, erro = _run({"resumo": "oi", "numeros": {}})
    assert erro and "enquanto Erick está conversando comigo" in texto and chamadas == []


def test_numeros_invalidos_recusa_com_mensagem(amb, monkeypatch):
    _registrar_falso(monkeypatch, erro=ValueError("numeros.x precisa ser inteiro"))
    texto, erro = _run({"resumo": "oi", "numeros": {"x": "a"}})
    assert erro and "numeros.x" in texto


def test_tarde_sem_novidade_manda_no_reply(amb, monkeypatch):
    chamadas = _registrar_falso(
        monkeypatch, retorno={"status": "nada_novo", "novidade": False, "o_que_mudou": []})
    texto, erro = _run({"resumo": "igual", "numeros": {"a": 1}})
    d = json.loads(texto)
    assert not erro and d["status"] == "nada_novo" and "NO_REPLY" in d["instrucao"]
    assert chamadas[0][:2] == ("erick-bot", DONO) and chamadas[0][3] == {"a": 1}


def test_entregue_manda_o_cardapio(amb, monkeypatch):
    _registrar_falso(monkeypatch, retorno={"status": "entregue", "novidade": True,
                                           "o_que_mudou": ["primeira do dia"]})
    d = json.loads(_run({"resumo": "x", "numeros": {}})[0])
    assert d["instrucao"] == "Escreva à pessoa o cardápio do dia, curto."
    assert d["o_que_mudou"] == ["primeira do dia"]


def test_ferramenta_na_lista_do_bot():
    assert "varredura_registrar" in FERRAMENTAS_BOT
    assert tuple(f["name"] for f in m.FERRAMENTAS) == FERRAMENTAS_BOT
    f = next(f for f in m.FERRAMENTAS if f["name"] == "varredura_registrar")
    assert f["inputSchema"]["required"] == ["resumo", "numeros"]


def test_sistema_ligado_que_nao_veio_recusa_sem_gravar(amb, monkeypatch):
    """2ª varredura real (16/11/2026): o Guardi pulou CRM e GestorHS em
    silêncio. Sistema ligado sem contagem e fora de `falhas` faz a ferramenta
    recusar ANTES do domínio, nomeando o que falta — o Guardi consulta e
    chama de novo."""
    class ConnLigada(Conn):
        async def fetchrow(self, sql, *a):
            return {**await super().fetchrow(sql, *a),
                    "sistemas_ligados": ["taskhs", "gestorhs"], "email_ligado": True,
                    "email_conectado": True}

    class S(_Sessao):
        async def __aenter__(self):
            return ConnLigada()
    monkeypatch.setattr(m, "sessao", lambda **k: S())
    chamadas = _registrar_falso(
        monkeypatch, retorno={"status": "entregue", "novidade": True, "o_que_mudou": []})
    texto, erro = _run({"resumo": "x", "numeros": {"taskhs": {"abertas": 4}}})
    assert erro and "email" in texto and "gestorhs" in texto and chamadas == []


def _com_ligados(monkeypatch, ligados, email_ligado=False, email_conectado=False):
    class C(Conn):
        async def fetchrow(self, sql, *a):
            return {**await super().fetchrow(sql, *a), "sistemas_ligados": ligados,
                    "email_ligado": email_ligado, "email_conectado": email_conectado}

    class S(_Sessao):
        async def __aenter__(self):
            return C()
    monkeypatch.setattr(m, "sessao", lambda **k: S())


def test_nao_ligado_e_descartado_antes_de_gravar_e_o_guardi_sabe(amb, monkeypatch):
    """17–18/11/2026: `hsgrowth` em `falhas` de quem não tem HSGrowth virava
    "CRM fora" no quadro da Nina. O que chega ao domínio já vem sem ele, e o
    retorno diz ao Guardi o que foi ignorado — não é descarte em silêncio."""
    _com_ligados(monkeypatch, ["taskhs"])
    chamadas = _registrar_falso(
        monkeypatch, retorno={"status": "entregue", "novidade": True, "o_que_mudou": []})
    texto, erro = _run({"resumo": "x", "numeros": {
        "taskhs": {"abertas": 1}, "hsgrowth": {"tarefas_atrasadas": 3}, "falhas": ["hsgrowth"]}})
    assert not erro
    assert chamadas[0][3] == {"taskhs": {"abertas": 1}, "falhas": []}
    d = json.loads(texto)
    assert d["ignorados_nao_ligados"] == ["hsgrowth"]


def test_email_ligado_sem_conta_conectada_nao_e_cobrado_nem_falha(amb, monkeypatch):
    """Lidisay, Rickelme e Walbert têm `email_ligado` mas nunca conectaram a
    conta: o e-mail aparecia como falha todo dia. Sem conta, e-mail é "não
    ligado" — nem cobrado por `sistemas_faltando`, nem aceito em `falhas`."""
    _com_ligados(monkeypatch, ["taskhs"], email_ligado=True, email_conectado=False)
    chamadas = _registrar_falso(
        monkeypatch, retorno={"status": "entregue", "novidade": True, "o_que_mudou": []})
    texto, erro = _run({"resumo": "x", "numeros": {"taskhs": {"abertas": 1}, "falhas": ["email"]}})
    assert not erro and chamadas[0][3] == {"taskhs": {"abertas": 1}, "falhas": []}
    assert json.loads(texto)["ignorados_nao_ligados"] == ["email"]


def test_email_conectado_continua_cobrado(amb, monkeypatch):
    _com_ligados(monkeypatch, ["taskhs"], email_ligado=True, email_conectado=True)
    chamadas = _registrar_falso(
        monkeypatch, retorno={"status": "entregue", "novidade": True, "o_que_mudou": []})
    texto, erro = _run({"resumo": "x", "numeros": {"taskhs": {"abertas": 1}}})
    assert erro and "email" in texto and chamadas == []
