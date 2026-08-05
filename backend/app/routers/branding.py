"""Identidade visual da instalação — substitui as consultas diretas à tabela
`public.branding`.

A leitura é anônima de propósito: a tela de login precisa da marca antes de
existir sessão. Era assim no Supabase também (policy "Public read branding",
`USING (true)` para anon). A escrita é restrita a super_admin.
"""

from fastapi import APIRouter, Depends

from app.database import sessao
from app.dependencies import Usuario, exige_papel
from app.routers.schemas import BrandingIn, BrandingOut

router = APIRouter(prefix="/branding", tags=["branding"])

# Marca padrão de uma instalação nova. Os arquivos vivem em frontend/public/,
# servidos pela própria instalação — nada depende de linha semeada no banco.
PADRAO = BrandingOut(
    company_name="HS.OS",
    primary_color="203 79% 44%",  # #1885c8, o azul da marca Health & Safety
    logo="/HS-OS-logo.png",
    logo_light="/HS-OS-logo.png",
    logo_dark="/HS-OS-logo.png",
    mark_light="/logo-hs-padrao.png",
    mark_dark="/logo-hs-padrao.png",
    favicon_url="/hs.ico",
    pwa_icon_url="/HS-OS-logo.png",
)

_COLUNAS = """
    company_name, primary_color, logo, logo_light, logo_dark,
    mark_light, mark_dark, favicon_url, pwa_icon_url
"""


@router.get("", response_model=BrandingOut)
async def ler_branding():
    """Anônimo — a tela de login depende disto."""
    async with sessao(role="anon") as conn:
        linha = await conn.fetchrow(f"SELECT {_COLUNAS} FROM public.branding LIMIT 1")

    if linha is None:
        return PADRAO
    # Campo vazio no banco cai no padrão, em vez de virar logo quebrado na tela.
    dados = {k: (v or getattr(PADRAO, k)) for k, v in dict(linha).items()}
    return BrandingOut(**dados)


@router.put("", response_model=BrandingOut)
async def gravar_branding(
    dados: BrandingIn,
    _: Usuario = Depends(exige_papel("super_admin")),
):
    """Uma linha só por instalação: atualiza a existente ou cria a primeira."""
    async with sessao(role="service_role") as conn:
        existente = await conn.fetchval("SELECT id FROM public.branding LIMIT 1")
        valores = dados.model_dump()

        if existente:
            atribuicoes = ", ".join(f"{c} = ${i}" for i, c in enumerate(valores, start=1))
            linha = await conn.fetchrow(
                f"UPDATE public.branding SET {atribuicoes}, updated_at = now() "
                f"WHERE id = ${len(valores) + 1} RETURNING {_COLUNAS}",
                *valores.values(),
                existente,
            )
        else:
            colunas = ", ".join(valores)
            marcadores = ", ".join(f"${i}" for i in range(1, len(valores) + 1))
            linha = await conn.fetchrow(
                f"INSERT INTO public.branding ({colunas}) VALUES ({marcadores}) "
                f"RETURNING {_COLUNAS}",
                *valores.values(),
            )

    return BrandingOut(**dict(linha))
