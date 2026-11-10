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
    t = dc.texto_do_retorno([{"nome": "x" * 100}] * 1000)
    assert len(t) <= dc.TETO_RETORNO + 200 and "cortado" in t


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
