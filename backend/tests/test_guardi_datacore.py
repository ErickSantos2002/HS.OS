"""Guardi no DataCore (10/11/2026): lê o que o login do DONO lê, nada mais.

Decisão do Erick: "tudo que o DataCore oferece, limitado ao seu login". Quem
aplica a permissão é o DataCore (papel do dono); daqui se tranca:
- o agente escolhe uma CONSULTA de uma lista fechada — nunca um caminho: um
  caminho livre alcançaria `/auth/users` ou uma rota de escrita;
- só GET, e o `id` não monta caminho além do segmento dele;
- filtros só como query string, escalares ou listas de escalares, com teto;
- o retorno é dado externo e tem teto: uma página de 1.000 notas estouraria o
  contexto do bot.
"""
import pytest

from app import datacore_consultas as dc


def test_so_consultas_de_negocio():
    proibidas = ("/auth", "/configuracoes", "/operacao", "/anexos", "/centro_custo/config",
                 "/enderecos_entrega", "/formas_envio", "/marcadores")
    for chave, (caminho, _desc) in dc.CONSULTAS.items():
        assert not any(caminho.startswith(p) or p in caminho for p in proibidas), chave
    assert {"clientes", "estoque", "faturamento_resumo", "contas_receber", "inadimplencia_resumo"} <= set(dc.CONSULTAS)
    # 11/11/2026: notas de entrada (gerenciamento financeiro, só a DIRETORIA no DataCore).
    assert dc.caminho_da_consulta("notas_de_entrada", None) == "/notas_entrada/pagina"
    assert dc.caminho_da_consulta("itens_da_nota_de_entrada", "123") == "/notas_entrada/123/itens"


def test_caminho_vem_do_catalogo():
    assert dc.caminho_da_consulta("cliente", "123") == "/clientes/123"
    with pytest.raises(ValueError):
        dc.caminho_da_consulta("usuarios", None)
    with pytest.raises(ValueError):
        dc.caminho_da_consulta("cliente", None)           # falta o id
    with pytest.raises(ValueError):
        dc.caminho_da_consulta("cliente", "1/../../auth/users")
    with pytest.raises(ValueError):
        dc.caminho_da_consulta("clientes", "9")           # consulta sem id não leva id
    for ponto in (".", "..", "..."):                       # /clientes/.. sobe para /
        with pytest.raises(ValueError):
            dc.caminho_da_consulta("cliente", ponto)


def test_filtros_viram_query_string_com_teto():
    assert dc.params_da_consulta({"busca": "acme", "status": ["promessa", "quebrada"], "limite": 50}) == [
        ("busca", "acme"), ("status", "promessa"), ("status", "quebrada"), ("limite", "50")]
    with pytest.raises(ValueError):
        dc.params_da_consulta({"x": {"aninhado": 1}})
    with pytest.raises(ValueError):
        dc.params_da_consulta({"Nome Ruim": "a"})
    with pytest.raises(ValueError):
        dc.params_da_consulta({f"p{i}": "a" for i in range(30)})


def test_retorno_tem_teto():
    t = dc.texto_do_retorno({"itens": [{"nome": "x" * 100}] * 1000})
    assert len(t) <= dc.TETO_RETORNO + 200 and "cortado" in t


def test_lista_crua_pagina_do_nosso_lado():
    """11/11/2026: `/estoque/` do DataCore não aceita parâmetro nenhum e devolve
    os 285 itens de uma vez. O corte de 12 mil caracteres parava no item ~45 e
    mandava "use limite/offset" — que a rota ignora. A Djalma-Guardi pediu
    `offset`, recebeu a mesma lista cortada no mesmo ponto e (com razão) disse
    que não conseguia ler o resto do estoque. Lista crua é paginada AQUI, por
    item inteiro, e o retorno diz o total e o próximo offset."""
    import json
    itens = [{"id": i, "nome": "Bafômetro " + "x" * 200} for i in range(285)]
    primeira = json.loads(dc.texto_do_retorno(itens))
    assert primeira["total"] == 285 and primeira["offset"] == 0
    n = len(primeira["itens"])
    assert 0 < n < 285 and primeira["proximo_offset"] == n
    seguinte = json.loads(dc.texto_do_retorno(itens, offset=n))
    assert seguinte["itens"][0]["id"] == n
    ultima = json.loads(dc.texto_do_retorno(itens, offset=280))
    assert [i["id"] for i in ultima["itens"]] == list(range(280, 285))
    assert ultima["proximo_offset"] is None
    assert json.loads(dc.texto_do_retorno(itens, offset=10, limite=3))["proximo_offset"] == 13
    assert len(dc.texto_do_retorno(itens)) <= dc.TETO_RETORNO


def test_paginacao_local_so_onde_o_datacore_nao_pagina():
    """Rota que declara `offset` pagina lá (devolve a página como objeto); nas
    outras, `offset`/`limite` saem da query e são aplicados aqui."""
    openapi = {"paths": {
        "/clientes/": {"get": {"parameters": [{"name": "offset", "in": "query"},
                                               {"name": "limite", "in": "query"}]}},
        "/estoque/": {"get": {}}}}
    params = [("offset", "45"), ("limite", "20"), ("busca", "x")]
    assert dc.paginacao_local(openapi, "/clientes/", params) == (params, 0, None)
    assert dc.paginacao_local(openapi, "/estoque/", params) == ([("busca", "x")], 45, 20)
    with pytest.raises(ValueError):
        dc.paginacao_local(openapi, "/estoque/", [("offset", "-1")])


def test_filtros_lidos_do_openapi():
    openapi = {"paths": {"/clientes/": {"get": {"parameters": [
        {"name": "busca", "in": "query", "schema": {"type": "string"}, "description": "nome ou CNPJ"},
        {"name": "authorization", "in": "header"}]}}}}
    assert dc.filtros_da_openapi(openapi, "/clientes/") == ["busca (string): nome ou CNPJ"]


def test_ferramentas_no_guardi():
    from app.email.regras import FERRAMENTAS_BOT
    assert {"datacore_consultas", "datacore_consultar"} <= set(FERRAMENTAS_BOT)


def test_sem_datacore_ligado_recusa():
    import asyncio
    from app.routers import mcp_bot
    ctx = {"sistemas": ["taskhs"], "email": "a@b.com", "dono": "u1", "primeiro": "Ana"}
    with pytest.raises(mcp_bot._Recusa):
        asyncio.run(mcp_bot._datacore("ana-bot", "datacore_consultar", {"consulta": "clientes"}, ctx))
