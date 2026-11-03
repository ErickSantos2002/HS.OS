"""O coletor de respostas: busca no gateway o que a tela fechada não buscou
(spec 2026-11-03, B2).

Sem ele, quem perguntava e fechava o app nunca tinha a resposta gravada — e,
portanto, nunca recebia o push dela. Conexão e `colher` falsos.
"""
import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

from app import coletor_respostas as k


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
    """Com a tela perguntando, ela mesma grava. O coletor só entra 20 s depois
    da última pergunta — e 20 s depois do envio, para não disputar o primeiro
    `/reply`, que chega meio segundo após o `/send`."""
    sql = _sql()
    assert "tela_perguntou_em IS NULL OR tela_perguntou_em < now() - interval '20 seconds'" in sql
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
    def __init__(self, runs):
        self.runs = runs
        self.soltos = []

    async def fetch(self, sql, *a):
        return self.runs

    async def execute(self, sql, *a):
        assert sql == k.SQL_SOLTAR
        self.soltos.append(a[0])


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


def test_coletor_solta_reserva_so_quando_executando():
    """`executando`: o agente ainda trabalha, solta para a próxima passada (5 s).
    `erro` (terminou sem texto, gateway fora): a reserva fica e vence em 30 s —
    senão um run vazio martelaria o gateway a cada 5 s por meia hora."""
    respostas = {"r1": "executando", "r2": "erro", "r3": "pronta"}
    conn = Conn([_run(1), _run(2), _run(3)])

    async def colher(cfg, agent_id, run_id, chave, seq, uid, *, espera_ms):
        assert espera_ms == k._ESPERA_MS
        return SimpleNamespace(status=respostas[run_id])

    assert asyncio.run(k.passada(_sessao(conn), colher, object())) == 3
    assert conn.soltos == ["r1"]


def test_erro_num_run_nao_para_os_outros():
    conn = Conn([_run(1), _run(2)])
    vistos = []

    async def colher(cfg, agent_id, run_id, *a, **kw):
        vistos.append(run_id)
        if run_id == "r1":
            raise RuntimeError("gateway caiu")
        return SimpleNamespace(status="pronta")

    asyncio.run(k.passada(_sessao(conn), colher, object()))
    assert vistos == ["r1", "r2"]
    assert conn.soltos == []


def test_passa_os_dados_do_run_para_o_miolo_do_reply():
    conn = Conn([_run(1)])
    recebido = []

    async def colher(cfg, agent_id, run_id, chave, seq, uid, *, espera_ms):
        recebido.append((cfg, agent_id, run_id, chave, seq, uid))
        return SimpleNamespace(status="pronta")

    cfg = object()
    asyncio.run(k.passada(_sessao(conn), colher, cfg))
    assert recebido == [(cfg, "nina", "r1", "agent:nina:x", 3, "u")]
