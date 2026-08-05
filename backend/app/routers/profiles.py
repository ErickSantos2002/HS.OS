"""Perfis de usuário — substitui as consultas diretas a `public.profiles`.

O RLS continua valendo: a leitura roda como `authenticated`, então as policies
herdadas decidem o que cada um enxerga. A escrita é limitada ao próprio perfil.
"""

from fastapi import APIRouter, Depends, HTTPException, status

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.routers.schemas import PerfilOut, PerfilPatch

router = APIRouter(prefix="/profiles", tags=["profiles"])

_COLUNAS = """
    id::text AS id, email, full_name, avatar_url, status,
    to_char(last_seen_at,          'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_seen_at,
    custom_status, custom_status_emoji,
    to_char(custom_status_set_at,  'YYYY-MM-DD"T"HH24:MI:SSOF') AS custom_status_set_at
"""


@router.get("", response_model=list[PerfilOut])
async def listar(usuario: Usuario = Depends(usuario_atual)):
    """Usado pelas telas que montam listas de pessoas (membros de canal,
    menções, permissões de agente)."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS} FROM public.profiles ORDER BY full_name NULLS LAST, email"
        )
    return [PerfilOut(**dict(l)) for l in linhas]


@router.get("/me", response_model=PerfilOut)
async def meu_perfil(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS} FROM public.profiles WHERE id = $1::uuid", usuario.id
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
    return PerfilOut(**dict(linha))


@router.patch("/me", response_model=PerfilOut)
async def atualizar_meu_perfil(
    dados: PerfilPatch,
    usuario: Usuario = Depends(usuario_atual),
):
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")

    atribuicoes = ", ".join(f"{c} = ${i}" for i, c in enumerate(campos, start=1))
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"UPDATE public.profiles SET {atribuicoes}, updated_at = now() "
            f"WHERE id = ${len(campos) + 1}::uuid RETURNING {_COLUNAS}",
            *campos.values(),
            usuario.id,
        )
    if linha is None:
        # A policy "Users update own profile" filtra por id = auth.uid(); zero
        # linhas aqui significa perfil inexistente, não falta de permissão.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
    return PerfilOut(**dict(linha))
