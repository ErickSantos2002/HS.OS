"""As quatro tabelas de /monitoring nunca tiveram uma linha.

O endpoint `POST /coletor/estatisticas` existe desde 10/08/2026 e foi testado
nos três formatos de payload — mas quem deveria chamá-lo era um coletor rodando
na VPS, e em 31/08 se confirmou que ele **não existe mais**: nenhum script,
agendamento ou serviço em lugar nenhum da máquina do gateway. Sumiu na migração.

Como o backend já mantém um laço que lê o gateway a cada cinco minutos, as
tabelas passam a ser preenchidas por ali. Um serviço externo a menos, com
segredo e máquina próprios.

⚠️ **O formato do gateway NÃO é o do coletor antigo.** O `_crons` do router
espera campos planos (`agent`, `cronExpression`, `lastRun`); o `cron.list`
devolve `agentId`, `schedule.expr` e `state.lastRunAtMs` aninhados. Os payloads
abaixo são reais, colhidos do gateway em 31/08/2026.
"""
from app import coletor_metricas as m

JOB = {
    "id": "9304a0f7-4b8a-4d63-962c-9c74eaec1bd0",
    "name": "hsos-briefing-operacao",
    "enabled": True,
    "agentId": "flow",
    "schedule": {"kind": "cron", "expr": "30 10 * * 1-5"},
    "payload": {"kind": "agentTurn", "message": "Briefing operacional da manhã."},
    "state": {
        "nextRunAtMs": 1788258600000,
        "lastRunAtMs": 1788172200010,
        "lastRunStatus": "error",
    },
}


def test_le_o_agente_de_agentid_e_nao_de_agent():
    assert m._cron_do_gateway(JOB)["agent"] == "flow"


def test_le_a_expressao_de_dentro_do_schedule():
    assert m._cron_do_gateway(JOB)["cron_expression"] == "30 10 * * 1-5"


def test_traz_o_status_da_ultima_execucao():
    """O painel existe para mostrar o que falhou; `error` não pode virar `ok`."""
    assert m._cron_do_gateway(JOB)["status"] == "error"


def test_converte_os_instantes_em_milissegundos():
    linha = m._cron_do_gateway(JOB)
    assert linha["last_run"] is not None and linha["next_run"] is not None
    assert linha["next_run"] > linha["last_run"]


def test_job_desligado_vem_marcado():
    linha = m._cron_do_gateway({**JOB, "enabled": False, "state": {}})
    assert linha["enabled"] is False
    assert linha["status"] == "disabled"


def test_agrega_as_sessoes_por_agente():
    sessoes = [
        {"key": "agent:atlas:hsos-x", "totalTokens": 66_000},
        {"key": "agent:atlas:cron:y", "totalTokens": 25_000},
        {"key": "agent:iris:hsos-z", "totalTokens": 41_000},
        {"key": "lixo-sem-formato", "totalTokens": 9},
    ]
    por_agente = m._sessoes_por_agente(sessoes)
    assert por_agente["atlas"]["session_count"] == 2
    assert por_agente["atlas"]["max_total_tokens"] == 66_000
    assert por_agente["iris"]["session_count"] == 1
    assert "lixo-sem-formato" not in por_agente


def test_chave_malformada_nao_derruba_a_coleta():
    assert m._sessoes_por_agente([{"key": None}, {}, {"key": "agent:só-duas"}]) == {}
