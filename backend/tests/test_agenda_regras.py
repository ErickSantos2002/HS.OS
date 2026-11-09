"""Regras puras de recorrência e validação dos lembretes.

Cada teste tranca um defeito que custaria um lembrete errado: disparar no dia
ou na hora errada, repetir o mesmo instante em loop, ou aceitar uma regra que
o agente inventou e que nunca dispararia.
"""
from datetime import datetime, timedelta, timezone

import pytest

from app.agenda.regras import FUSO, RegraInvalida, proximo, regra_de, validar_regra


def _utc(*args):
    return datetime(*args, tzinfo=FUSO).astimezone(timezone.utc)


def test_semanal_segunda_8h_a_partir_de_domingo():
    """Contar dia da semana errado (0=segunda) mandaria o lembrete no dia errado."""
    agora = datetime(2026, 11, 8, 15, 0, tzinfo=FUSO)  # domingo
    assert proximo({"tipo": "semanal", "dias": [0], "hora": "08:00"}, agora) == _utc(2026, 11, 9, 8, 0)


def test_mensal_dia_31_cai_no_ultimo_dia_do_mes():
    """Sem o recuo, fevereiro pularia o lembrete do dia 31."""
    agora = datetime(2026, 2, 1, 9, 0, tzinfo=FUSO)
    assert proximo({"tipo": "mensal", "dia": 31, "hora": "09:00"}, agora) == _utc(2026, 2, 28, 9, 0)


def test_mensal_passa_para_o_mes_seguinte_e_vira_o_ano():
    agora = datetime(2026, 12, 31, 10, 0, tzinfo=FUSO)
    assert proximo({"tipo": "mensal", "dia": 15, "hora": "09:00"}, agora) == _utc(2027, 1, 15, 9, 0)


def test_dias_uteis_pula_fim_de_semana():
    """Sexta 19h com lembrete às 18h: o próximo é segunda, não sábado."""
    agora = datetime(2026, 11, 6, 19, 0, tzinfo=FUSO)  # sexta
    assert proximo({"tipo": "dias_uteis", "hora": "18:00"}, agora) == _utc(2026, 11, 9, 18, 0)


def test_diario_e_estritamente_depois():
    """Igual ao instante atual não vale: senão o disparador repetiria em loop."""
    agora = datetime(2026, 11, 9, 8, 0, tzinfo=FUSO)
    assert proximo({"tipo": "diario", "hora": "08:00"}, agora) == _utc(2026, 11, 10, 8, 0)


def test_aceita_instante_em_utc():
    agora = datetime(2026, 11, 9, 10, 0, tzinfo=timezone.utc)  # 07h em Brasília
    assert proximo({"tipo": "diario", "hora": "08:00"}, agora) == _utc(2026, 11, 9, 8, 0)


def test_unico_passado_nao_tem_proximo():
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    assert proximo({"tipo": "unico", "em": "2026-11-09T11:00"}, agora) is None


def test_unico_futuro_tem_proximo():
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    assert proximo({"tipo": "unico", "em": "2026-11-10T09:30"}, agora) == _utc(2026, 11, 10, 9, 30)


def test_unico_a_menos_de_5_min_e_recusado():
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra({"tipo": "unico", "em": "2026-11-09T12:03"}, agora)
    validar_regra({"tipo": "unico", "em": "2026-11-09T12:05"}, agora)


def test_unico_a_mais_de_um_ano_e_recusado():
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra({"tipo": "unico", "em": "2027-11-12T12:00"}, agora)


def test_tipo_desconhecido_e_recusado():
    """Um 'a_cada_minuto' aceito viraria o cron de 3 em 3 minutos de 25/08."""
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra({"tipo": "a_cada_minuto"}, agora)


@pytest.mark.parametrize("hora", ["8h", "25:00", "08:60", "", None, 8, "08:00:00"])
def test_hora_mal_formada_e_recusada(hora):
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra({"tipo": "diario", "hora": hora}, agora)


@pytest.mark.parametrize("regra", [
    {"tipo": "diario", "hora": "08:00", "extra": 1},
    {"tipo": "semanal", "hora": "08:00"},
    {"tipo": "semanal", "dias": [], "hora": "08:00"},
    {"tipo": "semanal", "dias": [7], "hora": "08:00"},
    {"tipo": "semanal", "dias": [True], "hora": "08:00"},
    {"tipo": "mensal", "dia": 0, "hora": "08:00"},
    {"tipo": "mensal", "dia": 32, "hora": "08:00"},
    {"tipo": "unico", "em": "09/11/2026 12:00"},
    {"tipo": "unico"},
])
def test_campos_invalidos_sao_recusados(regra):
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra(regra, agora)


def test_normaliza_para_gravar_em_jsonb():
    """dias fora de ordem ou repetidos e hora sem zero gerariam regras 'diferentes' iguais."""
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    assert validar_regra({"tipo": "semanal", "dias": [4, 0, 4], "hora": "8:05"}, agora) == \
        {"tipo": "semanal", "dias": [0, 4], "hora": "08:05"}
    assert validar_regra({"tipo": "mensal", "dia": 5, "hora": "09:00"}, agora) == \
        {"tipo": "mensal", "dia": 5, "hora": "09:00"}


def test_regra_de_exige_exatamente_um():
    """Os dois ou nenhum: o agente precisa ouvir que é um só, em vez de um chute."""
    assert regra_de("2026-11-10T09:00", None) == {"tipo": "unico", "em": "2026-11-10T09:00"}
    rec = {"tipo": "diario", "hora": "08:00"}
    assert regra_de(None, rec) == rec
    with pytest.raises(RegraInvalida, match="só um"):
        regra_de("2026-11-10T09:00", rec)
    with pytest.raises(RegraInvalida, match="só um"):
        regra_de(None, None)


@pytest.mark.parametrize("repetir", ["diario", ["diario"], 5])
def test_regra_de_nao_dict_vira_regra_invalida(repetir):
    """Um erro cru (ValueError/TypeError) escaparia de quem captura só RegraInvalida."""
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra(regra_de(None, repetir), agora)


def test_mensal_no_mesmo_dia_com_hora_passada_vai_para_o_mes_seguinte():
    agora = datetime(2026, 11, 15, 10, 0, tzinfo=FUSO)
    assert proximo({"tipo": "mensal", "dia": 15, "hora": "09:00"}, agora) == _utc(2026, 12, 15, 9, 0)


def test_semanal_no_mesmo_dia_depois_da_hora_vai_para_a_semana_seguinte():
    agora = datetime(2026, 11, 9, 9, 0, tzinfo=FUSO)  # segunda, depois das 08h
    assert proximo({"tipo": "semanal", "dias": [0], "hora": "08:00"}, agora) == _utc(2026, 11, 16, 8, 0)


def test_mensal_dia_31_em_fevereiro_bissexto_e_mes_de_30_dias():
    assert proximo({"tipo": "mensal", "dia": 31, "hora": "09:00"},
                   datetime(2028, 2, 1, 9, 0, tzinfo=FUSO)) == _utc(2028, 2, 29, 9, 0)
    assert proximo({"tipo": "mensal", "dia": 31, "hora": "09:00"},
                   datetime(2026, 4, 1, 9, 0, tzinfo=FUSO)) == _utc(2026, 4, 30, 9, 0)


def test_hora_com_quebra_de_linha_final_e_recusada():
    agora = datetime(2026, 11, 9, 12, 0, tzinfo=FUSO)
    with pytest.raises(RegraInvalida):
        validar_regra({"tipo": "diario", "hora": "08:00\n"}, agora)
