"""Tira a query string do access log do uvicorn nas rotas do escritório.

⚠️ O `play` do WA manda na query da Admin API o access token da Microsoft da
pessoa (`accessToken=…`), o e-mail e o IP; o script do mapa manda o token da
sala (`?t=…`). O access log padrão do uvicorn grava o caminho com a query —
ou seja, um token Microsoft válido nos logs do EasyPanel a cada entrada.
"""
import logging

_PREFIXOS = ("/escritorio-wa/", "/escritorio/meu-status")


class SemQueryDoEscritorio(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        args = record.args
        # Formato do uvicorn: (cliente, método, caminho com query, versão, status).
        if isinstance(args, tuple) and len(args) >= 3 and isinstance(args[2], str):
            caminho = args[2]
            if caminho.startswith(_PREFIXOS) and "?" in caminho:
                record.args = (*args[:2], caminho.split("?", 1)[0], *args[3:])
        return True


def instalar() -> None:
    logger = logging.getLogger("uvicorn.access")
    if not any(isinstance(f, SemQueryDoEscritorio) for f in logger.filters):
        logger.addFilter(SemQueryDoEscritorio())
