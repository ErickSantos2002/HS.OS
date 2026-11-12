"""O que o Guardi pode consultar no HSGrowth (CRM) — e só isso (12/11/2026, leitura).

Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`. O Guardi
lê o funil COMO o dono: o HSGrowth aplica o papel dele lá. Aqui mora a outra
metade, a mesma do GestorHS: **o agente escolhe uma consulta desta lista, nunca um
caminho**, e o link do card é montado aqui, nunca pelo modelo.

Três coisas diferem do GestorHS:
- **`assigned_to_id` nunca vem do agente.** `meus_cards` e `minhas_tarefas` são
  "do dono": o router passa o `eu_id` (o id do dono no HSGrowth, de `/users/me`) e
  este módulo o põe na query. Se o agente pudesse escolher, leria o funil de outro.
- **`meus_cards` ainda é filtrado AQUI**: o `/cards` do HSGrowth devolve cards de
  mais de um responsável conforme o papel, então só ficam os que têm o dono como
  `assigned_to_id` ou `sdr_id` (`filtrar_local`).
- **Filtros locais** (`etapa`, `tarefa`, `parado`) são aceitos do agente mas
  NUNCA vão ao HSGrowth: `separar_filtros` os tira da query e `filtrar_local` os
  aplica na resposta.

⚠️ "Parado" (`parado=3d|7d`): é a regra do próprio kanban do HSGrowth, as flags
`is_stuck_3d`/`is_stuck_7d` ("sem movimentação") que o `/cards?minimal=true`
devolve — por isso `meus_cards` SEMPRE pede `minimal=true`. O relatório
`~/projetos/relatorios-hsgrowth/cards_parados.py` usa outra régua (7 dias sem
nenhum toque: atividade, nota ou tarefa concluída); ela NÃO é usada aqui.

⚠️ `filtrar_local` FALHA FECHADO: em `meus_cards` e `tarefas_atrasadas` o corte
por dono é a única tranca (o HSGrowth não escopa a segunda para admin/gerente);
resposta num formato inesperado levanta `ValueError` em vez de devolver dados
sem filtrar.

Puro, testado em `tests/test_guardi_hsgrowth.py`.
"""
from __future__ import annotations

import re

from app.datacore_consultas import _escalar, texto_do_retorno

__all__ = ["CONSULTAS", "caminho_da_consulta", "params_da_consulta", "separar_filtros",
           "filtrar_local", "pede_id", "pede_eu", "com_links", "texto_do_retorno"]

_MAX_PAGINA = 100
_ID = re.compile(r"^[0-9]{1,10}$")
_MARCADOR = re.compile(r"\{[a-z_]+\}")
_CNPJ = re.compile(r"^[0-9]{14}$")
_TAREFA = ("overdue", "today", "future", "none")
_DATA = re.compile(r"^\d{4}-\d{2}-\d{2}([T ][0-9:.+Z-]*)?$")

# Filtros que não vão ao HSGrowth (aplicados em `filtrar_local`).
_LOCAIS = ("etapa", "tarefa", "parado")
_PARADO = ("3d", "7d")
# Inteiros que o agente passa como id (o HSGrowth rejeitaria o resto com 422).
_FILTROS_ID = ("board_id", "organization_id", "etapa")
_FILTROS_DATA = ("created_at_from", "created_at_to", "entered_at_from", "entered_at_to",
                 "due_date_start", "due_date_end")
_OBRIGATORIOS = {"meus_cards": ("board_id",), "buscar": ("q",)}
# Chaves em que o `<eu>` é injetado, e o que vai junto.
_DO_DONO = {"meus_cards": (("all", "true"), ("minimal", "true")), "minhas_tarefas": ()}
# Consultas que exigem o dono mas o filtram só aqui (sem parâmetro remoto).
_SO_LOCAL = ("tarefas_atrasadas",)

# chave → (caminho no HSGrowth, o que é e para quem, filtros aceitos do agente).
CONSULTAS: dict[str, tuple[str, str, tuple[str, ...]]] = {
    "quadros": ("/boards", "os quadros (funis) de vendas, com o id para `meus_cards` e `campos`", ()),
    "etapas": ("/boards/{board_id}/lists",
               "as etapas (listas) de um quadro, com o id para o filtro `etapa` de `meus_cards`", ()),
    "meus_cards": ("/cards",
                   "os cards do dono (como vendedor ou SDR) em um quadro. `board_id` é OBRIGATÓRIO "
                   "(de `quadros`). `is_won`/`is_lost` (true/false), `created_at_from`/`created_at_to` "
                   "e `entered_at_from`/`entered_at_to` (AAAA-MM-DD; entered = entrou na etapa atual). "
                   "Filtros daqui: `etapa` (id da etapa, de `etapas`), `tarefa` (`overdue` = tarefa "
                   "atrasada, `today` = vence hoje, `future` = só futuras, `none` = sem tarefa "
                   "pendente) e `parado` (`3d` ou `7d`: o card está parado há mais de 3 ou 7 dias sem movimentação, "
                   "pela regra do kanban)",
                   ("board_id", "is_won", "is_lost", "created_at_from", "created_at_to",
                    "entered_at_from", "entered_at_to") + _LOCAIS),
    "card": ("/cards/{card_id}/expanded", "um card pelo id: cliente, contato, valor, etapa, tarefas pendentes", ()),
    "buscar": ("/search/global",
               "busca geral de cards. `q` (título, cliente, CNPJ, contato; mínimo 2 letras), "
               "`limit` (até 30 por módulo)", ("q", "limit")),
    "notas": ("/card-notes/card/{card_id}", "as anotações de um card", ()),
    "minhas_tarefas": ("/card-tasks",
                       "as tarefas do dono. `is_completed` (true/false), `task_type`, "
                       "`due_date_start`/`due_date_end` (AAAA-MM-DD), `page`",
                       ("is_completed", "task_type", "due_date_start", "due_date_end", "page")),
    "tarefas_atrasadas": ("/card-tasks/overdue", "as tarefas atrasadas", ()),
    "campos": ("/fields/definitions/board/{board_id}", "os campos personalizados de um quadro", ()),
    "clientes": ("/clients", "os clientes (empresas). `search` (nome ou CNPJ)", ("search",)),
    "cliente": ("/clients/{client_id}", "um cliente pelo id", ()),
    "contatos": ("/persons", "os contatos (pessoas). `search`, `organization_id` (id do cliente)",
                 ("search", "organization_id")),
    "receita": ("/clients/cnpj/{cnpj}",
                "os dados cadastrais da Receita para um CNPJ (`id` = o CNPJ, com ou sem pontuação)", ()),
    "parceiros_do_card": ("/cards/{card_id}/aviso-parcerias",
                          "aviso de parcerias: se o cliente do card está com algum parceiro", ()),
}

# Onde cada consulta devolve a lista de itens, quando a resposta é um envelope.
_ENVELOPE = {"meus_cards": "cards", "minhas_tarefas": "tasks"}
_LINK_LISTA = {"meus_cards": "cards", "buscar": "vendas"}   # chave → envelope com cards
_LINK_UNICO = ("card",)


def pede_eu(chave: str) -> bool:
    """A consulta depende do id do dono no HSGrowth (`/users/me`)."""
    return chave in _DO_DONO or chave in _SO_LOCAL


def pede_id(chave: str) -> bool:
    return chave in CONSULTAS and bool(_MARCADOR.search(CONSULTAS[chave][0]))


def caminho_da_consulta(chave: str, ident: str | None) -> str:
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja hsgrowth_consultas.")
    caminho = CONSULTAS[chave][0]
    if pede_id(chave):
        if ident is None or isinstance(ident, bool):
            raise ValueError(f"A consulta {chave} precisa de um `id`.")
        ident = str(ident)
        if chave == "receita":
            digitos = re.sub(r"[.\-/\s]", "", ident)
            if not _CNPJ.match(digitos):
                raise ValueError("`id` da consulta receita: um CNPJ de 14 dígitos.")
            ident = digitos
        elif not _ID.match(ident):
            raise ValueError(f"A consulta {chave} precisa de um `id` (só números).")
        return _MARCADOR.sub(ident, caminho)
    if ident not in (None, ""):
        raise ValueError(f"A consulta {chave} não leva `id` — use os filtros.")
    return caminho


def _inteiro(k: str, v, minimo: int, maximo: int | None = None) -> int:
    try:
        n = int(v)
    except (TypeError, ValueError):
        raise ValueError(f"`{k}` tem que ser um número inteiro.") from None
    if isinstance(v, bool) or n < minimo or (maximo is not None and n > maximo):
        faixa = f"de {minimo} a {maximo}" if maximo is not None else f"a partir de {minimo}"
        raise ValueError(f"`{k}` inválido: {v} (aceito {faixa}).")
    return n


def params_da_consulta(chave: str, parametros: dict | None,
                       eu_id: int | None = None) -> list[tuple[str, str]]:
    """Valida os filtros do agente e devolve a query (os locais vão junto, como
    texto; `separar_filtros` os tira). `eu_id` é do ROUTER: em `meus_cards` e
    `minhas_tarefas` vira `assigned_to_id` (e `all=true` nos cards); sem ele, erro."""
    if chave not in CONSULTAS:
        raise ValueError(f"Consulta desconhecida: {chave}. Veja hsgrowth_consultas.")
    if parametros is not None and not isinstance(parametros, dict):
        raise ValueError("Filtros: um objeto nome → valor.")
    parametros = parametros or {}
    aceitos = CONSULTAS[chave][2]
    saida: list[tuple[str, str]] = []
    for k, v in parametros.items():
        if k not in aceitos:
            validos = ", ".join(aceitos) if aceitos else "nenhum"
            raise ValueError(f"A consulta {chave} não aceita o filtro {k!r}. Válidos: {validos}.")
        if isinstance(v, (list, dict)):
            raise ValueError(f"O filtro {k} aceita um valor só.")
        if k == "limit":
            v = _inteiro(k, v, 1, 30 if chave == "buscar" else _MAX_PAGINA)
        elif k == "page":
            v = _inteiro(k, v, 1)
        elif k in _FILTROS_ID:
            v = _inteiro(k, v, 1, 2**31 - 1)
        elif k in _FILTROS_DATA:
            if not _DATA.match(str(v)):
                raise ValueError(f"`{k}` inválido: {v} (use AAAA-MM-DD).")
        elif k == "parado" and v not in _PARADO:
            raise ValueError(f"`parado` inválido: {v}. Válidos: {', '.join(_PARADO)}.")
        elif k == "tarefa" and v not in _TAREFA:
            raise ValueError(f"`tarefa` inválido: {v}. Válidos: {', '.join(_TAREFA)}.")
        elif k == "q" and len(str(v).strip()) < 2:
            raise ValueError("`q` precisa de pelo menos 2 letras.")
        saida.append((k, _escalar(v)))
    nomes = {k for k, _ in saida}
    for obrig in _OBRIGATORIOS.get(chave, ()):
        if obrig not in nomes:
            raise ValueError(f"A consulta {chave} precisa do filtro `{obrig}`.")
    if chave in _DO_DONO:
        if eu_id is None or isinstance(eu_id, bool) or not isinstance(eu_id, int):
            raise ValueError(f"A consulta {chave} depende do id do dono no HSGrowth.")
        saida.append(("assigned_to_id", str(eu_id)))
        saida.extend(_DO_DONO[chave])
    if chave in _SO_LOCAL and (eu_id is None or isinstance(eu_id, bool) or not isinstance(eu_id, int)):
        raise ValueError(f"A consulta {chave} depende do id do dono no HSGrowth.")
    if chave == "quadros":
        saida.append(("category", "vendas"))
    return saida


def separar_filtros(chave: str,
                    params: list[tuple[str, str]]) -> tuple[list[tuple[str, str]], dict[str, str]]:
    """(query que vai ao HSGrowth, filtros locais para `filtrar_local`). Só
    `meus_cards` tem filtro local; nas outras, tudo vai."""
    if chave != "meus_cards":
        return params, {}
    remotos = [(k, v) for k, v in params if k not in _LOCAIS]
    return remotos, {k: v for k, v in params if k in _LOCAIS}


def _lista_de(dados, campo: str | None):
    if isinstance(dados, list):
        return dados, None
    if isinstance(dados, dict) and campo and isinstance(dados.get(campo), list):
        return dados[campo], campo
    return None, None


def filtrar_local(chave: str, dados, filtros_locais: dict | None, eu_id: int | None):
    """Aplica na resposta o que não foi ao HSGrowth, FALHANDO FECHADO.
    `meus_cards`: só cards em que o dono é `assigned_to_id` ou `sdr_id`, mais
    `etapa` (`list_id`), `tarefa` (`pending_tasks_status`) e `parado`
    (`is_stuck_3d`/`is_stuck_7d`). `tarefas_atrasadas`: só tarefas com
    `assigned_to_id` do dono. Formato inesperado ou sem `eu_id`: ValueError."""
    if chave not in ("meus_cards", "tarefas_atrasadas"):
        return dados
    erro = ValueError("resposta inesperada do HSGrowth")
    if isinstance(eu_id, bool) or not isinstance(eu_id, int):
        raise ValueError(f"A consulta {chave} depende do id do dono no HSGrowth.")
    itens, campo = _lista_de(dados, _ENVELOPE.get(chave))
    if itens is None or not all(isinstance(c, dict) for c in itens):
        raise erro
    f = filtros_locais or {}
    saida = []
    for c in itens:
        if chave == "tarefas_atrasadas":
            if c.get("assigned_to_id") != eu_id:
                continue
        else:
            if eu_id not in (c.get("assigned_to_id"), c.get("sdr_id")):
                continue
            if "etapa" in f and str(c.get("list_id")) != str(f["etapa"]):
                continue
            if "tarefa" in f and c.get("pending_tasks_status") != f["tarefa"]:
                continue
            if "parado" in f and c.get(f"is_stuck_{f['parado']}") is not True:
                continue
        saida.append(c)
    if campo is None:
        return saida
    return {**dados, campo: saida, "total": len(saida)}


def _com_link(item, base: str):
    if not isinstance(item, dict):
        return item
    ident = item.get("id")
    if ident is None or isinstance(ident, bool) or not _ID.match(str(ident)):
        return {k: v for k, v in item.items() if k != "link"}   # link de fora é dado externo
    return {**item, "link": f"{base.rstrip('/')}/cards/{ident}"}


def com_links(chave: str, dados, base: str):
    """Acrescenta `link` (tela do FRONT do HSGrowth, `/cards/<id>`) aos cards —
    montado aqui, nunca pelo modelo. `meus_cards` (envelope `cards`), `buscar`
    (só `vendas`; o módulo de serviço tem outra tela) e `card`."""
    if chave in _LINK_UNICO:
        return _com_link(dados, base)
    campo = _LINK_LISTA.get(chave)
    if campo is None:
        return dados
    itens, nome = _lista_de(dados, campo)
    if itens is None:
        return dados
    novos = [_com_link(i, base) for i in itens]
    return novos if nome is None else {**dados, nome: novos}
