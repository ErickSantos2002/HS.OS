"""Autenticação máquina-a-máquina — a VPS chamando a plataforma.

Não é usuário com JWT: são serviços do lado do OpenClaw (ponte de arquivos,
coletor de métricas, guardrails) que se identificam por **segredo compartilhado**.

Portado de `_shared/integration-secret.ts`, com a mesma ordem de leitura:
**banco primeiro, variável de ambiente como fallback**. O banco vem primeiro
porque é a fonte que dá para rotacionar sem mexer em deploy; o ambiente fica
como rede de segurança para instalação que ainda não gravou o segredo.

O cache de 60s é o mesmo do original: curto o bastante para uma rotação
aparecer rápido, longo o bastante para não consultar o banco a cada request de
um serviço que chama com frequência.
"""

import hmac
import logging
import os
import time

from fastapi import Header, HTTPException, status

from app.database import sessao

logger = logging.getLogger(__name__)

_TTL = 60
_cache: dict[str, tuple[str | None, float]] = {}


async def ler_segredo(nome: str) -> str | None:
    """Valor do segredo, ou `None` se não existir em lugar nenhum.

    Nunca levanta: falha de leitura no banco cai para o ambiente em vez de
    derrubar a requisição. O objetivo é degradar, não interromper.
    """
    agora = time.monotonic()
    guardado = _cache.get(nome)
    if guardado and agora - guardado[1] < _TTL:
        return guardado[0]

    valor: str | None = None
    try:
        async with sessao(role="service_role") as conn:
            valor = await conn.fetchval(
                "SELECT value FROM public.integration_secrets WHERE name = $1", nome
            )
    except Exception as e:  # noqa: BLE001
        logger.warning("Não foi possível ler o segredo %s do banco: %s", nome, e)

    if not valor:
        valor = os.environ.get(nome) or None

    _cache[nome] = (valor, agora)
    return valor


def _extrair(authorization: str | None, alternativo: str | None) -> str | None:
    """O token pode vir em `Authorization: Bearer` ou num cabeçalho próprio.

    Os dois caminhos existiam nas edges — a ponte de arquivos usa
    `x-bridge-token` e o coletor de métricas usa `x-ingest-key`. Aceitar ambos
    evita mexer no lado da VPS junto com a portagem.
    """
    if authorization and authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return (alternativo or "").strip() or None


def exige_segredo(nome: str):
    """Dependência que valida o segredo compartilhado.

    A comparação usa `compare_digest`: comparar segredo com `==` vaza, pelo
    tempo de resposta, quantos caracteres iniciais estavam certos.
    """

    async def dependencia(
        authorization: str | None = Header(default=None),
        x_bridge_token: str | None = Header(default=None),
        x_ingest_key: str | None = Header(default=None),
    ) -> None:
        esperado = await ler_segredo(nome)
        if not esperado:
            # Segredo não configurado = ninguém entra. O contrário — liberar
            # quando não há segredo — transformaria um esquecimento de config
            # em porta aberta.
            logger.warning("Segredo %s não configurado; chamada recusada.", nome)
            raise HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE,
                f"Integração não configurada: falta o segredo {nome}.",
            )

        recebido = _extrair(authorization, x_bridge_token or x_ingest_key)
        if not recebido or not hmac.compare_digest(recebido, esperado):
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Não autorizado.")

    return dependencia
