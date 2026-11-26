"""Etiqueta dos cards do TaskHS nas ferramentas do Guardi (26/11/2026).

O Gustavo (Qualidade) pediu ao Guardi um relatório diário com a quantidade de
cards da etiqueta "SEM NOTA DE REMESSA" no quadro Serviço e há quanto tempo cada
um está parado. A API do TaskHS sempre mandou as etiquetas (`labels` no card do
snapshot), mas o `taskhs_quadro` só repassava título e prazo — o Guardi não tinha
como ver etiqueta e ia contar pelo TÍTULO, "( SEM NF DE REMESSA )", que é outra
coisa e daria ao Gustavo um número errado. Ele mesmo recusou fazer isso e avisou.

O tempo parado vem do `/dashboard` do TaskHS (a régua da Qualidade), nunca
recalculado aqui — o número do Guardi e o da tela não podem divergir.
"""
from app.routers import mcp_bot as mb


def _card(id_, title, *etiquetas, lista=10, criado="2026-11-03T12:00:00+00:00"):
    return {"id": id_, "list_id": lista, "title": title, "due_date": None, "created_at": criado,
            "labels": [{"id": n, "label": e, "color": "red"} for n, e in enumerate(etiquetas)]}


SNAP = {
    "board": {"id": 136, "title": "Serviço"},
    "lists": [{"id": 10, "title": "Entrada"}, {"id": 11, "title": "Laboratório"}],
    "labels": [{"id": 1, "name": "SEM NOTA DE REMESSA"}, {"id": 2, "name": "COLETA"}],
    "cards_by_list": {
        "10": [_card(668, "cx 318 Rota", "SEM NOTA DE REMESSA", "COLETA"), _card(669, "cx 405 Tietê")],
        "11": [_card(670, "( SEM NF DE REMESSA ) cx 350", lista=11),
               _card(671, "OS 8877", "Sem Nota de Remessa", lista=11)],
    },
}

DASH = {
    "atrasados": [{"card_id": 668, "horas_uteis": 120.0}, {"card_id": 669, "horas_uteis": 90.0}],
    "travados_setor": [{"card_id": 671, "horas_uteis": 30.0}],
}


def test_quadro_mostra_as_etiquetas_de_cada_card():
    """Sem etiqueta na listagem o Guardi não tem como saber que ela existe."""
    t = mb.texto_quadro(SNAP)
    assert "card 668 | cx 318 Rota | prazo — | etiquetas: SEM NOTA DE REMESSA, COLETA" in t
    assert "card 669 | cx 405 Tietê | prazo —" in t and "card 669 | cx 405 Tietê | prazo — | etiquetas" not in t


def test_filtro_por_etiqueta_conta_pela_etiqueta_nao_pelo_titulo():
    """O card 670 tem "SEM NF DE REMESSA" no TÍTULO e nenhuma etiqueta: não
    entra. O 671 tem a etiqueta com outra caixa: entra."""
    t = mb.texto_quadro(SNAP, etiqueta="sem nota de remessa", dash=DASH)
    assert t.startswith("2 card(s) com a etiqueta \"SEM NOTA DE REMESSA\" no quadro 'Serviço'")
    assert "card 668" in t and "card 671" in t and "card 670" not in t and "card 669" not in t


def test_tempo_parado_vem_do_dashboard():
    """Mesma régua da tela: 72 h úteis desde a criação e 24 h úteis na lista."""
    t = mb.texto_quadro(SNAP, etiqueta="SEM NOTA DE REMESSA", dash=DASH)
    l668 = next(l for l in t.splitlines() if "card 668" in l)
    l671 = next(l for l in t.splitlines() if "card 671" in l)
    assert "lista 10 'Entrada'" in l668 and "120 h úteis" in l668 and "desde a criação" in l668
    assert "30 h úteis na mesma lista" in l671
    assert "dentro das réguas" in l671 or "desde a criação" not in l671


def test_card_dentro_da_regua_diz_isso_sem_inventar_numero():
    """Card que não está no dashboard não está parado pela régua — o Guardi
    tem que dizer isso, não estimar horas."""
    t = mb.texto_quadro(SNAP, etiqueta="SEM NOTA DE REMESSA", dash={"atrasados": [], "travados_setor": []})
    assert t.count("dentro das réguas de parado") == 2 and "h úteis" not in t


def test_sem_dashboard_avisa_que_o_tempo_nao_veio():
    """Quem não é administrador nem coordenador no TaskHS não vê as réguas: a
    contagem sai, e o tempo vem com o motivo de não ter vindo."""
    t = mb.texto_quadro(SNAP, etiqueta="SEM NOTA DE REMESSA", dash=None)
    assert t.startswith("2 card(s)") and "tempo parado não disponível" in t


def test_etiqueta_inexistente_lista_as_do_quadro():
    """Nome errado não pode virar "0 cards" — o Guardi diria ao Gustavo que
    não há nenhum. Diz que a etiqueta não existe e mostra as que existem."""
    t = mb.texto_quadro(SNAP, etiqueta="sem nota fiscal", dash=DASH)
    assert "não existe" in t and "SEM NOTA DE REMESSA" in t and "COLETA" in t and "card(s) com" not in t


def test_etiqueta_existente_sem_card_e_zero_de_verdade():
    t = mb.texto_quadro(SNAP, etiqueta="COLETA ", dash=DASH)
    assert t.startswith("1 card(s)")
    snap = {**SNAP, "labels": SNAP["labels"] + [{"id": 3, "name": "Garantia"}]}
    assert mb.texto_quadro(snap, etiqueta="garantia", dash=DASH).startswith("0 card(s)")


def test_ferramentas_anunciam_a_etiqueta():
    """O Guardi só usa o filtro se a descrição disser que ele existe — e que é
    por ele, não pelo título, que se conta."""
    f = next(x for x in mb.FERRAMENTAS if x["name"] == "taskhs_quadro") if hasattr(mb, "FERRAMENTAS") else None
    texto = str(f) if f else str([x for x in vars(mb).values() if isinstance(x, list)])
    assert "etiqueta" in texto and "nunca o texto do título" in texto
