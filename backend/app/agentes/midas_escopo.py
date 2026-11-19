"""O escopo de ferramentas do Midas e a decisão de criá-lo. Puro.

Spec: `docs/superpowers/specs/2026-11-18-cfo-midas-design.md`.

⚠️ **O ponto de partida é o `tools` da `iris` lido do gateway**, não uma lista
escrita aqui: o que ela enxerga foi ajustado à mão ao longo de meses, e uma
cópia no código envelheceria em silêncio. Do dela, o Midas muda só isto:

- a entrada `hsos-anexos-iris` vira `hsos-anexos-midas` — cada entrada é a
  identidade de um agente (HMAC do id na URL), e herdar a da `iris` seria ler
  os anexos das conversas dela e enviar arquivo em nome dela;
- ganha `banco-gestorhs` e `banco-hsgrowth` (o que vai virar receita e quando),
  tirando os dois do `deny` — deny ganha de alsoAllow;
- perde `publicar_pagina`: contas a pagar trazem salário por pessoa, dividendos
  e dívida, e a página publicada abre sem login;
- leva as travas de especialista, `gateway` e as três de internet no `deny`.

⚠️ `alsoAllow` com prefixo `mcp__`, `deny` SEM — os dois formatos convivem no
mesmo objeto (ver "Escopo de banco por agente" no CLAUDE.md).
"""
from __future__ import annotations

import copy
from typing import Literal

AGENTE = "midas"
ORIGEM = "iris"
WORKSPACE = f"/root/.openclaw/workspace-{AGENTE}"

_ANEXOS = "hsos-anexos-"
BANCOS_NOVOS = ("mcp__banco-gestorhs__query", "mcp__banco-hsgrowth__query")
PUBLICAR_PAGINA = "hsos-relatorios__publicar_pagina"
DENY_OBRIGATORIO = (
    "sessions_send", "sessions_spawn", "skill_workshop", "cron", "gateway",
    "web_fetch", "x_search", "web_search", PUBLICAR_PAGINA,
)


def _sem_prefixo(nome: str) -> str:
    return nome[len("mcp__"):] if nome.startswith("mcp__") else nome


def _unicos(itens) -> list[str]:
    vistos: list[str] = []
    for x in itens:
        if x not in vistos:
            vistos.append(x)
    return vistos


def tools_do_midas(tools_da_iris: dict) -> dict:
    """O `tools` da `iris` com as trocas do Midas. Devolve cópia.

    ⚠️ **Nunca aplicar direto no gateway: usar `escopo_final`.** Este deny é o
    da `iris` ajustado, e não nega `hsos-anexos-iris` (a dela não está no deny
    dela): aplicado assim, o Midas enxergaria a identidade da `iris`.
    """
    t = copy.deepcopy(tools_da_iris or {})
    da_iris, do_midas = f"{_ANEXOS}{ORIGEM}__", f"{_ANEXOS}{AGENTE}__"

    allow: list[str] = []
    for x in t.get("alsoAllow") or []:
        nome = _sem_prefixo(x)
        if nome.startswith(da_iris):
            allow.append("mcp__" + do_midas + nome[len(da_iris):])
        elif nome.startswith(_ANEXOS) and not nome.startswith(do_midas):
            continue  # identidade de outro agente: nunca
        elif nome == PUBLICAR_PAGINA:
            continue
        else:
            allow.append(x)
    allow = _unicos(allow + list(BANCOS_NOVOS))

    meus = {_sem_prefixo(x) for x in allow}
    deny = [x for x in (t.get("deny") or [])
            if x not in meus and not x.startswith(f"{_ANEXOS}{ORIGEM}__")]
    deny = _unicos(deny + [d for d in DENY_OBRIGATORIO if d not in deny])

    t["alsoAllow"], t["deny"] = allow, deny
    return t


def escopo_final(tools_da_iris: dict, servidores: dict) -> dict:
    """O `tools` que vai para o gateway: `tools_do_midas` com o deny recalculado.

    ⚠️ **Sem o recálculo o Midas veria os anexos da `iris`.** O deny dela não
    nega a própria entrada (é dela), e `alsoAllow` não restringe nada: é o
    `escopo_mcp_do_agente` — o mesmo da criação pela tela — que nega tudo o que
    está declarado em `mcp.servers` e não é do Midas.

    Enquanto `hsos-anexos-midas` não existe (o `publicar-anexos-mcp.py` roda
    depois), a entrada própria sai do `alsoAllow`: o mesmo script a devolve
    quando a declarar.
    """
    from app.routers.integracoes import escopo_mcp_do_agente  # evita ciclo no import

    t = tools_do_midas(tools_da_iris)
    if f"{_ANEXOS}{AGENTE}" not in servidores:
        t["alsoAllow"] = [x for x in t["alsoAllow"] if not _sem_prefixo(x).startswith(_ANEXOS)]
    t = escopo_mcp_do_agente(AGENTE, t, servidores)
    t["deny"] = list(t["deny"]) + [d for d in DENY_OBRIGATORIO if d not in t["deny"]]
    return t


def midas_esta_fechado(tools: dict, servidores: dict) -> bool:
    """A conferência do patch: o escopo relido é o do Midas, inteiro."""
    from app.routers.integracoes import SERVIDOR_ALERTA

    allow = {_sem_prefixo(x) for x in (tools or {}).get("alsoAllow") or []}
    deny = set((tools or {}).get("deny") or [])
    if any(x.startswith(_ANEXOS) and not x.startswith(f"{_ANEXOS}{AGENTE}__") for x in allow):
        return False
    if PUBLICAR_PAGINA in allow or not {_sem_prefixo(b) for b in BANCOS_NOVOS} <= allow:
        return False
    if not set(DENY_OBRIGATORIO) <= deny or allow & deny:
        return False
    todas = {
        f"{s}__{f}"
        for s, c in (servidores or {}).items() if s != SERVIDOR_ALERTA
        for f in ((((c or {}).get("toolFilter") or {}).get("include")) or ["query"])
    }
    return todas - allow <= deny


def decidir_criacao(no_gateway: bool, tem_linha: bool, workspace: str | None
                    ) -> Literal["criar", "adotar", "ja_existe", "colisao"]:
    """O que fazer com o `midas` que já houver.

    - não está no gateway → `criar` (a linha, se houver, é resto e o INSERT a
      respeita com `ON CONFLICT DO NOTHING`);
    - está, com workspace que não é o nosso → `colisao`: é agente de alguém, e
      adotá-lo sobrescreveria os arquivos dele;
    - está, sem linha → `adotar` (execução anterior parou no meio: recebe os
      arquivos);
    - está, com linha → `ja_existe`: Midas vivo, arquivos dele não se tocam.
    """
    if not no_gateway:
        return "criar"
    if workspace not in (None, WORKSPACE):
        return "colisao"
    return "ja_existe" if tem_linha else "adotar"
