"""Ações do bot pessoal num sistema interno que esperam o clique do dono.

⚠️ O que executa é o `payload` GRAVADO em `acoes_pendentes` quando o bot
preparou — o cartão mostra exatamente isso, e a confirmação não aceita
argumento novo. Cada executor chama o sistema COMO o dono (token de agente).
"""
from __future__ import annotations

import json
from typing import Awaitable, Callable

from app.gestorhs_escrita import texto_lote_parcial
from app.sistemas import gestorhs, taskhs

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
    add = p.get("adicionar_itens")
    if add:
        base = f"/lists/{lid}/cards/{cid}/checklists/{int(add['checklist_id'])}/items"
        itens = list(add.get("items") or [])
        for n, texto in enumerate(itens):
            try:
                await taskhs.chamar(email, bot, "POST", base, json={"text": texto}, dono=dono)
            except taskhs.ErroSistema:
                feito.append(f"{n} de {len(itens)} itens acrescentados — confira no TaskHS")
                break
        else:
            feito.append(f"{len(itens)} item(ns) acrescentado(s) ao checklist")
    if p.get("excluir_checklist"):
        await taskhs.chamar(email, bot, "DELETE", f"/lists/{lid}/cards/{cid}/checklists/"
                            f"{int(p['excluir_checklist'])}", dono=dono)
        feito.append("checklist excluído")
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


# ── GestorHS, fase 2a (Expedição, 12/11/2026) ────────────────────────────────
# Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-expedicao-design.md`.
# ⚠️ Corpo por allowlist de chaves, nunca `**p`: o `payload` também leva o
# `_exibir` do cartão, e `sem_nota_fiscal` (exceção de Administrador) não pode
# chegar ao GestorHS nem por um payload adulterado.

_CAMPOS_OS = ("equipamento_cliente", "tipo_servico", "condicao_chegada", "checklist", "pilhas",
              "bocais", "observacoes")


async def _gestorhs_receber(email, bot, p, dono=None) -> str:
    """A 1ª OS vai sem caixa (o GestorHS cria; o número é o id) ou com a caixa
    informada; as demais, com a caixa que voltou da 1ª — é isso que as junta.
    ⚠️ Falha no meio PARA e diz o que abriu: não desfaz (OS aberta é registro)."""
    itens = list(p.get("aparelhos") or [])
    linhas = list((p.get("_exibir") or {}).get("linhas") or [])
    caixa = int(p["caixa"]) if p.get("caixa") else None
    abertas: list[int] = []
    for k, item in enumerate(itens):
        corpo = {c: item[c] for c in _CAMPOS_OS if item.get(c) is not None}
        if p.get("data_chegada"):
            corpo["data_chegada"] = p["data_chegada"]
        if caixa:
            corpo["caixa"] = caixa
        serie = (linhas[k].get("serie") if k < len(linhas) else None) or f"id {item.get('equipamento_cliente')}"
        try:
            r = await gestorhs.chamar(email, bot, "/ordens", metodo="POST", json=corpo, dono=dono)
        except gestorhs.ErroSistema as e:
            if not abertas:
                raise
            raise gestorhs.ErroSistema(e.status, texto_lote_parcial(
                len(abertas), len(itens), serie, str(e), abertas, caixa)) from e
        abertas.append(int((r or {}).get("id") or 0))
        caixa = caixa or (r or {}).get("caixa")
        if not caixa and k + 1 < len(itens):
            # Sem a caixa da 1ª, as outras nasceriam cada uma na sua.
            raise gestorhs.ErroSistema(0, texto_lote_parcial(
                len(abertas), len(itens), (linhas[k + 1].get("serie") if k + 1 < len(linhas) else "?"),
                "o GestorHS não devolveu a caixa da primeira OS", abertas, None))
    lista = ", ".join(str(o) for o in abertas)
    n = len(abertas)
    return f"{n} OS {'aberta' if n == 1 else 'abertas'} na caixa {caixa}: OS {lista}."


def _sem_funcao(e: "gestorhs.ErroSistema", ex: dict) -> "gestorhs.ErroSistema":
    """403 no avanço: diz QUAL função avança aquela fase — "não permite" sozinho
    deixaria a pessoa sem saber a quem pedir."""
    if e.status == 403 and ex.get("fase") and ex.get("funcao"):
        return gestorhs.ErroSistema(403, f"a sua função no GestorHS não permite isso: quem avança caixa "
                                         f"em {ex['fase']} é {ex['funcao']} (ou Administrador)")
    return e


async def _gestorhs_avancar(email, bot, p, dono=None) -> str:
    cid = int(p["caixa"])
    corpo = {k: p[k] for k in ("obs", "cliente_principal") if p.get(k) is not None}
    try:
        r = await gestorhs.chamar(email, bot, f"/caixas/{cid}/avancar", metodo="POST", json=corpo, dono=dono)
    except gestorhs.ErroSistema as e:
        raise _sem_funcao(e, p.get("_exibir") or {}) from e
    fase = (r or {}).get("fase_descricao")
    return f"Caixa {cid} avançada para {fase}." if fase else f"Caixa {cid} avançada."


async def _gestorhs_fechar(email, bot, p, dono=None) -> str:
    cid = int(p["caixa"])
    corpo = {k: p[k] for k in ("cod_retorno", "obs") if p.get(k) is not None}
    try:
        await gestorhs.chamar(email, bot, f"/caixas/{cid}/avancar", metodo="POST", json=corpo, dono=dono)
    except gestorhs.ErroSistema as e:
        raise _sem_funcao(e, {"fase": "Preparando Retorno", "funcao": "Expedição"}) from e
    return f"Caixa {cid} finalizada, rastreio {p['cod_retorno']}."


_CAMPOS_APARELHO = ("cliente", "equipamento", "serie", "patrimonio", "datacompra", "ult_calibragem",
                    "prox_calibragem")


async def _gestorhs_cadastrar(email, bot, p, dono=None) -> str:
    corpo = {k: p[k] for k in _CAMPOS_APARELHO if p.get(k) is not None}
    r = await gestorhs.chamar(email, bot, "/equipamentos-cliente", metodo="POST", json=corpo, dono=dono)
    ident = (r or {}).get("id")
    return f"Aparelho cadastrado (id {ident})." if ident else "Aparelho cadastrado."


# ── GestorHS, fase 2b (Laboratório, 12/11/2026) ──────────────────────────────
# Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-laboratorio-design.md`.
# ⚠️ Lista fixa: nenhum override de cabeçalho (`nomecli`, `cnpj`, `serie`…) passa,
# nem de um payload adulterado — e o GestorHS também os ignora para agente.
_CAMPOS_CERTIFICADO = ("calib_cert", "calib_temp", "calib_pressao", "calib_teste1", "calib_teste2",
                       "calib_teste3", "calib_teste4", "calib_teste5", "calib_teste_media",
                       "calib_situacao", "data_calibracao")


def _link_de_calibracao(certs) -> str | None:
    for c in certs if isinstance(certs, list) else []:
        if isinstance(c, dict) and c.get("tipo") == "C" and c.get("link_pdf"):
            return str(c["link_pdf"])
    return None


async def _gestorhs_gerar_certificado(email, bot, p, dono=None) -> str:
    """O `gerar` do GestorHS também conclui o aparelho no laboratório (como na
    tela). O link do PDF vem do retorno; se não vier, da lista da OS."""
    oid = int(p["ordem"])
    corpo = {k: p[k] for k in _CAMPOS_CERTIFICADO if p.get(k) is not None}
    try:
        r = await gestorhs.chamar(email, bot, f"/ordens/{oid}/gerar-certificado", metodo="POST",
                                  json=corpo, dono=dono)
    except gestorhs.ErroSistema as e:
        if e.status == 403:
            raise gestorhs.ErroSistema(403, "a sua função no GestorHS não permite isso: quem gera "
                                            "certificado é Laboratório (ou Administrador)") from e
        raise
    link = _link_de_calibracao(r)
    if not link:
        try:
            link = _link_de_calibracao(await gestorhs.chamar(email, bot, f"/ordens/{oid}/certificados",
                                                             dono=dono))
        except gestorhs.ErroSistema:
            link = None     # o certificado já foi gerado: não transformar isso em erro
    feito = "Certificado gerado e aparelho concluído no laboratório."
    return f"{feito} PDF: {link}" if link else feito


EXECUTORES: dict[tuple[str, str], Executor] = {
    ("taskhs", "comentar"): _taskhs_comentar,
    ("taskhs", "mover"): _taskhs_mover,
    ("taskhs", "criar"): _taskhs_criar,
    ("taskhs", "atualizar"): _taskhs_atualizar,
    ("taskhs", "membros"): _taskhs_membros,
    ("gestorhs", "receber"): _gestorhs_receber,
    ("gestorhs", "avancar_caixa"): _gestorhs_avancar,
    ("gestorhs", "fechar_caixa"): _gestorhs_fechar,
    ("gestorhs", "cadastrar_aparelho"): _gestorhs_cadastrar,
    ("gestorhs", "gerar_certificado"): _gestorhs_gerar_certificado,
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
