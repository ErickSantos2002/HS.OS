"""O coletor de respostas: busca no gateway o que a tela fechada não buscou
(spec 2026-11-03, B2).

Sem ele, quem perguntava e fechava o app nunca tinha a resposta gravada — e,
portanto, nunca recebia o push dela. Conexão e `colher` falsos.
"""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

from app import coletor_respostas as k
from app.gateway.client import ErroGateway


def _sql():
    return " ".join(k.SQL_RESERVAR_RUNS.split())


def test_selecao_so_pega_run_sem_resposta_e_sem_seta():
    sql = _sql()
    assert "message_id IS NULL" in sql
    assert "redireciona_para IS NULL" in sql


def test_selecao_so_olha_os_ultimos_30_minutos():
    """É a mesma janela do `turno_em_curso`: run mais velho que isso não tem
    mais ninguém esperando, e buscar seria só custo no gateway."""
    assert "criado_em > now() - interval '30 minutes'" in _sql()


def test_selecao_ignora_run_com_tela_esperando():
    """Com a tela perguntando, ela mesma grava. Cada `/reply` segura até 20 s no
    `agent.wait` e só então a tela pergunta de novo — com limiar de 20 s o
    coletor entraria no meio de toda espera longa. Por isso 45 s desde a última
    pergunta, e 20 s desde o envio para não disputar o primeiro `/reply`."""
    sql = _sql()
    assert "a.tela_perguntou_em IS NULL OR a.tela_perguntou_em < now() - interval '45 seconds'" in sql
    assert "criado_em < now() - interval '20 seconds'" in sql


def test_reserva_entre_workers_e_atomica():
    """Os 2 workers rodam o coletor. A guarda de `coletando_em` tem que estar no
    UPDATE de fora (não só no SELECT): é ela que faz o segundo worker, que leu
    o mesmo run antes do commit do primeiro, sair sem nada. O `SKIP LOCKED`
    evita que um espere o outro."""
    sql = _sql()
    externo = sql.split("WHERE r.run_id IN")[1].split(")", 1)[1]
    assert "coletando_em IS NULL OR r.coletando_em < now() - interval '30 seconds'" in externo
    assert "FOR UPDATE SKIP LOCKED" in sql
    assert "RETURNING" in sql


class Conn:
    """Guarda o que a passada fez com cada run, por SQL."""

    def __init__(self, runs, tentativas_ja=0):
        self.runs = runs
        self.tentativas_ja = tentativas_ja
        self.soltos = []
        self.encerrados = []
        self.falhas = []

    async def fetch(self, sql, *a):
        return self.runs

    async def execute(self, sql, *a):
        if sql == k.SQL_SOLTAR:
            self.soltos.append(a[0])
        elif sql == k.SQL_ENCERRAR:
            self.encerrados.append(a[0])
        else:
            raise AssertionError(sql)

    async def fetchval(self, sql, *a):
        assert sql == k.SQL_FALHOU
        self.falhas.append(a[0])
        return self.tentativas_ja + 1


def _sessao(conn):
    @asynccontextmanager
    async def falsa(**_):
        yield conn
    return falsa


def _run(i):
    return {"run_id": f"r{i}", "agent_id": "nina", "session_key": "agent:nina:x",
            "seq_antes": 3, "user_id": "u"}


def test_sem_runs_nao_chama_o_gateway():
    chamado = []

    async def colher(*a, **kw):
        chamado.append(a)
    n = asyncio.run(k.passada(_sessao(Conn([])), colher, object()))
    assert n == 0 and chamado == []


def test_executando_solta_erro_encerra_pronta_nao_mexe():
    """`erro` encerra o run para o coletor — a tela também parava no primeiro.

    Antes o run com `erro` (agente respondeu só por ferramenta) voltava a cada
    30 s por meia hora. Se a pessoa perguntasse de novo nesse meio tempo, o
    `_texto_da_resposta` juntava tudo depois do `seq_antes` ANTIGO e a resposta
    da pergunta 2 era gravada sob o run 1 — e o `/reply` do run 2 gravava outra:
    bolha dobrada e push duplo."""
    respostas = {"r1": "executando", "r2": "erro", "r3": "pronta"}
    conn = Conn([_run(1), _run(2), _run(3)])

    async def colher(cfg, agent_id, run_id, chave, seq, uid, *, espera_ms,
                     levantar_erro_gateway):
        assert espera_ms == k._ESPERA_MS and levantar_erro_gateway is True
        return SimpleNamespace(status=respostas[run_id])

    assert asyncio.run(k.passada(_sessao(conn), colher, object())) == 3
    assert conn.soltos == ["r1"]
    assert conn.encerrados == ["r2"]


def test_run_encerrado_nao_e_reservado_de_novo():
    assert "coleta_encerrada_em IS NULL" in _sql().split("WHERE r.run_id IN")[1]


def test_falha_de_gateway_conta_tentativa_e_nao_encerra_de_cara():
    """Gateway fora por um minuto não pode fazer a resposta se perder: conta a
    tentativa, mantém a reserva (volta em 30 s) e só desiste na terceira — o
    `SQL_FALHOU` grava o encerramento quando o contador chega a 3."""
    conn = Conn([_run(1)])

    async def colher(*a, **kw):
        raise ErroGateway("conexão recusada")

    asyncio.run(k.passada(_sessao(conn), colher, object()))
    assert conn.falhas == ["r1"] and conn.soltos == [] and conn.encerrados == []
    assert "coleta_tentativas + 1 >= 3" in " ".join(k.SQL_FALHOU.split())


def test_excecao_inesperada_encerra_e_nao_para_os_outros():
    """Defeito nosso no meio da colheita não vira laço de meia hora."""
    conn = Conn([_run(1), _run(2)])
    vistos = []

    async def colher(cfg, agent_id, run_id, *a, **kw):
        vistos.append(run_id)
        if run_id == "r1":
            raise RuntimeError("bug")
        return SimpleNamespace(status="pronta")

    asyncio.run(k.passada(_sessao(conn), colher, object()))
    assert vistos == ["r1", "r2"]
    assert conn.encerrados == ["r1"] and conn.soltos == []


def test_passa_os_dados_do_run_para_o_miolo_do_reply():
    conn = Conn([_run(1)])
    recebido = []

    async def colher(cfg, agent_id, run_id, chave, seq, uid, **_):
        recebido.append((cfg, agent_id, run_id, chave, seq, uid))
        return SimpleNamespace(status="pronta")

    cfg = object()
    asyncio.run(k.passada(_sessao(conn), colher, cfg))
    assert recebido == [(cfg, "nina", "r1", "agent:nina:x", 3, "u")]


def test_so_colhe_o_ultimo_run_aberto_da_pessoa_com_o_agente():
    """A pergunta seguinte é fronteira: o run 1 nunca pode receber a resposta
    da pergunta 2. Run mais novo da mesma pessoa e agente tira o velho da fila."""
    sql = _sql()
    assert "NOT EXISTS (SELECT 1 FROM public.agent_runs n" in sql
    assert "n.user_id = a.user_id AND n.agent_id = a.agent_id AND n.criado_em > a.criado_em" in sql


def test_run_anterior_a_nova_conversa_nao_e_colhido():
    """Depois do "Nova conversa" o corte vale 0: colher o run velho gravaria a
    conversa nova inteira como resposta dele."""
    sql = _sql()
    assert "NOT EXISTS (SELECT 1 FROM public.conversation_resets cr" in sql
    assert "cr.user_id = a.user_id AND cr.agent_id = a.agent_id AND cr.created_at > a.criado_em" in sql
