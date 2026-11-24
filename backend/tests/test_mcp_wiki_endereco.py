"""O HTML que o agente grava na wiki não leva endereço que roda código.

⚠️ **O que custaria (PK-01, 24/11/2026):** o `documento_criar`/`documento_editar`
grava o HTML do agente como veio (`_para_html` repassa texto que começa com
tag), e o agente escreve depois de ler e-mail e anexo de terceiros. Um
`<div data-wiki-attachment data-href="javascript:…">` vira, no clique de
"Baixar" de um administrador, código rodando na origem do HS.OS com o
`hsos.token` dele — injeção indireta virando conta tomada.

O front também recusa (`enderecoSeguro`), mas o conteúdo fica gravado e é lido
por outras telas e exportações. Esta é a segunda ponta: o que é perigoso não
chega ao banco.
"""
from app.routers.mcp_wiki import _para_html


def test_javascript_em_anexo_some_do_html_gravado():
    h = _para_html('<p>x</p><div data-wiki-attachment data-href="javascript:fetch(1)" data-name="a.pdf"></div>')
    assert "javascript" not in h.lower()
    assert 'data-name="a.pdf"' in h  # o resto do nó fica


def test_disfarces_do_esquema_tambem_caem():
    """O navegador decodifica entidade e ignora espaço/controle no esquema."""
    for v in ["&#106;avascript:x", "&#x6A;avascript:x", " JaVaScRiPt:x", "java&#9;script:x",
              "vbscript:x", "data:text/html,<b>x</b>"]:
        h = _para_html(f'<p><a href="{v}">clique</a></p>')
        assert "href" not in h, v
        assert "clique" in h  # o texto do link continua


def test_src_de_video_e_aspas_simples_ou_sem_aspas():
    h = _para_html("<p>v</p><div data-video><video src='javascript:x'></video></div><img src=javascript:y>")
    assert "javascript" not in h.lower()


def test_enderecos_normais_continuam():
    html = ('<p><a href="https://exemplo.com/a">a</a> <a href="mailto:ti@exemplo.com">b</a> '
            '<a href="tel:+5561999999999">c</a> <a href="/wiki/123">d</a> <a href="#secao">e</a></p>'
            '<img src="data:image/png;base64,AAAA">'
            '<div data-wiki-attachment data-href="https://hsosapi.healthsafetytech.com/storage/wiki-uploads/a.pdf"></div>')
    assert _para_html(html) == html


def test_data_svg_nao_passa_nem_em_imagem():
    """SVG em `data:` pode carregar script; só imagem raster passa."""
    h = _para_html('<p>x</p><img src="data:image/svg+xml;base64,AAAA">')
    assert "data:image/svg" not in h


def test_markdown_com_link_javascript_tambem_cai():
    """O ramo markdown não sanitiza nada sozinho: `[x](javascript:…)` vira `<a href>`."""
    h = _para_html("Veja [aqui](javascript:alert(1)) o relatório.")
    assert "javascript" not in h.lower()
    assert "aqui" in h
