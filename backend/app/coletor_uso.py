"""Copia o consumo do gateway para `usage_events`, para o histórico sobreviver.

**Por que existe.** O `GET /agents/{id}/consumo` sabe cair para o `sessions.list`
quando a tabela está vazia, e isso fez o painel parar de mostrar US$ 0,00 em
14/08/2026. Mas o gateway só guarda o estado **vivo**: sessão podada leva o
consumo junto, e "quanto gastamos em julho" não tem de onde sair. Este módulo é
o que transforma o estado vivo em série temporal.

Quando ele começa a escrever, o `/consumo` volta a preferir a tabela sozinho —
a precedência já está lá e não precisa mudar nada na tela.

⚠️ **`totalTokens` da sessão é CUMULATIVO.** Gravar o valor cheio a cada ciclo
somaria a mesma conversa muitas vezes. O que entra é a **diferença** entre o que
o gateway diz agora e o que já registramos para aquela sessão.

⚠️ **Custo vem zerado para provedor customizado.** O gateway não precifica o
DeepSeek — as sessões dele voltam com `estimatedCostUsd: 0` enquanto as da
Anthropic vêm com valor. Os tokens ficam certos; o dinheiro fica subestimado até
alguém declarar `cost` por modelo em `models.providers`. Está anotado em
`docs/CONTINUAR-AQUI.md`; não é defeito deste módulo, e ele não inventa preço.
"""

import asyncio
import logging
import os
from datetime import datetime, timezone

from app.database import sessao
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente

logger = logging.getLogger(__name__)

# Um número qualquer, mas estável: é a chave do advisory lock que impede dois
# coletores de rodarem juntos. Com duas réplicas do backend, os dois leriam o
# mesmo "já registrado" e gravariam a mesma diferença duas vezes.
_TRAVA = 815_140_017


def intervalo() -> int:
    """Segundos entre coletas. `0` desliga."""
    try:
        return max(0, int(os.environ.get("COLETOR_USO_SEGUNDOS", "300")))
    except ValueError:
        return 300


async def coletar_uma_vez() -> dict:
    """Uma passada: lê o gateway, grava o que faltava. Devolve o que fez."""
    try:
        c = await cfg.carregar()
        if not c.configurado:
            return {"ok": False, "motivo": "gateway não configurado"}
        r = await obter_cliente(c.url, c.token).chamar("sessions.list", {"limit": 1000})
    except (ErroGateway, OSError) as e:
        logger.warning("Coletor: sessions.list falhou: %s", e)
        return {"ok": False, "motivo": str(e)}

    vistas, gravados, tokens_novos = 0, 0, 0

    async with sessao(role="service_role") as conn:
        # Sem a trava, duas réplicas gravam a mesma diferença. `pg_try_advisory_lock`
        # não espera: quem não pegou simplesmente pula este ciclo.
        if not await conn.fetchval("SELECT pg_try_advisory_lock($1)", _TRAVA):
            logger.info("Coletor: outro processo está coletando; pulando.")
            return {"ok": True, "pulado": True}
        try:
            for s in r.get("sessions", []):
                partes = (s.get("key") or "").split(":")
                if len(partes) < 3 or partes[0] != "agent":
                    continue
                agente = partes[1]
                total = s.get("totalTokens") or 0
                if not total:
                    continue
                vistas += 1

                chave = s.get("key")
                # O que já registramos desta sessão. Deriva da própria tabela em
                # vez de um estado à parte: se alguém apagar linhas, o coletor
                # se corrige sozinho no ciclo seguinte.
                ja = await conn.fetchval(
                    "SELECT COALESCE(sum(total_tokens), 0) FROM public.usage_events "
                    " WHERE session_key = $1 AND source = 'session_delta'",
                    chave,
                ) or 0
                delta = total - int(ja)
                if delta <= 0:
                    continue

                # A mesma proporção dos tokens, aplicada ao custo e às parcelas.
                # Não dá para saber a repartição exata do trecho novo — o
                # gateway só dá o acumulado — e proporcional é a aproximação
                # honesta. O total, que é o que se soma, fica exato.
                fatia = delta / total
                custo = float(s.get("estimatedCostUsd") or 0) * fatia
                entrada = round((s.get("inputTokens") or 0) * fatia)
                saida_tok = round((s.get("outputTokens") or 0) * fatia)

                quando = s.get("endedAt") or s.get("updatedAt")
                ts = (datetime.fromtimestamp(quando / 1000, tz=timezone.utc)
                      if isinstance(quando, (int, float)) else datetime.now(timezone.utc))

                sufixo = ":".join(partes[2:])
                user_id = sufixo[len("hsos-"):] if sufixo.startswith("hsos-") else None

                # ⚠️ `kind` e `source` têm CHECK no banco, e o schema já previa
                # este coletor: `source='session_delta'` é literalmente o nome
                # do que gravamos — a diferença entre dois retratos da sessão.
                # `kind` aceita dm/channel/cron/subagent/command/unknown; a
                # primeira versão mandou 'chat' e 'gateway' e o INSERT morreu.
                if user_id:
                    especie = "dm"
                elif (s.get("kind") or "") in ("cron", "subagent", "command", "channel"):
                    especie = s["kind"]
                elif (s.get("kind") or "") == "group":
                    especie = "channel"
                else:
                    especie = "unknown"

                await conn.execute(
                    """
                    INSERT INTO public.usage_events
                           (ts, agent_id, model, kind, session_key, label, user_id,
                            input_tokens, output_tokens, total_tokens, cost_usd,
                            source, external_id, meta)
                    VALUES ($1, $2, $3, $13, $4, $5, $6::uuid,
                            $7, $8, $9, $10, 'session_delta', $11, $12::jsonb)
                    ON CONFLICT (external_id) DO NOTHING
                    """,
                    ts, agente, s.get("model"), chave, sufixo, user_id,
                    entrada, saida_tok, delta, custo,
                    # ⚠️ O `external_id` carrega o acumulado, não o delta: é ele
                    # que impede o mesmo retrato de entrar duas vezes se o ciclo
                    # repetir sem a sessão ter andado.
                    f"{chave}#{total}",
                    f'{{"acumulado": {total}, "status": "{s.get("status")}"}}',
                    especie,
                )
                gravados += 1
                tokens_novos += delta
        finally:
            # Se o ciclo morreu no meio, a transação está abortada e qualquer
            # comando aqui morre junto — engolindo o erro REAL. A trava é de
            # sessão: cai sozinha quando a conexão volta ao pool.
            try:
                await conn.execute("SELECT pg_advisory_unlock($1)", _TRAVA)
            except Exception:  # noqa: BLE001
                logger.debug("Coletor: não deu para soltar a trava; ela cai com a conexão.")

    if gravados:
        logger.info("Coletor: %d evento(s), %d tokens novos de %d sessão(ões).",
                    gravados, tokens_novos, vistas)
    return {"ok": True, "sessoes": vistas, "eventos": gravados, "tokens": tokens_novos}


async def rodar(parar: asyncio.Event) -> None:
    """Laço de fundo. Uma coleta imediata e depois a cada `intervalo()`."""
    seg = intervalo()
    if not seg:
        logger.info("Coletor de uso desligado (COLETOR_USO_SEGUNDOS=0).")
        return
    logger.info("Coletor de uso a cada %ds.", seg)
    while not parar.is_set():
        try:
            await coletar_uma_vez()
        except Exception:  # noqa: BLE001
            # Um ciclo que falha não pode derrubar o laço: o gateway cai, o
            # túnel reinicia, e o coletor tem que estar lá quando voltar.
            logger.exception("Coletor de uso falhou num ciclo; segue no próximo.")
        try:
            await asyncio.wait_for(parar.wait(), timeout=seg)
        except asyncio.TimeoutError:
            pass
