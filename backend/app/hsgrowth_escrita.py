"""O que o Guardi pode ESCREVER no HSGrowth — regras puras (12/11/2026).

Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`.
Tudo aqui é puro (sem rede, sem banco) e levanta `ValueError` com mensagem
escrita para o vendedor: valida o que o agente mandou e confere o que foi LIDO
do HSGrowth, para o cartão nunca prometer o que lá vai ser recusado — ou,
pior, o que lá seria aceito sem que devesse (reatribuir, ganhar, mexer em
frete). O `PUT /cards/{id}` é uma allowlist: dono, SDR, status, frete,
pagamento e cliente nunca saem daqui.

Testado em `tests/test_guardi_hsgrowth_escrita.py`.
"""
from __future__ import annotations

import math
import re
from datetime import datetime
from zoneinfo import ZoneInfo

from app.bots_pessoais import _linha

__all__ = ["CAMPOS_CARD", "CAMPOS_CLIENTE", "CAMPOS_CONTATO", "MODALIDADES", "TIPOS_TAREFA",
           "PRIORIDADES", "TETO_TAREFAS", "DURACAO_MIN", "DURACAO_MAX", "DEAL_TYPES", "ACQUISITION_CHANNELS",
           "ACQUISITION_CHANNEL_DETAILS", "SECTORS", "EMPLOYEE_COUNTS", "RELATIONSHIP_TYPES",
           "COMMERCIAL_ACTIVITIES", "PERSON_AREAS",
           "campos_do_card", "campos_personalizados", "nota", "tarefas", "utc_de_brasilia",
           "conferir_dono", "conferir_movimento", "conferir_ganho", "motivo_da_perda",
           "conferir_noshow", "cliente_alteravel", "campos_do_cliente", "campos_do_contato",
           "digitos", "uma_linha"]

CAMPOS_CARD = ("title", "description", "value", "due_date", "deal_type", "modality",
               "acquisition_channel", "acquisition_channel_detail", "has_implementation",
               "has_personnel")
CAMPOS_CLIENTE = ("name", "document", "sector", "relationship_type", "employee_count",
                  "commercial_activity")
CAMPOS_CONTATO = ("name", "email", "phone", "position", "area")

MODALIDADES = ("venda", "locacao")
TIPOS_TAREFA = ("call", "meeting", "task", "follow_up", "deadline", "email", "lunch", "other")
PRIORIDADES = ("normal", "high", "urgent")
TETO_TAREFAS = 5
_TETO_NOTA = 5000
_TETO_MOTIVO = 200
_TETO_EXIBIR = 80
_BRT = ZoneInfo("America/Sao_Paulo")

# ⚠️ Listas copiadas do FRONT do HSGrowth, não do banco (que guarda grafias
# velhas como "Ate 50"): ~/github/hsgrowth-sistema/frontend/src/constants/blueprintOptions.ts
# (conferido em 12/11/2026). Mudou lá, muda aqui.
RELATIONSHIP_TYPES = ("Cliente", "Fornecedor", "Lead", "Parceiro", "Prospect", "Revendedor")
COMMERCIAL_ACTIVITIES = ("Ativo", "Dormente", "Inativo")
SECTORS = (
    "Indústria (manufatura em geral)", "Indústrias de Transformação", "Alimentos e Bebidas",
    "Frigoríficos", "Agroindústria / Agronegócio", "Processadoras de Grãos",
    "Usinas de Açúcar / Etanol", "Componentes Automotivos", "Logística e Transporte",
    "Construção Civil", "Mineração", "Óleo e Gás / Energia", "Química / Petroquímica",
    "Papel e Celulose", "Metalurgia / Siderurgia", "Portos e Terminais",
    "Saneamento / Utilidades Públicas", "Serviços Industriais / Facilities",
    "Cooperativas / Associações Produtivas", "Outros",
)
EMPLOYEE_COUNTS = ("Até 50 colaboradores", "51-100 colaboradores", "101-300 colaboradores",
                   "301-600 colaboradores", "601-1.000 colaboradores",
                   "Acima de 1.000 colaboradores")
DEAL_TYPES = ("Nova Venda", "Cross Sell", "Up Sell")
ACQUISITION_CHANNELS = ("Inbound", "Outbound", "Indicação", "Parcerias", "Eventos", "Base")
ACQUISITION_CHANNEL_DETAILS: dict[str, tuple[str, ...]] = {
    "Inbound": ("Inbound - Conteúdo", "Inbound - Tráfego pago", "Inbound - SEO",
                "Inbound - Email marketing", "Inbound - Levantada de mão"),
    "Outbound": ("Outbound - Lista fria", "Outbound - LinkedIn", "Outbound - Cold email",
                 "Outbound - Cold call"),
    "Indicação": ("Indicação - Cliente", "Indicação - Ex-cliente",
                  "Indicação - Networking pessoal"),
    "Parcerias": ("Parcerias - Consultorias", "Parcerias - Integradores",
                  "Parcerias - Representantes", "Parcerias - Outras empresas"),
    "Eventos": ("Eventos - Feira", "Eventos - Workshop próprio", "Eventos - Palestra",
                "Eventos - Meetup"),
    "Base": ("Base - Resgate", "Base - Levantada de mão", "Base - e-mail marketing",
             "Base - Disparo whats"),
}
PERSON_AREAS = ("Operações", "Segurança do Trabalho / HSE / SST", "Manutenção",
                "Recursos Humanos (RH)", "Financeiro", "Compras / Suprimentos",
                "Diretoria / Sócios", "Tecnologia da Informação (TI)")


# --- utilidades ------------------------------------------------------------------

def uma_linha(s, teto: int = _TETO_EXIBIR) -> str:
    """Texto vindo do HSGrowth (nome, título, motivo) para o cartão: uma linha,
    cortada em `teto` — quebra de linha ali viraria instrução no prompt."""
    return _linha(str(s or ""), teto)


def digitos(doc) -> str:
    return re.sub(r"\D", "", str(doc or ""))


def _opcao(valor, opcoes, campo: str) -> str:
    if not isinstance(valor, str) or valor not in opcoes:
        raise ValueError(f"`{campo}` não aceita {uma_linha(valor)!r}. Opções: "
                         + "; ".join(opcoes) + ".")
    return valor


def _texto(valor, campo: str, maximo: int, minimo: int = 1) -> str:
    if not isinstance(valor, str):
        raise ValueError(f"`{campo}` tem que ser texto.")
    t = valor.strip()
    if not (minimo <= len(t) <= maximo):
        raise ValueError(f"`{campo}` tem que ter de {minimo} a {maximo} caracteres.")
    return t


def _inteiro(valor, campo: str) -> int:
    if isinstance(valor, bool) or not isinstance(valor, int) or valor <= 0:
        raise ValueError(f"`{campo}` tem que ser um número (o id no HSGrowth).")
    return valor


def utc_de_brasilia(s: str) -> str:
    """`"2026-11-19T10:00"` (Brasília) → `"2026-11-19T13:00:00Z"`. Formato estrito:
    um horário ambíguo gravado em UTC erraria a reunião em 3 horas."""
    if not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s.strip()):
        raise ValueError("Data e hora no formato AAAA-MM-DDTHH:MM, horário de Brasília "
                         "(ex.: 2026-11-19T10:00).")
    try:
        naive = datetime.strptime(s.strip(), "%Y-%m-%dT%H:%M")
    except ValueError:
        raise ValueError(f"`{s}` não é uma data e hora válida.") from None
    utc = naive.replace(tzinfo=_BRT).astimezone(ZoneInfo("UTC"))
    return utc.strftime("%Y-%m-%dT%H:%M:%SZ")


# --- card ------------------------------------------------------------------------

def campos_do_card(d: dict) -> dict:
    """Só `CAMPOS_CARD`, tipos conferidos. Chave fora da lista é recusada
    nomeando-a: dono, SDR, status, frete e pagamento nunca saem pelo PUT."""
    if not isinstance(d, dict) or not d:
        raise ValueError("Diga o que alterar no card.")
    fora = [k for k in d if k not in CAMPOS_CARD]
    if fora:
        raise ValueError(f"Não altero {', '.join(f'`{k}`' for k in fora)} por aqui. "
                         f"Campos permitidos: {', '.join(CAMPOS_CARD)}.")
    out: dict = {}
    for k, v in d.items():
        if k == "title":
            out[k] = _texto(v, k, 500)
        elif k == "description":
            out[k] = _texto(v, k, 10000, 0)
        elif k == "value":
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
                raise ValueError("`value` tem que ser um número maior ou igual a zero.")
            out[k] = v
        elif k == "due_date":
            out[k] = utc_de_brasilia(v)
        elif k == "deal_type":
            out[k] = _opcao(v, DEAL_TYPES, k)
        elif k == "modality":
            out[k] = _opcao(v, MODALIDADES, k)
        elif k == "acquisition_channel":
            out[k] = _opcao(v, ACQUISITION_CHANNELS, k)
        elif k == "acquisition_channel_detail":
            canal = d.get("acquisition_channel")
            todas = tuple(x for ds in ACQUISITION_CHANNEL_DETAILS.values() for x in ds)
            out[k] = _opcao(v, ACQUISITION_CHANNEL_DETAILS.get(canal, todas), k)
        else:  # has_implementation / has_personnel
            if not isinstance(v, bool):
                raise ValueError(f"`{k}` tem que ser verdadeiro ou falso.")
            out[k] = v
    return out


def campos_personalizados(itens: list, definicoes: list[dict]) -> list[dict]:
    """`[{"field_definition_id": 3, "value": ...}]`. O campo vem da definição do
    quadro (`/fields/definitions/board/{id}`): id inexistente é recusado listando
    os nomes disponíveis. Aceita `campo` (o nome) no lugar do id."""
    if not isinstance(itens, list) or not itens:
        raise ValueError("Diga quais campos personalizados alterar.")
    por_id = {d.get("id"): d for d in definicoes if isinstance(d, dict)}
    por_nome = {str(d.get("name", "")).strip().lower(): d for d in por_id.values()}
    disponiveis = ", ".join(f"{uma_linha(d.get('name'))} (id {i})" for i, d in por_id.items()) \
        or "nenhum neste quadro"
    out = []
    for it in itens:
        if not isinstance(it, dict) or "value" not in it:
            raise ValueError("Cada campo personalizado leva `field_definition_id` e `value`.")
        if "field_definition_id" in it:
            fid = _inteiro(it["field_definition_id"], "field_definition_id")
            if fid not in por_id:
                raise ValueError(f"Campo personalizado {uma_linha(fid)} não existe neste "
                                 f"quadro. Disponíveis: {disponiveis}.")
        else:
            nome = str(it.get("campo", "")).strip().lower()
            if nome not in por_nome:
                raise ValueError(f"Campo personalizado {uma_linha(it.get('campo'))!r} não "
                                 f"existe neste quadro. Disponíveis: {disponiveis}.")
            fid = por_nome[nome]["id"]
        out.append({"field_definition_id": fid, "value": it["value"]})
    return out


def nota(texto) -> str:
    return _texto(texto, "nota", _TETO_NOTA)


# --- tarefas ---------------------------------------------------------------------

# ⚠️ Sem `task_type`: trocar reunião → ligação e depois concluir furaria a regra
# da reunião (concluir reunião paga comissão ao SDR). Tipo errado: nova tarefa.
_CAMPOS_ALTERAR = ("title", "description", "priority", "due_date", "duration_minutes")
DURACAO_MIN, DURACAO_MAX = 5, 480


def _campos_tarefa(op: dict, obrigatorios: bool) -> dict:
    out: dict = {}
    if obrigatorios or "title" in op:
        out["title"] = _texto(op.get("title"), "title", 500)
    if obrigatorios or "task_type" in op:
        out["task_type"] = _opcao(op.get("task_type"), TIPOS_TAREFA, "task_type")
    if "priority" in op:
        out["priority"] = _opcao(op["priority"], PRIORIDADES, "priority")
    elif obrigatorios:
        out["priority"] = "normal"
    if "description" in op:
        out["description"] = _texto(op["description"], "description", 5000, 0)
    if op.get("due_date") is not None:
        out["due_date"] = utc_de_brasilia(op["due_date"])
    if op.get("duration_minutes") is not None:
        d = op["duration_minutes"]
        if isinstance(d, bool) or not isinstance(d, int) or not DURACAO_MIN <= d <= DURACAO_MAX:
            raise ValueError(f"`duration_minutes` tem que ser um número inteiro de minutos, de "
                             f"{DURACAO_MIN} a {DURACAO_MAX}.")
        out["duration_minutes"] = d
    return out


def tarefas(ops: list, tipos_das_tarefas: dict[int, str] | None = None) -> list[dict]:
    """Até 5 operações. `concluir` exige `valida` (bool): o `is_valid` do HSGrowth
    — realizada ou só uma tentativa sem resultado — vale pontos de gamificação e
    nunca é presumido. Reunião com `valida: false` é recusada: reunião que não
    aconteceu é no-show, e concluí-la apagaria o sinal (e pagaria o SDR).
    `tipos_das_tarefas` (id → task_type, das tarefas PENDENTES do card, lidas do
    `/expanded`) é obrigatório para alterar ou concluir: a regra vale AQUI, na
    preparação do cartão — o executor só repassa o que foi gravado."""
    if not isinstance(ops, list) or not ops:
        raise ValueError("Diga quais tarefas criar, alterar ou concluir.")
    if len(ops) > TETO_TAREFAS:
        raise ValueError(f"No máximo {TETO_TAREFAS} tarefas por cartão.")
    if tipos_das_tarefas is None and any(
            isinstance(o, dict) and o.get("op") in ("concluir", "alterar") for o in ops):
        raise ValueError("Para alterar ou concluir tarefa é preciso conferir as tarefas "
                         "do card (`tipos_das_tarefas`).")
    out = []
    for op in ops:
        if not isinstance(op, dict):
            raise ValueError("Cada tarefa é um objeto com `op`.")
        tipo = op.get("op")
        if tipo == "criar":
            out.append({"op": "criar", **_campos_tarefa(op, True)})
        elif tipo == "alterar":
            tid = _inteiro(op.get("task_id"), "task_id")
            if tid not in tipos_das_tarefas:
                raise ValueError(f"A tarefa {tid} não é deste card.")
            if "task_type" in op:
                raise ValueError(f"Tarefa {tid}: o tipo de uma tarefa não muda por aqui — se o tipo "
                                 "está errado, crie uma tarefa nova do tipo certo.")
            campos = _campos_tarefa(op, False)
            if not campos:
                raise ValueError(f"Tarefa {tid}: diga o que alterar "
                                 f"({', '.join(_CAMPOS_ALTERAR)}).")
            out.append({"op": "alterar", "task_id": tid, **campos})
        elif tipo == "concluir":
            tid = _inteiro(op.get("task_id"), "task_id")
            if tid not in tipos_das_tarefas:
                raise ValueError(f"A tarefa {tid} não é deste card.")
            valida = op.get("valida")
            if not isinstance(valida, bool):
                raise ValueError(f"Tarefa {tid}: diga se ela foi realizada (`valida: true`) ou "
                                 "foi só uma tentativa sem resultado (`valida: false`) — "
                                 "pergunte ao seu dono, não presuma.")
            conferir_conclusao(tipos_das_tarefas[tid], valida)
            out.append({"op": "concluir", "task_id": tid, "valida": valida})
        else:
            raise ValueError("`op` tem que ser criar, alterar ou concluir.")
    return out


def conferir_conclusao(task_type: str | None, realizada: bool) -> None:
    if task_type == "meeting" and not realizada:
        raise ValueError("Reunião que não aconteceu é no-show (`hsgrowth_noshow`), não "
                         "conclusão; se aconteceu, concluo com `valida: true`.")


# --- dono, movimento, ganho, perda, no-show ---------------------------------------

def conferir_dono(card: dict, eu_id: int) -> None:
    """Escrita só em card do próprio vendedor (dono ou SDR), em qualquer função —
    inclusive administrador."""
    if eu_id in (card.get("assigned_to_id"), card.get("sdr_id")) and eu_id is not None:
        return
    quem = card.get("assigned_to_name") or (
        f"o usuário {card['assigned_to_id']}" if card.get("assigned_to_id") else None)
    if quem:
        raise ValueError(f"Este card é de {uma_linha(quem)}, não seu. Só mexo em card "
                         "em que você é o responsável ou o SDR.")
    raise ValueError("Este card não tem responsável; só mexo em card em que você é o "
                     "responsável ou o SDR.")


def conferir_movimento(card: dict, etapas: list[dict], para_list_id: int) -> str | None:
    """Devolve um aviso ou `None`; recusa levantando `ValueError`. `etapas` são as
    listas (`id`, `board_id`, `name`, `position`, `is_done_stage`, `is_lost_stage`)."""
    por_id = {e["id"]: e for e in etapas}
    destino = por_id.get(para_list_id)
    board = card.get("board_id")
    if destino is None or destino.get("board_id") != board:
        raise ValueError("Essa etapa não é do quadro do card.")
    origem = por_id.get(card.get("list_id"))
    if para_list_id == card.get("list_id"):
        raise ValueError("O card já está nessa etapa.")
    terminal = lambda e: bool(e and (e.get("is_done_stage") or e.get("is_lost_stage")))
    if terminal(destino) or terminal(origem):
        raise ValueError("Ganho e perda não são movimento de etapa: use "
                         "`hsgrowth_ganhar` / `hsgrowth_perder`.")
    if board == 7:
        fila = sorted((e for e in etapas if e.get("board_id") == 7 and not terminal(e)),
                      key=lambda e: e.get("position", 0))
        ids = [e["id"] for e in fila]
        if card.get("list_id") not in ids:
            raise ValueError("Não achei a etapa atual do card no quadro; não movo às cegas.")
        if abs(ids.index(para_list_id) - ids.index(card["list_id"])) > 1:
            raise ValueError("Na Aquisição o card anda uma etapa por vez.")
    if board == 6 and str(destino.get("name", "")).strip().lower() == "agendado":
        return ("o HSGrowth leva o card para Reunião Agendada, na Aquisição, ao "
                "chegar em Agendado.")
    return None


def conferir_ganho(card: dict) -> None:
    if card.get("is_won") or card.get("is_lost"):
        raise ValueError("Este card já está encerrado (ganho ou perdido).")
    if card.get("modality") not in MODALIDADES:
        raise ValueError("Falta dizer se é venda ou locação.")


def motivo_da_perda(s) -> str:
    return _texto(s, "motivo", _TETO_MOTIVO)


def conferir_noshow(tarefa: dict, card: dict) -> None:
    if tarefa.get("task_type") != "meeting":
        raise ValueError("No-show é só para reunião.")
    if tarefa.get("is_completed"):
        raise ValueError("Essa reunião já foi concluída.")
    if tarefa.get("card_id") != card.get("id"):
        raise ValueError("Essa reunião não é deste card.")


# --- cliente e contato -----------------------------------------------------------

def cliente_alteravel(cliente_id: int, cards_abertos_do_dono: list[dict]) -> None:
    """Cliente é compartilhado entre vendedores: só se mexe nele quando ligado a
    um card ABERTO do próprio dono."""
    for c in cards_abertos_do_dono:
        if c.get("client_id") == cliente_id and not (c.get("is_won") or c.get("is_lost")):
            return
    raise ValueError("Só altero cliente ligado a um card aberto seu.")


def campos_do_cliente(d: dict, atual: dict | None = None) -> dict:
    """`atual` (o cliente lido) permite recusar tirar alguém de "Cliente"."""
    if not isinstance(d, dict) or not d:
        raise ValueError("Diga o que alterar no cliente.")
    if "relationship_type" in d and atual is None:
        raise ValueError("Para mudar `relationship_type` é preciso o cliente atual (`atual`).")
    fora = [k for k in d if k not in CAMPOS_CLIENTE]
    if fora:
        raise ValueError(f"Não altero {', '.join(f'`{k}`' for k in fora)} no cliente. "
                         f"Permitidos: {', '.join(CAMPOS_CLIENTE)}.")
    out: dict = {}
    for k, v in d.items():
        if k == "name":
            out[k] = _texto(v, k, 255)
        elif k == "document":
            n = digitos(v)
            if len(n) not in (11, 14):
                raise ValueError("`document` tem que ser CPF (11 dígitos) ou CNPJ (14).")
            out[k] = n
        elif k == "sector":
            out[k] = _opcao(v, SECTORS, k)
        elif k == "employee_count":
            out[k] = _opcao(v, EMPLOYEE_COUNTS, k)
        elif k == "commercial_activity":
            out[k] = _opcao(v, COMMERCIAL_ACTIVITIES, k)
        else:  # relationship_type
            _opcao(v, RELATIONSHIP_TYPES, k)
            if (atual or {}).get("relationship_type") == "Cliente" and v != "Cliente":
                raise ValueError("Quem já é Cliente não deixa de ser por aqui.")
            out[k] = v
    return out


def campos_do_contato(d: dict) -> dict:
    if not isinstance(d, dict) or not d:
        raise ValueError("Diga o que alterar no contato.")
    fora = [k for k in d if k not in CAMPOS_CONTATO]
    if fora:
        raise ValueError(f"Não altero {', '.join(f'`{k}`' for k in fora)} no contato. "
                         f"Permitidos: {', '.join(CAMPOS_CONTATO)}.")
    out: dict = {}
    for k, v in d.items():
        if k == "email":
            t = _texto(v, k, 255)
            if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", t):
                raise ValueError("`email` não parece um e-mail.")
            out[k] = t
        elif k == "area":
            out[k] = _opcao(v, PERSON_AREAS, k)
        else:
            out[k] = _texto(v, k, 255)
    return out
