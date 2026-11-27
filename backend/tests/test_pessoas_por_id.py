"""Quem é quem pelo ID, não pelo e-mail (27/11/2026).

Em 27/11 a conta do Erick passou de `ti@` para `erick.santos@` (M365 + bancos +
`profiles.email`), e o Midas passou a recusá-lo: o `USER.md` liberava dado
financeiro "por nome e e-mail". O `np@` do Nicholson e os e-mails de setor
(`comercial01@` …) vão pelo mesmo caminho nas próximas semanas. O id de
`profiles` não muda com o e-mail — é ele que identifica.
"""
import asyncio
import re

import pytest

from app import pessoas_chave as pc
from app.agentes import midas
from app.bots_pessoais import FORA_POR_DECISAO
from app.sistemas import datacore

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")


def test_os_ids_sao_uuid():
    assert UUID.match(pc.NICHOLSON_ID) and UUID.match(pc.ERICK_ID)


def test_midas_libera_pelo_id_e_nao_cita_email():
    assert pc.NICHOLSON_ID in midas.USER and pc.ERICK_ID in midas.USER
    assert "@healthsafetytech.com" not in midas.USER


def test_nicholson_fica_sem_guardi_pelo_id():
    assert FORA_POR_DECISAO == frozenset({pc.NICHOLSON_ID})


def test_datacore_entra_com_o_email_atual_do_nicholson(monkeypatch):
    vistos = {}

    async def email(uid):
        vistos["uid"] = uid
        return "nicholson.p@healthsafetytech.com"

    async def chamar_sistema(aud, nome, url, transporte, msgs, email_, bot, *a, **k):
        vistos["email"] = email_
        return {"ok": 1}

    monkeypatch.setattr(datacore, "email_atual", email)
    monkeypatch.setattr(datacore, "chamar_sistema", chamar_sistema)
    asyncio.run(datacore.chamar_como_financeiro("GET", "/inadimplencia/resumo"))
    assert vistos == {"uid": pc.NICHOLSON_ID, "email": "nicholson.p@healthsafetytech.com"}


def test_datacore_sem_perfil_do_nicholson_diz_o_que_falta(monkeypatch):
    async def nenhum(uid):
        return None
    monkeypatch.setattr(datacore, "email_atual", nenhum)
    with pytest.raises(datacore.ErroSistema) as e:
        asyncio.run(datacore.chamar_como_financeiro("GET", "/inadimplencia/resumo"))
    assert "Nicholson" in str(e.value)
