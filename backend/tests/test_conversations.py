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


# ─────────────────────────────────────────────────────────────────────────────
# Itens 6 e 7 do roadmap: o monólogo interno e as bolhas de preâmbulo.
#
# O mecanismo é o `POST /webhook/resposta`: o agente empurra `content` como
# lista e cada item vira uma linha. O `_HEARTBEAT` só barra o que começa com
# emoji, então a narração em texto puro passava — 1,8 bolha por pergunta, e o
# CEO sendo chamado de "o CEO" na terceira pessoa, na cara dele.
#
# Os textos abaixo são reais, da conversa de 24 a 30/08/2026.
# ─────────────────────────────────────────────────────────────────────────────

BASTIDOR_PURO = (
    "O CEO pergunta sobre a origem dos leads de agosto. Vou verificar as "
    "colunas de origem/aquisição nos cards."
)

BASTIDOR_MAIS_RESPOSTA = (
    "O CEO pergunta quem está melhor no mês. Pelo quadro de hoje que já apurei "
    "(agosto, board Aquisição), o destaque é claro. Vou responder direto.\n\n"
    "Nicholson, o destaque do mês é o **Eduardo Luna**.\n\n"
    "Em agosto (01–27), contra julho: **15 negócios** fechados vs. 4."
)


def test_bastidor_puro_nao_sobra_nada():
    assert c._aparar_bastidor(BASTIDOR_PURO) == ""


def test_apara_o_prefixo_e_preserva_a_resposta():
    """Descartar a mensagem inteira seria errado: medido no corpus da semana,
    5 das 24 que começam com monólogo trazem a resposta no mesmo bloco."""
    saida = c._aparar_bastidor(BASTIDOR_MAIS_RESPOSTA)
    assert saida.startswith("Nicholson, o destaque do mês é o **Eduardo Luna**.")
    assert "15 negócios" in saida
    assert "O CEO pergunta" not in saida


def test_resposta_limpa_passa_intacta():
    texto = ("Faturamento de agosto/2026 — até 28/08\n\n"
             "Vendas R$ 776.442,30 · serviços R$ 213.956,30.")
    assert c._aparar_bastidor(texto) == texto


def test_so_apara_no_comeco():
    """`Vou` no meio da resposta é o agente dizendo o próximo passo a quem
    perguntou — isso é resposta, não bastidor."""
    texto = ("O total de agosto é R$ 990.398,60.\n\n"
             "Vou consultar setembro se você quiser.")
    assert c._aparar_bastidor(texto) == texto


def test_paragrafo_com_numero_nao_e_bastidor():
    texto = "Vou consultar o mês.\n\nTotal: R$ 1.031.451,60."
    assert c._aparar_bastidor(texto) == "Total: R$ 1.031.451,60."
