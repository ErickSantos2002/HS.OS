"""Regras puras da varredura do Guardi.

Cada teste tranca um defeito que custaria uma varredura errada: rodar em
feriado, passar do teto de pedidas, aceitar número que o agente inventou ou
chamar de "novidade" um sistema que só voltou do ar com zero.
"""
import json
from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.varredura.regras import (
    CABECALHOS_VARREDURA, FUSO, config, dia_util, feriados, horario, novidade,
    pode_pedir, primeiro_dia_util_da_semana, dia_do_fechamento, validar_numeros, velha,
)


def _local(*a):
    return datetime(*a, tzinfo=FUSO)


def test_feriados_2026():
    f = feriados(2026)
    for d in (date(2026, 2, 16), date(2026, 2, 17), date(2026, 4, 3),
              date(2026, 6, 4), date(2026, 11, 20)):
        assert d in f


def test_sabado_e_feriado_nao_sao_uteis():
    assert not dia_util(date(2026, 11, 14))  # sábado
    assert not dia_util(date(2026, 11, 20))  # feriado
    assert dia_util(date(2026, 11, 16))


def test_config_ausente_e_desligada():
    for v in (None, {}, "lixo"):
        c = config(v)
        assert c.ligada is False
        assert (c.manha.hour, c.manha.minute) == (7, 30)
        assert (c.tarde.hour, c.tarde.minute) == (13, 30)
        assert (c.quadro.hour, c.quadro.minute) == (8, 30)


def test_config_so_liga_com_true_literal_e_campo_ruim_volta_ao_padrao():
    assert config({"ligada": "true"}).ligada is False
    c = config({"ligada": True, "manha": "07:45", "tarde": "25:99"})
    assert c.ligada is True
    assert (c.manha.hour, c.manha.minute) == (7, 45)
    assert (c.tarde.hour, c.tarde.minute) == (13, 30)


def test_horario_0730_vira_1030_utc():
    h = horario(config(None), "manha", date(2026, 11, 16))
    assert h == datetime(2026, 11, 16, 10, 30, tzinfo=timezone.utc)
    assert h.utcoffset() == timedelta(0)


def test_manha_velha_depois_do_meio_dia():
    ref = datetime(2026, 11, 16, 10, 30, tzinfo=timezone.utc)
    assert not velha("manha", ref, _local(2026, 11, 16, 11, 59))
    assert velha("manha", ref, _local(2026, 11, 16, 12, 0))
    assert velha("tarde", horario(config(None), "tarde", date(2026, 11, 16)),
                 _local(2026, 11, 16, 17, 0))
    assert velha("quadro", ref, _local(2026, 11, 16, 11, 0))
    assert not velha("pedida", ref, _local(2026, 11, 16, 23, 0))


def test_terceira_pedida_recusada():
    agora = _local(2026, 11, 16, 15, 0)
    ok, motivo = pode_pedir([agora - timedelta(hours=3), agora - timedelta(hours=2)], agora)
    assert not ok and motivo


def test_pedida_com_menos_de_30_min_recusada():
    agora = _local(2026, 11, 16, 15, 0)
    ok, motivo = pode_pedir([agora - timedelta(minutes=10)], agora)
    assert not ok and motivo
    ok, _ = pode_pedir([agora - timedelta(minutes=31)], agora)
    assert ok
    assert pode_pedir([], agora)[0]


def test_validar_recusa_sistema_desconhecido_com_exemplo():
    """Descartar em silêncio custou a 1ª varredura real (16/11/2026): o Guardi
    mandou as contagens noutro formato, tudo sumiu e gravou `numeros: {}` — o
    quadro da Nina ficou sem totais e a tarde nunca acharia novidade. Recusar
    com o exemplo faz o agente corrigir e chamar de novo."""
    with pytest.raises(ValueError) as e:
        validar_numeros({"taskhs": {"atrasadas": 2}, "banco": {"x": 1}})
    assert "banco" in str(e.value) and '"taskhs"' in str(e.value)


def test_validar_recusa_numeros_vazios():
    with pytest.raises(ValueError) as e:
        validar_numeros({})
    assert '"email"' in str(e.value)


def test_validar_aceita_so_falhas():
    assert validar_numeros({"falhas": ["taskhs"]}) == {"falhas": ["taskhs"]}


def test_validar_aceita_formato_do_exemplo():
    from app.varredura.regras import EXEMPLO_NUMEROS
    assert validar_numeros(json.loads(EXEMPLO_NUMEROS))["email"] == {"nao_lidos_3d": 4}


def test_validar_recusa_negativo():
    with pytest.raises(ValueError):
        validar_numeros({"taskhs": {"atrasadas": -1}})


def test_validar_recusa_forma_invalida():
    for ruim in ({"taskhs": {"Atrasadas": 1}}, {"taskhs": {"a": 1.5}},
                 {"taskhs": {"a": True}}, {"taskhs": {f"k{i}": 1 for i in range(9)}},
                 {"falhas": ["banco"]}, {"taskhs": [1]}):
        with pytest.raises(ValueError):
            validar_numeros(ruim)
    assert validar_numeros({"falhas": ["email"]}) == {"falhas": ["email"]}


def test_novidade_quando_atrasadas_sobe():
    assert novidade({"taskhs": {"atrasadas": 2}}, {"taskhs": {"atrasadas": 3}}) == (
        True, ["taskhs.atrasadas: 2 → 3"])


def test_sem_novidade_quando_igual_ou_menor():
    assert novidade({"taskhs": {"atrasadas": 3}}, {"taskhs": {"atrasadas": 3}}) == (False, [])
    assert novidade({"taskhs": {"atrasadas": 3}}, {"taskhs": {"atrasadas": 1}}) == (False, [])


def test_sistema_que_voltou_com_zero_nao_e_novidade():
    m = {"falhas": ["email"]}
    t = {"email": {"nao_lidos": 0}}
    assert novidade(m, t) == (False, [])


def test_sistema_que_voltou_com_pendencia_e_novidade():
    m = {"falhas": ["email"]}
    t = {"email": {"nao_lidos": 4}}
    ha, frases = novidade(m, t)
    assert ha and frases


def test_sistema_que_falhou_a_tarde_nao_gera_novidade():
    m = {"taskhs": {"atrasadas": 1}}
    t = {"taskhs": {"atrasadas": 9}, "falhas": ["taskhs"]}
    assert novidade(m, t) == (False, [])


def test_sem_manha_e_novidade():
    assert novidade(None, {"taskhs": {"atrasadas": 0}}) == (True, ["primeira do dia"])


def test_sistemas_faltando_aponta_ligado_que_nao_veio():
    """2ª varredura real (16/11/2026): o Guardi pulou CRM e GestorHS em
    silêncio — nem contou, nem pôs em `falhas`. O servidor cobra: sistema
    ligado tem de vir contado ou declarado como falha."""
    from app.varredura.regras import sistemas_faltando
    ligados = ["taskhs", "gestorhs", "hsgrowth_servicos", "datacore"]
    n = {"taskhs": {"abertas": 4}, "email": {"nao_lidos_3d": 3}}
    assert sistemas_faltando(n, ligados, email_ligado=True) == ["hsgrowth"]
    n["falhas"] = ["hsgrowth"]
    assert sistemas_faltando(n, ligados, email_ligado=True) == []
    assert sistemas_faltando({"taskhs": {"a": 1}}, ["taskhs"], email_ligado=True) == ["email"]
    assert sistemas_faltando({"taskhs": {"a": 1}}, ["taskhs"], email_ligado=False) == []


def test_nao_ligado_sai_dos_numeros_e_das_falhas():
    """1º dia automático (17–18/11/2026): 14 de 19 Guardis puseram `hsgrowth`
    em `falhas` sem ter o HSGrowth ligado, e o quadro da Nina dizia que o CRM
    caiu para 14 pessoas. Dois ainda mandaram CONTAGEM do HSGrowth, que nenhuma
    ferramenta deles devolve — número inventado. O servidor sabe o que está
    ligado: sistema fora do alcance sai das contagens e das falhas, e o Guardi
    é avisado do que foi ignorado."""
    from app.varredura.regras import separar_nao_ligados
    n = {"taskhs": {"abertas": 2}, "hsgrowth": {"tarefas_atrasadas": 9},
         "email": {"nao_lidos_3d": 0}, "falhas": ["hsgrowth", "email", "taskhs"]}
    limpo, fora = separar_nao_ligados(n, ["taskhs"], email_ligado=False)
    assert fora == ["email", "hsgrowth"]
    assert limpo == {"taskhs": {"abertas": 2}, "falhas": ["taskhs"]}
    assert n["falhas"] == ["hsgrowth", "email", "taskhs"]  # não muta a entrada


def test_hsgrowth_servicos_conta_como_hsgrowth_ligado():
    """Ellen e Leticia têm `hsgrowth_servicos`: a chave da varredura é
    `hsgrowth`, e ela NÃO pode ser descartada como não ligada."""
    from app.varredura.regras import separar_nao_ligados
    n = {"hsgrowth": {"cards_parados": 1}, "falhas": ["hsgrowth"]}
    limpo, fora = separar_nao_ligados(n, ["hsgrowth_servicos"], email_ligado=False)
    assert fora == [] and limpo == n


def test_separar_deixa_forma_ruim_para_o_validador():
    """Chave desconhecida e `falhas` fora de lista não são assunto daqui:
    seguem intactas para `validar_numeros` recusar com o exemplo."""
    from app.varredura.regras import separar_nao_ligados
    n = {"a": 1, "falhas": "hsgrowth"}
    assert separar_nao_ligados(n, [], email_ligado=False) == (n, [])


# ── Briefing semanal financeiro do Midas (18/11/2026) ─────────────────────────

def test_primeiro_dia_util_da_semana():
    """A semana financeira sai uma vez por semana ISO, no primeiro dia útil.
    Semana de Carnaval começa na quarta: segunda e terça não são úteis."""
    assert primeiro_dia_util_da_semana(date(2026, 11, 23))        # segunda
    assert not primeiro_dia_util_da_semana(date(2026, 11, 24))
    assert primeiro_dia_util_da_semana(date(2027, 2, 10))         # quarta de cinzas
    assert not primeiro_dia_util_da_semana(date(2027, 2, 8))      # segunda de Carnaval
    assert not primeiro_dia_util_da_semana(date(2026, 11, 22))    # domingo


def test_config_financeiro_padrao_e_lido():
    assert config({}).financeiro == time(8)
    assert config({"financeiro": "07:45"}).financeiro == time(7, 45)
    assert config({"financeiro": "25:00"}).financeiro == time(8)


def test_financeiro_envelhece_as_11():
    """Briefing de caixa da semana chegando à tarde já não serve à reunião da
    manhã: passou das 11h locais, é `pulada`."""
    ref = horario(config(None), "financeiro", date(2026, 11, 23))
    assert ref == datetime(2026, 11, 23, 11, 0, tzinfo=timezone.utc)  # 08:00 local
    assert not velha("financeiro", ref, _local(2026, 11, 23, 10, 59))
    assert velha("financeiro", ref, _local(2026, 11, 23, 11, 0))


def test_cabecalho_financeiro_e_reconhecido_como_varredura():
    """O `/recuperar` só trata sem recuo a janela que abre com um cabeçalho
    conhecido; sem o financeiro na lista, a narração viraria mensagem."""
    assert "[Semana financeira — " in CABECALHOS_VARREDURA


def test_dia_do_fechamento_e_o_primeiro_util_a_partir_do_25():
    """O fechamento do mês anterior sai no 1º dia útil a partir do dia 25, não no
    dia 16: medido em 19/11/2026, do que hoje está lançado, só 1,1% de setembro
    existia no dia 15 de outubro, e 91,6% no dia 25 (outubro: 82,7% × 100%). A
    meta de "tudo até o dia 15" que o Financeiro deu não se cumpre."""
    assert dia_do_fechamento(date(2026, 11, 25))            # quarta
    assert not dia_do_fechamento(date(2026, 11, 24))
    assert not dia_do_fechamento(date(2026, 11, 26))        # só um por mês
    assert dia_do_fechamento(date(2026, 10, 26))            # 25/10 é domingo
    assert not dia_do_fechamento(date(2026, 10, 25))
    assert dia_do_fechamento(date(2026, 12, 28))            # 25/12 Natal, 26–27 fim de semana


def test_gestorhs_saiu_da_varredura():
    """23/11/2026: a varredura pedia `gestorhs.minhas_os`, mas a OS do GestorHS
    não tem responsável — não existe "minhas OS". Com o GestorHS ligado nos 23
    Guardis, cada um improvisou: 17 escreveram 0, dois mandaram totais (66 e
    31, nada a ver com o dono) e três marcaram `falhas` todo dia — o quadro da
    Nina dizia "GestorHS fora" para quem o lia sem problema. Pendência pessoal
    no GestorHS não existe; o sistema saiu da varredura (decisão do Erick).

    O Guardi com sessão antiga ainda manda a chave: ela é descartada em
    silêncio, sem recusar e sem virar "não ligado"."""
    from app.varredura.regras import (EXEMPLO_NUMEROS, SISTEMAS, sem_aposentados,
                                      sistemas_faltando)
    assert "gestorhs" not in SISTEMAS and "gestorhs" not in EXEMPLO_NUMEROS
    assert sistemas_faltando({"taskhs": {"a": 1}}, ["taskhs", "gestorhs"], email_ligado=False) == []
    n = {"taskhs": {"abertas": 1}, "gestorhs": {"minhas_os": 66}, "falhas": ["gestorhs", "email"]}
    assert sem_aposentados(n) == {"taskhs": {"abertas": 1}, "falhas": ["email"]}
    assert n["falhas"] == ["gestorhs", "email"]  # não muta a entrada
    assert sem_aposentados({"taskhs": {"a": 1}}) == {"taskhs": {"a": 1}}
