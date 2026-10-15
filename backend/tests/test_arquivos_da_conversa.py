"""Painel "Arquivos" da conversa com o agente.

Pedido da Lidisay (RH), 15/10/2026: saber o que já mandou ao `bruce` sem rolar
a conversa — e sem perder o que ficou para trás de um "Nova conversa". O
painel lê `conversations.media`, que mistura três coisas: arquivo da pessoa,
arquivo que o agente devolveu e o resumo em áudio de cada resposta. Se o
áudio passar, a lista vira vinte `resumo.mp3` e o arquivo que ela procura some
no meio deles.
"""
import json

from app.arquivos_da_conversa import arquivos_da_conversa


def linha(id_, role, media, quando="2026-10-14T10:00:00.000Z"):
    return {"id": id_, "role": role, "media": media, "created_at": quando}


PLANILHA = {"type": "file", "id": "a1", "name": "ponto.xlsx", "size": 10,
            "mimeType": "application/vnd.ms-excel", "url": "", "base64": ""}
RESUMO = {"type": "audio", "id": "a2", "name": "resumo.mp3", "size": 5,
          "mimeType": "audio/mpeg", "url": "", "base64": ""}


def test_resumo_em_audio_fica_de_fora_e_a_mensagem_so_com_ele_some():
    saida = arquivos_da_conversa([linha("m1", "agent", [RESUMO]),
                                  linha("m2", "user", [PLANILHA])], "Bruce")
    assert [m["id"] for m in saida] == ["m2"]
    assert [a["name"] for a in saida[0]["attachments"]] == ["ponto.xlsx"]


def test_autor_e_voce_ou_o_nome_do_agente():
    """O arquivo que o agente devolveu entra também — e precisa dizer de quem é."""
    devolvido = {**PLANILHA, "id": "a3", "name": "relatorio.xlsx"}
    saida = arquivos_da_conversa([linha("m1", "user", [PLANILHA]),
                                  linha("m2", "agent", [devolvido, RESUMO])], "Bruce")
    assert [(m["author_name"], len(m["attachments"])) for m in saida] == [("Você", 1), ("Bruce", 1)]


def test_media_em_string_e_objeto_solto_tambem_servem():
    """`media` é jsonb e o driver devolve texto; mensagem antiga guardou
    objeto em vez de lista. O `_para_saida` do histórico aceita os dois."""
    saida = arquivos_da_conversa([linha("m1", "user", json.dumps(PLANILHA))], "Bruce")
    assert saida[0]["attachments"][0]["id"] == "a1"


def test_imagem_antiga_so_com_url_entra_e_item_sem_id_nem_url_nao():
    antiga = {"type": "image", "name": "foto.png", "url": "/storage/x/foto.png",
              "mimeType": "image/png"}
    vazio = {"type": "file", "name": "fantasma.pdf"}
    saida = arquivos_da_conversa([linha("m1", "user", [antiga, vazio])], "Bruce")
    assert [a["name"] for a in saida[0]["attachments"]] == ["foto.png"]


def test_base64_nao_desce_para_a_tela():
    """Mensagem antiga pode carregar o arquivo inteiro em `base64`; o painel
    só precisa do nome e do id."""
    gordo = {**PLANILHA, "base64": "A" * 10_000}
    anexo = arquivos_da_conversa([linha("m1", "user", [gordo])], "Bruce")[0]["attachments"][0]
    assert "base64" not in anexo


def test_sem_media_ou_media_invalida_nao_quebra():
    saida = arquivos_da_conversa([linha("m1", "user", None), linha("m2", "user", "não é json"),
                                  linha("m3", "user", [None, "x"])], "Bruce")
    assert saida == []
