"""A entrada `banco-*` que a publicação de conector grava no gateway.

⚠️ **O que custou (PK-47, 23/11/2026):** cada entrada era `npx -y
@modelcontextprotocol/server-postgres <url>`, e o OpenClaw sobe TODO servidor de
`mcp.servers` para CADA sessão — sem olhar o `deny` do agente. Os 23 Guardis,
que não usam banco nenhum, subiam os 9 a cada conversa. Às 13:34 de 23/11 eram
~93 pares de processo, 7,2 GB numa VPS de 7,8 GB; o kernel matou processos no
meio de turnos e o `erick-bot` ficou minutos em "Iniciando…". Foram 30 OOMs
desde 17/11.

O conserto é o `banco-mcp`, um serviço só na VPS do gateway, e a publicação
tem que gravar a entrada nesse formato. Se ela voltar a gravar `npx`, o
primeiro conector publicado pela tela recria o problema para aquele banco —
sem erro nenhum, só memória subindo.
"""
from app.routers.integracoes import BANCO_MCP_URL, entrada_mcp_banco

URL = "postgresql://leitura:s3nh4@banco.exemplo:5555/datacore?sslmode=disable"


def test_entrada_aponta_para_o_servico_persistente():
    e = entrada_mcp_banco(URL)
    assert e["transport"] == "streamable-http"
    assert e["url"] == BANCO_MCP_URL == "http://127.0.0.1:18790/mcp"


def test_a_url_do_banco_vai_no_cabecalho_e_nao_no_argv():
    """No formato antigo a senha ia no `argv` — visível em `ps` para qualquer
    processo da VPS. No cabeçalho, o `config.get` a devolve redigida."""
    e = entrada_mcp_banco(URL)
    assert e["headers"] == {"X-Banco-Url": URL}
    assert URL not in str({k: v for k, v in e.items() if k != "headers"})


def test_o_formato_antigo_e_apagado_no_merge_patch():
    """`config.patch` é merge patch: sem `null`, `command` e `args` da entrada
    antiga sobreviveriam ao lado do `url`, e o gateway escolheria o transporte
    por conta própria."""
    e = entrada_mcp_banco(URL)
    assert e["command"] is None
    assert e["args"] is None


def test_so_a_tool_query_sai_do_servidor():
    assert entrada_mcp_banco(URL)["toolFilter"] == {"include": ["query"]}


# --- o script de troca (scripts/trocar-banco-mcp.py) --------------------------
import importlib.util  # noqa: E402
import pathlib  # noqa: E402

import pytest  # noqa: E402

_SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "trocar-banco-mcp.py"
_spec = importlib.util.spec_from_file_location("trocar_banco_mcp", _SCRIPT)
troca = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(troca)

ANTIGA = {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-postgres", URL],
          "toolFilter": {"include": ["query"]}}
HTTP = {"transport": "streamable-http", "url": "https://hsosapi.exemplo/mcp/alerta"}


def test_troca_so_os_banco_e_deixa_os_http_em_paz():
    p = troca.montar_patch({"banco-datacorehs": ANTIGA, "hsos-alerta": HTTP})
    assert list(p["mcp"]["servers"]) == ["banco-datacorehs"]
    assert p["mcp"]["servers"]["banco-datacorehs"]["headers"] == {"X-Banco-Url": URL}


def test_rodar_duas_vezes_nao_reescreve():
    ja = {"banco-datacorehs": {**troca.entrada_mcp_banco(URL), "command": None}}
    assert troca.montar_patch(ja) == {}
    assert troca.trocado({"mcp": {"servers": ja}})


def test_args_fora_do_formato_aborta_em_vez_de_gravar_lixo():
    """Uma entrada `banco-*` que não seja o server-postgres (outro pacote, URL
    noutra posição) não pode virar cabeçalho com o valor errado."""
    with pytest.raises(ValueError):
        troca.montar_patch({"banco-x": {"command": "npx", "args": ["-y", "outro-pacote"]}})


def test_conferencia_nao_aceita_metade_trocada():
    meio = {"banco-a": troca.entrada_mcp_banco(URL), "banco-b": ANTIGA}
    assert not troca.trocado({"mcp": {"servers": meio}})


def test_volta_restaura_o_npx_e_apaga_o_formato_novo():
    v = troca.montar_volta({"banco-a": ANTIGA, "hsos-alerta": HTTP})["mcp"]["servers"]
    assert list(v) == ["banco-a"]
    assert v["banco-a"]["command"] == "npx" and v["banco-a"]["args"][2] == URL
    assert v["banco-a"]["url"] is None and v["banco-a"]["headers"] is None


def test_a_entrada_declara_prazo_para_o_catalogo():
    """Sem `requestTimeoutMs`, o OpenClaw dá 1,5 s ao `tools/list` — na rajada
    de 26/11 o `banco-*` caiu por isso e ficou 60 s fora depois de três falhas.
    60.000 é o padrão do `tools/call`: menos cortaria consulta que hoje termina.
    Banco conectado pela tela depois de 26/11 nasceria sem o campo."""
    assert entrada_mcp_banco(URL)["requestTimeoutMs"] == 60_000
