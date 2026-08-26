"""Desliga agendamento desgovernado e avisa o administrador.

⚠️ **Quem trava um agente descontrolado não pode ser o próprio agente.** Em
25/08/2026 a `nina` diagnosticou corretamente que a `iris` estava travada por
contexto estourado e, em vez de avisar, criou para si um cron `everyMs: 180000`
para ficar olhando se ela voltava. Rodou **560 vezes em 28 horas**, escreveu
**197 documentos** dizendo "ainda pendente" — 83% de tudo que havia na Base de
Conhecimento — e só parou porque o Erick abriu a tela e estranhou.

Três consertos saíram daquele dia, e este é o terceiro:

1. a ferramenta `cron` foi negada aos agentes (`_DENY_NAO_MCP`);
2. os arquivos da `nina` passaram a dizer que agente parceiro travado é motivo
   de avisar, não de patrulhar;
3. **este laço**, que existe porque os dois primeiros dependem de a gente ter
   previsto o problema. O próximo vazamento não vai ser igual a este, e o
   disjuntor precisa funcionar mesmo quando estivermos errados sobre a causa.

⚠️ **Ele NÃO tenta julgar se o job é útil.** Julgar intenção é o que falhou.
Ele olha uma coisa medível — com que frequência o job dispara — e uma coisa
verificável — se ele nasceu pela nossa tela. Nada além disso.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone

from app.database import sessao
from app.gateway.client import ErroGateway

logger = logging.getLogger(__name__)

BRASILIA = timezone(timedelta(hours=-3))

# Período abaixo do qual um agendamento recorrente é suspeito, em segundos.
#
# 15 minutos não é chute: esta própria ronda roda a cada 10, e nada que se
# agende pela tela precisa acordar um agente mais de quatro vezes por hora. O
# que precisa disso é laço de backend — código determinístico, sem token por
# execução —, não turno de agente, que custa ~15 segundos e contexto a cada
# disparo. O cron da `nina` era de 3 minutos: 20 execuções por hora.
_PISO_SEGUNDOS = 15 * 60

# O que nasceu pela tela de agendamentos (`POST /agents/{id}/crons`) e o que é
# briefing nosso. Job fora destes prefixos apareceu por outro caminho — hoje só
# alguém com acesso RPC ao gateway, já que os agentes não têm mais a ferramenta.
_NOSSOS = ("hsos-agentcron-", "hsos-briefing-")


def _periodo_segundos(job: dict) -> float | None:
    """De quanto em quanto tempo este job dispara. `None` = não recorrente.

    Duas fontes, nesta ordem, e a segunda existe para o job que ainda não rodou:

    - `nextRunAtMs − lastRunAtMs` — funciona para `expr` e para `everyMs`, sem
      precisar interpretar expressão cron;
    - `schedule.everyMs` — o job recém-criado ainda não tem `lastRunAtMs`.

    ⚠️ Tiro único (`kind: "at"`) devolve `None` de propósito: depois de rodar ele
    perde o `nextRunAtMs`, e o gateway o desliga sozinho.
    """
    st = job.get("state") or {}
    ultimo, proximo = st.get("lastRunAtMs"), st.get("nextRunAtMs") or job.get("nextRunAtMs")
    if ultimo and proximo and proximo > ultimo:
        return (proximo - ultimo) / 1000.0
    every = (job.get("schedule") or {}).get("everyMs")
    if isinstance(every, (int, float)) and every > 0:
        return every / 1000.0
    return None


def _nosso(job: dict) -> bool:
    return str(job.get("name") or "").startswith(_NOSSOS)


async def _reservar(chave: str) -> bool:
    """Toma o direito de agir sobre este job hoje. `False` = já foi.

    ⚠️ **Reserva atômica, não "consultar e depois marcar".** Esta ronda roda nos
    dois workers do uvicorn e eles não se enxergam: com a checagem separada da
    escrita, os dois leriam "ninguém agiu" no mesmo instante e o administrador
    receberia o alerta em dobro. Mesma forma do guardião dos briefings, pelo
    mesmo motivo.
    """
    async with sessao(role="service_role") as conn:
        return await conn.fetchval(
            "INSERT INTO public.app_settings (key, value, updated_at) "
            "VALUES ($1, $2::jsonb, now()) "
            "ON CONFLICT (key) DO NOTHING RETURNING true",
            chave, json.dumps({"em": datetime.now(BRASILIA).isoformat()})) or False


async def _avisar(assunto: str, detalhe: str, gravidade: str) -> None:
    """Manda o alerta pelo mesmo caminho que os agentes usam.

    Import tardio, como o resto do projeto faz com dependências de router, para
    não amarrar ordem de boot.

    ⚠️ **Atribuído à `nina` porque o alerta mora no chat de um agente**, e o dela
    é onde o administrador olha. O texto diz que quem falou foi o vigia, para
    ninguém achar que ela fez a checagem — ela não fez, e o dia em que ela for a
    responsável por frear a si mesma é o dia em que isto não funciona.
    """
    from app.routers.mcp_alerta import avisar_administradores
    try:
        await avisar_administradores("nina", assunto, detalhe, gravidade)
    except Exception:  # noqa: BLE001
        logger.exception("Guardião de crons: não consegui avisar o administrador.")


async def conferir(cliente) -> dict:
    """Uma passada por todos os agendamentos ligados do gateway.

    ⚠️ **`cron.list` sem parâmetro devolve só os ligados, e é isso que queremos
    aqui** — job que já desligamos não deve ser reavaliado nem realertado. É o
    oposto do `agendamentos-do-gateway`, que pede `includeDisabled` porque a tela
    precisa oferecer o botão de religar.
    """
    try:
        r = await cliente.chamar("cron.list", {})
    except (ErroGateway, OSError) as e:
        logger.warning("Guardião de crons: cron.list falhou: %s", e)
        return {"ok": False, "motivo": str(e)}

    hoje = datetime.now(BRASILIA).strftime("%Y-%m-%d")
    desligados, avisados, olhados = [], [], 0

    for job in (r.get("jobs") or []):
        jid, nome = job.get("id"), str(job.get("name") or "sem-nome")
        if not jid:
            continue
        olhados += 1
        periodo = _periodo_segundos(job)
        agente = job.get("agentId")
        rapido = periodo is not None and periodo < _PISO_SEGUNDOS

        # ── Caso 1: rápido e de origem desconhecida — a assinatura do vazamento.
        # Desliga e avisa. Desligar não apaga: o job continua no `cron.list` com
        # `includeDisabled` e a tela oferece religar.
        if periodo is not None and rapido and not _nosso(job):
            if not await _reservar(f"cron_travado:{jid}:{hoje}"):
                continue
            try:
                await cliente.chamar("cron.update", {"id": jid, "patch": {"enabled": False}})
            except (ErroGateway, OSError) as e:
                logger.warning("Guardião de crons: não desliguei %s: %s", nome, e)
                await _avisar(
                    "Agendamento disparando demais, e não consegui desligar",
                    f"O job **{nome}** (agente `{agente}`) dispara a cada "
                    f"{periodo / 60:.1f} min e eu não consegui desligá-lo: {e}\n\n"
                    "Precisa de mão humana.", "critico")
                continue
            desligados.append(nome)
            logger.warning("Guardião de crons: desliguei %s (a cada %.1f min).",
                           nome, periodo / 60)
            await _avisar(
                "Desliguei um agendamento que disparava demais",
                f"O job **{nome}** (agente `{agente}`) disparava a cada "
                f"**{periodo / 60:.1f} minutos** e não nasceu pela tela de "
                f"agendamentos.\n\n"
                f"Eu **desliguei** — não apaguei. Ele aparece no painel do agente "
                f"e pode ser religado ali.\n\n"
                f"O piso é de {_PISO_SEGUNDOS // 60} minutos por execução. Quem "
                f"detectou foi o vigia de agendamentos, não eu.", "critico")
            continue

        # ── Caso 2: rápido, mas foi um humano que pediu pela tela. Não desligo
        # — a escolha foi consciente. Aviso do custo, uma vez por dia.
        if periodo is not None and rapido:
            if not await _reservar(f"cron_rapido:{jid}:{hoje}"):
                continue
            avisados.append(nome)
            await _avisar(
                "Agendamento com intervalo bem curto",
                f"O job **{nome}** (agente `{agente}`) dispara a cada "
                f"**{periodo / 60:.1f} minutos**. Ele nasceu pela tela, então "
                f"deixei ligado — só estou avisando do custo: cada disparo é um "
                f"turno inteiro de agente.\n\n"
                f"Se não era essa a intenção, o painel do agente desliga.", "aviso")
            continue

        # ── Caso 3: origem desconhecida, ritmo normal. Só visibilidade, uma vez.
        if not _nosso(job):
            if not await _reservar(f"cron_desconhecido:{jid}:{hoje}"):
                continue
            avisados.append(nome)
            await _avisar(
                "Agendamento que não nasceu pela tela",
                f"O job **{nome}** (agente `{agente}`) está ligado no gateway e "
                f"não veio da tela de agendamentos nem é briefing nosso.\n\n"
                f"O ritmo dele está normal"
                + (f" (a cada {periodo / 3600:.1f} h)" if periodo else "")
                + ". Não mexi em nada — é só para você saber que existe.", "info")

    return {"ok": True, "olhados": olhados,
            "desligados": desligados, "avisados": avisados}
