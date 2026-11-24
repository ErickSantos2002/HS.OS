"""Ferramentas que os especialistas não usam saem — e não voltam sozinhas (PK-05).

⚠️ **O que custaria (24/11/2026):** os cinco especialistas rodam no perfil
`coding`, que traz `exec`, escrita de arquivo, `sessions_list`/`history` e
`memory_search`. Medido nos históricos de 30 dias:

- Midas e Flow usaram `exec` uma vez cada (`sleep 45`, `date -u`) e nunca
  escreveram arquivo — mas com `exec` como root, uma injeção por e-mail ou
  planilha leria o `openclaw.json` (token do gateway) e os `models.json` (chave
  da DeepSeek em texto puro).
- Atlas, Flow, Bruce e Midas nunca chamaram `sessions_list`/`history`, e com
  eles leriam conversa de qualquer pessoa com qualquer agente. Só a `nina`
  orquestra.
- `memory_search` falha SEMPRE (`No API key found for provider "openai"`: não
  há embeddings) e a mensagem de erro manda configurar coisa no terminal.
  `memory_get` funciona e fica.

**Bruce, Atlas e Nina continuam com `exec`** de propósito: o Bruce processa a
planilha do ponto do Flash por `exec` (23 vezes em 30 dias) e nunca chamou o
`relatorio_ponto`; tirar mudaria o que o RH recebe. Atlas e Nina rodam scripts.
O caminho deles é o PK-06 (exec fora do root).

⚠️ O `deny` é recalculado do zero a cada publicação de conector de banco: o
que não estiver no preservado SOME sem aviso. Daí estes testes.
"""
from app.routers.agents import _TRAVAS_DE_ESPECIALISTA
from app.routers.integracoes import _DENY_NAO_MCP, _DENY_PRESERVADO, _deny_de_mcp

LEITURA_ALHEIA = ("sessions_list", "sessions_history")
QUEBRADA = ("memory_search",)
EXECUCAO_E_ESCRITA = ("exec", "process", "code_execution", "write", "edit", "apply_patch")


def test_especialista_novo_nasce_sem_ler_conversa_alheia_nem_memory_search():
    for f in LEITURA_ALHEIA + QUEBRADA:
        assert f in _TRAVAS_DE_ESPECIALISTA, f
        assert f in _DENY_NAO_MCP, f


def test_exec_e_escrita_nao_sao_impostos_a_especialista_novo():
    """É decisão por agente: o Atlas precisa, o Flow não."""
    for f in EXECUCAO_E_ESCRITA:
        assert f not in _TRAVAS_DE_ESPECIALISTA, f


def test_o_recalculo_do_deny_preserva_os_cortes():
    servidores = {"banco-a": {"toolFilter": {"include": ["query"]}}}
    cortes = list(LEITURA_ALHEIA + QUEBRADA + EXECUCAO_E_ESCRITA)
    for f in cortes:
        assert f in _DENY_PRESERVADO, f
    deny = _deny_de_mcp([], cortes, servidores)
    assert set(cortes) <= set(deny)


def test_o_preservado_so_guarda_o_que_ja_estava():
    """Preservar não é impor: a `nina`, que não nega `sessions_list`, continua
    sem negá-lo depois do recálculo."""
    deny = _deny_de_mcp([], ["cron"], {"banco-a": {}})
    assert "sessions_list" not in deny and "exec" not in deny
