"""A lista de compradores que o modelo não conseguia escrever.

Em 30/09/2026 o CEO pediu a lista completa de quem comprou Phoebus. A Iris
apurou certo e se perdeu ao escrevê-la: a tabela passou do teto de saída e o
turno foi descartado, três vezes. O mesmo dia já tinha produzido "230 Phoebus
em 2025" (certo: 217) por abater devolução cuja origem a régua já tinha tirado.
Estes testes trancam as duas partes que decidem o número: a quem a nota pertence
e quando uma devolução abate.

Conferido contra o DataCoreHS em 30/09/2026 com o módulo real: 2025 = 54
empresas / 217 un / R$ 4.936.796,00; 2024 líquido = 194 un / R$ 3.919.607,00
(abate só a 005745); 2020–2026 = 137 empresas / 757 un / R$ 15.733.671,84
(abate a 005745 e a 004762). São as âncoras da skill `faturamento`.

Reconferido em 01/10/2026 na régua do DataCoreHS (`gold.fato_vendas`): os
mesmos três números, mas **sem abater nada** — as vendas 005725 e 004743 já
saem pelo marcador de rejeição, então 2024 vem 194 direto. O que estes testes
trancam (a quem a nota pertence, quando uma devolução abate) não mudou.
"""
from datetime import date

from app.relatorios import compradores as c


def test_referencia_casa_os_formatos_reais_das_observacoes():
    """Textos copiados das notas de devolução de Phoebus."""
    casos = {
        "faturado na DANFE de venda 006031, codigo de acesso 2624": "006031",
        "faturado na NF de venda 4743, codigo de acesso 2623": "004743",
        "nota de Remessa de Saída DANFE 5542, codigo de acesso": "005542",
        "Nota Fiscal de entrada emitida devido recusa da SEFAZ": None,
        None: None,
    }
    for obs, esperado in casos.items():
        assert c.referencia_da_devolucao(obs) == esperado, obs


def test_devolucao_so_abate_quando_a_origem_ainda_conta():
    """006377 devolve a 006339, que tem marcador "NF recusada" e já saiu da
    régua. Abatê-la tirava 6 unidades de 2025 pela segunda vez."""
    contadas = {"005725", "004743"}
    assert c._decidir("005725", contadas) == "abater"
    assert c._decidir("006339", contadas) != "abater"
    assert c._decidir(None, contadas) != "abater"


def test_filiais_da_mesma_raiz_viram_uma_empresa():
    assert (c.chave_de_grupo("06.980.064/0001-10", "Nacional Gás", "raiz_cnpj")
            == c.chave_de_grupo("06.980.064/0033-06", "NACIONAL GAS BUTANO", "raiz_cnpj"))


def test_cpf_nao_vira_raiz():
    """Pessoa física não tem filial: cortar o CPF em 8 dígitos juntaria gente
    diferente."""
    assert c.chave_de_grupo("123.456.789-01", "Fulano", "raiz_cnpj") == "cpf:12345678901"


def test_nome_normalizado_ignora_acento_pontuacao_e_sufixo():
    assert c.normalizar_nome("Nacional Gás Butano Distribuidora Ltda.") == \
           c.normalizar_nome("NACIONAL GAS BUTANO DISTRIBUIDORA LTDA")


def _v(numero, cnpj, nome, qtd, valor, d=date(2025, 5, 1)):
    return {"numero": numero, "data": d, "cpf_cnpj": cnpj, "nome": nome,
            "quantidade": qtd, "valor": valor}


def test_modo_nome_nunca_separa_mais_que_a_raiz():
    """Agrupar direto pelo nome dava 153 empresas de Phoebus contra 137 por raiz:
    filiais grafadas diferente se separavam. O modo nome parte da raiz."""
    vendas = [
        _v("1", "06.980.064/0001-10", "Nacional Gás Butano Ltda", 2, 100),
        _v("2", "06.980.064/0033-06", "NACIONAL GAS - FILIAL RECIFE", 1, 50),
        _v("3", "11.111.111/0001-11", "Nacional Gás Butano Ltda", 1, 50),
    ]
    por_raiz = c.consolidar(vendas, [], "raiz_cnpj")
    por_nome = c.consolidar(vendas, [], "nome")
    assert por_raiz["empresas"] == 2
    assert por_nome["empresas"] == 1          # a 3ª raiz tem o mesmo nome da 1ª
    assert por_nome["empresas"] <= por_raiz["empresas"]


def test_soma_das_linhas_fecha_com_o_total_e_so_abate_o_decidido():
    vendas = [_v("1", "06.980.064/0001-10", "A", 10, 1000),
              _v("2", "55.024.743/0001-93", "B", 5, 500)]
    devol = [dict(_v("9", "06.980.064/0001-10", "A", 2, 200), decisao="abater"),
             dict(_v("8", "55.024.743/0001-93", "B", 5, 500),
                  decisao="origem já fora da régua — não abatida")]
    r = c.consolidar(vendas, devol, "raiz_cnpj")
    assert (r["brutas"], r["devolvidas"], r["liquidas"]) == (15, 2, 13)
    assert r["valor_liquido"] == 1300
    assert sum(g["liquidas"] for g in r["linhas"]) == r["liquidas"]
    assert r["linhas"][0]["liquidas"] == 8     # ordenado por unidades líquidas


def test_pagina_soma_as_linhas_igual_ao_cabecalho():
    """Em 30/09/2026 a página escrita pelo modelo somava 768 un (o bruto) sob o
    título "757 líquidas". Montada aqui, linha e total saem do mesmo dicionário."""
    import re
    vendas = [_v("1", "06.980.064/0001-10", "A & Cia <SA>", 10, 1000.5),
              _v("2", "55.024.743/0001-93", "B", 5, 500)]
    devol = [dict(_v("9", "06.980.064/0001-10", "A & Cia <SA>", 2, 200), decisao="abater")]
    r = c.consolidar(vendas, devol, "raiz_cnpj")
    h = c.pagina_html("PRODUTO", date(2025, 1, 1), date(2025, 12, 31), r, "raiz")
    liquidas = [int(x) for x in re.findall(r"<td class=n><b>(\d+)</b></td>", h)]
    assert sum(liquidas) == r["liquidas"] == 13
    assert "&lt;SA&gt;" in h                   # nome de cliente vai escapado
