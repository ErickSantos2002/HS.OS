"""Ações do bot pessoal num sistema interno que esperam o clique do dono.

⚠️ O que executa é o `payload` GRAVADO em `acoes_pendentes` quando o bot
preparou — o cartão mostra exatamente isso, e a confirmação não aceita
argumento novo. Cada executor chama o sistema COMO o dono (token de agente).
"""
from __future__ import annotations

import json
from typing import Awaitable, Callable

from app.sistemas import taskhs

Executor = Callable[..., Awaitable[str]]


async def _taskhs_comentar(email, bot, p, dono=None) -> str:
    await taskhs.chamar(email, bot, "POST", f"/lists/{int(p['list_id'])}/cards/{int(p['card_id'])}/comments",
                        json={"body": p["texto"]}, dono=dono)
    return "Comentário publicado."


async def _taskhs_mover(email, bot, p, dono=None) -> str:
    await taskhs.chamar(email, bot, "PATCH", f"/lists/{int(p['list_id'])}/cards/{int(p['card_id'])}",
                        json={"list_id": int(p["para_list_id"], dono=dono)})
    return "Tarefa movida."


async def _taskhs_criar(email, bot, p, dono=None) -> str:
    corpo = {k: p[k] for k in ("title", "description", "priority", "due_date") if p.get(k) is not None}
    r = await taskhs.chamar(email, bot, "POST", f"/lists/{int(p['list_id'])}/cards", json=corpo, dono=dono)
    return f"Tarefa criada (id {(r or {}).get('id')})."


async def _taskhs_atualizar(email, bot, p, dono=None) -> str:
    campos = {k: v for k, v in (p.get("campos") or {}).items()
              if k in ("title", "priority", "due_date", "due_date_completed", "done")}
    await taskhs.chamar(email, bot, "PATCH", f"/lists/{int(p['list_id'])}/cards/{int(p['card_id'])}",
                        json=campos, dono=dono)
    return "Tarefa atualizada."


EXECUTORES: dict[tuple[str, str], Executor] = {
    ("taskhs", "comentar"): _taskhs_comentar,
    ("taskhs", "mover"): _taskhs_mover,
    ("taskhs", "criar"): _taskhs_criar,
    ("taskhs", "atualizar"): _taskhs_atualizar,
}


async def criar_pendente(conn, dono: str, bot: str, sistema: str, acao: str, payload: dict,
                         resumo: str) -> str:
    """Grava a pendência e o cartão na conversa (push e tempo real vêm dos
    triggers da `conversations`)."""
    if (sistema, acao) not in EXECUTORES:
        raise ValueError(f"ação desconhecida: {sistema}/{acao}")
    aid = await conn.fetchval(
        "INSERT INTO public.acoes_pendentes (user_id, agent_id, sistema, acao, payload, resumo) "
        "VALUES ($1::uuid, $2, $3, $4, $5::text::jsonb, $6) RETURNING id::text",
        dono, bot, sistema, acao, json.dumps(payload, ensure_ascii=False), resumo)
    conv = await conn.fetchval(
        "INSERT INTO public.conversations (agent_id, user_id, role, content, media) "
        "VALUES ($1, $2::uuid, 'agent', $3, $4::text::jsonb) RETURNING id::text",
        bot, dono, f"🔔 Aguardando sua confirmação: {resumo}",
        json.dumps([{"type": "acao_aprovacao", "id": aid, "name": resumo, "mimeType": "", "base64": ""}],
                   ensure_ascii=False))
    await conn.execute("UPDATE public.acoes_pendentes SET conversa_id = $2::uuid WHERE id = $1::uuid",
                       aid, conv)
    return aid
