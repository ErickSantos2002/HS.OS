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
from app import capacidade_assuntos as ax
from app import talenths_escrita as te
from app.dependencies import Usuario
from app.routers import mcp_bot
from app.routers import meu_bot as rota
from app.sistemas import datacore, docshs, gestorhs, hsgrowth, talenths, taskhs

ANA = Usuario("u-ana", "ana@hs.com", "colaborador")
ADMIN = Usuario("u-admin", "ti@hs.com", "administrador")


def _ve(s):
    return [f for a in s["assuntos"] for f in a["ve"]]


def _faz(s):
    return [f for a in s["assuntos"] for f in a["faz"]]


def _assunto(s, chave):
    return next((a for a in s["assuntos"] if a["chave"] == chave), None)


def _todas_as_rotas(sistema):
    consultar, fazer = cap.catalogo(sistema)
    return [list(r) for i in list(consultar.values()) + list(fazer.values()) for r in i.rotas]


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
    assert "a fase e a caixa de cada OS" in _ve(s)
    assert "as caixas e a fase de cada uma" in _ve(s)
    assert "as OS" not in _ve(s)     # `/ordens` sem id não veio
    assert s["papel"] == "Comercial" and _faz(s) == []


def test_acao_com_varias_rotas_so_aparece_com_todas():
    """`hsgrowth_criar_lead` cria cliente, contato e card. Com só duas das três,
    o cartão pararia no meio e deixaria cliente e contato criados à toa."""
    duas = {"rotas": [["POST", "/clients"], ["POST", "/persons"]]}
    tres = {"rotas": duas["rotas"] + [["POST", "/cards"]]}
    assert "criar um lead novo" not in _faz(cap.montar_sistema("hsgrowth", "ok", duas))
    s = cap.montar_sistema("hsgrowth", "ok", tres)
    assert "criar um lead novo" in _faz(s)
    assert all(a["na_hora"] == [] for a in s["assuntos"])   # sistema externo: tudo vira cartão


def test_criar_pdi_exige_tambem_acrescentar_acao():
    """O PDI nasce sem ações e elas entram uma a uma: sem a segunda rota, o PDI
    sairia vazio e a pessoa veria "Parou na ação 1"."""
    so_plano = {"rotas": [["POST", "/pdi/plans"]]}
    com_acoes = {"rotas": [["POST", "/pdi/plans"], ["POST", "/pdi/plans/{plan_id}/actions"]]}
    assert "montar o PDI de alguém" not in _faz(cap.montar_sistema("talenths", "ok", so_plano))
    assert "montar o PDI de alguém" in _faz(cap.montar_sistema("talenths", "ok", com_acoes))


def test_talenths_user_x_rh():
    """A conferência da spec: o colaborador vê as próprias ausências e não vê
    "aprovar"; o RH vê "aprovar". Quem decide é a lista que o TalentHS devolve."""
    user = {"papel": "Colaborador", "rotas": [["GET", "/absences/my"], ["POST", "/absences/request"]]}
    rh = {"papel": "RH", "rotas": user["rotas"] + [["PUT", "/absences/{request_id}/approve"]]}
    u = _assunto(cap.montar_sistema("talenths", "ok", user), "ausencias")
    assert u["titulo"] == "Férias e ausências"
    assert u["ve"] == ["os seus pedidos de férias e ausência"]
    assert u["faz"] == ["pedir folga, férias ou ausência"]
    assert u["exemplos"] == ["quais ausências eu pedi?", "pede folga na terça"]
    r = _assunto(cap.montar_sistema("talenths", "ok", rh), "ausencias")
    assert "aprovar pedidos pendentes" in r["faz"]


def test_rotas_mal_formadas_nao_viram_permissao():
    resp = {"rotas": [["GET"], "GET /clientes/", ["GET", 3], None, ["GET", "/estoque/"]]}
    assert _ve(cap.montar_sistema("datacore", "ok", resp)) == ["os produtos em estoque, com quantidade e preço"]


@pytest.mark.parametrize("estado", ["sem_conta", "fora_do_ar", "sem_resposta_de_capacidade"])
def test_fora_do_ok_nunca_traz_a_lista(estado):
    """Anti-objetivo da spec: sistema que não respondeu NUNCA aparece com a lista
    completa — seria afirmar o que o login pode não fazer."""
    s = cap.montar_sistema("talenths", estado, {"rotas": [["GET", "/absences/my"]]})
    assert s["assuntos"] == [] and s["estado"] == estado


def test_estado_de_cada_erro():
    assert cap.estado_do_erro(401) == "sem_conta"
    for st in (0, None, 500, 502, 503):
        assert cap.estado_do_erro(st) == "fora_do_ar"
    for st in (404, 403, 422):
        assert cap.estado_do_erro(st) == "sem_resposta_de_capacidade"


# --- os assuntos ------------------------------------------------------------------

def test_todo_item_tem_assunto_ou_e_interno():
    """A primeira versão da tela listava as consultas cruas; esta agrupa por
    assunto com frase escrita à mão. O risco novo é o oposto: consulta ou ação
    nova no catálogo SEM entrada em `capacidade_assuntos` sumiria da tela em
    silêncio — o Guardi a faria e ninguém saberia. Toda chave tem que estar lá,
    com assunto ou com `INTERNO` de propósito; e chave que saiu do catálogo não
    pode sobrar lá."""
    for sistema in cap.SISTEMAS:
        consultar, fazer = cap.catalogo(sistema)
        assert set(consultar) == set(ax.VE[sistema]), (sistema, set(consultar) ^ set(ax.VE[sistema]))
        assert set(fazer) == set(ax.FAZ[sistema]), (sistema, set(fazer) ^ set(ax.FAZ[sistema]))
        assert all(w != ax.INTERNO for w in ax.FAZ[sistema].values()), sistema   # ação nunca é passo


def test_assuntos_bem_formados():
    """Assunto citado por item existe; assunto declarado tem item (senão nunca
    aparece e ninguém percebe); cor e ícone são os que a tela sabe desenhar
    (fora da lista, o front cai no cinza e o bloco perde o destaque); `requer`
    aponta para item INTERNO do mesmo sistema — nome errado esconderia o item."""
    grupos = [(s, ax.ASSUNTOS[s], {**ax.VE[s], **ax.FAZ[s]}, ax.VE[s]) for s in cap.SISTEMAS]
    grupos.append(("hsos", ax.HSOS, {**ax.HSOS_VE, **ax.HSOS_FAZ}, {}))
    for sistema, assuntos, mapa, ve in grupos:
        chaves = [a.chave for a in assuntos]
        assert len(chaves) == len(set(chaves)), sistema
        usados = {w.assunto for w in mapa.values() if w != ax.INTERNO}
        assert usados == set(chaves), (sistema, usados ^ set(chaves))
        assert len(assuntos) <= 9, sistema
        for a in assuntos:
            assert a.cor in ax.CORES and a.icone in ax.ICONES, (sistema, a)
            assert len(a.titulo) <= 28, a.titulo
        for w in mapa.values():
            if w == ax.INTERNO:
                continue
            for r in w.requer:
                assert ve.get(r) == ax.INTERNO, (sistema, r)


def test_frase_curta_para_quem_usa():
    """O feedback que gerou esta versão: frase escrita para o agente ("Uma
    pessoa pelo user_id", "`board_id` é OBRIGATÓRIO"). A frase da tela é curta,
    sem código, sem id, sem "seu dono", e começa minúscula (a tela a põe como
    chip ou lista corrida)."""
    mapas = [m for s in cap.SISTEMAS for m in (ax.VE[s], ax.FAZ[s])] + [ax.HSOS_VE, ax.HSOS_FAZ]
    for m in mapas:
        for w in m.values():
            if w == ax.INTERNO:
                continue
            f = w.frase
            assert len(f) <= 70, f
            assert "`" not in f and "dono" not in f and " id" not in f and "_" not in f, f
            assert f[0].islower(), f


def test_interno_some_mas_segue_valendo_como_requisito():
    """"Os ciclos de avaliação" é passo do agente: não aparece. Mas a avaliação
    pede `cycle_id`, que só sai dele — sem os ciclos liberados, "a sua avaliação"
    falharia no primeiro uso, então também não aparece."""
    so_ciclo = cap.montar_sistema("talenths", "ok", {"rotas": [["GET", "/evaluations/cycles"]]})
    assert so_ciclo["assuntos"] == []
    sem_ciclo = cap.montar_sistema("talenths", "ok", {"rotas": [["GET", "/evaluations/my"]]})
    assert sem_ciclo["assuntos"] == []
    com = cap.montar_sistema("talenths", "ok", {"rotas": [["GET", "/evaluations/my"],
                                                          ["GET", "/evaluations/cycles"]]})
    assert _ve(com) == ["a sua avaliação"]


def test_o_print_do_erick_vira_assuntos():
    """O TalentHS com tudo liberado saía com dezenas de linhas cruas. Agora são
    os nove assuntos, sem nenhum passo interno, e frase repetida (a lista e o
    "pelo id" dela) aparece uma vez só."""
    s = cap.montar_sistema("talenths", "ok", {"papel": "RH", "rotas": _todas_as_rotas("talenths")})
    assert [a["titulo"] for a in s["assuntos"]] == [a.titulo for a in ax.ASSUNTOS["talenths"]]
    ve = _ve(s)
    assert len(ve) == len(set(ve))
    for proibido in ("pelo user_id", "ciclos de metas", "tipos de ausência", "quem você é"):
        assert all(proibido not in f.lower() for f in ve), proibido
    for a in s["assuntos"]:
        assert 1 <= len(a["exemplos"]) <= 2, a["chave"]


def test_exemplo_so_de_item_liberado():
    """"Experimente: aprova as férias da Ana" para quem não pode aprovar seria a
    tela mandando a pessoa esbarrar num 403."""
    user = {"rotas": [["GET", "/absences/my"]]}
    a = _assunto(cap.montar_sistema("talenths", "ok", user), "ausencias")
    assert a["exemplos"] == ["quais ausências eu pedi?"] and a["faz"] == []


def test_todo_sistema_tem_assunto_com_tudo_liberado():
    """Com tudo liberado, todo assunto declarado aparece (nenhum `requer` com nome
    torto o esconde) e cada um tem ao menos um "Experimente: …" — o pedido do
    Erick era a pessoa entender o que dizer, não só o que existe."""
    for sistema in cap.SISTEMAS:
        s = cap.montar_sistema(sistema, "ok", {"rotas": _todas_as_rotas(sistema)})
        assert [a["chave"] for a in s["assuntos"]] == [a.chave for a in ax.ASSUNTOS[sistema]], sistema
        for a in s["assuntos"]:
            assert 1 <= len(a["exemplos"]) <= 2, (sistema, a["chave"])
    for a in _hsos(True, True)["assuntos"]:
        assert a["exemplos"], a["chave"]


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


def test_todo_item_tem_rota():
    for sistema in cap.SISTEMAS:
        consultar, fazer = cap.catalogo(sistema)
        assert consultar
        for i in list(consultar.values()) + list(fazer.values()):
            assert i.rotas, (sistema, i)
        assert all(m == "GET" for i in consultar.values() for m, _ in i.rotas)


def test_consultas_que_pedem_o_eu_exigem_a_rota_dele():
    """`meus_treinamentos` no DocsHS lê `/auth/eu` antes; sem ela permitida, a
    consulta falharia mesmo com o histórico liberado."""
    so_hist = {"rotas": [["GET", "/treinamentos/pessoas/{pessoa_id}/historico"]]}
    com_eu = {"rotas": so_hist["rotas"] + [["GET", "/auth/eu"]]}
    assert "o seu histórico de treinamentos" not in _ve(cap.montar_sistema("docshs", "ok", so_hist))
    assert "o seu histórico de treinamentos" in _ve(cap.montar_sistema("docshs", "ok", com_eu))


# --- o que é do HS.OS --------------------------------------------------------------

def _hsos(email, cal):
    [g] = cap.itens_do_hsos(email, cal)
    return g


def test_email_so_com_email_ligado():
    assert [a["chave"] for a in _hsos(False, True)["assuntos"]] == ["memoria", "lembretes"]
    assert [a["chave"] for a in _hsos(True, False)["assuntos"]] == ["memoria", "lembretes", "email"]
    assert [a["chave"] for a in _hsos(True, True)["assuntos"]] == ["memoria", "lembretes", "email", "outlook"]


def test_hsos_diz_o_que_sai_na_hora():
    """Só o e-mail para outras pessoas espera o clique; o resto sai na hora — e
    a tela precisa dizer qual é qual, senão a pessoa espera um cartão que não vem."""
    email = next(a for a in _hsos(True, False)["assuntos"] if a["chave"] == "email")
    assert "preparar e-mails para outras pessoas" in email["faz"]
    assert "preparar e-mails para outras pessoas" not in email["na_hora"]
    assert "mandar um e-mail para você mesmo" in email["na_hora"]
    lembretes = next(a for a in _hsos(False, False)["assuntos"] if a["chave"] == "lembretes")
    assert lembretes["na_hora"] == lembretes["faz"]


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
    assert _ve(r["talenths"]) == ["os seus pedidos de férias e ausência"]
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
    assert r["talenths"]["estado"] == "fora_do_ar" and r["talenths"]["assuntos"] == []
    assert r["gestorhs"]["estado"] == "ok"


def test_hsgrowth_uma_chamada_para_vendas_e_servicos(amb):
    amb["linha"]["sistemas_ligados"] = ["hsgrowth", "hsgrowth_servicos"]
    amb["respostas"]["hsgrowth"] = httpx.Response(200, json={"papel": "service", "rotas": [
        ["GET", "/service-boards/{board_id}/cards"], ["GET", "/card-tasks"], ["GET", "/users/me"]]})
    r = _por(asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA)))
    assert amb["pedidos"] == [("hsgrowth", "GET", "/agente/capacidades")]
    assert _ve(r["hsgrowth"]) == ["as suas tarefas"]
    assert _ve(r["hsgrowth_servicos"]) == ["os cards de Serviços e de Cobrança"]


def test_sistema_nao_ligado_nem_e_chamado(amb):
    amb["linha"]["sistemas_ligados"] = []
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert r["sistemas"] == [] and amb["pedidos"] == []
    assert [a["chave"] for g in r["no_hsos"] for a in g["assuntos"]] == ["memoria", "lembretes"]


def test_email_na_rota_so_com_email_ligado(amb):
    amb["linha"]["sistemas_ligados"] = []
    amb["calendario"] = True
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert "email" not in [a["chave"] for a in r["no_hsos"][0]["assuntos"]]
    amb["linha"]["email_ligado"] = True
    r = asyncio.run(rota.capacidade_do_guardi("ana-bot", usuario=ANA))
    assert [a["chave"] for a in r["no_hsos"][0]["assuntos"]][-2:] == ["email", "outlook"]


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
