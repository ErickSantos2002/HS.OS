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
    p.id::text AS id, p.email, p.full_name, p.avatar_url, p.status,
    to_char(p.last_seen_at,         'YYYY-MM-DD"T"HH24:MI:SSOF') AS last_seen_at,
    p.custom_status, p.custom_status_emoji,
    to_char(p.custom_status_set_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS custom_status_set_at
"""

# Um usuário pode ter mais de uma linha em `user_roles`; vale o papel mais forte.
# O front fazia exatamente isto com um mapa e uma tabela de prioridade —
# `{ super_admin: 1, member: 2, user: 3 }`, menor ganha. Aqui é ORDER BY + LIMIT 1.
_PAPEL = """
    COALESCE((
        SELECT r.role::text FROM public.user_roles r
         WHERE r.user_id = p.id
         ORDER BY CASE r.role::text
                    WHEN 'super_admin' THEN 1
                    WHEN 'member'      THEN 2
                    ELSE 3
                  END
         LIMIT 1
    ), 'user') AS role
"""


@router.get("", response_model=list[PerfilOut])
async def listar(usuario: Usuario = Depends(usuario_atual)):
    """Usado pelas telas que montam listas de pessoas (membros de canal,
    menções, permissões de agente)."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p "
            f"ORDER BY p.full_name NULLS LAST, p.email"
        )
    return [PerfilOut(**dict(l)) for l in linhas]


@router.get("/me", response_model=PerfilOut)
async def meu_perfil(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1::uuid",
            usuario.id,
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
        # `RETURNING` não enxerga alias de tabela, e `_COLUNAS` passou a ser
        # qualificado com `p.` para conviver com a subconsulta do papel. Só o id
        # volta daqui; o resto é relido logo abaixo, já com o papel junto.
        atualizado = await conn.fetchval(
            f"UPDATE public.profiles SET {atribuicoes}, updated_at = now() "
            f"WHERE id = ${len(campos) + 1}::uuid RETURNING id",
            *campos.values(),
            usuario.id,
        )
        if atualizado is None:
            # A policy "Users update own profile" filtra por id = auth.uid(); zero
            # linhas aqui significa perfil inexistente, não falta de permissão.
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Perfil não encontrado.")
        linha = await conn.fetchrow(
            f"SELECT {_COLUNAS}, {_PAPEL} FROM public.profiles p WHERE p.id = $1::uuid",
            usuario.id,
        )
    return PerfilOut(**dict(linha))
