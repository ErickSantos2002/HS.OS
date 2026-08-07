"""Eventos em tempo real para o navegador.

Substitui o Realtime do Supabase (`postgres_changes`), que a tela usava para ver
mensagem de outra pessoa aparecer sem recarregar. Enquanto isso não existia, o
front resolvia com intervalo de 4 segundos — funcionava, mas é atraso visível e
tráfego constante mesmo com o canal parado.

**O evento nasce aqui, não no banco.** O Supabase escutava a replicação do
Postgres; nós publicamos no mesmo lugar onde a escrita acontece. É mais simples e
mais preciso — quem grava sabe exatamente o que mudou e para quem interessa.

⚠️ **Limite conhecido: isto vive na memória de um processo.** Com mais de um
worker do uvicorn, quem está conectado ao worker A não recebe o que foi
publicado no worker B. Hoje o backend roda em processo único e está correto;
se um dia precisar escalar, o caminho é `LISTEN`/`NOTIFY` do Postgres — que já
está lá e não precisa de peça nova. Está registrado em `docs/ROADMAP.md`.
"""

import asyncio
import json
import logging
from collections import defaultdict
from typing import Any

logger = logging.getLogger(__name__)


class Hub:
    """Assinantes por tópico.

    Um tópico é uma string qualquer que identifique o que se quer ouvir:
    `canal:<uuid>` para mensagens de um canal, `usuario:<uuid>` para o que é
    dirigido a uma pessoa. Quem publica escolhe o tópico; quem escuta assina o
    que a tela precisa.
    """

    def __init__(self) -> None:
        self._filas: dict[str, set[asyncio.Queue]] = defaultdict(set)

    def assinar(self, topicos: list[str]) -> asyncio.Queue:
        # Fila limitada: se um cliente lento parar de consumir, é melhor
        # descartar evento antigo do que crescer sem limite até derrubar o
        # processo. A tela recarrega ao voltar ao foco e se recupera.
        fila: asyncio.Queue = asyncio.Queue(maxsize=100)
        for t in topicos:
            self._filas[t].add(fila)
        return fila

    def cancelar(self, topicos: list[str], fila: asyncio.Queue) -> None:
        for t in topicos:
            self._filas[t].discard(fila)
            if not self._filas[t]:
                del self._filas[t]

    def publicar(self, topico: str, tipo: str, dados: Any) -> None:
        """Entrega a quem estiver ouvindo. Nunca levanta.

        Publicar não pode derrubar quem está gravando: se o envio do aviso
        falhar, a mensagem já está no banco e a tela a pega no próximo
        carregamento. O contrário — perder a escrita por causa do aviso — seria
        trocar o essencial pelo acessório.
        """
        assinantes = self._filas.get(topico)
        if not assinantes:
            return
        evento = {"topico": topico, "tipo": tipo, "dados": dados}
        for fila in list(assinantes):
            try:
                fila.put_nowait(evento)
            except asyncio.QueueFull:
                logger.warning("Assinante lento em %s — evento descartado.", topico)
            except Exception as e:  # noqa: BLE001
                logger.warning("Falha ao publicar em %s: %s", topico, e)

    @property
    def topicos_ativos(self) -> int:
        return len(self._filas)


hub = Hub()


def topico_canal(channel_id: str) -> str:
    return f"canal:{channel_id}"


def topico_usuario(user_id: str) -> str:
    return f"usuario:{user_id}"


def topico_tabela(nome: str) -> str:
    return f"tabela:{nome}"


def serializar(evento: dict) -> str:
    return json.dumps(evento, ensure_ascii=False, default=str)
