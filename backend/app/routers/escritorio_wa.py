"""Admin API do WorkAdventure — o escritório pergunta ao HS.OS quem entra e quem edita.

No serviço `wa` (só no `play`): `ADMIN_API_URL=https://hsosapi.healthsafetytech.com/escritorio-wa`.
Spec: `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`.
As regras ficam em `app/escritorio/wa.py`, puras; aqui só a fiação.

⚠️ **`/api/capabilities` não toca banco nem segredo.** O `play` a chama no boot e
repete a cada 500 ms até dar certo, e só então sobe. Se ela dependesse do
Postgres, banco fora = escritório fora, inclusive para quem já estava dentro.

⚠️ **O `Authorization` chega cru**, sem `Bearer` (`AdminApi.ts` manda
`${ADMIN_API_TOKEN}` puro). Aceitamos os dois. `/api/capabilities` vem sem cabeçalho.

⚠️ **Com a Admin API ligada, `START_ROOM_URL` e `MAP_EDITOR_ALLOWED_USERS` do WA
deixam de valer**: a raiz e a permissão do editor passam a ser daqui
(`ESCRITORIO_SALA_INICIAL`, `ESCRITORIO_EDITORES`).
"""

import hmac
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response, status

from app.config import settings
from app.database import sessao
from app.escritorio import wa
from app.escritorio.token_sala import emitir_token_sala
from app.integracoes import ler_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/escritorio-wa", include_in_schema=False)


async def _exige_token_wa(authorization: str | None = Header(default=None)) -> None:
    esperado = await ler_segredo("ESCRITORIO_ADMIN_API_TOKEN")
    if not esperado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Admin API do escritório não configurada.")
    recebido = (authorization or "").strip()
    if recebido[:7].lower() == "bearer ":
        recebido = recebido[7:].strip()
    if not recebido or not hmac.compare_digest(recebido.encode(), esperado.encode()):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Token inválido.")


_protegida = [Depends(_exige_token_wa)]


async def _conta(email: str) -> bool | None:
    """`is_active` da conta do HS.OS com esse e-mail; `None` se não houver conta."""
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT u.is_active FROM auth.users u WHERE lower(u.email) = $1", email
        )
    if not linhas:
        return None
    # Duas contas com o mesmo e-mail em caixas diferentes: basta uma ativa.
    return any(l["is_active"] for l in linhas)


async def _membros(texto: str) -> list[dict]:
    """Até 20 contas ativas, do domínio permitido, por nome ou e-mail."""
    dominios = wa.lista_de_config(settings.ESCRITORIO_DOMINIOS)
    padrao = f"%{texto.strip()}%"
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """
            SELECT lower(u.email) AS email, p.full_name
              FROM auth.users u
              LEFT JOIN public.profiles p ON p.id = u.id
             WHERE u.is_active
               AND split_part(lower(u.email), '@', 2) = ANY($2::text[])
               AND (p.full_name ILIKE $1 OR u.email ILIKE $1)
             ORDER BY p.full_name NULLS LAST, u.email
             LIMIT 20
            """,
            padrao, dominios,
        )
    return [dict(l) for l in linhas]


def _membro(linha: dict) -> dict:
    return {"id": linha["email"], "name": linha.get("full_name") or linha["email"], "email": linha["email"]}


@router.get("/api/capabilities")
async def capacidades():
    # Nenhuma capacidade: woka, companheiro, nome e ICE seguem nas
    # implementações locais do WA, que só olham para cá se anunciarmos.
    return {}


@router.get("/api/map", dependencies=_protegida)
async def mapa(playUri: str = Query(...)):
    return wa.detalhes_do_mapa(playUri, settings.ESCRITORIO_MAP_STORAGE_URL, settings.ESCRITORIO_SALA_INICIAL)


@router.get("/api/room/access", dependencies=_protegida)
async def acesso(request: Request, userIdentifier: str | None = None):
    email = wa.normalizar_email(userIdentifier)
    if not email or not wa.dominio_permitido(email, wa.lista_de_config(settings.ESCRITORIO_DOMINIOS)):
        return wa.recusa(
            "FORA_DA_EMPRESA",
            "Acesso negado",
            "Este escritório é só da Health & Safety",
            "Entre com a conta Microsoft da empresa.",
        )

    try:
        ativa = await _conta(email)
    except Exception:  # noqa: BLE001 — banco fora não pode virar "acesso negado"
        logger.exception("escritorio-wa: não foi possível conferir a conta de %s", email)
        return wa.espera(
            "HSOS_INDISPONIVEL",
            "Um instante",
            "Não foi possível conferir o seu acesso agora",
            "Tentaremos de novo em alguns segundos.",
        )
    if ativa is False:
        return wa.recusa(
            "CONTA_DESATIVADA",
            "Acesso negado",
            "Conta desativada",
            "Sua conta no HS.OS está desativada. Fale com o administrador.",
        )

    # O axios manda `characterTextureIds[]=x`; aceitamos os dois nomes.
    ids = request.query_params.getlist("characterTextureIds") + request.query_params.getlist(
        "characterTextureIds[]"
    )
    return wa.resposta_de_acesso(
        email,
        editor=email in wa.lista_de_config(settings.ESCRITORIO_EDITORES),
        texturas=wa.resolver_texturas(ids),
        token_sala=emitir_token_sala(email),
    )


@router.get("/api/members", dependencies=_protegida)
async def membros(searchText: str = ""):
    return [_membro(l) for l in await _membros(searchText)]


@router.get("/api/members/{member_id}", dependencies=_protegida)
async def membro(member_id: str):
    email = wa.normalizar_email(member_id)
    if email:
        for linha in await _membros(email):
            if linha["email"] == email:
                return {**_membro(linha), "visitCardUrl": None, "chatID": None}
    raise HTTPException(status.HTTP_404_NOT_FOUND, "Membro não encontrado.")


@router.get("/api/room/tags", dependencies=_protegida)
@router.get("/api/world/tags", dependencies=_protegida)
@router.get("/api/room/sameWorld", dependencies=_protegida)
async def listas_vazias():
    return []


async def _registrar(request: Request) -> Response:
    corpo = (await request.body())[:2000]
    logger.info("escritorio-wa: %s %s — %r", request.method, request.url.path, corpo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/report", dependencies=_protegida)
async def denuncia(request: Request):
    return await _registrar(request)


@router.post("/api/ban", dependencies=_protegida)
async def banimento(request: Request):
    return await _registrar(request)


@router.post("/api/room/message/{mid}/read", dependencies=_protegida)
async def mensagem_lida(mid: str, request: Request):
    return await _registrar(request)


@router.get("/api/room-api/authorization", dependencies=_protegida)
async def room_api():
    return {"success": False, "error": "PERMISSION_DENIED", "message": "Room API desligada no HS.OS"}
