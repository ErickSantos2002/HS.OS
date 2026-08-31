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


# ─────────────────────────────────────────────────────────────────────────────
# ⚠️ **Sessão abandonada não é sessão em uso, e são a maioria.**
# Medido no gateway em 31/08/2026: 100 sessões, **29** tocadas nos últimos sete
# dias. As outras 71 são de teste e diagnóstico da migração — `teste-*`,
# `diag-*`, `escopo-conf-*` — de até 17 dias atrás.
#
# Sem janela, o painel diria que o `atlas` tem 37 sessões para sempre, e o
# `max_total_tokens` dele seria o pico de um teste de duas semanas atrás. Ruído
# apresentado como sinal é pior que campo vazio: o vazio ninguém interpreta.
# ─────────────────────────────────────────────────────────────────────────────

AGORA_MS = 1788000000000
DIA = 86_400_000


def test_conta_so_a_sessao_tocada_na_janela():
    sessoes = [
        {"key": "agent:atlas:viva", "totalTokens": 30_000, "updatedAt": AGORA_MS - 2 * DIA},
        {"key": "agent:atlas:teste-antigo", "totalTokens": 99_000, "updatedAt": AGORA_MS - 17 * DIA},
    ]
    r = m._sessoes_por_agente(sessoes, agora_ms=AGORA_MS)
    assert r["atlas"]["session_count"] == 1


def test_o_pico_ignora_a_sessao_abandonada():
    """Senão o painel mostra como pico atual o de um teste de duas semanas."""
    sessoes = [
        {"key": "agent:atlas:viva", "totalTokens": 30_000, "updatedAt": AGORA_MS - 2 * DIA},
        {"key": "agent:atlas:teste-antigo", "totalTokens": 99_000, "updatedAt": AGORA_MS - 17 * DIA},
    ]
    assert m._sessoes_por_agente(sessoes, agora_ms=AGORA_MS)["atlas"]["max_total_tokens"] == 30_000


def test_sessao_sem_carimbo_de_tempo_conta():
    """Falha aberta: não dá para saber se está viva, e esconder um agente do
    painel por falta de campo é pior que contar a mais."""
    sessoes = [{"key": "agent:iris:sem-data", "totalTokens": 10_000}]
    assert m._sessoes_por_agente(sessoes, agora_ms=AGORA_MS)["iris"]["session_count"] == 1


def test_agente_so_com_sessao_velha_some_do_painel():
    sessoes = [{"key": "agent:bruce:so-velha", "totalTokens": 5, "updatedAt": AGORA_MS - 30 * DIA}]
    assert "bruce" not in m._sessoes_por_agente(sessoes, agora_ms=AGORA_MS)
