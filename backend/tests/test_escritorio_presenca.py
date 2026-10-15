"""Quem está no escritório agora, e o status que o script do mapa puxa.

A presença vem do WebSocket de administração do `play` do WA
(`/ws/admin/rooms`). Fatos levantados no código da v1.33.11 que estes testes
trancam:

- **Duas abas são dois `MemberJoin`** (cada aba é um `User` no `back`), e cada
  aba fechada é um `MemberLeave` só com o `uuid`. Sem contar conexões, fechar
  uma aba tiraria da lista quem continua dentro pela outra.
- **Não há mensagem de "snapshot".** Ao assinar, o `back` manda um `MemberJoin`
  por pessoa já presente (`GameRoom.adminJoin`). Por isso, a cada reconexão o
  estado é zerado ANTES do `listen`.
- O JWT do socket é HS256 com o `ADMIN_SOCKETS_TOKEN` e carga
  `{authorizedRoomIds}` (`JWTTokenManager.verifyAdminSocketToken`).

⚠️ **`/escritorio/meu-status` é chamado de um iframe com origem `null`** (o
script do mapa). Sem `Access-Control-Allow-Origin: *` — inclusive no 401 — o
navegador esconde a resposta e o script não distingue "token vencido" de "rede
fora". O teste sobre o app inteiro prova que o CORS global não tira o cabeçalho.
"""
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from fastapi import FastAPI
from starlette.testclient import TestClient

from app.auth.security import emitir_token
from app.escritorio import presenca as modulo
from app.escritorio.presenca import Presenca, aplicar_mensagem, jwt_de_admin, salas_ouvidas
from app.escritorio.token_sala import emitir_token_sala
from app.routers import escritorio as rotas

T0 = datetime(2026, 10, 15, 12, 0, tzinfo=timezone.utc)


def _join(uuid, nome="Fulano"):
    return {"type": "MemberJoin", "data": {"uuid": uuid, "name": nome, "ipAddress": "1.2.3.4",
                                            "roomId": "https://e.com/~/hs/hs.wam"}}


def _leave(uuid):
    return {"type": "MemberLeave", "data": {"uuid": uuid}}


# --- estado ---------------------------------------------------------------------------

def test_duas_abas_e_uma_fechada_continua_na_lista():
    p = Presenca()
    assert p.entrou("a@hs.com", "Ana", T0) is True
    assert p.entrou("a@hs.com", "Ana", T0) is False  # segunda aba: a lista não muda
    assert p.saiu("a@hs.com") is False
    assert [x["email"] for x in p.pessoas()] == ["a@hs.com"]
    assert p.saiu("a@hs.com") is True
    assert p.pessoas() == []


def test_saida_de_quem_nao_estava_nao_quebra():
    assert Presenca().saiu("ninguem@hs.com") is False


def test_zerar_limpa():
    p = Presenca()
    p.entrou("a@hs.com", "Ana", T0)
    p.zerar()
    assert p.pessoas() == []


def test_lista_ordenada_por_nome_com_desde():
    p = Presenca()
    p.entrou("z@hs.com", "Zeca", T0)
    p.entrou("b@hs.com", "beatriz", T0 + timedelta(minutes=1))
    pessoas = p.pessoas()
    assert [x["nome"] for x in pessoas] == ["beatriz", "Zeca"]
    assert pessoas[0]["desde"] == (T0 + timedelta(minutes=1)).isoformat()


def test_uuid_vira_email_minusculo():
    p = Presenca()
    p.entrou("A@HS.com", "Ana", T0)
    assert p.saiu("a@hs.com") is True


# --- mensagens do WA ------------------------------------------------------------------

def test_aplicar_join_e_leave_no_formato_do_wa():
    p = Presenca()
    assert aplicar_mensagem(p, _join("a@hs.com", "Ana"), T0) is True
    assert p.pessoas()[0]["nome"] == "Ana"
    assert aplicar_mensagem(p, _leave("a@hs.com"), T0) is True
    assert p.pessoas() == []


def test_mensagem_de_erro_ou_desconhecida_nao_muda_nada():
    p = Presenca()
    assert aplicar_mensagem(p, {"type": "Error", "data": {"message": "x"}}, T0) is False
    assert aplicar_mensagem(p, {"type": "Outro"}, T0) is False
    assert aplicar_mensagem(p, {"type": "MemberJoin", "data": {}}, T0) is False


# --- JWT e salas ------------------------------------------------------------------------

def test_jwt_de_admin_no_formato_que_o_play_confere():
    salas = ["https://e.com/~/hs/hs.wam"]
    corpo = jwt.decode(jwt_de_admin("s3gredo", salas), "s3gredo", algorithms=["HS256"])
    assert corpo["authorizedRoomIds"] == salas
    assert "exp" in corpo


def test_salas_sao_a_url_completa_sem_query(monkeypatch):
    """O `roomId` do WA é `Room.key`: a URL inteira da sala, sem query nem hash."""
    monkeypatch.setattr(modulo.settings, "ESCRITORIO_URL", "https://e.com/")
    monkeypatch.setattr(modulo.settings, "ESCRITORIO_SALA_INICIAL", "/~/hs/hs.wam")
    assert salas_ouvidas() == ["https://e.com/~/hs/hs.wam", "https://e.com/~/office.wam"]


# --- rotas ------------------------------------------------------------------------------

@pytest.fixture
def cliente(monkeypatch):
    async def status(email):
        assert email == "a@hs.com"
        return ("Em reunião", "🗓️")

    async def perfis(emails):
        return {"a@hs.com": {"user_id": "u-1", "avatar_url": "https://x/a.png", "full_name": "Ana Souza"}}

    async def usuario():
        return object()

    monkeypatch.setattr(rotas, "_status", status)
    monkeypatch.setattr(rotas, "_perfis", perfis)
    app = FastAPI()
    app.include_router(rotas.router)
    app.dependency_overrides[rotas.usuario_atual] = usuario
    return TestClient(app)


def test_meu_status_traduz_e_libera_qualquer_origem(cliente):
    r = cliente.get(f"/escritorio/meu-status?t={emitir_token_sala('a@hs.com')}")
    assert r.status_code == 200
    assert r.json() == {"wa_status": "BUSY", "emoji": "🗓️", "label": "Em reunião"}
    assert r.headers["access-control-allow-origin"] == "*"


def test_meu_status_sem_conta_e_online(monkeypatch, cliente):
    async def nada(email):
        return None

    monkeypatch.setattr(rotas, "_status", nada)
    r = cliente.get(f"/escritorio/meu-status?t={emitir_token_sala('a@hs.com')}")
    assert r.json() == {"wa_status": "ONLINE", "emoji": None, "label": None}


@pytest.mark.parametrize("token", ["", "lixo"])
def test_meu_status_token_invalido_e_401_com_cors(cliente, token):
    r = cliente.get(f"/escritorio/meu-status?t={token}")
    assert r.status_code == 401
    assert r.headers["access-control-allow-origin"] == "*"
    assert "detail" in r.json()


def test_meu_status_nao_aceita_token_de_login(cliente):
    token, _ = emitir_token("u-1", "colaborador", "a@hs.com")
    assert cliente.get(f"/escritorio/meu-status?t={token}").status_code == 401


def test_meu_status_no_app_inteiro_com_origem_null(monkeypatch):
    from app.main import app

    async def status(email):
        return ("Almoço", "🍽️")

    monkeypatch.setattr(rotas, "_status", status)
    r = TestClient(app).get(
        f"/escritorio/meu-status?t={emitir_token_sala('a@hs.com')}", headers={"Origin": "null"}
    )
    assert r.status_code == 200
    assert r.json()["wa_status"] == "BACK_IN_A_MOMENT"
    assert r.headers["access-control-allow-origin"] == "*"


def test_presenca_sem_login_e_401():
    app = FastAPI()
    app.include_router(rotas.router)
    assert TestClient(app).get("/escritorio/presenca").status_code == 401


def test_presenca_junta_o_perfil(monkeypatch, cliente):
    estado = Presenca()
    estado.conectado = True
    estado.entrou("a@hs.com", "ana-do-entra", T0)
    estado.entrou("b@hs.com", "Bruno", T0)
    monkeypatch.setattr(rotas, "presenca", estado)

    corpo = cliente.get("/escritorio/presenca").json()
    assert corpo["conectado"] is True
    assert corpo["pessoas"] == [
        {"email": "a@hs.com", "nome": "Ana Souza", "user_id": "u-1",
         "avatar_url": "https://x/a.png", "desde": T0.isoformat()},
        {"email": "b@hs.com", "nome": "Bruno", "user_id": None, "avatar_url": None,
         "desde": T0.isoformat()},
    ]


def test_vigiar_contra_um_play_falso(monkeypatch):
    """O laço de verdade: manda o `listen` no formato do WA, aplica as mensagens,
    e ao cair zera a lista e diz `conectado: false` (senão a tela mostraria gente
    que já saiu enquanto o escritório está fora)."""
    import asyncio
    import json as _json

    import websockets

    recebido = {}
    estado = Presenca()
    monkeypatch.setattr(modulo, "presenca", estado)

    async def segredo(nome):
        return "s3gredo"

    monkeypatch.setattr(modulo, "ler_segredo", segredo)

    async def cenario():
        fechar = asyncio.Event()

        async def play(ws):
            recebido["caminho"] = ws.request.path
            recebido["listen"] = _json.loads(await ws.recv())
            await ws.send(_json.dumps(_join("a@hs.com", "Ana")))
            await ws.send(_json.dumps(_join("a@hs.com", "Ana")))
            await ws.send(_json.dumps(_join("b@hs.com", "Bia")))
            await ws.send(_json.dumps(_leave("a@hs.com")))
            await fechar.wait()

        async with websockets.serve(play, "127.0.0.1", 0) as servidor:
            porta = servidor.sockets[0].getsockname()[1]
            monkeypatch.setattr(modulo.settings, "ESCRITORIO_URL", f"http://127.0.0.1:{porta}")
            parar = asyncio.Event()
            tarefa = asyncio.create_task(modulo.vigiar(parar))
            for _ in range(100):
                if len(estado.pessoas()) == 2 and estado._pessoas["a@hs.com"]["conexoes"] == 1:
                    break
                await asyncio.sleep(0.02)
            assert estado.conectado is True
            assert [p["email"] for p in estado.pessoas()] == ["a@hs.com", "b@hs.com"]

            fechar.set()
            for _ in range(100):
                if not estado.conectado:
                    break
                await asyncio.sleep(0.02)
            assert estado.conectado is False
            assert estado.pessoas() == []
            parar.set()
            await asyncio.wait_for(tarefa, 5)

    asyncio.run(cenario())

    assert recebido["caminho"] == "/ws/admin/rooms"
    assert recebido["listen"]["event"] == "listen"
    assert recebido["listen"]["roomIds"] == salas_ouvidas()
    corpo = jwt.decode(recebido["listen"]["jwt"], "s3gredo", algorithms=["HS256"])
    assert corpo["authorizedRoomIds"] == recebido["listen"]["roomIds"]


def test_presenca_desconectada(monkeypatch, cliente):
    monkeypatch.setattr(rotas, "presenca", Presenca())
    assert cliente.get("/escritorio/presenca").json() == {"conectado": False, "pessoas": []}
