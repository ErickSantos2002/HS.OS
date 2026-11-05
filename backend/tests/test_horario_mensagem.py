"""Mensagem da pessoa é carimbada pelo SERVIDOR, não pelo relógio do PC.

⚠️ 05/11/2026: os PCs do Welton e do Gustavo estavam ~66 s atrasados. A
resposta do bot leva o horário do servidor; a mensagem seguinte da pessoa
levava o do PC dela — e ficava gravada ANTES da resposta que ela tinha acabado
de ler, aparecendo acima dela na tela (inclusive depois do F5).
"""
import asyncio
from datetime import datetime, timedelta, timezone

from app.dependencies import Usuario
from app.routers import conversations as conv


class Conn:
    def __init__(self):
        self.args = None

    async def fetchrow(self, sql, *a):
        self.sql, self.args = sql, a
        return {"id": "1", "agent_id": "welton-bot", "role": "user", "content": "x", "media": None,
                "created_at": datetime.now(timezone.utc).isoformat()}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


def test_mensagem_de_pessoa_ignora_o_relogio_do_navegador(monkeypatch):
    c = Conn()
    monkeypatch.setattr(conv, "sessao", lambda **k: c)
    atrasado = (datetime.now(timezone.utc) - timedelta(seconds=66)).isoformat()
    corpo = conv.MensagemIn(role="user", content="Ótimo, agora envia", created_at=atrasado)
    asyncio.run(conv.anexar("welton-bot", corpo, Usuario("u", "e@x.com", "colaborador")))
    assert c.args[-1] is None   # created_at do navegador descartado → now() do banco
