"""PK-12 — o teto dos sete arquivos sai da config do gateway, por agente (25/11/2026).

⚠️ **O que custaria:** o teto de 20.000 era número fixo no código. Subir o da
`nina` no gateway (`agents.list[].bootstrapMaxChars`) sem o backend saber faria
as três portas que escrevem nos sete — a tela, o roster e a distribuição do
contexto da empresa — continuarem recusando o que o gateway já aceita. E o
inverso, um teto MENOR no gateway, deixaria o backend gravar texto que seria
cortado em silêncio no fim, onde mora o "como eu respondo".
"""
import asyncio

from app.gateway import client as gw

CONFIG = {"agents": {
    "defaults": {"maxConcurrent": 6},
    "list": [{"id": "nina", "bootstrapMaxChars": 30000}, {"id": "flow"}],
}}


def test_override_do_agente_vale():
    assert gw.teto_na_config(CONFIG, "nina") == 30000


def test_sem_override_vale_o_padrao_da_config_ou_o_do_gateway():
    assert gw.teto_na_config(CONFIG, "flow") == gw.TETO_ARQUIVO_AGENTE
    com_padrao = {"agents": {"defaults": {"bootstrapMaxChars": 25000}, "list": [{"id": "flow"}]}}
    assert gw.teto_na_config(com_padrao, "flow") == 25000


def test_valor_invalido_cai_no_padrao():
    ruim = {"agents": {"list": [{"id": "nina", "bootstrapMaxChars": "muito"}]}}
    assert gw.teto_na_config(ruim, "nina") == gw.TETO_ARQUIVO_AGENTE


def test_excede_usa_o_teto_dado():
    assert gw.excede_o_teto("x" * 25000)
    assert not gw.excede_o_teto("x" * 25000, teto=30000)


class _Cli:
    def __init__(self, resposta=None, falha=False):
        self.resposta, self.falha, self.chamadas = resposta, falha, 0

    async def chamar(self, metodo, params):
        self.chamadas += 1
        assert metodo == "config.get"
        if self.falha:
            raise gw.ErroGateway("fora")
        return self.resposta


def test_le_a_config_viva_e_guarda_por_um_minuto():
    gw._teto_cache.clear()
    cli = _Cli({"payload": {"parsed": CONFIG}})
    assert asyncio.run(gw.teto_do_agente(cli, "nina")) == 30000
    assert asyncio.run(gw.teto_do_agente(cli, "nina")) == 30000
    assert cli.chamadas == 1


def test_gateway_fora_cai_no_teto_conservador():
    """Não saber o teto não pode virar "sem teto": vale o menor, o padrão."""
    gw._teto_cache.clear()
    assert asyncio.run(gw.teto_do_agente(_Cli(falha=True), "nina")) == gw.TETO_ARQUIVO_AGENTE
