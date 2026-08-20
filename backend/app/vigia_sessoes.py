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

logger = logging.getLogger(__name__)

# Estável e só nosso: impede os dois workers do uvicorn de vigiarem em dobro.
# Diferente do `_TRAVA` do coletor de uso de propósito — são laços independentes
# e um não deve bloquear o outro.
_TRAVA = 815_140_018

# Fração da janela do modelo a partir da qual compactamos. 0,65 não é chute
# calibrado: é o meio-termo entre compactar cedo demais (perde contexto que
# ainda cabia) e tarde demais (não há segunda chance). O piso fixo de um agente
# nosso já é ~23 mil tokens numa janela de 65 mil — 36% da janela vai embora em
# arquivo e ferramenta antes da primeira pergunta —, então a margem real de
# manobra é menor do que a fração sugere.
_LIMIAR = 0.65

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


async def rondar_uma_vez() -> dict:
    """Uma ronda: compacta quem está perto, arquiva quem já travou."""
    try:
        c = await cfg.carregar()
        if not c.configurado:
            return {"ok": False, "motivo": "gateway não configurado"}
        cliente = obter_cliente(c.url, c.token)
        janela = await _janelas(cliente)
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

                if usado < limite * _LIMIAR:
                    continue

                try:
                    resp = await cliente.chamar("sessions.compact", {"key": chave})
                except (ErroGateway, OSError) as e:
                    logger.warning("Vigia: compactar %s falhou: %s", chave, e)
                    continue

                corpo = resp.get("payload") or resp
                if corpo.get("compacted"):
                    compactadas.append(chave)
                    logger.info("Vigia: compactei %s (estava em %d/%d).",
                                chave, usado, limite)
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
