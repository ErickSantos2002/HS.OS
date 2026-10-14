"""Conversas anteriores com o agente (spec 2026-10-14).

Uma conversa anterior é o trecho entre dois "Nova conversa". Errar o recorte
mostra a pessoa a conversa errada — ou mistura duas — justamente quando ela
voltou para pegar um número de lá.
"""
from datetime import datetime, timedelta, timezone

from app.conversas_anteriores import (limites_do_trecho, recortar_conversas,
                                      titulo_da_conversa, trecho_da_mensagem)

T0 = datetime(2026, 10, 1, 9, 0, tzinfo=timezone.utc)


def t(min_):
    return T0 + timedelta(minutes=min_)


def m(min_, role="user", content="uma pergunta com bastante palavra"):
    return {"role": role, "content": content, "created_at": t(min_)}


RESETS = [{"id": "r1", "created_at": t(10)}, {"id": "r2", "created_at": t(20)},
          {"id": "r3", "created_at": t(21)}]


def test_recorta_entre_resets_do_mais_novo_ao_mais_antigo_e_pula_vazio():
    """r3 veio um minuto depois de r2, sem mensagem no meio: item vazio na
    lista seria uma conversa que abre em branco."""
    msgs = [m(1), m(2, "agent", "resposta"), m(12), m(13, "agent", "outra")]
    saida = recortar_conversas(RESETS, msgs)
    assert [c["id"] for c in saida] == ["r2", "r1"]
    assert saida[0]["mensagens"] == 2 and saida[0]["inicio"] == t(12) and saida[0]["ate"] == t(20)
    assert saida[1]["mensagens"] == 2 and saida[1]["inicio"] == t(1)


def test_mensagem_no_instante_do_reset_pertence_ao_trecho_que_ele_fecha():
    """O `/limpar` grava o reset depois da última mensagem; empate de relógio
    não pode jogar a última resposta para a conversa seguinte."""
    saida = recortar_conversas([{"id": "r1", "created_at": t(10)}], [m(1), m(10, "agent", "fim")])
    assert saida[0]["mensagens"] == 2


def test_sem_reset_nao_ha_conversa_anterior():
    assert recortar_conversas([], [m(1)]) == []


def test_titulo_pula_pergunta_generica():
    msgs = [m(1, content="oi"), m(2, "agent", "Olá!"), m(3, content="planilha com os eventos (atestado e declaração)")]
    assert titulo_da_conversa(msgs) == "planilha com os eventos (atestado e declaração)"


def test_titulo_recua_para_a_primeira_pergunta_e_depois_para_o_padrao():
    assert titulo_da_conversa([m(1, content="olha os arquivos")]) == "olha os arquivos"
    assert titulo_da_conversa([m(1, "agent", "só o agente falou")]) == "Conversa sem pergunta"


def test_titulo_colapsa_espaco_e_corta_em_80():
    longo = "palavra " * 30
    titulo = titulo_da_conversa([m(1, content="  linha um\n\nlinha   dois três quatro " + longo)])
    assert titulo.startswith("linha um linha dois três quatro")
    assert len(titulo) == 80 and titulo.endswith("…")


def test_limites_do_trecho():
    assert limites_do_trecho(RESETS, "r1") == (None, t(10))
    assert limites_do_trecho(RESETS, "r2") == (t(10), t(20))
    assert limites_do_trecho(RESETS, "nao-existe") is None


def test_trecho_da_mensagem():
    """É o que leva a busca global à conversa certa."""
    assert trecho_da_mensagem(RESETS, t(5)) == "r1"
    assert trecho_da_mensagem(RESETS, t(10)) == "r1"
    assert trecho_da_mensagem(RESETS, t(15)) == "r2"
    assert trecho_da_mensagem(RESETS, t(30)) is None
