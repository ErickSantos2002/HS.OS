"""Guardi no HSGrowth, Serviços e Cobrança (12/11/2026): leitura. Spec
`docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`."""
import asyncio

import httpx
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import agente_token as at
from app import hsgrowth_servicos_consultas as hs
from app.sistemas import hsgrowth

_CTX = {"sistemas": ["hsgrowth_servicos"], "email": "ana@hs.com", "dono": None, "primeiro": "Ana"}


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


def _roteia(monkeypatch, rotas):
    """Transporte que responde por caminho (`callable` recebe a requisição)."""
    chamadas = []

    def h(req):
        chamadas.append(req)
        resp = rotas.get(req.url.path.removeprefix("/api/v1"))
        if resp is None:
            return httpx.Response(404, json={"detail": "x"})
        return httpx.Response(200, json=resp(req) if callable(resp) else resp)
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    return chamadas


def _consultar(consulta, **kw):
    from app.routers import mcp_bot
    return asyncio.run(mcp_bot._hsgrowth_servicos(None, "ana-bot", "hsgrowth_servicos_consultar",
                                                  {"consulta": consulta, **kw}, dict(_CTX)))


def test_ferramentas_de_leitura_de_servicos_no_guardi():
    """`FERRAMENTAS_BOT` alimenta o `toolFilter`: fora dela a ferramenta existe
    no servidor e o Guardi nunca a vê."""
    from app.email.regras import FERRAMENTAS_BOT
    from app.routers import mcp_bot
    nomes = {"hsgrowth_servicos_consultas", "hsgrowth_servicos_consultar"}
    assert nomes <= set(FERRAMENTAS_BOT) and nomes <= {f["name"] for f in mcp_bot.FERRAMENTAS}


def test_sem_servicos_ligado_recusa_sem_rede(chave, monkeypatch):
    """Quem só tem Vendas ligado não pode ler Serviços: o 401 de lá diria
    "sem conta" quando o que falta é ligar. Nada sai para a rede."""
    from app.routers import mcp_bot
    chamadas = _roteia(monkeypatch, {})
    ctx = {**_CTX, "sistemas": ["hsgrowth"]}
    for nome in ("hsgrowth_servicos_consultas", "hsgrowth_servicos_consultar"):
        with pytest.raises(mcp_bot._Recusa, match=r"HSGrowth \(Serviços\) ainda não está ligado"):
            asyncio.run(mcp_bot._hsgrowth_servicos(None, "ana-bot", nome,
                                                   {"consulta": "quadros"}, ctx))
    assert chamadas == []


def test_servicos_nao_e_roteado_para_vendas(chave, monkeypatch):
    """`hsgrowth_servicos_*` começa com `hsgrowth_`: se o despacho de Vendas vier
    antes, a ferramenta cairia no handler errado e recusaria "Vendas não ligado"."""
    from app.routers import mcp_bot
    _roteia(monkeypatch, {"/service-boards": {"boards": [{"id": 1}], "total": 1}})

    async def roda():
        async def ctx_(conn, agent):
            return dict(_CTX)
        monkeypatch.setattr(mcp_bot, "_contexto", ctx_)

        class _S:
            async def __aenter__(self):
                return None

            async def __aexit__(self, *a):
                return False
        monkeypatch.setattr(mcp_bot, "sessao", lambda **k: _S())
        return await mcp_bot.executar("ana-bot", "hsgrowth_servicos_consultar", {"consulta": "quadros"})
    texto, erro = asyncio.run(roda())
    assert erro is False and "HSGrowth" in texto


def test_quadro_fora_de_1_e_2_recusa(chave, monkeypatch):
    """Os quadros de Vendas moram noutra pilha; um `board_id` 3 levaria o token
    do dono a um quadro fora do escopo da spec. Recusa antes da rede."""
    chamadas = _roteia(monkeypatch, {})
    for b in (3, 0, "2/../x", True, None):
        with pytest.raises(ValueError):
            _consultar("cards", board_id=b)
    with pytest.raises(ValueError):
        _consultar("painel", parametros={"board": 7})
    assert chamadas == []


def _card(i, **kw):
    return {"id": i, "list_id": 10, "title": f"C{i}", "pending_status": "none",
            "is_stuck_3d": False, "is_stuck_7d": False, "business_info": {}, "collaborators": [], **kw}


def test_cards_filtra_etapa_pendencia_parado_cobranca_localmente(chave, monkeypatch):
    """Os filtros não existem no HSGrowth: se fossem à query seriam ignorados e o
    agente leria o quadro inteiro achando que é o recorte pedido. E nenhum deles
    pode ir à rede."""
    cards = [_card(1, list_id=10, pending_status="overdue", is_stuck_3d=True,
                   business_info={"collection_type": "atrasados"}),
             _card(2, list_id=11, pending_status="overdue", is_stuck_3d=True,
                   business_info={"collection_type": "atrasados"}),
             _card(3, list_id=10, pending_status="today", is_stuck_3d=True,
                   business_info={"collection_type": "atrasados"}),
             _card(4, list_id=10, pending_status="overdue", is_stuck_3d=False,
                   business_info={"collection_type": "atrasados"}),
             _card(5, list_id=10, pending_status="overdue", is_stuck_3d=True,
                   business_info={"collection_type": "a_vencer"})]
    chamadas = _roteia(monkeypatch, {"/service-boards/2/cards": {"cards": cards, "total": 5, "total_pages": 1}})
    t = _consultar("cards", board_id=2, parametros={"etapa": 10, "pendencia": "overdue",
                                                     "parado": "3d", "cobranca": "atrasados"})
    assert '"id":1,' in t and '"id":2,' not in t and '"id":3,' not in t
    assert '"id":4,' not in t and '"id":5,' not in t
    q = dict(chamadas[0].url.params)
    assert not ({"etapa", "pendencia", "parado", "cobranca"} & set(q))
    assert q["page_size"] == "500" and "/servicos/2/cards/1" in t


def test_cards_colaborador_eu_usa_o_id_de_users_me(chave, monkeypatch):
    """`colaborador=eu` compara com o `/users/me` do dono, nunca com número vindo
    do agente: senão ele leria o trabalho de outra pessoa."""
    cards = [_card(1, collaborators=[{"id": 3, "name": "A"}]), _card(2, collaborators=[{"id": 4, "name": "B"}])]
    _roteia(monkeypatch, {"/users/me": {"id": 3}, "/service-boards/1/cards": {"cards": cards, "total_pages": 1}})
    t = _consultar("cards", board_id=1, parametros={"colaborador": "eu"})
    assert '"id":1,' in t and '"id":2,' not in t
    with pytest.raises(ValueError):
        _consultar("cards", board_id=1, parametros={"colaborador": "4"})


def test_cards_le_ate_quatro_paginas(chave, monkeypatch):
    """Sem teto, um quadro de milhares de cards prenderia o worker; e cortar sem
    avisar faria o agente tomar 2.000 cards por todos. O corte vem dito no texto."""
    def pagina(req):
        p = int(req.url.params["page"])
        return {"cards": [_card(p * 1000 + i) for i in range(500)], "total": 2500, "page": p,
                "page_size": 500, "total_pages": 5}
    chamadas = _roteia(monkeypatch, {"/service-boards/1/cards": pagina})
    t = _consultar("cards", board_id=1)
    assert [r.url.params["page"] for r in chamadas] == ["1", "2", "3", "4"]
    assert "2.500" in t or "2500" in t
    assert "aviso" in t and t.index("aviso") < t.index('"cards"')


def test_pendencias_minhas_corta_pelo_eu(chave, monkeypatch):
    """`/service-activities` devolve de TODOS os usuários: sem o corte local,
    `minhas=true` listaria a agenda da equipe inteira como se fosse do dono."""
    ativ = [{"id": 1, "service_card_id": 7, "board_id": 1, "user_id": 3, "title": "ligar"},
            {"id": 2, "service_card_id": 8, "board_id": 1, "user_id": 4, "title": "outra"},
            {"id": 3, "service_card_id": 9, "board_id": 5, "user_id": 3, "title": "fora"}]
    chamadas = _roteia(monkeypatch, {"/users/me": {"id": 3}, "/service-activities": {"activities": ativ}})
    t = _consultar("pendencias", parametros={"minhas": True})
    assert "ligar" in t and "outra" not in t and "fora" not in t
    q = dict(chamadas[-1].url.params)
    assert q["status"] == "pending" and "minhas" not in q
    assert "/servicos/1/cards/7" in t


def test_link_do_card_de_servico_e_do_servidor():
    """O agente entrega o `link` à pessoa; o do HSGrowth é campo livre. O do
    servidor aponta o front de Serviços (`/servicos/<quadro>/cards/<id>`)."""
    r = hs.com_links("card", {"id": 7, "link": "https://evil"}, "https://hs.x", 2)
    assert r["link"] == "https://hs.x/servicos/2/cards/7"
    r = hs.com_links("cards", {"cards": [{"id": 8, "link": "https://evil"}, {"id": "../x", "link": "https://evil"}]},
                     "https://hs.x", 1)
    assert r["cards"][0]["link"] == "https://hs.x/servicos/1/cards/8" and "link" not in r["cards"][1]


def test_buscar_devolve_so_servico(chave, monkeypatch):
    """O `/search/global` mistura Vendas e Serviços; entregar a parte de Vendas
    abriria cards de funil que esta ferramenta não cobre (e sem o link certo)."""
    _roteia(monkeypatch, {"/search/global": {
        "vendas": [{"id": 1, "title": "venda-secreta", "board_id": 1}],
        "servico": [{"id": 5, "title": "OS bafometro", "board_id": 2}]}})
    t = _consultar("buscar", parametros={"q": "bafo"})
    assert "OS bafometro" in t and "venda-secreta" not in t and "/servicos/2/cards/5" in t


def test_card_junta_produtos_e_servicos(chave, monkeypatch):
    """O card, os aparelhos e os serviços são três rotas; a pessoa pergunta "o
    que tem no card 7" e a resposta precisa vir num objeto só."""
    chamadas = _roteia(monkeypatch, {
        "/service-boards/1/cards/7": {"id": 7, "title": "X", "list_id": 3},
        "/service-boards/1/cards/7/products": {"items": [{"product_name": "Bafometro"}], "total": 10},
        "/service-boards/1/cards/7/services": {"items": [{"name": "Calibracao"}], "total": 20}})
    t = _consultar("card", board_id=1, id="7")
    assert "Bafometro" in t and "Calibracao" in t and "/servicos/1/cards/7" in t
    assert len(chamadas) == 3


def test_quadros_so_1_e_2():
    """A lista de quadros mostraria quadros de que o Guardi não trata."""
    r = hs.filtrar_local("quadros", {"boards": [{"id": 1}, {"id": 2}, {"id": 9}], "total": 3}, {}, None)
    assert [b["id"] for b in r["boards"]] == [1, 2]


def test_filtro_local_em_formato_inesperado_falha_fechado():
    """Formato novo na resposta não pode virar "sem filtro": o recorte do dono
    é a única tranca da `pendencias`."""
    with pytest.raises(ValueError, match="inesperada"):
        hs.filtrar_local("pendencias", {"outra": []}, {"minhas": "true"}, 3)
    with pytest.raises(ValueError, match="inesperada"):
        hs.filtrar_local("cards", [1, 2], {}, None)


# --- ligar só para `service` + ponteiro no AGENTS.md ---------------------------------

def _publicador():
    import importlib.util
    import pathlib
    caminho = pathlib.Path(__file__).resolve().parents[1] / "scripts" / "publicar-bots-mcp.py"
    spec = importlib.util.spec_from_file_location("publicar_bots_mcp_hgs", caminho)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_ligar_servicos_so_liga_service(capsys):
    """Ligar Serviços para vendedor, gerente ou admin entregaria ferramentas de
    escrita nos quadros 1 e 2 a quem não opera lá; o teste usa o `_so_servicos`
    REAL do script, porque um lambda no teste não pega regra errada no script."""
    pub = _publicador()
    from tests.test_guardi_hsgrowth import _ConnFalsa, _ModuloFalso
    linhas = [{"agent_id": "ana-bot", "email": "ana@x"}, {"agent_id": "bia-bot", "email": "bia@x"},
              {"agent_id": "cai-bot", "email": "cai@x"}, {"agent_id": "dan-bot", "email": "dan@x"}]
    mod = _ModuloFalso({"ana@x": {"role": "service"}, "bia@x": {"role": "salesperson"},
                        "cai@x": None, "dan@x": {"role": "service"}})
    conn = _ConnFalsa(linhas)
    asyncio.run(pub._ligar_quem_tem_conta(
        conn, "hsgrowth_servicos", mod, "/users/me", True, aceita=pub._so_servicos))
    assert conn.gravou == (["ana-bot", "dan-bot"], "hsgrowth_servicos")
    assert "HSGrowth (Serviços)" in capsys.readouterr().out


def test_agents_md_aponta_servicos_e_cabe_no_teto():
    """Sem o ponteiro o Guardi de Serviços diria "só consigo consultar"; e o
    AGENTS.md é cortado em silêncio no teto de 20.000 caracteres, com o bloco
    `hsos:empresa` de ~4.000 anexado pelo onboarding."""
    from app.bots_pessoais import arquivos_do_bot
    from app.gateway.client import TETO_ARQUIVO_AGENTE
    a = arquivos_do_bot({"full_name": "Ellen Souza", "email": "ellen@hs.com"})["AGENTS.md"]
    for nome in ("hsgrowth_servicos_consultas", "hsgrowth_servicos_registrar",
                 "hsgrowth_servicos_itens", "hsgrowth_servicos_anexar_proposta"):
        assert nome in a
    assert len(a + "\n" + "x" * 4000) <= TETO_ARQUIVO_AGENTE
