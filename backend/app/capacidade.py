"""A "Capacidade" do Guardi: o que ele alcança agora, com o login do dono (13/11/2026).

Spec `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`.

**Quem diz o que o login pode é cada sistema** (`GET /agente/capacidades`, com o
token de agente de sempre): ele devolve os pares (método, template) do allowlist
de agente dele que AQUELE login consegue usar. Este módulo só cruza esses pares
com os NOSSOS catálogos — uma consulta ou ação aparece se todas as rotas que ela
chama estão na resposta. Nenhuma regra de papel mora aqui: copiada, divergiria
em silêncio da de lá (é a duplicação que todas as integrações evitaram).

⚠️ **Sistema sem a rota nova (404) aparece SEM lista** — nunca com a lista
completa. A tela não promete o que o login pode não fazer.

⚠️ **Ação que chama várias rotas só aparece se TODAS estiverem permitidas** (o
`hsgrowth_criar_lead` cria cliente, contato e card; faltando uma, ele para no
meio). As rotas de cada ação são as que o executor de `app/acoes.py` chama
SEMPRE; passo opcional (checklist, campo personalizado sem pedido) não entra.

**A tela mostra ASSUNTOS, não itens** (13/11/2026, segunda versão): o que a
pessoa lê — título, ícone, cor, frase curta de "vê" e "faz" — mora em
`app/capacidade_assuntos.py`, escrito à mão. Item que é só passo do agente (id,
ciclo, "quem você é") é `INTERNO`: não aparece, mas segue valendo como
pré-requisito de quem o `requer`.

Puro, testado em `tests/test_capacidade.py`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from app import capacidade_assuntos as ax
from app import datacore_consultas as dc
from app import docshs_consultas as dh
from app import gestorhs_consultas as gh
from app import hsgrowth_consultas as hg
from app import hsgrowth_servicos_consultas as hs
from app import talenths_consultas as tc
from app import talenths_escrita as te

Rota = tuple[str, str]   # (método, template)

ESTADOS = ("ok", "sem_conta", "fora_do_ar", "sem_resposta_de_capacidade")

# Ordem da tela. O HSGrowth é UM cliente com dois sistemas em `sistemas_ligados`
# (Vendas e Serviços): uma chamada responde aos dois.
SISTEMAS: dict[str, str] = {
    "taskhs": "TaskHS",
    "talenths": "TalentHS",
    "docshs": "DocsHS",
    "gestorhs": "GestorHS",
    "hsgrowth": "HSGrowth — Vendas",
    "hsgrowth_servicos": "HSGrowth — Serviços",
    "datacore": "DataCore",
}
# Sistema em `sistemas_ligados` → o cliente que responde por ele.
CLIENTE_DO_SISTEMA = {s: s for s in SISTEMAS} | {"hsgrowth_servicos": "hsgrowth"}


@dataclass(frozen=True)
class Item:
    rotulo: str
    rotas: tuple[Rota, ...]
    exemplo: str | None = None


# ── o casamento das rotas ────────────────────────────────────────────────────

_PARAM = re.compile(r"^\{[^{}/]+\}$")
# ⚠️ O prefixo `/api/v1` é da URL base de alguns sistemas (DocsHS e HSGrowth a
# têm na base; os catálogos daqui são relativos a ela). O allowlist de lá pode
# escrever a rota com ou sem ele — os dois lados são comparados sem.
_PREFIXO = "/api/v1"


def chave_da_rota(metodo: str, template: str) -> tuple[str, tuple[str, ...]]:
    """Forma comparável de uma rota: método em maiúsculas e o caminho segmento a
    segmento, com TODO parâmetro virando `{}`.

    ⚠️ O NOME do parâmetro não conta: o catálogo daqui diz `/clientes/{id}` onde o
    sistema de lá diz `/clientes/{cliente_id}`, e é a mesma rota. Barra final
    também não conta (`/clientes/` do DataCore)."""
    caminho = str(template or "").split("?", 1)[0].strip()
    if caminho.startswith(_PREFIXO + "/") or caminho == _PREFIXO:
        caminho = caminho[len(_PREFIXO):]
    segs = tuple("{}" if _PARAM.match(s) else s for s in caminho.split("/") if s)
    return str(metodo or "").strip().upper(), segs


def rotas_permitidas(rotas) -> set[tuple[str, tuple[str, ...]]]:
    """As `rotas` da resposta do sistema, na forma comparável. Par mal formado é
    ignorado (nunca vira permissão)."""
    saida = set()
    for par in rotas if isinstance(rotas, list) else []:
        if isinstance(par, (list, tuple)) and len(par) == 2 and all(isinstance(x, str) for x in par):
            saida.add(chave_da_rota(par[0], par[1]))
    return saida


def permitido(item: Item, permitidas: set) -> bool:
    return bool(item.rotas) and all(chave_da_rota(m, t) in permitidas for m, t in item.rotas)


# ── os catálogos, como itens ─────────────────────────────────────────────────

def _de_consultas(consultas: dict, exemplos: dict, extras: dict | None = None) -> dict[str, Item]:
    """chave do catálogo → Item. O rótulo é a chave: o texto que a pessoa lê sai
    de `capacidade_assuntos`, escrito à mão — a descrição do catálogo é do agente."""
    extras = extras or {}
    return {k: Item(k, (("GET", v[0]),) + tuple(extras.get(k, ())), exemplos.get(k))
            for k, v in consultas.items()}


_EU_DOCSHS = (("GET", "/auth/eu"),)
_EU_HSGROWTH = (("GET", "/users/me"),)

# TaskHS não tem catálogo de consultas: cada ferramenta `taskhs_*` chama uma
# rota fixa (`routers/mcp_bot.py::_taskhs`). Chave = nome da ferramenta.
TASKHS_CONSULTAS: dict[str, Item] = {
    "taskhs_eu": Item("Quem você é no TaskHS", (("GET", "/auth/me"),)),
    "taskhs_minhas": Item("As tarefas em que você é membro", (("GET", "/cards/minhas"),),
                          "quais tarefas minhas estão abertas?"),
    "taskhs_quadros": Item("Os quadros que você pode abrir", (("GET", "/boards"),)),
    "taskhs_quadro": Item("Um quadro, com as listas e os cards", (("GET", "/boards/{board_id}/snapshot"),),
                          "o que tem no quadro da Qualidade?"),
    "taskhs_tarefa": Item("Uma tarefa, com os checklists", (("GET", "/lists/{list_id}/cards/{card_id}"),)),
    "taskhs_buscar": Item("Procurar tarefas pelo texto", (("GET", "/search"),), "acha a tarefa da auditoria"),
    "taskhs_parados": Item("Cards parados ou atrasados, pelas réguas do Dashboard", (("GET", "/dashboard"),),
                           "quais cards estão parados?"),
    "taskhs_membros_quadro": Item("Quem é membro de um quadro", (("GET", "/boards/{board_id}/members"),)),
}

_CARD_TASKHS = "/lists/{list_id}/cards/{card_id}"
_SV_CARD = "/service-boards/{board_id}/cards/{card_id}"
_SV_LER = (("GET", _SV_CARD), ("GET", "/service-boards/{board_id}/lists"))

# As ações de escrita, por sistema. Chave = (sistema, ação) de `acoes.EXECUTORES`
# (o teste confere que nenhuma fica de fora). O TalentHS sai de `talenths_escrita`.
ACOES: dict[tuple[str, str], Item] = {
    ("taskhs", "comentar"): Item("Comentar numa tarefa", (("POST", _CARD_TASKHS + "/comments"),),
                                 "comenta na tarefa da auditoria que já enviei o relatório"),
    ("taskhs", "mover"): Item("Mover uma tarefa de lista", (("PATCH", _CARD_TASKHS),),
                              "move a tarefa da auditoria para Concluído"),
    ("taskhs", "criar"): Item("Criar uma tarefa, com checklist", (
        ("POST", "/lists/{list_id}/cards"), ("GET", "/auth/me"),
        ("POST", _CARD_TASKHS + "/members/{user_id}")), "cria uma tarefa para revisar o contrato até sexta"),
    ("taskhs", "atualizar"): Item("Concluir uma tarefa, mudar prazo, prioridade ou checklist",
                                  (("PATCH", _CARD_TASKHS),), "marca a tarefa do relatório como concluída"),
    ("taskhs", "membros"): Item("Pôr ou tirar pessoas de uma tarefa", (
        ("POST", _CARD_TASKHS + "/members/{user_id}"), ("DELETE", _CARD_TASKHS + "/members/{user_id}")),
        "põe a Ana na tarefa da auditoria"),
    ("gestorhs", "receber"): Item("Receber aparelhos que chegaram (abre as OS)", (("POST", "/ordens"),),
                                  "chegaram os bafômetros da Vale, séries 123 e 456"),
    ("gestorhs", "avancar_caixa"): Item("Avançar uma caixa de fase", (("POST", "/caixas/{caixa_id}/avancar"),),
                                        "avança a caixa 5120"),
    ("gestorhs", "fechar_caixa"): Item("Finalizar uma caixa com o rastreio",
                                       (("POST", "/caixas/{caixa_id}/avancar"),),
                                       "fecha a caixa 5120 com o rastreio AB123"),
    ("gestorhs", "cadastrar_aparelho"): Item("Cadastrar um aparelho na frota de um cliente",
                                             (("POST", "/equipamentos-cliente"),)),
    ("gestorhs", "gerar_certificado"): Item("Gerar o certificado de calibração", (
        ("GET", "/ordens/{ordem_id}/certificado-campos"), ("POST", "/ordens/{ordem_id}/gerar-certificado")),
        "gera o certificado da OS 11700 com as leituras 0,181…"),
    ("gestorhs", "criar_proposta"): Item("Montar uma proposta", (
        ("GET", "/propostas/padrao"), ("POST", "/propostas")), "faz uma proposta de calibração para a Vale"),
    ("gestorhs", "alterar_proposta"): Item("Alterar uma proposta", (("PUT", "/propostas/{proposta_id}"),),
                                           "tira o frete da proposta 3021"),
    ("hsgrowth", "hsgrowth_registrar"): Item("Registrar o pós-ligação num card seu (nota, tarefas, etapa)", (
        ("PUT", "/cards/{card_id}"), ("POST", "/card-notes"), ("POST", "/card-tasks"),
        ("PUT", "/card-tasks/{task_id}"), ("PATCH", "/card-tasks/{task_id}/complete"),
        ("PUT", "/cards/{card_id}/move")), "liguei para a Ambev, marca reunião na quinta"),
    ("hsgrowth", "hsgrowth_cliente"): Item("Completar o cliente e o contato de um card seu", (
        ("PUT", "/clients/{client_id}"), ("PUT", "/persons/{person_id}"))),
    ("hsgrowth", "hsgrowth_criar_lead"): Item("Criar um lead novo", (
        ("POST", "/clients"), ("POST", "/persons"), ("POST", "/cards")),
        "cria um lead da empresa X, contato Maria"),
    ("hsgrowth", "hsgrowth_ganhar"): Item("Marcar um card seu como ganho", (("POST", "/cards/{card_id}/win"),)),
    ("hsgrowth", "hsgrowth_perder"): Item("Marcar um card seu como perdido", (("POST", "/cards/{card_id}/lose"),)),
    ("hsgrowth", "hsgrowth_noshow"): Item("Marcar no-show numa reunião",
                                          (("PATCH", "/card-tasks/{task_id}/noshow"),),
                                          "o cliente não apareceu na reunião de hoje"),
    ("hsgrowth_servicos", "hsgrowth_servicos_registrar"): Item(
        "Registrar o pós-contato num card (dados, atividades, etapa)", _SV_LER + (
            ("PUT", _SV_CARD), ("POST", _SV_CARD + "/activities"),
            ("PATCH", _SV_CARD + "/activities/{activity_id}/complete"), ("PUT", _SV_CARD + "/move")),
        "liguei para o cliente do card 812, ele vai pagar sexta"),
    ("hsgrowth_servicos", "hsgrowth_servicos_itens"): Item(
        "Pôr, alterar ou tirar aparelhos e serviços de um card", _SV_LER + tuple(
            (m, _SV_CARD + f"/{r}" + ("/{item_id}" if m != "POST" else ""))
            for r in ("products", "services") for m in ("POST", "PUT", "DELETE"))),
    ("hsgrowth_servicos", "hsgrowth_servicos_ganhar"): Item("Marcar um card como ganho",
                                                            _SV_LER + (("PUT", _SV_CARD + "/move"),)),
    ("hsgrowth_servicos", "hsgrowth_servicos_perder"): Item("Marcar um card como perdido", _SV_LER + (
        ("POST", _SV_CARD + "/activities"), ("PUT", _SV_CARD + "/move"))),
    ("hsgrowth_servicos", "hsgrowth_servicos_anexar_proposta"): Item(
        "Anexar o PDF da proposta do GestorHS no card", _SV_LER + (("POST", _SV_CARD + "/activities/files"),),
        "anexa a proposta 3021 no card 812"),
}


def _acoes_talenths() -> dict[str, Item]:
    itens = {}
    for nome, a in te.ACOES.items():
        rotas: tuple[Rota, ...] = ((a.metodo, a.rota),)
        if nome == "criar_pdi":
            # O plano nasce sem ações e elas entram uma a uma (`acoes._executor_talenths`).
            rotas += (("POST", te.ACOES["acrescentar_acao_pdi"].rota),)
        itens[nome] = Item(nome, rotas, te.EXEMPLOS.get(nome))
    return itens


def _acoes_de(sistema: str) -> dict[str, Item]:
    return {a: i for (s, a), i in ACOES.items() if s == sistema}


def catalogo(sistema: str) -> tuple[dict[str, Item], dict[str, Item]]:
    """(consultar, fazer) de um sistema: chave do catálogo → Item."""
    if sistema == "taskhs":
        return dict(TASKHS_CONSULTAS), _acoes_de("taskhs")
    if sistema == "datacore":
        return _de_consultas(dc.CONSULTAS, dc.EXEMPLOS), {}
    if sistema == "docshs":
        return _de_consultas(dh.CONSULTAS, dh.EXEMPLOS,
                             {k: _EU_DOCSHS for k in dh.CONSULTAS if dh.precisa_de_eu(k)}), {}
    if sistema == "gestorhs":
        return _de_consultas(gh.CONSULTAS, gh.EXEMPLOS), _acoes_de("gestorhs")
    if sistema == "hsgrowth":
        return _de_consultas(hg.CONSULTAS, hg.EXEMPLOS,
                             {k: _EU_HSGROWTH for k in hg.CONSULTAS if hg.pede_eu(k)}), _acoes_de("hsgrowth")
    if sistema == "hsgrowth_servicos":
        # O `card` junta três leituras: o card, os produtos e os serviços dele.
        extras = {"card": (("GET", _SV_CARD + "/products"), ("GET", _SV_CARD + "/services"))}
        return _de_consultas(hs.CONSULTAS, hs.EXEMPLOS, extras), _acoes_de("hsgrowth_servicos")
    if sistema == "talenths":
        return _de_consultas(tc.CONSULTAS, tc.EXEMPLOS), _acoes_talenths()
    raise ValueError(f"sistema desconhecido: {sistema}")


def _liberado(chave: str, onde: ax.Onde, itens: dict[str, Item], internos: dict[str, Item],
              permitidas: set) -> bool:
    """O item e os internos de que ele depende (`requer`) com todas as rotas
    liberadas. ⚠️ Interno ausente do catálogo conta como NÃO liberado: um
    `requer` com nome errado esconde o item em vez de prometê-lo."""
    return permitido(itens[chave], permitidas) and all(
        r in internos and permitido(internos[r], permitidas) for r in onde.requer)


def montar_assuntos(assuntos, ve: list[tuple[ax.Onde, str | None]],
                    faz: list[tuple[ax.Onde, str | None]]) -> list[dict]:
    """Os assuntos que têm ao menos um item liberado, na ordem declarada.
    `ve`/`faz` = (onde, exemplo do catálogo) dos itens JÁ liberados, na ordem do
    mapa. Frase repetida (o item da lista e o "pelo id" dele) aparece uma vez.
    Exemplos: até dois, primeiro um do "vê" e um do "faz" — só de item
    liberado, para a tela nunca sugerir o que o login não faz."""
    saida = []
    for a in assuntos:
        v = [(o, e) for o, e in ve if o.assunto == a.chave]
        f = [(o, e) for o, e in faz if o.assunto == a.chave]
        if not v and not f:
            continue
        exs_v = [o.exemplo or e for o, e in v if o.exemplo or e]
        exs_f = [o.exemplo or e for o, e in f if o.exemplo or e]
        exemplos = list(dict.fromkeys(exs_v[:1] + exs_f[:1] + exs_v[1:] + exs_f[1:]))[:2]
        saida.append({
            "chave": a.chave, "titulo": a.titulo, "icone": a.icone, "cor": a.cor,
            "ve": list(dict.fromkeys(o.frase for o, _ in v)),
            "faz": list(dict.fromkeys(o.frase for o, _ in f)),
            "na_hora": list(dict.fromkeys(o.frase for o, _ in f if o.na_hora)),
            "exemplos": exemplos,
        })
    return saida


def montar_sistema(sistema: str, estado: str, resposta: dict | None = None) -> dict:
    """Um sistema na resposta da rota, por assunto. Só `ok` traz assuntos; nos
    outros estados a lista vem VAZIA — nunca o catálogo inteiro."""
    if estado not in ESTADOS:
        raise ValueError(f"estado desconhecido: {estado}")
    papel = None
    assuntos: list[dict] = []
    if estado == "ok":
        resposta = resposta if isinstance(resposta, dict) else {}
        p = resposta.get("papel")
        papel = str(p)[:80] if isinstance(p, (str, int)) and str(p).strip() else None
        permitidas = rotas_permitidas(resposta.get("rotas"))
        consultar, fazer = catalogo(sistema)
        mapa_ve, mapa_faz = ax.VE[sistema], ax.FAZ[sistema]
        internos = {k: consultar[k] for k, w in mapa_ve.items() if w == ax.INTERNO and k in consultar}

        def liberados(mapa, itens):
            return [(w, itens[k].exemplo) for k, w in mapa.items()
                    if w != ax.INTERNO and k in itens and _liberado(k, w, itens, internos, permitidas)]
        assuntos = montar_assuntos(ax.ASSUNTOS[sistema], liberados(mapa_ve, consultar),
                                   liberados(mapa_faz, fazer))
    return {"sistema": sistema, "nome": SISTEMAS.get(sistema, sistema), "papel": papel,
            "estado": estado, "assuntos": assuntos}


def resposta_valida(r) -> bool:
    """O contrato: objeto com `rotas` em lista. Fora disso o sistema não sabe
    responder — e a tela diz isso, em vez de mostrar uma lista vazia como se o
    login não pudesse nada."""
    return isinstance(r, dict) and isinstance(r.get("rotas"), list)


def estado_do_erro(status: int | None) -> str:
    """O que um erro na chamada de `/agente/capacidades` quer dizer na tela.
    401 = o dono não tem conta ativa lá. Sem resposta (0, timeout) ou 5xx = fora
    do ar. O resto (404 da rota que ainda não existe, 403 do allowlist que ainda
    não a tem, 4xx) = o sistema ainda não sabe responder."""
    if status == 401:
        return "sem_conta"
    if status is None or status == 0 or status >= 500:
        return "fora_do_ar"
    return "sem_resposta_de_capacidade"


# ── o que é do próprio HS.OS ─────────────────────────────────────────────────

def itens_do_hsos(email_ligado: bool, calendario: bool) -> list[dict]:
    """Memória e lembretes são de todo Guardi; e-mail só com `email_ligado`, e a
    agenda do Outlook só se a conta concedeu o calendário. Um "sistema" só, com
    os assuntos — a tela o desenha como os outros. Quase tudo aqui sai na hora
    (`na_hora`); o e-mail para outras pessoas espera o cartão."""
    ve = {"memoria", "lembretes"}
    faz = {"lembrar", "agenda_criar", "agenda_mudar"}
    if email_ligado:
        ve |= {"caixas", "emails", "preparados"}
        faz |= {"preparar", "para_si", "marcar_lidos"}
        if calendario:
            ve.add("outlook")
    assuntos = montar_assuntos(ax.HSOS, [(w, None) for k, w in ax.HSOS_VE.items() if k in ve],
                               [(w, None) for k, w in ax.HSOS_FAZ.items() if k in faz])
    return [{"sistema": "hsos", "nome": "Memória, lembretes e e-mail", "papel": None, "estado": "ok",
             "assuntos": assuntos}]
