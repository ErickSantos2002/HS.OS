"""GIFs do Giphy para o seletor do chat.

A chave (`GIPHY_API_KEY`, ambiente ou `integration_secrets`) fica aqui e não
desce para o navegador. Até 15/10/2026 o front chamava o Giphy direto com uma
`VITE_*` que o build de produção nunca recebeu — e a chave reserva do código
era do Tenor, então o botão GIF respondia 401 desde sempre.
"""
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import Usuario, usuario_atual
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gifs", tags=["gifs"])

_BASE = "https://api.giphy.com/v1/gifs"
_POR_PAGINA = 24


def requisicao(q: str, offset: int, chave: str) -> tuple[str, dict]:
    params = {"api_key": chave, "limit": _POR_PAGINA, "offset": offset,
              "rating": "pg-13", "lang": "pt"}
    termo = (q or "").strip()
    if termo:
        return f"{_BASE}/search", {**params, "q": termo}
    return f"{_BASE}/trending", params


def mapear(corpo: dict) -> list[dict]:
    """Giphy → o `GifResult` da tela. Item sem as imagens esperadas é pulado."""
    saida = []
    for g in (corpo or {}).get("data") or []:
        try:
            img = g["images"]
            previa = img["fixed_width"]
            cheio = img.get("downsized_medium") or img["original"]
            saida.append({
                "id": g["id"], "title": g.get("title") or "GIF",
                "previewUrl": previa.get("webp") or previa["url"], "url": cheio["url"],
                "width": int(cheio.get("width") or 0), "height": int(cheio.get("height") or 0),
            })
        except (KeyError, TypeError, ValueError):
            continue
    return saida


async def _chamar_giphy(url: str, params: dict) -> tuple[int, dict]:
    async with httpx.AsyncClient(timeout=10) as cliente:
        r = await cliente.get(url, params=params)
    return r.status_code, (r.json() if r.status_code == 200 else {})


@router.get("")
async def buscar_gifs(q: str = "", offset: int = Query(default=0, ge=0, le=4999),
                      _usuario: Usuario = Depends(usuario_atual)) -> list[dict]:
    chave = await ler_segredo("GIPHY_API_KEY")
    if not chave:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE,
                            "GIF indisponível: falta configurar GIPHY_API_KEY no backend.")
    url, params = requisicao(q, offset, chave)
    try:
        codigo, corpo = await _chamar_giphy(url, params)
    except httpx.HTTPError as e:
        logger.warning("Giphy fora do ar: %s", e)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "O Giphy não respondeu. Tente de novo.")
    if codigo != 200:
        # ⚠️ Nunca repassar o status: 401 aqui deslogaria a pessoa (`api.ts`).
        logger.warning("Giphy respondeu %s", codigo)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                            f"O Giphy recusou a busca (HTTP {codigo}). Confira a GIPHY_API_KEY.")
    return mapear(corpo)
