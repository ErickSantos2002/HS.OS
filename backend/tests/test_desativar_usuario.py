"""Desativar na tela de Usuários tem que barrar o login.

Até 20/10/2026 o `PATCH /profiles/{id}` com `status: "inactive"` só gravava
`profiles.status`. Quem barra o login e cada request é `auth.users.is_active`
(`auth/router.py`, `dependencies.py`), que ficava `true`: a tela dizia
"Inativo" e a pessoa seguia entrando. Ninguém tinha sido desativado desde
agosto, então não houve vítima — mas a próxima pessoa que saísse da empresa
manteria o acesso com o selo de bloqueada.
"""
import asyncio

import pytest

from app.routers import profiles as rota


class _Conn:
    def __init__(self, escritas):
        self.escritas = escritas

    def transaction(self):
        conn = self

        class _T:
            async def __aenter__(self):
                return conn

            async def __aexit__(self, *a):
                return False

        return _T()

    async def fetchval(self, sql, *a):
        return 1

    async def execute(self, sql, *a):
        self.escritas.append((" ".join(sql.split()), a))

    async def fetchrow(self, sql, *a):
        return {"id": a[0], "email": "x@hs.com", "status": "inactive"}


class _Sessao:
    def __init__(self, escritas):
        self.escritas = escritas

    async def __aenter__(self):
        return _Conn(self.escritas)

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def escritas(monkeypatch):
    lista = []
    monkeypatch.setattr(rota, "sessao", lambda **k: _Sessao(lista))
    return lista


class _Admin:
    id = "admin-1"


def _patch(status):
    return asyncio.run(rota.atualizar_perfil("alvo-1", rota.PerfilAdminPatch(status=status), _Admin()))


def _is_active_gravado(escritas):
    return [a for sql, a in escritas if sql.startswith("UPDATE auth.users SET is_active")]


def test_desativar_desliga_o_login(escritas):
    _patch("inactive")
    assert _is_active_gravado(escritas) == [("alvo-1", False)]


def test_reativar_religa_o_login(escritas):
    _patch("active")
    assert _is_active_gravado(escritas) == [("alvo-1", True)]


def test_foto_de_outra_pessoa_vai_para_o_perfil_dela(escritas):
    """A tela de Usuários gravava a foto de outra pessoa no `/profiles/me` —
    no perfil do administrador. A rota de admin tem que aceitar `avatar_url`
    e gravá-lo no perfil do alvo."""
    asyncio.run(rota.atualizar_perfil(
        "alvo-1", rota.PerfilAdminPatch(avatar_url="https://foto"), _Admin()))
    gravou = [a for sql, a in escritas if sql.startswith("UPDATE public.profiles SET avatar_url")]
    assert gravou == [("alvo-1", "https://foto")]
