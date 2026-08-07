"""Automações — resultado de execução vindo de fora.

Portado de `automation-result`. É o webhook que o executor (n8n, cron da VPS,
qualquer coisa que rode a automação) chama ao terminar.
"""

import json
import logging
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.integracoes import exige_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/automacoes", tags=["automações"])

# Limites do original: o texto vai para a tela e a mensagem de erro para um
# balão. Sem corte, um executor verboso escreveria megabytes na linha.
_LIMITE_SAIDA = 20_000
_LIMITE_ERRO = 2_000

# O que conta como sucesso. Três palavras porque três executores diferentes
# reportam de jeitos diferentes, e era assim na edge.
_SUCESSO = {"ok", "success", "completed"}


class ResultadoIn(BaseModel):
    status: str | None = None
    output: Any = None
    error: Any = None
    meta: dict = {}


def _texto_da_saida(output: Any, erro: Any) -> str:
    """Extrai texto de um `output` que pode vir de qualquer formato.

    A cascata é a do original: string direta, depois `text`/`content`/`result`
    dentro de objeto, depois o JSON inteiro. É feia porque a realidade é —
    cada executor devolve de um jeito.
    """
    if isinstance(output, str) and output.strip():
        return output
    if isinstance(output, dict):
        for chave in ("text", "content", "result"):
            if isinstance(output.get(chave), str):
                return output[chave]
        try:
            return json.dumps(output, ensure_ascii=False)
        except (TypeError, ValueError):
            pass
    if isinstance(erro, str) and erro:
        return erro
    return "Sem resposta"


@router.post("/resultado", status_code=status.HTTP_204_NO_CONTENT)
async def registrar_resultado(
    dados: ResultadoIn,
    runId: str = Query(default=""),
    automationId: str = Query(default=""),
    _: None = Depends(exige_segredo("AUTOMATION_WEBHOOK_SECRET")),
):
    """Fecha uma execução de automação.

    Os identificadores podem vir no `meta` do corpo **ou** na query: quem chama
    é um executor externo, e nem todos deixam controlar o corpo do webhook —
    alguns só permitem acrescentar parâmetros à URL.
    """
    run_id = str(dados.meta.get("runId") or runId or "").strip()
    automation_id = str(dados.meta.get("automationId") or automationId or "").strip()
    if not run_id or not automation_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Faltam runId e automationId — mande em `meta` ou na query.",
        )

    sucesso = (dados.status or "").lower() in _SUCESSO
    situacao = "success" if sucesso else "error"
    texto = _texto_da_saida(dados.output, dados.error)
    mensagem_erro = None
    if not sucesso:
        mensagem_erro = (dados.error if isinstance(dados.error, str) else texto)[:_LIMITE_ERRO]

    async with sessao(role="service_role") as conn:
        async with conn.transaction():
            marca = await conn.execute(
                "UPDATE public.automation_runs SET status = $2, output = $3, "
                "error_message = $4, finished_at = now() WHERE id = $1::uuid",
                run_id, situacao, texto[:_LIMITE_SAIDA], mensagem_erro,
            )
            if marca.rsplit(" ", 1)[-1] == "0":
                raise HTTPException(
                    status.HTTP_404_NOT_FOUND, "Execução não encontrada."
                )
            await conn.execute(
                "UPDATE public.automations SET last_run_at = now(), last_run_status = $2 "
                "WHERE id = $1::uuid",
                automation_id, situacao,
            )

    logger.info("Automação %s: execução %s terminou em %s", automation_id, run_id, situacao)


# ─────────────────────────────────────────────────────────────────────────────
# Disparo de automação — portado de `trigger-automation` e `automation-scheduler`
# ─────────────────────────────────────────────────────────────────────────────
#
# As duas terminam no mesmo lugar: criar uma execução e mandar o gateway rodar a
# instrução num `cron.add` de tiro único. A diferença é só o que as aciona —
# evento de sistema numa, relógio na outra.
#
# ⚠️ `pg_cron` **não existe** no Postgres da VPS, então o agendamento não roda
# sozinho: `POST /automacoes/agendadas/disparar` precisa ser chamado a cada
# minuto por um serviço externo (o `worker` previsto em `docs/ROADMAP.md`).
# Enquanto isso não existir, automação agendada só roda se alguém chamar.

_EVENTOS = {"gateway.offline", "integration.added", "integration.expired",
            "user.joined", "agent.error"}

_DIAS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]


class GatilhoIn(BaseModel):
    event: str
    payload: dict = {}


async def _despachar(conn, automacao, contexto: str) -> str | None:
    """Cria a execução e manda o gateway rodar. Devolve o id da execução.

    O `cron.add` com `schedule.kind = "at"` daqui a 3 segundos é o jeito de pedir
    "rode uma vez, agora" — o gateway não tem um `run once` direto. A folga de 3s
    existe porque um horário no passado é recusado.
    """
    from app.gateway import config as gcfg
    from app.gateway.client import ErroGateway as _Erro, obter_cliente as _cliente

    nome_job = f"hsos-auto-{automacao['id']}-{int(time.time() * 1000)}"
    run_id = await conn.fetchval(
        "INSERT INTO public.automation_runs (automation_id, cron_job_name, status) "
        "VALUES ($1, $2, 'running') RETURNING id::text",
        automacao["id"], nome_job,
    )

    c = await gcfg.carregar()
    if not c.configurado:
        await conn.execute(
            "UPDATE public.automation_runs SET status = 'error', "
            "error_message = 'Gateway não configurado', finished_at = now() WHERE id = $1::uuid",
            run_id,
        )
        return None

    quando = datetime.now(timezone.utc) + timedelta(seconds=3)
    try:
        await _cliente(c.url, c.token).chamar("cron.add", {
            "name": nome_job,
            "schedule": {"kind": "at", "at": quando.isoformat().replace("+00:00", "Z")},
            "sessionTarget": "isolated",
            "agentId": automacao["agent_id"],
            "payload": {
                "kind": "agentTurn",
                "message": (automacao["instruction"] or "") + contexto,
                "timeoutSeconds": 300,
            },
        })
    except _Erro as e:
        await conn.execute(
            "UPDATE public.automation_runs SET status = 'error', error_message = $2, "
            "finished_at = now() WHERE id = $1::uuid",
            run_id, str(e)[:2000],
        )
        logger.warning("Automação %s não despachou: %s", automacao["id"], e)
        return None

    logger.info("Automação %s despachada (execução %s)", automacao["id"], run_id)
    return run_id


@router.post("/gatilho")
async def disparar_por_evento(
    dados: GatilhoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Roda as automações ligadas a um evento de sistema.

    ⚠️ **Exige usuário autenticado.** A edge aceitava também um segredo em
    cabeçalho, e a auditoria registrou que ela estava **aberta na internet** —
    o segredo era opcional e, sem ele configurado, qualquer um disparava
    automação. Aqui não há caminho anônimo.
    """
    if dados.event not in _EVENTOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Evento desconhecido. Use um de: {', '.join(sorted(_EVENTOS))}.",
        )

    contexto = ""
    if dados.payload:
        contexto = f"\n\nContexto do evento:\n{json.dumps(dados.payload, ensure_ascii=False)}"

    async with sessao(role="service_role") as conn:
        automacoes = await conn.fetch(
            "SELECT id::text AS id, name, agent_id, instruction FROM public.automations "
            "WHERE type = 'trigger' AND trigger_event = $1 AND is_active = true",
            dados.event,
        )
        despachadas = [r for a in automacoes if (r := await _despachar(conn, a, contexto))]

    logger.info("Evento %s: %d/%d automações despachadas por %s",
                dados.event, len(despachadas), len(automacoes), usuario.id)
    return {"event": dados.event, "encontradas": len(automacoes), "despachadas": len(despachadas)}


@router.post("/agendadas/disparar")
async def disparar_agendadas(_: None = Depends(exige_segredo("AUTOMATION_WEBHOOK_SECRET"))):
    """Roda as automações cujo horário bate com **este minuto**.

    Feito para ser chamado a cada minuto. A comparação é por minuto exato e em
    UTC — chamar duas vezes no mesmo minuto dispara duas vezes, então quem
    agenda precisa não se sobrepor.
    """
    agora = datetime.now(timezone.utc)
    hora = agora.strftime("%H:%M")
    dia = _DIAS[agora.weekday()]

    async with sessao(role="service_role") as conn:
        automacoes = await conn.fetch(
            """
            SELECT id::text AS id, name, agent_id, instruction FROM public.automations
             WHERE type = 'scheduled' AND is_active = true
               AND scheduled_time = $1
               AND (scheduled_day = 'daily' OR scheduled_day = $2)
            """,
            hora, dia,
        )
        despachadas = [r for a in automacoes if (r := await _despachar(conn, a, ""))]

    if automacoes:
        logger.info("Agendadas %s %s: %d despachadas", dia, hora, len(despachadas))
    return {"hora": hora, "dia": dia, "encontradas": len(automacoes),
            "despachadas": len(despachadas)}


# ─────────────────────────────────────────────────────────────────────────────
# Espelho do estado dos crons — `sync-automation-status` e `import-cron-jobs`
# ─────────────────────────────────────────────────────────────────────────────


def _nome_legivel(bruto: str, agente: str | None) -> str:
    """Nome de cron é escrito por engenheiro, não para uma tela.

    `monitor-recursos-vps` vira "Monitor recursos VPS". Nome que **já** tem
    espaço e maiúscula passa intacto — alguém já o escreveu para ser lido.
    """
    n = re.sub(r"^cron:\s*", "", bruto.strip(), flags=re.I)
    if agente:
        n = re.sub(rf"^{re.escape(agente)}\s*[—–-]\s*", "", n, flags=re.I).strip()
    if " " in n or not re.search(r"[-_:.]", n):
        return n
    palavras = re.sub(r"[-_:.]+", " ", n).split()
    siglas = {"vps", "db", "api", "crm", "llm", "cs", "seo", "kpi", "ia", "url", "os", "mkt"}
    return " ".join(
        p.upper() if p.lower() in siglas else (p.capitalize() if i == 0 else p)
        for i, p in enumerate(palavras)
    )


async def _crons_do_gateway() -> list[dict]:
    from app.gateway import config as gcfg
    from app.gateway.client import ErroGateway as _Erro, obter_cliente as _cliente

    c = await gcfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        r = await _cliente(c.url, c.token).chamar("cron.list", {})
    except _Erro as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"cron.list falhou: {e}")
    jobs = r.get("jobs") if isinstance(r.get("jobs"), list) else r
    return jobs if isinstance(jobs, list) else []


@router.post("/sincronizar-status")
async def sincronizar_status(_: Usuario = Depends(usuario_atual)):
    """Traz do gateway o último resultado de cada cron para as automações.

    O gateway é a fonte da verdade sobre execução — ele é quem roda. Sem este
    espelho, a tela mostraria "nunca executada" para automação que roda há meses.
    """
    jobs = {j.get("name"): j for j in await _crons_do_gateway() if j.get("name")}
    if not jobs:
        return {"atualizadas": 0, "jobs_no_gateway": 0}

    atualizadas = 0
    async with sessao(role="service_role") as conn:
        for linha in await conn.fetch(
            "SELECT id::text AS id, name FROM public.automations WHERE is_active = true"
        ):
            # O cron do gateway carrega o id da automação no nome — é o que
            # liga os dois lados sem precisar de uma tabela de-para.
            job = next((j for n, j in jobs.items() if linha["id"] in n), None)
            if not job:
                continue
            estado = str(job.get("lastRunStatus") or "").lower()
            if estado not in ("success", "error", "running"):
                continue
            marca = await conn.execute(
                "UPDATE public.automations SET last_run_status = $2, "
                "last_run_at = COALESCE($3::text::timestamptz, last_run_at), updated_at = now() "
                "WHERE id = $1::uuid AND (last_run_status IS DISTINCT FROM $2)",
                linha["id"], estado, job.get("lastRunAt"),
            )
            if marca.rsplit(" ", 1)[-1] != "0":
                atualizadas += 1

    logger.info("Status de automações sincronizado: %d atualizadas", atualizadas)
    return {"atualizadas": atualizadas, "jobs_no_gateway": len(jobs)}


@router.post("/importar-crons")
async def importar_crons(_: Usuario = Depends(exige_papel("super_admin"))):
    """Traz para `automations` os crons que já existem no gateway.

    Serve para instalação que herdou crons configurados à mão: eles passam a
    aparecer na tela em vez de rodarem invisíveis. Idempotente pelo nome — rodar
    duas vezes não duplica.
    """
    jobs = await _crons_do_gateway()
    importados = ignorados = 0

    async with sessao(role="service_role") as conn:
        for job in jobs:
            nome = str(job.get("name") or "").strip()
            if not nome or nome.startswith("hsos-auto-") or nome.startswith("dnos-"):
                # Job criado pela própria plataforma: já tem automação por trás,
                # importá-lo criaria uma duplicata que dispara em dobro.
                ignorados += 1
                continue
            agente = job.get("agentId")
            legivel = _nome_legivel(nome, agente)
            instrucao = str(((job.get("payload") or {}).get("message")) or legivel)
            marca = await conn.execute(
                """
                INSERT INTO public.automations (name, agent_id, type, instruction, is_active)
                VALUES ($1, $2, 'scheduled', $3, $4)
                ON CONFLICT DO NOTHING
                """,
                legivel, agente, instrucao, bool(job.get("enabled", True)),
            )
            if marca.rsplit(" ", 1)[-1] == "0":
                ignorados += 1
            else:
                importados += 1

    logger.info("Crons importados: %d novos, %d ignorados", importados, ignorados)
    return {"importados": importados, "ignorados": ignorados, "jobs_no_gateway": len(jobs)}


# ─────────────────────────────────────────────────────────────────────────────
# CRUD das automações — o que a tela usa
# ─────────────────────────────────────────────────────────────────────────────

_TIPOS = {"scheduled", "trigger"}
_DIAS_VALIDOS = set(_DIAS) | {"daily"}

_COLS = """
    id::text AS id, name, agent_id, type, scheduled_day, scheduled_time,
    trigger_event, instruction, is_active, last_run_status,
    created_by::text AS created_by,
    to_char(last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS last_run_at,
    to_char(created_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
"""


class AutomacaoOut(BaseModel):
    id: str
    name: str
    agent_id: str | None = None
    type: str
    scheduled_day: str | None = None
    scheduled_time: str | None = None
    trigger_event: str | None = None
    instruction: str
    is_active: bool
    last_run_status: str | None = None
    last_run_at: str | None = None
    created_by: str | None = None
    created_at: str


class AutomacaoIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    instruction: str = Field(min_length=1)
    type: str = "scheduled"
    agent_id: str | None = None
    scheduled_day: str | None = None
    scheduled_time: str | None = None
    trigger_event: str | None = None
    is_active: bool = True


def _validar(d: AutomacaoIn) -> None:
    if d.type not in _TIPOS:
        raise HTTPException(status.HTTP_400_BAD_REQUEST,
                            f"type inválido. Use: {', '.join(sorted(_TIPOS))}.")
    if d.type == "scheduled":
        if not d.scheduled_time or not re.match(r"^\d{2}:\d{2}$", d.scheduled_time):
            raise HTTPException(status.HTTP_400_BAD_REQUEST,
                                "scheduled_time obrigatório no formato HH:MM (UTC).")
        if d.scheduled_day not in _DIAS_VALIDOS:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                f"scheduled_day inválido. Use: {', '.join(sorted(_DIAS_VALIDOS))}.",
            )
    elif d.trigger_event not in _EVENTOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"trigger_event inválido. Use: {', '.join(sorted(_EVENTOS))}.",
        )


def _limpar(d: AutomacaoIn) -> tuple:
    """Zera os campos que não pertencem ao tipo escolhido.

    Automação agendada não tem evento e vice-versa. Deixar o campo antigo
    preenchido ao trocar o tipo faria a automação disparar pelos dois caminhos.
    """
    agendada = d.type == "scheduled"
    return (
        d.scheduled_day if agendada else None,
        d.scheduled_time if agendada else None,
        None if agendada else d.trigger_event,
    )


@router.get("", response_model=list[AutomacaoOut])
async def listar_automacoes(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLS} FROM public.automations ORDER BY created_at DESC"
        )
    return [AutomacaoOut(**dict(l)) for l in linhas]


@router.post("", response_model=AutomacaoOut, status_code=status.HTTP_201_CREATED)
async def criar_automacao(dados: AutomacaoIn, usuario: Usuario = Depends(usuario_atual)):
    _validar(dados)
    dia, hora, evento = _limpar(dados)
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.automations
                (name, agent_id, type, scheduled_day, scheduled_time, trigger_event,
                 instruction, is_active, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::uuid)
            RETURNING {_COLS}
            """,
            dados.name, dados.agent_id, dados.type, dia, hora, evento,
            dados.instruction, dados.is_active, usuario.id,
        )
    logger.info("Automação %s criada por %s", linha["id"], usuario.id)
    return AutomacaoOut(**dict(linha))


@router.patch("/{automacao_id}", response_model=AutomacaoOut)
async def editar_automacao(
    automacao_id: str,
    dados: AutomacaoIn,
    usuario: Usuario = Depends(usuario_atual),
):
    _validar(dados)
    dia, hora, evento = _limpar(dados)
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            UPDATE public.automations SET
                name = $2, agent_id = $3, type = $4, scheduled_day = $5,
                scheduled_time = $6, trigger_event = $7, instruction = $8,
                is_active = $9, updated_at = now()
             WHERE id = $1::uuid
            RETURNING {_COLS}
            """,
            automacao_id, dados.name, dados.agent_id, dados.type, dia, hora,
            evento, dados.instruction, dados.is_active,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Automação não encontrada.")
    return AutomacaoOut(**dict(linha))


@router.delete("/{automacao_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_automacao(automacao_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.automations WHERE id = $1::uuid", automacao_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Automação não encontrada.")


@router.get("/{automacao_id}/execucoes")
async def execucoes(
    automacao_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=20, ge=1, le=100),
):
    """Histórico de execuções, da mais recente para a mais antiga."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT id::text AS id, status, output, error_message,
                   to_char(started_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS started_at,
                   to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS finished_at
              FROM public.automation_runs WHERE automation_id = $1::uuid
             ORDER BY started_at DESC LIMIT $2
            """,
            automacao_id, limite,
        )
    return [dict(l) for l in linhas]


@router.get("/{automacao_id}/historico")
async def historico_de_execucoes(
    automacao_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=50, ge=1, le=200),
):
    """As execuções desta automação, da mais recente para a mais antiga."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.automation_runs WHERE automation_id = $1::uuid "
            " ORDER BY started_at DESC LIMIT $2",
            automacao_id, limite,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]
