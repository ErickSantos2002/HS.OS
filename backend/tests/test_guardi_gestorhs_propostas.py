"""Guardi no GestorHS, fase 2c (Serviços, 12/11/2026): proposta por cartão.

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-propostas-design.md`.
A pessoa conta o pedido do cliente; o Guardi monta a proposta pelo padrão da
casa e lembra o que fugiu dele. O que se tranca aqui:
- item só do catálogo, com o preço de lá: item inventado iria ao PDF do cliente;
- o total e o frete são do SERVIDOR, em `Decimal`, como o GestorHS calcula;
- lembrete não trava, e cliente sem UF vira "estado desconhecido", nunca um
  frete chutado;
- o `destinatario` nunca leva nada além de tipo e id: no GestorHS ele ESCREVE
  no cadastro do cliente e sincroniza com o Tiny;
- alterar manda a lista INTEIRA de itens e aparelhos (o `PUT` substitui) e não
  sobrescreve o `outros_itens` editado à mão na tela.
"""
from decimal import Decimal

import pytest

from app import gestorhs_propostas as gp

PADRAO = {"observacoes": "Caso…", "validade_dias": 30,
          "frete_por_regiao": {"Norte": 200, "Nordeste": 150, "Sul": 250, "Sudeste": 200, "Centro-Oeste": 200},
          "regiao_por_uf": {"PE": "Nordeste", "SP": "Sudeste"},
          "outros_itens": {"padrao": "<p>Serviços&nbsp;de Calibração</p>", "phoebus": "<p>PHOEBUS</p>"}}
CAT = [{"sku": "312", "nome": "CALIBRAÇÃO COM GÁS RASTREADO 2025", "preco": 395, "unidade": "UN"},
       {"sku": "306", "nome": "CALIBRAÇÃO COM GÁS RASTREADO - MÓDULO PHOEBUS 2025 (1)", "preco": 625.4, "unidade": "UN"}]


# --- regras puras -----------------------------------------------------------------

def test_item_so_do_catalogo_e_preco_do_catalogo():
    """Item inventado pelo modelo iria ao PDF do cliente com nome e preço de ninguém."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 3}], CAT)
    assert it[0]["preco_un"] == 395 and it[0]["descricao"].startswith("CALIBRAÇÃO")
    with pytest.raises(ValueError):
        gp.itens_do_pedido([{"sku": "999", "quantidade": 1}], CAT)
    with pytest.raises(ValueError):
        gp.itens_do_pedido([{"sku": "312", "quantidade": 0}], CAT)


def test_tetos_dos_itens():
    """Quantidade 1000 é dedo escorregando; preço negativo vira desconto escondido
    numa linha; 31 itens não cabem no cartão que a pessoa precisa ler inteiro."""
    for ruim in ([], [{"sku": "312", "quantidade": 1000}], [{"sku": "312", "quantidade": -1}],
                 [{"sku": "312", "quantidade": True}], [{"sku": "312", "quantidade": 1, "preco": -5}],
                 [{"sku": "312", "quantidade": 1}] * 31, "312", [{"quantidade": 1}]):
        with pytest.raises(ValueError):
            gp.itens_do_pedido(ruim, CAT)


def test_sku_ambiguo_no_catalogo_recusa_em_vez_de_chutar():
    """Serviço e produto podem repetir o sku: escolher um seria pôr no PDF o
    item que a pessoa não pediu. Recusa e manda perguntar."""
    cat = CAT + [{"sku": "312", "nome": "OUTRO ITEM", "preco": 10, "unidade": "UN"}]
    with pytest.raises(ValueError, match="pergunte"):
        gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], cat)


def test_preco_falado_vai_mas_marcado():
    it = gp.itens_do_pedido([{"sku": 312, "quantidade": 2, "preco": 350}], CAT)
    assert it[0]["preco_un"] == Decimal("350") and it[0]["preco_catalogo"] == Decimal("395")
    assert it[0]["sku"] == "312" and it[0]["unidade"] == "UN"


def test_phoebus_pela_descricao_do_catalogo():
    assert gp.eh_phoebus(gp.itens_do_pedido([{"sku": "306", "quantidade": 1}], CAT))
    assert not gp.eh_phoebus(gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], CAT))


def test_frete_pela_regiao_e_zero_no_phoebus():
    assert gp.frete_padrao(PADRAO, "PE", False) == Decimal("150")
    assert gp.frete_padrao(PADRAO, "SP", True) == Decimal("0")
    assert gp.frete_padrao(PADRAO, None, False) is None


def test_uf_fora_da_tabela_e_estado_desconhecido():
    """UF que a tabela não conhece (ou minúscula, ou com espaço) não pode virar
    um frete de outra região."""
    assert gp.frete_padrao(PADRAO, "pe ", False) == Decimal("150")
    assert gp.frete_padrao(PADRAO, "XX", False) is None
    assert gp.frete_padrao(PADRAO, "", False) is None


def test_total_igual_ao_do_gestorhs():
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 3}], CAT)
    assert gp.total(it, Decimal("150"), Decimal("0")) == Decimal("1335.00")
    it = gp.itens_do_pedido([{"sku": "306", "quantidade": 3}], CAT)
    assert gp.total(it, Decimal("0"), Decimal("10")) == Decimal("1866.20")    # em float: 1866.1999…


def test_outros_itens_do_modelo():
    assert gp.outros_itens_padrao(PADRAO, False) == PADRAO["outros_itens"]["padrao"]
    assert gp.outros_itens_padrao(PADRAO, True) == "<p>PHOEBUS</p>"


def test_lembretes_do_que_fugiu_do_padrao():
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1, "preco": 350}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=Decimal("150"), uf="PE",
                     desconto=Decimal("10"), pagamento="60 dias", pagamento_ultima="30 dias",
                     aparelhos_na_proposta=[1], frota_vencendo=[{"id": 2, "serie": "F2"}],
                     phoebus=False, outros_itens="", entrega_diferente=True)
    t = " | ".join(l)
    for trecho in ("catálogo", "retira", "desconto", "30 dias", "F2", "entrega"):
        assert trecho in t


def test_proposta_no_padrao_nao_tem_lembrete():
    """Lembrete demais vira ruído que ninguém lê — e aí o que importa passa."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], CAT)
    assert gp.lembretes(itens=it, frete=Decimal("150"), frete_tabela=Decimal("150"), uf="PE",
                        desconto=Decimal("0"), pagamento=None, pagamento_ultima=None,
                        aparelhos_na_proposta=[1], frota_vencendo=[{"id": 1, "serie": "F1"}],
                        phoebus=False, outros_itens="<p>x</p>", entrega_diferente=False) == []


def test_sem_uf_o_lembrete_e_estado_desconhecido():
    """Cliente sem estado no cadastro: o frete não pode ser chutado, e a pessoa
    precisa saber que ninguém conferiu."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=None, uf=None,
                     desconto=Decimal("0"), pagamento=None, pagamento_ultima=None,
                     aparelhos_na_proposta=[], frota_vencendo=[], phoebus=False,
                     outros_itens="", entrega_diferente=False)
    assert len(l) == 1 and "estado desconhecido" in l[0]


def test_phoebus_avisa_das_lacunas_e_nao_cobra_frete():
    it = gp.itens_do_pedido([{"sku": "306", "quantidade": 1}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=Decimal("0"), uf="PE",
                     desconto=Decimal("0"), pagamento=None, pagamento_ultima=None,
                     aparelhos_na_proposta=[], frota_vencendo=[], phoebus=True,
                     outros_itens="<li>R$ ____ (por unidade)</li><li>[Inserir número]</li>",
                     entrega_diferente=False)
    assert len(l) == 1 and "lacunas" in l[0] and "Phoebus" in l[0]


def test_texto_editado_na_tela_nao_e_do_modelo():
    assert gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p>", PADRAO)
    assert not gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p><p>combinado com o João</p>", PADRAO)


def test_texto_do_modelo_resiste_ao_que_o_editor_mexe():
    """O Quill troca espaço por `&nbsp;`, acrescenta parágrafo vazio e quebra
    linha entre tags: nada disso é edição de gente."""
    assert gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p>\n<p><br></p><p></p>", PADRAO)
    assert gp.texto_ainda_e_do_modelo("<p>PHOEBUS</p>", PADRAO)
    assert not gp.texto_ainda_e_do_modelo("", PADRAO)
