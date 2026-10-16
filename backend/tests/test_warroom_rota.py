"""A rota do painel de TV não pode nem PERGUNTAR pelo conteúdo.

Em 16/10/2026 a War Room foi para a TV da empresa e o Fluxo mostrava a
pergunta do CEO a um agente. Tirar o texto da montagem não basta: basta uma
consulta voltar a selecionar `content` "só para o rótulo" e ele reaparece. Este
teste lê o SQL que a rota manda e recusa a coluna.
"""
import asyncio
import re

import pytest

from app.routers import warroom as rota


class _Conn:
    def __init__(self, sqls):
        self.sqls = sqls

    async def fetch(self, sql, *a):
        self.sqls.append(sql)
        return []

    async def fetchrow(self, sql, *a):
        self.sqls.append(sql)
        return None

    async def fetchval(self, sql, *a):
        self.sqls.append(sql)
        return None


class _Sessao:
    def __init__(self, sqls):
        self.sqls = sqls

    async def __aenter__(self):
        return _Conn(self.sqls)

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def sqls(monkeypatch):
    lista = []
    monkeypatch.setattr(rota, "sessao", lambda **k: _Sessao(lista))

    async def segredo(nome):
        return "tok"

    monkeypatch.setattr(rota, "ler_segredo", segredo)
    return lista


def _seleciona_tudo(sql: str) -> bool:
    """Há `*` ou `alias.*` na lista de colunas de algum SELECT?

    `count(*)` (ou qualquer `f(*)`) não conta: é agregação, não traz coluna.
    """
    sem_agregado = re.sub(r"\w+\s*\(\s*\*\s*\)", "", sql)
    return bool(re.search(r"\bSELECT\b(?:(?!\bFROM\b).)*?\*", sem_agregado, re.I | re.S))


def test_o_guarda_reconhece_select_estrela_e_poupa_count():
    """O guarda abaixo é a única defesa contra `SELECT *` trazer o `content`.

    Um `SELECT * FROM conversations` não cita a coluna e passaria pelo
    `\bcontent\b` — o texto voltaria a sair do banco sem ninguém escrever
    "content". O guarda tem que pegar `*` e `alias.*`, e não pode recusar
    `count(*)`, senão alguém o "conserta" afrouxando.
    """
    assert _seleciona_tudo("SELECT * FROM public.conversations")
    assert _seleciona_tudo("SELECT m.*, c.type FROM public.channel_messages m")
    assert _seleciona_tudo("SELECT DISTINCT ON (agent_id) * FROM public.conversations")
    assert not _seleciona_tudo("SELECT count(*) FROM public.conversations")
    assert not _seleciona_tudo("SELECT agent_id, count( * ) AS n FROM x GROUP BY 1")
    assert not _seleciona_tudo("SELECT min(ts) FROM public.usage_events")


def test_nenhuma_consulta_seleciona_content(sqls):
    asyncio.run(rota.feed(t="tok", usuario=None))
    assert sqls, "a rota não consultou nada?"
    for sql in sqls:
        assert not re.search(r"\bcontent\b", sql, re.I), sql
        assert not _seleciona_tudo(sql), sql


def _sql_de(sqls, trecho):
    achados = [s for s in sqls if trecho in s]
    assert len(achados) == 1, (trecho, achados)
    return achados[0]


def test_conta_desativada_nao_vai_para_a_parede(sqls):
    """Quem sai da empresa tem o acesso desligado (`auth.users.is_active`) e o
    perfil continua. Sem o filtro, segue com hexágono na TV e contado em
    "de N no time" — a parede mostraria um time que não existe mais.
    """
    asyncio.run(rota.feed(t="tok", usuario=None))
    sql = _sql_de(sqls, "public.profiles")
    assert "auth.users" in sql and "is_active" in sql, sql


def test_dm_so_conta_mensagem_de_humano(sqls):
    """Num DM com agente membro, a mensagem do agente acenderia "X e Y
    conversaram" sem que as duas pessoas tenham trocado uma palavra.
    """
    asyncio.run(rota.feed(t="tok", usuario=None))
    sql = _sql_de(sqls, "public.channel_messages")
    assert re.search(r"author_type\s*=\s*'human'", sql), sql


def test_documento_sem_agente_nao_vira_agente_publicou(sqls):
    """Documento escrito por gente (`agent_id` nulo) apareceria no Fluxo como
    "Agente publicou", creditando a um agente o trabalho de uma pessoa.
    """
    asyncio.run(rota.feed(t="tok", usuario=None))
    sql = _sql_de(sqls, "public.wiki_documents")
    assert re.search(r"agent_id\s+IS\s+NOT\s+NULL", sql, re.I), sql


def test_ultimas_so_olha_a_janela_que_acende_algo(sqls):
    """`ultimas` alimenta o "trabalhando agora", que esquece em 2 h. Sem janela,
    o `DISTINCT ON` varre a `conversations` inteira a cada atualização da TV
    para devolver linhas que não acendem nada.
    """
    asyncio.run(rota.feed(t="tok", usuario=None))
    sql = _sql_de(sqls, "DISTINCT ON (agent_id) agent_id, role")
    assert re.search(r"created_at\s*>=\s*now\(\)\s*-\s*interval\s*'2 hours'", sql), sql


def test_resposta_no_contrato_novo_mesmo_com_banco_vazio(sqls):
    r = asyncio.run(rota.feed(t="tok", usuario=None))
    assert set(r) == {"ts", "diasNoAr", "setores", "pessoas", "agentes",
                      "conversasTime", "eventos", "numeros"}
    assert r["numeros"] == {"entregas": 0, "atendidas": 0, "pessoasAtivas": 0, "conversasTime": 0}


def test_sem_token_e_sem_sessao_recusa(sqls):
    with pytest.raises(Exception) as e:
        asyncio.run(rota.feed(t="errado", usuario=None))
    assert getattr(e.value, "status_code", None) == 401
