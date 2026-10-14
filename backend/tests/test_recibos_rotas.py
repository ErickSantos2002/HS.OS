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
    for sql in (r.SQL_MARCAR_LIDO, r.SQL_MARCAR_LIDO_THREAD):
        sql = " ".join(sql.split())
        assert "entregue_em = COALESCE(r.entregue_em, now())" in sql
        assert "r.lida_em IS NULL" in sql


def test_abrir_o_canal_nao_le_as_threads():
    """⚠️ Achado da revisão final (I2): abrir o canal marcava como lidas as
    respostas de thread que a pessoa nunca abriu — azul falso para quem
    respondeu. O canal lê só o nível de cima; a thread lê a si mesma."""
    assert "m.thread_id IS NULL" in " ".join(r.SQL_MARCAR_LIDO.split())
    assert "m.thread_id = $3::uuid" in " ".join(r.SQL_MARCAR_LIDO_THREAD.split())


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


def test_dados_da_mensagem_exige_ainda_ser_membro(monkeypatch):
    """O autor que saiu do grupo não pode seguir vendo quem lê lá dentro — o
    detalhe é a mesma janela para o canal que a membresia fecha."""
    from contextlib import asynccontextmanager

    import pytest
    from fastapi import HTTPException

    from app.dependencies import Usuario

    class Conexao:
        async def fetchval(self, sql, *args):
            if "channel_members" in sql:
                return None          # já não é membro
            return "u1"              # mas é o autor

        async def fetch(self, *a):
            raise AssertionError("não devia chegar ao detalhe")

    @asynccontextmanager
    async def falsa(**_):
        yield Conexao()

    monkeypatch.setattr(r, "sessao", falsa)
    with pytest.raises(HTTPException) as erro:
        asyncio.run(r.dados_da_mensagem("c", "m", Usuario(id="u1", email="x@y", papel="colaborador")))
    assert erro.value.status_code == 404


def test_detalhe_nao_expoe_email():
    assert "email" not in r.SQL_DETALHE
