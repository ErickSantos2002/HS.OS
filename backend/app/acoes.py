"""Ações do bot pessoal num sistema interno que esperam o clique do dono.

⚠️ O que executa é o `payload` GRAVADO em `acoes_pendentes` quando o bot
preparou — o cartão mostra exatamente isso, e a confirmação não aceita
argumento novo. Cada executor chama o sistema COMO o dono (token de agente).
"""
from __future__ import annotations

import json
from typing import Awaitable, Callable

import httpx

from app.gestorhs_escrita import texto_lote_parcial
from app import hsgrowth_escrita as hge
from app import hsgrowth_servicos_escrita as hgse
from app.config import settings
from app.sistemas import gestorhs, hsgrowth, taskhs

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


# ── GestorHS, fase 2c (propostas, 12/11/2026) ────────────────────────────────
# Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-propostas-design.md`.
# ⚠️ `destinatario` sai só com tipo e id: no GestorHS ele ESCREVE no cadastro do
# cliente (nome, endereço) e sincroniza com o Tiny. Um payload adulterado com
# `nome` renomearia o cliente; `vendedor`/`assinatura` nunca passam.
_CAMPOS_PROPOSTA = ("desconto", "frete", "condicao_pagamento", "contato", "intro", "outros_itens",
                    "observacoes", "validade_dias", "data_entrega", "descricao_entrega",
                    "endereco_entrega_diferente", "endereco_entrega")
_CAMPOS_ITEM = ("descricao", "sku", "quantidade", "unidade", "preco_un")


def _corpo_da_proposta(p: dict) -> dict:
    corpo = {k: p[k] for k in _CAMPOS_PROPOSTA if p.get(k) is not None}
    if p.get("itens") is not None:
        corpo["itens"] = [{k: i.get(k) for k in _CAMPOS_ITEM} for i in p["itens"]]
    if p.get("aparelhos") is not None:
        corpo["aparelhos"] = [{"equipamento_cliente": int(a["equipamento_cliente"])} for a in p["aparelhos"]]
    return corpo


def _sem_funcao_proposta(e: "gestorhs.ErroSistema") -> "gestorhs.ErroSistema":
    if e.status == 403:
        return gestorhs.ErroSistema(403, "a sua função no GestorHS não permite isso: quem cria e altera "
                                         "proposta é Comercial Pós-Vendas, Financeiro (ou Administrador)")
    return e


def _com_pdf(texto: str, r) -> str:
    link = (r or {}).get("link_pdf") if isinstance(r, dict) else None
    return f"{texto} PDF: {link}" if link else texto


async def _gestorhs_criar_proposta(email, bot, p, dono=None) -> str:
    d = p.get("destinatario") or {}
    if d.get("tipo") not in ("cliente", "empresa"):
        raise gestorhs.ErroSistema(0, "destinatário inválido no cartão")
    corpo = _corpo_da_proposta(p)
    corpo["destinatario"] = {"tipo": d["tipo"], "id": int(d["id"])}
    try:
        r = await gestorhs.chamar(email, bot, "/propostas", metodo="POST", json=corpo, dono=dono)
    except gestorhs.ErroSistema as e:
        raise _sem_funcao_proposta(e) from e
    numero = (r or {}).get("numero") if isinstance(r, dict) else None
    return _com_pdf(f"Proposta {numero} criada." if numero else "Proposta criada.", r)


async def _gestorhs_alterar_proposta(email, bot, p, dono=None) -> str:
    """⚠️ Sem `destinatario`, nunca: no `PUT` ele reescreveria o cadastro. O
    GestorHS guarda a versão anterior (com o PDF) sozinho."""
    pid = int(p["proposta"])
    corpo = _corpo_da_proposta(p.get("corpo") or {})
    try:
        r = await gestorhs.chamar(email, bot, f"/propostas/{pid}", metodo="PUT", json=corpo, dono=dono)
    except gestorhs.ErroSistema as e:
        raise _sem_funcao_proposta(e) from e
    numero = ((r or {}).get("numero") if isinstance(r, dict) else None) or (p.get("_exibir") or {}).get("numero")
    feito = f"Proposta {numero} alterada" if numero else "Proposta alterada"
    return _com_pdf(f"{feito} (versão anterior guardada).", r)


# ── HSGrowth (12/11/2026) ────────────────────────────────────────────────────
# Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`.
# CONTRATO DO PAYLOAD (quem prepara o cartão, Task 5, grava exatamente isto; datas
# já em UTC, nada é recalculado aqui):
#   hsgrowth_registrar: {card_id, campos?, campos_personalizados?: [{field_definition_id, value}],
#       nota?, tarefas?: [{op:"criar", title, task_type, priority?, due_date?, description?, duration_minutes?}
#       | {op:"alterar", task_id, title|description|priority|due_date|duration_minutes}  (task_type NUNCA)
#       | {op:"concluir", task_id, valida: bool (OBRIGATÓRIO: True=realizada, False=tentativa sem resultado)}], mover_para?: list_id, _exibir: {card, link, aviso?}}
#   hsgrowth_cliente: {card_id, cliente?: {id, campos}, contato?: {id, campos}, _exibir}
#   hsgrowth_criar_lead: {titulo, list_id, assigned_to_id (o id do DONO lá, de /users/me, posto pelo
#       servidor), cliente: {id}|{campos}, contato: {id}|{campos}, campos_do_card, _exibir}   (o CardCreate do HSGrowth aceita `person_id`: sem chamada de vínculo)
#   hsgrowth_ganhar {card_id} · hsgrowth_perder {card_id, motivo} · hsgrowth_noshow {card_id, task_id}
# ⚠️ Corpo = só as chaves das allowlists de `hsgrowth_escrita`, relidas uma a uma
# (nunca `**p`): payload adulterado não leva `assigned_to_id` nem `is_won` ao CRM.
# ⚠️ Lote PARA no primeiro erro e NÃO desfaz (nota e tarefa criadas são registro).

# ⚠️ `alterar` nunca leva `task_type` (nem de payload adulterado): reunião virada
# ligação e depois concluída pagaria comissão de reunião que não houve.
_CAMPOS_TAREFA_CRIAR = ("title", "description", "task_type", "priority", "due_date", "duration_minutes")
_CAMPOS_TAREFA_ALTERAR = tuple(c for c in _CAMPOS_TAREFA_CRIAR if c != "task_type")


def _pegar(origem: dict, chaves) -> dict:
    return {k: origem[k] for k in chaves if origem.get(k) is not None}


def _link_hsg(p: dict) -> str:
    return str((p.get("_exibir") or {}).get("link") or "")


async def _hsg_lote(passos: list, entrou: list, link: str, alvo: str | None = None,
                    vendas: bool = True) -> None:
    """Executa `passos` (nome, corrotina-fábrica) em ordem. Falhou: para e levanta
    "Parou em <passo> (n de m): <erro>. Já entrou: <lista>." — sem desfazer.
    `vendas=False` (Serviços) desliga as dicas do funil comercial."""
    total = len(passos)
    for n, (nome, fabrica) in enumerate(passos, 1):
        try:
            await fabrica()
        except hsgrowth.ErroSistema as e:
            msg = str(e)
            # "proposta" sozinha casa a etapa "Diagnóstico e Proposta": a dica só
            # vale para o anexo (Proposta Comercial) ou indo para Negociação.
            if vendas and nome == "mover" and link and ("proposta comercial" in msg.lower()
                                             or str(alvo or "").strip().lower() == "negociação"):
                msg += f" — anexe a proposta no card pela tela: {link}"
            if vendas and e.status == 409 and "gerente" not in msg.lower():
                msg += " — fale com o gerente comercial"
            ja = ", ".join(entrou) if entrou else "nada"
            fim = f" Confira no card: {link}" if link and entrou else ""
            raise hsgrowth.ErroSistema(
                e.status, f"Parou em {nome} ({n} de {total}): {msg}. Já entrou: {ja}. "
                          f"Nada foi desfeito.{fim}") from e


def _id_ou_erro(r, o_que: str) -> int:
    i = (r or {}).get("id") if isinstance(r, dict) else None
    if not i:
        raise hsgrowth.ErroSistema(502, f"o HSGrowth não devolveu o id do {o_que} criado")
    return int(i)


def _fim(entrou: list, p: dict) -> str:
    ex = p.get("_exibir") or {}
    txt = ("Entrou no HSGrowth: " + ", ".join(entrou) + ".") if entrou else "Nada novo entrou no HSGrowth."
    if ex.get("link"):
        txt += f" {ex['link']}"
    if ex.get("aviso"):
        txt += f" ⚠️ {hge.uma_linha(ex['aviso'], 300)}"
    return txt


async def _hsg(email, bot, dono, metodo, caminho, corpo=None, params=None):
    return await hsgrowth.chamar(email, bot, caminho, params=params, dono=dono, metodo=metodo, json=corpo)


async def _hsgrowth_registrar(email, bot, p, dono=None) -> str:
    cid = int(p["card_id"])
    entrou: list[str] = []
    passos: list = []

    def passo(nome, rotulo, metodo, caminho, corpo=None, params=None):
        async def f():
            await _hsg(email, bot, dono, metodo, caminho, corpo, params)
            entrou.append(rotulo)
        passos.append((nome, f))

    campos = _pegar(p.get("campos") or {}, hge.CAMPOS_CARD)
    if campos:
        passo("campos", "campos do card", "PUT", f"/cards/{cid}", campos)
    for c in p.get("campos_personalizados") or []:
        passo("campo personalizado", "campo personalizado", "POST", f"/cards/{cid}/fields",
              {"field_definition_id": int(c["field_definition_id"]), "value": c.get("value")})
    if p.get("nota"):
        passo("nota", "nota", "POST", "/card-notes", {"card_id": cid, "content": str(p["nota"])})
    for t in p.get("tarefas") or []:
        op = t.get("op")
        if op == "criar":
            passo("tarefa", "tarefa criada", "POST", "/card-tasks",
                  {"card_id": cid, **_pegar(t, _CAMPOS_TAREFA_CRIAR)})
        elif op == "alterar":
            passo("tarefa", "tarefa alterada", "PUT", f"/card-tasks/{int(t['task_id'])}",
                  _pegar(t, _CAMPOS_TAREFA_ALTERAR))
        elif op == "concluir":
            # ⚠️ `is_valid` do HSGrowth decide pontos de gamificação: nunca presumido.
            if not isinstance(t.get("valida"), bool):
                raise hsgrowth.ErroSistema(0, "cartão sem dizer se a tarefa foi realizada (`valida`); "
                                              "nada foi enviado ao HSGrowth")
            passo("tarefa", "tarefa concluída", "PATCH", f"/card-tasks/{int(t['task_id'])}/complete",
                  {"is_completed": True, "is_valid": t["valida"]})
    if p.get("mover_para"):
        passo("mover", "card movido", "PUT", f"/cards/{cid}/move",
              {"target_list_id": int(p["mover_para"])})
    await _hsg_lote(passos, entrou, _link_hsg(p), (p.get("_exibir") or {}).get("etapa_para"))
    return _fim(entrou, p)


async def _hsgrowth_cliente(email, bot, p, dono=None) -> str:
    entrou: list[str] = []
    passos: list = []
    cli, con = p.get("cliente"), p.get("contato")
    if cli:
        async def f1():
            await _hsg(email, bot, dono, "PUT", f"/clients/{int(cli['id'])}",
                       _pegar(cli.get("campos") or {}, hge.CAMPOS_CLIENTE))
            entrou.append("cliente")
        passos.append(("cliente", f1))
    if con:
        async def f2():
            await _hsg(email, bot, dono, "PUT", f"/persons/{int(con['id'])}",
                       _pegar(con.get("campos") or {}, hge.CAMPOS_CONTATO))
            entrou.append("contato")
        passos.append(("contato", f2))
    await _hsg_lote(passos, entrou, _link_hsg(p))
    return _fim(entrou, p)


async def _hsgrowth_criar_lead(email, bot, p, dono=None) -> str:
    dono_id = p.get("assigned_to_id")
    if isinstance(dono_id, bool) or not isinstance(dono_id, int):
        # Antes de qualquer passo: falhar no card deixaria cliente e contato criados à toa.
        raise hsgrowth.ErroSistema(0, "cartão sem o dono do lead; nada foi enviado ao HSGrowth")
    entrou: list[str] = []
    est: dict = {}
    cli, con = p.get("cliente") or {}, p.get("contato") or {}

    async def f_cli():
        if cli.get("id"):
            est["cliente"] = int(cli["id"])
            return
        r = await _hsg(email, bot, dono, "POST", "/clients", _pegar(cli.get("campos") or {}, hge.CAMPOS_CLIENTE))
        est["cliente"] = _id_ou_erro(r, "cliente")
        entrou.append("cliente criado")

    async def f_con():
        if con.get("id"):
            est["contato"] = int(con["id"])
            return
        corpo = {**_pegar(con.get("campos") or {}, hge.CAMPOS_CONTATO), "organization_id": est["cliente"]}
        r = await _hsg(email, bot, dono, "POST", "/persons", corpo)
        est["contato"] = _id_ou_erro(r, "contato")
        entrou.append("contato criado")

    async def f_card():
        corpo = {**_pegar(p.get("campos_do_card") or {}, hge.CAMPOS_CARD), "title": str(p["titulo"]),
                 "list_id": int(p["list_id"]), "client_id": est["cliente"], "person_id": est["contato"],
                 "assigned_to_id": dono_id}
        r = await _hsg(email, bot, dono, "POST", "/cards", corpo)
        est["card"] = _id_ou_erro(r, "card")
        entrou.append(f"card criado (id {est['card']})")

    await _hsg_lote([("cliente", f_cli), ("contato", f_con), ("card", f_card)], entrou, "")
    txt = "Lead criado no HSGrowth: " + ", ".join(entrou) + "."
    if est.get("card"):
        txt += f" {settings.HSGROWTH_URL.rstrip('/')}/cards/{est['card']}"
    return txt


async def _hsgrowth_ganhar(email, bot, p, dono=None) -> str:
    await _hsg(email, bot, dono, "POST", f"/cards/{int(p['card_id'])}/win", {})
    return "Negócio marcado como ganho."


async def _hsgrowth_perder(email, bot, p, dono=None) -> str:
    await _hsg(email, bot, dono, "POST", f"/cards/{int(p['card_id'])}/lose", {"loss_reason": str(p["motivo"])})
    return "Negócio marcado como perdido."


async def _hsgrowth_noshow(email, bot, p, dono=None) -> str:
    await _hsg(email, bot, dono, "PATCH", f"/card-tasks/{int(p['task_id'])}/noshow")
    return "Reunião marcada como no-show."


# ── HSGrowth Serviços e Cobrança (12/11/2026) ────────────────────────────────
# Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`.
# CONTRATO DO PAYLOAD (quem prepara o cartão, Task 4, grava exatamente isto; datas
# já em UTC; `board_id` 1 ou 2; os ids de etapa são `list_id`):
#   hsgrowth_servicos_registrar: {board_id, card_id, negocio?: {chaves de CHAVES_NEGOCIO},
#       campos?: {title, description, due_date, client_id, person_id}  (sem contact_info),
#       atividades?: [{op:"criar", category:"atividade", activity_type, title, priority?,
#                      description?, due_date?} | {op:"criar", category:"anotacao", description}
#                     | {op:"concluir", activity_id, valida: bool}],
#       mover?: {de, para}, _exibir: {link, aviso?, etapa_para?}}
#       → reler o card (se `mover`, etapa atual == `de` ANTES de escrever nada) → um `PUT`
#       com `campos` + `business_info` (= o do card relido ∪ `negocio`) → atividades →
#       `PUT …/move {list_id: para}`.
#   hsgrowth_servicos_itens: {board_id, card_id, ops: [{tipo: aparelho|servico,
#       acao: por|alterar|tirar, item_id?, corpo?}]  (o retorno de `hgse.item`), _exibir}
#       → `POST|PUT|DELETE …/products|services[/{item_id}]`.
#   hsgrowth_servicos_ganhar: {board_id, card_id, de, para, _exibir}
#   hsgrowth_servicos_perder: {board_id, card_id, de, para, motivo, _exibir}
#       → anotação "Motivo da perda: <motivo>" e só então o move.
#   hsgrowth_servicos_anexar_proposta: {board_id, card_id, numero, link_pdf, nome_arquivo, _exibir}
#       → baixa o PDF (só host do GestorHS, https, sem redirect, ≤ 10 MB) e sobe em
#       `POST …/activities/files?slot=proposta` (multipart `file`).
# ⚠️ Corpo = só chaves de allowlist, nunca `**p`: payload adulterado não leva `list_id`,
# `is_deleted`, `assigned_to_id` no PUT. Lote PARA no primeiro erro e NÃO desfaz.
# ⚠️ Nomes reais lá (conferidos em ~/github/hsgrowth-sistema): o move do Serviços usa
# `list_id` (o do Vendas usa `target_list_id`); o upload é `file` + query `slot`.

_LIMITE_PDF = 10 * 1024 * 1024
_transporte_pdf: httpx.AsyncBaseTransport | None = None   # trocável em teste
# ⚠️ Allowlist PRÓPRIA do executor (não `hgse.CAMPOS_PUT`): `contact_info` fica de fora por
# decisão de segurança — nunca chega ao PUT, nem de payload adulterado.
_CAMPOS_PUT_SERVICOS = ("title", "description", "due_date", "client_id", "person_id")
_CRIAR_ATIVIDADE = ("category", "activity_type", "title", "description", "priority", "due_date")


def _sv(p: dict) -> str:
    if p.get("board_id") not in (1, 2):
        raise hsgrowth.ErroSistema(0, "quadro fora de Serviços/Cobrança; nada foi enviado ao HSGrowth")
    return f"/service-boards/{int(p['board_id'])}/cards/{int(p['card_id'])}"


async def _sv_reler(email, bot, dono, p: dict, de=None) -> dict:
    """Relê o card; com `de`, recusa se a etapa já não é a do cartão (nada escrito)."""
    card = await _hsg(email, bot, dono, "GET", _sv(p))
    if not isinstance(card, dict):
        raise hsgrowth.ErroSistema(502, "o HSGrowth não devolveu o card")
    if de is not None and card.get("list_id") != int(de):
        raise hsgrowth.ErroSistema(0, "alguém mexeu no card desde o cartão (a etapa mudou) — "
                                      "peça de novo; nada foi enviado ao HSGrowth")
    return card


def _sv_mover(passos, entrou, email, bot, dono, p, para):
    async def f():
        await _hsg(email, bot, dono, "PUT", _sv(p) + "/move", {"list_id": int(para)})
        entrou.append("card movido")
    passos.append(("mover", f))


async def _hsgrowth_servicos_registrar(email, bot, p, dono=None) -> str:
    mov = p.get("mover") or None
    card = await _sv_reler(email, bot, dono, p, mov["de"] if mov else None)
    entrou: list[str] = []
    passos: list = []
    corpo = _pegar(p.get("campos") or {}, _CAMPOS_PUT_SERVICOS)
    negocio = _pegar(p.get("negocio") or {}, tuple(hgse.CHAVES_NEGOCIO))
    if negocio:
        # ⚠️ Mescla no CLIQUE: o card relido manda, o cartão só sobrepõe as suas chaves.
        corpo["business_info"] = {**(card.get("business_info") or {}), **negocio}
    if corpo:
        async def put():
            await _hsg(email, bot, dono, "PUT", _sv(p), corpo)
            entrou.append("campos do card")
        passos.append(("campos", put))
    for op in p.get("atividades") or []:
        if op.get("op") not in ("criar", "concluir"):
            raise hsgrowth.ErroSistema(0, "atividade do cartão com `op` desconhecido; nada foi enviado ao HSGrowth")
        if op["op"] == "concluir" and (not isinstance(op.get("valida"), bool)
                                        or not isinstance(op.get("activity_id"), int)):
            raise hsgrowth.ErroSistema(0, "cartão sem dizer qual atividade ou se teve resultado "
                                          "(`valida`); nada foi enviado ao HSGrowth")
    for op in p.get("atividades") or []:
        def _f(op=op):
            if op.get("op") == "concluir":
                async def concluir():
                    await _hsg(email, bot, dono, "PATCH", f"{_sv(p)}/activities/{int(op['activity_id'])}/complete",
                               {"is_completed": True, "is_valid": op["valida"]})
                    entrou.append("atividade concluída")
                return ("atividade", concluir)
            nota = op.get("category") == "anotacao"
            async def criar():
                await _hsg(email, bot, dono, "POST", f"{_sv(p)}/activities", _pegar(op, _CRIAR_ATIVIDADE))
                entrou.append("anotação" if nota else "atividade criada")
            return ("anotacao" if nota else "atividade", criar)
        passos.append(_f())
    if mov:
        _sv_mover(passos, entrou, email, bot, dono, p, mov["para"])
    await _hsg_lote(passos, entrou, _link_hsg(p), (p.get("_exibir") or {}).get("etapa_para"), vendas=False)
    return _fim(entrou, p)


async def _hsgrowth_servicos_itens(email, bot, p, dono=None) -> str:
    entrou: list[str] = []
    passos: list = []
    _sv(p)
    for op in p.get("ops") or []:
        if op.get("tipo") not in ("aparelho", "servico") or op.get("acao") not in ("por", "alterar", "tirar") \
                or (op["acao"] != "por" and (isinstance(op.get("item_id"), bool)
                                             or not isinstance(op.get("item_id"), int))):
            raise hsgrowth.ErroSistema(0, "item do cartão incompleto ou desconhecido; nada foi enviado ao HSGrowth")
    for op in p.get("ops") or []:
        produto = op.get("tipo") == "aparelho"
        rota, nome = ("products", "aparelho") if produto else ("services", "servico")
        chaves = ("product_id" if produto else "service_id", "quantity", "unit_price", "discount", "notes")
        acao, iid = op.get("acao"), op.get("item_id")
        metodo, caminho, corpo = {"por": ("POST", f"{_sv(p)}/{rota}", _pegar(op.get("corpo") or {}, chaves)),
                                  "alterar": ("PUT", f"{_sv(p)}/{rota}/{int(iid or 0)}",
                                              _pegar(op.get("corpo") or {}, chaves[1:])),
                                  "tirar": ("DELETE", f"{_sv(p)}/{rota}/{int(iid or 0)}", None)}[acao]
        rotulo = {"por": f"{nome} posto", "alterar": f"{nome} alterado", "tirar": f"{nome} tirado"}[acao]

        def _f(metodo=metodo, caminho=caminho, corpo=corpo, rotulo=rotulo, nome=nome):
            async def f():
                await _hsg(email, bot, dono, metodo, caminho, corpo)
                entrou.append(rotulo)
            return (nome, f)
        passos.append(_f())
    await _hsg_lote(passos, entrou, _link_hsg(p), vendas=False)
    return _fim(entrou, p)


async def _hsgrowth_servicos_ganhar(email, bot, p, dono=None) -> str:
    await _sv_reler(email, bot, dono, p, p["de"])
    entrou: list[str] = []
    passos: list = []
    _sv_mover(passos, entrou, email, bot, dono, p, p["para"])
    await _hsg_lote(passos, entrou, _link_hsg(p), vendas=False)
    return "Negócio ganho no HSGrowth." + (f" {_link_hsg(p)}" if _link_hsg(p) else "")


async def _hsgrowth_servicos_perder(email, bot, p, dono=None) -> str:
    await _sv_reler(email, bot, dono, p, p["de"])
    entrou: list[str] = []

    async def nota():
        await _hsg(email, bot, dono, "POST", f"{_sv(p)}/activities",
                   {"category": "anotacao", "description": f"Motivo da perda: {p['motivo']}"})
        entrou.append("motivo anotado")
    passos: list = [("anotacao", nota)]
    _sv_mover(passos, entrou, email, bot, dono, p, p["para"])
    await _hsg_lote(passos, entrou, _link_hsg(p), vendas=False)
    return "Negócio perdido no HSGrowth (motivo anotado)." + (f" {_link_hsg(p)}" if _link_hsg(p) else "")


def _hosts_do_gestorhs() -> set[str]:
    from urllib.parse import urlsplit
    return {h for h in (urlsplit(u).hostname for u in (settings.GESTORHS_API_URL, settings.GESTORHS_URL)) if h}


async def _baixar_pdf(url: str) -> bytes:
    """O `link_pdf` do GestorHS é público e assinado (sem token). ⚠️ O servidor faz GET
    nele: só https e só o host do GestorHS, sem seguir redirect (SSRF para a rede do
    gateway), teto de 10 MB e tem que ser PDF."""
    from urllib.parse import urlsplit
    partes = urlsplit(str(url))
    try:
        porta = partes.port
    except ValueError:
        porta = -1
    if (partes.scheme != "https" or (partes.hostname or "") not in _hosts_do_gestorhs()
            or porta not in (None, 443) or partes.username or partes.password):
        raise hsgrowth.ErroSistema(0, "o link do PDF não é do GestorHS; nada foi enviado ao HSGrowth")
    try:
        async with httpx.AsyncClient(timeout=30, transport=_transporte_pdf, follow_redirects=False) as c:
            async with c.stream("GET", str(url)) as r:
                if r.status_code != 200:
                    raise hsgrowth.ErroSistema(0, f"não consegui baixar o PDF da proposta ({r.status_code}); "
                                                  "nada foi enviado ao HSGrowth")
                tipo = r.headers.get("content-type", "").lower()
                dados = bytearray()
                async for parte in r.aiter_bytes():
                    dados += parte
                    if len(dados) > _LIMITE_PDF:
                        raise hsgrowth.ErroSistema(0, "o PDF da proposta passa de 10 MB; nada foi enviado ao HSGrowth")
    except httpx.HTTPError as e:
        raise hsgrowth.ErroSistema(0, f"não consegui baixar o PDF da proposta ({type(e).__name__}); "
                                      "nada foi enviado ao HSGrowth") from e
    if "pdf" not in tipo and not bytes(dados[:5]).startswith(b"%PDF"):
        raise hsgrowth.ErroSistema(0, "o link da proposta não devolveu um PDF; nada foi enviado ao HSGrowth")
    return bytes(dados)


async def _hsgrowth_servicos_anexar(email, bot, p, dono=None) -> str:
    pdf = await _baixar_pdf(p["link_pdf"])
    nome = hge.uma_linha(p.get("nome_arquivo") or f"Proposta {p.get('numero')}", 120).replace("/", "-").replace("\\", "-")
    if not nome.lower().endswith(".pdf"):
        nome += ".pdf"
    entrou: list[str] = []

    async def f():
        await hsgrowth.enviar_arquivo(email, bot, f"{_sv(p)}/activities/files", nome, pdf,
                                      "application/pdf", params={"slot": "proposta"}, dono=dono)
        entrou.append(f"proposta {p.get('numero')} anexada")
    await _hsg_lote([("arquivo", f)], entrou, _link_hsg(p), vendas=False)
    return _fim(entrou, p)


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
    ("gestorhs", "criar_proposta"): _gestorhs_criar_proposta,
    ("gestorhs", "alterar_proposta"): _gestorhs_alterar_proposta,
    ("hsgrowth", "hsgrowth_registrar"): _hsgrowth_registrar,
    ("hsgrowth", "hsgrowth_cliente"): _hsgrowth_cliente,
    ("hsgrowth", "hsgrowth_criar_lead"): _hsgrowth_criar_lead,
    ("hsgrowth", "hsgrowth_ganhar"): _hsgrowth_ganhar,
    ("hsgrowth", "hsgrowth_perder"): _hsgrowth_perder,
    ("hsgrowth", "hsgrowth_noshow"): _hsgrowth_noshow,
    ("hsgrowth_servicos", "hsgrowth_servicos_registrar"): _hsgrowth_servicos_registrar,
    ("hsgrowth_servicos", "hsgrowth_servicos_itens"): _hsgrowth_servicos_itens,
    ("hsgrowth_servicos", "hsgrowth_servicos_ganhar"): _hsgrowth_servicos_ganhar,
    ("hsgrowth_servicos", "hsgrowth_servicos_perder"): _hsgrowth_servicos_perder,
    ("hsgrowth_servicos", "hsgrowth_servicos_anexar_proposta"): _hsgrowth_servicos_anexar,
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
