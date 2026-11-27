"""Encaminhar mensagem (spec 2026-11-27-encaminhar-mensagem-design).

O que estes testes trancam é o que viaja e o que não viaja. Anexo privado
precisa de CÓPIA para a conversa de destino — sem ela o colega recebe a
bolha e leva 404 ao abrir, porque `pessoa_pode_ler` exige ser da conversa.
Cartão de aprovação e resumo em áudio do agente não fazem sentido fora da
conversa onde nasceram. E menção dentro de texto encaminhado não pode furar
o silenciar: encaminhar não é jeito de acordar o grupo inteiro.
"""
import pytest

from app import encaminhamento as E


def test_anexo_com_id_vai_para_copia_e_gif_sem_id_vai_como_esta():
    gif = {"name": "oi.gif", "url": "https://media.giphy.com/x.gif", "size": 0, "mimeType": "image/gif"}
    pdf = {"id": "a1", "name": "r.pdf", "url": "", "size": 10, "mimeType": "application/pdf"}
    publicos, ids = E.anexos_do_canal([gif, pdf])
    assert publicos == [gif]
    assert ids == ["a1"]


def test_canal_sem_anexo_nao_quebra():
    assert E.anexos_do_canal(None) == ([], [])


def test_da_conversa_com_agente_cartoes_e_resumo_em_audio_ficam_de_fora():
    media = [
        {"type": "file", "id": "f1"},
        {"type": "image", "id": "i1"},
        {"type": "audio", "id": "au"},          # resumo em áudio da resposta
        {"type": "acao_aprovacao", "id": "p1"},
        {"type": "email_aprovacao", "id": "p2"},
        {"type": "lembrete", "id": "l1"},
        {"type": "file", "base64": "data:..."},  # sem id: não há o que copiar
    ]
    assert E.anexos_da_conversa(media, "agent") == ["f1", "i1"]


def test_audio_que_a_pessoa_gravou_viaja():
    assert E.anexos_da_conversa([{"type": "audio", "id": "au"}], "user") == ["au"]


def test_id_do_audio_do_canal():
    assert E.id_do_audio("anexo:abc") == "abc"
    assert E.id_do_audio("https://x/y.webm") is None
    assert E.id_do_audio(None) is None


@pytest.mark.parametrize("pessoas,canais,guardi", [
    ([], [], False),                                   # nenhum destino
    ([f"p{i}" for i in range(10)], [], True),          # 11 com o Guardi
    (["p1", "p1"], [], False),                         # repetido
    ([], ["c1", "c1"], False),
    (["eu"], [], False),                               # eu mesmo como pessoa
])
def test_destinos_recusados_antes_de_qualquer_escrita(pessoas, canais, guardi):
    with pytest.raises(ValueError):
        E.conferir_destinos(pessoas, canais, guardi, "eu")


def test_dez_destinos_contando_o_guardi_passam():
    E.conferir_destinos([f"p{i}" for i in range(9)], [], True, "eu")


def test_mencao_em_encaminhada_nao_conta():
    assert E.conteudo_para_mencao("@todos olhem", True) == ""
    assert E.conteudo_para_mencao("@todos olhem", False) == "@todos olhem"
    assert E.conteudo_para_mencao(None, False) == ""


def test_anexo_repetido_vira_uma_copia_e_ha_teto():
    """O `attachments` é JSON escrito por quem mandou a mensagem original: o
    mesmo id repetido mil vezes viraria mil cópias no R2 por destino."""
    assert E.ids_unicos(["a", "b", "a", "c"]) == ["a", "b", "c"]
    assert len(E.ids_unicos([f"x{i}" for i in range(50)])) == E.LIMITE_ANEXOS


def test_resumo_em_audio_do_agente_no_canal_nao_viaja():
    """Achado da revisão (27/11/2026): no canal, o `audio_url` da resposta do
    agente é o resumo em áudio dela. Copiado, chegava como áudio GRAVADO por
    quem encaminhou — o player de pessoa — e custava uma cópia por destino."""
    assert E.audio_que_viaja("anexo:abc", "agent") is None
    assert E.audio_que_viaja("anexo:abc", "human") == "abc"
