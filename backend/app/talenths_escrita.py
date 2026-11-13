"""O que o Guardi pode ESCREVER no TalentHS — e só isso (13/11/2026).

Spec `docs/superpowers/specs/2026-11-13-guardi-talenths-escrita-design.md`.
Continua a leitura (`app/talenths_consultas.py`) com o mesmo princípio: o agente
escolhe uma AÇÃO desta lista e manda os CAMPOS dela — nunca um caminho nem um
corpo cru. Aqui mora a parte pura: o catálogo, a validação dos campos (com os
tipos de lá) e a montagem do corpo. A conferência no TalentHS (só GET) e o
cartão ficam em `app/talenths_preparo.py`; a execução no clique, em
`app/acoes.py`.

Por que o corpo é montado AQUI e não lá: vários handlers do TalentHS recebem
`body: dict`, e chave obrigatória ausente vira 500, não 422. Validar com os
tipos de lá antes do cartão é o que faz a recusa chegar legível à pessoa.

⚠️ Fora, de propósito (decisão do Erick, 13/11/2026): cadastro, desligamento,
senha e papel de colaborador; salário; enviar e calibrar avaliação; BATER
PONTO (`POST /timeclock/punch`, registro legal); exclusões além das duas
previstas; configurações (tipos, modelos, trilhas, tabelas, catálogos);
anexos. O allowlist de escrita do TalentHS fecha o mesmo, do lado de lá.

Datas são AAAA-MM-DD. Horários são de Brasília, AAAA-MM-DDTHH:MM, e vão ao
TalentHS com o deslocamento explícito (-03:00): lá, horário sem fuso já é lido
como Brasília, e o cartão do HS.OS lê sem fuso como UTC — com o deslocamento,
os dois lados concordam. Puro, testado em `tests/test_guardi_talenths_escrita.py`.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from app.bots_pessoais import _linha

__all__ = ["ACOES", "Acao", "Campo", "TETO_LOTE", "TETO_ACOES_PDI", "TETO_TEXTO", "TETO_TITULO",
           "CATEGORIAS", "validar", "rota", "corpo", "corpo_do_plano", "corpo_da_acao_pdi",
           "texto_do_catalogo", "uma_linha", "agora_brasilia"]

FUSO = ZoneInfo("America/Sao_Paulo")
TETO_LOTE = 20
TETO_ACOES_PDI = 15
TETO_TEXTO = 4000
TETO_TITULO = 200
_TETO_EXIBIR = 160

# Todo id do TalentHS é uuid. Conferir o formato aqui fecha `../` na rota e
# poupa uma chamada que lá voltaria 500 (uuid inválido no asyncpg).
_UUID = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_HORA = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_INSTANTE = re.compile(r"^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?$")

# As categorias que a tela de Comunicação do TalentHS oferece (CommunicationsAdminPage).
CATEGORIAS = ("Geral", "RH", "Benefícios", "Evento", "Urgente", "Reconhecimento")
TIPOS_DE_EVENTO = ("event", "holiday", "deadline", "meeting", "training")
STATUS_ACAO_PDI = ("pending", "in_progress", "done")


def uma_linha(s, teto: int = _TETO_EXIBIR) -> str:
    """Texto vindo do TalentHS (nome, título) para o cartão: uma linha, cortada —
    quebra de linha ali viraria instrução no prompt."""
    return _linha(str(s or ""), teto)


def agora_brasilia() -> datetime:
    return datetime.now(FUSO)


@dataclass(frozen=True)
class Campo:
    tipo: str                 # titulo texto data hora instante bool nota mes numero horas id enum acoes_pdi
    obrigatorio: bool = False
    opcoes: tuple = ()
    desc: str = ""


@dataclass(frozen=True)
class Acao:
    metodo: str
    rota: str                 # {id} vem do `id`; {user_id} e {mes} vêm dos campos
    grupo: str                # "todos" (o próprio dono) ou "RH" (manager/master_admin lá)
    desc: str
    campos: dict = field(default_factory=dict)
    alvo: str | None = None   # o que é o `id`; None = a ação não leva id
    lote: bool = False        # aceita `ids` (até TETO_LOTE) num cartão só


_NOTA = Campo("texto", desc="observação de quem decide (opcional)")
_ACAO_PDI = {"title": Campo("titulo", True), "description": Campo("texto"), "how": Campo("texto", desc="como fazer"),
             "due_date": Campo("data", desc="prazo AAAA-MM-DD")}

ACOES: dict[str, Acao] = {
    # ── colaborador: sempre o PRÓPRIO dono ──────────────────────────────────────
    "pedir_ausencia": Acao(
        "POST", "/absences/request", "todos",
        "pedir férias, folga ou ausência (dia inteiro, período ou parte de um dia)",
        {"type_id": Campo("id", True, desc="o tipo, de talenths_consultar tipos_de_ausencia"),
         "start_date": Campo("data", True), "end_date": Campo("data", desc="padrão: o mesmo dia"),
         "start_time": Campo("hora", desc="HH:MM — só na ausência de parte do dia, com end_time"),
         "end_time": Campo("hora", desc="HH:MM"), "reason": Campo("texto", desc="motivo")}),
    "cancelar_ausencia": Acao("DELETE", "/absences/{id}", "todos",
                              "cancelar um pedido de ausência do seu dono que ainda está pendente",
                              alvo="o id do pedido (minhas_ausencias)"),
    "ajustar_ponto": Acao(
        "POST", "/timeclock/{id}/adjust", "todos",
        "pedir ao RH o ajuste do horário de uma batida do seu dono (vai para aprovação)",
        {"requested_punched_at": Campo("instante", True, desc="o horário certo, AAAA-MM-DDTHH:MM (Brasília)"),
         "reason": Campo("texto", True)},
        alvo="o id da batida (meu_ponto)"),
    "lancar_batida": Acao(
        "POST", "/timeclock/manual-self", "todos",
        "lançar uma batida que o seu dono esqueceu (fica pendente até o RH confirmar)",
        {"kind": Campo("enum", True, ("in", "out"), "in = entrada, out = saída"),
         "punched_at": Campo("instante", True, desc="AAAA-MM-DDTHH:MM (Brasília)"),
         "reason": Campo("texto", True)}),
    "responder_feedback": Acao(
        "POST", "/feedbacks/{id}/respond", "todos", "responder um pedido de feedback",
        {"rating": Campo("nota", True, desc="de 1 a 5"), "comment": Campo("texto")},
        alvo="o id do pedido (meus_feedbacks)"),
    "inscrever_workshop": Acao("POST", "/workshops/{id}/register", "todos",
                               "inscrever o seu dono num workshop", alvo="o id do workshop (workshops)"),
    "sair_do_workshop": Acao("DELETE", "/workshops/{id}/register", "todos",
                             "tirar a inscrição do seu dono de um workshop", alvo="o id do workshop (workshops)"),
    "concluir_tarefa_onboarding": Acao(
        "PUT", "/onboarding/checklist-tasks/{id}/complete", "todos",
        "marcar (ou desmarcar) uma tarefa do checklist de integração",
        {"concluir": Campo("bool", True, desc="true = concluir, false = reabrir")},
        alvo="o id da tarefa (meu_onboarding ou onboarding_do_time)"),
    # ── RH: aprovações (aceitam lote) ──────────────────────────────────────────
    "aprovar_ausencia": Acao("PUT", "/absences/{id}/approve", "RH", "aprovar pedidos de ausência pendentes",
                             {"note": _NOTA}, alvo="o id do pedido (ausencias_do_time)", lote=True),
    "recusar_ausencia": Acao("PUT", "/absences/{id}/reject", "RH", "recusar pedidos de ausência pendentes",
                             {"note": _NOTA}, alvo="o id do pedido (ausencias_do_time)", lote=True),
    "aprovar_ajuste_ponto": Acao("POST", "/timeclock/adjustments/{id}/approve", "RH",
                                 "aprovar pedidos de ajuste de ponto",
                                 alvo="o id do ajuste (ajustes_de_ponto, em adjustments)", lote=True),
    "recusar_ajuste_ponto": Acao("POST", "/timeclock/adjustments/{id}/reject", "RH",
                                 "recusar pedidos de ajuste de ponto", {"note": _NOTA},
                                 alvo="o id do ajuste (ajustes_de_ponto, em adjustments)", lote=True),
    "confirmar_batida": Acao("POST", "/timeclock/punches/{id}/confirm", "RH",
                             "confirmar batidas lançadas à mão que esperam o RH",
                             alvo="o id da batida (ajustes_de_ponto, em pending_punches)", lote=True),
    "recusar_batida": Acao("POST", "/timeclock/punches/{id}/reject", "RH",
                           "recusar batidas lançadas à mão que esperam o RH",
                           alvo="o id da batida (ajustes_de_ponto, em pending_punches)", lote=True),
    # ── RH: comunicação ────────────────────────────────────────────────────────
    "criar_comunicado": Acao(
        "POST", "/communications/announcements", "RH",
        "escrever um comunicado (nasce RASCUNHO; publicado, toda a empresa vê)",
        {"title": Campo("titulo", True), "content": Campo("texto", True),
         "category": Campo("enum", False, CATEGORIAS, "padrão: Geral"),
         "publicar": Campo("bool", desc="true = publica para a empresa inteira; padrão false (rascunho)")}),
    "editar_comunicado": Acao(
        "PUT", "/communications/announcements/{id}", "RH",
        "mudar um comunicado (o que não for pedido fica como está, inclusive publicado ou não)",
        {"title": Campo("titulo"), "content": Campo("texto"), "category": Campo("enum", False, CATEGORIAS),
         "publicar": Campo("bool", desc="true publica, false volta a rascunho; omitido mantém")},
        alvo="o id do comunicado (comunicados)"),
    "criar_evento": Acao(
        "POST", "/calendar/events", "RH", "pôr um evento no calendário da empresa (toda a empresa vê)",
        {"title": Campo("titulo", True), "start_date": Campo("data", True),
         "end_date": Campo("data", desc="padrão: o mesmo dia"),
         "event_type": Campo("enum", False, TIPOS_DE_EVENTO, "padrão: event"),
         "description": Campo("texto"), "all_day": Campo("bool", desc="padrão: true")}),
    "editar_evento": Acao(
        "PUT", "/calendar/events/{id}", "RH", "mudar um evento do calendário da empresa",
        {"title": Campo("titulo"), "start_date": Campo("data"), "end_date": Campo("data"),
         "event_type": Campo("enum", False, TIPOS_DE_EVENTO), "description": Campo("texto"),
         "all_day": Campo("bool")},
        alvo="o id do evento (eventos)"),
    "pedir_feedback": Acao(
        "POST", "/feedbacks", "RH", "abrir um pedido de feedback para todos, um departamento ou uma pessoa",
        {"title": Campo("titulo", True), "question": Campo("texto", True),
         "alvo": Campo("enum", True, ("todos", "departamento", "pessoa")),
         "department_id": Campo("id", desc="obrigatório com alvo=departamento (departamentos)"),
         "user_id": Campo("id", desc="obrigatório com alvo=pessoa (pessoas)")}),
    # ── RH: desenvolvimento ────────────────────────────────────────────────────
    "criar_pdi": Acao(
        "POST", "/pdi/plans", "RH", "montar o PDI de uma pessoa, com as ações",
        {"user_id": Campo("id", True, desc="a pessoa (pessoas)"), "title": Campo("titulo", True),
         "description": Campo("texto"), "eval_cycle_id": Campo("id", desc="ciclo de avaliação (opcional)"),
         "acoes": Campo("acoes_pdi", desc=f"até {TETO_ACOES_PDI}: {{title*, description, how, due_date}}")}),
    "editar_pdi": Acao(
        "PUT", "/pdi/plans/{id}", "RH", "mudar título ou descrição de um PDI, ou fechá-lo/reabri-lo",
        {"title": Campo("titulo"), "description": Campo("texto"),
         "fechar": Campo("bool", desc="true fecha, false reabre; omitido mantém")},
        alvo="o id do plano (pdi_do_time)"),
    "acrescentar_acao_pdi": Acao("POST", "/pdi/plans/{id}/actions", "RH", "acrescentar uma ação a um PDI",
                                 dict(_ACAO_PDI), alvo="o id do plano (pdi_do_time)"),
    "atualizar_acao_pdi": Acao(
        "PUT", "/pdi/actions/{id}", "todos",
        "atualizar uma ação de PDI (o colaborador, só as do próprio PDI)",
        {"title": Campo("titulo"), "description": Campo("texto"), "how": Campo("texto"),
         "due_date": Campo("data"), "status": Campo("enum", False, STATUS_ACAO_PDI)},
        alvo="o id da ação (meu_pdi ou pdi_do_time)"),
    "lancar_realizado_meta": Acao(
        "PUT", "/goals/{id}/actuals/{mes}", "RH", "lançar o realizado de um mês de uma meta",
        {"mes": Campo("mes", True, desc="1 a 12"), "actual_value": Campo("numero", True),
         "comment": Campo("texto", desc="omitido mantém o comentário que já está lá")},
        alvo="o id da meta (metas)"),
    "comentar_meta": Acao("POST", "/goals/{id}/comments", "RH", "comentar uma meta (sem anexo)",
                          {"texto": Campo("texto", True)}, alvo="o id da meta (metas)"),
    "registrar_curso": Acao(
        "POST", "/learning/employee/{user_id}", "RH", "registrar um curso que uma pessoa concluiu",
        {"user_id": Campo("id", True, desc="a pessoa (pessoas)"), "course_title": Campo("titulo", True),
         "area": Campo("titulo", True), "catalog_id": Campo("id", desc="do catálogo (cursos), se for de lá"),
         "hours": Campo("horas", desc="carga horária"), "completed_at": Campo("data", desc="padrão: hoje")}),
    "atribuir_onboarding": Acao(
        "POST", "/onboarding/assign", "RH", "abrir o checklist de integração de uma pessoa",
        {"user_id": Campo("id", True, desc="a pessoa (pessoas)"),
         "template_id": Campo("id", desc="o modelo (modelos_de_onboarding)"),
         "started_at": Campo("data", desc="início; padrão: hoje")}),
}

# O que a pessoa diria ao Guardi para chegar a esta ação — só para a tela
# "Capacidade" (`app/capacidade.py`). Opcional: sem exemplo, a tela mostra só o
# rótulo. O agente não lê isto: ele lê a descrição acima.
EXEMPLOS: dict[str, str] = {
    "pedir_ausencia": "pede folga na terça",
    "cancelar_ausencia": "cancela o meu pedido de férias de dezembro",
    "ajustar_ponto": "a minha entrada de ontem foi 8h, não 8h20",
    "lancar_batida": "esqueci de bater a saída ontem às 18h",
    "responder_feedback": "responde o feedback com nota 4",
    "inscrever_workshop": "me inscreve no workshop de Excel",
    "aprovar_ausencia": "aprova as férias da Ana",
    "aprovar_ajuste_ponto": "aprova os ajustes de ponto pendentes",
    "criar_comunicado": "escreve um comunicado sobre o feriado",
    "criar_evento": "põe a confraternização no calendário dia 19",
    "criar_pdi": "monta o PDI do João com três ações",
    "lancar_realizado_meta": "lança 120 no realizado de outubro da meta de vendas",
}


# ── validação ────────────────────────────────────────────────────────────────

def _id(v, campo: str) -> str:
    if not isinstance(v, str) or not _UUID.match(v.strip()):
        raise ValueError(f"`{campo}` tem que ser o id (uuid) que veio do TalentHS.")
    return v.strip().lower()


def _data(v, campo: str) -> str:
    if not isinstance(v, str) or not _DATA.match(v.strip()):
        raise ValueError(f"`{campo}` é uma data AAAA-MM-DD.")
    try:
        return date.fromisoformat(v.strip()).isoformat()
    except ValueError:
        raise ValueError(f"`{campo}` não é uma data que existe: {v}.") from None


def _instante(v, campo: str) -> str:
    m = _INSTANTE.match(v.strip()) if isinstance(v, str) else None
    if not m:
        raise ValueError(f"`{campo}` é AAAA-MM-DDTHH:MM, hora de Brasília (sem fuso).")
    try:
        d = datetime.fromisoformat(f"{m.group(1)}T{m.group(2)}")
    except ValueError:
        raise ValueError(f"`{campo}` não é um horário que existe: {v}.") from None
    return d.replace(tzinfo=FUSO).isoformat()


def _valor(nome: str, c: Campo, v):
    if c.tipo == "id":
        return _id(v, nome)
    if c.tipo == "data":
        return _data(v, nome)
    if c.tipo == "instante":
        return _instante(v, nome)
    if c.tipo == "hora":
        if not isinstance(v, str) or not _HORA.match(v.strip()):
            raise ValueError(f"`{nome}` é HH:MM.")
        return v.strip()
    if c.tipo == "bool":
        if not isinstance(v, bool):
            raise ValueError(f"`{nome}` é true ou false.")
        return v
    if c.tipo in ("nota", "mes"):
        lo, hi = (1, 5) if c.tipo == "nota" else (1, 12)
        if isinstance(v, bool) or not isinstance(v, int) or not lo <= v <= hi:
            raise ValueError(f"`{nome}` é um número inteiro de {lo} a {hi}.")
        return v
    if c.tipo in ("numero", "horas"):
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
            raise ValueError(f"`{nome}` é um número (use ponto para decimais).")
        if c.tipo == "horas" and not 0 <= v <= 10000:
            raise ValueError(f"`{nome}` tem que estar entre 0 e 10000 horas.")
        return v
    if c.tipo == "enum":
        if v not in c.opcoes:
            raise ValueError(f"`{nome}` é um de: {', '.join(c.opcoes)}.")
        return v
    if c.tipo in ("titulo", "texto"):
        if not isinstance(v, str):
            raise ValueError(f"`{nome}` é texto.")
        t = v.strip()
        if c.tipo == "titulo":
            t = " ".join(t.split())
        teto = TETO_TITULO if c.tipo == "titulo" else TETO_TEXTO
        if len(t) > teto:
            raise ValueError(f"`{nome}` passa de {teto} caracteres ({len(t)}).")
        return t
    if c.tipo == "acoes_pdi":
        if not isinstance(v, list) or len(v) > TETO_ACOES_PDI:
            raise ValueError(f"`{nome}` é uma lista de até {TETO_ACOES_PDI} ações.")
        return [_campos(f"{nome}[{i}]", _ACAO_PDI, a) for i, a in enumerate(v)]
    raise AssertionError(c.tipo)


def _campos(onde: str, especie: dict, dados) -> dict:
    if dados is None:
        dados = {}
    if not isinstance(dados, dict):
        raise ValueError(f"`{onde}`: um objeto nome → valor.")
    fora = [k for k in dados if k not in especie]
    if fora:
        aceitos = ", ".join(especie) or "nenhum"
        raise ValueError(f"`{onde}` não aceita {', '.join(map(repr, fora))}. Aceitos: {aceitos}.")
    saida = {}
    for k, c in especie.items():
        v = dados.get(k)
        if v is None or (isinstance(v, str) and not v.strip()):
            if c.obrigatorio:
                raise ValueError(f"Falta `{k}` em {onde}.")
            continue
        saida[k] = _valor(k, c, v)
    return saida


def _alvos(nome: str, a: Acao, args: dict) -> dict:
    ident, ids = args.get("id"), args.get("ids")
    if a.alvo is None:
        if ident or ids:
            raise ValueError(f"A ação {nome} não leva `id` — só os campos.")
        return {}
    if a.lote and ids is not None:
        if ident:
            raise ValueError("Mande `id` ou `ids`, não os dois.")
        if not isinstance(ids, list) or not 1 <= len(ids) <= TETO_LOTE:
            raise ValueError(f"`ids` é uma lista de 1 a {TETO_LOTE} ids.")
        lista = [_id(i, "ids") for i in ids]
        if len(set(lista)) != len(lista):
            raise ValueError("`ids` tem id repetido.")
        return {"ids": lista}
    if ids is not None:
        raise ValueError(f"A ação {nome} é de um item por vez: mande `id`.")
    if not ident:
        raise ValueError(f"A ação {nome} precisa de `id`: {a.alvo}.")
    return {"ids": [_id(ident, "id")]} if a.lote else {"id": _id(ident, "id")}


def validar(nome: str, args: dict, agora: datetime | None = None) -> dict:
    """`args` = {acao, id?, ids?, campos?} vindo do agente. Devolve o PEDIDO
    normalizado ({acao, id|ids, campos}) — o que vai no payload do cartão.
    Recusa = `ValueError` com a mensagem para a pessoa."""
    if nome not in ACOES:
        raise ValueError(f"Ação desconhecida: {nome!r}. Veja talenths_acoes.")
    a = ACOES[nome]
    pedido = {"acao": nome, **_alvos(nome, a, args)}
    campos = _campos("campos", a.campos, args.get("campos"))
    agora = agora or agora_brasilia()

    if nome == "pedir_ausencia":
        parcial = "start_time" in campos or "end_time" in campos
        if parcial:
            if not ("start_time" in campos and "end_time" in campos):
                raise ValueError("Ausência de parte do dia leva os dois horários: start_time e end_time.")
            if time.fromisoformat(campos["end_time"]) <= time.fromisoformat(campos["start_time"]):
                raise ValueError("O horário de fim tem que ser depois do de início.")
            if campos.get("end_date", campos["start_date"]) != campos["start_date"]:
                raise ValueError("Ausência de parte do dia é num dia só: tire o end_date ou use o mesmo dia.")
            campos.pop("end_date", None)
        else:
            campos.setdefault("end_date", campos["start_date"])
            if campos["end_date"] < campos["start_date"]:
                raise ValueError("A data de fim tem que ser igual ou depois da de início.")
    elif nome in ("ajustar_ponto", "lancar_batida"):
        k = "requested_punched_at" if nome == "ajustar_ponto" else "punched_at"
        if datetime.fromisoformat(campos[k]) > agora:
            raise ValueError("O horário não pode estar no futuro.")
    elif nome in ("criar_evento", "editar_evento"):
        if "start_date" in campos and campos.get("end_date", campos["start_date"]) < campos["start_date"]:
            raise ValueError("A data de fim tem que ser igual ou depois da de início.")
    elif nome == "pedir_feedback":
        precisa = {"todos": None, "departamento": "department_id", "pessoa": "user_id"}[campos["alvo"]]
        for k in ("department_id", "user_id"):
            if k == precisa and k not in campos:
                raise ValueError(f"Com alvo={campos['alvo']}, mande `{k}`.")
            if k != precisa and k in campos:
                raise ValueError(f"Com alvo={campos['alvo']}, não mande `{k}`.")
    elif nome == "registrar_curso":
        if "completed_at" in campos and campos["completed_at"] > agora.date().isoformat():
            raise ValueError("A conclusão do curso não pode estar no futuro.")

    if nome in ("editar_comunicado", "editar_evento", "editar_pdi", "atualizar_acao_pdi") and not campos:
        raise ValueError("Diga o que mudar: nenhum campo veio.")
    pedido["campos"] = campos
    return pedido


# ── rota e corpo ─────────────────────────────────────────────────────────────

def rota(nome: str, ident: str | None, campos: dict) -> str:
    """O caminho SEMPRE sai do template do catálogo; o que entra nele já foi
    validado (uuid ou mês inteiro)."""
    a = ACOES[nome]
    c = a.rota
    if "{id}" in c:
        c = c.replace("{id}", _id(ident, "id"))
    if "{user_id}" in c:
        c = c.replace("{user_id}", _id(campos.get("user_id"), "user_id"))
    if "{mes}" in c:
        mes = campos.get("mes")
        if isinstance(mes, bool) or not isinstance(mes, int) or not 1 <= mes <= 12:
            raise ValueError("`mes` é de 1 a 12.")
        c = c.replace("{mes}", str(mes))
    return c


def _pegar(campos: dict, chaves) -> dict:
    return {k: campos[k] for k in chaves if k in campos}


def corpo_do_plano(campos: dict) -> dict:
    """⚠️ O plano vai SEM `actions`: lá, `due_date` de ação no POST do plano vai
    crua ao asyncpg e dá 500. As ações entram uma a uma depois."""
    return _pegar(campos, ("user_id", "title", "description", "eval_cycle_id"))


def corpo_da_acao_pdi(a: dict) -> dict:
    return _pegar(a, ("title", "description", "how", "due_date"))


def corpo(nome: str, campos: dict, atual: dict | None = None):
    """O corpo que vai ao TalentHS. `atual` é o estado RELIDO (comunicado, PDI,
    realizado da meta) — nas substituições totais de lá, o que não foi pedido
    tem que ir com o valor de agora, senão é apagado. `None` = sem corpo."""
    atual = atual or {}
    if nome == "pedir_ausencia":
        return _pegar(campos, ("type_id", "start_date", "end_date", "start_time", "end_time", "reason"))
    if nome == "ajustar_ponto":
        return _pegar(campos, ("requested_punched_at", "reason"))
    if nome == "lancar_batida":
        return _pegar(campos, ("kind", "punched_at", "reason"))
    if nome == "responder_feedback":
        return {"rating": campos["rating"], "comment": campos.get("comment")}
    if nome in ("aprovar_ausencia", "recusar_ausencia", "recusar_ajuste_ponto"):
        # O handler de ausência exige um corpo (`body: dict`): `{}` no mínimo.
        return _pegar(campos, ("note",))
    if nome == "criar_comunicado":
        return {"title": campos["title"], "content": campos["content"],
                "category": campos.get("category", "Geral"),
                "status": "published" if campos.get("publicar") else "draft"}
    if nome == "editar_comunicado":
        # ⚠️ Substituição TOTAL lá: sem `status` o comunicado volta a rascunho.
        status = atual.get("status") or "draft"
        if "publicar" in campos:
            status = "published" if campos["publicar"] else "draft"
        return {"title": campos.get("title", atual.get("title")),
                "content": campos.get("content", atual.get("content")),
                "category": campos.get("category", atual.get("category") or "Geral"),
                "status": status}
    if nome == "criar_evento":
        return {"title": campos["title"], "start_date": campos["start_date"],
                "end_date": campos.get("end_date", campos["start_date"]),
                "event_type": campos.get("event_type", "event"),
                "description": campos.get("description"), "all_day": campos.get("all_day", True)}
    if nome == "editar_evento":
        # Lá é COALESCE campo a campo: só o que mudou vai.
        return _pegar(campos, ("title", "start_date", "end_date", "event_type", "description", "all_day"))
    if nome == "pedir_feedback":
        alvo = {"todos": "all", "departamento": "department", "pessoa": "individual"}[campos["alvo"]]
        return {"title": campos["title"], "question": campos["question"], "target_type": alvo,
                "target_department_id": campos.get("department_id"), "target_user_id": campos.get("user_id")}
    if nome == "criar_pdi":
        return corpo_do_plano(campos)
    if nome == "editar_pdi":
        # ⚠️ Substituição TOTAL lá: título ausente vira NULL e status ausente REABRE.
        status = atual.get("status") or "active"
        if "fechar" in campos:
            status = "closed" if campos["fechar"] else "active"
        return {"title": campos.get("title", atual.get("title")),
                "description": campos.get("description", atual.get("description")), "status": status}
    if nome == "acrescentar_acao_pdi":
        return corpo_da_acao_pdi(campos)
    if nome == "atualizar_acao_pdi":
        return _pegar(campos, ("title", "description", "how", "due_date", "status"))
    if nome == "lancar_realizado_meta":
        # ⚠️ `comment` omitido lá APAGA o comentário do mês: vai o que está lá.
        return {"actual_value": campos["actual_value"],
                "comment": campos["comment"] if "comment" in campos else atual.get("comment")}
    if nome == "registrar_curso":
        return _pegar(campos, ("course_title", "area", "catalog_id", "hours", "completed_at"))
    if nome == "atribuir_onboarding":
        return _pegar(campos, ("user_id", "template_id", "started_at"))
    # cancelar_ausencia, inscrever/sair do workshop, concluir tarefa, aprovar
    # ajuste, confirmar/recusar batida e comentar meta (multipart) não levam JSON.
    return None


def texto_do_catalogo(so: str = "") -> str:
    linhas = []
    for nome, a in ACOES.items():
        if so and nome != so:
            continue
        quem = "só o RH" if a.grupo == "RH" else "qualquer um, para si"
        alvo = ""
        if a.alvo:
            alvo = f" · pede `id`: {a.alvo}" + (f" (ou `ids`, até {TETO_LOTE})" if a.lote else "")
        linhas.append(f"- {nome} ({quem}): {a.desc}{alvo}")
        if a.campos:
            partes = []
            for k, c in a.campos.items():
                extra = c.desc or (", ".join(c.opcoes) if c.opcoes else "")
                partes.append(k + ("*" if c.obrigatorio else "") + (f" ({extra})" if extra else ""))
            linhas.append("    campos: " + "; ".join(partes))
    return ("\n".join(linhas) + "\n(* = obrigatório)") if linhas else "Ação desconhecida."
