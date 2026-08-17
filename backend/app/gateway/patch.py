"""Escrita na config do gateway — o `config.patch`, com as armadilhas dele.

Mora aqui, e não no router que o usou primeiro, porque **toda** escrita de
config deve passar por um lugar só. Foram duas as armadilhas descobertas em
13/08/2026, e cada uma custou um diagnóstico errado antes de virar código.
"""

import asyncio
import json
import logging
import re

from fastapi import HTTPException, status

from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente

logger = logging.getLogger(__name__)


async def config_do_gateway() -> tuple[dict, str]:
    """Lê a config e devolve `(parsed, hash)`.

    O `hash` é o lock otimista do `config.patch`. Sem ele não se escreve —
    gravar sem lock arrisca sobrescrever mudança que entrou no meio.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        r = await obter_cliente(c.url, c.token).chamar("config.get", {})
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"config.get falhou: {e}")

    payload = r.get("payload") if isinstance(r.get("payload"), dict) else r
    parsed = payload.get("parsed") or payload.get("sourceConfig") or {}
    base_hash = payload.get("hash")
    if not isinstance(base_hash, str) or not base_hash:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Hash da config indisponível — abortado por segurança.",
        )
    return parsed, base_hash


# O gateway nomeia os caminhos que recusou nesta mensagem. Aproveitamos os
# nomes em vez de adivinhá-los.
#
# ⚠️ A primeira versão usava `[^.]*?`, que **exclui ponto** — e todo caminho de
# config tem ponto (`mcp.servers.banco-x.args`). O retry nunca disparava, e o
# defeito ficou escondido porque os testes da época passavam `replacePaths` à
# mão. Aqui a captura vai até o `. Pass` literal que fecha a frase.
_ARRAYS_RECUSADOS = re.compile(
    r"array path\(s\):\s*(.+?)\.?\s*(?:Pass\s+replacePaths|$)", re.I | re.S
)

# ⚠️ **O gateway limita `config.patch` por janela**, e diz quantos segundos
# esperar: "rate limit exceeded for config.patch; retry after 55s".
#
# Descoberto em 17/08/2026 criando o agente `flow`. A criação faz uma RAJADA de
# escritas — registrar o agente, publicar um conector por vez, ajustar liderança
# — e a partir da quarta o gateway recusa. O `flow` nasceu com **2 conectores de
# 4**: sem o Diretório, não sabia quem falava com ele; sem o TaskHS, não
# respondia um terço do que o briefing prometia.
#
# Nada mentiu — as falhas foram para o log e para a resposta da API, nomeadas.
# Mas nascer capenga é caro, e o gateway está literalmente dizendo como evitar.
_LIMITE_DE_TAXA = re.compile(r"rate limit exceeded.*?retry after\s+(\d+)\s*s", re.I | re.S)

# Teto do que aceitamos esperar dentro de uma requisição. Acima disso é melhor
# falhar e deixar o chamador tratar do que pendurar a tela.
_ESPERA_MAXIMA = 75


async def aplicar_patch(patch: dict, base_hash: str, conferir) -> None:
    """Manda um `config.patch`, contornando as duas armadilhas do gateway.

    ⚠️ **1. Remover item de array exige `replacePaths`.** O gateway recusa com
    "would remove entries from array path(s): X, Y — pass replacePaths…" em vez
    de apagar em silêncio. É trava boa; só precisamos obedecê-la. Como a
    mensagem já traz os caminhos exatos, repetimos a chamada com eles em vez de
    tentar prever quais serão.

    ⚠️ **2. Erro de conexão depois do patch NÃO significa que não gravou.** O
    patch faz o gateway recarregar, e o reload derruba o WebSocket — a exceção
    chega **depois** da escrita. Em 13/08/2026 isso me fez afirmar duas vezes
    que uma alteração não tinha sido aplicada quando ela estava lá; a segunda
    afirmação virou um diagnóstico errado que custou uma hora. Por isso, ao
    falhar por conexão, relemos a config e perguntamos ao `conferir` se o efeito
    aconteceu. Só é erro se de fato não aconteceu.

    `conferir(parsed) -> bool` recebe a config relida e diz se o patch pegou.
    """
    c = await cfg.carregar()
    corpo: dict = {"raw": json.dumps(patch), "baseHash": base_hash}

    try:
        await _patch_com_espera(c, corpo)
        # ⚠️ **Confirmar antes de devolver, mesmo quando o patch "deu certo".**
        #
        # O `baseHash` é lock otimista contra escritor concorrente, e não cobre
        # ESTE caso: o patch é aceito, mas o gateway leva um instante para
        # recarregar, e um `config.get` nesse intervalo devolve o estado ANTIGO
        # com o hash antigo — coerente entre si. O próximo patch nasce de uma
        # base velha e apaga o anterior sem que nada acuse.
        #
        # Aconteceu em 14/08/2026: publiquei dois conectores para o `atlas` e,
        # em seguida, a ferramenta de alerta. A segunda escrita leu a config
        # pré-reload e o agente ficou só com o alerta — os conectores sumiram
        # em silêncio.
        if not await _pegou(conferir):
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                "O gateway aceitou a alteração mas ela não apareceu na config. "
                "Não encadeie outra escrita antes de conferir — a próxima "
                "nasceria de um estado velho.",
            )
        return
    except ErroGateway as e:
        achado = _ARRAYS_RECUSADOS.search(str(e))
        if not achado:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY, f"O gateway recusou a alteração: {e}"
            )
        caminhos = [p.strip() for p in achado.group(1).split(",") if p.strip()]
        logger.info("Repetindo o patch com replacePaths=%s", caminhos)
    except OSError as e:
        # Conexão caiu: pode ter gravado. Confere antes de acusar.
        if await _pegou(conferir):
            logger.info("Patch aplicado apesar da queda de conexão (%s).", e)
            return
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Falha ao falar com o gateway: {e}")

    corpo["replacePaths"] = caminhos
    try:
        await _patch_com_espera(c, corpo)
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"O gateway recusou a alteração: {e}")
    except OSError as e:
        if await _pegou(conferir):
            return
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Falha ao falar com o gateway: {e}")


async def _patch_com_espera(c, corpo: dict) -> None:
    """Manda o `config.patch`, esperando quando o gateway pede.

    ⚠️ **Espera uma vez só, e no tempo que o próprio gateway informou.** Repetir
    em laço transformaria uma requisição em minutos; e chutar o intervalo daria
    ou espera curta demais (recusa de novo) ou longa demais (tela pendurada).
    A mensagem traz o número — usá-lo é mais barato que adivinhar.

    Acima de `_ESPERA_MAXIMA` não vale a pena segurar a requisição: o erro sobe
    e quem chamou decide. Nascer com aviso é melhor que pendurar.
    """
    cli = obter_cliente(c.url, c.token)
    try:
        await cli.chamar("config.patch", corpo)
        return
    except ErroGateway as e:
        achado = _LIMITE_DE_TAXA.search(str(e))
        if not achado:
            raise
        segundos = int(achado.group(1))
        if segundos > _ESPERA_MAXIMA:
            raise
        logger.info("Gateway pediu %ds antes de aceitar outro config.patch; esperando.",
                    segundos)
        # +1 para não bater na borda exata da janela.
        await asyncio.sleep(segundos + 1)

    await cli.chamar("config.patch", corpo)


async def _pegou(conferir) -> bool:
    """Relê a config e pergunta se o patch fez efeito. O gateway leva um
    instante para voltar do reload, daí as tentativas."""
    for espera in (1.0, 2.0, 4.0):
        await asyncio.sleep(espera)
        try:
            parsed, _ = await config_do_gateway()
        except (HTTPException, ErroGateway, OSError):
            continue
        if conferir(parsed):
            return True
    return False
