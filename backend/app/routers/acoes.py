"""Confirmar ou cancelar a ação que o bot pessoal preparou num sistema.

⚠️ Única porta para o bot ALTERAR algo num sistema interno. Só o dono (404
para os outros); executa o `payload` gravado; linha travada contra clique
duplo; validade de 24 h.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import PlainTextResponse

from app import acoes
from app.agente_token import chave_publica_pem
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.sistemas.taskhs import ErroSistema

logger = logging.getLogger(__name__)
router = APIRouter(tags=["acoes"])

VALIDADE = timedelta(hours=24)


@router.get("/agente/chave-publica", response_class=PlainTextResponse)
async def chave_publica():
    """A chave PÚBLICA do token de agente — o que os sistemas precisam para conferir."""
    return chave_publica_pem()


async def _acao_do_dono(conn, acao_id: str, usuario: Usuario) -> dict:
    try:
        a = await conn.fetchrow(
            "SELECT a.id::text AS id, a.user_id::text AS user_id, a.agent_id, a.sistema, a.acao, "
            "       a.payload, a.resumo, a.status, a.erro, a.resultado, a.criado_em, p.email "
            "  FROM public.acoes_pendentes a JOIN public.profiles p ON p.id = a.user_id "
            " WHERE a.id = $1::uuid AND a.user_id = $2::uuid FOR UPDATE OF a",
            acao_id, usuario.id)
    except Exception:  # noqa: BLE001 — id malformado
        a = None
    if not a:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Ação não encontrada.")
    a = dict(a)
    if isinstance(a["payload"], str):
        a["payload"] = json.loads(a["payload"])
    if a["status"] == "pendente" and datetime.now(timezone.utc) - a["criado_em"] > VALIDADE:
        await conn.execute("UPDATE public.acoes_pendentes SET status = 'vencida', decidido_em = now() "
                           " WHERE id = $1::uuid AND status = 'pendente'", acao_id)
        a["status"] = "vencida"
    return a


def _saida(a: dict) -> dict:
    return {k: a[k] for k in ("id", "status", "sistema", "acao", "resumo", "payload", "resultado", "erro")}


@router.get("/acoes/{acao_id}")
async def ver_acao(acao_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="service_role") as conn:
        return _saida(await _acao_do_dono(conn, acao_id, usuario))


@router.post("/acoes/{acao_id}/confirmar")
async def confirmar_acao(acao_id: str, usuario: Usuario = Depends(usuario_atual)):
    """⚠️ O erro é levantado FORA da transação: dentro dela, o rollback desfazia
    o `status='erro'` e a ação voltava a 'pendente', pronta para rodar de novo
    (revisão de segurança). Qualquer exceção do executor vira 'erro'."""
    falha: str | None = None
    conflito: str | None = None
    async with sessao(role="service_role") as conn:
        a = await _acao_do_dono(conn, acao_id, usuario)
        executor = acoes.EXECUTORES.get((a["sistema"], a["acao"]))
        if a["status"] != "pendente":
            # Sem raise aqui dentro: o 'vencida' gravado agora seria desfeito.
            conflito = f"Esta ação já está {a['status']}."
        elif not executor:
            conflito = "Ação desconhecida."
    if conflito:
        raise HTTPException(status.HTTP_409_CONFLICT, conflito)
    async with sessao(role="service_role") as conn:
        a = await _acao_do_dono(conn, acao_id, usuario)
        if a["status"] != "pendente":
            raise HTTPException(status.HTTP_409_CONFLICT, f"Esta ação já está {a['status']}.")
        try:
            resultado = await executor(a["email"], a["agent_id"], a["payload"], dono=a["user_id"])
        except ErroSistema as e:
            falha = str(e)
        except Exception as e:  # noqa: BLE001
            logger.exception("Ação %s falhou", acao_id)
            falha = f"falha ao executar ({type(e).__name__})"
        if falha:
            await conn.execute("UPDATE public.acoes_pendentes SET status = 'erro', erro = $2, "
                               "decidido_em = now() WHERE id = $1::uuid AND status = 'pendente'",
                               acao_id, falha[:300])
        else:
            await conn.execute("UPDATE public.acoes_pendentes SET status = 'feita', resultado = $2, "
                               "decidido_em = now() WHERE id = $1::uuid AND status = 'pendente'",
                               acao_id, resultado)
    if falha:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, falha)
    return {"status": "feita", "resultado": resultado}


@router.post("/acoes/{acao_id}/cancelar")
async def cancelar_acao(acao_id: str, usuario: Usuario = Depends(usuario_atual)):
    conflito: str | None = None
    async with sessao(role="service_role") as conn:
        a = await _acao_do_dono(conn, acao_id, usuario)
        if a["status"] != "pendente":
            conflito = f"Esta ação já está {a['status']}."
        else:
            await conn.execute("UPDATE public.acoes_pendentes SET status = 'cancelada', decidido_em = now() "
                               " WHERE id = $1::uuid AND status = 'pendente'", acao_id)
    if conflito:
        raise HTTPException(status.HTTP_409_CONFLICT, conflito)
    return {"status": "cancelada"}


# ── Memória do PRÓPRIO bot (tela "Memória do bot") ───────────────────────────

from app.routers.mcp_bot import _gravar_memoria, _ler_memoria  # noqa: E402

_CABECALHO = "# MEMORY.md"


async def _meu_bot(usuario: Usuario) -> str:
    async with sessao(role="service_role") as conn:
        bot = await conn.fetchval(
            "SELECT agent_id FROM public.agent_profiles WHERE dono_id = $1::uuid", usuario.id)
    if not bot:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Você ainda não tem bot pessoal.")
    return bot


def _linhas(conteudo: str) -> list[str]:
    return [l[2:] for l in conteudo.splitlines() if l.startswith("- ")]


@router.get("/bots/memoria")
async def ver_memoria(usuario: Usuario = Depends(usuario_atual)):
    bot = await _meu_bot(usuario)
    return {"bot": bot, "linhas": _linhas(await _ler_memoria(bot))}


@router.delete("/bots/memoria/{indice}")
async def apagar_linha_memoria(indice: int, usuario: Usuario = Depends(usuario_atual)):
    bot = await _meu_bot(usuario)
    linhas = _linhas(await _ler_memoria(bot))
    if not 0 <= indice < len(linhas):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Linha não encontrada.")
    del linhas[indice]
    await _gravar_memoria(bot, _CABECALHO + "\n" + "".join(f"- {l}\n" for l in linhas))
    return {"linhas": linhas}


@router.delete("/bots/memoria")
async def apagar_memoria(usuario: Usuario = Depends(usuario_atual)):
    bot = await _meu_bot(usuario)
    await _gravar_memoria(bot, _CABECALHO + "\n")
    return {"linhas": []}
