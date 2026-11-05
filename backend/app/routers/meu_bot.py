"""A pessoa personaliza o PRÓPRIO bot: nome de exibição e foto (05/11/2026).

⚠️ Só o nome de exibição muda. O `agent_id` (`gustavo-bot`) é a chave da
sessão, do workspace e das permissões no gateway — trocá-lo é que seria
problemático. O nome entra no prompt do bot (IDENTITY.md, SOUL.md): validado
e curto. A foto só aponta para o avatar do próprio bot.
"""
from __future__ import annotations

import asyncio
import logging
import re

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.bots_pessoais import arquivos_do_bot
from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bots", tags=["bots"])

_NOME = re.compile(r"^[\w À-ÿ.\-]{2,30}$")


def validar_nome(nome: str) -> str:
    n = " ".join((nome or "").split())
    if not _NOME.match(n):
        raise ValueError("Use de 2 a 30 caracteres: letras, números, espaço, ponto ou hífen.")
    return n


def validar_avatar(url: str, agent_id: str) -> bool:
    # Mesmo formato do `urlPublica` do front: relativo, `/api/...` ou o host da API.
    return bool(re.fullmatch(
        rf"(https://hsosapi\.healthsafetytech\.com|/api)?/storage/agent-files/avatars/"
        rf"{re.escape(agent_id)}\.(png|jpe?g|webp|gif)", url or ""))


async def _meu(conn, usuario: Usuario) -> dict:
    r = await conn.fetchrow(
        "SELECT a.agent_id, a.name, a.avatar_url, p.full_name, p.email, p.departamento "
        "  FROM public.agent_profiles a JOIN public.profiles p ON p.id = a.dono_id "
        " WHERE a.dono_id = $1::uuid", usuario.id)
    if not r:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Você ainda não tem bot pessoal.")
    return dict(r)


@router.get("/meu")
async def ver_meu_bot(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        b = await _meu(conn, usuario)
    return {"agent_id": b["agent_id"], "nome": b["name"], "avatar_url": b["avatar_url"]}


class MeuBotIn(BaseModel):
    nome: str | None = None
    avatar_url: str | None = None


async def _reescrever_identidade(b: dict, nome: str) -> None:
    from app.gateway import config as cfg
    from app.gateway.client import obter_cliente
    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    arq = arquivos_do_bot(b, nome_bot=nome)
    for f in ("IDENTITY.md", "SOUL.md"):
        await cli.chamar("agents.files.set", {"agentId": b["agent_id"], "name": f, "content": arq[f]})


async def _atualizar_times() -> None:
    from app import time_da_empresa
    try:
        await time_da_empresa.atualizar(await time_da_empresa.agentes_com_bloco())
    except Exception:  # noqa: BLE001
        logger.exception("Bloco do time não atualizado depois de renomear bot")


@router.patch("/meu")
async def alterar_meu_bot(dados: MeuBotIn, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        b = await _meu(conn, usuario)
        nome = b["name"]
        if dados.nome is not None:
            try:
                nome = validar_nome(dados.nome)
            except ValueError as e:
                raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
        avatar = b["avatar_url"]
        if dados.avatar_url is not None:
            if dados.avatar_url and not validar_avatar(dados.avatar_url, b["agent_id"]):
                raise HTTPException(status.HTTP_400_BAD_REQUEST, "Foto inválida.")
            avatar = dados.avatar_url or None
        await conn.execute("UPDATE public.agent_profiles SET name = $2, avatar_url = $3, updated_at = now() "
                           " WHERE agent_id = $1", b["agent_id"], nome, avatar)
    if nome != b["name"]:
        try:
            await _reescrever_identidade(b, nome)
        except Exception as e:  # noqa: BLE001
            logger.exception("Identidade do bot %s não regravada", b["agent_id"])
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                "O nome foi salvo, mas o bot ainda não se apresenta com ele. Tente de novo.") from e
        asyncio.create_task(_atualizar_times())
    return {"agent_id": b["agent_id"], "nome": nome, "avatar_url": avatar}
