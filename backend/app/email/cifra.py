"""Cifra do refresh token da Microsoft (Fernet, `EMAIL_CHAVE_CIFRA`).

⚠️ O usuário de leitura da empresa enxerga a `email_contas` (privilégios
padrão do banco). É esta cifra, e não a permissão da tabela, que impede quem
tem a leitura de ler e enviar e-mail como qualquer pessoa conectada.
"""
from cryptography.fernet import Fernet, InvalidToken

from app.config import settings


class ErroCifra(Exception):
    """Sem chave, ou token que esta chave não abre. Nunca carrega o conteúdo."""


def _fernet() -> Fernet:
    if not settings.EMAIL_CHAVE_CIFRA:
        raise ErroCifra("EMAIL_CHAVE_CIFRA ausente — e-mail dos bots desligado")
    try:
        return Fernet(settings.EMAIL_CHAVE_CIFRA.encode())
    except ValueError as e:
        raise ErroCifra("EMAIL_CHAVE_CIFRA inválida (não é chave Fernet)") from e


def cifrar(texto: str) -> str:
    return _fernet().encrypt(texto.encode()).decode()


def decifrar(token: str) -> str:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken as e:
        raise ErroCifra("o token não abre com a EMAIL_CHAVE_CIFRA atual") from e
