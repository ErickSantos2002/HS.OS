"""O refresh token da Microsoft lê e envia e-mail como a pessoa. Ele mora no
banco CIFRADO porque o usuário de leitura da empresa enxerga as tabelas
(conferido em 05/11/2026 na `email_contas`) — em claro, quem tem a leitura
mandaria e-mail como qualquer pessoa conectada."""
import pytest
from cryptography.fernet import Fernet

from app.email import cifra


@pytest.fixture
def chave(monkeypatch):
    k = Fernet.generate_key().decode()
    monkeypatch.setattr(cifra.settings, "EMAIL_CHAVE_CIFRA", k)
    return k


def test_ida_e_volta(chave):
    c = cifra.cifrar("refresh-secreto")
    assert c != "refresh-secreto" and "refresh-secreto" not in c
    assert cifra.decifrar(c) == "refresh-secreto"


def test_chave_errada_nao_abre(chave, monkeypatch):
    c = cifra.cifrar("x")
    monkeypatch.setattr(cifra.settings, "EMAIL_CHAVE_CIFRA", Fernet.generate_key().decode())
    with pytest.raises(cifra.ErroCifra):
        cifra.decifrar(c)


def test_sem_chave_recusa(monkeypatch):
    monkeypatch.setattr(cifra.settings, "EMAIL_CHAVE_CIFRA", "")
    with pytest.raises(cifra.ErroCifra, match="EMAIL_CHAVE_CIFRA"):
        cifra.cifrar("x")


def test_redirect_do_email_deriva_do_login(monkeypatch):
    from app.config import settings
    monkeypatch.setattr(settings, "MS_EMAIL_REDIRECT_URI", "")
    monkeypatch.setattr(settings, "MS_REDIRECT_URI", "https://hsosapi.x.com/auth/microsoft/callback")
    assert settings.redirect_email == "https://hsosapi.x.com/email/oauth/callback"
    monkeypatch.setattr(settings, "MS_EMAIL_REDIRECT_URI", "http://localhost:8002/email/oauth/callback")
    assert settings.redirect_email == "http://localhost:8002/email/oauth/callback"
