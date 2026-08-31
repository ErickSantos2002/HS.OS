"""Vigia das sessões do gateway — compacta antes de estourar, arquiva o que travou.

⚠️ **A compactação é prevenção, não conserto.** Levantado em 20/08/2026: uma
sessão que já passou da janela recusa `sessions.compact` com
`{"ok": false, "compacted": false, "reason": "Already compacted"}` e fica assim
para sempre. A `agent:iris:main` tinha **três** marcadores de `Compaction` no
histórico e ainda respondia "Context overflow: prompt too large for the model" a
qualquer pergunta, inclusive "responda apenas: ok". Depois desse ponto só
apagando a sessão.

Por isso este laço age **cedo**, num limiar bem abaixo da janela, em vez de
esperar o erro aparecer.

⚠️ **O buraco que ele fecha é a sessão sem dono.** A auto-compactação que já
existe mora no `/reply`, que só roda quando alguém está com a tela aberta
esperando resposta. A `agent:<id>:main` — que é onde caem os `sessions_send` de
um agente para outro — não tem ninguém perguntando por ela. Ela acumula até
travar, e quando trava **derruba todo mundo que tentar acionar aquele agente**:
em 20/08 a `nina` disse ao CEO "deixa eu acioná-los em paralelo", bateu na
`iris` travada, e o que ele viu foi "Envio desconhecido".

⚠️ **`totalTokens` do `sessions.list` é o tamanho ATUAL do contexto**, não
consumo acumulado. Medido mandando três turnos curtos numa sessão nova: 23.416 →
23.450 → 23.476, ou seja cresce o tamanho das mensagens novas, não o prompt
inteiro a cada turno. Eu já li isso errado nos dois sentidos no mesmo dia; o
teste está aqui para quem duvidar repetir em trinta segundos.

⚠️ **Sessão travada aparece com `totalTokens: 0`**, não com um número alto — o
contador só é atualizado por turno que deu certo, e nela nenhum dá. Então o
limiar sozinho não a encontra; quem a encontra é a checagem de estar acima da
janela, feita antes.
"""
from __future__ import annotations

import asyncio
import logging
import os

from app.database import sessao
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente
from app.guardiao_briefings import conferir as conferir_briefings
from app.guardiao_crons import conferir as conferir_crons

logger = logging.getLogger(__name__)

# Estável e só nosso: impede os dois workers do uvicorn de vigiarem em dobro.
# Diferente do `_TRAVA` do coletor de uso de propósito — são laços independentes
# e um não deve bloquear o outro.
_TRAVA = 815_140_018

# Fração da janela **útil** a partir da qual compactamos. 0,85 não é chute
# calibrado: é o meio-termo entre compactar cedo demais (perde contexto que
# ainda cabia) e tarde demais (não há segunda chance). O piso fixo de um agente
# nosso já é ~23 mil tokens numa janela de 65 mil — 36% da janela vai embora em
# arquivo e ferramenta antes da primeira pergunta —, então a margem real de
# manobra é menor do que a fração sugere.
#
# ⚠️ **A fração mudou junto com o denominador, e 0,85 é MAIS cedo que o 0,65 de
# antes.** Sobre a janela crua, 0,65 dava 42.598 — depois do ponto de falha.
# Sobre a útil, 0,85 dá 35.306. Manter 0,65 aqui dispararia em 26.998, e como o
# piso de um agente nosso é ~25.124, isso é compactar uma sessão com 1.874
# tokens de conversa: gasta a compactação numa sessão que mal começou. Em 0,85
# a sessão já usou 62% do espaço real e ainda sobram ~6.200 para a execução em
# curso terminar.
_LIMIAR = 0.85

# ⚠️ **Teto absoluto, porque a fração deixou de bastar em 31/08/2026.**
#
# Naquele dia o `contextWindow` do DeepSeek foi corrigido de 65.536 para
# 1.000.000 — o `deepseek-chat` roteia para o V4 Flash desde 24/07 e a config
# declarava 6,5% da capacidade real. Como este vigia lê a janela do gateway em
# vez de fixá-la (e isso está certo), o limiar acompanhou sozinho: de 35.306
# para ~829.600.
#
# Só que o defeito que se queria consertar era a execução estourar em 41K, não
# "a sessão é pequena demais". Deixar crescer 23× troca um problema por outro:
# o prompt inteiro é reenviado a cada turno, então contexto grande é custo e
# latência em TODO turno seguinte, não uma vez.
#
# 150.000 sai de duas medidas, não de gosto: a maior sessão real já observada
# foi a do `atlas` em 31/08, com 66k — o teto deixa mais do que o dobro de folga
# — e o piso de um agente nosso é ~25k, então ainda sobram ~125k de conversa,
# contra os ~16k do regime antigo.
#
# ⚠️ **Se o teto começar a ser atingido de verdade, subi-lo é a resposta certa.**
# O que não se deve fazer é voltar a depender só da fração: numa janela de 1M ela
# significa "compacte quando o turno já custar caro".
_TETO = 150_000


def _ponto_de_compactar(limite: int, reserva: int) -> int:
    """A partir de quantos tokens este vigia compacta a sessão.

    A janela útil é `limite − reserva` — uma execução estoura ali, não na janela
    crua. Sobre ela vale a fração; sobre a fração vale o teto.
    """
    util = max(limite - reserva, 1)
    return max(1, min(int(util * _LIMIAR), _TETO))

# ⚠️ **A janela útil NÃO é a janela do modelo.** O gateway reserva
# `reserveTokens` para conseguir compactar, e uma execução estoura ao cruzar
# `janela − reserva`, não `janela`. Multiplicar o limiar pela janela crua põe o
# gatilho ACIMA do ponto de falha e abre uma faixa morta: a sessão falha em toda
# execução e o vigia, olhando o denominador errado, acha que ela está folgada.
#
# Em 21/08/2026 isto era real e diário. A sessão do cron de Serviços do `atlas`
# estava em 40.588 tokens:
#
#     janela do deepseek-chat            65.536
#     − reserveTokens                    24.000
#     ─────────────────────────────────────────
#     janela útil                        41.536   ← estoura aqui
#     limiar antigo (0,65 × 65.536)      42.598   ← só agiria 1.062 depois
#
# 40.588 é 98% da janela útil e 62% da crua. O briefing de Serviços falhava com
# "Context overflow" todo dia e esta ronda passava por ele sem tocar.
_RESERVA_PADRAO = 24_000

# Sessão que uma pessoa está olhando. Quem cuida delas é o `/reply`, que
# compacta e **refaz a pergunta** na hora, com a pessoa esperando. Aqui só as
# compactamos preventivamente; arquivar uma por baixo do pano faria a resposta
# seguinte sair sem memória sem ninguém entender por quê.
_PREFIXO_DE_GENTE = "hsos-"


def intervalo() -> int:
    """Segundos entre rondas. `0` desliga."""
    try:
        return max(0, int(os.environ.get("VIGIA_SESSOES_SEGUNDOS", "600")))
    except ValueError:
        return 600


def _sem_dono(chave: str) -> bool:
    """`agent:<id>:<sufixo>` cujo sufixo não é conversa de gente.

    Pega `main`, as `sistema-*` que sobram da criação de agente e as `cron:*`.
    """
    partes = chave.split(":", 2)
    return (
        len(partes) >= 3
        and partes[0] == "agent"
        and not partes[2].startswith(_PREFIXO_DE_GENTE)
    )


async def _janelas(cliente) -> dict[str, int]:
    """`agentId` → janela de contexto do modelo dele, em tokens."""
    modelos: dict[str, int] = {}
    r = await cliente.chamar("models.list", {})
    for m in (r.get("payload") or r).get("models") or []:
        if (j := m.get("contextWindow")):
            modelos[str(m.get("id"))] = int(j)

    janela: dict[str, int] = {}
    r = await cliente.chamar("agents.list", {})
    for a in (r.get("payload") or r).get("agents") or []:
        modelo = a.get("model")
        if isinstance(modelo, dict):
            modelo = modelo.get("primary")
        if not modelo:
            continue
        # `agents.list` devolve "deepseek/deepseek-chat"; o `models.list` indexa
        # pelo id nu. Aceitamos os dois para não depender de qual lado mudar.
        alvo = modelos.get(str(modelo)) or modelos.get(str(modelo).split("/")[-1])
        if alvo:
            janela[str(a.get("id"))] = alvo
    return janela


async def _reserva(cliente) -> int:
    """Tokens que o gateway guarda para a própria compactação.

    Vem de `agents.defaults.compaction.reserveTokens`. Ler em vez de fixar
    importa porque mexer nesse número no gateway muda silenciosamente o ponto em
    que toda execução passa a estourar — e o vigia tem que acompanhar.
    """
    try:
        r = await cliente.chamar("config.get", {})
    except (ErroGateway, OSError) as e:
        logger.warning("Vigia: não li reserveTokens (%s); assumo %d.", e, _RESERVA_PADRAO)
        return _RESERVA_PADRAO
    conf = r.get("payload") or r
    conf = conf.get("config", conf)
    comp = ((conf.get("agents") or {}).get("defaults") or {}).get("compaction") or {}
    valor = comp.get("reserveTokens")
    if isinstance(valor, (int, float)) and valor > 0:
        return int(valor)
    return _RESERVA_PADRAO


async def rondar_uma_vez() -> dict:
    """Uma ronda: compacta quem está perto, arquiva quem já travou."""
    try:
        c = await cfg.carregar()
        if not c.configurado:
            return {"ok": False, "motivo": "gateway não configurado"}
        cliente = obter_cliente(c.url, c.token)
        janela = await _janelas(cliente)
        reserva = await _reserva(cliente)
        r = await cliente.chamar("sessions.list", {"limit": 1000})
    except (ErroGateway, OSError) as e:
        logger.warning("Vigia: não consegui ler o gateway: %s", e)
        return {"ok": False, "motivo": str(e)}

    compactadas, arquivadas, olhadas = [], [], 0

    async with sessao(role="service_role") as conn:
        if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", _TRAVA):
            return {"ok": True, "pulado": True}
        try:
            for s in (r.get("payload") or r).get("sessions") or r.get("sessions") or []:
                chave = s.get("key") or ""
                partes = chave.split(":", 2)
                if len(partes) < 3 or partes[0] != "agent":
                    continue
                limite = janela.get(partes[1])
                if not limite:
                    continue
                olhadas += 1
                usado = s.get("totalTokens") or 0

                # ⚠️ **O indicador de contexto da tela lia um espelho que ninguém
                # enchia.** `public.agent_context_state` só era escrita por
                # `POST /uso/varrer-contexto`, endpoint sem um único chamador em
                # todo o repositório — mesma doença dos crons. A tabela tinha
                # zero linhas desde sempre e o cabeçalho do chat mostrava
                # "contexto 0%" para todo mundo, o tempo inteiro.
                #
                # ⚠️ **E a janela NÃO é o `contextTokens` do gateway.** Aquele
                # campo volta 1.048.576 em TODAS as sessões, idêntico — é um
                # teto genérico, não a janela do modelo deste agente (65.536 no
                # deepseek). Usá-lo como denominador daria 2% onde o certo é 35%.
                # A janela boa é a do `models.list`, que este laço já resolveu.
                if usado > 0:
                    await conn.execute(
                        """INSERT INTO public.agent_context_state
                               (session_key, agent_id, model, total_tokens,
                                context_tokens, updated_at)
                           VALUES ($1, $2, $3, $4, $5, now())
                           ON CONFLICT (session_key) DO UPDATE SET
                               agent_id = EXCLUDED.agent_id,
                               model = EXCLUDED.model,
                               total_tokens = EXCLUDED.total_tokens,
                               context_tokens = EXCLUDED.context_tokens,
                               updated_at = now()""",
                        chave, partes[1], s.get("model"), usado, limite)

                # Já passou da janela: compactar não vai adiantar. Se é sessão
                # sem dono, arquivar é o único jeito de o próximo
                # `sessions_send` funcionar. O `sessions.delete` do gateway
                # move o arquivo para `sessions/` em vez de destruir.
                if usado > limite:
                    if not _sem_dono(chave):
                        continue
                    try:
                        await cliente.chamar("sessions.delete", {"key": chave})
                        arquivadas.append(chave)
                        logger.warning(
                            "Vigia: %s estava em %d/%d e não compacta mais; arquivei.",
                            chave, usado, limite)
                    except (ErroGateway, OSError) as e:
                        logger.warning("Vigia: não consegui arquivar %s: %s", chave, e)
                    continue

                # A decisão é contra a janela útil; o `limite` cru continua
                # valendo para o ramo de cima, que é sobre compactar ser
                # possível, e para o espelho de contexto da tela.
                if usado < _ponto_de_compactar(limite, reserva):
                    continue

                try:
                    resp = await cliente.chamar("sessions.compact", {"key": chave})
                except (ErroGateway, OSError) as e:
                    logger.warning("Vigia: compactar %s falhou: %s", chave, e)
                    continue

                corpo = resp.get("payload") or resp
                if corpo.get("compacted"):
                    compactadas.append(chave)
                    logger.info("Vigia: compactei %s (estava em %d/%d úteis, "
                                "janela %d).", chave, usado, util, limite)
                elif _sem_dono(chave):
                    # Recusou abaixo da janela — quase sempre "Already
                    # compacted", que é o aviso de que não há segunda chance.
                    # Numa sessão sem dono, arquivar agora é melhor que esperar
                    # o estouro que ninguém vai ver.
                    try:
                        await cliente.chamar("sessions.delete", {"key": chave})
                        arquivadas.append(chave)
                        logger.warning("Vigia: %s recusou compactar (%s); arquivei.",
                                       chave, corpo.get("reason"))
                    except (ErroGateway, OSError) as e:
                        logger.warning("Vigia: não consegui arquivar %s: %s", chave, e)
        finally:
            try:
                await conn.execute("SELECT pg_advisory_unlock($1)", _TRAVA)
            except Exception:  # noqa: BLE001
                logger.debug("Vigia: a trava cai com a conexão.")

    # ⚠️ **Disparar o cron não é o mesmo que o briefing existir.** Um agente que
    # estoura o contexto no meio não deixa rastro: nenhum documento, nenhum erro
    # na tela. Quem confere o efeito é o guardião, que roda na mesma ronda.
    try:
        await conferir_briefings(cliente)
    except Exception:  # noqa: BLE001
        logger.exception("Vigia: o guardião dos briefings falhou; segue.")

    # ⚠️ **E agendamento desgovernado não deixa rastro no lugar onde se olha.**
    # Em 25/08/2026 um cron de 3 minutos rodou 560 vezes em 28 horas gastando
    # token e enchendo a Base de Conhecimento, e o que o interrompeu foi uma
    # pessoa abrir a tela por outro motivo. Este guardião é o disjuntor: desliga
    # o que dispara demais e avisa. Roda na mesma ronda porque o gateway já está
    # conectado aqui — e porque um vigia que dependesse de outro laço seria mais
    # uma peça para falhar em silêncio.
    try:
        await conferir_crons(cliente)
    except Exception:  # noqa: BLE001
        logger.exception("Vigia: o guardião dos agendamentos falhou; segue.")

    # O estado de um envio vive minutos; a linha em `agent_runs` fica para sempre
    # se ninguém a varrer. Uma semana é folga larga sobre isso e ainda deixa a
    # tabela servir para investigar o que aconteceu ontem.
    async with sessao(role="service_role") as conn:
        antigas = await conn.fetchval(
            """DELETE FROM public.agent_runs
                WHERE criado_em < now() - interval '7 days'
            RETURNING 1""")
    if antigas:
        logger.info("Vigia: limpei envios com mais de 7 dias.")

    return {"ok": True, "olhadas": olhadas,
            "compactadas": compactadas, "arquivadas": arquivadas}


async def rodar(parar: asyncio.Event) -> None:
    """Laço de fundo. Uma ronda imediata e depois a cada `intervalo()`."""
    seg = intervalo()
    if not seg:
        logger.info("Vigia de sessões desligado (VIGIA_SESSOES_SEGUNDOS=0).")
        return
    logger.info("Vigia de sessões a cada %ds (limiar %.0f%% da janela).",
                seg, _LIMIAR * 100)
    while not parar.is_set():
        try:
            await rondar_uma_vez()
        except Exception:  # noqa: BLE001
            # Igual ao coletor: o túnel cai, o gateway reinicia, e o vigia tem
            # que estar lá quando voltar.
            logger.exception("Vigia de sessões falhou numa ronda; segue na próxima.")
        try:
            await asyncio.wait_for(parar.wait(), timeout=seg)
        except asyncio.TimeoutError:
            pass
