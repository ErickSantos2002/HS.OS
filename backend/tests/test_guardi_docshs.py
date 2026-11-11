"""Guardi no DocsHS (11/11/2026): lê o que o login do DONO lê, nada mais.

Spec `docs/superpowers/specs/2026-11-11-guardi-docshs-design.md`. Quem aplica a
permissão é o DocsHS (cargo, setor, classificação, papel da Qualidade); daqui
se tranca o resto:
- o agente escolhe uma CONSULTA de uma lista fechada — nunca um caminho: um
  caminho livre alcançaria a prova de um treinamento ou o arquivo de um
  documento, e nenhum dos dois pode chegar ao modelo;
- os filtros são os DECLARADOS no catálogo (o OpenAPI do DocsHS não é
  alcançável de fora, ao contrário do DataCore);
- o "eu" do histórico de treinamentos é resolvido pelo servidor, nunca vem do
  agente — senão o Guardi de A pediria o histórico de B;
- o link para abrir no DocsHS é montado aqui, não pelo modelo.
"""
import pytest

from app import docshs_consultas as dh


def test_catalogo_sem_arquivo_nem_prova():
    """Decisão 2 do Erick: nenhum arquivo de documento passa pelo modelo; e o
    Guardi não pode ver nem ajudar a fazer a prova de ninguém. Uma entrada
    dessas no catálogo bastaria para o agente alcançar — o allowlist do DocsHS
    é a segunda tranca, não a única."""
    proibidas = ("arquivo", "prova", "video", "exportacao", "materiais", "anexos",
                 "/trilha", "/usuarios")
    for chave, (caminho, _desc, _filtros) in dh.CONSULTAS.items():
        assert not any(p in caminho for p in proibidas), chave
        if caminho.startswith("/administracao"):
            assert caminho == "/administracao/tipos", chave
        if caminho.startswith("/auth"):
            assert caminho == "/auth/eu", chave


def test_caminho_vem_do_catalogo():
    """O `id` monta UM segmento: `1/../../auth` escaparia para outra rota do
    DocsHS com o token do dono."""
    assert dh.caminho_da_consulta("documento", "12") == "/documentos/12"
    assert dh.caminho_da_consulta("plano_de_treinamento", "2026") == "/planos-treinamento/2026"
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("usuarios", None)                 # desconhecida
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("documento", None)                # falta o id
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("documentos", "9")                # consulta sem id não leva id
    for ruim in ("1/../../auth", "..", ".", "1/arquivo"):
        with pytest.raises(ValueError):
            dh.caminho_da_consulta("documento", ruim)


def test_eu_nunca_vem_do_agente():
    """Se o `{eu}` aceitasse o `id` do agente, o Guardi de A leria o histórico de
    treinamentos de B e só a regra do DocsHS o barraria — uma tranca a menos
    num dado de pessoa."""
    assert dh.caminho_da_consulta("meus_treinamentos", None, eu=7) == "/treinamentos/pessoas/7/historico"
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("meus_treinamentos", "8", eu=7)
    with pytest.raises(ValueError):
        dh.caminho_da_consulta("meus_treinamentos", None, eu=None)
    assert dh.precisa_de_eu("meus_treinamentos") and not dh.precisa_de_eu("documentos")


def test_filtros_so_os_declarados():
    """Filtro desconhecido o DocsHS ignoraria em silêncio — o agente acharia que
    filtrou e contaria a lista inteira como se fosse a filtrada. Recusa aqui,
    com a lista dos válidos. `tamanho` acima de 200 é 422 lá: recusa antes, com
    mensagem que o agente entende."""
    assert dh.params_da_consulta("documentos", {"busca": "calibração", "situacao": "vencida"}) == [
        ("busca", "calibração"), ("situacao", "vencida")]
    assert dh.params_da_consulta("treinamentos", {"com_pendentes": True, "ano": 2026}) == [
        ("com_pendentes", "true"), ("ano", "2026")]
    with pytest.raises(ValueError) as e:
        dh.params_da_consulta("documentos", {"foo": 1})
    assert "busca" in str(e.value)
    for ruim in ({"tamanho": 500}, {"tamanho": 0}, {"pagina": 0}, {"pagina": "x"}):
        with pytest.raises(ValueError):
            dh.params_da_consulta("documentos", ruim)
    with pytest.raises(ValueError):
        dh.params_da_consulta("painel", {"ano": 2026})
    with pytest.raises(ValueError):
        dh.params_da_consulta("documentos", {"busca": ["a", "b"]})   # nenhum filtro é lista


def test_lista_crua_pagina_do_nosso_lado():
    """Fora a Lista Mestra, as rotas do DocsHS devolvem a lista inteira — sem
    paginação ali, o corte de 12 mil caracteres pararia sempre no mesmo item
    (o defeito do estoque do DataCore, 11/11/2026). `offset`/`limite` não vão ao
    DocsHS: saem da query e são aplicados aqui."""
    params = dh.params_da_consulta("treinamentos", {"ano": 2026, "offset": 40, "limite": 10})
    assert dh.paginacao_local(params) == ([("ano", "2026")], 40, 10)
    assert dh.paginacao_local([("busca", "x")]) == ([("busca", "x")], 0, None)
    with pytest.raises(ValueError):
        dh.params_da_consulta("documentos", {"offset": 10})      # a Lista Mestra pagina lá
    with pytest.raises(ValueError):
        dh.params_da_consulta("treinamentos", {"offset": -1})


def test_links_do_front():
    """O modelo não monta URL: inventaria o caminho (ou o domínio) e mandaria a
    pessoa a uma página que não existe."""
    base = "https://d.x"
    assert dh.link_de("/documentos/12", base) == "https://d.x/documentos/12"
    assert dh.link_de("/treinamentos/3", base + "/") == "https://d.x/treinamentos/3"
    assert dh.link_de("/painel", base) is None
    assert dh.com_links("documentos", {"itens": [{"id": 5}], "total": 1}, base) == {
        "itens": [{"id": 5, "link": "https://d.x/documentos/5"}], "total": 1}
    assert dh.com_links("documento", {"id": 9, "titulo": "PO"}, base)["link"] == "https://d.x/documentos/9"
    assert dh.com_links("treinamentos", [{"id": 2}], base) == [{"id": 2, "link": "https://d.x/treinamentos/2"}]
    assert dh.com_links("treinamento", {"id": 4}, base)["link"] == "https://d.x/treinamentos/4"
    assert dh.com_links("painel", {"id": 1}, base) == {"id": 1}
    # leitura aponta para o documento dela
    assert dh.com_links("minhas_leituras", [{"id": 1, "documento_id": 8}], base)[0]["link"] == \
        "https://d.x/documentos/8"
