"""Backup que falha tem que avisar alguém (26/11/2026).

⚠️ **O que custou:** o `pg_dump` diário do banco do HS.OS falhou TODO DIA de
08/09 a 26/11/2026 — 80 dias sem cópia — e a única pessoa que descobriria era
quem fosse restaurar. Cada falha deixava um arquivo de 0 byte que, na listagem,
parecia backup. Achado por acaso, escrevendo o plano de emergência.

⚠️ **O caso que mais importa é a AUSÊNCIA de registro, não o registro de falha.**
Script que nem roda (timer desligado, container renomeado, máquina fora) não
grava nada. Um alarme que só reagisse a `ok = false` ficaria tão calado quanto
o backup. Por isso o veredito olha a idade do último sucesso: mais de 26 h sem
backup bom é alerta, com ou sem linha de falha.
"""
from datetime import datetime, timedelta, timezone

from app import guardiao_backups as g

AGORA = datetime(2026, 11, 27, 9, 0, tzinfo=timezone.utc)


def _linha(ok: bool, horas_atras: float, detalhe: str = "") -> dict:
    return {"ok": ok, "em": AGORA - timedelta(hours=horas_atras), "detalhe": detalhe}


def test_backup_de_hoje_que_deu_certo_nao_alerta():
    assert g.veredito("banco-hsos", _linha(True, 6), AGORA - timedelta(hours=6), AGORA) is None


def test_ultima_execucao_falhou_alerta_com_o_motivo():
    v = g.veredito("banco-hsos", _linha(False, 6, "permission denied for sequence x"),
                   AGORA - timedelta(hours=30), AGORA)
    assunto, detalhe, gravidade = v
    assert gravidade == "atencao"
    assert "falhou" in assunto.lower()
    assert "permission denied for sequence x" in detalhe


def test_sem_registro_nenhum_alerta():
    """O modo de falha dos 80 dias visto daqui: nada gravado, nunca."""
    v = g.veredito("gateway", None, None, AGORA)
    assert v is not None and v[2] == "atencao"


def test_sucesso_velho_sem_falha_registrada_alerta():
    """O script parou de rodar: a última linha é um sucesso de dois dias atrás."""
    v = g.veredito("gateway", _linha(True, 49), AGORA - timedelta(hours=49), AGORA)
    assert v is not None
    assert "49" in v[1]


def test_falha_isolada_apos_sucesso_recente_tambem_alerta():
    """Uma falha já é para olhar — esperar a segunda é aceitar mais um dia sem cópia."""
    v = g.veredito("banco-hsos", _linha(False, 1), AGORA - timedelta(hours=20), AGORA)
    assert v is not None


def test_prazo_tem_folga_sobre_um_dia():
    """O timer tem `RandomizedDelaySec`: o backup de hoje pode sair minutos depois
    do de ontem. 26 h é folga sobre isso sem virar dois dias."""
    assert timedelta(hours=24) < g.PRAZO <= timedelta(hours=27)
    assert g.veredito("banco-hsos", _linha(True, 25), AGORA - timedelta(hours=25), AGORA) is None


def test_assunto_cabe_no_limite_do_mcp_alerta():
    for origem in g.ORIGENS:
        for v in (g.veredito(origem, None, None, AGORA),
                  g.veredito(origem, _linha(False, 1, "x" * 900), None, AGORA)):
            assert len(v[0]) <= 60
            assert len(v[1]) <= 1500


def test_toda_origem_tem_nome_legivel():
    assert set(g.ORIGENS) == {"banco-hsos", "gateway"}
    assert all(g.ORIGENS.values())


def test_chave_de_reserva_e_uma_por_origem_por_dia_em_brasilia():
    """Um alerta por origem por dia: o laço roda a cada meia hora em dois
    workers, e sem teto o administrador receberia 96 avisos do mesmo defeito.
    O dia é o de Brasília — 23h de São Paulo já é amanhã em UTC."""
    tarde = datetime(2026, 11, 27, 2, 30, tzinfo=timezone.utc)   # 23:30 de 26/11 em BRT
    assert g.chave_reserva("gateway", tarde) == "backup_alerta:gateway:2026-11-26"
    assert g.chave_reserva("banco-hsos", AGORA) != g.chave_reserva("gateway", AGORA)


def test_registro_recusa_origem_desconhecida():
    import pytest
    from pydantic import ValidationError
    from app.routers.backups import RegistroIn
    with pytest.raises(ValidationError):
        RegistroIn(origem="qualquer", ok=True)
    # O token da rota mora na VPS do gateway, onde agentes têm `exec`: com ele
    # não pode dar para gravar "ok" pelo banco e calar o alarme do banco.
    with pytest.raises(ValidationError):
        RegistroIn(origem="banco-hsos", ok=True)
    assert RegistroIn(origem="gateway", ok=False, detalhe="y" * 5000).detalhe_curto() == "y" * 500
