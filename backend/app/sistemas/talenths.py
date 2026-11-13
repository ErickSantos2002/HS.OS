"""Cliente do TalentHS com token de agente (aud=talenths) — spec
`docs/superpowers/specs/2026-11-13-guardi-talenths-design.md`.

O Guardi lê o TalentHS como o DONO (e-mail resolvido pelo `dono_id`, nunca
vindo do agente). Só GET nesta fase. Do lado de lá, o token entra como o
`user_id` daquele e-mail e passa pelos mesmos checks de papel das telas; sem
`HSOS_AGENTE_CHAVE_PUBLICA` lá, todo token dá 401.

A API é publicada sem prefixo em `TALENTHS_API_URL` (domínio próprio da API,
não o do front).
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.sistemas.taskhs import ErroSistema, chamar_sistema

__all__ = ["ErroSistema", "chamar", "AUD"]

AUD = "talenths"
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "o seu dono não tem conta ativa no TalentHS (ou o acesso do Guardi ainda não foi ligado lá)",
    # ⚠️ 403 é o papel do dono lá (quase sempre: só o RH vê) — não é falha do Guardi.
    403: "o login do seu dono no TalentHS não vê isso (essa visão é do RH)",
    404: "não encontrado no TalentHS",
}


async def chamar(email: str, bot: str, caminho: str, params=None, dono: str | None = None) -> Any:
    """Sempre GET. `caminho` vem do catálogo (`app/talenths_consultas.py`)."""
    return await chamar_sistema(AUD, "TalentHS", settings.TALENTHS_API_URL, _transporte, _MSG,
                                email, bot, "GET", caminho, params=params, dono=dono)
