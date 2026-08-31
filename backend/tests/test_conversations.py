"""Regressões da semana de 24 a 30/08/2026, medidas na conversa do CEO.

Ver `docs/ROADMAP-AGENTES-2026-08-31.md`. Os dois defeitos aqui já tinham sido
dados como corrigidos em 19/08 e voltaram — por isso viram teste, não só conserto.
"""
import asyncio

from app.routers import conversations as c


class ClienteFalso:
    """Devolve uma fatia fixa de `chat.history`, como o gateway faz."""

    def __init__(self, seqs):
        self._seqs = seqs

    async def chamar(self, metodo, params):
        assert metodo == "chat.history"
        return {"messages": [
            {"role": "assistant", "__openclaw": {"seq": s}} for s in self._seqs
        ]}


AVISO_DE_COMPACTACAO = (
    "⚠️ Auto-compaction could not recover this turn. I kept this conversation "
    "mapped to the current session. Please try again, use /compact, or use /new "
    "to start a fresh session."
)


def test_ultimo_seq_nao_regride_abaixo_do_piso_que_ja_conhecemos():
    """O gateway pode devolver uma fatia velha; o `seq` que já vimos não some.

    Medido em 19/08: sessão com 52 mensagens sem buracos e `chat.history`
    devolvendo a de `seq=41`. `_ultimo_seq` subestimava, o `/reply` gravava tudo
    com `seq >` aquele número, e vinham mensagens do turno anterior coladas na
    resposta — as 12 duplicatas de 24 a 30/08.
    """
    seq = asyncio.run(c._ultimo_seq(ClienteFalso([41]), "chave", piso=48))
    assert seq == 48


def test_ultimo_seq_prefere_o_gateway_quando_ele_esta_na_frente():
    seq = asyncio.run(c._ultimo_seq(ClienteFalso([50, 51, 52]), "chave", piso=48))
    assert seq == 52


def test_gateway_fora_do_ar_nao_zera_o_piso():
    """Sem isto, gateway instável faz o corte cair para 0 e o turno inteiro
    ser regravado como se fosse novo."""
    class Quebrado:
        async def chamar(self, metodo, params):
            raise c.ErroGateway("timeout")

    assert asyncio.run(c._ultimo_seq(Quebrado(), "chave", piso=48)) == 48


def test_nao_recupera_o_aviso_de_compactacao():
    """O `/reply` já se recusa a gravar este texto; o `/recuperar` o reimportava.

    É por isso que o CEO leu três vezes, em inglês, um pedido para rodar
    `/compact` — comando que não existe no HS.OS.
    """
    assert c._deve_recuperar(AVISO_DE_COMPACTACAO, []) is False


def test_recupera_resposta_de_verdade():
    texto = "Faturamento de agosto/2026 até 28/08: R$ 1.031.451,60."
    assert c._deve_recuperar(texto, []) is True


def test_nao_recupera_o_que_ja_esta_gravado():
    texto = "Faturamento de agosto/2026 até 28/08: R$ 1.031.451,60."
    assert c._deve_recuperar(texto, [texto]) is False


def test_nao_recupera_texto_vazio():
    assert c._deve_recuperar("", []) is False
