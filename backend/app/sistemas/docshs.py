"""Cliente do DocsHS com token de agente (aud=docshs) — spec
`docs/superpowers/specs/2026-11-11-guardi-docshs-design.md`.

O Guardi lê o DocsHS como o DONO (e-mail resolvido pelo `dono_id`, nunca vindo
do agente). Só GET nesta fase: confirmar leitura, assinar ata e responder
treinamento têm valor de registro na ISO 9001 e continuam atos da pessoa.

Contrato do lado de lá (seção "Para o repositório DocsHS" da spec): o DocsHS
aceita o token só em GET e só nas rotas do catálogo (`app/docshs_consultas.py`),
e aplica a visibilidade do usuário. Sem `HSOS_AGENTE_CHAVE_PUBLICA` lá, todo
token dá 401.

⚠️ A API mora em `DOCSHS_URL + "/api/v1"`, atrás do nginx do front: o backend
do DocsHS não é publicado. Chamar a raiz devolveria o HTML da SPA.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.sistemas.taskhs import ErroSistema, chamar_sistema

__all__ = ["ErroSistema", "chamar", "AUD"]

AUD = "docshs"
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "o seu dono não tem conta ativa no DocsHS (ou o acesso do Guardi ainda não foi ligado lá)",
    403: "o DocsHS não deixa o Guardi ver isso",
    # ⚠️ Nunca "não existe": documento invisível ao cargo do dono também dá 404.
    404: "não encontrado — ou o seu dono não tem acesso a isso no DocsHS",
}


def _base() -> str:
    return settings.DOCSHS_URL.rstrip("/") + "/api/v1"


async def chamar(email: str, bot: str, caminho: str, params=None, dono: str | None = None) -> Any:
    """Sempre GET. `caminho` vem do catálogo, relativo a `/api/v1`."""
    return await chamar_sistema(AUD, "DocsHS", _base(), _transporte, _MSG,
                                email, bot, "GET", caminho, params=params, dono=dono)
