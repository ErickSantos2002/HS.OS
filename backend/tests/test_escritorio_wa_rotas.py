"""Rotas da Admin API do WorkAdventure (`/escritorio-wa/api/*`).

⚠️ **`/api/capabilities` não pode falhar nunca.** O `play` do WA a chama no boot
e repete a cada 500 ms até dar certo — só depois sobe. Se ela tocar banco ou
segredo, um Postgres fora do ar derruba o escritório inteiro, inclusive para
quem já estava dentro e recarregar a página. Por isso o primeiro teste faz o
`ler_segredo` explodir e exige 200 mesmo assim.

⚠️ **O `Authorization` chega cru**, sem `Bearer` (`AdminApi.ts`:
`headers: { Authorization: \\`${ADMIN_API_TOKEN}\\` }`). Exigir `Bearer` recusaria
o próprio WA; aceitamos os dois.

⚠️ **O axios manda lista como `characterTextureIds[]=x`**, com colchetes. Ler só
o nome sem colchetes daria lista vazia → woka "válido e vazio" → a pessoa cairia
na escolha de personagem a cada entrada.
"""
import json
from pathlib import Path

import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.config import settings
from app.escritorio import wa
from app.escritorio.token_sala import ler_token_sala
from app.routers import escritorio_wa

TOKEN = "segredo-de-teste"
PLAY = "https://escritoriohs.healthsafetytech.com/~/hs/hs.wam"


@pytest.fixture
def cliente(monkeypatch):
    async def segredo(nome):
        assert nome == "ESCRITORIO_ADMIN_API_TOKEN"
        return TOKEN

    async def conta(email):
        return True

    async def membros(texto):
        return [{"email": "erick@healthsafetytech.com", "full_name": "Erick Santos"}]

    monkeypatch.setattr(escritorio_wa, "ler_segredo", segredo)
    monkeypatch.setattr(escritorio_wa, "_conta", conta)
    monkeypatch.setattr(escritorio_wa, "_membros", membros)
    monkeypatch.setattr(settings, "ESCRITORIO_DOMINIOS", "healthsafetytech.com")
    monkeypatch.setattr(settings, "ESCRITORIO_EDITORES", "")
    app = FastAPI()
    app.include_router(escritorio_wa.router)
    return TestClient(app, raise_server_exceptions=False)


def _acesso(cliente, email, extra=""):
    return cliente.get(
        f"/escritorio-wa/api/room/access?userIdentifier={email}&playUri={PLAY}&ipAddress=1.2.3.4{extra}",
        headers={"Authorization": TOKEN},
    )


# --- capabilities -------------------------------------------------------------------

def test_capabilities_responde_sem_token_nem_banco(monkeypatch, cliente):
    async def explode(nome):
        raise RuntimeError("banco fora do ar")

    monkeypatch.setattr(escritorio_wa, "ler_segredo", explode)
    r = cliente.get("/escritorio-wa/api/capabilities")
    assert r.status_code == 200
    assert r.json() == {}


# --- token --------------------------------------------------------------------------

def test_sem_authorization_e_403(cliente):
    assert cliente.get(f"/escritorio-wa/api/map?playUri={PLAY}").status_code == 403


def test_token_errado_e_403(cliente):
    r = cliente.get(f"/escritorio-wa/api/map?playUri={PLAY}", headers={"Authorization": "outro"})
    assert r.status_code == 403


def test_token_cru_como_o_wa_manda(cliente):
    r = cliente.get(f"/escritorio-wa/api/map?playUri={PLAY}", headers={"Authorization": TOKEN})
    assert r.status_code == 200
    assert r.json()["wamUrl"].endswith("/hs/hs.wam")


def test_token_com_bearer_tambem_serve(cliente):
    r = cliente.get(
        f"/escritorio-wa/api/map?playUri={PLAY}", headers={"Authorization": f"Bearer {TOKEN}"}
    )
    assert r.status_code == 200


def test_sem_segredo_configurado_e_503(monkeypatch, cliente):
    """Sem token configurado não há como conferir: recusa com 503, não abre."""
    async def nada(nome):
        return None

    monkeypatch.setattr(escritorio_wa, "ler_segredo", nada)
    r = cliente.get(f"/escritorio-wa/api/map?playUri={PLAY}", headers={"Authorization": ""})
    assert r.status_code == 503


# --- room/access --------------------------------------------------------------------

def test_quem_e_de_fora_da_empresa_e_recusado(cliente):
    r = _acesso(cliente, "x@gmail.com")
    assert r.status_code == 200
    assert r.json()["type"] == "unauthorized"


def test_sem_email_e_recusado_sem_excecao(cliente):
    r = _acesso(cliente, "um-sub-qualquer")
    assert r.status_code == 200
    assert r.json()["type"] == "unauthorized"


def test_conta_desativada_e_recusada(monkeypatch, cliente):
    async def desativada(email):
        return False

    monkeypatch.setattr(escritorio_wa, "_conta", desativada)
    assert _acesso(cliente, "a@healthsafetytech.com").json()["type"] == "unauthorized"


def test_sem_conta_no_hsos_entra(monkeypatch, cliente):
    """A empresa inteira entra no escritório; nem todo mundo tem login no HS.OS."""
    async def sem_conta(email):
        return None

    monkeypatch.setattr(escritorio_wa, "_conta", sem_conta)
    corpo = _acesso(cliente, "Novo@HealthSafetyTech.com").json()
    assert corpo["status"] == "ok"
    assert corpo["userUuid"] == "novo@healthsafetytech.com"
    assert ler_token_sala(corpo["userRoomToken"]) == "novo@healthsafetytech.com"


def test_banco_fora_vira_retry_e_nao_acesso_negado(monkeypatch, cliente):
    async def explode(email):
        raise RuntimeError("banco indisponível")

    monkeypatch.setattr(escritorio_wa, "_conta", explode)
    corpo = _acesso(cliente, "a@healthsafetytech.com").json()
    assert corpo["type"] == "retry"


def test_editor_por_config_sem_diferenciar_maiusculas(monkeypatch, cliente):
    monkeypatch.setattr(settings, "ESCRITORIO_EDITORES", "Erick@HealthSafetyTech.com, outro@x.com")
    corpo = _acesso(cliente, "erick@healthsafetytech.com").json()
    assert corpo["canEdit"] is True
    assert corpo["tags"] == ["admin", "editor"]


def test_quem_nao_e_editor_nao_edita(cliente):
    corpo = _acesso(cliente, "a@healthsafetytech.com").json()
    assert corpo["canEdit"] is False
    assert corpo["tags"] == []


def test_texturas_com_colchetes_como_o_axios_manda(cliente):
    dados = json.loads((Path(wa.__file__).parent / "wokas.json").read_text())
    ident = dados["woka"]["collections"][0]["textures"][0]["id"]
    corpo = _acesso(cliente, "a@healthsafetytech.com", f"&characterTextureIds[]={ident}").json()
    assert corpo["isCharacterTexturesValid"] is True
    assert [t["id"] for t in corpo["characterTextures"]] == [ident]


def test_texturas_sem_colchetes_tambem(cliente):
    corpo = _acesso(cliente, "a@healthsafetytech.com", "&characterTextureIds=nao-existe").json()
    assert corpo["isCharacterTexturesValid"] is False


def test_room_access_nao_traz_username(cliente):
    """`username: null` apagaria o nome do Entra dentro do escritório."""
    assert "username" not in _acesso(cliente, "a@healthsafetytech.com").json()


# --- members ------------------------------------------------------------------------

def test_busca_de_membros_no_formato_do_wa(cliente):
    r = cliente.get("/escritorio-wa/api/members?searchText=eri", headers={"Authorization": TOKEN})
    assert r.status_code == 200
    assert r.json() == [
        {"id": "erick@healthsafetytech.com", "name": "Erick Santos", "email": "erick@healthsafetytech.com"}
    ]


def test_membro_por_id(cliente):
    r = cliente.get(
        "/escritorio-wa/api/members/erick@healthsafetytech.com", headers={"Authorization": TOKEN}
    )
    assert r.status_code == 200
    assert r.json()["id"] == "erick@healthsafetytech.com"
    assert r.json()["visitCardUrl"] is None


def test_membro_inexistente_e_404(monkeypatch, cliente):
    async def ninguem(texto):
        return []

    monkeypatch.setattr(escritorio_wa, "_membros", ninguem)
    r = cliente.get("/escritorio-wa/api/members/ninguem@healthsafetytech.com", headers={"Authorization": TOKEN})
    assert r.status_code == 404


# --- o resto ------------------------------------------------------------------------

@pytest.mark.parametrize("caminho", ["/api/room/tags", "/api/world/tags"])
def test_listas_vazias(cliente, caminho):
    r = cliente.get(f"/escritorio-wa{caminho}?roomUrl={PLAY}", headers={"Authorization": TOKEN})
    assert r.status_code == 200
    assert r.json() == []


@pytest.mark.parametrize("caminho", ["/api/report", "/api/ban", "/api/room/message/abc/read"])
def test_posts_respondem_204(cliente, caminho):
    r = cliente.post(f"/escritorio-wa{caminho}", json={"x": 1}, headers={"Authorization": TOKEN})
    assert r.status_code == 204


def test_mesmo_mundo_lista_os_dois_mapas(cliente):
    """Com Admin API, o editor pergunta a nós quais mapas existem — é a lista do
    destino de uma saída (`ExitPropertyEditor.svelte`). Vazia, o Erick não
    consegue ligar o `hs` ao `office` pelo navegador."""
    r = cliente.get(f"/escritorio-wa/api/room/sameWorld?roomUrl={PLAY}", headers={"Authorization": TOKEN})
    assert r.status_code == 200
    salas = {m["roomUrl"]: m for m in r.json()}
    assert set(salas) == {"/~/hs/hs.wam", "/~/office.wam"}
    assert salas["/~/hs/hs.wam"]["wamUrl"].endswith("/map-storage/hs/hs.wam")
    assert all(m["name"] for m in r.json())


def test_membros_do_chat_vazio_como_o_localadmin(cliente):
    """`getWorldChatMembers` não depende de capability: sem a rota, cada abertura
    da lista de pessoas do chat gerava um 404 aqui e um erro no play."""
    r = cliente.get(f"/escritorio-wa/api/chat/members?playUri={PLAY}&searchText=", headers={"Authorization": TOKEN})
    assert r.status_code == 200
    assert r.json() == {"total": 0, "members": []}


def test_membros_do_chat_exigem_token(cliente):
    assert cliente.get("/escritorio-wa/api/chat/members").status_code == 403


def test_room_api_recusada(cliente):
    r = cliente.get("/escritorio-wa/api/room-api/authorization", headers={"Authorization": TOKEN})
    assert r.status_code == 200
    assert r.json()["success"] is False


def test_rota_montada_na_aplicacao_de_verdade():
    """O `ADMIN_API_URL` do `play` aponta para `/escritorio-wa`: sem o `include_router`
    no `main.py`, o play repete `capabilities` para sempre e o escritório não sobe."""
    from app.main import app

    r = TestClient(app).get("/escritorio-wa/api/capabilities")
    assert r.status_code == 200
    assert r.json() == {}
