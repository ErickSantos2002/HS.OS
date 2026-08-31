"""Confere se o briefing da manhã saiu, e refaz uma vez se não saiu.

⚠️ **Briefing que falha hoje não deixa rastro nenhum.** O `cron.add` dispara, o
agente estoura o contexto no meio, e o resultado é ausência: nenhum documento,
nenhum erro na tela de ninguém, nenhuma linha em log que alguém leia. Quem
descobre é a pessoa que abre a base de conhecimento às oito da manhã e não acha
o de hoje — e aí já não dá para refazer a tempo.

Em 20/08/2026 isso deixou de ser hipótese: rodei o briefing de SDR três vezes à
mão e **uma delas morreu** com "Auto-compaction could not recover this turn". A
tarefa fica no limite da janela:

    janela do modelo          65.536
    − reserva de compactação  24.000   (`agents.defaults.compaction.reserveTokens`)
    − piso do atlas           25.124   (sete arquivos + ferramentas + skills)
    ────────────────────────────────
      espaço real da tarefa   ~16.400

Uma execução mais pesada que a média — uma consulta que erra e precisa refazer,
um resultado maior — passa disso. Não é defeito de código: é dimensionamento,
e enquanto o modelo tiver 65 mil de janela vai continuar acontecendo de vez em
quando.

Então em vez de tentar tornar a execução infalível, este laço torna a **falha
recuperável**: confere o efeito (o documento existe?) e refaz uma vez. É a
mesma disciplina do resto do dia — verificar o resultado, não confiar no
disparo.

⚠️ **Uma tentativa por briefing por dia.** A marca fica em `app_settings`, que é
tabela existente e compartilhada entre os workers — memória de processo não
serviria, pelo mesmo motivo que não serviu para os envios. Sem esse teto, um
briefing que falha sempre viraria um agente sendo acionado a cada dez minutos o
dia inteiro.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timedelta, timezone

from app.database import sessao
from app.gateway.client import ErroGateway

logger = logging.getLogger(__name__)

BRASILIA = timezone(timedelta(hours=-3))

# Quanto esperamos depois da hora marcada antes de considerar que não saiu. Os
# briefings levam de dois a quatro minutos; vinte é folga sem virar demora.
_TOLERANCIA = timedelta(minutes=20)

# Só refaz de manhã. Um briefing recuperado às onze da noite não serve a
# ninguém e ainda gasta contexto que a conversa do dia seguinte vai querer.
_ATE_A_HORA = 12

# O título que o agente vai escrever está dentro do próprio texto do cron, entre
# aspas, no formato `Nome · DD/MM`. Tirar daí em vez de manter uma lista aqui
# significa que mudar o cron não deixa este guardião desatualizado em silêncio.
_TITULO = re.compile(r'["“]([^"”]+?)\s*·\s*DD/MM["”]')


def _mensagem_do_cron(job: dict) -> str:
    p = job.get("payload")
    if isinstance(p, dict):
        return str(p.get("message") or "")
    return str(p or "")


def _hora_marcada(job: dict, hoje: datetime) -> datetime | None:
    """A hora de hoje, em Brasília, em que este cron deveria ter rodado.

    ⚠️ **O `expr` do gateway é UTC e não tem campo de fuso** — levantado em
    19/08/2026. `30 10 * * 1-5` é 07h30 de Brasília.
    """
    sched = job.get("schedule") or {}
    if sched.get("kind") != "cron":
        return None
    partes = str(sched.get("expr") or "").split()
    if len(partes) < 2:
        return None
    try:
        minuto, hora = int(partes[0]), int(partes[1])
    except ValueError:
        return None
    em_utc = hoje.astimezone(timezone.utc).replace(
        hour=hora, minute=minuto, second=0, microsecond=0)
    return em_utc.astimezone(BRASILIA)


async def _reservar(chave: str, quando: datetime) -> bool:
    """Toma o direito de refazer este briefing hoje. `False` = já é de outro.

    ⚠️ **Reserva atômica, não "consultar e depois marcar".** Este laço roda nos
    dois workers do uvicorn e eles não se enxergam: com a checagem separada da
    escrita, os dois leriam "ninguém tentou" no mesmo instante e o agente
    receberia o briefing duas vezes. O `ON CONFLICT DO NOTHING … RETURNING`
    resolve no banco — só quem inseriu de fato recebe linha de volta. É a mesma
    forma da reserva do `message_id` em `agent_runs`, pelo mesmo motivo.
    """
    async with sessao(role="service_role") as conn:
        return await conn.fetchval(
            "INSERT INTO public.app_settings (key, value, updated_at) "
            "VALUES ($1, $2::jsonb, now()) "
            "ON CONFLICT (key) DO NOTHING RETURNING true",
            chave, json.dumps({"refeito_em": quando.isoformat()})) or False


async def _documento_existe(titulo: str, dia: datetime) -> bool:
    async with sessao(role="service_role") as conn:
        return await conn.fetchval(
            """SELECT true FROM public.wiki_documents
                WHERE title = $1
                  AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = $2
                LIMIT 1""",
            titulo, dia.date()) or False


# ⚠️ **O `assunto` do alerta tem `maxLength: 60` no schema do MCP.** Título
# comprido no cron faria o alerta ser recusado justamente no dia em que importa.
_LIMITE_DO_ASSUNTO = 60


def _alerta(titulo: str, refeito: bool) -> tuple[str, str, str]:
    """O que dizer ao administrador. Devolve `(assunto, detalhe, gravidade)`.

    ⚠️ **`urgente` não entra aqui.** O `mcp_alerta` guarda essa gravidade para
    tentativa de subverter o agente ou risco a dado sensível; briefing que não
    saiu é operação. Gastar o degrau mais alto com isto o esvazia para quando
    for preciso.
    """
    if refeito:
        assunto = f"Briefing refeito: {titulo}"
        detalhe = (
            f'O briefing "{titulo}" não estava na base de conhecimento no horário '
            "e foi refeito automaticamente, em sessão limpa. O documento deve "
            "aparecer em alguns minutos.\n\n"
            "Não é falha para hoje — o valor chega. É custo: uma execução a mais, "
            "e um sinal de que aquele agendamento vem tropeçando."
        )
        gravidade = "informativo"
    else:
        assunto = f"Briefing não saiu: {titulo}"
        detalhe = (
            f'O briefing "{titulo}" não está na base de conhecimento e a tentativa '
            "de hoje já foi usada — o guardião refaz uma vez por dia, e essa "
            "acabou.\n\n"
            "Ninguém mais vai tentar hoje: isto precisa de uma pessoa. Vale olhar "
            "o erro do agendamento no gateway antes de refazer à mão."
        )
        gravidade = "atencao"
    return assunto[:_LIMITE_DO_ASSUNTO], detalhe, gravidade


async def _avisar(titulo: str, refeito: bool) -> None:
    """Manda o alerta pelo mesmo caminho do guardião de crons.

    Import tardio para não amarrar ordem de boot, e falha engolida de propósito:
    não avisar é ruim, mas deixar de refazer o briefing por causa do aviso é pior.
    """
    from app.routers.mcp_alerta import avisar_administradores
    assunto, detalhe, gravidade = _alerta(titulo, refeito)
    try:
        await avisar_administradores("nina", assunto, detalhe, gravidade)
    except Exception:  # noqa: BLE001
        logger.exception("Guardião: não consegui avisar sobre %s.", titulo)


async def conferir(cliente, agora: datetime | None = None) -> dict:
    """Uma passada: para cada briefing atrasado sem documento, refaz uma vez."""
    agora = agora or datetime.now(BRASILIA)
    if agora.hour >= _ATE_A_HORA:
        return {"ok": True, "fora_da_janela": True}

    try:
        r = await cliente.chamar("cron.list", {})
    except (ErroGateway, OSError) as e:
        logger.warning("Guardião: cron.list falhou: %s", e)
        return {"ok": False, "motivo": str(e)}

    refeitos, conferidos = [], 0
    for job in (r.get("payload") or r).get("jobs") or []:
        nome = str(job.get("name") or "")
        if not nome.startswith("hsos-briefing-"):
            continue
        marcada = _hora_marcada(job, agora)
        if marcada is None or agora < marcada + _TOLERANCIA:
            continue

        mensagem = _mensagem_do_cron(job)
        achado = _TITULO.search(mensagem)
        if not achado:
            # Sem título reconhecível não dá para conferir o efeito. Dizer isso
            # é melhor que fingir que conferiu.
            logger.warning("Guardião: não achei o título no cron %s; não confiro.", nome)
            continue
        titulo = f"{achado.group(1)} · {agora.strftime('%d/%m')}"
        conferidos += 1
        if await _documento_existe(titulo, agora):
            continue

        chave = f"briefing_refeito:{nome}:{agora.strftime('%Y-%m-%d')}"
        if not await _reservar(chave, agora):
            # Ou o outro worker está refazendo agora, ou já refizemos e falhou
            # de novo. Nos dois casos a resposta é a mesma: não insistir.
            logger.warning('Guardião: "%s" não saiu e a tentativa de hoje já foi '
                           "usada; fica para uma pessoa olhar.", titulo)
            # ⚠️ **Este era o caso que ninguém via.** O log dizia "fica para uma
            # pessoa olhar" e pessoa nenhuma era avisada de que devia olhar.
            await _avisar(titulo, refeito=False)
            continue

        # ⚠️ **Sessão própria, não a do cron.** A do cron pode ser justamente a
        # que estourou; começar limpo é metade do conserto.
        chave_sessao = f"agent:{job.get('agentId')}:refazer-{nome}-{agora.strftime('%Y%m%d')}"
        try:
            await cliente.chamar("chat.send", {
                "agentId": job.get("agentId"),
                "sessionKey": chave_sessao,
                "message": mensagem,
                "idempotencyKey": f"guardiao-{nome}-{agora.strftime('%Y%m%d')}",
            })
        except (ErroGateway, OSError) as e:
            logger.warning("Guardião: não consegui refazer %s: %s", nome, e)
            continue
        refeitos.append(titulo)
        logger.warning('Guardião: "%s" não estava na base; refiz o briefing.', titulo)
        await _avisar(titulo, refeito=True)

    return {"ok": True, "conferidos": conferidos, "refeitos": refeitos}
