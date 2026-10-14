"""Rotas do visto nos canais (spec 2026-10-14) — o que dá para trancar sem banco.

A regra de estado está em `app/recibos.py`; aqui se tranca o que o SQL precisa
garantir para a regra receber os números certos.
"""
import asyncio

from app.routers import recibos as r


def test_mapa_de_estados_aplica_a_regra_por_mensagem():
    linhas = [
        {"id": "a", "destinatarios": 2, "entregues": 2, "lidas": 2},
        {"id": "b", "destinatarios": 2, "entregues": 2, "lidas": 1},
        {"id": "c", "destinatarios": 2, "entregues": 1, "lidas": 0},
        {"id": "d", "destinatarios": 0, "entregues": 0, "lidas": 0},
    ]
    assert r._mapa_de_estados(linhas) == {
        "a": "lida", "b": "entregue", "c": "enviada", "d": "enviada",
    }


def test_estados_contam_so_membros_atuais_e_humanos():
    """Sem o filtro por membro atual, quem saiu do grupo deixaria o recibo dele
    para sempre sem `lida_em` — e o azul daquela mensagem nunca acenderia."""
    sql = " ".join(r.SQL_ESTADOS.split())
    assert "public.channel_members cm" in sql
    assert "cm.member_type = 'human'" in sql
    assert "cm.user_id = r.user_id::text" in sql


def test_estados_so_das_minhas_mensagens_humanas():
    """O visto é de quem mandou. Devolver o estado da mensagem alheia diria a uma
    pessoa quem leu o que outra escreveu."""
    sql = " ".join(r.SQL_ESTADOS.split())
    assert "m.author_id = $2" in sql
    assert "m.author_type::text = 'human'" in sql


def test_marcar_lido_tambem_entrega_e_nao_reescreve_horario():
    """Lida sem entregue é estado impossível — mostraria azul e "Aguardando" juntos
    no "Dados da mensagem". E reler não pode mover o horário da primeira leitura."""
    sql = " ".join(r.SQL_MARCAR_LIDO.split())
    assert "entregue_em = COALESCE(r.entregue_em, now())" in sql
    assert "r.lida_em IS NULL" in sql


def test_detalhe_so_de_membros_atuais():
    sql = " ".join(r.SQL_DETALHE.split())
    assert "cm.member_type = 'human'" in sql


class ConexaoFalsa:
    def __init__(self, valor):
        self.valor = valor

    async def fetchval(self, sql, *args):
        return self.valor


def test_membro():
    assert asyncio.run(r._membro(ConexaoFalsa(1), "c", "u")) is True
    assert asyncio.run(r._membro(ConexaoFalsa(None), "c", "u")) is False
