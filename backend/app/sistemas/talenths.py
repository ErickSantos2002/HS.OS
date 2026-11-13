"""Cliente do TalentHS com token de agente (aud=talenths) — spec
`docs/superpowers/specs/2026-11-13-guardi-talenths-design.md`.

O Guardi lê o TalentHS como o DONO (e-mail resolvido pelo `dono_id`, nunca
vindo do agente). Escrita (fase 2, spec `2026-11-13-guardi-talenths-escrita`)
só pelos executores do clique do dono em `app/acoes.py`, com o caminho e o
corpo montados por `app/talenths_escrita.py`. Do lado de lá, o token entra como o
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
# ⚠️ Na escrita, 403 é o PAPEL do dono lá (aprovar é do RH), não falha do Guardi.
# 400/409/422 ficam de fora de propósito: o `detail` deles é a regra legível de lá
# ("Já existe uma solicitação de ajuste pendente") e precisa chegar à pessoa.
_MSG_ESCRITA = {**_MSG, 403: "o papel do seu dono no TalentHS não permite isso"}


async def chamar(email: str, bot: str, caminho: str, params=None, dono: str | None = None,
                 metodo: str = "GET", json: Any = None, files: dict | None = None) -> Any:
    """GET nas consultas (`caminho` do catálogo de `app/talenths_consultas.py`) e na
    conferência do cartão; escrita só pelos executores do clique.

    `files` é o multipart do comentário de meta: lá o texto é o campo de
    FORMULÁRIO `body` (`Form`), mandado como `{"body": (None, texto)}` — parte
    sem nome de arquivo, que o Starlette lê como campo e não como upload."""
    mensagens = _MSG if metodo == "GET" else _MSG_ESCRITA
    return await chamar_sistema(AUD, "TalentHS", settings.TALENTHS_API_URL, _transporte, mensagens,
                                email, bot, metodo, caminho, json=json, params=params, dono=dono,
                                files=files)
