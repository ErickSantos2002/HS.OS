"""Tranca o escopo das entradas `hsos-anexos-<agente>`: cada um só a própria.

⚠️ **A URL de cada entrada carrega o HMAC do agente — é a identidade dele.**
Enxergar a `hsos-anexos-nina` é poder ler os anexos das conversas da `nina` e
mandar arquivo em nome dela. E o `alsoAllow` não protege nada disso: ele só
acrescenta. Quem exclui é o `deny`, e até 13/10/2026 ele só era recalculado
quando alguém publicava ou removia um banco pela tela, e pelo `escopo-mcp.py`
para os cinco agentes fixos. Agente criado pela tela nascia sem deny de MCP e
enxergava a entrada de todo mundo.

O cálculo é uma função pura (`escopo_mcp_do_agente`) usada pelo script que
publica as entradas e pela criação de agente — os dois caminhos que podem
deixar um agente sem deny.
"""
from app.routers.integracoes import escopo_mcp_do_agente

ANEXOS = {"toolFilter": {"include": ["ler_anexo", "enviar_arquivo"]}}
SERVIDORES = {
    "hsos-anexos-nina": ANEXOS,
    "hsos-anexos-bruce": ANEXOS,
    "banco-hsos": {"toolFilter": {"include": ["query"]}},
    "hsos-alerta": {"toolFilter": {"include": ["avisar_administrador"]}},
}


def test_agente_novo_sem_nada_nega_as_entradas_de_todos():
    """O caso que vazava: agente criado pela tela, sem conector nem deny."""
    t = escopo_mcp_do_agente("novo", {}, SERVIDORES)
    deny = set(t["deny"])
    assert "hsos-anexos-bruce__ler_anexo" in deny
    assert "hsos-anexos-bruce__enviar_arquivo" in deny
    assert "hsos-anexos-nina__ler_anexo" in deny
    # sem entrada própria, não ganha nada no alsoAllow
    assert not any("hsos-anexos" in x for x in t.get("alsoAllow") or [])


def test_bruce_tem_a_propria_e_nega_a_da_nina():
    t = escopo_mcp_do_agente("bruce", {"alsoAllow": ["mcp__banco-hsos__query"]}, SERVIDORES)
    assert "mcp__hsos-anexos-bruce__ler_anexo" in t["alsoAllow"]
    assert "mcp__hsos-anexos-bruce__enviar_arquivo" in t["alsoAllow"]
    assert "mcp__banco-hsos__query" in t["alsoAllow"]
    assert "hsos-anexos-bruce__ler_anexo" not in t["deny"]
    assert "hsos-anexos-nina__ler_anexo" in t["deny"]
    assert "hsos-anexos-nina__enviar_arquivo" in t["deny"]
    assert "banco-hsos__query" not in t["deny"]


def test_entrada_de_outro_no_alsoallow_e_retirada():
    """Se alguém concedeu à mão a entrada de outro, o recálculo tira — senão o
    `deny` a negaria mas o `alsoAllow` continuaria mentindo na tela."""
    t = escopo_mcp_do_agente(
        "bruce", {"alsoAllow": ["mcp__hsos-anexos-nina__ler_anexo"]}, SERVIDORES)
    assert "mcp__hsos-anexos-nina__ler_anexo" not in t["alsoAllow"]
    assert "hsos-anexos-nina__ler_anexo" in t["deny"]


def test_preserva_as_travas_que_nao_sao_mcp_e_nunca_nega_o_alerta():
    t = escopo_mcp_do_agente(
        "novo", {"deny": ["sessions_send", "cron"], "profile": "coding"}, SERVIDORES)
    assert "sessions_send" in t["deny"] and "cron" in t["deny"]
    assert not any("alerta" in x for x in t["deny"])
    assert t["profile"] == "coding"


def test_nao_altera_o_dicionario_recebido():
    original = {"alsoAllow": ["mcp__banco-hsos__query"], "deny": ["cron"]}
    escopo_mcp_do_agente("bruce", original, SERVIDORES)
    assert original == {"alsoAllow": ["mcp__banco-hsos__query"], "deny": ["cron"]}


def test_isencao_do_alerta_e_pelo_nome_exato_nao_por_substring():
    """A isenção era `"alerta" not in s`: qualquer servidor com "alerta" no nome
    escapava do deny. Um agente de id `alerta-x` publicaria `hsos-anexos-alerta-x`
    — e a entrada dele, com o HMAC dele, ficaria visível a TODOS os outros, que
    passariam a ler os anexos e mandar arquivo em nome dele. Só o servidor
    `hsos-alerta` é infraestrutura; o resto é negado como qualquer conector."""
    servidores = {**SERVIDORES, "hsos-anexos-alerta-x": ANEXOS}
    t = escopo_mcp_do_agente("nina", {}, servidores)
    assert "hsos-anexos-alerta-x__ler_anexo" in t["deny"]
    assert "hsos-anexos-alerta-x__enviar_arquivo" in t["deny"]
    assert "hsos-alerta__avisar_administrador" not in t["deny"]
