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
                        json={"list_id": int(p["para_list_id"])}, dono=dono)
    return "Tarefa movida."


async def _criar_checklist(email, bot, lid: int, cid: int, cl: dict, dono=None) -> str:
    """Checklist de verdade do TaskHS (o bot escrevia "- [ ] …" na descrição).
    Não é atômico: se um item falhar, diz quantos entraram."""
    base = f"/lists/{lid}/cards/{cid}/checklists"
    r = await taskhs.chamar(email, bot, "POST", base, json={"title": cl["title"]}, dono=dono)
    clid = int((r or {})["id"])
    itens = list(cl.get("items") or [])
    for n, texto in enumerate(itens):
        try:
            await taskhs.chamar(email, bot, "POST", f"{base}/{clid}/items", json={"text": texto}, dono=dono)
        except taskhs.ErroSistema:
            return f"checklist criado com {n} de {len(itens)} itens — confira no TaskHS"
    return f"checklist com {len(itens)} itens"


async def _taskhs_criar(email, bot, p, dono=None) -> str:
    """⚠️ O TaskHS NÃO põe quem cria como membro — o card 2534 nasceu sem
    ninguém e o bot afirmou "responsável: você". Aqui o dono entra como membro,
    que é o "responsável" no TaskHS, e o card passa a aparecer em "minhas"."""
    corpo = {k: p[k] for k in ("title", "description", "priority", "due_date") if p.get(k) is not None}
    lid = int(p["list_id"])
    r = await taskhs.chamar(email, bot, "POST", f"/lists/{lid}/cards", json=corpo, dono=dono)
    cid = (r or {}).get("id")
    if not cid:
        return "Tarefa criada."
    partes = []
    try:
        eu = await taskhs.chamar(email, bot, "GET", "/auth/me", dono=dono)
        await taskhs.chamar(email, bot, "POST", f"/lists/{lid}/cards/{cid}/members/{int(eu['id'])}",
                            dono=dono)
        partes.append("com você como membro")
    except (taskhs.ErroSistema, KeyError, TypeError, ValueError):
        partes.append("mas não consegui pôr você como membro — ponha no TaskHS")
    if p.get("checklist"):
        try:
            partes.append(await _criar_checklist(email, bot, lid, int(cid), p["checklist"], dono=dono))
        except (taskhs.ErroSistema, KeyError, TypeError, ValueError):
            partes.append("mas o checklist não foi criado — crie no TaskHS")
    return f"Tarefa criada (id {cid}), " + "; ".join(partes) + "."


async def _taskhs_atualizar(email, bot, p, dono=None) -> str:
    lid, cid = int(p["list_id"]), int(p["card_id"])
    campos = {k: v for k, v in (p.get("campos") or {}).items()
              if k in ("title", "description", "priority", "due_date", "due_date_completed", "done")}
    feito = []
    if campos:
        await taskhs.chamar(email, bot, "PATCH", f"/lists/{lid}/cards/{cid}", json=campos, dono=dono)
        feito.append("tarefa atualizada")
    for m in p.get("marcar_itens") or []:
        await taskhs.chamar(email, bot, "PATCH", f"/lists/{lid}/cards/{cid}/checklists/"
                            f"{int(m['checklist_id'])}/items/{int(m['item_id'])}",
                            json={"checked": bool(m["checked"])}, dono=dono)
    if p.get("marcar_itens"):
        feito.append(f"{len(p['marcar_itens'])} item(ns) do checklist marcados")
    if p.get("checklist"):
        feito.append(await _criar_checklist(email, bot, lid, cid, p["checklist"], dono=dono))
    return ("; ".join(feito) or "nada mudou").capitalize() + "."


async def _taskhs_membros(email, bot, p, dono=None) -> str:
    """Um por pessoa e sem parar no primeiro erro: o dono precisa saber quem
    entrou e quem não — "falhou" sozinho o faria repetir o que já deu certo."""
    base = f"/lists/{int(p['list_id'])}/cards/{int(p['card_id'])}/members"
    ex = p.get("_exibir") or {}
    feito, falhou = [], []
    for verbo, metodo, chave in (("entrou", "POST", "adicionar"), ("saiu", "DELETE", "remover")):
        nomes = list(ex.get(chave) or [])
        for n, uid in enumerate(p.get(chave) or []):
            quem = nomes[n] if n < len(nomes) else f"user_id {uid}"
            try:
                await taskhs.chamar(email, bot, metodo, f"{base}/{int(uid)}", dono=dono)
                feito.append(f"{quem} {verbo}")
            except taskhs.ErroSistema as e:
                falhou.append(f"{quem} não {verbo} ({e})")
    # Sem `capitalize()`: ele baixa o resto da frase, e "Erick" virava "erick".
    if not feito:
        raise taskhs.ErroSistema(0, "; ".join(falhou))
    return "; ".join(feito) + "." + (" " + "; ".join(falhou) + "." if falhou else "")


EXECUTORES: dict[tuple[str, str], Executor] = {
    ("taskhs", "comentar"): _taskhs_comentar,
    ("taskhs", "mover"): _taskhs_mover,
    ("taskhs", "criar"): _taskhs_criar,
    ("taskhs", "atualizar"): _taskhs_atualizar,
    ("taskhs", "membros"): _taskhs_membros,
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
