"""Regras puras da Admin API do WorkAdventure — sem banco, sem settings, sem rede.

Spec: `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`.
Levantado no código-fonte da tag `v1.33.11` do WA:

- **Toda resposta é validada por zod do lado de lá** e resposta fora do formato
  vira "Invalid server response" para todo mundo. Os formatos daqui são os de
  `play/src/pusher/services/AdminApi.ts` (`isFetchMemberDataByUuidSuccessResponse`),
  `libs/messages/src/JsonMessages/MapDetailsData.ts` e `ErrorApiData.ts`.
- **`username` é omitido, nunca `null`.** O schema o aceita como
  `nullable().optional()` e o null apaga o nome que veio do Entra.
- **`group` é obrigatório no mapa** (`z.string().nullable()`, sem optional).
  Vai `null`, como o `back` do WA faz sozinho quando não há Admin API
  (`back/src/Model/GameRoom.ts`, `getMapDetails`).
- `detalhes_do_mapa` é cópia de `LocalAdmin.fetchMapDetails`
  (`play/src/pusher/services/LocalAdmin.ts`), com `authenticationMandatory`
  fixo em `true` e o nome do Entra imposto (`force_opid`).
- `resolver_texturas` é a regra de `LocalWokaService.fetchWokaDetails`: um id
  desconhecido invalida o conjunto (a pessoa volta à escolha do woka). O
  `wokas.json` é cópia de `play/src/pusher/data/woka.json`.
- O `Authorization` chega cru, sem `Bearer` — isso é do router, não daqui.
"""

import json
import re
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit, urlunsplit

_PARTES_DO_WOKA = ("woka", "body", "eyes", "hair", "clothes", "hat", "accessory")


def normalizar_email(valor: str | None) -> str | None:
    """`strip` + minúsculas; `None` quando não é e-mail (o WA manda o `sub` se faltar e-mail)."""
    if not valor:
        return None
    email = valor.strip().lower()
    if "@" not in email:
        return None
    return email


def dominio_permitido(email: str, dominios: list[str]) -> bool:
    """Domínio exato, sem diferenciar maiúsculas. Subdomínio não conta."""
    normalizado = normalizar_email(email)
    if not normalizado:
        return False
    dominio = normalizado.rsplit("@", 1)[1]
    return dominio in {d.strip().lower() for d in dominios if d.strip()}


def lista_de_config(valor: str | None) -> list[str]:
    """`"a, B ,,"` → `["a", "b"]`. Para as variáveis de lista por vírgula."""
    if not valor:
        return []
    return [parte.strip().lower() for parte in valor.split(",") if parte.strip()]


def _erro(tipo: str, code: str, titulo: str, subtitulo: str, detalhes: str) -> dict:
    return {
        "status": "error",
        "type": tipo,
        "code": code,
        "title": titulo,
        "subtitle": subtitulo,
        "details": detalhes,
    }


def recusa(code: str, titulo: str, subtitulo: str, detalhes: str) -> dict:
    """Tela de acesso negado do WA, com o botão de sair (`type: "unauthorized"`)."""
    return _erro("unauthorized", code, titulo, subtitulo, detalhes)


def espera(code: str, titulo: str, subtitulo: str, detalhes: str, ms: int = 10000) -> dict:
    """Tela de "tente de novo" do WA: fecha a porta sem dizer "acesso negado"."""
    return {
        **_erro("retry", code, titulo, subtitulo, detalhes),
        "timeToRetry": ms,
        "canRetryManual": True,
    }


def detalhes_do_mapa(play_uri: str, map_storage_url: str, sala_inicial: str) -> dict:
    """Resposta de `GET /api/map` — cópia de `LocalAdmin.fetchMapDetails`."""
    url = urlsplit(play_uri)
    caminho = url.path or "/"

    if caminho == "/":
        return {"redirectUrl": urlunsplit(url._replace(path=sala_inicial))}

    map_url = None
    wam_url = None
    casou = re.search(r"/~/(.+)", caminho)
    if casou:
        if PurePosixPath(caminho).suffix == ".tmj":
            # Igual ao WA: troca a primeira ocorrência na URL inteira.
            return {"redirectUrl": play_uri.replace(".tmj", ".wam", 1)}
        wam_url = f"{map_storage_url.rstrip('/')}/{casou.group(1)}"
    else:
        casou = re.search(r"/_/[^/]+/(.+)", caminho)
        if not casou:
            return {
                **_erro(
                    "error",
                    "UNSUPPORTED_URL_FORMAT",
                    "Unsupported URL format",
                    "",
                    "Unsupported path: " + caminho,
                ),
            }
        map_url = f"{url.scheme}://{casou.group(1)}"

    detalhes: dict = {
        "group": None,
        "authenticationMandatory": True,
        "opidWokaNamePolicy": "force_opid",
        "contactPage": None,
        "opidLogoutRedirectUrl": None,
    }
    if wam_url:
        detalhes["wamUrl"] = wam_url
    if map_url:
        detalhes["mapUrl"] = map_url
    return detalhes


@lru_cache(maxsize=1)
def _wokas() -> dict:
    return json.loads((Path(__file__).parent / "wokas.json").read_text(encoding="utf-8"))


def resolver_texturas(ids: list[str]) -> tuple[bool, list[dict]]:
    """`(valido, [{id, url}])` — a regra do `LocalWokaService.fetchWokaDetails`."""
    dados = _wokas()
    procurados = list(dict.fromkeys(ids))
    achadas: dict[str, str] = {}
    for parte in _PARTES_DO_WOKA:
        tipo = dados.get(parte)
        if not tipo:
            continue
        for colecao in tipo.get("collections", []):
            for ident in list(procurados):
                textura = next((t for t in colecao.get("textures", []) if t.get("id") == ident), None)
                if textura:
                    achadas[ident] = textura["url"]
                    procurados.remove(ident)
    # Como no WA: id repetido também conta como diferença de tamanho.
    if len(ids) != len(achadas):
        return False, []
    return True, [{"id": i, "url": u} for i, u in achadas.items()]


def resposta_de_acesso(
    email: str, *, editor: bool, texturas: tuple[bool, list[dict]], token_sala: str
) -> dict:
    """Resposta de sucesso de `GET /api/room/access`. **Sem `username`** (ver cabeçalho)."""
    valido, lista = texturas
    return {
        "status": "ok",
        "email": email,
        "userUuid": email,
        "tags": ["admin", "editor"] if editor else [],
        "visitCardUrl": None,
        "isCharacterTexturesValid": valido,
        "characterTextures": lista,
        "isCompanionTextureValid": True,
        "messages": [],
        "userRoomToken": token_sala,
        "activatedInviteUser": True,
        "canEdit": editor,
        "world": "localWorld",
        "canRecord": False,
    }
