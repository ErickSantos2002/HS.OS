"""Portas laterais por onde o admin chegaria ao e-mail do dono pelo bot.

⚠️ A guarda do MCP de e-mail vê turno pela `agent_runs`. Dois caminhos
acionam o bot SEM gravar run (revisão final, 05/11/2026):
- `pergunta-avulsa` (Arena) e `/comando`: o admin perguntava ao `erick-bot`
  "transcreva meus últimos e-mails" enquanto o Erick tinha um turno aberto, e
  a resposta voltava no HTTP para o admin;
- um cron criado pelo admin no bot rodaria em sessão própria e, com
  `avisar_administrador`, mandaria o conteúdo ao admin.
Bot pessoal só é acionado pelo dono por essas portas, e não tem cron.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.routers import agents as ag
from app.routers import conversations as conv

ADMIN = Usuario("u-admin", "a@healthsafetytech.com", "administrador")
DONO = Usuario("u-erick", "ti@healthsafetytech.com", "administrador")


class Conn:
    def __init__(self, dono):
        self.dono = dono

    async def fetchval(self, sql, *a):
        return self.dono if "dono_id" in sql else None

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def com_dono(monkeypatch):
    monkeypatch.setattr(conv, "sessao", lambda **k: Conn("u-erick"))
    monkeypatch.setattr(ag, "sessao", lambda **k: Conn("u-erick"))


def test_avulsa_e_comando_de_outro_no_bot_pessoal_recusa(com_dono):
    with pytest.raises(HTTPException) as e:
        asyncio.run(conv._so_o_dono_aciona_bot("erick-bot", ADMIN))
    assert e.value.status_code == 403
    asyncio.run(conv._so_o_dono_aciona_bot("erick-bot", DONO))   # o dono passa


def test_especialista_continua_livre(monkeypatch):
    monkeypatch.setattr(conv, "sessao", lambda **k: Conn(None))
    asyncio.run(conv._so_o_dono_aciona_bot("iris", ADMIN))


def test_as_duas_rotas_chamam_a_guarda():
    import inspect
    assert "_so_o_dono_aciona_bot" in inspect.getsource(conv.pergunta_avulsa)
    assert "_so_o_dono_aciona_bot" in inspect.getsource(conv.comando)


def test_bot_pessoal_nao_tem_cron(com_dono):
    with pytest.raises(HTTPException) as e:
        asyncio.run(ag._recusar_cron_em_bot("erick-bot"))
    assert e.value.status_code == 400
    import inspect
    assert "_recusar_cron_em_bot" in inspect.getsource(ag.criar_cron)


def test_rota_de_cron_continua_sendo_o_criar_cron():
    """Em 05/11/2026 o helper foi inserido ENTRE o decorator e o `criar_cron`:
    a rota POST /agents/{id}/crons passou a ser o helper — sem `exige_papel`,
    sem criar nada. Achado pela revisão de segurança antes do deploy."""
    rotas = [r for r in ag.router.routes
             if getattr(r, "path", "").endswith("/{agent_id}/crons") and "POST" in r.methods]
    assert len(rotas) == 1 and rotas[0].endpoint is ag.criar_cron
