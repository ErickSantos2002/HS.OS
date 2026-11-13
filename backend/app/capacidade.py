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

Puro, testado em `tests/test_capacidade.py`.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

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


# ── rótulo para quem usa ─────────────────────────────────────────────────────

# Parêntese técnico: código, id, fórmula (`user = colaborador`) ou formato de data.
_PARENTESE_TECNICO = re.compile(r"\s*\([^()]*(?:`|\bids?\b|=|AAAA)[^()]*\)")
_COM_O_ID = re.compile(r",? (?:com o id|paginado)\b.*$")
_DO_DONO = re.compile(r" do (?:seu )?dono\b")
_ARTIGO = re.compile(r"\b(o|a|os|as|um|uma) (\w+)")
_POSSESSIVO = {"o": "o seu {}", "a": "a sua {}", "os": "os seus {}", "as": "as suas {}",
               "um": "um {} seu", "uma": "uma {} sua"}


def _do_dono_para_seu(t: str) -> str:
    """"as batidas de hoje do seu dono" → "as suas batidas de hoje": o possessivo
    vai para o artigo mais próximo antes da expressão."""
    m = _DO_DONO.search(t)
    while m:
        antes, depois = t[:m.start()], t[m.end():]
        art = None
        for art in _ARTIGO.finditer(antes):
            pass
        if art is None:
            antes += " seu"
        else:
            antes = (antes[:art.start()] + _POSSESSIVO[art.group(1)].format(art.group(2))
                     + antes[art.end():])
        t = antes + depois
        m = _DO_DONO.search(t)
    return t


def para_quem_usa(descricao: str) -> str:
    """A descrição do catálogo foi escrita para o AGENTE ("os cards do seu dono.
    `board_id` é OBRIGATÓRIO…"). Para a tela: a primeira frase, sem a parte
    técnica, falando com a pessoa."""
    t = _PARENTESE_TECNICO.sub("", str(descricao or ""))
    for corte in (". ", "; ", " — "):
        t = t.split(corte, 1)[0]
    if t.count("(") > t.count(")"):          # o corte caiu dentro de um parêntese
        t = t[:t.rfind("(")]
    t = _COM_O_ID.sub("", t)
    t = _do_dono_para_seu(t)
    for de, para in (("para o seu dono", "para você"), ("o seu dono", "você"),
                     ("seu dono", "você"), (" se ele ", " se você ")):
        t = t.replace(de, para)
    t = t.replace("`", "").strip().rstrip(".:,")
    return t[:1].upper() + t[1:]


# ── os catálogos, como itens ─────────────────────────────────────────────────

def _de_consultas(consultas: dict, exemplos: dict, extras: dict | None = None) -> list[Item]:
    extras = extras or {}
    return [Item(para_quem_usa(v[1]), (("GET", v[0]),) + tuple(extras.get(k, ())), exemplos.get(k))
            for k, v in consultas.items()]


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


def _acoes_talenths() -> list[Item]:
    itens = []
    for nome, a in te.ACOES.items():
        rotas: tuple[Rota, ...] = ((a.metodo, a.rota),)
        if nome == "criar_pdi":
            # O plano nasce sem ações e elas entram uma a uma (`acoes._executor_talenths`).
            rotas += (("POST", te.ACOES["acrescentar_acao_pdi"].rota),)
        itens.append(Item(para_quem_usa(a.desc), rotas, te.EXEMPLOS.get(nome)))
    return itens


def _acoes_de(sistema: str) -> list[Item]:
    return [i for (s, _), i in ACOES.items() if s == sistema]


def catalogo(sistema: str) -> tuple[list[Item], list[Item]]:
    """(consultar, fazer) de um sistema, na ordem dos catálogos."""
    if sistema == "taskhs":
        return list(TASKHS_CONSULTAS.values()), _acoes_de("taskhs")
    if sistema == "datacore":
        return _de_consultas(dc.CONSULTAS, dc.EXEMPLOS), []
    if sistema == "docshs":
        return _de_consultas(dh.CONSULTAS, dh.EXEMPLOS,
                             {k: _EU_DOCSHS for k in dh.CONSULTAS if dh.precisa_de_eu(k)}), []
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


def _saida(item: Item, **extra) -> dict:
    d = {"rotulo": item.rotulo}
    if item.exemplo:
        d["exemplo"] = item.exemplo
    return d | extra


def montar_sistema(sistema: str, estado: str, resposta: dict | None = None) -> dict:
    """Um sistema na resposta da rota. Só `ok` traz listas; nos outros estados
    as listas vêm VAZIAS — nunca o catálogo inteiro."""
    if estado not in ESTADOS:
        raise ValueError(f"estado desconhecido: {estado}")
    papel = None
    consultar: list[dict] = []
    fazer: list[dict] = []
    if estado == "ok":
        resposta = resposta if isinstance(resposta, dict) else {}
        p = resposta.get("papel")
        papel = str(p)[:80] if isinstance(p, (str, int)) and str(p).strip() else None
        permitidas = rotas_permitidas(resposta.get("rotas"))
        c, f = catalogo(sistema)
        consultar = [_saida(i) for i in c if permitido(i, permitidas)]
        fazer = [_saida(i, confirma=True) for i in f if permitido(i, permitidas)]
    return {"sistema": sistema, "nome": SISTEMAS.get(sistema, sistema), "papel": papel,
            "estado": estado, "consultar": consultar, "fazer": fazer}


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
    """Memória e agenda são de todo Guardi; e-mail só com `email_ligado`, e a
    agenda do Outlook só se a conta concedeu o calendário. Tudo aqui sai na
    hora, menos o e-mail para outras pessoas (cartão)."""
    def i(rotulo, exemplo=None, **extra):
        return {"rotulo": rotulo, **({"exemplo": exemplo} if exemplo else {}), **extra}

    grupos = [
        {"sistema": "memoria", "nome": "Memória", "papel": None, "estado": "ok",
         "consultar": [i("O que você pediu para ele lembrar", "o que você lembra sobre mim?")],
         "fazer": [i("Guardar uma preferência ou um jeito de fazer", "lembra que eu assino como Erick | TI",
                     confirma=False)]},
        {"sistema": "agenda", "nome": "Agenda e lembretes", "papel": None, "estado": "ok",
         "consultar": [i("Os seus lembretes", "quais lembretes eu tenho?")],
         "fazer": [i("Criar um lembrete, único ou de rotina", "me lembra amanhã às 9h de ligar para a Vale",
                     confirma=False),
                   i("Mudar ou apagar um lembrete", "muda o lembrete de sexta para as 10h", confirma=False)]},
    ]
    if email_ligado:
        consultar = [i("As suas caixas de e-mail", "de quais caixas você lê?"),
                     i("Listar e ler e-mails", "quais e-mails não lidos eu tenho?"),
                     i("Os e-mails que ele preparou e o que aconteceu com cada um")]
        if calendario:
            consultar.append(i("A sua agenda do Outlook", "o que eu tenho amanhã na agenda?"))
        grupos.append({"sistema": "email", "nome": "E-mail", "papel": None, "estado": "ok",
                       "consultar": consultar,
                       "fazer": [i("Preparar um e-mail para outras pessoas", "responde ao João dizendo que "
                                   "enviamos na sexta", confirma=True),
                                 i("Mandar um e-mail para você mesmo", "me manda esse resumo por e-mail",
                                   confirma=False),
                                 i("Marcar e-mails como lidos", "marca como lidos os e-mails do fulano",
                                   confirma=False)]})
    return grupos
