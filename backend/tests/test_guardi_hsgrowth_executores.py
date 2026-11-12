"""Executores do clique do Guardi no HSGrowth (12/11/2026).

Cada teste tranca um defeito que, no clique, escreveria errado no CRM de um
vendedor ou esconderia dele o que ficou pela metade.
"""
import asyncio

import httpx
import pytest
from cryptography.hazmat.primitives import serialization as s
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from app import acoes
from app import agente_token as at
from app.sistemas import hsgrowth

LINK = "https://hsgrowth.healthsafetytech.com/cards/7"


@pytest.fixture(autouse=True)
def chave(monkeypatch):
    k = Ed25519PrivateKey.generate()
    pem = k.private_bytes(s.Encoding.PEM, s.PrivateFormat.PKCS8, s.NoEncryption()).decode()
    monkeypatch.setattr(at.settings, "AGENTE_CHAVE_PRIVADA", pem)


def _rodar(monkeypatch, acao, payload, respostas=None):
    """Devolve (resultado_ou_erro, [(metodo, caminho, corpo)])."""
    import json as j
    reqs = []
    respostas = respostas or {}

    def h(req):
        corpo = j.loads(req.content) if req.content else None
        reqs.append((req.method, req.url.path.removeprefix("/api/v1"), corpo))
        r = respostas.get((req.method, req.url.path.removeprefix("/api/v1")))
        if callable(r):
            return r()
        return httpx.Response(200, json=r if r is not None else {"id": 1})
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(h))
    try:
        out = asyncio.run(acoes.EXECUTORES[("hsgrowth", acao)]("a@hs.com", "a-bot", payload, "u1"))
    except hsgrowth.ErroSistema as e:
        out = e
    return out, reqs


REG = {"card_id": 7, "campos": {"value": 10}, "campos_personalizados": [{"field_definition_id": 3, "value": "x"}],
       "nota": "ligou", "tarefas": [{"op": "criar", "title": "Ligar", "task_type": "call",
                                     "due_date": "2026-11-19T13:00:00Z"}],
       "mover_para": 9, "_exibir": {"link": LINK, "aviso": "vai para Reunião Agendada"}}


def test_registrar_executa_na_ordem(monkeypatch):
    """Ordem trocada (mover antes da nota) deixaria o card numa etapa que exige
    o que ainda não foi gravado, e o HSGrowth recusaria o resto."""
    out, reqs = _rodar(monkeypatch, "hsgrowth_registrar", REG)
    assert [(m, c) for m, c, _ in reqs] == [
        ("PUT", "/cards/7"), ("POST", "/cards/7/fields"), ("POST", "/card-notes"),
        ("POST", "/card-tasks"), ("PUT", "/cards/7/move")]
    assert reqs[2][2] == {"card_id": 7, "content": "ligou"}
    assert reqs[3][2]["card_id"] == 7 and reqs[4][2] == {"target_list_id": 9}
    assert LINK in out and "vai para Reunião Agendada" in out


def test_corpo_do_put_sai_da_allowlist(monkeypatch):
    """Payload adulterado com `assigned_to_id` não pode chegar ao CRM: seria
    reatribuir card por conversa."""
    p = {"card_id": 7, "campos": {"value": 1, "assigned_to_id": 99, "is_won": True}, "_exibir": {"link": LINK}}
    _, reqs = _rodar(monkeypatch, "hsgrowth_registrar", p)
    assert reqs[0][2] == {"value": 1}


def test_lote_para_e_diz_o_que_entrou(monkeypatch):
    """Sem dizer o que já entrou, a pessoa repetiria o cartão e duplicaria nota e tarefa."""
    r = {("PUT", "/cards/7/move"): lambda: httpx.Response(400, json={"detail": "Necessário anexo de proposta"})}
    out, reqs = _rodar(monkeypatch, "hsgrowth_registrar", REG, r)
    assert isinstance(out, hsgrowth.ErroSistema)
    m = str(out)
    assert "Parou em mover (5 de 5)" in m and "nota" in m and "tarefa criada" in m
    assert "anexe a proposta no card pela tela: " + LINK in m
    assert len(reqs) == 5


def test_lead_cria_cliente_contato_card_e_liga(monkeypatch):
    """O contato precisa nascer ligado ao cliente criado e o card levar os dois ids."""
    r = {("POST", "/clients"): {"id": 44}, ("POST", "/persons"): {"id": 55}, ("POST", "/cards"): {"id": 66}}
    p = {"titulo": "ACME", "list_id": 6, "cliente": {"campos": {"name": "ACME", "document": "123"}},
         "contato": {"campos": {"name": "Ana", "assigned_to_id": 3}}, "campos_do_card": {"value": 5, "sdr_id": 2},
         "_exibir": {}}
    out, reqs = _rodar(monkeypatch, "hsgrowth_criar_lead", p, r)
    assert [(m, c) for m, c, _ in reqs] == [("POST", "/clients"), ("POST", "/persons"), ("POST", "/cards")]
    assert reqs[1][2] == {"name": "Ana", "organization_id": 44}
    assert reqs[2][2] == {"value": 5, "title": "ACME", "list_id": 6, "client_id": 44, "person_id": 55}
    assert out.endswith("/cards/66")


def test_lead_com_cliente_existente_nao_recria(monkeypatch):
    """Cliente existente por documento é reaproveitado: POST /clients duplicaria o cadastro."""
    r = {("POST", "/cards"): {"id": 66}}
    p = {"titulo": "X", "list_id": 6, "cliente": {"id": 44}, "contato": {"id": 55}, "campos_do_card": {}}
    _, reqs = _rodar(monkeypatch, "hsgrowth_criar_lead", p, r)
    assert [(m, c) for m, c, _ in reqs] == [("POST", "/cards")]


def test_lead_409_de_parceiro_repassa_e_manda_falar_com_o_gerente(monkeypatch):
    """O detalhe do CRM ("com o parceiro X") é a regra; sem ele a pessoa tentaria de novo."""
    r = {("POST", "/clients"): lambda: httpx.Response(409, json={"detail": "Este CNPJ está com o parceiro Beta"})}
    p = {"titulo": "X", "list_id": 6, "cliente": {"campos": {"name": "A"}}, "contato": {"campos": {"name": "B"}},
         "campos_do_card": {}}
    out, reqs = _rodar(monkeypatch, "hsgrowth_criar_lead", p, r)
    assert "parceiro Beta" in str(out) and "gerente" in str(out) and "Parou em cliente (1 de 3)" in str(out)
    assert len(reqs) == 1


def test_timeout_no_meio_diz_que_nao_sabe(monkeypatch):
    """Timeout não é recusa: a escrita pode ter entrado, e dizer "falhou" convida a repetir."""
    def estoura(req):
        if req.url.path.endswith("/card-notes"):
            raise httpx.ReadTimeout("x")
        return httpx.Response(200, json={"id": 1})
    monkeypatch.setattr(hsgrowth, "_transporte", httpx.MockTransport(estoura))
    with pytest.raises(hsgrowth.ErroSistema) as e:
        asyncio.run(acoes.EXECUTORES[("hsgrowth", "hsgrowth_registrar")]("a@hs.com", "a-bot", REG, "u1"))
    assert e.value.status == 0 and "não sei se foi feito" in str(e.value) and "Parou em nota" in str(e.value)


def test_perder_envia_motivo(monkeypatch):
    """O HSGrowth exige `loss_reason`; sem ele o card não fecha como perdido."""
    _, reqs = _rodar(monkeypatch, "hsgrowth_perder", {"card_id": 7, "motivo": "preço"})
    assert reqs == [("POST", "/cards/7/lose", {"loss_reason": "preço"})]


def test_ganhar_usa_a_rota_propria(monkeypatch):
    """Ganhar por PUT/move pularia a regra de negócio da rota /win."""
    _, reqs = _rodar(monkeypatch, "hsgrowth_ganhar", {"card_id": 7})
    assert [(m, c) for m, c, _ in reqs] == [("POST", "/cards/7/win")]


def test_noshow_usa_a_rota_propria(monkeypatch):
    """Concluir a reunião em vez de PATCH /noshow apagaria o sinal de no-show."""
    _, reqs = _rodar(monkeypatch, "hsgrowth_noshow", {"card_id": 7, "task_id": 12})
    assert [(m, c) for m, c, _ in reqs] == [("PATCH", "/card-tasks/12/noshow")]


def test_cliente_e_contato_so_levam_campos_da_allowlist(monkeypatch):
    """Cadastro de cliente alterado fora da allowlist sincroniza com outros sistemas."""
    p = {"card_id": 7, "cliente": {"id": 44, "campos": {"name": "N", "is_active": False}},
         "contato": {"id": 55, "campos": {"phone": "1", "organization_id": 9}}, "_exibir": {"link": LINK}}
    _, reqs = _rodar(monkeypatch, "hsgrowth_cliente", p)
    assert reqs == [("PUT", "/clients/44", {"name": "N"}), ("PUT", "/persons/55", {"phone": "1"})]


def test_concluir_tarefa_manda_is_valid(monkeypatch):
    """O HSGrowth exige `is_valid` ao concluir; sem ele a conclusão fica ambígua."""
    p = {"card_id": 7, "tarefas": [{"op": "concluir", "task_id": 12}, {"op": "alterar", "task_id": 13, "title": "T", "assigned_to_id": 9}],
         "_exibir": {}}
    _, reqs = _rodar(monkeypatch, "hsgrowth_registrar", p)
    assert reqs[0] == ("PATCH", "/card-tasks/12/complete", {"is_completed": True, "is_valid": True})
    assert reqs[1] == ("PUT", "/card-tasks/13", {"title": "T"})
