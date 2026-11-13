"""Horário que o Guardi fala é o de Brasília, convertido no servidor.

⚠️ 13/11/2026: os Guardis diziam a hora de card, e-mail e tarefa três horas
adiantada — repetiam o UTC dos sistemas. Cada caso abaixo é um formato real
visto no retorno de um sistema nosso.
"""
from app.fuso import em_brasilia


def test_utc_explicito_vira_brasilia():
    assert em_brasilia("criado 2026-11-13T12:38:44.311090Z") == "criado 13/11/2026 09:38"   # TaskHS/DocsHS
    assert em_brasilia("2026-11-13T12:38:44+00:00") == "13/11/2026 09:38"
    assert em_brasilia("2026-11-13T09:38:00-03:00") == "13/11/2026 09:38"                      # já Brasília


def test_virada_do_dia():
    assert em_brasilia("2026-11-14T01:30:00Z") == "13/11/2026 22:30"


def test_meia_noite_utc_e_data_nao_instante():
    """O GestorHS grava data como `T00:00:00Z`: converter daria 21:00 da véspera."""
    assert em_brasilia("entrada 2026-11-12T00:00:00Z") == "entrada 12/11/2026"


def test_sem_fuso_so_onde_se_sabe_que_e_utc():
    assert em_brasilia("2026-02-09T19:43:05.182973") == "2026-02-09T19:43:05.182973"   # quem não sabe, não mexe
    assert em_brasilia("2026-02-09T19:43:05.182973", sem_fuso_e_utc=True) == "09/02/2026 16:43"  # HSGrowth


def test_nao_mexe_no_que_nao_e_carimbo():
    for t in ("OS 2026-11-12", "versão 2026-10-28.1", "id 12345678901234", "2026-13-45T99:99Z"):
        assert em_brasilia(t) == t
