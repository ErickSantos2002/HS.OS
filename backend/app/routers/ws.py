"""Canal WebSocket com o navegador.

Uma conexão por aba. O cliente diz o que quer ouvir e recebe eventos até
fechar.

**Por que o token vai na query e não no cabeçalho:** a API `WebSocket` do
navegador não deixa definir cabeçalhos — não há como mandar `Authorization`.
É a mesma limitação que obriga os buckets públicos de storage a serem abertos.
O token vai em `?token=`, e por isso a conexão **precisa** ser `wss://` em
produção: em `ws://` ele viajaria em claro. Ver `docs/DEPLOY.md`.
"""

import asyncio
import logging

from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from app.auth.security import ler_token
from app.realtime import hub, serializar, topico_canal, topico_usuario

logger = logging.getLogger(__name__)

router = APIRouter(tags=["realtime"])

# Sem tráfego, um proxy no meio derruba a conexão por ociosidade. O ping é mais
# barato que reconectar, e o cliente usa o silêncio prolongado como sinal de
# queda.
_INTERVALO_PING = 25


@router.websocket("/ws")
async def eventos(
    websocket: WebSocket,
    token: str = Query(description="JWT do usuário. Vai na query porque a API do navegador não permite cabeçalho."),
    canais: str = Query(default="", description="Ids de canal separados por vírgula."),
):
    try:
        dados = ler_token(token)
        user_id = dados.get("sub")
    except Exception:
        user_id = None

    if not user_id:
        # 1008 = policy violation. Recusa antes de aceitar: assim o cliente
        # distingue "token inválido" de "caiu depois", e não fica tentando de
        # novo com a mesma credencial.
        await websocket.close(code=1008, reason="Token inválido.")
        return

    topicos = [topico_usuario(user_id)]
    topicos += [topico_canal(c.strip()) for c in canais.split(",") if c.strip()]

    await websocket.accept()
    fila = hub.assinar(topicos)
    logger.info("WS conectado: usuário %s, %d tópicos", user_id, len(topicos))

    async def bombear() -> None:
        """Fila → navegador."""
        while True:
            evento = await fila.get()
            await websocket.send_text(serializar(evento))

    async def escutar() -> None:
        """Navegador → nada, por enquanto.

        Precisa existir mesmo sem uso: sem alguém lendo, o `receive` do
        Starlette não processa o frame de fechamento e a desconexão só é
        percebida na próxima escrita — que pode demorar muito num canal parado.
        """
        while True:
            await websocket.receive_text()

    async def pingar() -> None:
        while True:
            await asyncio.sleep(_INTERVALO_PING)
            await websocket.send_text(serializar({"tipo": "ping"}))

    tarefas = [asyncio.create_task(t()) for t in (bombear, escutar, pingar)]
    try:
        # A primeira que terminar encerra a conexão — seja desconexão do
        # cliente (escutar) ou erro de escrita (bombear/pingar).
        await asyncio.wait(tarefas, return_when=asyncio.FIRST_COMPLETED)
    except WebSocketDisconnect:
        pass
    except Exception as e:  # noqa: BLE001
        logger.info("WS de %s encerrado: %s", user_id, e)
    finally:
        for t in tarefas:
            t.cancel()
        hub.cancelar(topicos, fila)
        logger.info("WS desconectado: usuário %s", user_id)
