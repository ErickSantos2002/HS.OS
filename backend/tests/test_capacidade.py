"""A "Capacidade" do Guardi: o que ele alcança com o login do dono (13/11/2026).

Spec `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`. Quem diz
o que o login pode é cada sistema (`GET /agente/capacidades`); aqui só se cruza a
resposta com os nossos catálogos. Os defeitos que estes testes trancam têm todos
a mesma cara: **a tela prometer o que o login não faz** — a pessoa pede, o
Guardi esbarra num 403 e ela acha que ele quebrou.
"""
import asyncio

import httpx
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey
from fastapi import HTTPException

from app import acoes
from app import agente_token as at
from app import capacidade as cap
from app import talenths_escrita as te
from app.dependencies import Usuario
from app.routers import mcp_bot
from app.routers import meu_bot as rota
from app.sistemas import datacore, docshs, gestorhs, hsgrowth, talenths, taskhs

ANA = Usuario("u-ana", "ana@hs.com", "colaborador")
ADMIN = Usuario("u-admin", "ti@hs.com", "administrador")


def _nomes(itens):
    return [i["rotulo"] for i in itens]


# --- o casamento das rotas -------------------------------------------------------

def test_nome_do_parametro_nao_conta():
    """O catálogo daqui diz `/clientes/{cliente_id}` (GestorHS) ou `/clientes/{id}`
    (DataCore); o allowlist de lá pode dizer outro nome. Comparar o texto cru
    esconderia a consulta de quem PODE usá-la — o erro inverso, mas silencioso."""
    assert cap.chave_da_rota("get", "/clientes/{id}") == cap.chave_da_rota("GET", "/clientes/{cliente_id}")
    assert cap.chave_da_rota("GET", "/clientes/") == cap.chave_da_rota("GET", "/clientes")
    assert cap.chave_da_rota("GET", "/api/v1/documentos") == cap.chave_da_rota("GET", "/documentos")
    # Mas literal diferente e método diferente são outra rota.
    assert cap.chave_da_rota("GET", "/clientes/{id}") != cap.chave_da_rota("GET", "/clientes/novo")
    assert cap.chave_da_rota("GET", "/clientes") != cap.chave_da_rota("POST", "/clientes")


def test_consulta_com_parametro_de_outro_nome_aparece():
    resp = {"papel": "Comercial", "rotas": [["GET", "/ordens/{id}"], ["GET", "/caixas"]]}
    s = cap.montar_sistema("gestorhs", "ok", resp)
    assert "Uma OS pelo id (traz a caixa em que está)" in _nomes(s["consultar"])
    assert "As caixas" in _nomes(s["consultar"])
    assert "As OS" not in _nomes(s["consultar"])     # `/ordens` sem id não veio
    assert s["papel"] == "Comercial" and s["fazer"] == []


def test_acao_com_varias_rotas_so_aparece_com_todas():
    """`hsgrowth_criar_lead` cria cliente, contato e card. Com só duas das três,
    o cartão pararia no meio e deixaria cliente e contato criados à toa."""
    duas = {"rotas": [["POST", "/clients"], ["POST", "/persons"]]}
    tres = {"rotas": duas["rotas"] + [["POST", "/cards"]]}
    assert "Criar um lead novo" not in _nomes(cap.montar_sistema("hsgrowth", "ok", duas)["fazer"])
    feito = cap.montar_sistema("hsgrowth", "ok", tres)["fazer"]
    assert "Criar um lead novo" in _nomes(feito) and all(i["confirma"] for i in feito)


def test_criar_pdi_exige_tambem_acrescentar_acao():
    """O PDI nasce sem ações e elas entram uma a uma: sem a segunda rota, o PDI
    sairia vazio e a pessoa veria "Parou na ação 1"."""
    so_plano = {"rotas": [["POST", "/pdi/plans"]]}
    com_acoes = {"rotas": [["POST", "/pdi/plans"], ["POST", "/pdi/plans/{plan_id}/actions"]]}
    assert "Montar o PDI de uma pessoa, com as ações" not in _nomes(cap.montar_sistema("talenths", "ok", so_plano)["fazer"])
    assert "Montar o PDI de uma pessoa, com as ações" in _nomes(cap.montar_sistema("talenths", "ok", com_acoes)["fazer"])


def test_talenths_user_x_rh():
    """A conferência da spec: o colaborador vê as próprias ausências e não vê
    "aprovar"; o RH vê "aprovar". Quem decide é a lista que o TalentHS devolve."""
    user = {"papel": "Colaborador", "rotas": [["GET", "/absences/my"], ["POST", "/absences/request"]]}
    rh = {"papel": "RH", "rotas": user["rotas"] + [["PUT", "/absences/{request_id}/approve"]]}
    u = cap.montar_sistema("talenths", "ok", user)
    assert "Os seus pedidos de férias e ausência, com a situação de cada um" in _nomes(u["consultar"])
    assert any(i.get("exemplo") == "quais ausências eu pedi?" for i in u["consultar"])
    assert "Aprovar pedidos de ausência pendentes" not in _nomes(u["fazer"])
    assert "Aprovar pedidos de ausência pendentes" in _nomes(cap.montar_sistema("talenths", "ok", rh)["fazer"])


def test_rotas_mal_formadas_nao_viram_permissao():
    resp = {"rotas": [["GET"], "GET /clientes/", ["GET", 3], None, ["GET", "/estoque/"]]}
    assert _nomes(cap.montar_sistema("datacore", "ok", resp)["consultar"]) == ["Produtos em estoque, com quantidade e preço"]


@pytest.mark.parametrize("estado", ["sem_conta", "fora_do_ar", "sem_resposta_de_capacidade"])
def test_fora_do_ok_nunca_traz_a_lista(estado):
    """Anti-objetivo da spec: sistema que não respondeu NUNCA aparece com a lista
    completa — seria afirmar o que o login pode não fazer."""
    s = cap.montar_sistema("talenths", estado, {"rotas": [["GET", "/absences/my"]]})
    assert s["consultar"] == [] and s["fazer"] == [] and s["estado"] == estado


def test_estado_de_cada_erro():
    assert cap.estado_do_erro(401) == "sem_conta"
    for st in (0, None, 500, 502, 503):
        assert cap.estado_do_erro(st) == "fora_do_ar"
    for st in (404, 403, 422):
        assert cap.estado_do_erro(st) == "sem_resposta_de_capacidade"


# --- os catálogos -----------------------------------------------------------------

def test_toda_acao_que_executa_tem_capacidade():
    """Ação nova em `acoes.EXECUTORES` sem entrada aqui some da tela sem aviso —
    e a pessoa nunca descobre que o Guardi a faz. O inverso (entrada sem
    executor) promete o que não existe."""
    externas = {k for k in acoes.EXECUTORES if k[0] != "talenths"}
    assert set(cap.ACOES) == externas
    assert {f"talenths_{a}" for a in te.ACOES} == {a for s, a in acoes.EXECUTORES if s == "talenths"}


def test_toda_leitura_do_taskhs_tem_capacidade():
    leituras = {n for n in mcp_bot.NOMES if n.startswith("taskhs_")} - {
        "taskhs_comentar", "taskhs_mover", "taskhs_criar", "taskhs_atualizar", "taskhs_membros"}
    assert set(cap.TASKHS_CONSULTAS) == leituras


def test_exemplos_so_de_itens_que_existem():
    from app import (datacore_consultas, docshs_consultas, gestorhs_consultas, hsgrowth_consultas,
                     hsgrowth_servicos_consultas, talenths_consultas)
    for m in (datacore_consultas, docshs_consultas, gestorhs_consultas, hsgrowth_consultas,
              hsgrowth_servicos_consultas, talenths_consultas):
        assert set(m.EXEMPLOS) <= set(m.CONSULTAS), m.__name__
    assert set(te.EXEMPLOS) <= set(te.ACOES)


def test_todo_item_tem_rota_e_rotulo():
    for sistema in cap.SISTEMAS:
        consultar, fazer = cap.catalogo(sistema)
        assert consultar
        for i in consultar + fazer:
            assert i.rotulo and i.rotas, (sistema, i)
            assert "`" not in i.rotulo and "seu dono" not in i.rotulo, i.rotulo
        assert all(m == "GET" for i in consultar for m, _ in i.rotas)


def test_rotulo_fala_com_quem_usa():
    assert cap.para_quem_usa("as batidas de hoje do seu dono e o resumo do dia") == \
        "As suas batidas de hoje e o resumo do dia"
    assert cap.para_quem_usa("os cards do dono (como vendedor ou SDR) em um quadro. `board_id` é "
                             "OBRIGATÓRIO") == "Os seus cards (como vendedor ou SDR) em um quadro"
    assert cap.para_quem_usa("quem o seu dono é no DocsHS (nome, papel)") == "Quem você é no DocsHS (nome, papel)"


def test_consultas_que_pedem_o_eu_exigem_a_rota_dele():
    """`meus_treinamentos` no DocsHS lê `/auth/eu` antes; sem ela permitida, a
    consulta falharia mesmo com o histórico liberado."""
    so_hist = {"rotas": [["GET", "/treinamentos/pessoas/{pessoa_id}/historico"]]}
    com_eu = {"rotas": so_hist["rotas"] + [["GET", "/auth/eu"]]}
    assert "O seu histórico de treinamentos" not in _nomes(cap.montar_sistema("docshs", "ok", so_hist)["consultar"])
    assert "O seu histórico de treinamentos" in _nomes(cap.montar_sistema("docshs", "ok", com_eu)["consultar"])


# --- o que é do HS.OS --------------------------------------------------------------

def test_email_so_com_email_ligado():
    assert [g["sistema"] for g in cap.itens_do_hsos(False, True)] == ["memoria", "agenda"]
    com = cap.itens_do_hsos(True, False)
    email = next(g for g in com if g["sistema"] == "email")
    assert "A sua agenda do Outlook" not in _nomes(email["consultar"])
    email_cal = next(g for g in cap.itens_do_hsos(True, True) if g["sistema"] == "email")
    assert "A sua agenda do Outlook" in _nomes(email_cal["consultar"])
    # Só o e-mail para outras pessoas espera o clique; o resto sai na hora.
    assert {i["rotulo"]: i["confirma"] for i in email["fazer"]}["Preparar um e-mail para outras pessoas"] is True


# --- a rota -------------------------------------------------------------------------

class Conn:
    def __init__(self, linhas):
        self.linhas = linhas

    async def fetchrow(self, sql, agent_id, dono):
        return self.linhas.get((agent_id, dono))

    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False


@pytest.fixture
def amb(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    for nome in ("TASKHS_API_URL", "DATACORE_API_URL", "DOCSHS_URL", "GESTORHS_API_URL",
                 "HSGROWTH_API_URL", "TALENTHS_API_URL"):
        monkeypatch.setattr(at.settings, nome, f"https://{nome.lower()}.teste")

    async def sem_auditoria(*a):
        return None
    monkeypatch.setattr(taskhs, "_registrar", sem_auditoria)

    estado = {"linha": {"agent_id": "ana-bot", "sistemas_ligados": ["talenths", "gestorhs"],
                        "email_ligado": False, "email": "ana@hs.com"},
              "calendario": False, "pedidos": [], "respostas": {}}
    monkeypatch.setattr(rota, "sessao", lambda **kw: Conn({("ana-bot", "u-ana"): estado["linha"]}))

    async def calendario(conn, uid):
        return estado["calendario"]
    monkeypatch.setattr(rota, "tem_calendario", calendario)

    def transporte(sistema):
        async def h(req):
            estado["pedidos"].append((sistema, req.method, req.url.path))
            r = estado["respostas"].get(sistema, httpx.Response(404, json={"detail": "Not Found"}))
            return r(req) if callable(r) else r
        return httpx.MockTransport(h)
    for nome, mod in (("taskhs", taskhs), ("datacore", datacore), ("docshs", docshs), ("gestorhs", gestorhs),
                      ("hsgrowth", hsgrowth), ("talenths", talenths)):
        monkeypatch.setattr(mod, "_transporte", transporte(nome))
    rota._cache_capacidade.clear()
    return estado


def _por(r):
    return {s["sistema"]: s for s in r["sistemas"]}


def test_so_o_dono_ve(amb):
    """A resposta descreve as permissões de UMA pessoa nos sistemas dela: nem o
    administrador a vê — e recebe 404, não 403 ("existe, mas não é seu")."""
    for quem in (ADMIN, Usuario("u-beto", "beto@hs.com", "colaborador")):
        with pytest.raises(HTTPException) as e:
            asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=quem))
        assert e.value.status_code == 404
    assert amb["pedidos"] == []      # nenhuma chamada saiu em nome da Ana


def test_cada_sistema_com_o_seu_estado(amb):
    """Um sistema fora do ar não derruba os outros; o que ainda não tem a rota
    nova aparece sem lista; o 401 é "sem conta"."""
    amb["linha"]["sistemas_ligados"] = ["talenths", "gestorhs", "docshs", "datacore", "taskhs"]
    amb["respostas"] = {
        "talenths": httpx.Response(200, json={"papel": "Colaborador", "rotas": [["GET", "/absences/my"]]}),
        "gestorhs": httpx.Response(503, json={}),
        "docshs": httpx.Response(401, json={}),
        # datacore: 404 (padrão) — ainda sem /agente/capacidades
        "taskhs": httpx.Response(200, json={"oi": 1}),     # fora do contrato
    }
    r = _por(asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA)))
    assert r["talenths"]["estado"] == "ok" and r["talenths"]["papel"] == "Colaborador"
    assert _nomes(r["talenths"]["consultar"]) == ["Os seus pedidos de férias e ausência, com a situação de cada um"]
    assert r["gestorhs"]["estado"] == "fora_do_ar"
    assert r["docshs"]["estado"] == "sem_conta"
    assert r["datacore"]["estado"] == "sem_resposta_de_capacidade"
    assert r["taskhs"]["estado"] == "sem_resposta_de_capacidade"
    # Uma chamada por sistema, sempre GET na rota do contrato (o DocsHS mora atrás de /api/v1).
    assert sorted(amb["pedidos"]) == sorted([
        ("talenths", "GET", "/agente/capacidades"), ("gestorhs", "GET", "/agente/capacidades"),
        ("docshs", "GET", "/api/v1/agente/capacidades"), ("datacore", "GET", "/agente/capacidades"),
        ("taskhs", "GET", "/agente/capacidades")])


def test_timeout_e_fora_do_ar(amb, monkeypatch):
    monkeypatch.setattr(rota, "TIMEOUT_CAPACIDADE", 0.05)

    async def lento(req):
        await asyncio.sleep(1)
        return httpx.Response(200, json={"rotas": []})
    monkeypatch.setattr(talenths, "_transporte", httpx.MockTransport(lento))
    amb["respostas"]["gestorhs"] = httpx.Response(200, json={"papel": "Expedição", "rotas": [["GET", "/caixas"]]})
    r = _por(asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA)))
    assert r["talenths"]["estado"] == "fora_do_ar" and r["talenths"]["consultar"] == []
    assert r["gestorhs"]["estado"] == "ok"


def test_hsgrowth_uma_chamada_para_vendas_e_servicos(amb):
    amb["linha"]["sistemas_ligados"] = ["hsgrowth", "hsgrowth_servicos"]
    amb["respostas"]["hsgrowth"] = httpx.Response(200, json={"papel": "service", "rotas": [
        ["GET", "/service-boards/{board_id}/cards"], ["GET", "/card-tasks"], ["GET", "/users/me"]]})
    r = _por(asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA)))
    assert amb["pedidos"] == [("hsgrowth", "GET", "/agente/capacidades")]
    assert _nomes(r["hsgrowth"]["consultar"]) == ["As suas tarefas"]
    assert _nomes(r["hsgrowth_servicos"]["consultar"]) == ["Os cards de um quadro"]


def test_sistema_nao_ligado_nem_e_chamado(amb):
    amb["linha"]["sistemas_ligados"] = []
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert r["sistemas"] == [] and amb["pedidos"] == []
    assert [g["sistema"] for g in r["no_hsos"]] == ["memoria", "agenda"]


def test_email_na_rota_so_com_email_ligado(amb):
    amb["linha"]["sistemas_ligados"] = []
    amb["calendario"] = True
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert "email" not in [g["sistema"] for g in r["no_hsos"]]
    amb["linha"]["email_ligado"] = True
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    email = next(g for g in r["no_hsos"] if g["sistema"] == "email")
    assert "A sua agenda do Outlook" in _nomes(email["consultar"])


def test_cache_atualizar_e_invalidacao(amb, monkeypatch):
    """5 min de cache por Guardi; "atualizar" ignora. ⚠️ `sistemas_ligados` muda
    por SCRIPT, noutro processo — sem a chave do estado no cache, quem acabou de
    ganhar o GestorHS ficaria 5 min sem vê-lo na tela."""
    agora = [1000.0]
    monkeypatch.setattr(rota, "_relogio", lambda: agora[0])
    amb["linha"]["sistemas_ligados"] = ["talenths"]
    amb["respostas"]["talenths"] = httpx.Response(200, json={"rotas": [["GET", "/absences/my"]]})

    def n():
        return len(amb["pedidos"])
    asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert n() == 1
    agora[0] += 60
    asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert n() == 1                                    # do cache
    asyncio.run(rota.capacidade_do_guardi("ana-bot", atualizar=True, usuario=ANA))
    assert n() == 2                                    # o botão "atualizar"
    amb["linha"]["sistemas_ligados"] = ["talenths", "gestorhs"]
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert n() == 4 and "gestorhs" in _por(r)          # mudou o que está ligado: refaz
    amb["linha"]["email_ligado"] = True
    asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert n() == 6                                    # e-mail ligado também refaz
    agora[0] += 301
    asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert n() == 8                                    # venceu os 5 min
