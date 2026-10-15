"""Busca de GIF pelo backend (15/10/2026).

O botão GIF dava 401 em produção desde sempre: o front chamava o Giphy direto
com `VITE_GIPHY_API_KEY`, que o build não recebia, e caía numa chave reserva
(`LIVDSRZULELA`) que é demo do **Tenor**, não do Giphy. A chave agora mora no
backend e não desce para o navegador.

⚠️ O 401 do Giphy NÃO pode ser repassado: o `api.ts` trata 401 como sessão
vencida e desloga a pessoa. Clicar em GIF com a chave errada a jogaria na tela
de login.
"""
import asyncio

import pytest
from fastapi import HTTPException

from app.routers import gifs


GIF = {"id": "g1", "title": "oi",
       "images": {"fixed_width": {"url": "p.gif", "webp": "p.webp", "width": "200", "height": "150"},
                  "original": {"url": "o.gif", "width": "480", "height": "360"},
                  "downsized_medium": {"url": "d.gif", "width": "400", "height": "300"}}}


def test_mapeia_preview_em_webp_e_envio_no_downsized():
    assert gifs.mapear({"data": [GIF]}) == [{
        "id": "g1", "title": "oi", "previewUrl": "p.webp", "url": "d.gif",
        "width": 400, "height": 300}]


def test_gif_malformado_e_pulado_em_vez_de_derrubar_a_lista():
    assert gifs.mapear({"data": [{"id": "x"}, GIF, None]})[0]["id"] == "g1"
    assert len(gifs.mapear({"data": [{"id": "x"}, GIF, None]})) == 1
    assert gifs.mapear({}) == []


def test_sem_busca_e_trending_com_busca_e_search():
    url, params = gifs.requisicao("", 0, "k")
    assert url.endswith("/trending") and "q" not in params
    url, params = gifs.requisicao("  bom dia ", 24, "k")
    assert url.endswith("/search") and params["q"] == "bom dia" and params["offset"] == 24
    assert params["api_key"] == "k"


def test_sem_chave_responde_503_dizendo_o_que_falta(monkeypatch):
    async def sem(_nome):
        return None
    monkeypatch.setattr(gifs, "ler_segredo", sem)
    with pytest.raises(HTTPException) as e:
        asyncio.run(gifs.buscar_gifs(q="", offset=0, _usuario=None))
    assert e.value.status_code == 503 and "GIPHY_API_KEY" in e.value.detail


def test_401_do_giphy_vira_502_e_nao_desloga_a_pessoa(monkeypatch):
    async def com(_nome):
        return "chave-errada"

    async def recusa(url, params):
        return 401, {}
    monkeypatch.setattr(gifs, "ler_segredo", com)
    monkeypatch.setattr(gifs, "_chamar_giphy", recusa)
    with pytest.raises(HTTPException) as e:
        asyncio.run(gifs.buscar_gifs(q="", offset=0, _usuario=None))
    assert e.value.status_code == 502 and "401" in e.value.detail
