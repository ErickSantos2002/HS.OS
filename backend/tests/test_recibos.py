"""Regras do visto por mensagem (spec 2026-10-14).

O estado que a bolha mostra é decidido aqui, sem banco. Errar aqui é mentir
para quem mandou a mensagem — o caso mais caro é o azul que nunca acende.
"""
from datetime import datetime, timedelta, timezone

from app.recibos import JANELA_DO_RUN, eh_uuid, estado_no_agente, estado_no_canal

AGORA = datetime(2026, 10, 14, 12, 0, tzinfo=timezone.utc)


def test_canal_sem_destinatario_e_enviada():
    """Canal só comigo, ou só com agentes: não há quem receba, e "lida" seria mentira."""
    assert estado_no_canal(0, 0, 0) == "enviada"


def test_canal_todos_leram_e_lida():
    assert estado_no_canal(3, 3, 3) == "lida"


def test_canal_azul_so_quando_todos_leram():
    """No grupo, uma pessoa que não leu segura o azul — igual ao WhatsApp."""
    assert estado_no_canal(3, 3, 2) == "entregue"


def test_canal_cinza_so_quando_todos_receberam():
    assert estado_no_canal(3, 2, 0) == "enviada"


def test_canal_lida_implica_entregue_mesmo_com_contagem_inconsistente():
    """Lida sem entregue não deveria existir, mas se existir o azul vence."""
    assert estado_no_canal(2, 1, 2) == "lida"


def test_agente_com_resposta_depois_e_lida_mesmo_sem_run():
    """⚠️ O `/recuperar` grava a resposta sem preencher o run. Pela regra antiga
    (azul = run com message_id), 74 de 140 respostas de uma semana ficariam ⚠."""
    assert estado_no_agente(True, None, AGORA) == "lida"
    assert estado_no_agente(True, AGORA - timedelta(hours=5), AGORA) == "lida"


def test_agente_run_recente_sem_resposta_e_entregue():
    assert estado_no_agente(False, AGORA - timedelta(minutes=2), AGORA) == "entregue"


def test_agente_run_velho_sem_resposta_falhou():
    assert estado_no_agente(False, AGORA - JANELA_DO_RUN - timedelta(seconds=1), AGORA) == "falhou"


def test_agente_sem_run_e_enviada():
    """Gravou mas o `/send` não chegou ao gateway (ou é anterior à migração)."""
    assert estado_no_agente(False, None, AGORA) == "enviada"


def test_eh_uuid():
    assert eh_uuid("6f1c2c8e-8a3e-4b8e-9a51-0d4f2d1e7a10")
    assert not eh_uuid("m1739999-fileop")
    assert not eh_uuid(None)
