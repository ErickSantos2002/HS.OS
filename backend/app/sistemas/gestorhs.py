"""Cliente do GestorHS com token de agente (aud=gestorhs) — spec
`docs/superpowers/specs/2026-11-11-guardi-gestorhs-design.md`.

O Guardi lê o GestorHS como o DONO (e-mail resolvido pelo `dono_id`, nunca vindo
do agente), com a função que ele tem lá. Na fase 1 só GET; desde a fase 2a
(Expedição, 12/11/2026) também as escritas por cartão — `POST /ordens`,
`POST /caixas/{id}/avancar` e `POST /equipamentos-cliente` —, sempre a partir do
`payload` gravado e no clique do dono (`app/acoes.py`).

Contrato do lado de lá (seção "Para o GestorHS" da spec): o GestorHS aceita o
token em GET nas rotas do catálogo (`app/gestorhs_consultas.py`) e em `/auth/me`,
e nas três escritas acima — e mais nenhuma. Sem `HSOS_AGENTE_CHAVE_PUBLICA` lá, todo token dá 401.

⚠️ Duas URLs: a API é `GESTORHS_API_URL` (gestorhsapi, sem prefixo); o front é
`GESTORHS_URL` e serve só para os links. Chamar o front devolveria o HTML da SPA.
"""
from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.sistemas.taskhs import ErroSistema, chamar_sistema

__all__ = ["ErroSistema", "chamar", "AUD"]

AUD = "gestorhs"
_transporte: httpx.AsyncBaseTransport | None = None   # trocável em teste

_MSG = {
    401: "o seu dono não tem conta ativa no GestorHS (ou o acesso do Guardi ainda não foi ligado lá)",
    403: "o GestorHS não deixa o Guardi ver isso com a função do seu dono",
    404: "não encontrado no GestorHS",
}
# ⚠️ Na escrita, 403 é a FUNÇÃO do dono lá (Consulta abrindo OS), não falta de
# leitura: a mensagem de cima mandaria a pessoa pedir um acesso que ela já tem.
# 409 fica de fora de propósito: o `detail` dele é a regra legível do GestorHS
# ("aparelho já possui OS ativa", desfecho pendente) e o cartão o mostra.
_MSG_ESCRITA = {**_MSG, 403: "a sua função no GestorHS não permite isso"}


async def chamar(email: str, bot: str, caminho: str, params=None, dono: str | None = None,
                 metodo: str = "GET", json: dict | None = None) -> Any:
    """GET nas consultas (o `caminho` vem do catálogo, relativo à raiz da API) e
    POST nas escritas da fase 2a, chamadas só pelos executores do clique."""
    mensagens = _MSG if metodo == "GET" else _MSG_ESCRITA
    return await chamar_sistema(AUD, "GestorHS", settings.GESTORHS_API_URL.rstrip("/"), _transporte,
                                mensagens, email, bot, metodo, caminho, json=json, params=params,
                                dono=dono)
