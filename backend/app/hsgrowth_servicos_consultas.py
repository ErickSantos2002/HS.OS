"""O que o Guardi pode consultar no HSGrowth — Serviços e Cobrança (12/11/2026, leitura).

Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`. Mesmo
molde de `hsgrowth_consultas.py` (Vendas): **o agente escolhe uma consulta desta
lista, nunca um caminho**, e o link do card é montado aqui.

Diferenças em relação a Vendas:
- O módulo é OUTRA pilha no HSGrowth (`service_*`) e só existem dois quadros:
  **1 (Serviços)** e **2 (Serviço - Cobrança)**. `QUADROS` é a tranca; qualquer
  outro `board_id` é recusado antes da rede.
- Não há dono no card: o kanban é de todo mundo. Os filtros `colaborador=eu` e
  `minhas=true` são conveniência do agente, não permissão.
- O `/cards` do quadro devolve o quadro inteiro, paginado em até 500: os filtros
  `etapa`, `pendencia`, `parado`, `cobranca` e `colaborador` são aplicados AQUI
  (`filtrar_local`), e o router lê no máximo `MAX_PAGINAS` páginas.
- `filtrar_local` FALHA FECHADO: formato inesperado levanta `ValueError`.

Puro, testado em `tests/test_guardi_hsgrowth_servicos.py`.
"""
from __future__ import annotations

import re

from app.datacore_consultas import _escalar, texto_do_retorno

__all__ = ["CONSULTAS", "QUADROS", "PAGINA", "MAX_PAGINAS", "caminho_da_consulta",
           "caminhos_do_card", "params_da_consulta", "filtrar_local", "com_links", "pede_eu",
           "pede_quadro", "quadro_valido", "texto_do_retorno"]

QUADROS = (1, 2)
PAGINA = 500
MAX_PAGINAS = 4

_ID = re.compile(r"^[0-9]{1,10}$")
_MARCADOR = re.compile(r"\{[a-z_]+\}")
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_PENDENCIA = ("overdue", "today", "future", "none")
_PARADO = ("3d", "7d")
_COBRANCA = ("a_vencer", "atrasados")

_LOCAIS = {"cards": ("etapa", "pendencia", "parado", "cobranca", "colaborador"),
           "pendencias": ("minhas",)}

# chave → (caminho no HSGrowth, o que é, filtros aceitos do agente).
CONSULTAS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "quadros": ("/service-boards", "os quadros de Serviços (1 = Serviços, 2 = Serviço - Cobrança)", ()),
    "etapas": ("/service-boards/{board_id}/lists",
               "as etapas de um quadro (`board_id` 1 ou 2), com o id para o filtro `etapa`", ()),
    "cards": ("/service-boards/{board_id}/cards",
              "os cards de um quadro (`board_id` 1 ou 2, OBRIGATÓRIO). Filtros: `etapa` (id da etapa), "
              "`pendencia` (`overdue` atrasada, `today` vence hoje, `future` só futuras, `none` sem "
              "atividade pendente), `parado` (`3d` ou `7d` sem movimentação), `cobranca` (`a_vencer` "
              "ou `atrasados`, só quadro 2) e `colaborador=eu` (cards em que o seu dono agiu)",
              ("etapa", "pendencia", "parado", "cobranca", "colaborador")),
    "card": ("/service-boards/{board_id}/cards/{card_id}",
             "um card pelo id (`board_id` + `id`): dados, produtos (aparelhos) e serviços do card", ()),
    "atividades": ("/service-boards/{board_id}/cards/{card_id}/activities",
                   "as atividades e anotações de um card (`board_id` + `id`)", ()),
    "pendencias": ("/service-activities",
                   "as atividades pendentes dos quadros de Serviços, de TODOS os usuários "
                   "(o módulo não separa por responsável). `minhas=true` deixa só as do seu dono",
                   ("minhas",)),
    "buscar": ("/search/global",
               "busca geral de cards de Serviços (título, cliente, CNPJ, contato ou nº de série). "
               "`q` (mínimo 2 letras), `limit` (até 30)", ("q", "limit")),
    "catalogo_aparelhos": ("/service-products", "o catálogo de equipamentos. `search` (nome, SKU ou categoria)",
                           ("search",)),
    "catalogo_servicos": ("/services", "o catálogo de serviços. `search`", ("search",)),
    "painel": ("/service-dashboard",
               "o painel de Serviços: parados, ganhos, perdas, funil. `start`/`end` (AAAA-MM-DD) e "
               "`board` (1 ou 2)", ("start", "end", "board")),
    "clientes": ("/clients", "os clientes (empresas). `search` (nome ou CNPJ)", ("search",)),
    "contatos": ("/persons", "os contatos (pessoas). `search`", ("search",)),
}

# O que a pessoa diria ao Guardi para chegar a esta consulta — só para a tela
# "Capacidade" (`app/capacidade.py`). Opcional: sem exemplo, a tela mostra só o
# rótulo. O agente não lê isto: ele lê a descrição acima.
EXEMPLOS: dict[str, str] = {
    "cards": "quais cards de Cobrança estão atrasados?",
    "pendencias": "quais atividades minhas estão pendentes?",
    "buscar": "acha o card do aparelho de série 12345",
    "painel": "como está o painel de Serviços este mês?",
}

_PEDE_BOARD = ("etapas", "cards", "card", "atividades")
_PEDE_CARD = ("card", "atividades")


def pede_quadro(chave: str) -> bool:
    """A consulta precisa do `board_id` (1 ou 2)."""
    return chave in _PEDE_BOARD


def quadro_valido(valor) -> int:
    """`board_id` só 1 ou 2; qualquer outro (inclusive bool e texto) é recusado."""
    if isinstance(valor, bool) or not _ID.match(str(valor if valor is not None else "")):
        raise ValueError("`board_id` tem que ser 1 (Serviços) ou 2 (Serviço - Cobrança).")
    n = int(str(valor))
    if n not in QUADROS:
        raise ValueError("Só os quadros 1 (Serviços) e 2 (Serviço - Cobrança) estão ao meu alcance.")
    return n


def pede_eu(chave: str, locais: dict | None = None) -> bool:
    """A consulta depende do id do dono no HSGrowth (`/users/me`)."""
    locais = locais or {}
    return (chave == "cards" and "colaborador" in locais) or (chave == "pendencias" and "minhas" in locais)


def caminho_da_consulta(chave: str, ident=None, board_id=None) -> str:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja hsgrowth_servicos_consultas.")
    caminho = CONSULTAS[chave][0]
    if chave in _PEDE_BOARD:
        board = quadro_valido(board_id)
        caminho = caminho.replace("{board_id}", str(board))
    elif board_id not in (None, ""):
        raise ValueError(f"A consulta {chave} não leva `board_id`.")
    if chave in _PEDE_CARD:
        if ident is None or isinstance(ident, bool) or not _ID.match(str(ident)):
            raise ValueError(f"A consulta {chave} precisa de um `id` (só números).")
        caminho = caminho.replace("{card_id}", str(ident))
    elif ident not in (None, ""):
        raise ValueError(f"A consulta {chave} não leva `id` — use os filtros.")
    assert not _MARCADOR.search(caminho)
    return caminho


def caminhos_do_card(board_id, ident) -> tuple[str, str, str]:
    """(card, produtos, serviços) — o `card` é montado juntando os três."""
    base = caminho_da_consulta("card", ident, board_id)
    return base, f"{base}/products", f"{base}/services"


def _inteiro(k, v, minimo, maximo=None) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"`{k}` tem que ser um número inteiro.") from None
    if isinstance(v, bool) or n < minimo or (maximo is not None and n > maximo):
        raise ValueError(f"`{k}` inválido: {v}.")
    return n


def params_da_consulta(chave: str, parametros: dict | None) -> tuple[list[tuple[str, str]], dict[str, str]]:
    """Valida os filtros do agente → (query que vai ao HSGrowth, filtros locais)."""
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja hsgrowth_servicos_consultas.")
    if parametros is not None and not isinstance(parametros, dict):
        raise ValueError("Filtros: um objeto nome → valor.")
    aceitos = CONSULTAS[chave][2]
    remotos: list[tuple[str, str]] = []
    locais: dict[str, str] = {}
    for k, v in (parametros or {}).items():
        if k not in aceitos:
            validos = ", ".join(aceitos) if aceitos else "nenhum"
            raise ValueError(f"A consulta {chave} não aceita o filtro {k!r}. Válidos: {validos}.")
        if isinstance(v, (list, dict)):
            raise ValueError(f"O filtro {k} aceita um valor só.")
        if k == "limit":
            v = _inteiro(k, v, 1, 30)
        elif k == "etapa":
            v = _inteiro(k, v, 1, 2**31 - 1)
        elif k == "board":
            v = quadro_valido(v)
        elif k in ("start", "end") and not _DATA.match(str(v)):
            raise ValueError(f"`{k}` inválido: {v} (use AAAA-MM-DD).")
        elif k == "q" and len(str(v).strip()) < 2:
            raise ValueError("`q` precisa de pelo menos 2 letras.")
        elif k == "pendencia" and v not in _PENDENCIA:
            raise ValueError(f"`pendencia` inválido: {v}. Válidos: {', '.join(_PENDENCIA)}.")
        elif k == "parado" and v not in _PARADO:
            raise ValueError(f"`parado` inválido: {v}. Válidos: {', '.join(_PARADO)}.")
        elif k == "cobranca" and v not in _COBRANCA:
            raise ValueError(f"`cobranca` inválido: {v}. Válidos: {', '.join(_COBRANCA)}.")
        elif k == "colaborador" and v != "eu":
            raise ValueError("`colaborador` só aceita `eu`.")
        elif k == "minhas":
            if v not in (True, "true", "True"):
                continue   # minhas=false é o padrão: todas
            v = "true"
        if k in _LOCAIS.get(chave, ()):
            locais[k] = _escalar(v)
        else:
            remotos.append((k, _escalar(v)))
    if chave == "pendencias":
        remotos.append(("status", "pending"))
    return remotos, locais


def _lista_de(dados, campo: str):
    if isinstance(dados, dict) and isinstance(dados.get(campo), list):
        return dados[campo]
    return None


def _quadro_do_item(item) -> bool:
    return isinstance(item, dict) and not isinstance(item.get("board_id"), bool) \
        and item.get("board_id") in QUADROS


def filtrar_local(chave: str, dados, locais: dict | None, eu_id: int | None):
    """Aplica na resposta o que não foi ao HSGrowth, FALHANDO FECHADO.
    `quadros`: só 1 e 2. `cards`: `etapa`, `pendencia`, `parado`, `cobranca` e
    `colaborador=eu`. `pendencias`: só quadros 1/2 e, com `minhas`, `user_id` do
    dono. `buscar`: só a parte de serviço. Formato inesperado: ValueError."""
    erro = ValueError("resposta inesperada do HSGrowth")
    f = locais or {}
    if chave == "quadros":
        itens = _lista_de(dados, "boards")
        if itens is None or not all(isinstance(b, dict) for b in itens):
            raise erro
        itens = [b for b in itens if not isinstance(b.get("id"), bool) and b.get("id") in QUADROS]
        return {**dados, "boards": itens, "total": len(itens)}
    if chave == "buscar":
        if not isinstance(dados, dict) or not isinstance(dados.get("servico"), list):
            raise erro
        return [s for s in dados["servico"] if _quadro_do_item(s)]
    if chave == "cards":
        itens = _lista_de(dados, "cards")
        if itens is None or not all(isinstance(c, dict) for c in itens):
            raise erro
        if "colaborador" in f and (isinstance(eu_id, bool) or not isinstance(eu_id, int)):
            raise ValueError("A consulta cards depende do id do dono no HSGrowth.")
        saida = []
        for c in itens:
            if "etapa" in f and str(c.get("list_id")) != str(f["etapa"]):
                continue
            if "pendencia" in f and c.get("pending_status") != f["pendencia"]:
                continue
            if "parado" in f and c.get(f"is_stuck_{f['parado']}") is not True:
                continue
            if "cobranca" in f:
                biz = c.get("business_info")
                if not isinstance(biz, dict) or biz.get("collection_type") != f["cobranca"]:
                    continue
            if "colaborador" in f:
                cols = c.get("collaborators")
                if not isinstance(cols, list):
                    raise erro
                if not any(isinstance(x, dict) and x.get("id") == eu_id for x in cols):
                    continue
            saida.append(c)
        return {**dados, "cards": saida, "total": len(saida)}
    if chave == "pendencias":
        itens = _lista_de(dados, "activities")
        if itens is None or not all(isinstance(a, dict) for a in itens):
            raise erro
        if "minhas" in f and (isinstance(eu_id, bool) or not isinstance(eu_id, int)):
            raise ValueError("A consulta pendencias depende do id do dono no HSGrowth.")
        itens = [a for a in itens if _quadro_do_item(a)]
        if "minhas" in f:
            itens = [a for a in itens if a.get("user_id") == eu_id]
        return {**dados, "activities": itens, "total": len(itens)}
    return dados


def _com_link(item, base: str, board_id, card_id):
    if not isinstance(item, dict):
        return item
    limpo = {k: v for k, v in item.items() if k != "link"}   # link de fora é dado externo
    if (isinstance(board_id, bool) or isinstance(card_id, bool)
            or board_id not in QUADROS or not _ID.match(str(card_id if card_id is not None else ""))):
        return limpo
    return {**limpo, "link": f"{base.rstrip('/')}/servicos/{board_id}/cards/{card_id}"}


def com_links(chave: str, dados, base: str, board_id=None):
    """Acrescenta `link` (`/servicos/<quadro>/cards/<card>`, do FRONT) aos cards —
    montado aqui, sobrescrevendo qualquer `link` vindo de fora."""
    if chave == "card":
        return _com_link(dados, base, board_id, dados.get("id") if isinstance(dados, dict) else None)
    if chave == "cards":
        itens = _lista_de(dados, "cards")
        if itens is None:
            return dados
        return {**dados, "cards": [_com_link(c, base, board_id, c.get("id") if isinstance(c, dict) else None)
                                   for c in itens]}
    if chave == "buscar" and isinstance(dados, list):
        return [_com_link(s, base, s.get("board_id") if isinstance(s, dict) else None,
                          s.get("id") if isinstance(s, dict) else None) for s in dados]
    if chave == "pendencias":
        itens = _lista_de(dados, "activities")
        if itens is None:
            return dados
        return {**dados, "activities": [
            _com_link(a, base, a.get("board_id") if isinstance(a, dict) else None,
                      a.get("service_card_id") if isinstance(a, dict) else None) for a in itens]}
    return dados
