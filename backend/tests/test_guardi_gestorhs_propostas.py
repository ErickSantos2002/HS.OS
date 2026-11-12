"""Guardi no GestorHS, fase 2c (Serviços, 12/11/2026): proposta por cartão.

Spec `docs/superpowers/specs/2026-11-12-guardi-gestorhs-propostas-design.md`.
A pessoa conta o pedido do cliente; o Guardi monta a proposta pelo padrão da
casa e lembra o que fugiu dele. O que se tranca aqui:
- item só do catálogo, com o preço de lá: item inventado iria ao PDF do cliente;
- o total e o frete são do SERVIDOR, em `Decimal`, como o GestorHS calcula;
- lembrete não trava, e cliente sem UF vira "estado desconhecido", nunca um
  frete chutado;
- o `destinatario` nunca leva nada além de tipo e id: no GestorHS ele ESCREVE
  no cadastro do cliente e sincroniza com o Tiny;
- alterar manda a lista INTEIRA de itens e aparelhos (o `PUT` substitui) e não
  sobrescreve o `outros_itens` editado à mão na tela.
"""
from decimal import Decimal

import pytest

from app import gestorhs_propostas as gp

PADRAO = {"observacoes": "Caso…", "validade_dias": 30,
          "frete_por_regiao": {"Norte": 200, "Nordeste": 150, "Sul": 250, "Sudeste": 200, "Centro-Oeste": 200},
          "regiao_por_uf": {"PE": "Nordeste", "SP": "Sudeste"},
          "outros_itens": {"padrao": "<p>Serviços&nbsp;de Calibração</p>", "phoebus": "<p>PHOEBUS</p>"}}
CAT = [{"sku": "312", "nome": "CALIBRAÇÃO COM GÁS RASTREADO 2025", "preco": 395, "unidade": "UN"},
       {"sku": "306", "nome": "CALIBRAÇÃO COM GÁS RASTREADO - MÓDULO PHOEBUS 2025 (1)", "preco": 625.4, "unidade": "UN"}]


# --- regras puras -----------------------------------------------------------------

def test_item_so_do_catalogo_e_preco_do_catalogo():
    """Item inventado pelo modelo iria ao PDF do cliente com nome e preço de ninguém."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 3}], CAT)
    assert it[0]["preco_un"] == 395 and it[0]["descricao"].startswith("CALIBRAÇÃO")
    with pytest.raises(ValueError):
        gp.itens_do_pedido([{"sku": "999", "quantidade": 1}], CAT)
    with pytest.raises(ValueError):
        gp.itens_do_pedido([{"sku": "312", "quantidade": 0}], CAT)


def test_tetos_dos_itens():
    """Quantidade 1000 é dedo escorregando; preço negativo vira desconto escondido
    numa linha; 31 itens não cabem no cartão que a pessoa precisa ler inteiro."""
    for ruim in ([], [{"sku": "312", "quantidade": 1000}], [{"sku": "312", "quantidade": -1}],
                 [{"sku": "312", "quantidade": True}], [{"sku": "312", "quantidade": 1, "preco": -5}],
                 [{"sku": "312", "quantidade": 1}] * 31, "312", [{"quantidade": 1}]):
        with pytest.raises(ValueError):
            gp.itens_do_pedido(ruim, CAT)


def test_sku_ambiguo_no_catalogo_recusa_em_vez_de_chutar():
    """Serviço e produto podem repetir o sku: escolher um seria pôr no PDF o
    item que a pessoa não pediu. Recusa e manda perguntar."""
    cat = CAT + [{"sku": "312", "nome": "OUTRO ITEM", "preco": 10, "unidade": "UN"}]
    with pytest.raises(ValueError, match="pergunte"):
        gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], cat)


def test_preco_falado_vai_mas_marcado():
    it = gp.itens_do_pedido([{"sku": 312, "quantidade": 2, "preco": 350}], CAT)
    assert it[0]["preco_un"] == Decimal("350") and it[0]["preco_catalogo"] == Decimal("395")
    assert it[0]["sku"] == "312" and it[0]["unidade"] == "UN"


def test_phoebus_pela_descricao_do_catalogo():
    assert gp.eh_phoebus(gp.itens_do_pedido([{"sku": "306", "quantidade": 1}], CAT))
    assert not gp.eh_phoebus(gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], CAT))


def test_frete_pela_regiao_e_zero_no_phoebus():
    assert gp.frete_padrao(PADRAO, "PE", False) == Decimal("150")
    assert gp.frete_padrao(PADRAO, "SP", True) == Decimal("0")
    assert gp.frete_padrao(PADRAO, None, False) is None


def test_uf_fora_da_tabela_e_estado_desconhecido():
    """UF que a tabela não conhece (ou minúscula, ou com espaço) não pode virar
    um frete de outra região."""
    assert gp.frete_padrao(PADRAO, "pe ", False) == Decimal("150")
    assert gp.frete_padrao(PADRAO, "XX", False) is None
    assert gp.frete_padrao(PADRAO, "", False) is None


def test_total_igual_ao_do_gestorhs():
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 3}], CAT)
    assert gp.total(it, Decimal("150"), Decimal("0")) == Decimal("1335.00")
    it = gp.itens_do_pedido([{"sku": "306", "quantidade": 3}], CAT)
    assert gp.total(it, Decimal("0"), Decimal("10")) == Decimal("1866.20")    # em float: 1866.1999…


def test_outros_itens_do_modelo():
    assert gp.outros_itens_padrao(PADRAO, False) == PADRAO["outros_itens"]["padrao"]
    assert gp.outros_itens_padrao(PADRAO, True) == "<p>PHOEBUS</p>"


def test_lembretes_do_que_fugiu_do_padrao():
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1, "preco": 350}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=Decimal("150"), uf="PE",
                     desconto=Decimal("10"), pagamento="60 dias", pagamento_ultima="30 dias",
                     aparelhos_na_proposta=[1], frota_vencendo=[{"id": 2, "serie": "F2"}],
                     phoebus=False, outros_itens="", entrega_diferente=True)
    t = " | ".join(l)
    for trecho in ("catálogo", "retira", "desconto", "30 dias", "F2", "entrega"):
        assert trecho in t


def test_proposta_no_padrao_nao_tem_lembrete():
    """Lembrete demais vira ruído que ninguém lê — e aí o que importa passa."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], CAT)
    assert gp.lembretes(itens=it, frete=Decimal("150"), frete_tabela=Decimal("150"), uf="PE",
                        desconto=Decimal("0"), pagamento=None, pagamento_ultima=None,
                        aparelhos_na_proposta=[1], frota_vencendo=[{"id": 1, "serie": "F1"}],
                        phoebus=False, outros_itens="<p>x</p>", entrega_diferente=False) == []


def test_sem_uf_o_lembrete_e_estado_desconhecido():
    """Cliente sem estado no cadastro: o frete não pode ser chutado, e a pessoa
    precisa saber que ninguém conferiu."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=None, uf=None,
                     desconto=Decimal("0"), pagamento=None, pagamento_ultima=None,
                     aparelhos_na_proposta=[], frota_vencendo=[], phoebus=False,
                     outros_itens="", entrega_diferente=False)
    assert len(l) == 1 and "estado desconhecido" in l[0]


def test_phoebus_avisa_das_lacunas_e_nao_cobra_frete():
    it = gp.itens_do_pedido([{"sku": "306", "quantidade": 1}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=Decimal("0"), uf="PE",
                     desconto=Decimal("0"), pagamento=None, pagamento_ultima=None,
                     aparelhos_na_proposta=[], frota_vencendo=[], phoebus=True,
                     outros_itens="<li>R$ ____ (por unidade)</li><li>[Inserir número]</li>",
                     entrega_diferente=False)
    assert len(l) == 1 and "lacunas" in l[0] and "Phoebus" in l[0]


def test_texto_editado_na_tela_nao_e_do_modelo():
    assert gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p>", PADRAO)
    assert not gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p><p>combinado com o João</p>", PADRAO)


def test_texto_do_modelo_resiste_ao_que_o_editor_mexe():
    """O Quill troca espaço por `&nbsp;`, acrescenta parágrafo vazio e quebra
    linha entre tags: nada disso é edição de gente."""
    assert gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p>\n<p><br></p><p></p>", PADRAO)
    assert gp.texto_ainda_e_do_modelo("<p>PHOEBUS</p>", PADRAO)
    assert not gp.texto_ainda_e_do_modelo("", PADRAO)


# --- criar: a ferramenta, o cartão e o executor ----------------------------------

import asyncio  # noqa: E402
import json  # noqa: E402

import httpx  # noqa: E402
from cryptography.hazmat.primitives import serialization as s  # noqa: E402
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey  # noqa: E402

from app import acoes  # noqa: E402
from app import agente_token as at  # noqa: E402
from app import gestorhs_consultas as gh  # noqa: E402
from app.email.regras import FERRAMENTAS_BOT  # noqa: E402
from app.routers import mcp_bot  # noqa: E402
from app.routers.mcp_bot import FERRAMENTAS  # noqa: E402
from app.sistemas import gestorhs  # noqa: E402

_CTX = {"sistemas": ["gestorhs"], "email": "ellen@hs.com", "dono": "u-ellen", "primeiro": "Ellen"}
_CRIAR = {"destinatario": {"tipo": "cliente", "id": 7}, "itens": [{"sku": "312", "quantidade": 3}],
          "aparelhos": [70]}

_PROPOSTA_ANTIGA = {"id": 900, "numero": 1200, "cliente": 7, "empresa": None, "condicao_pagamento": "30 dias",
                    "is_deleted": False}


def _leituras():
    """GestorHS falso das leituras (caminho → resposta), com o contrato do
    `GET /propostas/padrao` pedido ao GestorHS (a rota ainda não existe lá)."""
    return {
        "/clientes/7": {"id": 7, "nome": "ACME Transportes", "estado": "PE", "ativo": True},
        "/clientes/8": {"id": 8, "nome": "Sem UF Ltda", "estado": None, "ativo": True},
        "/servicos": [CAT[0], CAT[1]],
        "/produtos": [{"sku": "P1", "nome": "BOCAL", "preco": 2, "unidade": "UN"}],
        "/equipamentos-cliente/70": {"id": 70, "cliente": 7, "equipamento_descricao": "Alcoolímetro X",
                                     "serie": "F1"},
        "/equipamentos-cliente/71": {"id": 71, "cliente": 99, "equipamento_descricao": "Alcoolímetro X",
                                     "serie": "F9"},
        "/equipamentos-cliente": {"items": [{"id": 72, "cliente": 7, "serie": "F2"}], "total": 1},
        "/propostas": {"items": [{"id": 901, "cliente": 7, "empresa": 3, "condicao_pagamento": "à vista"},
                                 _PROPOSTA_ANTIGA], "total": 2},
        "/propostas/padrao": PADRAO,
    }


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


@pytest.fixture
def gestor(chave, monkeypatch):
    """GestorHS falso + `criar_pendente` capturado. Escrita (não-GET) aqui é defeito."""
    estado = {"reqs": [], "pendentes": [], "leituras": _leituras()}

    def h(req):
        estado["reqs"].append(req)
        if req.method != "GET":
            return httpx.Response(500, json={"detail": "escrita antes do cartão"})
        if req.url.path in estado["leituras"]:
            resp = estado["leituras"][req.url.path]
            return httpx.Response(200, json=resp(req) if callable(resp) else resp)
        return httpx.Response(404, json={"detail": "não encontrado"})
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))

    async def pendente(conn, dono, bot, sistema, acao, payload, resumo):
        estado["pendentes"].append((sistema, acao, payload, resumo))
        return "a1"
    monkeypatch.setattr(mcp_bot.acoes, "criar_pendente", pendente)
    return estado


def _ferramenta(nome, args, ctx=_CTX):
    return asyncio.run(mcp_bot._gestorhs(object(), "ellen-bot", nome, args, ctx))


def test_ferramenta_de_criar_no_guardi():
    """Fora de `FERRAMENTAS_BOT`, o `toolFilter.include` não a lista e o Guardi
    nunca a vê — mesmo com o servidor respondendo."""
    assert "gestorhs_criar_proposta" in FERRAMENTAS_BOT
    assert "gestorhs_criar_proposta" in {f["name"] for f in FERRAMENTAS}
    assert ("gestorhs", "criar_proposta") in acoes.EXECUTORES


def test_catalogo_de_servicos_e_produtos_para_achar_o_sku():
    """Sem consultar o catálogo o agente não tem de onde tirar o `sku` — e
    inventaria um."""
    assert gh.caminho_da_consulta("servicos", None) == "/servicos"
    assert gh.caminho_da_consulta("produtos", None) == "/produtos"
    assert gh.params_da_consulta("servicos", {"q": "calibra"}) == [("q", "calibra")]


def test_criar_sem_gestorhs_recusa_sem_rede(gestor):
    with pytest.raises(mcp_bot._Recusa):
        _ferramenta("gestorhs_criar_proposta", _CRIAR, {**_CTX, "sistemas": ["taskhs"]})
    assert gestor["reqs"] == [] and gestor["pendentes"] == []


def test_cartao_tem_padrao_total_e_lembretes(gestor):
    """O padrão vem do GestorHS, o frete da região do estado do cliente (PE →
    Nordeste, 150) e o total do servidor; preparar só LÊ — escrever antes do
    clique criaria proposta que a pessoa nem viu."""
    t = _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "total": 1, "outros_itens": "<script>"})
    assert "Aguardando Ellen confirmar" in t
    sistema, acao, payload, resumo = gestor["pendentes"][0]
    assert (sistema, acao) == ("gestorhs", "criar_proposta")
    assert payload["frete"] == 150 and payload["desconto"] == 0
    assert payload["observacoes"] == PADRAO["observacoes"] and payload["validade_dias"] == 30
    assert payload["outros_itens"] == PADRAO["outros_itens"]["padrao"]       # nunca o do agente
    assert payload["destinatario"] == {"tipo": "cliente", "id": 7}
    assert payload["aparelhos"] == [{"equipamento_cliente": 70}]
    assert payload["itens"] == [{"descricao": CAT[0]["nome"], "sku": "312", "quantidade": 3.0,
                                 "unidade": "UN", "preco_un": 395.0}]
    ex = payload["_exibir"]
    assert ex["total"] == 1335.0 and ex["modelo"] == "padrão" and ex["uf"] == "PE"
    assert ex["cliente"] == "ACME Transportes" and ex["aparelhos"] == [{"modelo": "Alcoolímetro X", "serie": "F1"}]
    assert ex["itens"][0] == {"descricao": CAT[0]["nome"], "quantidade": 3.0, "preco_un": 395.0,
                              "total": 1185.0, "fora_do_catalogo": False}
    # O aparelho F2 (vencendo) ficou fora; o pagamento em branco difere da última (30 dias).
    assert any("F2" in l for l in ex["lembretes"]) and any("30 dias" in l for l in ex["lembretes"])
    assert resumo == "Nova proposta para ACME Transportes: 1 item, R$ 1.335,00"
    assert "F2" in t                                   # o agente lê os lembretes à pessoa
    assert all(q.method == "GET" for q in gestor["reqs"])
    padrao = next(q for q in gestor["reqs"] if q.url.path == "/propostas/padrao")
    assert padrao.url.params["modelos"] == "Alcoolímetro X" and padrao.url.params["series"] == "F1"


def test_sem_uf_o_frete_nao_e_chutado(gestor):
    """Cliente sem estado: frete 0 e o lembrete — nunca o de uma região qualquer."""
    _ferramenta("gestorhs_criar_proposta", {"destinatario": {"tipo": "cliente", "id": 8},
                                            "itens": [{"sku": "312", "quantidade": 1}]})
    payload = gestor["pendentes"][0][2]
    assert payload["frete"] == 0 and any("estado desconhecido" in l for l in payload["_exibir"]["lembretes"])


def test_phoebus_tem_frete_incluso_e_o_texto_do_modelo(gestor):
    _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "itens": [{"sku": "306", "quantidade": 1}]})
    payload = gestor["pendentes"][0][2]
    assert payload["frete"] == 0 and payload["outros_itens"] == "<p>PHOEBUS</p>"
    assert payload["_exibir"]["modelo"] == "Phoebus"


def test_aparelho_de_outro_cliente_recusa(gestor):
    """O GestorHS recusaria no clique ("fora da frota do cliente"), e o cartão
    teria mostrado a série de outra empresa na proposta desta."""
    with pytest.raises(ValueError, match="F9"):
        _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "aparelhos": [70, 71]})
    assert gestor["pendentes"] == []


def test_sku_inexistente_recusa_sem_cartao(gestor):
    """"Calibração" casando com dois itens: o agente pergunta; um sku chutado
    que não existe é recusado, nunca trocado pelo mais parecido."""
    with pytest.raises(ValueError, match="catálogo"):
        _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "itens": [{"sku": "31", "quantidade": 1}]})
    assert gestor["pendentes"] == []


def test_destinatario_so_tipo_e_id_e_validado_antes_da_rede(gestor):
    """No GestorHS o `destinatario` ESCREVE no cadastro e sincroniza com o Tiny:
    um `nome` mandado renomearia o cliente. Aqui ele nem chega a ser lido."""
    for ruim in ({"tipo": "nova_empresa", "id": 1}, {"tipo": "cliente"}, {"tipo": "cliente", "id": "7a"},
                 "ACME", None):
        with pytest.raises(ValueError):
            _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "destinatario": ruim})
    for ruim in ({"desconto": -1}, {"frete": "muito"}, {"condicao_pagamento": "x" * 101},
                 {"intro": "x" * 501}, {"data_entrega": "12/11/2026"}, {"aparelhos": ["F1"]}):
        with pytest.raises(ValueError):
            _ferramenta("gestorhs_criar_proposta", {**_CRIAR, **ruim})
    assert gestor["reqs"] == []
    _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "destinatario": {"tipo": "cliente", "id": 7,
                                                                       "nome": "Outro Nome"}})
    assert gestor["pendentes"][0][2]["destinatario"] == {"tipo": "cliente", "id": 7}


def test_endereco_de_entrega_vira_texto_e_lembrete(gestor):
    """A tela do GestorHS edita o endereço de entrega como `texto`: estruturado,
    o PDF sairia certo e a tela mostraria o campo vazio."""
    _ferramenta("gestorhs_criar_proposta", {**_CRIAR, "endereco_entrega": {
        "endereco": "Rua A", "numero": "10", "bairro": "Centro", "municipio": "Recife", "estado": "PE",
        "cep": "50000-000"}})
    p = gestor["pendentes"][0][2]
    assert p["endereco_entrega_diferente"] is True
    assert p["endereco_entrega"] == {"texto": "Rua A, 10\nBairro: Centro\nRecife/PE — CEP: 50000-000"}
    assert any("entrega" in l for l in p["_exibir"]["lembretes"])


def _servidor(monkeypatch, responder):
    reqs = []

    def h(req):
        reqs.append(req)
        return responder(req, len(reqs))
    monkeypatch.setattr(gestorhs, "_transporte", httpx.MockTransport(h))
    return reqs


def _executar(acao, p):
    return asyncio.run(acoes.EXECUTORES[("gestorhs", acao)]("ellen@hs.com", "ellen-bot", p))


def test_executor_cria_e_devolve_link(gestor, monkeypatch):
    """O corpo sai por lista fixa: `_exibir` e um destinatário adulterado no
    payload (com nome) não chegam ao GestorHS — o nome renomearia o cliente."""
    _ferramenta("gestorhs_criar_proposta", _CRIAR)
    p = gestor["pendentes"][0][2]
    p = {**p, "destinatario": {**p["destinatario"], "nome": "Renomeado"}, "vendedor": "Outro", "assinatura": "x"}
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(
        201, json={"id": 950, "numero": 1301, "link_pdf": "https://pdf/1301"}))
    r = _executar("criar_proposta", p)
    assert reqs[0].method == "POST" and reqs[0].url.path == "/propostas"
    corpo = json.loads(reqs[0].content)
    assert corpo["destinatario"] == {"tipo": "cliente", "id": 7}
    assert not {"_exibir", "vendedor", "assinatura"} & set(corpo)
    assert corpo["frete"] == 150 and corpo["aparelhos"] == [{"equipamento_cliente": 70}]
    assert r == "Proposta 1301 criada. PDF: https://pdf/1301"


def test_403_diz_quem_pode(chave, monkeypatch):
    """Guardi da Expedição pedindo proposta: a pessoa precisa saber que é a
    função dela, e quem pode, não "erro"."""
    _servidor(monkeypatch, lambda r, n: httpx.Response(403, json={}))
    with pytest.raises(gestorhs.ErroSistema) as e:
        _executar("criar_proposta", {"destinatario": {"tipo": "cliente", "id": 7}, "itens": []})
    assert "Comercial Pós-Vendas" in str(e.value)


def test_descricao_manda_nao_calcular_e_perguntar():
    d = next(f for f in FERRAMENTAS if f["name"] == "gestorhs_criar_proposta")["description"]
    assert "não calcule" in d and "pergunte" in d and "lembretes" in d and "NÃO executa" in d


# --- alterar ----------------------------------------------------------------------

def _proposta(**mudar):
    p = {"id": 500, "numero": 1234, "cliente": 7, "empresa": None, "cliente_nome": "ACME Transportes",
         "destinatario": {"tipo": "cliente", "id": 7, "nome": "ACME Transportes", "estado": "PE"},
         "itens": [{"id": 1, "descricao": CAT[0]["nome"], "sku": "312", "quantidade": 2, "unidade": "UN",
                    "preco_un": 395, "total": 790}],
         "aparelhos": [{"id": 11, "equipamento_cliente": 70, "serie": "F1", "modelo": "Alcoolímetro X"},
                       {"id": 12, "equipamento_cliente": 73, "serie": "F3", "modelo": "Alcoolímetro X"}],
         "frete": 150, "desconto": 0, "total": 940, "condicao_pagamento": "30 dias", "validade_dias": 30,
         "outros_itens": "<p>Aparelhos:&nbsp;F1, F3</p>", "faturada": False, "is_deleted": False}
    return {**p, **mudar}


def _padrao_por_serie(req):
    """O GestorHS monta o `outros_itens` com as séries pedidas: é isso que faz o
    texto do modelo antigo ser diferente do novo."""
    series = req.url.params.get("series", "")
    return {**PADRAO, "outros_itens": {"padrao": f"<p>Aparelhos: {series}</p>", "phoebus": "<p>PHOEBUS</p>"}}


@pytest.fixture
def com_proposta(gestor):
    gestor["leituras"]["/propostas/500"] = _proposta()
    gestor["leituras"]["/propostas/padrao"] = _padrao_por_serie
    return gestor


def test_ferramenta_de_alterar_no_guardi():
    assert "gestorhs_alterar_proposta" in FERRAMENTAS_BOT
    assert "gestorhs_alterar_proposta" in {f["name"] for f in FERRAMENTAS}
    assert ("gestorhs", "alterar_proposta") in acoes.EXECUTORES


def test_remover_aparelho_manda_a_lista_inteira_restante(com_proposta):
    """O `PUT` do GestorHS SUBSTITUI a lista: mandar só o removido (ou só o que
    fica, sem os outros) apagaria aparelhos da proposta do cliente. E o texto
    de outros itens, ainda o do modelo, é refeito com as séries que ficaram."""
    t = _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "remover_aparelhos": [73]})
    _s, acao, payload, resumo = com_proposta["pendentes"][0]
    assert acao == "alterar_proposta" and payload["proposta"] == 500
    corpo = payload["corpo"]
    assert corpo["aparelhos"] == [{"equipamento_cliente": 70}]
    assert corpo["outros_itens"] == "<p>Aparelhos: F1</p>"
    assert "itens" not in corpo and "destinatario" not in corpo and "frete" not in corpo
    ex = payload["_exibir"]
    assert ex["aparelhos_saem"] == ["Alcoolímetro X · série F3"] and ex["aparelhos_entram"] == []
    assert ex["numero"] == 1234 and ex["cliente"] == "ACME Transportes"
    assert ex["total_antes"] == 940 and ex["total_depois"] == 940
    assert resumo == "Alterar a proposta 1234 (ACME Transportes)"
    assert "Aguardando Ellen confirmar" in t
    assert all(q.method == "GET" for q in com_proposta["reqs"])


def test_trocar_itens_manda_a_lista_nova_e_mostra_o_total(com_proposta):
    _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "itens": [{"sku": "312", "quantidade": 3}],
                                              "condicao_pagamento": "60 dias"})
    payload = com_proposta["pendentes"][0][2]
    assert payload["corpo"]["itens"] == [{"descricao": CAT[0]["nome"], "sku": "312", "quantidade": 3.0,
                                          "unidade": "UN", "preco_un": 395.0}]
    assert payload["corpo"]["condicao_pagamento"] == "60 dias" and "aparelhos" not in payload["corpo"]
    ex = payload["_exibir"]
    assert ex["total_antes"] == 940 and ex["total_depois"] == 1335
    assert ["Pagamento", "30 dias", "60 dias"] in ex["mudancas"]
    assert ex["itens_entram"] == [f"3 × {CAT[0]['nome']} — R$ 395,00"]
    assert ex["itens_saem"] == [f"2 × {CAT[0]['nome']} — R$ 395,00"]


def test_adicionar_aparelho_de_outro_cliente_recusa(com_proposta):
    with pytest.raises(ValueError, match="F9"):
        _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "adicionar_aparelhos": [71]})
    with pytest.raises(ValueError, match="não está na proposta"):
        _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "remover_aparelhos": [70, 99]})
    assert com_proposta["pendentes"] == []


def test_faturada_e_desabilitada_recusam(com_proposta):
    """Desabilitada o GestorHS recusa no clique (409); faturada é assunto do
    Financeiro — mudar o valor dela desalinha a nota que já saiu."""
    com_proposta["leituras"]["/propostas/500"] = _proposta(faturada=True)
    with pytest.raises(mcp_bot._Recusa, match="faturada"):
        _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "condicao_pagamento": "60 dias"})
    com_proposta["leituras"]["/propostas/500"] = _proposta(is_deleted=True)
    with pytest.raises(mcp_bot._Recusa, match="desabilitada"):
        _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "condicao_pagamento": "60 dias"})
    assert com_proposta["pendentes"] == []


def test_texto_editado_nao_e_sobrescrito_e_vira_lembrete(com_proposta):
    """Alguém escreveu na tela o que combinou com o cliente: refazer pelo
    modelo apagaria isso do PDF sem ninguém ver."""
    com_proposta["leituras"]["/propostas/500"] = _proposta(
        outros_itens="<p>Aparelhos: F1, F3</p><p>combinado com o João: retirada na sexta</p>")
    _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "remover_aparelhos": [73]})
    payload = com_proposta["pendentes"][0][2]
    assert "outros_itens" not in payload["corpo"]
    assert any("editado na tela" in x for x in payload["_exibir"]["lembretes"])


def test_alteracao_nunca_leva_destinatario(com_proposta, monkeypatch):
    """Trocar o cliente é pela tela; e no `PUT` o `destinatario` reescreveria o
    cadastro. Nem o agente o manda, nem um payload adulterado o leva."""
    with pytest.raises(ValueError, match="tela"):
        _ferramenta("gestorhs_alterar_proposta", {"proposta": 500, "destinatario": {"tipo": "cliente", "id": 8}})
    reqs = _servidor(monkeypatch, lambda r, n: httpx.Response(
        200, json={"id": 500, "numero": 1234, "link_pdf": "https://pdf/1234"}))
    r = _executar("alterar_proposta", {"proposta": 500, "corpo": {
        "condicao_pagamento": "60 dias", "destinatario": {"tipo": "cliente", "id": 7, "nome": "X"},
        "vendedor": "Outro", "_exibir": {}}, "_exibir": {"numero": 1234}})
    assert reqs[0].method == "PUT" and reqs[0].url.path == "/propostas/500"
    assert json.loads(reqs[0].content) == {"condicao_pagamento": "60 dias"}
    assert r == "Proposta 1234 alterada (versão anterior guardada). PDF: https://pdf/1234"


def test_nada_a_alterar(com_proposta):
    """Cartão sem mudança gera uma versão nova no GestorHS a cada clique."""
    for args in ({"proposta": 500}, {"proposta": 500, "condicao_pagamento": "30 dias", "frete": 150}):
        with pytest.raises(mcp_bot._Recusa, match="Nada a alterar"):
            _ferramenta("gestorhs_alterar_proposta", args)
    assert com_proposta["pendentes"] == []


def test_alterar_403_diz_quem_pode(chave, monkeypatch):
    _servidor(monkeypatch, lambda r, n: httpx.Response(403, json={}))
    with pytest.raises(gestorhs.ErroSistema, match="Comercial Pós-Vendas"):
        _executar("alterar_proposta", {"proposta": 500, "corpo": {"frete": 0}})
