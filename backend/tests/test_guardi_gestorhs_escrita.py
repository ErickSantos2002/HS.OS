"""Guardi no GestorHS, fase 2a (Expedição, 12/11/2026): escrita por cartão.

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-expedicao-design.md`.
Quatro ações — receber aparelhos (OS em lote), avançar caixa, fechar caixa com
rastreio e cadastrar aparelho — e nenhuma escreve sem o clique do dono. O que se
tranca aqui:
- o servidor confere no GestorHS ANTES do cartão (aparelho com OS ativa, caixa
  na fase errada, série que já existe): o cartão nunca promete o que lá vai ser
  recusado;
- o cartão mostra o cliente de cada aparelho (a série falada pode ser de outro);
- lote que falha no meio para e diz o que abriu, sem desfazer.
"""
import pytest

from app import gestorhs_escrita as ge


# --- regras puras -----------------------------------------------------------------

def test_lote_valida_e_normaliza():
    """Lote com tipo ou acessório inválido daria 400/422 no clique, depois de a
    pessoa já ter confirmado. Recusar antes do cartão evita confirmação inútil."""
    itens = ge.aparelhos_do_lote({"aparelhos": [{"id": 5, "tipo_servico": "C", "acessorios": [2, 8]}]})
    assert itens == [{"equipamento_cliente": 5, "tipo_servico": "C", "condicao_chegada": None,
                      "checklist": [2, 8], "pilhas": 0, "bocais": 0, "observacoes": None}]
    for ruim in ({"aparelhos": []}, {"aparelhos": [{"id": 5, "tipo_servico": "X"}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "acessorios": [10]}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C"}, {"id": 5, "tipo_servico": "C"}]},
                 {"aparelhos": [{"id": i, "tipo_servico": "C"} for i in range(1, 32)]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "condicao": "Ótimo"}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "observacao": "x" * 501}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "pilhas": -1}]},
                 {"aparelhos": [{"id": True, "tipo_servico": "C"}]},
                 {"aparelhos": "5"}):
        with pytest.raises(ValueError):
            ge.aparelhos_do_lote(ruim)


def test_aparelho_com_os_ativa_recusa_nomeando():
    """O GestorHS responderia 409 no clique — no meio do lote, com OS já abertas
    antes dele. Recusar antes, nomeando a série, deixa a pessoa tirar o aparelho
    do lote em vez de descobrir depois."""
    ap = {"id": 5, "cliente_nome": "ACME", "equipamento_descricao": "Phoebus", "serie": "F1"}
    with pytest.raises(ValueError, match="F1"):
        ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [{"id": 9, "fase": 5}])
    assert ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [{"id": 9, "fase": 8}]) == \
        {"cliente": "ACME", "modelo": "Phoebus", "serie": "F1"}


def test_texto_do_gestorhs_entra_no_cartao_em_uma_linha():
    """Nome de cliente e série são texto de terceiro e vão para o cartão que o
    dono confirma: com quebra de linha, um nome forjado desenharia uma linha
    falsa no cartão."""
    ap = {"id": 5, "cliente_nome": "ACME\nCaixa: 999", "equipamento_descricao": "P" * 200, "serie": "F1"}
    ex = ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [])
    assert "\n" not in ex["cliente"] and len(ex["modelo"]) == 80


def test_caixa_existente_em_qualquer_fase_ativa_com_aviso():
    """Decisão do Erick (12/11): pode, mas o cartão avisa onde a OS entra."""
    assert ge.conferir_caixa_para_receber({"id": 7, "fase": 4, "fase_descricao": "Recebido"}) is None
    assert "Laboratório" in ge.conferir_caixa_para_receber({"id": 7, "fase": 5, "fase_descricao": "Laboratório"})
    for fase in (8, 9, None):
        with pytest.raises(ValueError):
            ge.conferir_caixa_para_receber({"id": 7, "fase": fase})


def test_avancar_recusa_preparando_e_pede_cliente_principal():
    """Avançar de Preparando Retorno exige o rastreio: sem ferramenta própria o
    agente mandaria sem `cod_retorno` e levaria o 409 no clique. E caixa com
    clientes misturados não sai de Recebido sem o cliente principal."""
    with pytest.raises(ValueError, match="gestorhs_fechar_caixa"):
        ge.conferir_caixa_para_avancar({"id": 7, "fase": 7, "clientes": ["A"], "total_os": 1}, None)
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_avancar({"id": 7, "fase": 8, "clientes": ["A"], "total_os": 1}, None)
    multi = {"id": 7, "fase": 4, "clientes": ["A", "B"], "cliente_principal": None, "total_os": 2}
    with pytest.raises(ValueError, match="cliente_principal"):
        ge.conferir_caixa_para_avancar(multi, None)
    ex = ge.conferir_caixa_para_avancar(multi, 33)
    assert ex["fase"] == "Recebido" and ex["funcao"] == "Expedição" and ex["total_os"] == 2
    assert ex["clientes"] == ["A", "B"]
    # já com principal gravado na caixa, não pede de novo
    ge.conferir_caixa_para_avancar({**multi, "cliente_principal": 33}, None)


def test_fechar_exige_preparando_e_rastreio():
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 4}, "BR1")
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 7}, "  ")
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 7}, "X" * 61)
    ex = ge.conferir_caixa_para_fechar({"id": 7, "fase": 7, "total_os": 3, "clientes": ["ACME"]}, " BR123 ")
    assert ex["cod_retorno"] == "BR123" and ex["total_os"] == 3 and ex["clientes"] == ["ACME"]


def test_cadastro_recusa_serie_que_ja_existe():
    """'Cadastra o bafômetro série X' com X já na frota daria um aparelho
    duplicado, e as OS futuras cairiam ora num, ora noutro."""
    with pytest.raises(ValueError, match="ACME"):
        ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "f 123"},
                             [{"serie": "F123", "cliente_nome": "ACME"}])
    p = ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "F9"}, [])
    assert p == {"cliente": 1, "equipamento": 2, "serie": "F9"}
    p = ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "F9", "patrimonio": "P1",
                              "prox_calibragem": "2027-01-31"}, [{"serie": "F99"}])
    assert p["patrimonio"] == "P1" and p["prox_calibragem"] == "2027-01-31"
    for ruim in ({"cliente": 1, "equipamento": 2, "serie": ""},
                 {"cliente": 1, "equipamento": 2, "serie": "X" * 61},
                 {"cliente": "a", "equipamento": 2, "serie": "F9"},
                 {"cliente": 1, "equipamento": 2, "serie": "F9", "datacompra": "31/01/2027"}):
        with pytest.raises(ValueError):
            ge.conferir_cadastro(ruim, [])


def test_texto_do_lote_parcial():
    """É o texto que a pessoa lê para decidir o resto do lote: sem dizer quais
    OS já existem, ela repetiria o lote inteiro e levaria 409 nos que abriram."""
    t = ge.texto_lote_parcial(2, 5, "F3", "aparelho já possui OS ativa", [100, 101], 40)
    assert t.startswith("Parou no aparelho 3 de 5") and "OS 100, 101" in t and "caixa 40" in t
