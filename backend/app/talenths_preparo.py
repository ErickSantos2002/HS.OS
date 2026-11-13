"""Conferir no TalentHS (só GET) o que o Guardi quer escrever — no preparo do
cartão E de novo no clique (13/11/2026).

Spec `docs/superpowers/specs/2026-11-13-guardi-talenths-escrita-design.md`.
O catálogo, a validação e o corpo são puros, em `app/talenths_escrita.py`;
aqui mora a parte que LÊ: `conferir` devolve o que o cartão mostra (`exibir`:
nomes e o "antes"), os `avisos`, o `atual` que as substituições totais de lá
precisam e a `marca` — o retrato do estado que o cartão mostrou.

⚠️ A mesma `conferir` roda no clique (`app/acoes.py`): o cartão pode ter ficado
horas parado — o RH aprovou pela tela, o mês da meta fechou, alguém editou o
comunicado. Se a recusa vier agora ou a `marca` mudou, NADA é gravado. É o que
fecha "aprovar o que já não estava pendente" e "aprovar o que o cartão não
mostrou".

⚠️ A conferência é de ESTADO (pendente, dono da batida, mês aberto), não de
permissão: quem pode é o papel do dono lá. A única exceção é traduzir o 403 de
uma leitura do RH numa recusa legível antes de criar um cartão inútil.

Recusa = `ValueError` com a mensagem para a pessoa. Testado em
`tests/test_guardi_talenths_escrita.py`.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timedelta
from typing import Any, Awaitable, Callable

from app import talenths_escrita as te
from app.sistemas import talenths

__all__ = ["VERBOS", "conferir", "diferencas", "preparar", "resumo"]

Get = Callable[..., Awaitable[Any]]

_SO_RH = ("Essa ação é do RH no TalentHS, e o papel do seu dono lá não permite "
          "(é o TalentHS que decide).")
_STATUS = {"pending": "pendente", "approved": "aprovado", "rejected": "recusado",
           "valid": "válida", "draft": "rascunho", "published": "publicado",
           "active": "aberto", "closed": "fechado", "in_progress": "em andamento", "done": "concluída"}
_TETO_ANTES = 300

# O verbo do resumo (o front tem o seu, no mesmo tom: `cartaoDoTalentHS`).
VERBOS = {
    "pedir_ausencia": "Pedir ausência", "cancelar_ausencia": "Cancelar pedido de ausência",
    "ajustar_ponto": "Pedir ajuste de ponto", "lancar_batida": "Lançar batida",
    "responder_feedback": "Responder feedback", "inscrever_workshop": "Inscrever no workshop",
    "sair_do_workshop": "Sair do workshop", "concluir_tarefa_onboarding": "Tarefa de integração",
    "aprovar_ausencia": "Aprovar ausência", "recusar_ausencia": "Recusar ausência",
    "aprovar_ajuste_ponto": "Aprovar ajuste de ponto", "recusar_ajuste_ponto": "Recusar ajuste de ponto",
    "confirmar_batida": "Confirmar batida", "recusar_batida": "Recusar batida",
    "criar_comunicado": "Novo comunicado", "editar_comunicado": "Editar comunicado",
    "criar_evento": "Novo evento", "editar_evento": "Editar evento", "pedir_feedback": "Pedir feedback",
    "criar_pdi": "Novo PDI", "editar_pdi": "Editar PDI", "acrescentar_acao_pdi": "Nova ação no PDI",
    "atualizar_acao_pdi": "Atualizar ação do PDI", "lancar_realizado_meta": "Lançar realizado",
    "comentar_meta": "Comentar meta", "registrar_curso": "Registrar curso",
    "atribuir_onboarding": "Abrir integração",
}
assert set(VERBOS) == set(te.ACOES)


def _st(s) -> str:
    return _STATUS.get(str(s), str(s))


def _hash(s) -> str:
    return hashlib.sha256(str(s or "").encode()).hexdigest()[:16]


def _lista(r) -> list[dict]:
    return [x for x in (r if isinstance(r, list) else []) if isinstance(x, dict)]


def _achar(itens, ident: str) -> dict | None:
    return next((x for x in itens if str(x.get("id") or "").lower() == ident), None)


def _l(s, teto: int = 160) -> str:
    return te.uma_linha(s, teto)


async def _ler(get: Get, caminho: str, params=None, nao_achou: str | None = None, rh: bool = False):
    try:
        return await get(caminho, params)
    except talenths.ErroSistema as e:
        if e.status == 404 and nao_achou:
            raise ValueError(nao_achou) from e
        if e.status == 403 and rh:
            raise ValueError(_SO_RH) from e
        raise


async def _eu(get: Get) -> dict:
    me = await _ler(get, "/auth/me")
    perfil = (me or {}).get("profile") or {}
    papeis = {str(r.get("role")) for r in _lista((me or {}).get("roles"))}
    return {"user_id": str((me or {}).get("id") or ""), "company_id": str(perfil.get("company_id") or ""),
            "rh": bool(papeis & {"manager", "master_admin"})}


async def _pessoa(get: Get, user_id: str, eu: dict) -> dict:
    """A pessoa ALVO de uma ação do RH: existe, é da empresa do dono e está ativa.
    Lá, desligado vira 422 — melhor dizer antes do cartão."""
    nao = f"Não achei essa pessoa no TalentHS ({user_id}). Ache o user_id com talenths_consultar pessoas."
    p = await _ler(get, f"/profiles/{user_id}", nao_achou=nao)
    if not isinstance(p, dict) or (eu["company_id"] and str(p.get("company_id") or "") != eu["company_id"]):
        raise ValueError(nao)
    nome = _l(p.get("name") or p.get("email") or user_id)
    if p.get("deactivated_at"):
        raise ValueError(f"{nome} está desligado(a) no TalentHS: não recebe nada novo.")
    return {"nome": nome}


def _datas(r: dict) -> str:
    ini, fim = r.get("start_date"), r.get("end_date")
    txt = str(ini or "?") if not fim or fim == ini else f"{ini} a {fim}"
    if r.get("start_time") and r.get("end_time"):
        txt += f" das {r['start_time']} às {r['end_time']}"
    return txt


# ── uma ação por vez ─────────────────────────────────────────────────────────

async def _ausencia_nova(get, pedido, agora) -> dict:
    c = pedido["campos"]
    tipo = _achar(_lista(await _ler(get, "/absences/types")), c["type_id"])
    if not tipo:
        raise ValueError("Esse tipo de ausência não existe no TalentHS — veja talenths_consultar tipos_de_ausencia.")
    avisos = []
    if not tipo.get("requires_approval"):
        avisos.append(f"“{_l(tipo.get('name'))}” não pede aprovação: o pedido já nasce APROVADO.")
    if c["start_date"] < agora.date().isoformat():
        avisos.append("A data já passou: é um lançamento retroativo.")
    return {"exibir": {"tipo": _l(tipo.get("name"))}, "avisos": avisos,
            "marca": {"tipo_pede_aprovacao": bool(tipo.get("requires_approval"))}}


async def _ausencia_cancelar(get, pedido, agora) -> dict:
    r = _achar(_lista(await _ler(get, "/absences/my")), pedido["id"])
    if not r:
        raise ValueError("Esse pedido não está entre as ausências do seu dono — veja minhas_ausencias.")
    if r.get("status") != "pending":
        raise ValueError(f"Esse pedido já está {_st(r.get('status'))}: só cancelo pedido pendente.")
    return {"exibir": {"tipo": _l(r.get("type_name")), "datas": _l(_datas(r))},
            "marca": {"status": r.get("status")}}


async def _batidas_do_dono(get, agora) -> list[dict]:
    ini = (agora.date() - timedelta(days=62)).isoformat()
    dias = _lista(await _ler(get, "/timeclock/my", [("start_date", ini), ("end_date", agora.date().isoformat())]))
    return [b for d in dias for b in _lista(d.get("punches"))]


async def _ponto_ajustar(get, pedido, agora) -> dict:
    b = _achar(await _batidas_do_dono(get, agora), pedido["id"])
    if not b:
        raise ValueError("Não achei essa batida no ponto do seu dono dos últimos 62 dias — veja meu_ponto.")
    if b.get("status") != "valid":
        raise ValueError(f"Só dá para pedir ajuste de batida válida (essa está {_st(b.get('status'))}).")
    if b.get("pending_adjustment"):
        raise ValueError("Essa batida já tem um pedido de ajuste esperando o RH.")
    return {"exibir": {"batida": b.get("punched_at"), "tipo": b.get("kind")},
            "marca": {"punched_at": b.get("punched_at"), "status": b.get("status")}}


async def _ponto_lancar(get, pedido, agora) -> dict:
    hoje = await _ler(get, "/timeclock/my/today")
    if not (hoje or {}).get("enabled"):
        raise ValueError("O seu dono não está habilitado para bater ponto no TalentHS.")
    return {"avisos": ["Fica pendente até o RH confirmar."]}


async def _feedback_responder(get, pedido, agora) -> dict:
    f = _achar(_lista(await _ler(get, "/feedbacks/my")), pedido["id"])
    if not f:
        raise ValueError("Esse pedido de feedback não é para o seu dono — veja meus_feedbacks.")
    ex = {"pedido": _l(f.get("title")), "pergunta": _l(f.get("question"), _TETO_ANTES)}
    avisos = []
    if f.get("has_responded"):
        ex["anterior"] = {"rating": f.get("my_rating"), "comment": _l(f.get("my_comment"), _TETO_ANTES)}
        avisos.append(f"Substitui a resposta que já está lá (nota {f.get('my_rating')}).")
    return {"exibir": ex, "avisos": avisos,
            "marca": {"respondeu": bool(f.get("has_responded")), "nota": f.get("my_rating"),
                      "comentario": _hash(f.get("my_comment"))}}


async def _workshop(get, pedido, agora) -> dict:
    w = _achar(_lista(await _ler(get, "/workshops")), pedido["id"])
    if not w:
        raise ValueError("Não achei esse workshop — veja talenths_consultar workshops.")
    reg = w.get("user_registration_status")
    if pedido["acao"] == "inscrever_workshop":
        if reg:
            raise ValueError("O seu dono já está inscrito nesse workshop.")
        if w.get("status") != "open":
            raise ValueError("As inscrições desse workshop não estão abertas.")
        if w.get("max_seats") and (w.get("seats_taken") or 0) >= w["max_seats"]:
            raise ValueError("As vagas desse workshop acabaram.")
    else:
        # ⚠️ Lá o DELETE devolve 204 até sem inscrição: sem esta conferência o
        # cartão diria "feito" para nada.
        if not reg:
            raise ValueError("O seu dono não está inscrito nesse workshop.")
        if reg == "attended":
            raise ValueError("O seu dono já consta como presente nesse workshop: não tiro a inscrição.")
    return {"exibir": {"workshop": _l(w.get("title")), "quando": w.get("starts_at"),
                       "local": _l(w.get("location"))},
            "marca": {"inscricao": reg}}


async def _onboarding_tarefa(get, pedido, agora) -> dict:
    ident, concluir = pedido["id"], pedido["campos"]["concluir"]
    meu = await _ler(get, "/onboarding/my")
    tarefa, dono_dela, pessoa = None, False, None
    if isinstance(meu, dict):
        tarefa = _achar(_lista(meu.get("tasks")), ident)
        dono_dela, pessoa = tarefa is not None, meu.get("user_name")
    if tarefa is None:
        try:
            checklists = _lista(await _ler(get, "/onboarding/team", [("include_inactive", "true")]))
        except talenths.ErroSistema as e:
            if e.status == 403:
                raise ValueError("Essa tarefa não está no checklist do seu dono (o de outra pessoa, só o RH "
                                 "mexe).") from e
            raise
        for c in checklists:
            tarefa = _achar(_lista(c.get("tasks")), ident)
            if tarefa:
                pessoa = c.get("user_name")
                break
    if tarefa is None:
        raise ValueError("Não achei essa tarefa de integração — veja meu_onboarding.")
    feita = bool(tarefa.get("completed_at"))
    # ⚠️ Lá a rota é TOGGLE: chamar com a tarefa já no estado pedido a desfaria.
    if feita == concluir:
        raise ValueError("Essa tarefa já está " + ("concluída" if feita else "em aberto") + " — nada a fazer.")
    if dono_dela and tarefa.get("responsible_role") != "user" and not (await _eu(get))["rh"]:
        raise ValueError("Essa tarefa é do RH: só o RH a marca.")
    return {"exibir": {"tarefa": _l(tarefa.get("title")), "pessoa": _l(pessoa)},
            "marca": {"concluida": feita}}


# ── RH: aprovações (lote) ─────────────────────────────────────────────────────

async def _ausencias_pendentes(get, pedido, agora) -> dict:
    lst = _lista(await _ler(get, "/absences/team", rh=True))
    itens, marca = [], {}
    for ident in pedido["ids"]:
        r = _achar(lst, ident)
        if not r:
            raise ValueError(f"Não achei o pedido {ident} entre as ausências da empresa.")
        nome = _l(r.get("user_name"))
        # ⚠️ Lá o approve/reject NÃO confere o status: aprovaria de novo um
        # recusado. Quem segura é esta linha (no preparo e no clique).
        if r.get("status") != "pending":
            raise ValueError(f"O pedido de {nome} ({_datas(r)}) já não está pendente: está {_st(r.get('status'))}.")
        itens.append({"pessoa": nome, "tipo": _l(r.get("type_name")), "datas": _l(_datas(r)),
                      "dias": r.get("days")})
        marca[ident] = {"status": r.get("status"), "datas": _datas(r)}
    return {"exibir": {"itens": itens}, "marca": marca}


async def _ponto_pendente(get, pedido, agora) -> dict:
    req = await _ler(get, "/timeclock/requests", rh=True) or {}
    ajuste = "ajuste" in pedido["acao"]
    lst = _lista(req.get("adjustments" if ajuste else "pending_punches"))
    itens, marca = [], {}
    for ident in pedido["ids"]:
        r = _achar(lst, ident)
        if not r:
            o_que = "pedido de ajuste" if ajuste else "batida"
            raise ValueError(f"O {o_que} {ident} não está esperando o RH (já foi decidido ou não existe).")
        if ajuste:
            itens.append({"pessoa": _l(r.get("user_name")), "de": r.get("current_punched_at"),
                          "para": r.get("requested_punched_at"), "motivo": _l(r.get("reason"))})
            marca[ident] = {"para": r.get("requested_punched_at")}
        else:
            itens.append({"pessoa": _l(r.get("user_name")), "quando": r.get("punched_at"),
                          "tipo": r.get("kind"), "motivo": _l(r.get("reason"))})
            marca[ident] = {"quando": r.get("punched_at")}
    return {"exibir": {"itens": itens}, "marca": marca}


# ── RH: comunicação ──────────────────────────────────────────────────────────

_TODA_A_EMPRESA = "Visível para toda a empresa."


async def _comunicado_novo(get, pedido, agora) -> dict:
    if pedido["campos"].get("publicar"):
        return {"avisos": ["PUBLICADO: fica visível para toda a empresa assim que confirmar."]}
    return {"avisos": ["Fica como RASCUNHO: ninguém vê até publicar."]}


async def _comunicado_editar(get, pedido, agora) -> dict:
    a = _achar(_lista(await _ler(get, "/communications/announcements")), pedido["id"])
    if not a:
        raise ValueError("Não achei esse comunicado (a lista com rascunhos é só do RH).")
    atual = {k: a.get(k) for k in ("title", "content", "category", "status")}
    final = te.corpo("editar_comunicado", pedido["campos"], atual)["status"]
    avisos = []
    if final == "published":
        avisos.append("PUBLICADO: " + ("vai aparecer para" if atual["status"] != "published"
                                       else "continua visível para") + " toda a empresa.")
    elif atual["status"] == "published":
        avisos.append("Vai DESPUBLICAR: some para a empresa e volta a rascunho.")
    return {"exibir": {"comunicado": _l(a.get("title")),
                       "antes": {"title": _l(a.get("title")), "content": _l(a.get("content"), _TETO_ANTES),
                                 "category": _l(a.get("category")), "status": a.get("status")}},
            "avisos": avisos, "atual": atual,
            "marca": {"title": a.get("title"), "category": a.get("category"), "status": a.get("status"),
                      "content": _hash(a.get("content"))}}


async def _evento_novo(get, pedido, agora) -> dict:
    return {"avisos": [_TODA_A_EMPRESA]}


async def _evento_editar(get, pedido, agora) -> dict:
    e = _achar(_lista(await _ler(get, "/calendar/events")), pedido["id"])
    if not e:
        raise ValueError("Não achei esse evento — veja talenths_consultar eventos.")
    c = pedido["campos"]
    ini, fim = c.get("start_date", e.get("start_date")), c.get("end_date", e.get("end_date"))
    # Lá o PUT não confere fim ≥ início.
    if ini and fim and fim < ini:
        raise ValueError(f"Com essa mudança o evento terminaria ({fim}) antes de começar ({ini}).")
    antes = {k: e.get(k) for k in ("start_date", "end_date", "event_type", "all_day")}
    return {"exibir": {"evento": _l(e.get("title")),
                       "antes": {**antes, "title": _l(e.get("title")),
                                 "description": _l(e.get("description"), _TETO_ANTES)}},
            "avisos": [_TODA_A_EMPRESA],
            "marca": {**antes, "title": e.get("title"), "description": _hash(e.get("description"))}}


async def _feedback_pedir(get, pedido, agora) -> dict:
    c = pedido["campos"]
    if c["alvo"] == "todos":
        return {"exibir": {"alvo": "toda a empresa"}}
    eu = await _eu(get)
    if c["alvo"] == "pessoa":
        return {"exibir": {"alvo": (await _pessoa(get, c["user_id"], eu))["nome"]}}
    deps = _lista(await _ler(get, "/departments", [("company_id", eu["company_id"])] if eu["company_id"] else None))
    d = _achar(deps, c["department_id"])
    if not d or (eu["company_id"] and str(d.get("company_id") or eu["company_id"]) != eu["company_id"]):
        raise ValueError("Não achei esse departamento na empresa — veja talenths_consultar departamentos.")
    return {"exibir": {"alvo": f"departamento {_l(d.get('name'))}"}}


# ── RH: desenvolvimento ──────────────────────────────────────────────────────

async def _pdi_novo(get, pedido, agora) -> dict:
    c = pedido["campos"]
    ex = {"pessoa": (await _pessoa(get, c["user_id"], await _eu(get)))["nome"]}
    if c.get("eval_cycle_id"):
        ciclo = _achar(_lista(await _ler(get, "/evaluations/cycles")), c["eval_cycle_id"])
        if not ciclo:
            raise ValueError("Esse ciclo de avaliação não existe — veja ciclos_de_avaliacao.")
        ex["ciclo"] = _l(ciclo.get("name"))
    return {"exibir": ex}


async def _plano(get, ident: str) -> dict:
    p = _achar(_lista(await _ler(get, "/pdi/team", [("include_inactive", "true")], rh=True)), ident)
    if not p:
        raise ValueError("Não achei esse PDI entre os da empresa — veja pdi_do_time.")
    return p


async def _pdi_editar(get, pedido, agora) -> dict:
    p = await _plano(get, pedido["id"])
    c = pedido["campos"]
    if set(c) == {"fechar"} and (p.get("status") == "closed") == c["fechar"]:
        raise ValueError("Esse PDI já está " + ("fechado" if c["fechar"] else "aberto") + " — nada a fazer.")
    atual = {k: p.get(k) for k in ("title", "description", "status")}
    return {"exibir": {"pessoa": _l(p.get("user_name")), "plano": _l(p.get("title")),
                       "antes": {"title": _l(p.get("title")), "description": _l(p.get("description"), _TETO_ANTES),
                                 "status": p.get("status")}},
            "atual": atual,
            "marca": {"title": p.get("title"), "status": p.get("status"), "description": _hash(p.get("description"))}}


async def _pdi_acao_nova(get, pedido, agora) -> dict:
    p = await _plano(get, pedido["id"])
    avisos = ["Esse PDI está fechado."] if p.get("status") == "closed" else []
    return {"exibir": {"pessoa": _l(p.get("user_name")), "plano": _l(p.get("title"))}, "avisos": avisos,
            "marca": {"status": p.get("status")}}


async def _pdi_acao_atualizar(get, pedido, agora) -> dict:
    ident = pedido["id"]
    achou = None
    for p in _lista(await _ler(get, "/pdi/my")):
        a = _achar(_lista(p.get("actions")), ident)
        if a:
            achou = (p, a)
            break
    if achou is None:
        try:
            planos = _lista(await _ler(get, "/pdi/team", [("include_inactive", "true")]))
        except talenths.ErroSistema as e:
            if e.status == 403:
                raise ValueError("Essa ação não é do PDI do seu dono (o de outra pessoa, só o RH mexe).") from e
            raise
        for p in planos:
            a = _achar(_lista(p.get("actions")), ident)
            if a:
                achou = (p, a)
                break
    if achou is None:
        raise ValueError("Não achei essa ação de PDI — veja meu_pdi.")
    p, a = achou
    antes = {k: a.get(k) for k in ("due_date", "status")}
    return {"exibir": {"pessoa": _l(p.get("user_name")), "plano": _l(p.get("title")), "acao": _l(a.get("title")),
                       "antes": {**antes, "title": _l(a.get("title")),
                                 "description": _l(a.get("description"), _TETO_ANTES),
                                 "how": _l(a.get("how"), _TETO_ANTES)}},
            "marca": {**antes, "title": a.get("title"), "description": _hash(a.get("description")),
                      "how": _hash(a.get("how"))}}


async def _meta(get, ident: str) -> dict:
    g = await _ler(get, f"/goals/{ident}", nao_achou="Não achei essa meta — veja talenths_consultar metas.")
    if not isinstance(g, dict):
        raise ValueError("Não achei essa meta — veja talenths_consultar metas.")
    return g


async def _meta_realizado(get, pedido, agora) -> dict:
    g = await _meta(get, pedido["id"])
    mes = pedido["campos"]["mes"]
    real = next((x for x in _lista(g.get("actuals")) if x.get("month") == mes), {})
    if real.get("is_closed"):
        raise ValueError(f"O mês {mes} dessa meta já foi fechado: não aceita lançamento (reabrir é pela tela "
                         "do TalentHS).")
    plano = next((x for x in _lista(g.get("plans")) if x.get("month") == mes), {})
    ex = {"meta": _l(g.get("title")), "planejado": plano.get("planned_value")}
    if real:
        ex["antes"] = {"actual_value": real.get("actual_value"), "comment": _l(real.get("comment"), _TETO_ANTES)}
    return {"exibir": ex, "atual": {"comment": real.get("comment")},
            "marca": {"actual_value": real.get("actual_value"), "comment": _hash(real.get("comment")),
                      "fechado": bool(real.get("is_closed"))}}


async def _meta_comentar(get, pedido, agora) -> dict:
    return {"exibir": {"meta": _l((await _meta(get, pedido["id"])).get("title"))}}


async def _curso(get, pedido, agora) -> dict:
    c = pedido["campos"]
    ex = {"pessoa": (await _pessoa(get, c["user_id"], await _eu(get)))["nome"]}
    if c.get("catalog_id"):
        item = _achar(_lista(await _ler(get, "/learning/catalog")), c["catalog_id"])
        if not item:
            raise ValueError("Esse curso não está no catálogo — veja talenths_consultar cursos.")
        ex["catalogo"] = _l(item.get("title"))
    return {"exibir": ex}


async def _onboarding_atribuir(get, pedido, agora) -> dict:
    c = pedido["campos"]
    ex = {"pessoa": (await _pessoa(get, c["user_id"], await _eu(get)))["nome"]}
    avisos = []
    if c.get("template_id"):
        # ⚠️ Lá, modelo inexistente vira checklist VAZIO sem erro.
        t = _achar(_lista(await _ler(get, "/onboarding/templates", rh=True)), c["template_id"])
        if not t:
            raise ValueError("Esse modelo de integração não existe — veja modelos_de_onboarding.")
        ex.update({"modelo": _l(t.get("name")), "tarefas": len(_lista(t.get("tasks")))})
    else:
        avisos.append("Sem modelo: o checklist nasce vazio.")
    checklists = _lista(await _ler(get, "/onboarding/team", [("include_inactive", "true")], rh=True))
    if any(str(x.get("user_id") or "").lower() == c["user_id"] for x in checklists):
        raise ValueError(f"{ex['pessoa']} já tem checklist de integração.")
    return {"exibir": ex, "avisos": avisos}


_CONFERE = {
    "pedir_ausencia": _ausencia_nova, "cancelar_ausencia": _ausencia_cancelar,
    "ajustar_ponto": _ponto_ajustar, "lancar_batida": _ponto_lancar,
    "responder_feedback": _feedback_responder, "inscrever_workshop": _workshop, "sair_do_workshop": _workshop,
    "concluir_tarefa_onboarding": _onboarding_tarefa,
    "aprovar_ausencia": _ausencias_pendentes, "recusar_ausencia": _ausencias_pendentes,
    "aprovar_ajuste_ponto": _ponto_pendente, "recusar_ajuste_ponto": _ponto_pendente,
    "confirmar_batida": _ponto_pendente, "recusar_batida": _ponto_pendente,
    "criar_comunicado": _comunicado_novo, "editar_comunicado": _comunicado_editar,
    "criar_evento": _evento_novo, "editar_evento": _evento_editar, "pedir_feedback": _feedback_pedir,
    "criar_pdi": _pdi_novo, "editar_pdi": _pdi_editar, "acrescentar_acao_pdi": _pdi_acao_nova,
    "atualizar_acao_pdi": _pdi_acao_atualizar, "lancar_realizado_meta": _meta_realizado,
    "comentar_meta": _meta_comentar, "registrar_curso": _curso, "atribuir_onboarding": _onboarding_atribuir,
}
assert set(_CONFERE) == set(te.ACOES)


async def conferir(get: Get, pedido: dict, agora: datetime | None = None) -> dict:
    """Lê o TalentHS e devolve {exibir, avisos, atual, marca}. Recusa = ValueError."""
    agora = agora or te.agora_brasilia()
    try:
        est = await _CONFERE[pedido["acao"]](get, pedido, agora)
    except talenths.ErroSistema as e:
        if e.status == 403 and te.ACOES[pedido["acao"]].grupo == "RH":
            raise ValueError(_SO_RH) from e
        raise
    return {"exibir": est.get("exibir") or {}, "avisos": est.get("avisos") or [],
            "atual": est.get("atual") or {}, "marca": est.get("marca") or {}}


def diferencas(antes: dict, agora: dict, prefixo: str = "") -> list[str]:
    """O que mudou entre a `marca` do cartão e a de agora, em texto."""
    out = []
    for k in sorted(set(antes) | set(agora)):
        a, b = antes.get(k), agora.get(k)
        if isinstance(a, dict) and isinstance(b, dict):
            out += diferencas(a, b, f"{prefixo}{k}.")
        elif a != b:
            out.append(f"{prefixo}{k}: {a!r} → {b!r}")
    return out


def resumo(pedido: dict, exibir: dict) -> str:
    nome, c = pedido["acao"], pedido.get("campos") or {}
    itens = exibir.get("itens") or []
    if itens:
        quem = ", ".join(i.get("pessoa") or "?" for i in itens[:3]) + (f" e mais {len(itens) - 3}"
                                                                      if len(itens) > 3 else "")
        alvo = quem
    else:
        alvo = (exibir.get("pessoa") or exibir.get("comunicado") or exibir.get("evento") or exibir.get("workshop")
                or exibir.get("tarefa") or exibir.get("meta") or exibir.get("pedido") or exibir.get("tipo")
                or c.get("title") or c.get("course_title") or "")
    return _l(f"TalentHS · {VERBOS[nome]}" + (f" — {alvo}" if alvo else ""), 200)


async def preparar(ctx: dict, bot: str, args: dict, agora: datetime | None = None) -> tuple[dict, str, str | None]:
    """Valida (antes da rede), confere no TalentHS (só GET) e devolve
    (payload, resumo, avisos) para o `mcp_bot` gravar o cartão."""
    agora = agora or te.agora_brasilia()
    pedido = te.validar(str(args.get("acao") or ""), args, agora)

    async def get(caminho, params=None):
        return await talenths.chamar(ctx["email"], bot, caminho, params=params, dono=ctx["dono"])

    est = await conferir(get, pedido, agora)
    payload = {**pedido, "_marca": est["marca"], "_exibir": {**est["exibir"], "avisos": est["avisos"]}}
    return payload, resumo(pedido, est["exibir"]), ("\n".join(est["avisos"]) or None)
