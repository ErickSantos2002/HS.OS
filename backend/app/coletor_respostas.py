"""Coletor de respostas: grava a resposta do agente quando a tela fechou
(spec 2026-11-03, Frente B, B2).

⚠️ **Resposta de agente só era gravada com a tela aberta.** Quem buscava no
gateway era o `GET /reply`, em laço pelo navegador, e o `/recuperar`, ao abrir
a conversa. Perguntou e fechou o app: ninguém buscava — e sem resposta gravada
não há push (o push nasce do INSERT, `023`).

A cada `COLETOR_RESPOSTAS_SEGUNDOS` (padrão 5; 0 desliga), cada worker reserva
até 10 runs sem resposta, de menos de 30 min, em que a tela não pergunta há
45 s (cada `/reply` segura 20 s no `agent.wait`; com 20 s de limiar o coletor
entraria no meio de toda espera longa), e chama **`colher_resposta`** — o mesmo miolo do `/reply`. Não há segunda
leitura do `chat.history`: os defeitos catalogados dele (corte de 8.000, fatia
velha, piso que vira teto, sessão limpa) moram numa cópia só. Grava, dispara o
áudio e, se o contexto estourou, compacta e reenvia — tudo o que a tela faria
(esclarecimento 3).

⚠️ **Reserva entre os 2 workers** por `coletando_em` (`024`): o UPDATE com a
guarda no WHERE de fora devolve o run a um worker só. Em `executando` a
reserva é solta para a próxima passada; em `erro` o run é encerrado para o
coletor (`coleta_encerrada_em`) — repetir fazia o run velho engolir a
resposta da pergunta seguinte. Só falha de gateway tenta de novo, até 3 vezes.

⚠️ **Corrida com a tela.** Se a tela voltar no meio, as duas chamam o mesmo
miolo: a trava por run (mesmo processo), a reserva do `message_id` (entre
workers) e a trava de `_gravar_resposta` impedem a bolha dobrada.
"""
import asyncio
import logging
import os

import asyncpg

from app.database import sessao
from app.gateway import config as cfg
from app.gateway.client import ErroGateway

logger = logging.getLogger(__name__)

# O coletor espera pouco por run: são até 10 por passada, em série.
_ESPERA_MS = 1_500

SQL_RESERVAR_RUNS = """
    UPDATE public.agent_runs r SET coletando_em = now()
     WHERE r.run_id IN (
           SELECT a.run_id FROM public.agent_runs a
            WHERE a.message_id IS NULL
              AND a.redireciona_para IS NULL
              AND a.coleta_encerrada_em IS NULL
              AND a.criado_em > now() - interval '30 minutes'
              AND a.criado_em < now() - interval '20 seconds'
              AND (a.tela_perguntou_em IS NULL OR a.tela_perguntou_em < now() - interval '45 seconds')
              AND (a.coletando_em IS NULL OR a.coletando_em < now() - interval '30 seconds')
              -- A pergunta seguinte é fronteira: só o último run aberto da
              -- pessoa com o agente. O `_texto_da_resposta` junta tudo depois
              -- do `seq_antes`, e o run velho levaria a resposta do novo.
              AND NOT EXISTS (SELECT 1 FROM public.agent_runs n
                               WHERE n.user_id = a.user_id AND n.agent_id = a.agent_id AND n.criado_em > a.criado_em)
              -- "Nova conversa" depois do envio: o corte vira 0 e o run velho
              -- gravaria a conversa nova inteira.
              AND NOT EXISTS (SELECT 1 FROM public.conversation_resets cr
                               WHERE cr.user_id = a.user_id AND cr.agent_id = a.agent_id AND cr.created_at > a.criado_em)
            ORDER BY a.criado_em
            LIMIT 10
            FOR UPDATE SKIP LOCKED)
       AND r.message_id IS NULL
       AND r.coleta_encerrada_em IS NULL
       AND (r.coletando_em IS NULL OR r.coletando_em < now() - interval '30 seconds')
    RETURNING r.run_id, r.agent_id, r.session_key, r.seq_antes, r.user_id::text AS user_id
"""

SQL_SOLTAR = "UPDATE public.agent_runs SET coletando_em = NULL WHERE run_id = $1"

# O coletor desiste do run e não volta a ele.
SQL_ENCERRAR = ("UPDATE public.agent_runs SET coleta_encerrada_em = now() "
                "WHERE run_id = $1 AND coleta_encerrada_em IS NULL")

# Falha de gateway/conexão: conta, mantém a reserva (volta em 30 s) e desiste
# na terceira.
SQL_FALHOU = """
    UPDATE public.agent_runs
       SET coleta_tentativas = coleta_tentativas + 1,
           coleta_encerrada_em = CASE WHEN coleta_tentativas + 1 >= 3
                                      THEN now() ELSE coleta_encerrada_em END
     WHERE run_id = $1
    RETURNING coleta_tentativas
"""


def intervalo() -> int:
    try:
        return max(0, int(os.environ.get("COLETOR_RESPOSTAS_SEGUNDOS", "5")))
    except ValueError:
        return 5


async def passada(sessao_fn, colher, c) -> int:
    """Uma rodada: reserva e colhe cada run.

    - `pronta`: gravou (ou outro gravou); nada a fazer.
    - `executando`: o agente ainda trabalha; solta para a próxima passada.
    - `erro`: **encerra** — a tela também parava no primeiro erro. Repetir era
      o que fazia o run velho engolir a resposta da pergunta seguinte.
    - `ErroGateway`/conexão: conta a tentativa e mantém a reserva; desiste na 3ª.
    - outra exceção (defeito nosso): encerra.

    Devolve quantos runs foram reservados. Erro num run não para os outros.
    """
    async with sessao_fn(role="service_role") as conn:
        runs = await conn.fetch(SQL_RESERVAR_RUNS)
    for r in runs:
        acao, args = None, (r["run_id"],)
        try:
            saida = await colher(c, r["agent_id"], r["run_id"], r["session_key"],
                                 r["seq_antes"], r["user_id"], espera_ms=_ESPERA_MS,
                                 levantar_erro_gateway=True)
            if saida.status == "executando":
                acao = "soltar"
            elif saida.status == "erro":
                acao = "encerrar"
                logger.info("Coletor desistiu do run %s: %s", r["run_id"],
                            getattr(saida, "detalhe", ""))
            elif saida.status == "pronta":
                logger.info("Coletor gravou a resposta do run %s (%s).",
                            r["run_id"], r["agent_id"])
        except (ErroGateway, OSError, asyncio.TimeoutError) as e:
            logger.warning("Coletor: gateway falhou no run %s: %s", r["run_id"], e)
            acao = "falhou"
        except Exception as e:  # noqa: BLE001 — um run não derruba a passada
            logger.warning("Coletor: run %s quebrou, desistindo: %s", r["run_id"], e)
            acao = "encerrar"
        if acao is None:
            continue
        try:
            async with sessao_fn(role="service_role") as conn:
                if acao == "soltar":
                    await conn.execute(SQL_SOLTAR, *args)
                elif acao == "encerrar":
                    await conn.execute(SQL_ENCERRAR, *args)
                else:
                    await conn.fetchval(SQL_FALHOU, *args)
        except Exception as e:  # noqa: BLE001
            logger.warning("Coletor: não registrei %s do run %s: %s", acao, r["run_id"], e)
    return len(runs)


async def rodar(parar: asyncio.Event) -> None:
    """Laço de fundo do `lifespan`."""
    seg = intervalo()
    if not seg:
        logger.info("Coletor de respostas desligado (COLETOR_RESPOSTAS_SEGUNDOS=0).")
        return
    # Importado aqui: o router importa muita coisa, e o laço só precisa dele
    # depois que a aplicação subiu.
    from app.routers.conversations import colher_resposta

    logger.info("Coletor de respostas a cada %ds.", seg)
    avisou_sem_coluna = False
    while not parar.is_set():
        espera = seg
        try:
            c = await cfg.carregar()
            if c.configurado:
                await passada(sessao, colher_resposta, c)
        except asyncpg.UndefinedColumnError:
            # Código no ar antes da `024`: avisa uma vez e espera mais.
            if not avisou_sem_coluna:
                avisou_sem_coluna = True
                logger.warning("Coletor de respostas parado: aplicar a migração 024.")
            espera = 60
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 — o laço não pode morrer
            logger.warning("Coletor de respostas: passada falhou: %s", e)
        try:
            await asyncio.wait_for(parar.wait(), timeout=espera)
        except asyncio.TimeoutError:
            pass
