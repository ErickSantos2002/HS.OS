"""O access log do uvicorn não guarda a query da Admin API nem do script do mapa.

⚠️ **O `play` manda o access token da Microsoft da pessoa na query** de
`/api/room/access` e `/api/map` (`accessToken=…`, `AdminApi.ts:241-297,423-433`),
junto do e-mail e do IP. Com o access log padrão do uvicorn, cada entrada no
escritório gravava um token Microsoft válido por ~1 h nos logs do EasyPanel. O
`?t=` do `meu-status` é o token da sala — menos grave, mas pelo mesmo caminho.
"""
import logging

from app.escritorio.log_sem_query import SemQueryDoEscritorio


def _registro(caminho: str) -> logging.LogRecord:
    # Formato do uvicorn: '%s - "%s %s HTTP/%s" %d' com (cliente, método, caminho, versão, status)
    return logging.LogRecord("uvicorn.access", logging.INFO, "", 0,
                             '%s - "%s %s HTTP/%s" %d',
                             ("1.2.3.4:5", "GET", caminho, "1.1", 200), None)


def test_corta_a_query_da_admin_api():
    r = _registro("/escritorio-wa/api/room/access?userIdentifier=a%40hs.com&accessToken=eyJ.SEGREDO")
    assert SemQueryDoEscritorio().filter(r) is True
    assert "SEGREDO" not in r.getMessage() and "a%40hs.com" not in r.getMessage()
    assert "/escritorio-wa/api/room/access" in r.getMessage()


def test_corta_o_token_do_script():
    r = _registro("/escritorio/meu-status?t=eyJ.TOKEN")
    SemQueryDoEscritorio().filter(r)
    assert "TOKEN" not in r.getMessage()


def test_nao_mexe_nas_outras_rotas():
    r = _registro("/gifs?q=gato")
    SemQueryDoEscritorio().filter(r)
    assert "/gifs?q=gato" in r.getMessage()


def test_registro_fora_do_formato_passa_intacto():
    r = logging.LogRecord("uvicorn.access", logging.INFO, "", 0, "texto solto", None, None)
    assert SemQueryDoEscritorio().filter(r) is True
    assert r.getMessage() == "texto solto"


def test_filtro_instalado_no_logger_do_uvicorn():
    import app.main  # noqa: F401 — instala ao importar
    assert any(isinstance(f, SemQueryDoEscritorio) for f in logging.getLogger("uvicorn.access").filters)
