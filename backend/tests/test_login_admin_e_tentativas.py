"""PK-04 — admin só pelo SSO e limite de tentativas no login (25/11/2026).

⚠️ **O que custaria:** `POST /auth/login` não tinha limite nem bloqueio, num
repositório público — é a primeira porta que um scanner tenta. E senha certa de
`administrador` abria credencial de conector, publicação de banco para agente e
o gateway, sem o segundo fator que o Entra cobra no SSO. O "bloqueio" da tela
era um contador no React que sumia ao recarregar.
"""
import asyncio
from contextlib import asynccontextmanager

import pytest
from fastapi import HTTPException

from app.auth import router as auth_router
from app.auth import tentativas
from app.auth.schemas import LoginIn
from app.auth.security import gerar_hash


# ── a regra, pura ───────────────────────────────────────────────────────────

def test_cinco_falhas_no_email_bloqueiam():
    assert not tentativas.bloqueia(falhas_email=4, falhas_ip=4)
    assert tentativas.bloqueia(falhas_email=5, falhas_ip=5)


def test_muitas_falhas_no_ip_bloqueiam_mesmo_com_emails_diferentes():
    assert tentativas.bloqueia(falhas_email=0, falhas_ip=30)
    assert not tentativas.bloqueia(falhas_email=0, falhas_ip=29)


def test_guarda_hash_nunca_o_valor():
    h = tentativas.resumo("Ana@HS.com")
    assert "ana" not in h and h == tentativas.resumo("ana@hs.com")


def test_admin_por_senha_so_com_sso_ligado_ou_emergencia():
    """Sem SSO configurado (instalação local) não há outra porta: a senha vale."""
    assert tentativas.admin_pode_por_senha(sso_ativo=False, emergencia=False)
    assert not tentativas.admin_pode_por_senha(sso_ativo=True, emergencia=False)
    assert tentativas.admin_pode_por_senha(sso_ativo=True, emergencia=True)


# ── a rota, com banco de mentira ────────────────────────────────────────────

SENHA = "senha-forte-123"
HASH = gerar_hash(SENHA)


class _Conn:
    def __init__(self, papel, falhas=0):
        self.papel, self.falhas, self.registradas, self.apagou = papel, falhas, 0, False
        self.travou, self.aberta = False, False

    async def fetchrow(self, sql, *_):
        if self.papel is None:
            return None
        return {"id": "u1", "email": "a@hs.com", "password_hash": HASH,
                "is_active": True, "papel": self.papel}

    async def fetchval(self, sql, *_):
        return self.falhas  # as duas contagens (e-mail e IP)

    async def execute(self, sql, *_):
        if "pg_advisory_xact_lock" in sql:
            self.travou = True
        if "INSERT INTO public.login_tentativas" in sql:
            self.registradas += 1
        if "DELETE FROM public.login_tentativas WHERE email_hash" in sql:
            self.apagou = True


@pytest.fixture
def banco(monkeypatch):
    def montar(papel, falhas=0, sso=True, emergencia=False):
        conn = _Conn(papel, falhas)

        @asynccontextmanager
        async def sessao(**_):
            # Como a de verdade: exceção dentro = rollback do que foi gravado.
            conn.aberta = True
            antes = conn.registradas
            try:
                yield conn
            except BaseException:
                conn.registradas = antes
                raise
            finally:
                conn.aberta = False
        monkeypatch.setattr(auth_router, "sessao", sessao)
        monkeypatch.setattr(type(auth_router.settings), "sso_ativo", property(lambda s: sso))
        monkeypatch.setattr(auth_router.settings, "LOGIN_SENHA_ADMIN_EMERGENCIA", emergencia)
        return conn
    return montar


def _login(senha=SENHA):
    return asyncio.run(auth_router.entrar_com_senha(LoginIn(email="a@hs.com", senha=senha), "1.2.3.4"))


def test_admin_com_senha_certa_e_recusado(banco):
    banco("administrador")
    with pytest.raises(HTTPException) as e:
        _login()
    assert e.value.status_code == 403 and "Microsoft" in e.value.detail


def test_admin_com_senha_errada_recebe_o_401_de_sempre(banco):
    """O 403 só depois da senha certa: senão ele revelaria quem é admin."""
    conn = banco("administrador")
    with pytest.raises(HTTPException) as e:
        _login("errada")
    assert e.value.status_code == 401 and conn.registradas == 1


def test_emergencia_reabre_a_senha_do_admin(banco):
    banco("administrador", emergencia=True)
    assert _login().access_token


def test_colaborador_entra_e_zera_as_falhas(banco):
    conn = banco("colaborador")
    assert _login().access_token and conn.apagou


def test_bloqueado_responde_429_sem_conferir_a_senha(banco):
    conn = banco("colaborador", falhas=5)
    with pytest.raises(HTTPException) as e:
        _login()
    assert e.value.status_code == 429 and conn.registradas == 0


def test_email_inexistente_conta_como_falha(banco):
    conn = banco(None)
    with pytest.raises(HTTPException) as e:
        _login()
    assert e.value.status_code == 401 and conn.registradas == 1


def test_a_falha_sobrevive_ao_401(banco):
    """Achado na revisão de segurança: o 401 levantado DENTRO da transação a
    revertia, e o registro da falha morria junto — o limite nunca contava."""
    conn = banco("colaborador")
    with pytest.raises(HTTPException):
        _login("errada")
    assert conn.registradas == 1 and not conn.aberta


def test_tentativa_e_travada_por_email(banco):
    """Contar e gravar em passos soltos deixava pedidos paralelos passarem."""
    conn = banco("colaborador")
    with pytest.raises(HTTPException):
        _login("errada")
    assert conn.travou
