"""Guardi no HSGrowth (12/11/2026): cliente com token de agente e catálogo de
leitura. Spec `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`."""
import asyncio

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import agente_token as at
from app import hsgrowth_consultas as hg
from app.sistemas import hsgrowth
from app.sistemas.taskhs import ErroSistema


@pytest.fixture
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)
    return k


# --- o cliente ------------------------------------------------------------------

def test_chama_a_api_com_aud_hsgrowth(chave, monkeypatch):
    """Token com `aud` errado o HSGrowth recusa com 401 e a pessoa leria "sem
    conta lá". E a URL tem que ser a da API (`growthhsapi`, com `/api/v1`): o
    front devolveria o HTML da SPA com 200."""
    reqs = []

    def h(req):
        reqs.append(req)
        return httpx.Response(200, json={"id": 5})
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    assert asyncio.run(hsgrowth.chamar("ana@hs.com", "ana-bot", "/cards/5/expanded")) == {"id": 5}
    r = reqs[0]
    assert str(r.url) == "https://growthhsapi.healthsafetytech.com/api/v1/cards/5/expanded"
    token = r.headers["authorization"].removeprefix("Bearer ")
    d = jwt.decode(token, at.chave_publica_pem(), algorithms=["EdDSA"], audience="hsgrowth")
    assert d["sub"] == "ana@hs.com" and d["act"] == {"sub": "ana-bot"}


def test_403_na_leitura_e_na_escrita_dizem_coisas_diferentes(chave, monkeypatch):
    """Na escrita, 403 é a FUNÇÃO do dono; a mensagem de leitura mandaria a
    pessoa pedir um acesso que ela já tem (e vice-versa)."""
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(lambda r: httpx.Response(403, json={})))
    with pytest.raises(ErroSistema) as le:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards/1/expanded"))
    with pytest.raises(ErroSistema) as es:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards", metodo="POST", json={}))
    assert "ver" in str(le.value)
    assert "o HSGrowth não deixa a sua função fazer isso" in str(es.value)


def test_409_repassa_o_detail(chave, monkeypatch):
    """O `detail` do 409 é a regra do CRM ("Este CNPJ está com o parceiro X");
    uma mensagem genérica esconderia à pessoa o que fazer a seguir."""
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(
        lambda r: httpx.Response(409, json={"detail": "Este CNPJ está com o parceiro X"})))
    with pytest.raises(ErroSistema) as e:
        asyncio.run(hsgrowth.chamar("a@hs.com", "a-bot", "/cards", metodo="POST", json={}))
    assert "Este CNPJ está com o parceiro X" in str(e.value)


# --- o catálogo -----------------------------------------------------------------

def test_catalogo_recusa_filtro_desconhecido_e_id_nao_numerico():
    """`assigned_to_id` vindo do agente leria o funil de outra pessoa; id com `/`
    levaria o token do dono a uma rota fora do catálogo."""
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {"board_id": 1, "assigned_to_id": 3}, eu_id=9)
    with pytest.raises(ValueError):
        hg.params_da_consulta("minhas_tarefas", {"assigned_to_id": 3}, eu_id=9)
    with pytest.raises(ValueError):
        hg.caminho_da_consulta("card", "5/../users")
    assert hg.caminho_da_consulta("card", "5") == "/cards/5/expanded"
    with pytest.raises(ValueError):
        hg.caminho_da_consulta("quadros", "3")
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {"board_id": 1}, eu_id=None)   # sem o dono, não lê


def test_o_dono_e_injetado_pelo_servidor():
    """O `<eu>` entra na query por aqui: `meus_cards` leva `all=true` (sem ele
    só viria a primeira página) e `quadros` sempre `category=vendas`."""
    p = hg.params_da_consulta("meus_cards", {"board_id": 2, "is_lost": False}, eu_id=9)
    assert ("assigned_to_id", "9") in p and ("all", "true") in p and ("is_lost", "false") in p
    assert hg.params_da_consulta("minhas_tarefas", None, eu_id=9) == [("assigned_to_id", "9")]
    assert hg.params_da_consulta("quadros", None) == [("category", "vendas")]
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {}, eu_id=9)       # board_id é obrigatório


def test_cnpj_da_receita_aceita_pontuacao():
    """CNPJ colado da tela vem com pontos; 13 dígitos é número digitado errado e
    a Receita responderia como se o CNPJ não existisse."""
    assert hg.caminho_da_consulta("receita", "12.345.678/0001-90") == "/clients/cnpj/12345678000190"
    with pytest.raises(ValueError):
        hg.caminho_da_consulta("receita", "1234567800019")


def test_meus_cards_filtra_etapa_tarefa_e_dono_localmente():
    """O `/cards` traz cards de outros responsáveis conforme o papel; sem o
    corte local o Guardi contaria o funil do time como se fosse do dono."""
    cards = [
        {"id": 1, "assigned_to_id": 3, "list_id": 29, "pending_tasks_status": "overdue"},
        {"id": 2, "assigned_to_id": 9, "list_id": 29, "pending_tasks_status": "overdue"},
        {"id": 3, "assigned_to_id": 3, "list_id": 28, "pending_tasks_status": "overdue"},
        {"id": 4, "assigned_to_id": 3, "list_id": 29, "pending_tasks_status": "future"},
        {"id": 5, "assigned_to_id": 9, "sdr_id": 3, "list_id": 29, "pending_tasks_status": "overdue"},
    ]
    q = hg.params_da_consulta("meus_cards", {"board_id": 1, "etapa": 29, "tarefa": "overdue"}, eu_id=3)
    remotos, locais = hg.separar_filtros("meus_cards", q)
    assert not any(k in ("etapa", "tarefa") for k, _ in remotos)    # nunca vão ao HSGrowth
    r = hg.filtrar_local("meus_cards", {"cards": cards, "total": 5}, locais, 3)
    assert [c["id"] for c in r["cards"]] == [1, 5] and r["total"] == 2
    assert [c["id"] for c in hg.filtrar_local("meus_cards", cards, {}, 3)] == [1, 3, 4, 5]


def test_parado_usa_as_flags_do_kanban():
    """"Parado" é a regra do kanban (`is_stuck_7d`); se o filtro olhasse outro
    campo, o Guardi listaria como parado o card que a tela mostra em dia."""
    cards = [{"id": 1, "assigned_to_id": 3, "is_stuck_3d": True, "is_stuck_7d": True},
             {"id": 2, "assigned_to_id": 3, "is_stuck_3d": True, "is_stuck_7d": False},
             {"id": 3, "assigned_to_id": 3}]
    assert [c["id"] for c in hg.filtrar_local("meus_cards", cards, {"parado": "7d"}, 3)] == [1]
    assert [c["id"] for c in hg.filtrar_local("meus_cards", cards, {"parado": "3d"}, 3)] == [1, 2]
    with pytest.raises(ValueError):
        hg.params_da_consulta("meus_cards", {"board_id": 1, "parado": "5d"}, eu_id=3)
    assert ("minimal", "true") in hg.params_da_consulta("meus_cards", {"board_id": 1}, eu_id=3)


def test_filtro_local_falha_fechado():
    """Formato inesperado devolvido sem corte seria o funil (ou as tarefas) do
    time inteiro entregue ao Guardi de uma pessoa."""
    for chave in ("meus_cards", "tarefas_atrasadas"):
        for ruim in ({"detail": "x"}, "texto", None, [1, 2]):
            with pytest.raises(ValueError, match="resposta inesperada do HSGrowth"):
                hg.filtrar_local(chave, ruim, {}, 3)


def test_tarefas_atrasadas_so_do_dono():
    """O HSGrowth não escopa `/card-tasks/overdue` para admin/gerente: sem o
    corte local o Guardi leria as tarefas atrasadas de todo mundo."""
    tarefas = [{"id": 1, "assigned_to_id": 3}, {"id": 2, "assigned_to_id": 9}]
    assert [t["id"] for t in hg.filtrar_local("tarefas_atrasadas", tarefas, {}, 3)] == [1]
    with pytest.raises(ValueError):
        hg.filtrar_local("tarefas_atrasadas", tarefas, {}, None)
    with pytest.raises(ValueError):
        hg.params_da_consulta("tarefas_atrasadas", None, eu_id=None)
    assert hg.params_da_consulta("tarefas_atrasadas", None, eu_id=3) == []


def test_link_do_card_e_montado_pelo_servidor():
    """O modelo não monta URL: usaria o domínio da API e mandaria a pessoa a
    uma página que não existe."""
    base = "https://hs.x"
    assert hg.com_links("card", {"id": 7}, base)["link"] == "https://hs.x/cards/7"
    r = hg.com_links("meus_cards", {"cards": [{"id": 8}], "total": 1}, base + "/")
    assert r["cards"][0]["link"] == "https://hs.x/cards/8"
    r = hg.com_links("buscar", {"vendas": [{"id": 9}], "servico": [{"id": 4}]}, base)
    assert r["vendas"][0]["link"] == "https://hs.x/cards/9" and "link" not in r["servico"][0]
    assert "link" not in hg.com_links("clientes", [{"id": 1}], base)[0]


def test_link_de_fora_e_sobrescrito():
    """`link` vindo do HSGrowth é dado externo (campo livre): o agente
    entregaria à pessoa um endereço que não é o do servidor."""
    r = hg.com_links("card", {"id": 7, "link": "https://evil"}, "https://hs.x")
    assert r["link"] == "https://hs.x/cards/7"
    assert "link" not in hg.com_links("card", {"id": "../x", "link": "https://evil"}, "https://hs.x")
