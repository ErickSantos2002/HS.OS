"""Encaminhar (27/11/2026): o formato do anexo copiado.

Os dois lados leem formatos diferentes, e trocar um pelo outro é anexo que
some calado: o canal lê `ChannelAttachment` (`name`/`url`/`size`/`mimeType`),
o campo da conversa com o Guardi lê `MediaAttachment` (`type`/`base64`).
O `base64` vazio é o que faz o `finalizeStaged` deixar o anexo passar como
já-enviado em vez de tentar subir uma imagem a partir de string vazia.
"""
from app.anexos import Anexo
from app.routers import encaminhar as R

PDF = Anexo(id="velho", caminho="canal/c/velho/r.pdf", nome="r.pdf", mime="application/pdf",
            tamanho=10, contexto="canal", channel_id="c", agent_id=None, dono_conversa=None)
IMG = Anexo(id="v2", caminho="canal/c/v2/f.png", nome="f.png", mime="image/png",
            tamanho=5, contexto="canal", channel_id="c", agent_id=None, dono_conversa=None)


def test_item_do_canal_aponta_para_a_copia():
    assert R.item_copiado(PDF, "novo") == {
        "id": "novo", "name": "r.pdf", "url": "", "size": 10, "mimeType": "application/pdf"}


def test_item_para_o_guardi_vai_como_ja_enviado():
    assert R.media_copiada(IMG, "novo") == {
        "type": "image", "id": "novo", "mimeType": "image/png", "base64": "",
        "name": "f.png", "size": 5, "url": ""}
    assert R.media_copiada(PDF, "n")["type"] == "file"
