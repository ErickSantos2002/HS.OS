"""Regras puras de escrita de Serviços do HSGrowth (12/11/2026)."""
import pytest

from app import hsgrowth_servicos_escrita as r

ETAPAS1 = [
    {"id": 10, "board_id": 1, "name": "Dados Preenchidos", "position": 1},
    {"id": 11, "board_id": 1, "name": "Tentativa de Contato", "position": 2},
    {"id": 12, "board_id": 1, "name": "Proposta", "position": 3},
    {"id": 13, "board_id": 1, "name": "Aguardando Pedido", "position": 4},
    {"id": 14, "board_id": 1, "name": "Negócio Ganho", "position": 5, "is_done_stage": True},
    {"id": 15, "board_id": 1, "name": "Negócio Perdido", "position": 6, "is_lost_stage": True},
    {"id": 90, "board_id": 2, "name": "Operações", "position": 1},
]
ETAPAS2 = [
    {"id": 20, "board_id": 2, "name": "Proposta", "position": 1},
    {"id": 21, "board_id": 2, "name": "Operações", "position": 2},
    {"id": 22, "board_id": 2, "name": "Ganho", "position": 3},
]


def card(lista, board=1):
    return {"board_id": board, "list_id": lista}


def erro(fn, *a, **k):
    with pytest.raises(ValueError) as e:
        fn(*a, **k)
    return str(e.value)


def test_negocio_opcao_fora_lista_as_opcoes():
    """Valor inventado gravado no Resumo apareceria como vazio na tela."""
    m = erro(r.negocio, {"service_type": "troca"}, 1)
    assert "recalibracao" in m and "manutencao" in m


def test_negocio_chave_desconhecida_e_tipos():
    """Chave fora da lista deixaria o agente gravar o que quisesse no business_info."""
    assert "status" in erro(r.negocio, {"status": "x"}, 1)
    assert r.negocio({"form_answered": True, "proposal_number": 12, "order_number": 5}, 1) == {
        "form_answered": True, "proposal_number": 12, "order_number": 5}
    erro(r.negocio, {"form_answered": "sim"}, 1)
    erro(r.negocio, {"proposal_number": 0}, 1)
    erro(r.negocio, {"order_number": "PED-1"}, 1)


def test_negocio_chave_de_outro_quadro():
    """shipping_confirmed no quadro 1 não existe na tela de lá."""
    erro(r.negocio, {"shipping_confirmed": "sim"}, 1)
    assert r.negocio({"shipping_confirmed": "sim"}, 2) == {"shipping_confirmed": "sim"}


def test_campos_do_card_recusa_list_id_e_is_deleted_e_converte_data():
    """list_id/is_deleted no PUT moveriam ou apagariam o card sem as travas."""
    for k in ("list_id", "is_deleted", "assigned_to_id", "position", "contact_info"):
        erro(r.campos_do_card, {k: 1})
    out = r.campos_do_card({"due_date": "2026-11-19T10:00", "client_id": 3, "title": " x "})
    assert out == {"due_date": "2026-11-19T13:00:00Z", "client_id": 3, "title": "x"}
    erro(r.campos_do_card, {"person_id": "3"})


def test_atividades_criar_e_limites():
    """Tipo fora da lista ou mais de 5 por cartão voltaria erro só no clique."""
    out = r.atividades([{"op": "criar", "category": "atividade", "activity_type": "call",
                         "title": "Ligar"}], {})
    assert out[0]["priority"] == "normal"
    assert r.atividades([{"op": "criar", "category": "anotacao", "description": "oi"}], {})
    erro(r.atividades, [{"op": "criar", "category": "atividade", "activity_type": "meeting",
                         "title": "x"}], {})
    erro(r.atividades, [{"op": "criar", "category": "x"}], {})
    erro(r.atividades, [{"op": "criar", "category": "anotacao", "description": "a"}] * 6, {})


def test_concluir_exige_valida_e_atividade_do_card():
    """Concluir sem `valida` presumiria resultado; id de outro card concluiria atividade alheia."""
    erro(r.atividades, [{"op": "concluir", "activity_id": 1}], {1: {}})
    assert "pendente" in erro(r.atividades, [{"op": "concluir", "activity_id": 2,
                                              "valida": True}], {1: {}})
    assert r.atividades([{"op": "concluir", "activity_id": 1, "valida": False}], {1: {}}) == [
        {"op": "concluir", "activity_id": 1, "valida": False}]
    erro(r.atividades, [{"op": "concluir", "activity_id": 1, "valida": True}], None)


def test_movimento_uma_etapa_nos_dois_sentidos():
    """Salto de etapa pularia as travas do funil, que o servidor só checa para quem não é admin."""
    assert r.conferir_movimento(card(11), ETAPAS1, 12) == {"de": 11, "para": 12}
    assert r.conferir_movimento(card(12), ETAPAS1, 11) == {"de": 12, "para": 11}
    assert "uma etapa" in erro(r.conferir_movimento, card(10), ETAPAS1, 12)


def test_movimento_recusas():
    """Terminal tem ferramenta própria; etapa de outro quadro ou origem desconhecida é às cegas."""
    assert "ganhar" in erro(r.conferir_movimento, card(13), ETAPAS1, 14)
    assert "perder" in erro(r.conferir_movimento, card(13), ETAPAS1, 15)
    erro(r.conferir_movimento, card(14), ETAPAS1, 13)
    erro(r.conferir_movimento, card(11), ETAPAS1, 90)
    erro(r.conferir_movimento, card(11), ETAPAS1, 11)
    erro(r.conferir_movimento, card(999), ETAPAS1, 12)
    erro(r.conferir_movimento, card(11, 7), ETAPAS1, 12)


def test_terminal_por_nome():
    """Etapa 'Ganho' sem a flag is_done_stage é terminal no HSGrowth; tratá-la como comum
    deixaria mover para ela sem as regras do Ganho."""
    assert "ganhar" in erro(r.conferir_movimento, card(21, 2), ETAPAS2, 22)


def test_ganho_quadro1_pedido():
    """De Aguardando Pedido sem número do pedido o HSGrowth barraria, ou a tela."""
    ok = {"proposal_number": 5, "order_number": 7, "from_collection": "nao"}
    assert r.conferir_ganho(card(13), ETAPAS1, ok) == {"de": 13, "para": 14}
    m = erro(r.conferir_ganho, card(13), ETAPAS1, {"proposal_number": 5, "from_collection": "sim"})
    assert "pedido" in m
    assert "proposta" in erro(r.conferir_ganho, card(13), ETAPAS1,
                              {"order_number": 7, "from_collection": "sim"})


def test_ganho_quadro1_faturamento_direto_e_front_estrito():
    """from_collection é exigido pela tela (modal) mas não pelo servidor: o Guardi segue a tela."""
    ok = {"proposal_number": 5, "closing_type": "faturamento_direto", "from_collection": "sim"}
    assert r.conferir_ganho(card(12), ETAPAS1, ok)["para"] == 14
    assert "from_collection" in erro(r.conferir_ganho, card(12), ETAPAS1,
                                     {"proposal_number": 5, "closing_type": "faturamento_direto"})
    assert "Faturamento direto" in erro(r.conferir_ganho, card(12), ETAPAS1,
                                        {"proposal_number": 5, "closing_type": "pedido",
                                         "from_collection": "sim"})
    assert "só é liberado" in erro(r.conferir_ganho, card(11), ETAPAS1, ok)


def test_ganho_quadro2():
    """Cobrança só ganha em Operações com envio confirmado."""
    assert r.conferir_ganho(card(21, 2), ETAPAS2, {"shipping_confirmed": "sim"}) == {
        "de": 21, "para": 22}
    assert "envio" in erro(r.conferir_ganho, card(21, 2), ETAPAS2, {"shipping_confirmed": "nao"})
    assert "Operações" in erro(r.conferir_ganho, card(20, 2), ETAPAS2, {"shipping_confirmed": "sim"})
    erro(r.conferir_ganho, card(22, 2), ETAPAS2, {"shipping_confirmed": "sim"})
    erro(r.conferir_ganho, card(21, 2), ETAPAS2, None)


def test_motivo_da_perda():
    """Motivo fora da lista (ou o do sistema) quebraria o filtro do kanban."""
    assert r.motivo_da_perda("Sem Conserto") == "Sem Conserto"
    assert "Sem budget aprovado" in erro(r.motivo_da_perda, "porque sim")
    erro(r.motivo_da_perda, "Unificado em outro card")


def test_item_por_alterar_tirar():
    """Item fora do catálogo ou de outro card seria gravado/apagado às cegas."""
    cat = {"aparelho": {1, 2}, "servico": {1, 2}}
    no_card = {"aparelho": {50: {}}, "servico": {60: {}}}
    out = r.item({"tipo": "aparelho", "acao": "por", "product_id": 1, "quantity": 2,
                  "unit_price": 10.5}, cat, no_card)
    assert out["corpo"] == {"product_id": 1, "quantity": 2, "unit_price": 10.5, "discount": 0}
    erro(r.item, {"tipo": "servico", "acao": "por", "service_id": 9, "quantity": 1,
                  "unit_price": 1}, cat, no_card)
    erro(r.item, {"tipo": "servico", "acao": "por", "service_id": 1, "quantity": 0,
                  "unit_price": 1}, cat, no_card)
    erro(r.item, {"tipo": "servico", "acao": "por", "service_id": 1, "quantity": 1}, cat, no_card)
    assert r.item({"tipo": "aparelho", "acao": "tirar", "item_id": 50}, cat, no_card)["item_id"] == 50
    assert "não é" in erro(r.item, {"tipo": "aparelho", "acao": "tirar", "item_id": 99}, cat, no_card)
    erro(r.item, {"tipo": "aparelho", "acao": "alterar", "item_id": 60, "quantity": 2}, cat, no_card)
    erro(r.item, {"tipo": "aparelho", "acao": "alterar", "item_id": 50}, cat, no_card)
    assert r.item({"tipo": "aparelho", "acao": "alterar", "item_id": 50, "quantity": 3},
                  cat, no_card)["corpo"] == {"quantity": 3}


def test_item_tipos_separados_e_falha_fechado():
    """Ids de produto e serviço se repetem: um dict só tiraria o serviço 7 achando que é o
    aparelho 7; catálogo único aceitaria service_id que só existe como produto."""
    cat = {"aparelho": {5}, "servico": {6}}
    no_card = {"aparelho": {7: {}}, "servico": {8: {}}}
    erro(r.item, {"tipo": "servico", "acao": "por", "service_id": 5, "quantity": 1,
                  "unit_price": 1}, cat, no_card)
    erro(r.item, {"tipo": "servico", "acao": "tirar", "item_id": 7}, cat, no_card)
    mesmo = {"aparelho": {7: {}}, "servico": {7: {}}}
    assert r.item({"tipo": "servico", "acao": "tirar", "item_id": 7}, cat, mesmo)["tipo"] == "servico"
    erro(r.item, {"tipo": "servico", "acao": "tirar", "item_id": 8}, cat, {"aparelho": {}})
    erro(r.item, {"tipo": "servico", "acao": "por", "service_id": 6, "quantity": 1,
                  "unit_price": 1}, {"aparelho": {1}}, no_card)
    erro(r.item, {"tipo": "aparelho", "acao": "por", "product_id": 5, "quantity": 1,
                  "unit_price": float("inf")}, cat, no_card)
    erro(r.item, {"tipo": "aparelho", "acao": "por", "product_id": 5, "quantity": 1,
                  "unit_price": float("nan")}, cat, no_card)


def test_negocio_exige_quadro_e_recusa_vazio():
    """Sem quadro a conferência por quadro não rodaria; valor vazio limparia o campo sem querer."""
    with pytest.raises(TypeError):
        r.negocio({"service_type": "ambos"})
    erro(r.negocio, {"service_type": "ambos"}, 7)
    for k, v in (("service_type", ""), ("order_number", None), ("proposal_number", ""),
                 ("form_answered", None), ("closing_type", "")):
        erro(r.negocio, {k: v}, 1)
    erro(r.negocio, {}, 1)


def test_ganho_order_number_em_branco():
    """Número do pedido só com espaços passaria como preenchido."""
    biz = {"proposal_number": 5, "order_number": "   ", "from_collection": "nao"}
    assert "pedido" in erro(r.conferir_ganho, card(13), ETAPAS1, biz)
    biz["order_number"] = None
    assert "pedido" in erro(r.conferir_ganho, card(13), ETAPAS1, biz)


def test_mesmo_cliente():
    """Sem documento não dá para afirmar; comparar com máscara erraria o aviso."""
    assert r.mesmo_cliente("12.345.678/0001-90", "12345678000190") is True
    assert r.mesmo_cliente("12.345.678/0001-90", "99") is False
    assert r.mesmo_cliente(None, "1") is None
    assert r.mesmo_cliente("1", "") is None


def test_texto_em_uma_linha():
    """Texto do HSGrowth com quebra de linha no cartão viraria instrução no prompt."""
    assert "\n" not in r.uma_linha("a\nb\r\nc")
