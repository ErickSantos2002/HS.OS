"""Tranca a montagem das entradas `hsos-anexos-<agente>` e o mascaramento.

O script que as publica escreve na config do gateway real e não roda em teste;
o que se pode (e deve) trancar sem gateway é o que ele MANDA: a URL de cada
agente carrega o HMAC DELE (a identidade que o servidor confere), o filtro
expõe só as duas ferramentas, e o ensaio impresso não vaza a credencial.
"""
import importlib.util
import pathlib

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / "scripts" / "publicar-anexos-mcp.py"
spec = importlib.util.spec_from_file_location("publicar_anexos_mcp", SCRIPT)
pub = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pub)

from app.routers.mcp_anexos import assinatura_do_agente  # noqa: E402

MODELO = {
    "url": "https://hsosapi.exemplo.com/mcp/relatorios",
    "transport": "streamable-http",
    "headers": {"Authorization": "Bearer abc"},
    "toolFilter": {"include": ["publicar_pagina"]},
}


AGENTES = ("nina", "iris", "atlas", "flow", "bruce")


def test_cada_agente_recebe_a_propria_url_com_o_proprio_hmac():
    novos = pub.montar_entradas(MODELO, "segredo", AGENTES)
    assert set(novos) == {f"hsos-anexos-{a}" for a in AGENTES}
    for aid in AGENTES:
        esperado = f"https://hsosapi.exemplo.com/mcp/anexos/{aid}/{assinatura_do_agente('segredo', aid)}"
        assert novos[f"hsos-anexos-{aid}"]["url"] == esperado
    urls = {e["url"] for e in novos.values()}
    assert len(urls) == len(AGENTES)


def test_filtro_e_cabecalhos():
    e = pub.montar_entradas(MODELO, "segredo", AGENTES)["hsos-anexos-nina"]
    assert e["toolFilter"] == {"include": ["ler_anexo", "enviar_arquivo"]}
    assert e["headers"] == MODELO["headers"]
    assert e["transport"] == "streamable-http"
    # não alterou o modelo
    assert MODELO["toolFilter"] == {"include": ["publicar_pagina"]}


def test_mascaramento_nao_vaza_a_assinatura():
    novos = pub.montar_entradas(MODELO, "segredo", AGENTES)
    mascarado = pub.mascarar_entradas(novos)
    for aid in AGENTES:
        m = mascarado[f"hsos-anexos-{aid}"]
        sig = assinatura_do_agente("segredo", aid)
        assert sig not in m["url"]
        assert sig[:20] not in m["url"]
        assert f"/mcp/anexos/{aid}/" in m["url"]
        assert "Bearer" not in str(m)


def test_mascaramento_e_lista_branca():
    """⚠️ Lista negra deixava passar campo novo do modelo: se o `hsos-relatorios`
    ganhasse um `env` ou `auth` com token, o ensaio o imprimiria inteiro no
    terminal (e no transcript). Só `transport`, `toolFilter`, `url` mascarada e
    `headers` como texto fixo aparecem; o resto vira `<omitido>`."""
    modelo = {**MODELO, "env": {"TOKEN": "segredo-do-env"}, "auth": "Bearer xyz"}
    m = pub.mascarar_entradas(pub.montar_entradas(modelo, "segredo", ["nina"]))["hsos-anexos-nina"]
    assert m["transport"] == "streamable-http"
    assert m["toolFilter"] == {"include": ["ler_anexo", "enviar_arquivo"]}
    assert m["headers"] == "<copiados de hsos-relatorios>"
    assert m["env"] == "<omitido>" and m["auth"] == "<omitido>"
    assert "segredo-do-env" not in str(m) and "xyz" not in str(m)


# Config falsa do gateway: dois agentes que já existiam e um criado pela tela,
# sem deny nenhum — o caso que vazava.
CONF = {
    "mcp": {"servers": {
        "hsos-relatorios": MODELO,
        "banco-hsos": {"toolFilter": {"include": ["query"]}},
    }},
    "agents": {"list": [
        {"id": "nina", "tools": {"alsoAllow": ["mcp__banco-hsos__query"], "deny": []}},
        {"id": "bruce", "tools": {"deny": ["sessions_send"]}},
        {"id": "novo"},
    ]},
}


def test_patch_declara_as_entradas_e_fecha_o_escopo_de_todos_no_mesmo_envio():
    """⚠️ Declarar a entrada sem recalcular o deny a entrega a todo agente: o
    perfil `coding` libera todo servidor MCP e `alsoAllow` só acrescenta. Por
    isso o mesmo patch leva `mcp.servers` e `agents.list` — e a lista INTEIRA,
    porque array substitui no merge patch."""
    patch, novos = pub.montar_patch(CONF, "segredo")
    assert set(novos) == {"hsos-anexos-nina", "hsos-anexos-bruce", "hsos-anexos-novo"}
    assert set(patch["mcp"]["servers"]) == set(novos)
    lista = {a["id"]: a["tools"] for a in patch["agents"]["list"]}
    assert set(lista) == {"nina", "bruce", "novo"}
    for aid, t in lista.items():
        assert f"mcp__hsos-anexos-{aid}__ler_anexo" in t["alsoAllow"]
        assert f"mcp__hsos-anexos-{aid}__enviar_arquivo" in t["alsoAllow"]
        for outro in lista:
            if outro != aid:
                assert f"hsos-anexos-{outro}__ler_anexo" in t["deny"]
                assert f"hsos-anexos-{outro}__enviar_arquivo" in t["deny"]
    assert "mcp__banco-hsos__query" in lista["nina"]["alsoAllow"]
    assert "sessions_send" in lista["bruce"]["deny"]
    # a config lida não foi alterada
    assert "tools" not in CONF["agents"]["list"][2]


def test_conferir_reprova_quem_ve_a_entrada_de_outro():
    patch, novos = pub.montar_patch(CONF, "segredo")
    depois = {"mcp": {"servers": {**CONF["mcp"]["servers"], **novos}},
              "agents": patch["agents"]}
    assert pub.conferir_escopo(depois, novos)

    import copy
    vazado = copy.deepcopy(depois)
    vazado["agents"]["list"][0]["tools"]["alsoAllow"].append("mcp__hsos-anexos-bruce__ler_anexo")
    assert not pub.conferir_escopo(vazado, novos)

    sem_deny = copy.deepcopy(depois)
    sem_deny["agents"]["list"][2]["tools"]["deny"] = []
    assert not pub.conferir_escopo(sem_deny, novos)

    sem_servidor = copy.deepcopy(depois)
    del sem_servidor["mcp"]["servers"]["hsos-anexos-nina"]
    assert not pub.conferir_escopo(sem_servidor, novos)


# ── O cabeçalho redigido (13/10/2026) ───────────────────────────────────────
#
# A primeira aplicação copiou os cabeçalhos do `hsos-relatorios` como vieram do
# `config.get` — redigidos — e o gateway recusou: `Sentinel value
# "__OPENCLAW_REDACTED__" in key mcp.servers.*.headers.* is not valid as real
# data`. Nada foi gravado, mas o script só servia de ensaio.

MODELO_REDIGIDO = {
    "url": "https://api.exemplo.invalido/mcp/relatorios",
    "transport": "streamable-http",
    "headers": {"Authorization": "__OPENCLAW_REDACTED__"},
}


def test_token_entra_no_cabecalho_com_bearer():
    e = pub.montar_entradas(MODELO_REDIGIDO, "segredo", ["bruce"], token="tok")["hsos-anexos-bruce"]
    assert e["headers"] == {"Authorization": "Bearer tok"}


def test_cabecalho_proprio_leva_o_token_cru():
    modelo = {**MODELO_REDIGIDO, "headers": {"X-Bridge-Token": "__OPENCLAW_REDACTED__"}}
    e = pub.montar_entradas(modelo, "segredo", ["bruce"], token="tok")["hsos-anexos-bruce"]
    assert e["headers"] == {"X-Bridge-Token": "tok"}


def test_sem_token_e_cabecalho_redigido_falha_antes_do_gateway():
    """Melhor recusar aqui, com o nome da variável que falta, do que mandar o
    sentinela e ler a recusa do gateway num traceback."""
    import pytest
    with pytest.raises(ValueError, match="GUARDRAILS_API_TOKEN"):
        pub.montar_entradas(MODELO_REDIGIDO, "segredo", ["bruce"])


def test_filtro_da_entrada_inclui_a_ferramenta_restrita_so_de_quem_pode():
    """Sem isto o gateway filtra a `relatorio_ponto` da entrada do `bruce` —
    foi o que o deixou sem ela de 13 a 28/10/2026."""
    novos = pub.montar_entradas(MODELO, "segredo", ["bruce", "nina"], "tok")
    assert "relatorio_ponto" in novos["hsos-anexos-bruce"]["toolFilter"]["include"]
    assert novos["hsos-anexos-nina"]["toolFilter"] == {"include": ["ler_anexo", "enviar_arquivo"]}
