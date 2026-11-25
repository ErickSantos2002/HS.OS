"""PK-02 — a ponte do artefato vivo só atende o dono (25/11/2026).

⚠️ **O que custaria:** `/artefatos/consultar` rodava com o token de QUEM VÊ.
Qualquer logado abre artefato alheio pelo id (liberado em 17/08), então uma
página gerada sob injeção no chat de qualquer pessoa, aberta pelo CEO, lia
`conversations`, `channel_messages`, `drafts` e `notifications` dele. O
`/integracoes/invocar` gastava cota da empresa em nome de quem abrisse.
"""
import asyncio
from contextlib import asynccontextmanager

import pytest
from pydantic import ValidationError

from app.dependencies import Usuario
from app.routers import artefatos, integracoes

DONO = "11111111-1111-1111-1111-111111111111"
OUTRA = Usuario(id="22222222-2222-2222-2222-222222222222", email="b@hs.com", papel="administrador")
ART = "33333333-3333-3333-3333-333333333333"


class _Conn:
    def __init__(self, dono):
        self.dono, self.consultou = dono, False

    async def fetchval(self, sql, *_):
        assert "live_artifacts" in sql
        return self.dono

    async def fetch(self, *_):
        self.consultou = True
        return []


def _banco(monkeypatch, modulo, dono):
    conn = _Conn(dono)

    @asynccontextmanager
    async def sessao(**_):
        yield conn
    monkeypatch.setattr(artefatos, "sessao", sessao)
    monkeypatch.setattr(modulo, "sessao", sessao)
    return conn


def test_consultar_exige_o_artefato():
    with pytest.raises(ValidationError):
        artefatos.ConsultaIn(table="conversations")


def test_consultar_recusa_quem_nao_e_dono(monkeypatch):
    conn = _banco(monkeypatch, artefatos, DONO)
    r = asyncio.run(artefatos.consultar(
        artefatos.ConsultaIn(table="conversations", artefato_id=ART), OUTRA))
    assert r["code"] == "not_owner" and not conn.consultou


def test_consultar_recusa_artefato_apagado_ou_inexistente(monkeypatch):
    conn = _banco(monkeypatch, artefatos, None)
    r = asyncio.run(artefatos.consultar(
        artefatos.ConsultaIn(table="conversations", artefato_id=ART), OUTRA))
    assert r["code"] == "not_owner" and not conn.consultou


def test_consultar_atende_o_dono(monkeypatch):
    conn = _banco(monkeypatch, artefatos, OUTRA.id)
    r = asyncio.run(artefatos.consultar(
        artefatos.ConsultaIn(table="conversations", artefato_id=ART), OUTRA))
    assert r.get("success") and conn.consultou


def test_invocar_recusa_quem_nao_e_dono(monkeypatch):
    conn = _banco(monkeypatch, integracoes, DONO)
    r = asyncio.run(integracoes.invocar(
        integracoes.ChamadaIn(integration="meta", endpoint="insights", artefato_id=ART), OUTRA))
    assert r["code"] == "not_owner" and not conn.consultou


def test_invocar_exige_o_artefato():
    with pytest.raises(ValidationError):
        integracoes.ChamadaIn(integration="meta", endpoint="insights")
