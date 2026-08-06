"""Cliente do OpenClaw Gateway.

O gateway fala **WebSocket com JSON-RPC**, não REST — o código herdado do dn.os
chamava `${url}/api/health` e `${url}/v1/models`, caminhos que não existem mais
(devolvem 404 e o HTML do painel). O contrato abaixo foi levantado testando ao
vivo contra o gateway 2026.7.1-2.

Identidade importa: só `client.id="gateway-client"` + `client.mode="backend"`
recebe os scopes de operador. Qualquer outra combinação conecta e é negada em
todo método com "missing scope: operator.read". Os scopes concedidos são os que
o cliente pediu — ver `SCOPES` abaixo.

Este módulo é o único ponto do sistema que conhece o token do gateway. Nada
disso pode vazar para a resposta de um endpoint.
"""

import asyncio
import json
import logging
import uuid
from typing import Any

import websockets

logger = logging.getLogger(__name__)

PROTOCOLO = 4
TIMEOUT_RPC = 30  # a doc define 30s como padrão por requisição
TIMEOUT_HANDSHAKE = 15

# Scopes pedidos no handshake. O gateway não infere o que o cliente precisa: ele
# concede exatamente o que foi pedido, e nega o resto método a método.
#
# `operator.admin` está aqui porque sem ele `agents.update` responde
# "missing scope: operator.admin" — a leitura funcionava e mascarou a falta até
# a primeira escrita (Lote 2b). Pedir a mais é inofensivo quando o gateway não
# concede: ele devolve só o subconjunto autorizado, e `_garantir_conexao`
# registra o que veio.
SCOPES = ["operator.read", "operator.write", "operator.admin"]
SCOPE_MINIMO = "operator.read"


class ErroGateway(Exception):
    """Falha vinda do gateway ou da conexão com ele."""

    def __init__(self, mensagem: str, codigo: str | None = None):
        super().__init__(mensagem)
        self.codigo = codigo


class ClienteGateway:
    """Conexão persistente com o gateway, com reconexão sob demanda.

    Uma instância por processo. `chamar()` serializa as requisições sob um lock:
    o protocolo correlaciona resposta por `id`, mas ler do socket em paralelo
    exigiria um demultiplexador — desnecessário para o volume atual, e uma peça
    a menos para dar errado.
    """

    def __init__(self, url: str, token: str):
        self.url = self._normalizar(url)
        self._token = token
        self._ws: Any = None
        self._lock = asyncio.Lock()
        self.info_servidor: dict[str, Any] = {}
        self.scopes: list[str] = []

    @staticmethod
    def _normalizar(url: str) -> str:
        """Aceita http(s):// ou ws(s):// e devolve sempre o esquema WebSocket."""
        url = (url or "").strip().rstrip("/")
        if url.startswith("https://"):
            return "wss://" + url[len("https://"):]
        if url.startswith("http://"):
            return "ws://" + url[len("http://"):]
        return url

    async def _garantir_conexao(self) -> None:
        if self._ws is not None and self._ws.state.name == "OPEN":
            return

        logger.info("Conectando ao gateway em %s", self.url)
        self._ws = await websockets.connect(self.url, max_size=None, open_timeout=TIMEOUT_HANDSHAKE)

        # O gateway abre com um desafio antes de aceitar o connect.
        await asyncio.wait_for(self._ws.recv(), TIMEOUT_HANDSHAKE)

        pedido = {
            "type": "req",
            "id": str(uuid.uuid4()),
            "method": "connect",
            "params": {
                "minProtocol": PROTOCOLO,
                "maxProtocol": PROTOCOLO,
                # Esta identidade é o que concede os scopes de operador.
                "client": {
                    "id": "gateway-client",
                    "version": "0.1.0",
                    "platform": "linux",
                    "mode": "backend",
                },
                "role": "operator",
                "scopes": SCOPES,
                "auth": {"token": self._token},
            },
        }
        await self._ws.send(json.dumps(pedido))

        # Eventos podem chegar antes da resposta; ignoramos até achar o "res".
        while True:
            msg = json.loads(await asyncio.wait_for(self._ws.recv(), TIMEOUT_HANDSHAKE))
            if msg.get("type") != "res":
                continue
            if not msg.get("ok"):
                erro = msg.get("error") or {}
                await self.fechar()
                raise ErroGateway(
                    erro.get("message", "Gateway recusou a conexão."), erro.get("code")
                )
            self.info_servidor = msg.get("payload") or {}
            break

        escopos = (self.info_servidor.get("auth") or {}).get("scopes") or []
        self.scopes = list(escopos)
        if SCOPE_MINIMO not in escopos:
            await self.fechar()
            raise ErroGateway(
                "Gateway conectou sem permissão de leitura. Verifique o token "
                f"(scopes recebidos: {escopos or 'nenhum'})."
            )
        faltando = [s for s in SCOPES if s not in escopos]
        if faltando:
            # Não é erro: a leitura segue funcionando. Mas a escrita vai falhar
            # lá na frente com "missing scope", e sem este aviso o sintoma
            # aparece longe da causa.
            logger.warning(
                "Gateway não concedeu os scopes %s — métodos de escrita vão falhar.",
                faltando,
            )
        logger.info(
            "Gateway conectado: versão %s, scopes %s",
            (self.info_servidor.get("server") or {}).get("version"),
            escopos,
        )

    async def chamar(self, metodo: str, params: dict | None = None) -> dict:
        """Executa um método RPC e devolve o payload. Reconecta uma vez se a
        conexão tiver morrido em silêncio — o gateway fecha com código 4000
        quando o cliente fica calado além de 2× o `tickIntervalMs`."""
        async with self._lock:
            for tentativa in (1, 2):
                try:
                    await self._garantir_conexao()
                    return await self._executar(metodo, params or {})
                except (websockets.ConnectionClosed, ConnectionError, asyncio.TimeoutError) as exc:
                    self._ws = None
                    if tentativa == 2:
                        raise ErroGateway(f"Gateway indisponível: {exc}") from exc
                    logger.warning("Conexão com o gateway caiu (%s), reconectando…", exc)
        raise ErroGateway("Gateway indisponível.")

    async def _executar(self, metodo: str, params: dict) -> dict:
        rid = str(uuid.uuid4())
        await self._ws.send(json.dumps({"type": "req", "id": rid, "method": metodo, "params": params}))

        while True:
            msg = json.loads(await asyncio.wait_for(self._ws.recv(), TIMEOUT_RPC))
            # Eventos de broadcast chegam misturados; só nos interessa nosso id.
            if msg.get("type") != "res" or msg.get("id") != rid:
                continue
            if msg.get("ok"):
                return msg.get("payload") or {}
            erro = msg.get("error") or {}
            raise ErroGateway(erro.get("message", "Erro no gateway."), erro.get("code"))

    async def fechar(self) -> None:
        if self._ws is not None:
            try:
                await self._ws.close()
            except Exception:  # noqa: BLE001 — fechar não pode derrubar nada
                pass
            self._ws = None


# ── Instância única ──────────────────────────────────────────────────────
_cliente: ClienteGateway | None = None
_cliente_espera: ClienteGateway | None = None


def obter_cliente(url: str, token: str) -> ClienteGateway:
    """Reaproveita a conexão enquanto a configuração não mudar."""
    global _cliente
    if _cliente is None or _cliente.url != ClienteGateway._normalizar(url) or _cliente._token != token:
        _cliente = ClienteGateway(url, token)
    return _cliente


def obter_cliente_de_espera(url: str, token: str) -> ClienteGateway:
    """Conexão **separada**, só para chamadas que ficam penduradas.

    `agent.wait` segura a resposta até o agente terminar — é o long-poll que dá
    ao chat sensação de tempo real sem WebSocket. O problema é que `chamar()`
    serializa tudo sob um lock por conexão: uma espera de 20s na conexão
    principal congelaria `agents.list`, `models.list` e todo o resto pelo mesmo
    tempo, para todo mundo.

    Por isso as esperas vivem numa segunda conexão. O gateway aceita várias, e o
    custo é uma sessão WebSocket a mais.
    """
    global _cliente_espera
    if (
        _cliente_espera is None
        or _cliente_espera.url != ClienteGateway._normalizar(url)
        or _cliente_espera._token != token
    ):
        _cliente_espera = ClienteGateway(url, token)
    return _cliente_espera


async def encerrar_cliente() -> None:
    """Fecha as duas conexões no desligamento. Esquecer a de espera deixaria um
    WebSocket aberto a cada reinício, e o gateway acumularia sessões zumbis."""
    global _cliente, _cliente_espera
    if _cliente is not None:
        await _cliente.fechar()
        _cliente = None
    if _cliente_espera is not None:
        await _cliente_espera.fechar()
        _cliente_espera = None
