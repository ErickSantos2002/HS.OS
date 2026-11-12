"""Guardi no HSGrowth: preparar a escrita em cartão (12/11/2026).

As seis ferramentas de escrita só LEEM o HSGrowth, conferem e gravam um cartão
(`acoes.criar_pendente`); nada vai ao CRM antes do clique do vendedor. Cada teste
tranca um defeito que faria o cartão prometer o que lá seria recusado — ou, pior,
o que lá seria aceito sem dever (card de colega, lead fora do Lead Novo, ganho
por movimento). Os de ida e volta (`test_ida_e_volta_*`) passam o payload
preparado ao executor real: é onde produtor e executor provam que concordam.
"""
import asyncio
import json

import httpx
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import acoes
from app import agente_token as at
from app.routers import mcp_bot
from app.sistemas import hsgrowth

_CTX = {"sistemas": ["hsgrowth"], "email": "ana@hs.com", "dono": "u-ana", "primeiro": "Ana"}
EU = 3

CARD = {
    "id": 7, "title": "ACME — bafômetros", "list_id": 71, "board_id": 7, "list_name": "Reunião Agendada",
    "assigned_to_id": EU, "sdr_id": None, "assigned_to_name": "Ana", "client_id": 44, "client_name": "ACME",
    "person_id": 55, "person_name": "João", "is_won": False, "is_lost": False, "modality": "venda",
    "value": 1000.0, "acquisition_channel": "Indicação", "acquisition_channel_detail": None,
    "pending_tasks": [{"id": 12, "title": "Reunião de diagnóstico", "task_type": "meeting",
                       "due_date": "2026-11-13T13:00:00"},
                      {"id": 13, "title": "Ligar para o João", "task_type": "call"}],
}
ETAPAS_7 = [{"id": 71, "board_id": 7, "name": "Reunião Agendada", "position": 0},
            {"id": 72, "board_id": 7, "name": "Qualificação", "position": 1},
            {"id": 73, "board_id": 7, "name": "Diagnóstico e Proposta", "position": 2},
            {"id": 78, "board_id": 7, "name": "Negócio Perdido", "position": 8, "is_lost_stage": True},
            {"id": 79, "board_id": 7, "name": "Negócio Ganho", "position": 9, "is_done_stage": True}]
ETAPAS_6 = [{"id": 60, "board_id": 6, "name": "Prospecção", "position": 1},
            {"id": 61, "board_id": 6, "name": " Lead Novo ", "position": 0}]


@pytest.fixture
def crm(monkeypatch):
    """HSGrowth falso (só GET responde; escrita antes do cartão é defeito) e
    `criar_pendente` capturado."""
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    estado = {"reqs": [], "pendentes": [], "rotas": {
        "/users/me": {"id": EU, "role": "salesperson"},
        "/cards/7/expanded": CARD,
        "/boards/7/lists": ETAPAS_7,
        "/boards/6/lists": ETAPAS_6,
        "/fields/definitions/board/7": [{"id": 3, "name": "Segmento", "board_id": 7}],
        "/clients/44": {"id": 44, "name": "ACME", "sector": "Mineração", "relationship_type": "Lead",
                        "document": "12345678000190"},
        "/persons": {"persons": [{"id": 55, "name": "João", "email": "joao@acme.com",
                                  "position": None, "organization_id": 44}]},
        "/clients": {"clients": []},
        "/search/global": {"vendas": [], "servico": []},
    }}

    def h(req):
        caminho = req.url.path.removeprefix("/api/v1")
        estado["reqs"].append((req.method, caminho, dict(req.url.params)))
        if req.method != "GET":
            return httpx.Response(500, json={"detail": "escrita antes do cartão"})
        r = estado["rotas"].get(caminho)
        if r is None:
            return httpx.Response(404, json={"detail": "não encontrado"})
        return httpx.Response(200, json=r)
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))

    async def pendente(conn, dono, bot, sistema, acao, payload, resumo):
        assert (sistema, acao) in acoes.EXECUTORES
        estado["pendentes"].append((sistema, acao, payload, resumo))
        return "a1"
    monkeypatch.setattr(mcp_bot.acoes, "criar_pendente", pendente)
    return estado


def _ferramenta(nome, args):
    return asyncio.run(mcp_bot._hsgrowth(object(), "ana-bot", nome, args, dict(_CTX)))


def _sem_escrita(crm):
    assert all(m == "GET" for m, _c, _p in crm["reqs"]), crm["reqs"]


def _executar(monkeypatch, acao, payload, respostas=None):
    """Roda o EXECUTOR real sobre o payload preparado; devolve as requisições."""
    reqs = []
    respostas = respostas or {}

    def h(req):
        caminho = req.url.path.removeprefix("/api/v1")
        reqs.append((req.method, caminho, json.loads(req.content) if req.content else None))
        return httpx.Response(200, json=respostas.get((req.method, caminho), {"id": 1}))
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    asyncio.run(acoes.EXECUTORES[("hsgrowth", acao)]("ana@hs.com", "ana-bot", payload, "u-ana"))
    return reqs


# ── ferramentas ──────────────────────────────────────────────────────────────

def test_ferramentas_de_escrita_no_guardi_e_no_servidor():
    """Fora de `FERRAMENTAS_BOT` o `toolFilter.include` não as lista e o Guardi
    promete o pós-ligação sem ter como prepará-lo."""
    from app.email.regras import FERRAMENTAS_BOT
    nomes = ("hsgrowth_registrar", "hsgrowth_cliente", "hsgrowth_criar_lead", "hsgrowth_ganhar",
             "hsgrowth_perder", "hsgrowth_noshow")
    for n in nomes:
        assert n in FERRAMENTAS_BOT
        f = next(f for f in mcp_bot.FERRAMENTAS if f["name"] == n)
        assert mcp_bot._CONFIRMA in f["description"]
        assert "nunca preencha com valor provável" in f["description"]


def test_sem_hsgrowth_ligado_escrita_recusa_sem_rede(crm):
    """Guardi sem o sistema ligado não pode nem preparar cartão."""
    ctx = {**_CTX, "sistemas": ["taskhs"]}
    with pytest.raises(mcp_bot._Recusa, match="não está ligado"):
        asyncio.run(mcp_bot._hsgrowth(object(), "ana-bot", "hsgrowth_ganhar", {"card_id": 7}, ctx))
    assert crm["reqs"] == [] and crm["pendentes"] == []


# ── registrar ────────────────────────────────────────────────────────────────

def test_registrar_grava_um_cartao_com_as_quatro_partes(crm):
    """O pós-ligação ("liguei, retorno quinta, passa para Qualificação") tem que
    virar UM cartão com tudo; nenhuma escrita sai antes do clique."""
    out = _ferramenta("hsgrowth_registrar", {
        "card_id": 7, "campos": {"value": 2500}, "nota": "Ligou, pediu retorno quinta.",
        "tarefas": [{"op": "criar", "title": "Retornar", "task_type": "call",
                     "due_date": "2026-11-19T10:00"},
                    {"op": "concluir", "task_id": 13, "valida": True}],
        "mover_para": 72})
    _sem_escrita(crm)
    assert len(crm["pendentes"]) == 1
    sistema, acao, p, resumo = crm["pendentes"][0]
    assert (sistema, acao) == ("hsgrowth", "hsgrowth_registrar")
    assert p["card_id"] == 7 and p["campos"] == {"value": 2500}
    assert p["nota"] == "Ligou, pediu retorno quinta."
    assert p["tarefas"] == [{"op": "criar", "title": "Retornar", "task_type": "call", "priority": "normal",
                             "due_date": "2026-11-19T13:00:00Z"},
                            {"op": "concluir", "task_id": 13, "valida": True}]
    assert p["mover_para"] == 72
    ex = p["_exibir"]
    assert ex["link"] == "https://hsgrowth.healthsafetytech.com/cards/7"
    assert ex["etapa_para"] == "Qualificação" and ex["antes"] == {"value": 1000.0}
    assert "\n" not in resumo and "Qualificação" in resumo and "ACME" in resumo
    assert "não diga que foi feito" in out


def test_card_de_outro_vendedor_recusa_antes_do_cartao(crm):
    """O HSGrowth não confere dono em nota, tarefa e campo: sem a trava daqui, o
    Guardi do vendedor escreveria no card do colega."""
    crm["rotas"]["/cards/7/expanded"] = {**CARD, "assigned_to_id": 9, "assigned_to_name": "Bruno"}
    for nome, args in (("hsgrowth_registrar", {"card_id": 7, "nota": "oi"}),
                       ("hsgrowth_ganhar", {"card_id": 7}),
                       ("hsgrowth_perder", {"card_id": 7, "motivo": "preço"}),
                       ("hsgrowth_noshow", {"card_id": 7, "task_id": 12}),
                       ("hsgrowth_cliente", {"card_id": 7, "cliente": {"sector": "Mineração"}})):
        with pytest.raises(ValueError, match="Bruno"):
            _ferramenta(nome, args)
    assert crm["pendentes"] == []
    _sem_escrita(crm)


def test_mover_para_ganho_manda_usar_ganhar(crm):
    """Um `/move` cru para Negócio Ganho/Perdido pula modalidade e motivo."""
    for destino in (79, 78):
        with pytest.raises(ValueError, match="hsgrowth_ganhar"):
            _ferramenta("hsgrowth_registrar", {"card_id": 7, "mover_para": destino})
    assert crm["pendentes"] == []


def test_registrar_sem_nada_recusa(crm):
    """Cartão vazio seria um clique que não faz nada e parece ter feito."""
    with pytest.raises(mcp_bot._Recusa, match="Diga o que registrar"):
        _ferramenta("hsgrowth_registrar", {"card_id": 7})
    assert crm["reqs"] == []


def test_concluir_tarefa_que_nao_e_do_card_recusa(crm):
    """Id de tarefa de outro card (ou já concluída) seria concluído no clique."""
    with pytest.raises(ValueError, match="não é deste card"):
        _ferramenta("hsgrowth_registrar", {"card_id": 7, "tarefas": [
            {"op": "concluir", "task_id": 999, "valida": True}]})


def test_detalhe_do_canal_sozinho_confere_com_o_canal_do_card(crm):
    """Sem o canal atual, "Inbound - SEO" passaria num card de Indicação e o
    HSGrowth gravaria um detalhe que não é do canal."""
    with pytest.raises(ValueError, match="Indicação - Cliente"):
        _ferramenta("hsgrowth_registrar", {"card_id": 7, "campos": {
            "acquisition_channel_detail": "Inbound - SEO"}})
    _ferramenta("hsgrowth_registrar", {"card_id": 7, "campos": {
        "acquisition_channel_detail": "Indicação - Cliente"}})
    assert crm["pendentes"][0][2]["campos"] == {"acquisition_channel_detail": "Indicação - Cliente"}


def test_campo_personalizado_le_as_definicoes_do_quadro(crm):
    """Id inventado criaria lixo no card; o nome vira o id da definição real."""
    _ferramenta("hsgrowth_registrar", {"card_id": 7, "campos_personalizados": [
        {"campo": "segmento", "value": "Mineração"}]})
    p = crm["pendentes"][0][2]
    assert p["campos_personalizados"] == [{"field_definition_id": 3, "value": "Mineração"}]
    assert ("GET", "/fields/definitions/board/7", {}) in crm["reqs"]


# ── cliente ──────────────────────────────────────────────────────────────────

def test_cliente_mostra_antes_e_depois(crm):
    """Cliente é compartilhado entre vendedores: o cartão tem que mostrar o que
    havia antes, senão o vendedor sobrescreve sem ver. Os ids saem do card, nunca
    do agente."""
    _ferramenta("hsgrowth_cliente", {"card_id": 7, "cliente": {"sector": "Frigoríficos"},
                                     "contato": {"position": "Comprador"}})
    _sem_escrita(crm)
    _s, acao, p, _r = crm["pendentes"][0]
    assert acao == "hsgrowth_cliente"
    assert p["cliente"] == {"id": 44, "campos": {"sector": "Frigoríficos"}}
    assert p["contato"] == {"id": 55, "campos": {"position": "Comprador"}}
    assert p["_exibir"]["antes"] == {"cliente": {"sector": "Mineração"}, "contato": {"position": None}}
    assert p["_exibir"]["depois"] == {"cliente": {"sector": "Frigoríficos"},
                                      "contato": {"position": "Comprador"}}


def test_cliente_nao_deixa_de_ser_cliente_pelo_cadastro_real(crm):
    """Com `atual` vazio a regra "Cliente não volta atrás" passaria sempre."""
    crm["rotas"]["/clients/44"] = {**crm["rotas"]["/clients/44"], "relationship_type": "Cliente"}
    with pytest.raises(ValueError, match="Cliente não deixa"):
        _ferramenta("hsgrowth_cliente", {"card_id": 7, "cliente": {"relationship_type": "Prospect"}})


def test_cliente_de_card_fechado_recusa(crm):
    """Cliente ligado só a card ganho/perdido não é mais "do" vendedor."""
    crm["rotas"]["/cards/7/expanded"] = {**CARD, "is_won": True}
    with pytest.raises(ValueError, match="card aberto"):
        _ferramenta("hsgrowth_cliente", {"card_id": 7, "cliente": {"sector": "Mineração"}})


# ── lead ─────────────────────────────────────────────────────────────────────

_LEAD = {"titulo": "Beta — locação", "cliente": {"document": "12.345.678/0001-90", "name": "Beta",
                                                 "sector": "Mineração", "relationship_type": "Lead"},
         "contato": {"name": "Maria", "email": "maria@beta.com"}, "list_id": 999}


def test_lead_vai_para_lead_novo(crm):
    """Vendedor só cria card no Lead Novo (fora dele, 403 no clique). O id vem de
    `/boards/6/lists`, nunca do agente."""
    _ferramenta("hsgrowth_criar_lead", _LEAD)
    _sem_escrita(crm)
    _s, acao, p, _r = crm["pendentes"][0]
    assert acao == "hsgrowth_criar_lead" and p["list_id"] == 61
    assert p["cliente"] == {"campos": {"document": "12345678000190", "name": "Beta",
                                       "sector": "Mineração", "relationship_type": "Lead"}}
    assert p["contato"] == {"campos": {"name": "Maria", "email": "maria@beta.com"}}
    assert p["_exibir"]["cliente_existente"] is False


def test_lead_com_cnpj_existente_usa_o_cliente(crm):
    """Documento repetido dá 400 no clique; e criar outro cliente separaria o
    histórico. A busca é por dígitos e confere o documento exato."""
    crm["rotas"]["/clients"] = {"clients": [{"id": 43, "name": "Outra", "document": "11111111000111"},
                                            {"id": 44, "name": "Beta", "document": "12.345.678/0001-90"}]}
    crm["rotas"]["/search/global"] = {"vendas": [
        {"id": 80, "title": "Beta antigo", "assigned_to_name": "Bruno", "is_won": False, "is_lost": False},
        {"id": 81, "title": "Beta 2024", "assigned_to_name": "Ana", "is_won": True, "is_lost": False}]}
    crm["rotas"]["/cards/80/aviso-parcerias"] = []
    crm["rotas"]["/cards/81/aviso-parcerias"] = []
    _ferramenta("hsgrowth_criar_lead", _LEAD)
    p = crm["pendentes"][0][2]
    assert p["cliente"] == {"id": 44}
    assert ("GET", "/clients", {"search": "12345678000190", "page_size": "100"}) in crm["reqs"]
    ex = p["_exibir"]
    assert ex["cliente_existente"] is True and ex["cards_abertos"] == 1 and ex["donos"] == ["Bruno"]


def test_lead_de_cnpj_de_parceiro_recusa(crm):
    """CNPJ com parceiro dá 409 no clique; aqui recusa antes, com o nome dele."""
    crm["rotas"]["/clients"] = {"clients": [{"id": 44, "name": "Beta", "document": "12345678000190"}]}
    crm["rotas"]["/search/global"] = {"vendas": [{"id": 80, "title": "Beta", "is_won": False,
                                                  "is_lost": False}]}
    crm["rotas"]["/cards/80/aviso-parcerias"] = [{"parceiro": "Parceira X", "desde": "2026-01-02"}]
    with pytest.raises(mcp_bot._Recusa, match="Parceira X"):
        _ferramenta("hsgrowth_criar_lead", _LEAD)
    assert crm["pendentes"] == []


def test_lead_novo_exige_setor_e_relacionamento_e_contato_alcancavel(crm):
    """Cliente sem setor/relacionamento ou contato sem e-mail nem telefone é
    recusado lá depois de o cliente já ter sido criado — o lote pararia no meio."""
    sem_setor = {**_LEAD, "cliente": {k: v for k, v in _LEAD["cliente"].items() if k != "sector"}}
    with pytest.raises(mcp_bot._Recusa, match="sector"):
        _ferramenta("hsgrowth_criar_lead", sem_setor)
    with pytest.raises(mcp_bot._Recusa, match="e-mail ou telefone"):
        _ferramenta("hsgrowth_criar_lead", {**_LEAD, "contato": {"name": "Maria"}})


# ── ganhar, perder, no-show ──────────────────────────────────────────────────

def test_ganhar_perder_e_noshow_preparam_o_cartao(crm):
    """Os três têm rota própria; o payload leva só o que o executor usa."""
    _ferramenta("hsgrowth_ganhar", {"card_id": 7})
    _ferramenta("hsgrowth_perder", {"card_id": 7, "motivo": " Preço "})
    _ferramenta("hsgrowth_noshow", {"card_id": 7, "task_id": 12})
    acoes_ = [(a, {k: v for k, v in p.items() if k != "_exibir"}) for _s, a, p, _r in crm["pendentes"]]
    assert acoes_ == [("hsgrowth_ganhar", {"card_id": 7}),
                      ("hsgrowth_perder", {"card_id": 7, "motivo": "Preço"}),
                      ("hsgrowth_noshow", {"card_id": 7, "task_id": 12})]
    _sem_escrita(crm)


def test_ganhar_sem_modalidade_ou_fora_da_aquisicao_recusa(crm):
    """Ganho sem modalidade é recusado lá; na Prospecção não existe Negócio Ganho."""
    crm["rotas"]["/cards/7/expanded"] = {**CARD, "modality": None}
    with pytest.raises(ValueError, match="venda ou locação"):
        _ferramenta("hsgrowth_ganhar", {"card_id": 7})
    crm["rotas"]["/cards/7/expanded"] = {**CARD, "board_id": 6, "list_id": 60}
    with pytest.raises(mcp_bot._Recusa, match="Negócio Ganho"):
        _ferramenta("hsgrowth_ganhar", {"card_id": 7})


def test_noshow_so_para_reuniao_pendente_do_card(crm):
    """No-show numa ligação, ou numa reunião de outro card, rodaria a automação
    que devolve o card para Reagendamento."""
    with pytest.raises(ValueError, match="só para reunião"):
        _ferramenta("hsgrowth_noshow", {"card_id": 7, "task_id": 13})
    with pytest.raises(mcp_bot._Recusa, match="pendentes deste card"):
        _ferramenta("hsgrowth_noshow", {"card_id": 7, "task_id": 99})


# ── ida e volta: o payload preparado no executor real ────────────────────────

def test_ida_e_volta_registrar_leva_valida_false_ao_hsgrowth(crm, monkeypatch):
    """Se o produtor gravasse `aconteceu` e o executor lesse `valida`, toda
    conclusão travaria no clique (ou, pior, sairia como realizada)."""
    _ferramenta("hsgrowth_registrar", {"card_id": 7, "tarefas": [
        {"op": "concluir", "task_id": 13, "valida": False},
        {"op": "criar", "title": "Tentar de novo", "task_type": "call", "duration_minutes": 15,
         "due_date": "2026-11-19T10:00"}]})
    reqs = _executar(monkeypatch, "hsgrowth_registrar", crm["pendentes"][0][2])
    assert reqs == [
        ("PATCH", "/card-tasks/13/complete", {"is_completed": True, "is_valid": False}),
        ("POST", "/card-tasks", {"card_id": 7, "title": "Tentar de novo", "task_type": "call",
                                 "priority": "normal", "due_date": "2026-11-19T13:00:00Z",
                                 "duration_minutes": 15})]


def test_ida_e_volta_lead_cria_cliente_contato_e_card(crm, monkeypatch):
    """O executor lê `cliente.campos`/`contato.campos`/`list_id`: nome trocado de
    um lado deixaria o lead sem cliente ou fora do Lead Novo."""
    _ferramenta("hsgrowth_criar_lead", {**_LEAD, "campos_do_card": {"modality": "locacao"}})
    reqs = _executar(monkeypatch, "hsgrowth_criar_lead", crm["pendentes"][0][2], {
        ("POST", "/clients"): {"id": 500}, ("POST", "/persons"): {"id": 501},
        ("POST", "/cards"): {"id": 502}})
    assert reqs == [
        ("POST", "/clients", {"document": "12345678000190", "name": "Beta", "sector": "Mineração",
                              "relationship_type": "Lead"}),
        ("POST", "/persons", {"name": "Maria", "email": "maria@beta.com", "organization_id": 500}),
        ("POST", "/cards", {"modality": "locacao", "title": "Beta — locação", "list_id": 61,
                            "client_id": 500, "person_id": 501})]


def test_ida_e_volta_cliente_leva_os_campos_aos_ids_do_card(crm, monkeypatch):
    """Produtor e executor concordando em `{id, campos}` é o que faz o PUT cair
    no cliente e no contato do card, e não em outro."""
    _ferramenta("hsgrowth_cliente", {"card_id": 7, "cliente": {"employee_count": "51-100 colaboradores"},
                                     "contato": {"area": "Manutenção"}})
    reqs = _executar(monkeypatch, "hsgrowth_cliente", crm["pendentes"][0][2])
    assert reqs == [("PUT", "/clients/44", {"employee_count": "51-100 colaboradores"}),
                    ("PUT", "/persons/55", {"area": "Manutenção"})]
