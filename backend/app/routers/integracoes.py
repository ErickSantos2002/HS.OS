"""Endpoints que a VPS chama — não o navegador.

Portados de `log-agent-activity`, `ingest-token-snapshot` e
`upsert-agent-guardrails`. Todos autenticam por segredo compartilhado, nunca por
JWT de usuário: quem chama é serviço do lado do OpenClaw.

Ficam juntos porque compartilham a forma (segredo + gravação idempotente) e
porque separá-los em três módulos de 40 linhas não ajudaria ninguém a achá-los.
"""

import json
import logging
import os
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.integracoes import exige_segredo
from app.realtime import hub, topico_usuario

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integracoes", tags=["integrações"])


# ─────────────────────────────────────────────────────────────────────────────
# Atividade de agente — o que ele está fazendo agora
# ─────────────────────────────────────────────────────────────────────────────


class AtividadeIn(BaseModel):
    agent_id: str = Field(min_length=1)
    activity_type: str = Field(min_length=1)
    title: str = Field(min_length=1)
    user_id: str | None = None
    channel: str | None = None
    metadata: dict = {}
    steps: list = []
    status: str = "running"


class AtividadePatch(BaseModel):
    status: str | None = None
    steps: list | None = None
    result: dict | None = None
    metadata: dict | None = None


class AtividadeOut(BaseModel):
    id: str


@router.post("/agent-activity", response_model=AtividadeOut,
             status_code=status.HTTP_201_CREATED)
async def iniciar_atividade(
    dados: AtividadeIn,
    _: None = Depends(exige_segredo("BRIDGE_API_TOKEN")),
):
    """Abre um registro de atividade. É o que alimenta o \"está trabalhando\" na tela."""
    async with sessao(role="service_role") as conn:
        atividade_id = await conn.fetchval(
            """
            INSERT INTO public.agent_activity
                (agent_id, activity_type, title, status, steps, user_id, channel, metadata)
            VALUES ($1, $2, $3, $4, $5::jsonb, NULLIF($6,'')::uuid, $7, $8::jsonb)
            RETURNING id::text
            """,
            dados.agent_id, dados.activity_type, dados.title, dados.status,
            json.dumps(dados.steps), dados.user_id or "", dados.channel,
            json.dumps(dados.metadata),
        )
    if dados.user_id:
        hub.publicar(topico_usuario(dados.user_id), "atividade-agente",
                     {"id": atividade_id, "agent_id": dados.agent_id,
                      "title": dados.title, "status": dados.status})
    return AtividadeOut(id=atividade_id)


@router.patch("/agent-activity/{atividade_id}", response_model=AtividadeOut)
async def atualizar_atividade(
    atividade_id: str,
    dados: AtividadePatch,
    _: None = Depends(exige_segredo("BRIDGE_API_TOKEN")),
):
    """Atualiza o andamento. Só os campos enviados mudam."""
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")

    atribuicoes, valores = [], []
    for i, (nome, valor) in enumerate(campos.items(), start=1):
        if nome in ("steps", "result", "metadata"):
            atribuicoes.append(f"{nome} = ${i}::jsonb")
            valores.append(json.dumps(valor))
        else:
            atribuicoes.append(f"{nome} = ${i}")
            valores.append(valor)

    async with sessao(role="service_role") as conn:
        achado = await conn.fetchval(
            f"UPDATE public.agent_activity SET {', '.join(atribuicoes)}, updated_at = now() "
            f"WHERE id = ${len(valores) + 1}::uuid RETURNING id::text",
            *valores, atividade_id,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Atividade não encontrada.")
    return AtividadeOut(id=achado)


# ─────────────────────────────────────────────────────────────────────────────
# Métricas de consumo
# ─────────────────────────────────────────────────────────────────────────────


class SnapshotIn(BaseModel):
    agent_id: str = Field(min_length=1)
    snapshot_at: str
    total_tokens: int = 0
    input_tokens: int = 0
    output_tokens: int = 0
    context_tokens: int = 0
    context_window: int | None = None
    cache_read: int = 0
    cache_write: int = 0
    estimated_cost_usd: float = 0
    model: str | None = None
    session_count: int = 0


@router.post("/token-snapshot", status_code=status.HTTP_204_NO_CONTENT)
async def registrar_consumo(
    dados: SnapshotIn,
    _: None = Depends(exige_segredo("INGEST_API_KEY")),
):
    """Grava uma medição de consumo do agente.

    Idempotente por `(agent_id, snapshot_at)`: o coletor da VPS reenvia o mesmo
    ponto quando a rede falha no meio, e sem isto o gráfico contaria duas vezes.
    """
    try:
        instante = datetime.fromisoformat(dados.snapshot_at)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "snapshot_at precisa ser um timestamp ISO válido."
        )

    async with sessao(role="service_role") as conn:
        await conn.execute(
            """
            INSERT INTO public.agent_token_snapshots
                (agent_id, snapshot_at, total_tokens, input_tokens, output_tokens,
                 context_tokens, context_window, cache_read, cache_write,
                 estimated_cost_usd, model, session_count)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            ON CONFLICT (agent_id, snapshot_at) DO UPDATE SET
                total_tokens = EXCLUDED.total_tokens,
                input_tokens = EXCLUDED.input_tokens,
                output_tokens = EXCLUDED.output_tokens,
                context_tokens = EXCLUDED.context_tokens,
                context_window = EXCLUDED.context_window,
                cache_read = EXCLUDED.cache_read,
                cache_write = EXCLUDED.cache_write,
                estimated_cost_usd = EXCLUDED.estimated_cost_usd,
                model = EXCLUDED.model,
                session_count = EXCLUDED.session_count
            """,
            dados.agent_id, instante, dados.total_tokens, dados.input_tokens,
            dados.output_tokens, dados.context_tokens, dados.context_window,
            dados.cache_read, dados.cache_write, dados.estimated_cost_usd,
            dados.model, dados.session_count,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Guardrails
# ─────────────────────────────────────────────────────────────────────────────


class GuardrailsIn(BaseModel):
    agent_id: str = Field(min_length=1)
    guardrails: list = []


@router.put("/guardrails", status_code=status.HTTP_204_NO_CONTENT)
async def gravar_guardrails(
    dados: GuardrailsIn,
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Substitui os guardrails do agente pelo conjunto enviado.

    Substitui, não acrescenta: quem manda é a fonte da verdade do lado da VPS, e
    mesclar deixaria regra removida lá continuar valendo aqui — que é o oposto do
    que um guardrail deve fazer.
    """
    async with sessao(role="service_role") as conn:
        achado = await conn.fetchval(
            "UPDATE public.agent_profiles SET guardrails = $2::jsonb, updated_at = now() "
            "WHERE agent_id = $1 RETURNING agent_id",
            dados.agent_id, json.dumps(dados.guardrails),
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")
    logger.info("Guardrails de %s atualizados (%d regras)", dados.agent_id, len(dados.guardrails))


# ─────────────────────────────────────────────────────────────────────────────
# Estado das chaves de integração — portado de `check-integration-keys`
# ─────────────────────────────────────────────────────────────────────────────


class ChavesOut(BaseModel):
    checadas: int
    configuradas: int


@router.post("/checar-chaves", response_model=ChavesOut)
async def checar_chaves(_: None = Depends(exige_segredo("BRIDGE_API_TOKEN"))):
    """Marca cada integração como configurada ou não, olhando o ambiente.

    A tabela `integrations` guarda o **nome** da variável (`key_name`), nunca o
    valor. Este endpoint confere quais dessas variáveis existem de fato e grava
    o resultado, mais uma prévia mascarada, para a tela mostrar "configurada"
    sem nunca receber o segredo.

    A prévia mostra 4 caracteres de cada ponta: o suficiente para alguém
    reconhecer *qual* chave está lá, insuficiente para usá-la.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch("SELECT id, key_name FROM public.integrations")

        configuradas = 0
        for linha in linhas:
            valor = os.environ.get(linha["key_name"]) or ""
            if valor:
                configuradas += 1
                previa = (
                    f"{valor[:4]}●●●●●●●●{valor[-4:]}" if len(valor) > 8
                    else f"●●●●{valor[-4:]}"
                )
            else:
                previa = None
            await conn.execute(
                "UPDATE public.integrations SET is_configured = $2, key_preview = $3, "
                "updated_at = now() WHERE id = $1",
                linha["id"], bool(valor), previa,
            )

    logger.info("Chaves de integração: %d de %d configuradas", configuradas, len(linhas))
    return ChavesOut(checadas=len(linhas), configuradas=configuradas)


# ─────────────────────────────────────────────────────────────────────────────
# Espelho dos arquivos de agente — portado de `sync-agent-files`
# ─────────────────────────────────────────────────────────────────────────────
#
# A ponte na VPS mantém `agent_files` em dia nos dois sentidos:
#   - empurra o que está no disco para cá (o caso comum)
#   - puxa daqui o que foi editado pela tela, marcado com `pending_write`
#
# ⚠️ Com `agents.files.get` funcionando no gateway (ver `CLAUDE.md`), a metade
# de leitura desta ponte pode ter perdido a razão de existir. A de escrita
# não: continua sendo o caminho para a tela alterar arquivo do agente.
# Reavaliar depois da entrega — está em `docs/ROADMAP.md`.


class ArquivoAgente(BaseModel):
    agent_id: str = Field(min_length=1)
    file_name: str = Field(min_length=1)
    content: str = ""
    # Marca que a origem é a tela e o disco ainda não recebeu. A ponte usa isto
    # para saber o que escrever de volta.
    pending_write: bool = False


class SincronizarArquivosIn(BaseModel):
    files: list[ArquivoAgente] = Field(min_length=1, max_length=200)


class ConfirmacaoEscrita(BaseModel):
    agent_id: str
    file_name: str


@router.post("/agent-files", status_code=status.HTTP_204_NO_CONTENT)
async def espelhar_arquivos(
    dados: SincronizarArquivosIn,
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Grava o conteúdo dos arquivos, sobrescrevendo por `(agent_id, file_name)`."""
    async with sessao(role="service_role") as conn:
        for a in dados.files:
            await conn.execute(
                """
                INSERT INTO public.agent_files (agent_id, file_name, content, pending_write, synced_at)
                VALUES ($1, $2, $3, $4, now())
                ON CONFLICT (agent_id, file_name) DO UPDATE SET
                    content = EXCLUDED.content,
                    pending_write = EXCLUDED.pending_write,
                    synced_at = now()
                """,
                a.agent_id, a.file_name, a.content, a.pending_write,
            )
    logger.info("Espelhados %d arquivo(s) de agente", len(dados.files))


@router.get("/agent-files/pendentes")
async def arquivos_pendentes(_: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN"))):
    """O que a tela editou e o disco ainda não recebeu."""
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT agent_id, file_name, content FROM public.agent_files "
            "WHERE pending_write = true LIMIT 200"
        )
    return {"files": [dict(l) for l in linhas]}


@router.post("/agent-files/confirmar", status_code=status.HTTP_204_NO_CONTENT)
async def confirmar_escrita(
    dados: list[ConfirmacaoEscrita],
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """A ponte avisa o que já escreveu no disco.

    Confirmar é passo separado de puxar, de propósito: se a ponte marcasse como
    escrito ao receber, uma falha entre receber e gravar perderia a edição em
    silêncio — e o usuário veria na tela um arquivo que o agente nunca leu.
    """
    async with sessao(role="service_role") as conn:
        for c in dados:
            await conn.execute(
                "UPDATE public.agent_files SET pending_write = false, written_at = now() "
                "WHERE agent_id = $1 AND file_name = $2",
                c.agent_id, c.file_name,
            )


# ─────────────────────────────────────────────────────────────────────────────
# Integrações: registro e entrega de credenciais ao agente
# ─────────────────────────────────────────────────────────────────────────────
#
# Portados de `register-integration` e `fetch-agent-credentials`. Os dois lidam
# com **segredo de cliente** (chave de API do Meta, do Google, etc.), então duas
# regras valem em todo este bloco:
#
# 1. Nada aqui é exposto ao navegador — só ao serviço da VPS, por segredo
#    compartilhado. É por isso que a tela usa `key_preview`, que é máscara.
# 2. Valor de credencial nunca vai para log.


class CredencialIn(BaseModel):
    key_name: str
    value: str = ""
    label: str | None = None


class IntegracaoIn(BaseModel):
    name: str = Field(min_length=1)
    category: str = Field(min_length=1)
    key_name: str = Field(min_length=1)
    key_preview: str | None = None
    agents_using: list[str] = []
    description: str | None = None
    icon: str = "🔑"
    added_by_agent: str | None = None
    is_configured: bool = False
    integration_type: str = "api_key"
    credentials: list[CredencialIn] = []
    template_id: str | None = None


_TIPOS_INTEGRACAO = {"api_key", "multi_key", "mcp"}


@router.post("/integrations", status_code=status.HTTP_201_CREATED)
async def registrar_integracao(
    dados: IntegracaoIn,
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Cria ou atualiza uma integração, **mesclando** as credenciais.

    Mesclar, não substituir: o agente pode registrar de novo uma integração
    mandando só a chave que ele conhece, e substituir apagaria as outras. A
    regra da edge, mantida: credencial que chega **com valor vazio** preserva o
    valor que já estava — é assim que o agente atualiza rótulo sem reenviar o
    segredo.
    """
    if dados.integration_type not in _TIPOS_INTEGRACAO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"integration_type inválido. Use um de: {', '.join(sorted(_TIPOS_INTEGRACAO))}.",
        )

    async with sessao(role="service_role") as conn:
        existente = await conn.fetchrow(
            "SELECT id, credentials FROM public.integrations "
            "WHERE name = $1 OR key_name = $2 LIMIT 1",
            dados.name, dados.key_name,
        )

        antigas = []
        if existente and existente["credentials"]:
            bruto = existente["credentials"]
            antigas = json.loads(bruto) if isinstance(bruto, str) else bruto

        por_nome = {c.get("key_name"): c for c in antigas if isinstance(c, dict)}
        for nova in dados.credentials:
            anterior = por_nome.get(nova.key_name, {})
            por_nome[nova.key_name] = {
                "key_name": nova.key_name,
                # Valor vazio preserva o que já havia.
                "value": nova.value or anterior.get("value", ""),
                "label": nova.label or anterior.get("label"),
            }
        mescladas = list(por_nome.values())

        if existente:
            await conn.execute(
                """
                UPDATE public.integrations SET
                    name = $2, category = $3, key_name = $4,
                    key_preview = COALESCE($5, key_preview),
                    agents_using = $6::text[], description = $7, icon = $8,
                    is_configured = $9, integration_type = $10,
                    credentials = $11::jsonb, template_id = COALESCE($12, template_id),
                    updated_at = now()
                 WHERE id = $1
                """,
                existente["id"], dados.name, dados.category, dados.key_name,
                dados.key_preview, dados.agents_using, dados.description, dados.icon,
                dados.is_configured, dados.integration_type,
                json.dumps(mescladas), dados.template_id,
            )
            acao = "atualizada"
        else:
            await conn.execute(
                """
                INSERT INTO public.integrations
                    (name, category, key_name, key_preview, agents_using, description,
                     icon, added_by_agent, is_configured, integration_type,
                     credentials, template_id)
                VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11::jsonb,$12)
                """,
                dados.name, dados.category, dados.key_name, dados.key_preview,
                dados.agents_using, dados.description, dados.icon,
                dados.added_by_agent, dados.is_configured, dados.integration_type,
                json.dumps(mescladas), dados.template_id,
            )
            acao = "criada"

    # Log sem valor de credencial, de propósito.
    logger.info("Integração %s %s (%d credenciais)", dados.name, acao, len(mescladas))
    return {"success": True, "acao": acao, "credenciais": len(mescladas)}


@router.get("/agent-credentials/{agent_id}")
async def credenciais_do_agente(
    agent_id: str,
    provider: str = "",
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """As credenciais que este agente pode usar.

    ⚠️ **Devolve valor de segredo em claro.** É o ponto do endpoint: o agente
    precisa da chave para chamar a API do provedor. Por isso está atrás do
    segredo compartilhado e nunca é exposto ao navegador — a tela vê
    `key_preview`, que é máscara.

    O filtro `provider` compara com nome e `key_name` porque era assim na edge:
    o agente pede \"as credenciais do meta\" sem saber como a integração foi
    cadastrada.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT name, key_name, credentials FROM public.integrations "
            "WHERE is_configured = true AND $1 = ANY(agents_using)",
            agent_id,
        )

    alvo = provider.strip().lower()
    credenciais: dict[str, str] = {}
    integracoes: list[dict] = []
    for linha in linhas:
        if alvo and alvo not in f"{linha['name']} {linha['key_name']}".lower():
            continue
        bruto = linha["credentials"] or "[]"
        lista = json.loads(bruto) if isinstance(bruto, str) else bruto
        chaves = []
        for c in lista:
            nome = str((c or {}).get("key_name") or "").strip()
            valor = str((c or {}).get("value") or "")
            if nome and valor:
                credenciais[nome] = valor
                chaves.append(nome)
        if chaves:
            integracoes.append({"name": linha["name"], "keys": chaves})

    logger.info(
        "Credenciais entregues a %s: %d chave(s) de %d integração(ões)",
        agent_id, len(credenciais), len(integracoes),
    )
    return {"credentials": credenciais, "integrations": integracoes}
