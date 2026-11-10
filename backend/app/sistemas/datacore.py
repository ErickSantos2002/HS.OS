"""Cliente do DataCoreHS com token de agente (aud=datacore) — spec
`docs/superpowers/specs/2026-11-10-iris-inadimplencia-design.md`.

Só a `iris` usa, e só para LER a Inadimplência. Ela entra **como o Nicholson**
(decisão do Erick, 10/11/2026): quem pergunta a ela é ele, quase sempre pela
`nina`, e numa delegação não há "dono do turno" a quem atribuir o pedido. O
e-mail é constante daqui — nunca argumento vindo do agente.

Contrato do lado de lá: o DataCore aceita o token só nas leituras de
`/inadimplencia` e aplica as permissões do usuário (o Nicholson é `admin`).
Sem `HSOS_AGENTE_CHAVE_PUBLICA` lá, todo token dá 401.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.sistemas.taskhs import ErroSistema, chamar_sistema

__all__ = ["ErroSistema", "chamar", "chamar_como_iris", "EMAIL_DA_IRIS_NO_DATACORE"]

AUD = "datacore"
EMAIL_DA_IRIS_NO_DATACORE = "np@healthsafetytech.com"
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "o DataCore não aceitou o acesso da Iris (token de agente ainda não ligado lá?)",
    403: "o DataCore não deixa a Iris ver isso",
    404: "não encontrado no DataCore",
}


async def chamar(email: str, bot: str, metodo: str, caminho: str, params=None,
                 dono: str | None = None) -> Any:
    """O Guardi no DataCore, como o DONO (e-mail resolvido pelo `dono_id`)."""
    return await chamar_sistema(AUD, "DataCore", settings.DATACORE_API_URL, _transporte, _MSG_GUARDI,
                                email, bot, metodo, caminho, params=params, dono=dono)


_MSG_GUARDI = {
    401: "o DataCore não reconheceu o seu dono (sem conta lá, ou o acesso do Guardi ainda não ligado)",
    403: "o login do seu dono no DataCore não permite ver isso",
    404: "não encontrado no DataCore",
}


async def chamar_como_iris(metodo: str, caminho: str, params: dict | list | None = None,
                           dono: str | None = None) -> Any:
    return await chamar_sistema(AUD, "DataCore", settings.DATACORE_API_URL, _transporte, _MSG,
                                EMAIL_DA_IRIS_NO_DATACORE, "iris", metodo, caminho,
                                params=params, dono=dono)
