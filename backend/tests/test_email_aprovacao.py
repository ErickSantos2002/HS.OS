"""Aprovar o e-mail preparado pelo bot.

⚠️ O clique do dono é a ÚNICA porta de saída para terceiros. O que se tranca:
- só o dono vê e envia (outro usuário recebe 404, não 403 — não confirma que
  o pendente existe);
- "Enviar" manda exatamente o que o cartão mostrou: o hash do rascunho relido
  agora tem que bater com o hash que o cartão exibiu. Se o rascunho foi
  editado no Outlook depois, 409 e o cartão recarrega;
- enviado/descartado/vencido não envia de novo.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException

from app.dependencies import Usuario
from app.email import regras
from app.routers import email as rota

ERICK = Usuario("u-erick", "ti@healthsafetytech.com", "administrador")
OUTRO = Usuario("u-outro", "x@healthsafetytech.com", "administrador")

RASCUNHO = {"id": "g1", "subject": "Proposta",
            "toRecipients": [{"emailAddress": {"address": "cliente@y.com"}}], "ccRecipients": [],
            "body": {"contentType": "text", "content": "Segue."}}


def _pend(**k):
    base = {"id": "p1", "user_id": "u-erick", "caixa_de": "ti@healthsafety.com.br", "graph_id": "g1",
            "status": "pendente", "erro": None, "criado_em": datetime.now(timezone.utc)}
    return {**base, **k}


class Conn:
    def __init__(self, pend):
        self.pend, self.updates = pend, []

    async def fetchrow(self, sql, *a):
        if "FROM public.email_pendentes" in sql:
            return self.pend if self.pend and a[0] == self.pend["id"] and a[1] == self.pend["user_id"] else None
        return None

    async def fetchval(self, sql, *a):
        return None

    async def execute(self, sql, *a):
        if "UPDATE public.email_pendentes" in sql:
            self.updates.append(a)
            for st in ("enviado", "descartado", "vencido", "erro"):
                if f"'{st}'" in sql:
                    self.pend = {**self.pend, "status": st}

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def amb(monkeypatch):
    estado = {"conn": Conn(_pend()), "enviados": [], "rascunho": dict(RASCUNHO)}
    monkeypatch.setattr(rota, "sessao", lambda **k: estado["conn"])

    async def access(conn, user_id):
        return "tok", "ti@healthsafetytech.com"
    monkeypatch.setattr(rota.contas, "access_token", access)

    async def ler(*a, **k):
        return estado["rascunho"]
    monkeypatch.setattr(rota.graph, "ler", ler)

    async def enviar(*a):
        estado["enviados"].append(a)
    monkeypatch.setattr(rota.graph, "enviar_rascunho", enviar)

    async def apagar(*a):
        pass
    monkeypatch.setattr(rota.graph, "apagar", apagar)

    async def evento(*a, **k):
        pass
    monkeypatch.setattr(rota.contas, "evento", evento)
    return estado


def test_outro_usuario_recebe_404(amb):
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.ver_pendente("p1", OUTRO))
    assert e.value.status_code == 404


def test_ver_mostra_o_rascunho_e_o_hash(amb):
    v = asyncio.run(rota.ver_pendente("p1", ERICK))
    assert v["de"] == "ti@healthsafety.com.br" and v["para"] == ["cliente@y.com"]
    assert v["assunto"] == "Proposta" and v["corpo"] == "Segue." and v["status"] == "pendente"
    assert v["hash"] == regras.hash_rascunho("ti@healthsafety.com.br", RASCUNHO)


def test_enviar_com_hash_certo_envia(amb):
    h = asyncio.run(rota.ver_pendente("p1", ERICK))["hash"]
    asyncio.run(rota.enviar_pendente("p1", rota.EnviarIn(hash=h), ERICK))
    assert len(amb["enviados"]) == 1 and amb["conn"].pend["status"] == "enviado"


def test_rascunho_mudou_depois_do_cartao_nao_envia(amb):
    h = asyncio.run(rota.ver_pendente("p1", ERICK))["hash"]
    amb["rascunho"] = {**RASCUNHO, "toRecipients": [{"emailAddress": {"address": "outro@z.com"}}]}
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.enviar_pendente("p1", rota.EnviarIn(hash=h), ERICK))
    assert e.value.status_code == 409 and amb["enviados"] == []


def test_nao_envia_duas_vezes(amb):
    h = asyncio.run(rota.ver_pendente("p1", ERICK))["hash"]
    asyncio.run(rota.enviar_pendente("p1", rota.EnviarIn(hash=h), ERICK))
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.enviar_pendente("p1", rota.EnviarIn(hash=h), ERICK))
    assert e.value.status_code == 409 and len(amb["enviados"]) == 1


def test_vencido_nao_envia(amb):
    amb["conn"].pend = _pend(criado_em=datetime.now(timezone.utc) - timedelta(hours=25))
    h = regras.hash_rascunho("ti@healthsafety.com.br", RASCUNHO)
    with pytest.raises(HTTPException) as e:
        asyncio.run(rota.enviar_pendente("p1", rota.EnviarIn(hash=h), ERICK))
    assert e.value.status_code == 409 and amb["enviados"] == []


def test_descartar(amb):
    asyncio.run(rota.descartar_pendente("p1", ERICK))
    assert amb["conn"].pend["status"] == "descartado"
