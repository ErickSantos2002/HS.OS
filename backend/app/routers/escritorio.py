"""O escritório visto do HS.OS: quem está lá agora, e o status que o mapa puxa.

Spec: `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`.

⚠️ **`/meu-status` é chamado pelo script do mapa, num iframe de origem `null`.**
A resposta sai com `Access-Control-Allow-Origin: *` também no 401, e por isso é
`JSONResponse` montada aqui: um `HTTPException` sairia sem o cabeçalho, o
navegador esconderia o status e o script não saberia que deve desistir. O
`CORSMiddleware` global não remove o `*` (só acrescenta para origem conhecida).
A autenticação é o token da sala na query (GET simples, sem cabeçalho próprio,
para não disparar preflight); ele só serve para isto.
"""

import jwt
from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse

from app.database import sessao
from app.dependencies import usuario_atual
from app.escritorio.presenca import presenca
from app.escritorio.status_wa import status_wa
from app.escritorio.token_sala import ler_token_sala

router = APIRouter(prefix="/escritorio", tags=["escritorio"])

_QUALQUER_ORIGEM = {"Access-Control-Allow-Origin": "*"}


async def _perfis(emails: list[str]) -> dict[str, dict]:
    """`email → {user_id, avatar_url, full_name}` de quem tem conta, por `lower(email)`."""
    if not emails:
        return {}
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            """
            SELECT lower(p.email) AS email, p.id::text AS user_id, p.avatar_url, p.full_name
              FROM public.profiles p
             WHERE lower(p.email) = ANY($1::text[])
            """,
            emails,
        )
    return {l["email"]: dict(l) for l in linhas}


async def _status(email: str) -> tuple[str | None, str | None] | None:
    """`(custom_status, custom_status_emoji)` do perfil; `None` se não houver conta."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT custom_status, custom_status_emoji FROM public.profiles WHERE lower(email) = $1 LIMIT 1",
            email,
        )
    if linha is None:
        return None
    return linha["custom_status"], linha["custom_status_emoji"]


@router.get("/presenca")
async def quem_esta(_usuario=Depends(usuario_atual)):
    estado = presenca  # lido do módulo a cada chamada (o teste o troca)
    pessoas = estado.pessoas()
    perfis = await _perfis([p["email"] for p in pessoas])
    lista = []
    for p in pessoas:
        perfil = perfis.get(p["email"]) or {}
        lista.append({
            "email": p["email"],
            "nome": perfil.get("full_name") or p["nome"],
            "user_id": perfil.get("user_id"),
            "avatar_url": perfil.get("avatar_url"),
            "desde": p["desde"],
        })
    lista.sort(key=lambda x: (x["nome"].casefold(), x["email"]))
    return {"conectado": estado.conectado, "pessoas": lista}


@router.get("/meu-status")
async def meu_status(t: str = ""):
    try:
        email = ler_token_sala(t)
    except jwt.PyJWTError:
        return JSONResponse(
            {"detail": "Token da sala ausente, inválido ou vencido."},
            status_code=401,
            headers=_QUALQUER_ORIGEM,
        )
    status = await _status(email.lower())
    label, emoji = status if status else (None, None)
    return JSONResponse(
        {"wa_status": status_wa(label), "emoji": emoji, "label": label},
        headers=_QUALQUER_ORIGEM,
    )
