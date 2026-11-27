"""Limpar conversa — o "Apagar para mim" da conversa inteira (27/11/2026).

Pedido de quem usa as DMs: a única saída era apagar mensagem por mensagem.
Some só para quem limpou, como no WhatsApp; o outro lado continua com o
histórico. Por isso o caminho é o mesmo da 022 (`mensagens_ocultas`), que todas
as leituras já filtram — um filtro novo seria uma leitura esquecida.
"""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.routers import channels as c

QUANDO = datetime(2026, 11, 27, 12, tzinfo=timezone.utc)


class Conexao:
    def __init__(self, linha):
        self.linha = linha
        self.sqls: list[tuple[str, tuple]] = []

    async def fetchrow(self, sql, *args):
        self.sqls.append((sql, args))
        return self.linha

    async def fetchval(self, sql, *args):
        self.sqls.append((sql, args))
        return self.linha

    async def execute(self, sql, *args):
        self.sqls.append((sql, args))


def _chamar(monkeypatch, linha, rota, *extra):
    conn = Conexao(linha)

    @asynccontextmanager
    async def falsa(**kw):
        conn.sessao = kw
        yield conn

    monkeypatch.setattr(c, "sessao", falsa)
    usuario = Usuario(id="lara", email="x@y", papel="colaborador")
    return conn, lambda: asyncio.run(rota("canal", *extra, usuario))


def test_limpar_esconde_tudo_em_nome_de_quem_pediu(monkeypatch):
    conn, chamar = _chamar(monkeypatch, {"limpo_em": QUANDO, "quantas": 7}, c.limpar_conversa)
    r = chamar()
    sql, args = conn.sqls[0]
    assert "mensagens_ocultas" in sql and "lara" in args
    # Respostas de thread também: limpar e a thread continuar lá seria meia limpeza.
    assert "thread_id" not in sql
    assert conn.sessao == {"role": "authenticated", "user_id": "lara"}
    assert r.quantas == 7


def test_limpar_so_vale_para_dm_e_grupo(monkeypatch):
    conn, chamar = _chamar(monkeypatch, {"limpo_em": QUANDO, "quantas": 0}, c.limpar_conversa)
    chamar()
    sql = conn.sqls[0][0]
    assert "'dm'" in sql and "'public'" in sql and "'private'" in sql and "pessoal" not in sql


def test_limpar_marca_as_notificacoes_do_canal_como_lidas(monkeypatch):
    """Conversa limpa com contador de não lidas seria número sem mensagem."""
    conn, chamar = _chamar(monkeypatch, {"limpo_em": QUANDO, "quantas": 3}, c.limpar_conversa)
    chamar()
    assert any("notifications" in s and "read = true" in s for s, _ in conn.sqls)


def test_canal_que_nao_e_meu_ou_nao_e_dm_nem_grupo_e_404(monkeypatch):
    _, chamar = _chamar(monkeypatch, None, c.limpar_conversa)
    with pytest.raises(HTTPException) as erro:
        chamar()
    assert erro.value.status_code == 404


def test_desfazer_tira_so_aquele_lote(monkeypatch):
    conn, chamar = _chamar(monkeypatch, 7, c.desfazer_limpar_conversa,
                           c.DesfazerLimparIn(limpo_em=QUANDO))
    chamar()
    sql, args = conn.sqls[0]
    assert "DELETE FROM public.mensagens_ocultas" in sql and "criado_em" in sql
    assert QUANDO in args and "lara" in args
