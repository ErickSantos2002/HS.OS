"""API /agenda/* da página: a ponte entre a tela e o domínio dos lembretes.

Domínio e Outlook são trocados por dublês: aqui se tranca o que é DA ROTA —
conversão, erros HTTP, serialização e o que nunca vem do corpo.
"""
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.agenda.regras import FUSO, RegraInvalida
from app.dependencies import Usuario, usuario_atual
from app.routers import agenda as rota

UID = "11111111-1111-1111-1111-111111111111"
LID = "22222222-2222-2222-2222-222222222222"


@pytest.fixture
def cli(monkeypatch):
    class Conn:
        @asynccontextmanager
        async def transaction(self):
            yield

    @asynccontextmanager
    async def sessao_falsa(**_):
        yield Conn()

    monkeypatch.setattr(rota, "sessao", sessao_falsa)
    app = FastAPI()
    app.include_router(rota.router)
    app.dependency_overrides[usuario_atual] = lambda: Usuario(UID, "a@b.com", "colaborador")
    return TestClient(app)


def _guardi(monkeypatch, agent_id="ana-bot"):
    async def g(conn, uid):
        return agent_id
    monkeypatch.setattr(rota.dominio, "guardi_de", g)


def _linha(**o):
    base = {"id": LID, "titulo": "T", "regra": {"tipo": "unico"}, "ativo": True,
            "proximo_em": "2026-11-10T09:00:00-03:00",
            "criado_em": datetime(2026, 11, 9, 15, 0, tzinfo=timezone.utc),
            "ultimo_disparo_em": None, "atualizado_em": datetime(2026, 11, 9, 15, 0, tzinfo=timezone.utc)}
    return {**base, **o}


def test_sem_guardi_404(cli, monkeypatch):
    """Sem Guardi a pessoa não tem agenda: 404 com a frase da tela, não 500."""
    async def nenhum(conn, uid):
        return None
    monkeypatch.setattr(rota.dominio, "guardi_de", nenhum)
    r = cli.post("/agenda/lembretes", json={"titulo": "x", "quando": "2026-12-01T09:00"})
    assert r.status_code == 404 and r.json()["detail"] == "Você ainda não tem Guardi."


def test_regra_invalida_400_com_mensagem(cli, monkeypatch):
    """A mensagem do domínio chega à tela; se virasse 500 a pessoa não saberia o que corrigir."""
    _guardi(monkeypatch)

    async def criar(*a, **k):
        raise RegraInvalida("Você já tem 30 lembretes ativos.")
    monkeypatch.setattr(rota.dominio, "criar", criar)
    r = cli.post("/agenda/lembretes", json={"titulo": "x", "quando": "2026-12-01T09:00"})
    assert r.status_code == 400 and "30 lembretes" in r.json()["detail"]


def test_post_grava_pessoa_e_agente_do_guardi_nao_do_corpo(cli, monkeypatch):
    """O corpo não escolhe `agent_id` nem `criado_por`: um cliente forjado criaria
    lembrete no nome de outro agente ou como se fosse do Guardi."""
    _guardi(monkeypatch)
    visto = {}

    async def criar(conn, uid, agent_id, titulo, regra, instrucao, criado_por, agora):
        visto.update(uid=uid, agent_id=agent_id, criado_por=criado_por, regra=regra)
        return _linha()
    monkeypatch.setattr(rota.dominio, "criar", criar)
    r = cli.post("/agenda/lembretes", json={"titulo": "T", "quando": "2026-12-01T09:00",
                                            "agent_id": "outro-bot", "criado_por": "guardi"})
    assert r.status_code == 200
    assert visto["agent_id"] == "ana-bot" and visto["criado_por"] == "pessoa" and visto["uid"] == UID
    assert r.json()["criado_em"] == "2026-11-09T12:00:00-03:00"   # UTC -> Brasília


def test_id_que_nao_e_uuid_404(cli, monkeypatch):
    """Id solto chegaria ao `::uuid` do SQL e viraria 500."""
    _guardi(monkeypatch)
    assert cli.delete("/agenda/lembretes/abc").status_code == 404
    assert cli.patch("/agenda/lembretes/abc", json={"titulo": "x"}).status_code == 404


def test_patch_so_repassa_o_que_veio(cli, monkeypatch):
    """`ativo` só segue quando `pausado` veio: senão todo PATCH de título reativaria o lembrete."""
    _guardi(monkeypatch)
    campos = []

    async def editar(conn, uid, id, agora, **c):
        campos.append(c)
        return _linha()
    monkeypatch.setattr(rota.dominio, "editar", editar)
    cli.patch(f"/agenda/lembretes/{LID}", json={"titulo": "novo"})
    cli.patch(f"/agenda/lembretes/{LID}", json={"pausado": True})
    assert campos[0] == {"titulo": "novo"}
    assert campos[1] == {"ativo": False}


def test_patch_de_lembrete_alheio_404(cli, monkeypatch):
    _guardi(monkeypatch)

    async def editar(*a, **k):
        raise RegraInvalida("Lembrete não encontrado.")
    monkeypatch.setattr(rota.dominio, "editar", editar)
    assert cli.patch(f"/agenda/lembretes/{LID}", json={"titulo": "x"}).status_code == 404


def test_delete_204_e_404(cli, monkeypatch):
    _guardi(monkeypatch)
    achou = [True, False]

    async def apagar(conn, uid, id):
        return achou.pop(0)
    monkeypatch.setattr(rota.dominio, "apagar", apagar)
    assert cli.delete(f"/agenda/lembretes/{LID}").status_code == 204
    assert cli.delete(f"/agenda/lembretes/{LID}").status_code == 404


def test_listar_janela_em_brasilia_com_teto(cli, monkeypatch):
    _guardi(monkeypatch)
    janela = {}

    async def listar(conn, uid, de=None, ate=None):
        janela.update(de=de, ate=ate)
        return [_linha()]
    monkeypatch.setattr(rota.dominio, "listar", listar)
    r = cli.get("/agenda/lembretes?de=2026-11-01&ate=2026-11-30")
    assert r.status_code == 200 and len(r.json()["lembretes"]) == 1
    assert janela["de"] == datetime(2026, 11, 1, tzinfo=FUSO)
    assert janela["ate"] == datetime(2026, 12, 1, tzinfo=FUSO)   # `ate` inclusivo: dia inteiro
    assert cli.get("/agenda/lembretes?de=2026-01-01&ate=2026-12-31").status_code == 400
    assert cli.get("/agenda/lembretes?de=lixo").status_code == 400
    assert cli.get("/agenda/lembretes?de=2026-11-10&ate=2026-11-01").status_code == 400


def test_outlook_sem_conta_devolve_estado(cli, monkeypatch):
    async def eventos(conn, uid, de, ate):
        return "sem_conta", []
    monkeypatch.setattr(rota.outlook, "eventos", eventos)
    r = cli.get("/agenda/outlook?de=2026-11-01&ate=2026-11-30")
    assert r.json() == {"estado": "sem_conta", "eventos": []}


def test_outlook_falha_inesperada_vira_estado_erro(cli, monkeypatch):
    """Outlook fora do ar não pode derrubar a página dos lembretes."""
    async def eventos(*a):
        raise RuntimeError("boom")
    monkeypatch.setattr(rota.outlook, "eventos", eventos)
    r = cli.get("/agenda/outlook")
    assert r.status_code == 200 and r.json() == {"estado": "erro", "eventos": []}


def test_outlook_serializa_datas(cli, monkeypatch):
    async def eventos(*a):
        return "ok", [{"titulo": "R", "inicio": datetime(2026, 11, 10, 9, tzinfo=FUSO),
                       "fim": datetime(2026, 11, 10, 10, tzinfo=FUSO), "dia_inteiro": False,
                       "local": "", "ocupado": True}]
    monkeypatch.setattr(rota.outlook, "eventos", eventos)
    ev = cli.get("/agenda/outlook").json()["eventos"][0]
    assert ev["inicio"] == "2026-11-10T09:00:00-03:00"
