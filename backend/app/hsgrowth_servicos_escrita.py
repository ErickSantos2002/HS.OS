"""O que o Guardi pode ESCREVER no HSGrowth — Serviços e Cobrança (12/11/2026).

Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`.
Regras puras (sem rede, sem banco), `ValueError` com mensagem para o vendedor.
Falham FECHADO: faltou contexto lido do HSGrowth (etapas, card, itens) =
recusa, nunca "deixa passar". Espelham o `_validate_advance` do backend de lá
(`service_board_service.py`) e, no Ganho, a regra mais ESTRITA do front
(`handleWin` em `ServiceCardDetails.tsx`) — o servidor de lá deixaria ganhar
em mais casos do que a tela deixa.

Testado em `tests/test_guardi_hsgrowth_servicos_escrita.py`.
"""
from __future__ import annotations

import math

from app.hsgrowth_escrita import (_inteiro, _opcao, _texto, digitos, uma_linha,
                                  utc_de_brasilia)

__all__ = ["QUADROS", "CHAVES_NEGOCIO", "CAMPOS_PUT", "TIPOS_ATIVIDADE", "PRIORIDADES",
           "TETO_ATIVIDADES", "MOTIVOS_PERDA", "negocio", "campos_do_card", "atividades",
           "conferir_movimento", "conferir_ganho", "motivo_da_perda", "item",
           "mesmo_cliente", "terminal"]

QUADROS = (1, 2)  # 1 = Serviços, 2 = Serviço - Cobrança

# ⚠️ Opções copiadas da TELA do HSGrowth (conferido em 12/11/2026):
# ~/github/hsgrowth-sistema/frontend/src/pages/ServiceCardDetails.tsx:300-395.
# Mudou lá, muda aqui.
_SIM_NAO = ("sim", "nao")
CHAVES_NEGOCIO: dict[str, tuple[str, ...] | None] = {
    "collection_type": ("a_vencer", "atrasados"),          # só quadro 2
    "service_type": ("recalibracao", "manutencao", "ambos"),
    "acquisition_channel": ("Importação (GestorHs)",       # só quadro 2
                            "Solicitação do Cliente (Inbound)"),
    "form_answered": None,                                 # bool
    "closing_type": ("faturamento_direto", "pedido"),      # só quadro 1
    "proposal_number": None,                               # inteiro > 0, só quadro 1
    "order_number": None,                                  # só quadro 1
    "from_collection": _SIM_NAO,                           # só quadro 1
    "shipping_confirmed": _SIM_NAO,                        # só quadro 2
}
_SO_QUADRO = {"collection_type": 2, "acquisition_channel": 2, "shipping_confirmed": 2,
              "closing_type": 1, "proposal_number": 1, "order_number": 1,
              "from_collection": 1}

CAMPOS_PUT = ("title", "description", "due_date", "client_id", "person_id")

# Tipos do seletor da aba Atividade (`ServiceActivityTab.tsx:48-56`).
TIPOS_ATIVIDADE = ("call", "task", "follow_up", "email", "whatsapp", "linkedin", "other")
PRIORIDADES = ("normal", "high", "urgent")
TETO_ATIVIDADES = 5

# `SERVICE_LOSS_REASONS` de `frontend/src/constants/blueprintOptions.ts:194-205`.
# Ficam de fora o descarte administrativo e "Unificado em outro card" (do sistema).
MOTIVOS_PERDA = (
    "Não chegamos no responsável pelo tema", "Proposta fora do orçamento",
    "Manutenção não aprovada", "Sem budget aprovado", "Solução não percebida como crítica",
    "Aprovação interna travada", "Perda para concorrência", "Lead não deu mais retorno",
    "Data de Recalibração Errada", "Cliente Inadimplente", "Cliente em standby",
    "Sem Conserto",
)


def _quadro(board_id) -> int:
    if board_id not in QUADROS:
        raise ValueError("Só mexo nos quadros Serviços (1) e Serviço - Cobrança (2).")
    return board_id


# --- business_info -----------------------------------------------------------------

def negocio(d: dict, board_id: int) -> dict:
    """Só as chaves conhecidas, com valor da lista da tela. `board_id` é obrigatório: recusa a
    chave que a tela não mostra naquele quadro (ex.: `shipping_confirmed` em Serviços).
    Não há limpar-campo: valor vazio é recusado."""
    _quadro(board_id)
    if not isinstance(d, dict) or not d:
        raise ValueError("Diga o que preencher no Resumo do card.")
    desconhecidas = [k for k in d if k not in CHAVES_NEGOCIO]
    if desconhecidas:
        raise ValueError("Campo(s) do Resumo que não altero: " + ", ".join(
            uma_linha(k) for k in desconhecidas) + ". Aceito: "
            + ", ".join(CHAVES_NEGOCIO) + ".")
    out: dict = {}
    for k, v in d.items():
        if k in _SO_QUADRO and _SO_QUADRO[k] != board_id:
            raise ValueError(f"`{k}` não existe no Resumo deste quadro.")
        if k == "form_answered":
            if not isinstance(v, bool):
                raise ValueError("`form_answered` tem que ser true ou false.")
            out[k] = v
        elif k == "proposal_number":
            out[k] = _inteiro(v, k)
        elif k == "order_number":
            out[k] = _inteiro(v, k)
        else:
            out[k] = _opcao(v, CHAVES_NEGOCIO[k], k)
    return out


# --- campos do card (PUT) ----------------------------------------------------------

def campos_do_card(d: dict) -> dict:
    """Allowlist do `PUT`: `list_id`, `position`, `is_deleted`, `assigned_to_id`
    nunca saem daqui (mover é `PUT …/move`; apagar e reatribuir não são nossos)."""
    if not isinstance(d, dict) or not d:
        raise ValueError("Diga o que alterar no card.")
    fora = [k for k in d if k not in CAMPOS_PUT]
    if fora:
        raise ValueError("Não altero " + ", ".join(uma_linha(k) for k in fora)
                         + " por aqui. Aceito: " + ", ".join(CAMPOS_PUT) + ".")
    out: dict = {}
    for k, v in d.items():
        if k == "title":
            out[k] = _texto(v, k, 500)
        elif k == "description":
            out[k] = _texto(v, k, 5000, 0)
        elif k == "due_date":
            out[k] = utc_de_brasilia(v)
        else:  # client_id, person_id
            out[k] = _inteiro(v, k)
    return out


# --- atividades --------------------------------------------------------------------

def atividades(ops: list, pendentes: dict[int, dict] | None) -> list[dict]:
    """Até 5. `concluir` exige `valida` (bool; vira `is_valid`) e uma atividade
    PENDENTE deste card (`pendentes`, lida do HSGrowth) — sem a leitura, recusa."""
    if not isinstance(ops, list) or not ops:
        raise ValueError("Diga quais atividades criar ou concluir.")
    if len(ops) > TETO_ATIVIDADES:
        raise ValueError(f"No máximo {TETO_ATIVIDADES} atividades por cartão.")
    if pendentes is None:
        raise ValueError("Para criar ou concluir atividade é preciso conferir as atividades "
                         "do card (`pendentes`).")
    out = []
    for op in ops:
        if not isinstance(op, dict):
            raise ValueError("Cada atividade é um objeto com `op`.")
        tipo = op.get("op")
        if tipo == "criar":
            cat = _opcao(op.get("category"), ("atividade", "anotacao"), "category")
            if cat == "anotacao":
                if op.get("activity_type") is not None:
                    raise ValueError("Anotação não tem `activity_type`.")
                out.append({"op": "criar", "category": cat,
                            "description": _texto(op.get("description"), "description", 5000)})
                continue
            corpo = {"op": "criar", "category": cat,
                     "activity_type": _opcao(op.get("activity_type"), TIPOS_ATIVIDADE,
                                             "activity_type"),
                     "title": _texto(op.get("title"), "title", 500),
                     "priority": _opcao(op.get("priority", "normal"), PRIORIDADES, "priority")}
            if op.get("description") is not None:
                corpo["description"] = _texto(op["description"], "description", 5000, 0)
            if op.get("due_date") is not None:
                corpo["due_date"] = utc_de_brasilia(op["due_date"])
            out.append(corpo)
        elif tipo == "concluir":
            aid = _inteiro(op.get("activity_id"), "activity_id")
            if aid not in pendentes:
                raise ValueError(f"A atividade {aid} não é uma atividade pendente deste card.")
            valida = op.get("valida")
            if not isinstance(valida, bool):
                raise ValueError(f"Atividade {aid}: diga se teve resultado (`valida: true`) ou "
                                 "foi só uma tentativa (`valida: false`) — pergunte ao seu "
                                 "dono, não presuma.")
            out.append({"op": "concluir", "activity_id": aid, "valida": valida})
        else:
            raise ValueError("`op` tem que ser criar ou concluir.")
    return out


# --- movimento e ganho -------------------------------------------------------------

def terminal(e: dict | None) -> bool:
    """Como no HSGrowth: a flag OU o nome (`"ganho" in nome`, `"perdido" in nome`)."""
    if not e:
        return False
    nome = str(e.get("name") or "").lower()
    return bool(e.get("is_done_stage") or e.get("is_lost_stage")
                or "ganho" in nome or "perdido" in nome)


def _ganha(e: dict) -> bool:
    return bool(e.get("is_done_stage") or "ganho" in str(e.get("name") or "").lower())


def _contexto(card: dict, etapas: list[dict]):
    board = _quadro(card.get("board_id"))
    do_quadro = [e for e in (etapas or []) if e.get("board_id") == board]
    por_id = {e["id"]: e for e in do_quadro}
    origem = por_id.get(card.get("list_id"))
    if origem is None:
        raise ValueError("Não achei a etapa atual do card no quadro; não movo às cegas.")
    ativas = sorted((e for e in do_quadro if not terminal(e)),
                    key=lambda e: e.get("position", 0))
    return board, do_quadro, por_id, origem, ativas


def conferir_movimento(card: dict, etapas: list[dict], para_list_id: int) -> dict:
    """Uma etapa por vez, para frente ou para trás, entre etapas não terminais.
    Devolve `{"de", "para"}` — o executor recusa se o card saiu de `de` até o clique."""
    board, _, por_id, origem, ativas = _contexto(card, etapas)
    destino = por_id.get(para_list_id)
    if destino is None:
        raise ValueError("Essa etapa não é do quadro do card.")
    if para_list_id == origem["id"]:
        raise ValueError("O card já está nessa etapa.")
    if terminal(destino) or terminal(origem):
        raise ValueError("Ganho e perda não são movimento de etapa: use "
                         "`hsgrowth_servicos_ganhar` / `hsgrowth_servicos_perder`.")
    ids = [e["id"] for e in ativas]
    if abs(ids.index(para_list_id) - ids.index(origem["id"])) > 1:
        raise ValueError("Nos Serviços o card anda uma etapa por vez.")
    return {"de": origem["id"], "para": para_list_id}


def conferir_ganho(card: dict, etapas: list[dict], negocio_atual: dict | None) -> dict:
    """Regra do FRONT (`handleWin`), mais estrita que a do servidor. Quadro 1: origem
    Aguardando Pedido (última etapa ativa) com `order_number`, OU Proposta com
    `closing_type = faturamento_direto`; sempre `proposal_number` e `from_collection`.
    Quadro 2: origem Operações (última ativa) e `shipping_confirmed = sim`."""
    board, do_quadro, _, origem, ativas = _contexto(card, etapas)
    biz = negocio_atual or {}
    if terminal(origem):
        raise ValueError("Este card já está encerrado (ganho ou perdido).")
    destino = next((e for e in do_quadro if _ganha(e)), None)
    if destino is None:
        raise ValueError("Não achei a etapa de Negócio Ganho no quadro.")
    ultima = ativas[-1]
    nome = str(origem.get("name") or "").strip().lower()
    faltam = []
    if board == 1:
        pn = biz.get("proposal_number")
        if isinstance(pn, bool) or not isinstance(pn, (int, str)) or not str(pn).strip().isdigit() \
                or int(str(pn).strip()) <= 0:
            faltam.append("Número da proposta preenchido no Resumo")
        if biz.get("from_collection") not in _SIM_NAO:
            faltam.append("`from_collection` (veio de uma Cobrança? sim/nao) — a tela pergunta "
                          "ao dar Ganho")
        if origem["id"] == ultima["id"]:
            on = biz.get("order_number")
            if on is None or not str(on).strip():
                faltam.append("Número do pedido preenchido no Resumo")
        elif nome == "proposta":
            if biz.get("closing_type") != "faturamento_direto":
                faltam.append("Forma de fechamento = Faturamento direto (se for Pedido, "
                              "avance para Aguardando Pedido)")
        else:
            raise ValueError("O Ganho só é liberado em 'Aguardando Pedido' (Pedido) ou em "
                             "'Proposta' com Forma de fechamento = Faturamento direto.")
    else:
        if origem["id"] != ultima["id"]:
            raise ValueError(f"O Ganho só é liberado na etapa \"{ultima.get('name')}\".")
        if biz.get("shipping_confirmed") != "sim":
            faltam.append("Confirmação de envio marcada como 'Sim' no Resumo")
    if faltam:
        raise ValueError("Para marcar como Ganho, falta: " + "; ".join(faltam) + ".")
    return {"de": origem["id"], "para": destino["id"]}


def motivo_da_perda(s) -> str:
    return _opcao(s, MOTIVOS_PERDA, "motivo")


# --- itens do card -----------------------------------------------------------------

def _numero(v, campo: str):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0:
        raise ValueError(f"`{campo}` tem que ser um número maior ou igual a zero.")
    return v


def _quantidade(v) -> int:
    if isinstance(v, bool) or not isinstance(v, int) or v < 1:
        raise ValueError("`quantity` tem que ser um número inteiro de 1 para cima.")
    return v


def item(op: dict, catalogo_ids: dict[str, set[int]],
         itens_do_card: dict[str, dict[int, dict]]) -> dict:
    """`tipo` aparelho (produto) ou servico; `acao` por/alterar/tirar. `por` exige id
    do catálogo, `quantity` e `unit_price` (como o schema de lá); `alterar`/`tirar`
    exigem `item_id` que seja linha deste card DO MESMO tipo (ids de
    produto e serviço se repetem). Catálogo e itens vêm por tipo; tipo ausente = recusa. Devolve o corpo pronto para a rota."""
    if not isinstance(op, dict):
        raise ValueError("O item é um objeto com `tipo` e `acao`.")
    tipo = _opcao(op.get("tipo"), ("aparelho", "servico"), "tipo")
    if not isinstance(catalogo_ids, dict) or not isinstance(itens_do_card, dict) \
            or tipo not in catalogo_ids or tipo not in itens_do_card:
        raise ValueError("Para mexer em item é preciso conferir o catálogo e os itens do card "
                         f"({tipo}).")
    catalogo, no_card = catalogo_ids[tipo], itens_do_card[tipo]
    acao = _opcao(op.get("acao"), ("por", "alterar", "tirar"), "acao")
    chave = "product_id" if tipo == "aparelho" else "service_id"
    if acao == "por":
        cid = _inteiro(op.get(chave), chave)
        if cid not in catalogo:
            raise ValueError(f"{chave} {cid} não está no catálogo; não chuto item.")
        if "quantity" not in op or "unit_price" not in op:
            raise ValueError("Para pôr um item preciso de `quantity` e `unit_price`.")
        corpo = {chave: cid, "quantity": _quantidade(op["quantity"]),
                 "unit_price": _numero(op["unit_price"], "unit_price"),
                 "discount": _numero(op.get("discount", 0), "discount")}
        if op.get("notes") is not None:
            corpo["notes"] = _texto(op["notes"], "notes", 1000, 0)
        return {"tipo": tipo, "acao": acao, "corpo": corpo}
    iid = _inteiro(op.get("item_id"), "item_id")
    if iid not in no_card:
        raise ValueError(f"O item {iid} não é um {tipo} deste card.")
    if acao == "tirar":
        return {"tipo": tipo, "acao": acao, "item_id": iid}
    corpo = {}
    if "quantity" in op:
        corpo["quantity"] = _quantidade(op["quantity"])
    if "unit_price" in op:
        corpo["unit_price"] = _numero(op["unit_price"], "unit_price")
    if "discount" in op:
        corpo["discount"] = _numero(op["discount"], "discount")
    if op.get("notes") is not None:
        corpo["notes"] = _texto(op["notes"], "notes", 1000, 0)
    if not corpo:
        raise ValueError(f"Item {iid}: diga o que alterar (quantity, unit_price, discount, notes).")
    return {"tipo": tipo, "acao": acao, "item_id": iid, "corpo": corpo}


# --- cliente -----------------------------------------------------------------------

def mesmo_cliente(doc_card, doc_proposta) -> bool | None:
    """Documentos pelos dígitos; `None` se faltar um (não dá para afirmar)."""
    a, b = digitos(doc_card), digitos(doc_proposta)
    if not a or not b:
        return None
    return a == b
