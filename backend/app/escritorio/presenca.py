"""Quem está no escritório agora — vigia do WebSocket de administração do WA.

Spec: `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`.
Conferido no código-fonte da v1.33.11:

- **Rota e mensagem:** `wss://<escritório>/ws/admin/rooms` (a `borda` manda
  `/ws/` ao `play:3001`), e o cliente envia
  `{"event": "listen", "roomIds": [...], "jwt": "..."}`
  (`play/src/pusher/controllers/IoSocketController.ts`, `adminRoomSocket`).
- **JWT:** HS256 com o `ADMIN_SOCKETS_TOKEN` do `play`, carga
  `{authorizedRoomIds: [...]}`; `exp` não é exigido, mas vai
  (`play/src/pusher/services/JWTTokenManager.ts`). Sala fora da lista derruba a
  conexão com 1008.
- **`roomId` é a URL inteira da sala, sem query nem hash** — é o `Room.key` do
  front (`play/src/front/Connection/Room.ts`), o mesmo que o `back` usa para
  nomear a sala. Ex.: `https://escritoriohs.healthsafetytech.com/~/hs/hs.wam`.
- **Mensagens:** `{"type": "MemberJoin", "data": {uuid, name, ipAddress, roomId}}`
  e `{"type": "MemberLeave", "data": {uuid}}` (sem `roomId`!)
  (`play/src/pusher/services/SocketManager.ts`, `handleAdminRoom`).
- **Não existe snapshot.** Ao assinar, o `back` manda um `MemberJoin` por
  pessoa já presente (`back/src/Model/GameRoom.ts`, `adminJoin`). Por isso o
  estado é zerado antes de cada `listen`.
- **Cada aba é um `User`**: duas abas, dois `MemberJoin`. O estado conta
  conexões por `uuid`, e fechar uma aba não tira a pessoa da lista.
- Se a ligação do `play` com o `back` cai, o `play` fecha o nosso socket (1011);
  a reconexão com backoff resolve.

**Cada worker do uvicorn tem a sua conexão e o seu estado.** Os dois veem a
mesma coisa; o `hub` é por processo, e quem está conectado num worker recebe o
aviso do estado daquele worker, que é inteiro. Sem tabela e sem eleição.

O `uuid` é o `userUuid` que a nossa `room/access` devolve: o e-mail em minúsculas.
"""

import asyncio
import json
import logging
import time
from datetime import datetime, timezone

import jwt
import websockets

from app.config import settings
from app.integracoes import ler_segredo
from app.realtime import hub, topico_tabela

logger = logging.getLogger(__name__)

TABELA = "escritorio_presenca"
_ESPERA_MINIMA = 2.0
_ESPERA_MAXIMA = 60.0
# Conexão que durou menos que isto não zera o backoff: token errado faz o
# `play` aceitar e derrubar na hora, e sem isso martelaríamos a cada 2 s.
_VIDA_QUE_CONTA = 30.0


class Presenca:
    """Estado puro: `uuid → {nome, conexoes, desde}`."""

    def __init__(self) -> None:
        self._pessoas: dict[str, dict] = {}
        self.conectado = False

    def zerar(self) -> None:
        self._pessoas.clear()

    def entrou(self, uuid: str, nome: str, agora: datetime) -> bool:
        """Conta mais uma conexão. `True` se a pessoa não estava na lista."""
        chave = uuid.strip().lower()
        if chave in self._pessoas:
            self._pessoas[chave]["conexoes"] += 1
            return False
        self._pessoas[chave] = {"nome": nome or chave, "conexoes": 1, "desde": agora}
        return True

    def saiu(self, uuid: str) -> bool:
        """Conta uma conexão a menos. `True` se a pessoa saiu da lista."""
        chave = uuid.strip().lower()
        pessoa = self._pessoas.get(chave)
        if pessoa is None:
            return False
        pessoa["conexoes"] -= 1
        if pessoa["conexoes"] > 0:
            return False
        del self._pessoas[chave]
        return True

    def pessoas(self) -> list[dict]:
        lista = [
            {"email": email, "nome": p["nome"], "desde": p["desde"].isoformat()}
            for email, p in self._pessoas.items()
        ]
        return sorted(lista, key=lambda x: (x["nome"].casefold(), x["email"]))


presenca = Presenca()


def aplicar_mensagem(estado: Presenca, msg: dict, agora: datetime) -> bool:
    """Aplica uma mensagem do WA. `True` se a lista mudou."""
    tipo = msg.get("type")
    dados = msg.get("data") or {}
    uuid = dados.get("uuid")
    if not isinstance(uuid, str) or not uuid:
        if tipo == "Error":
            logger.warning("escritório: o play recusou a assinatura: %s", dados.get("message"))
        return False
    if tipo == "MemberJoin":
        return estado.entrou(uuid, str(dados.get("name") or ""), agora)
    if tipo == "MemberLeave":
        return estado.saiu(uuid)
    return False


def jwt_de_admin(segredo: str, salas: list[str]) -> str:
    agora = int(time.time())
    return jwt.encode(
        {"authorizedRoomIds": salas, "iat": agora, "exp": agora + 3600}, segredo, algorithm="HS256"
    )


def salas_ouvidas() -> list[str]:
    """A sala inicial e o `office` do starter kit (o plano de volta)."""
    base = settings.ESCRITORIO_URL.rstrip("/")
    caminhos = [settings.ESCRITORIO_SALA_INICIAL, "/~/office.wam"]
    return list(dict.fromkeys(base + "/" + c.lstrip("/") for c in caminhos))


def _url_do_socket() -> str:
    base = settings.ESCRITORIO_URL.rstrip("/")
    if base.startswith("https://"):
        base = "wss://" + base[len("https://"):]
    elif base.startswith("http://"):
        base = "ws://" + base[len("http://"):]
    return base + "/ws/admin/rooms"


def _avisar() -> None:
    hub.publicar(
        topico_tabela(TABELA), "mudanca",
        {"tabela": TABELA, "op": "UPDATE", "id": None, "agent_id": None},
    )


async def vigiar(parar: asyncio.Event) -> None:
    """Mantém a assinatura de presença, reconectando com backoff (2 s → 60 s)."""
    segredo = await ler_segredo("ESCRITORIO_ADMIN_SOCKETS_TOKEN")
    if not segredo:
        logger.info("Presença do escritório desligada: falta ESCRITORIO_ADMIN_SOCKETS_TOKEN.")
        return

    espera = _ESPERA_MINIMA
    while not parar.is_set():
        inicio = time.monotonic()
        try:
            async with websockets.connect(_url_do_socket(), open_timeout=15) as ws:
                salas = salas_ouvidas()
                presenca.zerar()
                await ws.send(json.dumps({"event": "listen", "roomIds": salas, "jwt": jwt_de_admin(segredo, salas)}))
                presenca.conectado = True
                _avisar()
                logger.info("Presença do escritório ligada em %d salas.", len(salas))
                async for bruto in ws:
                    try:
                        msg = json.loads(bruto)
                    except ValueError:
                        continue
                    if isinstance(msg, dict) and aplicar_mensagem(presenca, msg, datetime.now(timezone.utc)):
                        _avisar()
            raise ConnectionError("o play fechou a conexão")
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            if presenca.conectado or presenca.pessoas():
                presenca.conectado = False
                presenca.zerar()
                _avisar()
            if time.monotonic() - inicio >= _VIDA_QUE_CONTA:
                espera = _ESPERA_MINIMA
            logger.warning("Presença do escritório caiu (%s). Tentando de novo em %.0fs.", e, espera)
            try:
                await asyncio.wait_for(parar.wait(), timeout=espera)
            except asyncio.TimeoutError:
                pass
            espera = min(espera * 2, _ESPERA_MAXIMA)

    presenca.conectado = False
    logger.info("Presença do escritório encerrada.")
