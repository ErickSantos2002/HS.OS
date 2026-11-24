"""Reiniciar o gateway confere antes se há resposta em andamento (PK-10, 07-28).

⚠️ **O que custaria (24/11/2026):** o botão de reiniciar (`POST
/gateway/manutencao/restart`) chamava o restart direto. Reiniciar no meio de um
turno derruba a resposta que a pessoa está esperando — e, como vimos hoje cedo
com a troca do `banco-mcp`, um único turno derrubado já foi a varredura de
alguém que precisou ser refeita à mão. A frequência é baixa (o serviço está de
pé desde 17/10, `NRestarts=0`), mas é exatamente o botão que se aperta quando
algo já está estranho — e aí costuma haver gente esperando.

"Em andamento" é a mesma regra que fecha a varredura (`SQL_FECHAR`): run sem
`message_id`, sem `coleta_encerrada_em`, criado nos últimos 15 minutos. Varredura
e lembrete contam: são turnos de verdade, com alguém do outro lado.
"""
import asyncio

from app.routers.gateway import _recusa_por_runs_ativos


class _Conn:
    def __init__(self, linhas):
        self.linhas, self.sql = linhas, None

    async def fetch(self, sql, *args):
        self.sql = sql
        return self.linhas


def test_sem_run_ativo_libera():
    assert asyncio.run(_recusa_por_runs_ativos(_Conn([]))) is None


def test_com_run_ativo_recusa_e_diz_quem():
    conn = _Conn([{"agent_id": "midas", "n": 2}, {"agent_id": "erick-bot", "n": 1}])
    msg = asyncio.run(_recusa_por_runs_ativos(conn))
    assert msg and "3" in msg and "midas" in msg and "erick-bot" in msg
    assert "forcar" in msg  # diz como passar por cima, para emergência


def test_a_regra_de_ativo_e_a_da_varredura():
    conn = _Conn([])
    asyncio.run(_recusa_por_runs_ativos(conn))
    sql = " ".join(conn.sql.split())
    assert "message_id IS NULL" in sql
    assert "coleta_encerrada_em IS NULL" in sql
    assert "interval '15 minutes'" in sql
