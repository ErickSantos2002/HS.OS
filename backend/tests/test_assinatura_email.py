"""Assinatura de e-mail no que o bot prepara (05/11/2026).

⚠️ O que se tranca:
- o corpo do bot vira HTML ESCAPADO (texto de e-mail lido não injeta tag);
- as imagens vão embutidas (`cid:`) — link externo não anima e é bloqueado
  pelo Outlook de quem recebe;
- tipo e tamanho validados na entrada (GIF incluso, ≤ 2 MB cada, ≤ 3 MB no
  total: o Graph recusa requisição acima de 4 MB).
"""
import asyncio
import base64
import json

import httpx
import pytest

from app.email import assinatura as a
from app.email import graph as g


def test_html_escapa_o_corpo_e_embute_as_imagens():
    ass = {"texto_antes": "Atenciosamente,", "texto_depois": "Aviso LGPD",
           "imagens": [{"ordem": 1, "mime": "image/png", "nome": "b.png", "dados": b"x"},
                       {"ordem": 2, "mime": "image/gif", "nome": "g.gif", "dados": b"y"}]}
    html = a.montar_html("Olá <script>x</script>\nlinha 2", ass)
    assert "<script>" not in html and "&lt;script&gt;" in html and "linha 2" in html
    assert 'src="cid:assinatura-1"' in html and 'src="cid:assinatura-2"' in html
    assert html.index("Atenciosamente") < html.index("cid:assinatura-1") < html.index("Aviso LGPD")
    anexos = a.anexos_inline(ass)
    assert anexos[1]["contentId"] == "assinatura-2" and anexos[1]["isInline"] is True
    assert base64.b64decode(anexos[1]["contentBytes"]) == b"y"


def test_sem_assinatura_html_so_com_o_corpo():
    html = a.montar_html("oi", None)
    assert "oi" in html and "cid:" not in html


def test_valida_imagem():
    a.validar_imagem("image/gif", 1_000_000, outras=0)
    for mime, tam, outras in (("image/svg+xml", 10, 0), ("image/png", 2_100_000, 0),
                              ("image/png", 1_500_000, 1_600_000)):
        with pytest.raises(ValueError):
            a.validar_imagem(mime, tam, outras)


def test_rascunho_com_assinatura_vai_em_html_com_anexos(monkeypatch):
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(201, json={"id": "m1"})
    monkeypatch.setattr(g, "_transporte", httpx.MockTransport(h))
    asyncio.run(g.criar_rascunho("tok", "ti@x.com", "ti@x.com", ["a@y.com"], [], "Oi", "<p>c</p>",
                                 html=True, anexos=[{"@odata.type": "#microsoft.graph.fileAttachment",
                                                     "name": "b.png", "contentType": "image/png",
                                                     "contentBytes": "eA==", "contentId": "assinatura-1",
                                                     "isInline": True}]))
    corpo = json.loads(reqs[0].content)
    assert corpo["body"]["contentType"] == "HTML" and corpo["attachments"][0]["isInline"] is True


def test_rota_recusa_imagem_grande(monkeypatch):
    from fastapi import HTTPException
    from app.dependencies import Usuario
    from app.routers import email as rota

    class Up:
        content_type = "image/png"
        filename = "x.png"

        async def read(self):
            return b"0" * 2_100_000

    class Conn:
        async def fetchval(self, *a):
            return 0

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False
    monkeypatch.setattr(rota, "sessao", lambda **k: Conn())
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.enviar_imagem_assinatura(1, Up(), Usuario("u", "e@x.com", "colaborador")))
    assert e.value.status_code == 400


def test_despedida_repetida_sai_do_corpo():
    """05/11: o bot terminou com "Atenciosamente," e a assinatura do Perfil
    começa com "Atenciosamente," — saiu duas vezes."""
    ass = {"texto_antes": "Atenciosamente,", "texto_depois": "", "imagens": []}
    html = a.montar_html("Segue o pedido.\n\nAtenciosamente,\n", ass)
    assert html.count("Atenciosamente") == 1
    html = a.montar_html("Segue.\n\natenciosamente", ass)
    assert html.lower().count("atenciosamente") == 1


def test_textos_tem_padrao_da_empresa_e_o_editado_vale():
    """06/11: duas pessoas mandaram e-mail sem "Atenciosamente," e sem o aviso
    LGPD — uma não preencheu, a outra não clicou em salvar. Sem cadastro ou com
    campo vazio, sai o padrão; o que a pessoa editou e salvou continua valendo
    (a Qualidade pediu que seguisse editável)."""
    class Conn:
        def __init__(self, linha):
            self.linha = linha

        async def fetchrow(self, *a):
            return self.linha

        async def fetch(self, *a):
            return []
    ass = asyncio.run(a.carregar(Conn(None), "u"))
    assert ass["texto_antes"] == "Atenciosamente," and "LGPD" in ass["texto_depois"]
    html = a.montar_html("Segue.", ass)
    assert "Atenciosamente," in html and "qualidade@healthsafety.com.br" in html and "cid:" not in html
    ass = asyncio.run(a.carregar(Conn({"texto_antes": "Abraços,", "texto_depois": "  "}), "u"))
    assert ass["texto_antes"] == "Abraços," and ass["texto_depois"] == a.TEXTO_DEPOIS
