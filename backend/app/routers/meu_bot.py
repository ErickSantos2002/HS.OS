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
import time

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app import capacidade as cap
from app.bots_pessoais import SUFIXO_EXIBICAO, SUFIXOS_CONHECIDOS, arquivos_do_bot
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.email.contas import tem_calendario
from app.sistemas import datacore, docshs, gestorhs, hsgrowth, talenths, taskhs
from app.sistemas.taskhs import ErroSistema

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/bots", tags=["bots"])

_PREFIXO = re.compile(r"^[A-Za-zÀ-ÿ0-9 .]{2,20}$")


def validar_prefixo(prefixo: str) -> str:
    """Só a parte antes do sufixo da empresa. Sem hífen: o sufixo é fixo."""
    p = " ".join((prefixo or "").split())
    if not _PREFIXO.match(p):
        raise ValueError("Use de 2 a 20 caracteres: letras, números, espaço ou ponto (o sufixo é fixo).")
    return p


def nome_com_sufixo(prefixo: str) -> str:
    return f"{prefixo}{SUFIXO_EXIBICAO}"


def prefixo_de(nome: str, sufixo: str = SUFIXO_EXIBICAO) -> str:
    """O que a pessoa escolheu, sem o sufixo — o atual ou qualquer um que já existiu."""
    n = (nome or "").strip()
    for suf in (sufixo, *SUFIXOS_CONHECIDOS):
        if suf and n.endswith(suf):
            return n[: -len(suf)]
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
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Você ainda não tem Guardi.")
    return dict(r)


@router.get("/meu")
async def ver_meu_bot(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        b = await _meu(conn, usuario)
    return {"agent_id": b["agent_id"], "nome": b["name"], "prefixo": prefixo_de(b["name"]),
            "sufixo": SUFIXO_EXIBICAO, "avatar_url": b["avatar_url"]}


class MeuBotIn(BaseModel):
    prefixo: str | None = None
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
        if dados.prefixo is not None:
            try:
                nome = nome_com_sufixo(validar_prefixo(dados.prefixo))
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
                                "O nome foi salvo, mas o Guardi ainda não se apresenta com ele. Tente de novo.") from e
        asyncio.create_task(_atualizar_times())
    return {"agent_id": b["agent_id"], "nome": nome, "prefixo": prefixo_de(nome),
            "sufixo": SUFIXO_EXIBICAO, "avatar_url": avatar}


# ── "Capacidade": o que o Guardi alcança com o login do dono (13/11/2026) ─────
# Spec `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`. Quem diz
# o que o login pode é cada sistema (`GET /agente/capacidades`); o cruzamento com
# os nossos catálogos é `app/capacidade.py`, puro.

ROTA_CAPACIDADES = "/agente/capacidades"
TIMEOUT_CAPACIDADE = 6.0
CACHE_CAPACIDADE_S = 300.0

# agent_id → (instante, chave do estado, resposta). ⚠️ `sistemas_ligados` e
# `email_ligado` mudam por SCRIPT (`publicar-bots-mcp.py`), noutro processo: não
# há como avisar este cache. Por isso eles fazem parte da chave — a rota relê o
# `agent_profiles` a cada pedido (precisa dele para conferir o dono), e a chave
# diferente vale como invalidação.
_cache_capacidade: dict[str, tuple[float, tuple, dict]] = {}


def _relogio() -> float:
    return time.monotonic()


async def _pedir_capacidades(cliente: str, email: str, bot: str, dono: str):
    """`GET /agente/capacidades` num sistema, com o token de agente do dono. As
    assinaturas de `chamar` diferem entre os clientes — por isso o despacho."""
    r = ROTA_CAPACIDADES
    if cliente == "taskhs":
        return await taskhs.chamar(email, bot, "GET", r, dono=dono)
    if cliente == "datacore":
        return await datacore.chamar(email, bot, "GET", r, dono=dono)
    modulo = {"docshs": docshs, "gestorhs": gestorhs, "hsgrowth": hsgrowth, "talenths": talenths}[cliente]
    return await modulo.chamar(email, bot, r, dono=dono)


async def _capacidade_de(cliente: str, email: str, bot: str, dono: str) -> tuple[str, dict | None]:
    """(estado, resposta). Nunca levanta: um sistema fora do ar não derruba os outros."""
    try:
        r = await asyncio.wait_for(_pedir_capacidades(cliente, email, bot, dono), TIMEOUT_CAPACIDADE)
    except asyncio.TimeoutError:
        return "fora_do_ar", None
    except ErroSistema as e:
        return cap.estado_do_erro(e.status), None
    except Exception:  # noqa: BLE001 — JSON inválido, config ausente: o sistema não soube responder
        logger.exception("capacidade de %s no %s", bot, cliente)
        return "sem_resposta_de_capacidade", None
    if not cap.resposta_valida(r):
        return "sem_resposta_de_capacidade", None
    return "ok", r


async def _guardi_do_dono(conn, agent_id: str, usuario: Usuario) -> dict:
    r = await conn.fetchrow(
        "SELECT a.agent_id, a.sistemas_ligados, a.email_ligado, p.email "
        "  FROM public.agent_profiles a JOIN public.profiles p ON p.id = a.dono_id "
        " WHERE a.agent_id = $1 AND a.dono_id = $2::uuid", agent_id, usuario.id)
    if not r:
        # ⚠️ 404 também para o administrador: a resposta descreve as permissões
        # de UMA pessoa nos sistemas dela. Nem "existe, mas não é seu".
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Guardi não encontrado.")
    return dict(r)


async def montar_capacidade(b: dict, dono: str, calendario: bool) -> dict:
    """Um pedido por CLIENTE, em paralelo (Vendas e Serviços do HSGrowth dividem um)."""
    ligados = [s for s in cap.SISTEMAS if s in set(b["sistemas_ligados"] or [])]
    clientes = list(dict.fromkeys(cap.CLIENTE_DO_SISTEMA[s] for s in ligados))
    respostas = await asyncio.gather(*(_capacidade_de(c, b["email"], b["agent_id"], dono) for c in clientes))
    por_cliente = dict(zip(clientes, respostas))
    sistemas = [cap.montar_sistema(s, *por_cliente[cap.CLIENTE_DO_SISTEMA[s]]) for s in ligados]
    return {"agent_id": b["agent_id"], "sistemas": sistemas,
            "no_hsos": cap.itens_do_hsos(bool(b["email_ligado"]), calendario)}


@router.get("/capacidade/{agent_id}")
async def capacidade_do_guardi(agent_id: str, atualizar: bool = False,
                               usuario: Usuario = Depends(usuario_atual)):
    """O que o Guardi alcança agora, sistema por sistema, com o login do dono.
    Só o dono vê; `atualizar=true` ignora o cache de 5 min."""
    async with sessao(role="service_role") as conn:
        b = await _guardi_do_dono(conn, agent_id, usuario)
        calendario = bool(b["email_ligado"]) and await tem_calendario(conn, usuario.id)
    chave = (tuple(sorted(b["sistemas_ligados"] or [])), bool(b["email_ligado"]), calendario)
    agora = _relogio()
    guardado = _cache_capacidade.get(agent_id)
    if not atualizar and guardado and guardado[1] == chave and agora - guardado[0] < CACHE_CAPACIDADE_S:
        return guardado[2]
    resposta = await montar_capacidade(b, usuario.id, calendario)
    _cache_capacidade[agent_id] = (agora, chave, resposta)
    return resposta
