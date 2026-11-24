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


def test_barra_como_separador_nao_escapa():
    """Revisão de segurança de 24/11: `<a/href=…>` — o navegador aceita `/`
    entre o nome da tag e o atributo, e o primeiro filtro só olhava espaço."""
    for h in ['<p><a/href="javascript:x">a</a></p>', "<p><img/src='javascript:x'></p>",
              '<p><a href="#"/href="javascript:x">a</a></p>']:
        assert "javascript" not in _para_html(h).lower(), h


def test_atributo_de_evento_sai():
    h = _para_html('<p>x</p><img src="https://exemplo.com/a.png" onerror="fetch(1)"><p/onmouseover=alert(1)>y</p>')
    assert "onerror" not in h.lower() and "onmouseover" not in h.lower()
    assert 'src="https://exemplo.com/a.png"' in h


def test_outros_atributos_de_endereco_tambem_conferidos():
    for attr in ["formaction", "xlink:href", "action", "poster", "background"]:
        h = _para_html(f'<p>x</p><div {attr}="javascript:x"></div>')
        assert "javascript" not in h.lower(), attr


def test_texto_do_documento_nao_e_tocado():
    """O filtro vale DENTRO das tags. Texto corrido com "onde = aqui" ou
    "src=x" é conteúdo, e cortar palavra de briefing é estrago de outro tipo."""
    html = "<p>Veja onde = aqui, e o campo src=javascript:x no manual do sistema.</p>"
    assert _para_html(html) == html


def test_entrada_maliciosa_nao_trava_o_filtro():
    """Revisão de segurança de 24/11: aspa sem fechar repetida fazia a regex de
    tag varrer até o fim a partir de cada `<a` — quadrático. Um agente sob
    injeção mandando isso travaria o worker do backend."""
    import time
    t0 = time.perf_counter()
    _para_html("<p>x</p>" + '<a "' * 50_000)
    _para_html("<p>x</p>" + "<a href='" * 50_000)
    assert time.perf_counter() - t0 < 1.0


def test_aspa_com_maior_dentro_do_valor_nao_fecha_a_tag():
    h = _para_html('<p>x</p><a title="a > b" href="javascript:x">c</a>')
    assert "javascript" not in h.lower()
    assert 'title="a > b"' in h
