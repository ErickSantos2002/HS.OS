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
    #: A URL veio do `.env`, então a tela não deve oferecer edição.
    fixado_por_env: bool = False

    @property
    def configurado(self) -> bool:
        return bool(self.url and self.token)


async def carregar() -> ConfigGateway:
    """Ordem: `.env` primeiro, `vps_config` depois.

    A herança do dn.os era o inverso — banco primeiro, env como fallback — e isso
    quebra com mais de um ambiente: existe UMA linha em `vps_config` e ela não
    consegue valer para produção e para a máquina de desenvolvimento ao mesmo
    tempo. Produção alcança o gateway em `172.18.0.1` (bridge do Swarm) e o
    desenvolvimento em `127.0.0.1` (túnel SSH local); com o banco vencendo, um
    dos dois sempre aponta para um endereço inalcançável.

    Com o `.env` vencendo, cada ambiente fixa o seu e a tabela continua servindo
    de padrão para quem não define nada. `/gateway/config` avisa quando o valor
    está fixado pelo ambiente, para a tela não oferecer uma edição que não teria
    efeito.
    """
    url = settings.OPENCLAW_GATEWAY_URL.strip()
    token = settings.OPENCLAW_ADMIN_TOKEN.strip()
    fixado = bool(url)

    if not (url and token):
        async with sessao(role="service_role") as conn:
            linha = await conn.fetchrow(
                "SELECT gateway_url, admin_token FROM public.vps_config LIMIT 1"
            )
        if linha:
            url = url or (linha["gateway_url"] or "").strip()
            token = token or (linha["admin_token"] or "").strip()

    return ConfigGateway(url=url, token=token, fixado_por_env=fixado)


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
