"""Guardi no GestorHS (11/11/2026, fase 1): lê o que o login do DONO lê, nada mais.

Spec `docs/superpowers/specs/2026-11-11-guardi-gestorhs-design.md`. Quem aplica a
permissão é o GestorHS (a função do dono lá); daqui se tranca o resto, no molde
do DocsHS:
- o agente escolhe uma CONSULTA de uma lista fechada — nunca um caminho: um
  caminho livre alcançaria nota fiscal, PDF de certificado ou a lista de
  usuários, nenhum deles pedido na fase 1;
- os filtros são os DECLARADOS no catálogo, para recusar o que o GestorHS
  ignoraria em silêncio;
- o `id` é só dígitos (todo id do GestorHS é inteiro);
- o link para abrir no GestorHS é montado aqui, com o endereço do FRONT — que
  não é o da API.
"""
import pytest

from app import gestorhs_consultas as gh


def test_catalogo_so_leitura_sem_pdf_nem_nota():
    """Spec: fora da fase 1, PDF, exportação, nota fiscal, logs, usuários e
    portal. Uma entrada dessas bastaria para o agente alcançar — a allowlist do
    GestorHS é a segunda tranca, não a única."""
    proibidas = ("pdf", "exportar", "nota", "logs", "usuarios", "portal", "campos", "/auth")
    for chave, (caminho, _d, _f) in gh.CONSULTAS.items():
        assert not any(p in caminho for p in proibidas), chave


def test_id_e_so_digitos():
    """O `id` monta UM segmento: `1/notas-fiscais` ou `1/../../usuarios`
    levariam o token do dono a uma rota fora do catálogo. Todo id do GestorHS é
    inteiro, então a regra é mais estreita que a do DocsHS."""
    assert gh.caminho_da_consulta("aparelho", "42") == "/equipamentos-cliente/42"
    assert gh.caminho_da_consulta("caixa", "7") == "/caixas/7"
    assert gh.caminho_da_consulta("versoes_da_proposta", 3) == "/propostas/3/versoes"
    for ruim in ("1/notas-fiscais", "..", "1/../../usuarios", "abc", "", None, "12345678901"):
        with pytest.raises(ValueError):
            gh.caminho_da_consulta("aparelho", ruim)
    with pytest.raises(ValueError):
        gh.caminho_da_consulta("aparelhos", "3")      # lista não leva id
    with pytest.raises(ValueError):
        gh.caminho_da_consulta("notas_fiscais", None)  # fora do catálogo


def test_filtro_fora_da_lista_e_recusado():
    """Filtro desconhecido o GestorHS ignoraria em silêncio — o agente acharia
    que filtrou e contaria a lista inteira como se fosse a filtrada. E `limit`
    ou `page_size` acima de 100 é 422 lá: recusa antes, com mensagem que o
    agente entende."""
    assert gh.params_da_consulta("aparelhos", {"cliente": 9, "status": "vencido"}) == \
        [("cliente", "9"), ("status", "vencido")]
    assert gh.params_da_consulta("caixas", {"incluir_concluidas": True}) == \
        [("incluir_concluidas", "true")]
    with pytest.raises(ValueError, match="incluir_concluidas"):   # a mensagem nomeia os aceitos
        gh.params_da_consulta("caixas", {"fase": 3})
    for ruim in ({"limit": 1000}, {"limit": 0}, {"offset": -1}, {"cliente": [1, 2]}):
        with pytest.raises(ValueError):
            gh.params_da_consulta("aparelhos", ruim)
    with pytest.raises(ValueError):
        gh.params_da_consulta("propostas", {"page_size": 500})
    with pytest.raises(ValueError):
        gh.params_da_consulta("aparelho", {"cliente": 1})          # item único não tem filtro


def test_paginacao_local_nao_vai_ao_gestorhs():
    """`/equipamentos`, `/fases` e os históricos devolvem a lista inteira: sem
    paginar aqui, o corte de 12 mil caracteres pararia sempre no mesmo item (o
    defeito do estoque do DataCore, 11/11/2026). `offset`/`limite` saem da query."""
    p = gh.params_da_consulta("modelos", {"offset": 20, "limite": 10})
    assert gh.paginacao_local("modelos", p) == ([], 20, 10)
    # nas que paginam lá, o `offset` É do GestorHS: tirá-lo da query faria o
    # agente receber sempre a primeira página achando que avançou
    p = gh.params_da_consulta("aparelhos", {"offset": 20, "limit": 50})
    assert gh.paginacao_local("aparelhos", p) == ([("offset", "20"), ("limit", "50")], 0, None)
    with pytest.raises(ValueError):
        gh.params_da_consulta("aparelhos", {"limite": 10})


def test_links_do_front():
    """O modelo não monta URL: inventaria o caminho (ou usaria o domínio da API)
    e mandaria a pessoa a uma página que não existe. O envelope do GestorHS é
    `items`, não `itens` como no DocsHS."""
    base = "https://g.x"
    d = gh.com_links("aparelhos", {"items": [{"id": 5, "serie": "A1"}], "total": 1}, base)
    assert d["items"][0]["link"] == "https://g.x/app/equipamentos/5"
    assert gh.com_links("caixa", {"id": 7}, base)["link"] == "https://g.x/app/caixas/7"
    assert gh.com_links("os_do_aparelho", [{"id": 3}], base)[0]["link"] == "https://g.x/app/ordens/3"
    assert gh.com_links("cliente", {"id": 4}, base + "/")["link"] == "https://g.x/app/clientes/4"
    assert gh.com_links("proposta", {"id": 2}, base)["link"] == "https://g.x/app/propostas"
    assert "link" not in gh.com_links("fases", [{"id": 1}], base)[0]
    assert gh.com_links("aparelho", {"serie": "sem id"}, base) == {"serie": "sem id"}
