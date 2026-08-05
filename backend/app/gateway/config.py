"""Resolução da configuração do gateway.

Mesma ordem que a edge function `_shared/gateway-config.ts` usava: a tabela
`public.vps_config` primeiro, `.env` como fallback para quando a linha ainda não
existe. A diferença é o que sai daqui: o token nunca acompanha a resposta de um
endpoint — só circula dentro do processo.
"""

from dataclasses import dataclass

from app.config import settings
from app.database import sessao


@dataclass(frozen=True)
class ConfigGateway:
    url: str
    token: str

    @property
    def configurado(self) -> bool:
        return bool(self.url and self.token)


async def carregar() -> ConfigGateway:
    url = ""
    token = ""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT gateway_url, admin_token FROM public.vps_config LIMIT 1"
        )
    if linha:
        url = (linha["gateway_url"] or "").strip()
        token = (linha["admin_token"] or "").strip()

    return ConfigGateway(
        url=url or settings.OPENCLAW_GATEWAY_URL.strip(),
        token=token or settings.OPENCLAW_ADMIN_TOKEN.strip(),
    )


async def gravar(url: str, token: str | None) -> None:
    """Uma linha só por instalação. `token=None` preserva o token existente —
    é o que permite a tela editar a URL sem precisar reenviar o segredo (que
    ela nunca recebeu)."""
    url = url.strip().rstrip("/")
    async with sessao(role="service_role") as conn:
        existente = await conn.fetchrow("SELECT id FROM public.vps_config LIMIT 1")
        if existente:
            if token is None:
                await conn.execute(
                    "UPDATE public.vps_config SET gateway_url = $1, updated_at = now() WHERE id = $2",
                    url, existente["id"],
                )
            else:
                await conn.execute(
                    "UPDATE public.vps_config SET gateway_url = $1, admin_token = $2, "
                    "updated_at = now() WHERE id = $3",
                    url, token.strip(), existente["id"],
                )
        else:
            await conn.execute(
                "INSERT INTO public.vps_config (gateway_url, admin_token) VALUES ($1, $2)",
                url, (token or "").strip(),
            )
