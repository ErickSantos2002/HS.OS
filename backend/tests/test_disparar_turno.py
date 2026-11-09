"""`disparar_turno` — a porta única do trabalho autônomo do Guardi (09/11/2026).

O disparador de lembretes aciona o agente sem tela nenhuma, e por isso não pode
passar pelo `POST /send`: ele chama o mesmo miolo. O que este teste tranca são
as duas coisas que, erradas, falham **em silêncio**:

- sem `agentId` explícito o gateway manda para o agente padrão (`nina`), sem
  aviso — o lembrete do Erick iria parar na orquestradora;
- o run tem que ser gravado **no nome do dono**: é ele que faz o
  `turno_em_curso` reconhecer que o dono está conversando, e sem isso as
  ferramentas do bot (e-mail, sistemas, anexos) recusam no disparo.
"""
import asyncio
from types import SimpleNamespace

import pytest

from app.gateway.client import ErroGateway
from app.routers import conversations as c


class ClienteFalso:
    def __init__(self, falha=None):
        self.chamadas = []
        self._falha = falha

    async def chamar(self, metodo, params):
        self.chamadas.append((metodo, params))
        if self._falha:
            raise self._falha
        return {"runId": params.get("idempotencyKey"), "status": "started"}


@pytest.fixture
def amb(monkeypatch):
    estado = SimpleNamespace(cliente=ClienteFalso(), runs=[], configurado=True)

    async def carregar():
        return SimpleNamespace(configurado=estado.configurado, url="ws://x", token="t")

    async def piso(chave, user_id):
        return 7

    async def ultimo_seq(cliente, chave, piso=0):
        return piso + 1

    async def guardar(*a, **kw):
        estado.runs.append((a, kw))

    monkeypatch.setattr(c.cfg, "carregar", carregar)
    monkeypatch.setattr(c, "obter_cliente", lambda url, token: estado.cliente)
    monkeypatch.setattr(c, "_piso_do_seq", piso)
    monkeypatch.setattr(c, "_ultimo_seq", ultimo_seq)
    monkeypatch.setattr(c, "_guardar_run", guardar)
    return estado


def test_disparar_turno_manda_agent_id_e_grava_run_do_dono(amb):
    run_id = asyncio.run(c.disparar_turno("erick-bot", "u-erick", "lembrete: reunião",
                                          pergunta_id=None, prefixo="hsos-lembrete-"))

    assert run_id.startswith("hsos-lembrete-")
    [(metodo, params)] = amb.cliente.chamadas
    assert metodo == "chat.send"
    assert params["agentId"] == "erick-bot"
    assert params["sessionKey"] == c._chave_sessao("erick-bot", "u-erick")
    assert params["message"] == "lembrete: reunião"
    assert params["idempotencyKey"] == run_id

    [(args, kw)] = amb.runs
    assert args == (run_id, "erick-bot", c._chave_sessao("erick-bot", "u-erick"), 8, "u-erick")
    assert kw == {"pergunta_id": None}


def test_disparar_turno_prefixo_padrao_e_run_unico(amb):
    """Reaproveitar o `idempotencyKey` faria o gateway deduplicar e o segundo
    disparo sumiria em silêncio."""
    a = asyncio.run(c.disparar_turno("erick-bot", "u", "x"))
    b = asyncio.run(c.disparar_turno("erick-bot", "u", "x"))
    assert a.startswith("hsos-") and not a.startswith("hsos-lembrete-")
    assert a != b


def test_disparar_turno_falha_do_gateway_nao_grava_run(amb):
    """Run gravado sem `chat.send` aceito contaria como turno aberto por 30 min
    e liberaria as ferramentas do bot sem conversa nenhuma."""
    amb.cliente = ClienteFalso(falha=ErroGateway("fora"))
    with pytest.raises(ErroGateway):
        asyncio.run(c.disparar_turno("erick-bot", "u", "x"))
    assert amb.runs == []


def test_disparar_turno_sem_gateway_levanta_erro_sem_http(amb):
    """O disparador não tem tela: um `HTTPException` aqui seria lixo para ele.
    `GatewayNaoConfigurado` é `ErroGateway`, e o `/send` traduz para 503."""
    amb.configurado = False
    with pytest.raises(c.GatewayNaoConfigurado):
        asyncio.run(c.disparar_turno("erick-bot", "u", "x"))
    assert issubclass(c.GatewayNaoConfigurado, ErroGateway)
    assert amb.cliente.chamadas == [] and amb.runs == []


def _usuario():
    return SimpleNamespace(id="u-erick")


def test_send_continua_503_e_502(amb):
    """A tela não pode notar a extração: mesmos status e mesmas frases."""
    from fastapi import HTTPException

    dados = c.EnvioIn(content="oi")
    amb.configurado = False
    with pytest.raises(HTTPException) as e:
        asyncio.run(c.enviar("erick-bot", dados, _usuario()))
    assert (e.value.status_code, e.value.detail) == (503, "Gateway não configurado.")

    amb.configurado = True
    amb.cliente = ClienteFalso(falha=ErroGateway("fora"))
    with pytest.raises(HTTPException) as e:
        asyncio.run(c.enviar("erick-bot", dados, _usuario()))
    assert (e.value.status_code, e.value.detail) == (502, "O agente não pôde ser acionado: fora")


def test_send_devolve_o_run_do_disparo(amb):
    out = asyncio.run(c.enviar("erick-bot", c.EnvioIn(content="oi"), _usuario()))
    [(_, params)] = amb.cliente.chamadas
    assert out.run_id == params["idempotencyKey"] and out.run_id.startswith("hsos-")
