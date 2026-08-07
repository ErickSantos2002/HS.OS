"""Escuta as mudanças do banco e as republica no hub — o coração do tempo real.

Substitui o `postgres_changes` do Supabase. O caminho é:

    UPDATE → trigger → pg_notify → **este módulo** → hub → WebSocket → navegador

⚠️ **Por que capturar no banco e não nos endpoints.** A alternativa era cada
rota de escrita chamar `hub.publicar()` depois de commitar. Seria regressão: o
`postgres_changes` observava o **banco**, e nele escrevem também os agentes (pelo
`/broadcast`), o coletor da VPS, a ponte de arquivos e qualquer manutenção via
`psql`. Publicar só nos endpoints deixaria a tela cega para tudo isso — inclusive
para a mensagem que um agente publica num canal, que é justamente o caso que
precisa aparecer sem recarregar.

⚠️ **O evento nunca leva conteúdo da linha.** Dois motivos, e o segundo manda:

1. O `pg_notify` tem limite de 8000 bytes. O `content` de `channel_messages`
   passa disso sem esforço, e a notificação seria descartada em silêncio.
2. **Segurança.** Mandar a linha junto entregaria conteúdo a quem o RLS negaria.
   Quem quer o conteúdo busca pelo endpoint normal — e lá o RLS decide. O custo
   é uma ida a mais; o benefício é não ter uma segunda cópia da autorização,
   fora do banco, para manter em dia.

⚠️ **O destino do evento é escolhido aqui, e é o que substitui o `filter=` do
Supabase.** Treze das assinaturas antigas filtravam por coluna
(`channel_id=eq.…`, `user_id=eq.…`). Publicar tudo num tópico por tabela
funcionaria, mas cada aba recarregaria a cada mudança de qualquer pessoa. Então:

- linha com `channel_id` → vai para o tópico **do canal**, que exige ser membro
- linha com `user_id` → vai para o tópico **da pessoa**
- sempre, também → tópico **da tabela**, com `agent_id` junto

O `user_id` e o `channel_id` **não** entram no evento do tópico de tabela: ali
eles seriam metadado vazando ("fulano recebeu notificação"). Eles roteiam, não
viajam. O `agent_id` viaja porque não é segredo — é o nome do agente, que todo
mundo vê na tela.

⚠️ **`LISTEN` morre com a conexão e a falha é silenciosa.** Nada quebra, nada
loga por si: o tempo real simplesmente para de chegar, e o sintoma é "a tela não
atualiza mais" horas depois. Por isso o laço reconecta sempre, e avisa no log
quando volta.
"""

import asyncio
import json
import logging

import asyncpg

from app.config import settings
from app.realtime import hub, topico_canal, topico_tabela, topico_usuario

logger = logging.getLogger(__name__)

CANAL = "hsos_mudancas"

# Quanto esperar antes de tentar de novo. Sobe até o teto para não martelar um
# banco que está fora, e volta ao mínimo assim que conecta.
_ESPERA_MINIMA = 1.0
_ESPERA_MAXIMA = 30.0


def _ao_receber(_conexao, _pid, _canal, carga: str) -> None:
    """Chamado pelo asyncpg a cada NOTIFY. Não pode levantar.

    O asyncpg roda isto fora do fluxo de qualquer requisição: uma exceção aqui
    não chega a lugar nenhum, só some. Por isso o try amplo.
    """
    try:
        evento = json.loads(carga)
        tabela, op, ident = evento["tabela"], evento["op"], evento.get("id")

        publico = {"tabela": tabela, "op": op, "id": ident,
                   "agent_id": evento.get("agent_id")}

        # Tópico da tabela: chega a todo mundo que a observa, então não leva
        # nada que identifique pessoa ou canal.
        hub.publicar(topico_tabela(tabela), "mudanca", publico)

        # Tópicos dirigidos: quem assina já provou que tem direito, então aqui
        # o evento pode dizer de qual canal ou de quem ele é.
        if canal := evento.get("channel_id"):
            hub.publicar(topico_canal(canal), "mudanca", {**publico, "channel_id": canal})
        if usuario := evento.get("user_id"):
            hub.publicar(topico_usuario(usuario), "mudanca", {**publico, "user_id": usuario})
    except Exception as e:  # noqa: BLE001
        logger.warning("Notificação malformada de %s: %s", CANAL, e)


async def escutar(parar: asyncio.Event) -> None:
    """Mantém uma conexão dedicada ouvindo o canal, reconectando quando cai.

    Conexão **dedicada** e fora do pool: uma conexão em `LISTEN` fica ocupada
    indefinidamente, e tirá-la do pool tiraria uma conexão de quem atende
    requisição.
    """
    espera = _ESPERA_MINIMA
    while not parar.is_set():
        conexao = None
        try:
            conexao = await asyncpg.connect(settings.DATABASE_URL)
            await conexao.add_listener(CANAL, _ao_receber)
            logger.info("Escuta de mudanças ligada em %s.", CANAL)
            espera = _ESPERA_MINIMA

            # Nada a fazer no laço: o asyncpg entrega as notificações por
            # callback. Só precisamos segurar a conexão e perceber se ela caiu.
            while not parar.is_set():
                await asyncio.sleep(5)
                if conexao.is_closed():
                    raise ConnectionError("a conexão de escuta caiu")

        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001
            logger.warning(
                "Escuta de mudanças caiu (%s). Tentando de novo em %.0fs.", e, espera
            )
            try:
                await asyncio.wait_for(parar.wait(), timeout=espera)
            except asyncio.TimeoutError:
                pass
            espera = min(espera * 2, _ESPERA_MAXIMA)
        finally:
            if conexao is not None and not conexao.is_closed():
                await conexao.close()

    logger.info("Escuta de mudanças encerrada.")
