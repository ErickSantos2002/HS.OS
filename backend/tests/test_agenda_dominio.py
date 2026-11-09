"""Domínio dos lembretes: tetos, validação e isolamento por pessoa.

Conexão falsa, sem banco. O que cada teste tranca custa caro se quebrar: sem o
teto, um agente em laço enche a agenda (e o disparo) de uma pessoa; sem o filtro
por `user_id`, uma pessoa edita ou apaga o lembrete de outra.
"""
import asyncio
import json
from datetime import datetime, timedelta, timezone

import pytest

from app.agenda import dominio as d
from app.agenda.regras import FUSO, RegraInvalida

USER = "11111111-1111-1111-1111-111111111111"
AGORA = datetime(2026, 11, 9, 12, 0, tzinfo=timezone.utc)


class Conn:
    def __init__(self, ativos=0, linha=None):
        self.ativos = ativos
        self.linha = linha
        self.sqls = []

    async def fetchval(self, sql, *a):
        self.sqls.append((sql, a))
        if sql.lstrip().upper().startswith("DELETE"):
            return 1 if self.linha and USER in a else None
        return self.ativos

    async def fetchrow(self, sql, *a):
        self.sqls.append((sql, a))
        if sql.lstrip().upper().startswith("SELECT"):
            # só acha se o filtro por pessoa estiver presente e bater
            return self.linha if self.linha and USER in a else None
        return {**(self.linha or {}), "proximo_em": a[-1] if "proximo_em" in sql else None}

    async def fetch(self, sql, *a):
        self.sqls.append((sql, a))
        return []

    async def execute(self, sql, *a):
        self.sqls.append((sql, a))
        return "DELETE 1" if self.linha else "DELETE 0"


def run(c):
    return asyncio.run(c)


def linha(ativo=True, regra=None, proximo=None):
    return {"id": "abc", "user_id": USER, "agent_id": "erick-bot", "titulo": "t", "instrucao": None,
            "regra": json.dumps(regra or {"tipo": "diario", "hora": "09:00"}), "ativo": ativo,
            "proximo_em": proximo, "criado_por": "pessoa"}


def test_31o_ativo_e_recusado():
    """Sem o teto, um agente em laço cria lembretes sem fim."""
    with pytest.raises(RegraInvalida, match="30"):
        run(d.criar(Conn(ativos=30), USER, "erick-bot", "t", {"tipo": "diario", "hora": "09:00"},
                    None, "guardi", AGORA))


@pytest.mark.parametrize("titulo", ["", "   ", "x" * 201])
def test_titulo_vazio_ou_longo_recusado(titulo):
    """O CHECK do banco estouraria como 500; a recusa tem que sair como mensagem."""
    with pytest.raises(RegraInvalida):
        run(d.criar(Conn(), USER, "erick-bot", titulo, {"tipo": "diario", "hora": "09:00"},
                    None, "pessoa", AGORA))


def test_instrucao_longa_recusada_e_vazia_vira_nula():
    c = Conn()
    with pytest.raises(RegraInvalida):
        run(d.criar(c, USER, "b", "t", {"tipo": "diario", "hora": "09:00"}, "x" * 2001, "pessoa", AGORA))
    run(d.criar(c, USER, "b", "t", {"tipo": "diario", "hora": "09:00"}, "  ", "pessoa", AGORA))
    assert None in c.sqls[-1][1]


def test_criado_por_invalido_e_erro_de_programacao():
    with pytest.raises(ValueError) as e:
        run(d.criar(Conn(), USER, "b", "t", {"tipo": "diario", "hora": "09:00"}, None, "robo", AGORA))
    assert not isinstance(e.value, RegraInvalida)


def test_criar_grava_proximo_em_utc_e_devolve_iso_local():
    r = run(d.criar(Conn(), USER, "b", "t", {"tipo": "diario", "hora": "09:00"}, None, "pessoa", AGORA))
    # 09:00 de Brasília = 12:00 UTC; AGORA já é 12:00 UTC, logo o próximo é amanhã
    assert r["proximo_em"] == "2026-11-10T09:00:00-03:00"


def test_editar_regra_recalcula_proximo():
    c = Conn(linha=linha())
    r = run(d.editar(c, USER, "abc", AGORA, regra={"tipo": "diario", "hora": "18:00"}))
    sql, args = c.sqls[-1]
    assert "proximo_em = $" in sql and "atualizado_em = now()" in sql
    assert datetime(2026, 11, 9, 21, 0, tzinfo=timezone.utc) in args
    assert r["proximo_em"].startswith("2026-11-09T18:00")


def test_editar_de_outra_pessoa_nao_acha():
    """O banco não tem RLS para o service_role: o filtro é só este SQL."""
    c = Conn(linha=linha())
    with pytest.raises(RegraInvalida, match="Lembrete não encontrado."):
        run(d.editar(c, "22222222-2222-2222-2222-222222222222", "abc", AGORA, titulo="x"))
    assert all("user_id = $" in s for s, _ in c.sqls)


def test_apagar_filtra_por_pessoa():
    c = Conn(linha=linha())
    assert run(d.apagar(c, USER, "abc")) is True
    assert "user_id = $" in c.sqls[-1][0]
    assert run(d.apagar(Conn(), USER, "abc")) is False


def test_pausar_mantem_proximo_reativar_recalcula():
    c = Conn(linha=linha(ativo=True))
    run(d.editar(c, USER, "abc", AGORA, ativo=False))
    assert "proximo_em = $" not in c.sqls[-1][0]
    c = Conn(linha=linha(ativo=False))
    run(d.editar(c, USER, "abc", AGORA, ativo=True))
    assert "proximo_em = $" in c.sqls[-1][0]


def test_reativar_respeita_o_teto():
    with pytest.raises(RegraInvalida, match="30"):
        run(d.editar(Conn(ativos=30, linha=linha(ativo=False)), USER, "abc", AGORA, ativo=True))


def test_editar_campo_desconhecido_e_erro_de_programacao():
    with pytest.raises(ValueError):
        run(d.editar(Conn(linha=linha()), USER, "abc", AGORA, agent_id="x"))


def test_listar_com_intervalo_inclui_recorrentes():
    c = Conn()
    run(d.listar(c, USER, AGORA, AGORA + timedelta(days=7)))
    sql, args = c.sqls[-1]
    assert "user_id = $1" in sql and "<> 'unico'" in sql and len(args) == 3


def _update(c):
    [sql] = [q for q, _ in c.sqls if q.lstrip().upper().startswith("UPDATE")]
    return " ".join(sql.split())


def test_editar_horario_ou_ativo_solta_reserva_e_adiamento():
    """Lembrete adiado (`turno_pendente_desde` preenchido) que a pessoa muda de
    horário ou reativa: sem zerar, o novo horário sairia SEM recado — o
    disparador acha que o recado já saiu. E zerar `disparando_em` faz a
    conclusão de uma reserva em curso não pisar na edição (ela exige o carimbo)."""
    for campos in ({"regra": {"tipo": "diario", "hora": "18:00"}}, {"ativo": False}, {"ativo": True}):
        c = Conn(linha=linha(ativo=not campos.get("ativo", False) if "ativo" in campos else True))
        run(d.editar(c, USER, "abc", AGORA, **campos))
        sql = _update(c)
        assert "turno_pendente_desde = NULL" in sql and "disparando_em = NULL" in sql, campos


def test_editar_so_titulo_nao_mexe_na_reserva():
    c = Conn(linha=linha())
    run(d.editar(c, USER, "abc", AGORA, titulo="novo"))
    sql = _update(c)
    assert "disparando_em" not in sql and "turno_pendente_desde" not in sql
