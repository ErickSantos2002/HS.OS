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
from app.database import sessao
from app.realtime import hub, serializar, topico_canal, topico_tabela, topico_usuario

logger = logging.getLogger(__name__)

# Erguido no shutdown da aplicação (ver `app/main.py`). É o que permite às
# conexões abertas se despedirem em vez de segurar o processo.
_desligando = asyncio.Event()


def sinalizar_desligamento() -> None:
    _desligando.set()

router = APIRouter(tags=["realtime"])

# Sem tráfego, um proxy no meio derruba a conexão por ociosidade. O ping é mais
# barato que reconectar, e o cliente usa o silêncio prolongado como sinal de
# queda.
_INTERVALO_PING = 25


async def _canais_do_usuario(user_id: str, pedidos: list[str]) -> list[str]:
    """Dos canais pedidos, quais esta pessoa é membro.

    ⚠️ **Sem esta conferência qualquer usuário autenticado escutava qualquer
    canal**, inclusive privado, bastando saber o id — a assinatura era aceita
    como veio. Era furo real, e passar a publicar conteúdo de linha pelos
    tópicos o transformaria de "escuta o que não devia" em "recebe o que não
    devia".

    A autorização acontece **uma vez, na assinatura**, e não a cada evento. É o
    que torna o tempo real barato: filtrar por evento significaria uma consulta
    por mensagem publicada.
    """
    if not pedidos:
        return []
    async with sessao(role="authenticated", user_id=user_id) as conn:
        linhas = await conn.fetch(
            "SELECT channel_id::text AS id FROM public.channel_members "
            " WHERE user_id = $1 AND channel_id = ANY($2::uuid[])",
            user_id, pedidos,
        )
    return [l["id"] for l in linhas]


@router.websocket("/ws")
async def eventos(
    websocket: WebSocket,
    token: str = Query(description="JWT do usuário. Vai na query porque a API do navegador não permite cabeçalho."),
    canais: str = Query(default="", description="Ids de canal separados por vírgula."),
    tabelas: str = Query(default="", description="Nomes de tabela a observar, separados por vírgula."),
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

    pedidos = [c.strip() for c in canais.split(",") if c.strip()]
    permitidos = await _canais_do_usuario(user_id, pedidos)
    if len(permitidos) < len(pedidos):
        # Não é erro do cliente: a lista de canais dele pode estar velha depois
        # de perder acesso. Assina o que pode e segue.
        logger.info(
            "WS de %s pediu %d canais e pode em %d", user_id, len(pedidos), len(permitidos)
        )

    topicos = [topico_usuario(user_id)]
    topicos += [topico_canal(c) for c in permitidos]
    topicos += [topico_tabela(t.strip()) for t in tabelas.split(",") if t.strip()]

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

    async def vigiar_desligamento() -> None:
        """Fecha a conexão quando a aplicação está desligando.

        ⚠️ Sem isto o `uvicorn --reload` **trava**: o shutdown gracioso espera
        toda conexão fechar, e um WebSocket que nunca termina segura o processo
        para sempre. Descoberto em 07/08/2026 — o backend ficou preso em
        "Waiting for connections to close" com uma aba do navegador aberta, e o
        sintoma parecia endpoint lento.
        """
        while not _desligando.is_set():
            await asyncio.sleep(0.5)

    tarefas = [asyncio.create_task(t()) for t in (bombear, escutar, pingar, vigiar_desligamento)]
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
