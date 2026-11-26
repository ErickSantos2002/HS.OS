"""Prazo explícito na listagem de ferramentas dos MCP do gateway (26/11/2026).

⚠️ **O que custou:** sem `requestTimeoutMs` na entrada, o OpenClaw dá 1,5 s ao
`tools/list`. Na rajada de 26/11 07:30 isso deu 23 `Request timed out` e bots
sem o próprio servidor de anexos e e-mail por 60 s — com a ponte respondendo do
cache. O patch só pode ACRESCENTAR o campo: tocar na `url` ou nos cabeçalhos
quebraria a assinatura por bot, e um prazo menor que 60 s passaria a cortar o
`tools/call`, que usa o mesmo campo.
"""
import importlib.util
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    "prazo_catalogo_mcp", Path(__file__).resolve().parents[2] / "scripts" / "prazo-catalogo-mcp.py")
p = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(p)

SERVIDORES = {
    "hsos-anexos-ana-bot": {"url": "http://127.0.0.1:18791/mcp/anexos/ana-bot/abc",
                            "headers": {"X-Bridge-Token": "x"}, "toolFilter": {"include": ["ler_anexo"]}},
    "banco-taskhs": {"url": "http://127.0.0.1:18790/mcp", "transport": "streamable-http"},
    "ja-tem": {"url": "http://x/mcp", "requestTimeoutMs": 5000},
    "ja-tem-em-segundos": {"url": "http://x/mcp", "timeout": 30},
}


def test_so_acrescenta_o_prazo_e_nao_toca_no_resto():
    novos = p.montar_patch(SERVIDORES)["mcp"]["servers"]
    assert novos == {
        "hsos-anexos-ana-bot": {"requestTimeoutMs": 60_000},
        "banco-taskhs": {"requestTimeoutMs": 60_000},
    }


def test_prazo_e_o_padrao_do_tools_call():
    # Menos que isso cortaria chamada de ferramenta que hoje termina.
    assert p.PRAZO_MS == 60_000


def test_rodar_de_novo_nao_reescreve():
    depois = {n: {**s, **p.montar_patch(SERVIDORES)["mcp"]["servers"].get(n, {})}
              for n, s in SERVIDORES.items()}
    assert p.montar_patch(depois) == {}
    assert p.todos_com_prazo({"mcp": {"servers": depois}})


def test_conferencia_recusa_entrada_sem_prazo_e_config_vazia():
    assert not p.todos_com_prazo({"mcp": {"servers": SERVIDORES}})
    assert not p.todos_com_prazo({})
    assert not p.todos_com_prazo({"mcp": {"servers": {"x": {"requestTimeoutMs": True}}}})
