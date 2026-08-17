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
import re
import unicodedata

import httpx
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.gateway import config as cfg_gateway, patch as patch_gw
from app.gateway.client import ErroGateway as ErroGatewayCli, obter_cliente as obter_cliente_gw
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.integracoes import exige_segredo, ler_segredo
from app.realtime import hub, topico_usuario

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/integracoes", tags=["integrações"])

# Allowlist do que pode ser revelado. Sem ela, o endpoint viraria leitura livre
# da tabela de segredos — que guarda mais coisa do que o admin precisa ver.
_SEGREDOS_REVELAVEIS = {"GUARDRAILS_API_TOKEN", "BRIDGE_API_TOKEN", "INGEST_API_KEY"}


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
            VALUES ($1, $2, $3, $4, $5::text::jsonb, NULLIF($6,'')::uuid, $7, $8::text::jsonb)
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
            atribuicoes.append(f"{nome} = ${i}::text::jsonb")
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


@router.get("/guardrails/token")
async def revelar_token_guardrails(_: Usuario = Depends(exige_papel("administrador"))):
    """Mostra o token que a VPS usa para escrever guardrails. Só `administrador`.

    Existe porque quem configura a VPS precisa **conferir** o token, não
    adivinhá-lo: sem isto o caminho era cadastrar um valor lá e descobrir que
    estava errado quando a escrita começasse a dar 401.

    Lê do mesmo lugar que a validação (`ler_segredo`), e é isso que garante que
    o que se mostra é o que se aceita — duas fontes divergiriam em silêncio.
    """
    token = await ler_segredo("GUARDRAILS_API_TOKEN")
    if not token:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "GUARDRAILS_API_TOKEN não está configurado neste backend.",
        )
    logger.info("Token de guardrails revelado para um administrador")
    return {"token": token}


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
            "UPDATE public.agent_profiles SET guardrails = $2::text::jsonb, updated_at = now() "
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
                    credentials = $11::text::jsonb, template_id = COALESCE($12, template_id),
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
                VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8,$9,$10,$11::text::jsonb,$12)
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


# ─────────────────────────────────────────────────────────────────────────────
# Revelar o segredo compartilhado — portado de `reveal-guardrails-token`
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/segredo/{nome}")
async def revelar_segredo(
    nome: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    """Mostra um segredo de integração ao administrador.

    Existe para o admin cadastrar o mesmo valor do lado da VPS. **Lê da mesma
    fonte que a autenticação usa** — banco primeiro, ambiente depois. Se lesse
    só do ambiente, mostraria um valor diferente do que de fato autentica
    quando o segredo vier do banco, e alguém cadastraria o token errado na VPS.

    Só `administrador`, e o valor não vai para log.
    """
    if nome not in _SEGREDOS_REVELAVEIS:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f"Segredo desconhecido. Reveláveis: {', '.join(sorted(_SEGREDOS_REVELAVEIS))}.",
        )
    valor = await ler_segredo(nome)
    logger.info("Segredo %s revelado a %s", nome, usuario.id)
    return {"nome": nome, "token": valor, "configurado": bool(valor)}


# ─────────────────────────────────────────────────────────────────────────────
# Validar credencial de integração — portado de `validate-integration-token`
# ─────────────────────────────────────────────────────────────────────────────
#
# Prova que a chave cadastrada funciona, chamando o provedor. Mesma ideia do
# `/agents/test-model`: estar gravado não é estar funcionando.

_PROVEDORES_CONHECIDOS = {
    "linkedin", "meta", "facebook", "instagram", "telegram", "slack",
    "whatsapp", "canva", "elevenlabs", "perplexity",
}
# Nome de chave que costuma guardar o token de acesso, entre várias credenciais.
_CHAVE_DE_TOKEN = re.compile(r"access[_-]?token|api[_-]?key|bearer|^token$", re.I)
_TIMEOUT_VALIDACAO = 15.0


class ValidacaoIn(BaseModel):
    integration_id: str | None = None
    integration_type: str = ""
    credentials: dict = {}


class ValidacaoOut(BaseModel):
    valid: bool
    error: str | None = None
    detalhe: str | None = None


def _escolher_token(credenciais: list) -> str:
    """O token entre várias credenciais.

    Prefere a chave cujo nome parece de token de acesso; se nenhuma casar, usa
    a última com valor. Era o comportamento da edge, e existe porque uma
    integração pode guardar id de conta junto com o segredo.
    """
    reserva = ""
    escolhido = ""
    for c in credenciais:
        valor = str((c or {}).get("value") or "").strip()
        if not valor:
            continue
        reserva = valor
        nome = str((c or {}).get("key_name") or (c or {}).get("key") or "")
        if _CHAVE_DE_TOKEN.search(nome):
            escolhido = valor
    return escolhido or reserva


@router.post("/validar-token", response_model=ValidacaoOut)
async def validar_token(
    dados: ValidacaoIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Chama o provedor para confirmar que a credencial vale.

    O endereço de validação vem de `integration_templates.validation_endpoint`,
    exceto pelo LinkedIn, que tem caminho próprio na edge e foi mantido: o token
    dele começa com `WPL_AP`, que é código de autorização e não token de acesso —
    reconhecer isso dá uma mensagem útil em vez de um 401 genérico.
    """
    tipo = dados.integration_type.strip().lower()
    token = ""

    async with sessao(role="service_role") as conn:
        if dados.integration_id:
            linha = await conn.fetchrow(
                "SELECT name, integration_type, credentials FROM public.integrations WHERE id = $1::uuid",
                dados.integration_id,
            )
            if linha is None:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "Conexão não encontrada.")
            tipo = tipo or str(linha["integration_type"] or "").lower()
            # `api_key` é genérico demais para escolher endpoint: nesse caso o
            # nome da integração é a pista melhor.
            if tipo in ("", "api_key", "custom", "api"):
                pelo_nome = re.sub(r"[^a-z]", "", str(linha["name"] or "").lower())
                if pelo_nome in _PROVEDORES_CONHECIDOS:
                    tipo = "meta" if pelo_nome == "facebook" else pelo_nome
            bruto = linha["credentials"] or "[]"
            token = _escolher_token(json.loads(bruto) if isinstance(bruto, str) else bruto)
        else:
            c = dados.credentials
            token = str(c.get("access_token") or c.get("token") or c.get("api_key") or "").strip()

        if not tipo:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "integration_type é obrigatório.")
        if not token:
            return ValidacaoOut(valid=False, error="Nenhuma credencial com valor foi encontrada.")

        if tipo == "linkedin" and token.upper().startswith("WPL_AP"):
            return ValidacaoOut(
                valid=False,
                error="Este é um código de autorização, não um token de acesso. "
                "Troque-o por um access token antes de salvar.",
            )

        endpoint, metodo = None, "GET"
        if tipo == "linkedin":
            endpoint = "https://api.linkedin.com/v2/userinfo"
        else:
            # A coluna que identifica o provedor é `integration_type`, não
            # `name` nem `id` — o `id` é uuid e casar com ele daria erro de tipo.
            tpl = await conn.fetchrow(
                "SELECT validation_endpoint, validation_method FROM public.integration_templates "
                "WHERE lower(integration_type) = $1",
                tipo,
            )
            if tpl:
                endpoint = tpl["validation_endpoint"]
                metodo = tpl["validation_method"] or "GET"

    if not endpoint:
        return ValidacaoOut(
            valid=False,
            error=f"Não há endereço de validação cadastrado para '{tipo}'. "
            "A credencial foi salva, mas não dá para confirmar que funciona.",
        )

    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT_VALIDACAO) as http:
            r = await http.request(
                metodo, endpoint, headers={"Authorization": f"Bearer {token}"}
            )
    except httpx.HTTPError as e:
        return ValidacaoOut(valid=False, error="Não foi possível falar com o provedor.",
                            detalhe=str(e)[:200])

    if r.is_success:
        return ValidacaoOut(valid=True)
    # O corpo do erro do provedor é o que permite diagnosticar; truncado, e
    # nunca inclui o token.
    return ValidacaoOut(
        valid=False,
        error=f"O provedor recusou a credencial (HTTP {r.status_code}).",
        detalhe=r.text[:300] or None,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Revelar credenciais de um conector — portado de `reveal-connector-credentials`
# ─────────────────────────────────────────────────────────────────────────────

# Sufixos que provedores costumam usar. A busca é por tentativa porque o valor
# vive em variável de ambiente e não há como listar "as variáveis deste
# conector" — só perguntar por nome.
_SUFIXOS_COMUNS = [
    "API_KEY", "ACCESS_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN",
    "SECRET_KEY", "WEBHOOK_SECRET", "BOT_TOKEN", "ACCOUNT_SID", "AUTH_TOKEN",
    "PHONE_NUMBER_ID", "PAGE_ID", "AD_ACCOUNT_ID", "APP_ID", "BASE_URL", "TOKEN",
]


@router.get("/conectores/{integration_id}/credenciais")
async def revelar_credenciais_conector(
    integration_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    """Mostra ao admin as credenciais que o **ambiente** tem para este conector.

    ⚠️ Devolve valor em claro, e por isso é `administrador`. É o único ponto do
    sistema que devolve credencial ao navegador.

    ⚠️ **Só lê variável de ambiente do backend, nunca o `credentials` do banco**
    — e essa assimetria já custou caro. O formulário grava no banco; este
    endpoint lê do ambiente. Chave digitada na tela, portanto, nunca volta a
    aparecer, e a tela precisa saber disso: quem diz o que está guardado no
    banco é o `credential_keys` da listagem, que devolve os **nomes** das
    chaves. Antes de existir, o formulário abria em branco e salvar apagava o
    que a pessoa não redigitou.

    Procura em três lugares, na ordem do original: os nomes de chave gravados em
    `credentials`, o `key_name` da integração, e o prefixo derivado do
    `template_id` combinado com os sufixos comuns.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, key_name, credentials, template_id FROM public.integrations "
            "WHERE id = $1::uuid",
            integration_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")

    nomes: list[str] = []
    bruto = linha["credentials"] or "[]"
    for c in (json.loads(bruto) if isinstance(bruto, str) else bruto):
        nome = str((c or {}).get("key_name") or (c or {}).get("key") or "").strip()
        if nome:
            nomes.append(nome)
    if linha["key_name"]:
        nomes.append(linha["key_name"])
    if linha["template_id"]:
        prefixo = re.sub(r"[^A-Z0-9]+", "_", str(linha["template_id"]).upper())
        nomes += [f"{prefixo}_{s}" for s in _SUFIXOS_COMUNS]

    encontradas = {n: os.environ[n] for n in dict.fromkeys(nomes) if os.environ.get(n)}
    logger.info(
        "Credenciais do conector %s reveladas a %s: %d encontrada(s)",
        linha["name"], usuario.id, len(encontradas),
    )
    return {"success": True, "credentials": encontradas}


# ─────────────────────────────────────────────────────────────────────────────
# Onboarding da empresa — portado de `notify-orchestrator-onboarding`
# ─────────────────────────────────────────────────────────────────────────────


# Marcadores do bloco gerado. Existem para o reenvio SUBSTITUIR o bloco em vez
# de empilhar cópias, e para o resto do AGENTS.md — que o agente ou a
# orquestradora podem ter escrito — sobreviver intacto.
_MARCA_INICIO = "<!-- hsos:empresa:inicio -->"
_MARCA_FIM = "<!-- hsos:empresa:fim -->"


def _com_bloco_da_empresa(atual: str, bloco: str) -> str:
    """Insere ou substitui o bloco da empresa no conteúdo do `AGENTS.md`."""
    novo = f"{_MARCA_INICIO}\n{bloco}\n{_MARCA_FIM}"
    i, f = atual.find(_MARCA_INICIO), atual.find(_MARCA_FIM)
    if i != -1 and f != -1 and f > i:
        return atual[:i] + novo + atual[f + len(_MARCA_FIM):]
    return (atual.rstrip() + "\n\n" + novo + "\n") if atual.strip() else novo + "\n"


async def _distribuir_contexto(bloco: str) -> list[dict]:
    """Escreve o bloco da empresa no `AGENTS.md` de cada agente que existe.

    ⚠️ **Isto era trabalho da orquestradora, e não devia ser.** A instrução
    antiga mandava ela ler o `openclaw.json`, descobrir os workspaces e escrever
    um `COMPANY.md` em cada um. Três coisas estavam erradas:

    1. **O `COMPANY.md` não carrega sozinho.** A instrução afirmava que "será
       injetado automaticamente no contexto de cada agente" — não é. O OpenClaw
       carrega sete nomes fixos, e esse não é um deles. O time só saberia da
       empresa se alguém mandasse abrir o arquivo, o que ninguém faz.
    2. **Inserir texto igual em N arquivos é mecânico.** Um LLM não agrega nada
       ali, e cobra por isso: em 13/08/2026 a operação gastou 34 mil tokens.
    3. **Ela errou.** A memória dela dizia que havia quatro agentes; o
       `agents.list` dizia que havia um. Ela escolheu a memória, escreveu em
       workspaces inexistentes e relatou "concluído" sem reler.

    Agora o backend faz: itera o `agents.list` (que é a verdade sobre quem
    existe), escreve no `AGENTS.md` — que **é** um dos sete — entre marcadores,
    e **relê para conferir**. Zero token, zero invenção.
    """
    c = await cfg_gateway.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado."
        )
    cliente = obter_cliente_gw(c.url, c.token)

    try:
        lista = await cliente.chamar("agents.list")
    except ErroGatewayCli as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"Não consegui listar os agentes: {e}"
        ) from e

    resultado: list[dict] = []
    for a in lista.get("agents", []):
        aid = a.get("id")
        if not aid:
            continue
        try:
            r = await cliente.chamar("agents.files.get", {"agentId": aid, "name": "AGENTS.md"})
            atual = (r.get("file") or {}).get("content") or ""
            await cliente.chamar(
                "agents.files.set",
                {"agentId": aid, "name": "AGENTS.md", "content": _com_bloco_da_empresa(atual, bloco)},
            )
            # Relê: escrever sem conferir é como a operação de hoje relatou
            # sucesso para um arquivo que não estava lá.
            v = await cliente.chamar("agents.files.get", {"agentId": aid, "name": "AGENTS.md"})
            ok = _MARCA_INICIO in ((v.get("file") or {}).get("content") or "")
            resultado.append({"agent_id": aid, "ok": ok,
                              "erro": None if ok else "escrito, mas o bloco não apareceu na releitura"})
        except ErroGatewayCli as e:
            resultado.append({"agent_id": aid, "ok": False, "erro": str(e)})
    return resultado


@router.post("/onboarding-empresa", status_code=status.HTTP_202_ACCEPTED)
async def onboarding_empresa(usuario: Usuario = Depends(exige_papel("administrador"))):
    """Escreve o contexto da empresa no `AGENTS.md` de cada agente.

    É o que faz o time saber para qual empresa trabalha. Sem isso, cada agente
    responde no vácuo.

    Vai no `AGENTS.md` porque ele é um dos sete que o OpenClaw carrega sozinho.
    Ver `_distribuir_contexto` para por que deixou de ser um `COMPANY.md`
    escrito pela orquestradora.

    `onboarding_notified_at` só é marcada quando todos receberam.
    """
    async with sessao(role="service_role") as conn:
        p = await conn.fetchrow("SELECT * FROM public.company_profile LIMIT 1")
    if p is None or not (p["company_name"] or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Preencha o perfil da empresa antes de apresentar o time a ela.",
        )

    campos = [
        ("Nome", p["company_name"]), ("Fundador / CEO", p["founder_name"]),
        ("Segmento", p["segment"]), ("Descrição", p["description"]),
        ("Público-alvo", p["target_audience"]),
        ("Produtos/Serviços", p["products_services"]),
        ("Faturamento", p["revenue"]), ("Funcionários", p["employees_count"]),
        ("Tom de comunicação", p["tone"]),
    ]
    linhas = ["# Empresa", ""]
    linhas += [f"**{r}:** {v}" for r, v in campos if v]
    if p["extra_context"]:
        linhas.append(f"\n**Contexto adicional:**\n{p['extra_context']}")
    company_md = "\n".join(linhas).strip()

    resultado = await _distribuir_contexto(company_md)
    escritos = [r for r in resultado if r["ok"]]
    falhas = [r for r in resultado if not r["ok"]]

    # A data só é marcada quando TODOS receberam. Antes ela era gravada de
    # qualquer jeito, e a tela dizia "Super agentes atualizados" mesmo quando
    # nada tinha sido atualizado — afirmava o envio, não o resultado.
    if resultado and not falhas:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                "UPDATE public.company_profile SET onboarding_notified_at = now() WHERE id = $1",
                p["id"],
            )

    logger.info("Contexto da empresa distribuído: %d ok, %d falha(s)", len(escritos), len(falhas))
    return {
        "ok": bool(resultado) and not falhas,
        "atualizados": [r["agent_id"] for r in escritos],
        "falhas": falhas,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Chamar a API de uma integração — portado de `invoke-integration`
# ─────────────────────────────────────────────────────────────────────────────
#
# É o backend do `window.dnos.invoke()` que os live artifacts usam. A regra que
# sustenta tudo: **a credencial nunca chega ao navegador.** O artefato pede
# "integração meta, endpoint insights" e recebe só o resultado.

# Playbook mínimo para quando `integration_templates` ainda não tem a linha.
# Existe porque a Meta é a integração que já estava em uso quando o template
# virou tabela — sem isto, uma instalação nova responderia "playbook não
# encontrado" para algo que sempre funcionou.
_PLAYBOOKS_PADRAO: dict[str, dict] = {
    "meta": {
        "base_url": "https://graph.facebook.com/v20.0",
        "data_endpoints": {
            "insights": {"method": "GET", "path": "/{account_id}/insights"},
            "campaigns": {"method": "GET", "path": "/{account_id}/campaigns"},
        },
    },
}


def _tipo_canonico(linha) -> str:
    """Reduz as várias formas de dizer "Meta" a uma só.

    As linhas de `integrations` foram criadas em épocas diferentes e a Meta
    aparece ora como `integration_type`, ora só no nome, ora como
    `prisma_user_token` no `key_name`. Comparar só o `integration_type` fazia a
    integração já conectada parecer ausente.
    """
    tipo = str(linha["integration_type"] or "").lower()
    nome = str(linha["name"] or "").lower()
    chave = str(linha["key_name"] or "").lower()
    if tipo == "meta" or "meta" in nome or "meta" in chave or "prisma_user_token" in chave:
        return "meta"
    return tipo


def _token_da_integracao(credenciais, key_name: str | None) -> str | None:
    """Acha o token, aceitando os dois formatos que convivem na tabela.

    `credentials` é ora um objeto `{access_token: ...}`, ora uma lista de pares
    `{key_name, value}` — as telas de integração gravaram das duas formas ao
    longo do tempo. A variável de ambiente é o último recurso, para credencial
    que nunca foi para o banco.
    """
    if isinstance(credenciais, str):
        try:
            credenciais = json.loads(credenciais)
        except ValueError:
            credenciais = None

    if isinstance(credenciais, list):
        def pegar(nome: str):
            for c in credenciais:
                if str(c.get("key_name") or c.get("key") or "").lower() == nome:
                    return c.get("value")
            return None
        token = pegar("access_token") or pegar("token") or pegar("api_key")
        if not token and credenciais:
            token = credenciais[0].get("value")
        if token:
            return str(token)
    elif isinstance(credenciais, dict):
        for campo in ("access_token", "token", "api_key"):
            if credenciais.get(campo):
                return str(credenciais[campo])

    return os.environ.get(key_name or "") or None


async def _conta_de_anuncio_meta(token: str) -> str | None:
    """Descobre a conta de anúncios quando o chamador não informa.

    A Meta exige `act_<id>` no caminho e o artefato raramente sabe o número.
    Perguntar à própria API é mais confiável que pedir a quem escreve o prompt.
    """
    try:
        async with httpx.AsyncClient(timeout=20) as cliente:
            r = await cliente.get(
                "https://graph.facebook.com/v20.0/me/adaccounts",
                params={"fields": "id,account_id,name,account_status", "limit": 1},
                headers={"Authorization": f"Bearer {token}"},
            )
        if r.status_code != 200:
            return None
        primeiro = (r.json().get("data") or [None])[0]
    except (httpx.HTTPError, ValueError):
        return None
    ident = (primeiro or {}).get("id") or (primeiro or {}).get("account_id")
    if not ident:
        return None
    return str(ident) if str(ident).startswith("act_") else f"act_{ident}"


class ChamadaIn(BaseModel):
    integration: str = Field(min_length=1)
    endpoint: str = Field(min_length=1)
    params: dict = {}


def _recusa(mensagem: str, codigo: str) -> dict:
    """Erro esperado, devolvido com HTTP 200.

    Não é descuido: quem chama é um live artifact rodando dentro do navegador
    da pessoa, e um 4xx aqui vira erro vermelho no console para uma situação
    normal — "essa integração ainda não foi conectada". O artefato lê o `code`.
    """
    return {"ok": False, "error": mensagem, "code": codigo}


@router.post("/invocar")
async def invocar(dados: ChamadaIn, usuario: Usuario = Depends(usuario_atual)):
    """Chama um endpoint do playbook da integração e devolve a resposta crua."""
    pedida = dados.integration.strip().lower()

    async with sessao(role="service_role") as conn:
        # Limite por pessoa. A integração gasta cota e dinheiro da empresa, e
        # qualquer usuário logado dispara via artefato. Falha do limitador
        # **libera** a chamada: derrubar uso legítimo por erro do contador é
        # pior que deixar passar uma rajada.
        try:
            liberado = await conn.fetchval(
                "SELECT public.check_invoke_rate($1::uuid, $2, $3)", usuario.id, 100, 60
            )
            if liberado is False:
                return _recusa(
                    "Muitas chamadas de integração em pouco tempo. Aguarde um instante.",
                    "rate_limited",
                )
        except Exception as e:  # noqa: BLE001
            logger.warning("Limitador de integração indisponível: %s", e)

        linhas = await conn.fetch(
            "SELECT name, key_name, integration_type, credentials FROM public.integrations "
            " WHERE is_configured = true ORDER BY updated_at DESC"
        )
        linha = next((l for l in linhas if _tipo_canonico(l) == pedida), None)
        if linha is None:
            return _recusa(
                f"Integração '{dados.integration}' não configurada.",
                "integration_not_configured",
            )

        modelo = await conn.fetchval(
            "SELECT playbook FROM public.integration_templates WHERE integration_type = $1", pedida
        )

    if isinstance(modelo, str):
        modelo = json.loads(modelo)
    playbook = modelo or _PLAYBOOKS_PADRAO.get(pedida)
    if not playbook:
        return _recusa(
            f"Playbook não encontrado para '{dados.integration}'.", "playbook_not_found"
        )

    destino = (playbook.get("data_endpoints") or {}).get(dados.endpoint)
    if not destino:
        return _recusa(
            f"Endpoint '{dados.endpoint}' não existe no playbook de '{dados.integration}'.",
            "endpoint_not_found",
        )

    token = _token_da_integracao(linha["credentials"], linha["key_name"])
    if not token:
        return _recusa(
            f"Integração '{dados.integration}' está marcada como configurada, mas não tem "
            "um token utilizável. Reconecte em Configurações → Integrações.",
            "integration_token_missing",
        )

    base = playbook.get("base_url")
    if not base:
        raise HTTPException(
            status.HTTP_500_INTERNAL_SERVER_ERROR,
            "O playbook desta integração está sem `base_url`.",
        )

    caminho = destino.get("path") or ""
    parametros = dict(dados.params)

    if pedida == "meta":
        parametros = await _ajustar_meta(parametros, caminho, token)
        if not parametros.get("account_id") and "{account_id}" in caminho:
            return _recusa("account_id ausente para consulta Meta.", "missing_account_id")

    consulta: dict[str, str] = {}
    for chave, valor in parametros.items():
        if valor is None:
            continue
        if f"{{{chave}}}" in caminho:
            caminho = caminho.replace(f"{{{chave}}}", quote(str(valor), safe=""))
        elif chave == "filtering":
            consulta[chave] = json.dumps(_como_lista(valor))
        elif isinstance(valor, (list, dict)):
            consulta[chave] = json.dumps(valor)
        else:
            consulta[chave] = str(valor)

    try:
        async with httpx.AsyncClient(timeout=60) as cliente:
            r = await cliente.request(
                destino.get("method") or "GET",
                f"{base}{caminho}",
                params=consulta,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
            )
    except httpx.HTTPError as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY, f"A API de '{dados.integration}' não respondeu: {e}"
        )

    try:
        corpo = r.json()
    except ValueError:
        corpo = r.text

    if r.status_code >= 400:
        # O corpo do upstream vai junto: sem ele, "erro 400 da Meta" não diz
        # qual parâmetro estava errado, e o artefato não tem como se corrigir.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            {"error": f"A API respondeu {r.status_code}.", "upstream": corpo},
        )

    logger.info("Integração %s/%s chamada por %s", pedida, dados.endpoint, usuario.id)
    return {"success": True, "data": corpo}


def _como_lista(valor) -> list:
    """A Meta recusa `filtering` que não seja array JSON.

    Quem escreve o artefato manda um objeto ou uma string com frequência, e o
    erro que volta — "(#100) param filtering must be an array" — não ajuda em
    nada. Normalizar aqui é mais barato que ensinar a regra ao agente.
    """
    if isinstance(valor, list):
        return valor
    if isinstance(valor, str):
        texto = valor.strip()
        if texto.startswith(("[", "{")):
            try:
                lido = json.loads(texto)
            except ValueError:
                return [texto]
            return lido if isinstance(lido, list) else [lido]
        return [texto]
    return [valor]


async def _ajustar_meta(parametros: dict, caminho: str, token: str) -> dict:
    """Preenche o que a Meta exige e o chamador costuma esquecer."""
    if not parametros.get("account_id"):
        conta = next(
            (os.environ[v] for v in
             ("META_AD_ACCOUNT_ID", "META_ACCOUNT_ID", "PRISMA_META_AD_ACCOUNT_ID")
             if os.environ.get(v)),
            None,
        )
        if conta:
            parametros["account_id"] = conta if conta.startswith("act_") else f"act_{conta}"
        else:
            parametros["account_id"] = await _conta_de_anuncio_meta(token)

    # Insights sem janela de tempo é erro na Meta, e o padrão dela não serve.
    # 30 dias é o que a tela mostrava antes de existir seletor de período.
    quer_insights = "insights" in str(parametros.get("fields", "")) or "insights" in caminho
    intervalo = parametros.get("time_range")
    tem_intervalo = bool(
        (isinstance(intervalo, dict) and intervalo.get("since") and intervalo.get("until"))
        or (isinstance(intervalo, str) and len(intervalo.strip()) > 2)
    )
    if quer_insights and not tem_intervalo and not parametros.get("date_preset"):
        hoje = datetime.now(UTC).date()
        parametros["time_range"] = {
            "since": str(hoje - timedelta(days=30)),
            "until": str(hoje),
        }
    return parametros


@router.get("/empresa/perfil")
async def perfil_da_empresa(usuario: Usuario = Depends(usuario_atual)):
    """O perfil da empresa desta instalação, ou `null` se ainda não preencheram.

    Há **uma** linha por instalação; o `LIMIT 1` é o que traduz isso em SQL.
    `null` em vez de 404 porque a resposta esperada para instalação nova é
    exatamente "ainda não tem" — é o que o banner de onboarding pergunta.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT * FROM public.company_profile LIMIT 1"
        )
    return json.loads(json.dumps(dict(linha), default=str)) if linha else None


# O banco tem um CHECK nesta coluna. Repetir a lista aqui é o que transforma
# "500 sem explicação" em "tom inválido, use um destes" — o CHECK continua sendo
# a garantia, isto é só a mensagem.
_TONS = {"formal", "informal", "técnico", "descontraído"}


class PerfilEmpresaIn(BaseModel):
    company_name: str | None = None
    founder_name: str | None = None
    segment: str | None = None
    description: str | None = None
    target_audience: str | None = None
    products_services: str | None = None
    tone: str | None = None
    revenue: str | None = None
    employees_count: str | None = None
    extra_context: str | None = None


@router.put("/empresa/perfil")
async def gravar_perfil_da_empresa(
    dados: PerfilEmpresaIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Grava o perfil da empresa. Cria a linha se ainda não existir.

    Há **uma** linha por instalação, e a tela não deveria precisar saber se ela
    já existe — mandava um UPDATE por id, o que falhava em silêncio na primeira
    vez, antes de alguém ter salvo qualquer coisa.

    Devolve o perfil relido, com o `onboarding_notified_at`: a tela precisava
    dele de volta e fazia uma segunda consulta só para isso.
    """
    if dados.tone and dados.tone not in _TONS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Tom inválido. Use um de: {', '.join(sorted(_TONS))}.",
        )

    campos = dados.model_dump()
    async with sessao(role="service_role") as conn:
        existente = await conn.fetchval("SELECT id FROM public.company_profile LIMIT 1")
        colunas = ", ".join(campos)
        marcadores = ", ".join(f"${i}" for i in range(1, len(campos) + 1))
        if existente:
            atribuicoes = ", ".join(f"{c} = ${i}" for i, c in enumerate(campos, start=1))
            linha = await conn.fetchrow(
                f"UPDATE public.company_profile SET {atribuicoes}, updated_at = now() "
                f" WHERE id = ${len(campos) + 1} RETURNING *",
                *campos.values(), existente,
            )
        else:
            linha = await conn.fetchrow(
                f"INSERT INTO public.company_profile ({colunas}) "
                f"VALUES ({marcadores}) RETURNING *",
                *campos.values(),
            )
    logger.info("Perfil da empresa gravado.")
    return json.loads(json.dumps(dict(linha), default=str))


# ─────────────────────────────────────────────────────────────────────────────
# CRUD de conectores — a tela de Integrações
# ─────────────────────────────────────────────────────────────────────────────
#
# ⚠️ **As credenciais nunca saem daqui.** A listagem devolve `key_preview` (os
# últimos caracteres) e o booleano `is_configured`; o `credentials` inteiro fica
# no servidor.
#
# O que ela devolve **é** `credential_keys`: os *nomes* das chaves guardadas,
# nunca os valores. Sem isso a tela não tinha como saber que existem, abria o
# formulário em branco, e salvar depois de reeditar apagava as credenciais que
# a pessoa não redigitou — sem nada na tela indicando que existiam.

_COLUNAS_CONECTOR = """
    id::text AS id, name, category, key_name, key_preview, is_configured,
    description, icon, integration_type, type, template_id::text AS template_id,
    agents_using, added_by_agent, last_validation_ok, last_validation_error,
    COALESCE((
        SELECT array_agg(nome)
          FROM jsonb_array_elements(
                   CASE WHEN jsonb_typeof(credentials) = 'array'
                        THEN credentials ELSE '[]'::jsonb END
               ) AS c,
               LATERAL COALESCE(c->>'key_name', c->>'key') AS nome
         WHERE nome IS NOT NULL AND nome <> ''
    ), '{}') AS credential_keys,
    -- Endereço vai para a tela; senha, não. Por isso host/porta/base são colunas
    -- e não campos dentro de `credentials` — misturar obrigaria a escolher entre
    -- expor o segredo ou esconder o endereço.
    db_host, db_porta, db_base, db_sslmode, db_somente_leitura,
    to_char(updated_at         AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS updated_at,
    to_char(last_validated_at  AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS last_validated_at
"""


@router.get("/conectores")
async def listar_conectores(usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT {_COLUNAS_CONECTOR} FROM public.integrations ORDER BY name"
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


class ConectorIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1)
    key_name: str = Field(min_length=1)
    integration_type: str = "api_key"
    description: str | None = None
    icon: str | None = None
    type: str | None = None
    # ⚠️ `template_id` é **text** nesta tabela, apesar do nome. Um `::uuid` aqui
    # dá "COALESCE types uuid and text cannot be matched" no UPDATE.
    template_id: str | None = None
    credentials: list | dict | None = None
    agents_using: list[str] = []

    # ── Conector de banco de dados ───────────────────────────────────────────
    # Só valem quando `integration_type == "database"`. O CHECK
    # `integrations_db_completo_check` recusa banco sem host/porta/base, então
    # cadastro pela metade não passa daqui.
    db_host: str | None = None
    db_porta: int | None = Field(default=None, ge=1, le=65535)
    db_base: str | None = None
    db_sslmode: str = "prefer"
    # ⚠️ **Não é a trava.** Diz apenas qual par de credenciais a conexão usa.
    # Quem recusa um UPDATE é o usuário do Postgres do outro lado — o de leitura
    # do DataCore, por exemplo, é membro de `pg_read_all_data` e tem
    # `default_transaction_read_only = on`.
    db_somente_leitura: bool = True


def _previa(credenciais) -> tuple[str | None, bool]:
    """A ponta da chave, para a pessoa reconhecer qual é sem ver o resto."""
    valor = _token_da_integracao(credenciais, None)
    if not valor:
        return None, False
    return (f"…{valor[-4:]}" if len(valor) > 4 else "…"), True


def _pares_de_credencial(bruto) -> list[dict] | None:
    """Normaliza o `credentials` da tabela para lista de pares, ou `None`."""
    if isinstance(bruto, str):
        try:
            bruto = json.loads(bruto)
        except ValueError:
            return None
    return [c for c in bruto if isinstance(c, dict)] if isinstance(bruto, list) else None


def _mesclar_credenciais(guardadas, recebidas):
    """Junta o que chegou com o que já estava, **por nome de chave**.

    Três casos, nesta ordem:

    - `recebidas is None` → devolve `None`: não mexer no campo.
    - formato de objeto (o caso MCP, `{transport, url, token, …}`) → substitui
      inteiro. Não há par a mesclar, e mesclar objeto por chave apagaria campo
      que a tela deixou de mandar.
    - lista de pares → mescla: **valor vazio preserva o guardado**. É o que
      permite renomear um conector, ou trocar uma chave só, sem redigitar o
      resto — a tela nunca recebe os valores de volta e não teria como.

    Omitir a chave da lista continua sendo como se apaga uma credencial.
    """
    if recebidas is None:
        return None
    novas = _pares_de_credencial(recebidas)
    if novas is None:
        return recebidas

    antigas = {
        str(c.get("key_name") or c.get("key") or ""): c
        for c in (_pares_de_credencial(guardadas) or [])
    }

    mescladas: list[dict] = []
    for nova in novas:
        nome = str(nova.get("key_name") or nova.get("key") or "").strip()
        if not nome:
            continue
        valor = str(nova.get("value") or "")
        if not valor:
            valor = str((antigas.get(nome) or {}).get("value") or "")
        par = {"key_name": nome, "value": valor}
        if nova.get("label"):
            par["label"] = nova["label"]
        mescladas.append(par)
    return mescladas


@router.post("/conectores", status_code=status.HTTP_201_CREATED)
async def criar_conector(
    dados: ConectorIn, _: Usuario = Depends(exige_papel("administrador"))
):
    """Cria um conector. **Nunca sobrescreve um existente.**

    Nome e `key_name` são únicos, e criar "por cima" de um conector que já
    existe apagaria as credenciais e os vínculos de agentes dele. Por isso a
    resposta a um duplicado é 409 com o nome do que já está lá — e não um
    UPSERT silencioso nem o erro cru de constraint, que não diz o que fazer.
    """
    previa, configurado = _previa(dados.credentials)
    async with sessao(role="service_role") as conn:
        duplicado = await conn.fetchrow(
            "SELECT name, key_name FROM public.integrations "
            " WHERE name = $1 OR key_name = $2 LIMIT 1",
            dados.name, dados.key_name,
        )
        if duplicado:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f'Já existe a conexão "{duplicado["name"]}" com esta chave '
                f'({duplicado["key_name"]}). Edite a existente em vez de criar outra — '
                "sobrescrever apagaria credenciais e vínculos.",
            )

        ident = await conn.fetchval(
            """
            INSERT INTO public.integrations
                (name, category, key_name, integration_type, description, icon,
                 type, template_id, credentials, key_preview, is_configured,
                 agents_using, db_host, db_porta, db_base, db_sslmode,
                 db_somente_leitura)
            VALUES ($1,$2,$3,$4,$5,$6,$7, NULLIF($8,''),
                    $9::text::jsonb, $10, $11, $12,
                    NULLIF($13,''), $14, NULLIF($15,''), $16, $17)
            RETURNING id::text
            """,
            dados.name, dados.category, dados.key_name, dados.integration_type,
            dados.description, dados.icon, dados.type, dados.template_id or "",
            json.dumps(dados.credentials) if dados.credentials is not None else None,
            previa, configurado, dados.agents_using,
            dados.db_host or "", dados.db_porta, dados.db_base or "",
            dados.db_sslmode, dados.db_somente_leitura,
        )
    logger.info("Conector %s criado.", dados.name)
    return {"id": ident}


@router.patch("/conectores/{conector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def editar_conector(
    conector_id: str,
    dados: ConectorIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Edita o conector. **Credencial ausente mantém a que está lá.**

    Não é descuido: a tela não recebe a credencial de volta na listagem, então
    ela não tem como reenviá-la ao editar só o nome. Tratar ausente como "apagar"
    faria renomear um conector desconectá-lo.

    ⚠️ Isso valia só para o `credentials` **inteiro** ausente, e não bastava: a
    tela sempre manda a lista, e mandar a lista SUBSTITUÍA o conjunto. Um
    conector com três chaves, reaberto e salvo com uma redigitada, perdia as
    outras duas — em silêncio, porque a tela nem sabia que existiam.

    Agora a mescla é **por chave**, a mesma regra de `registrar_integracao`:
    chave que chega com valor vazio preserva o valor guardado. É o que permite
    renomear um conector, ou trocar só uma de várias chaves, sem redigitar o
    resto. Apagar uma chave continua possível — é omiti-la da lista.
    """
    async with sessao(role="service_role") as conn:
        atual = await conn.fetchval(
            "SELECT credentials FROM public.integrations WHERE id = $1::uuid",
            conector_id,
        )
        mescladas = _mesclar_credenciais(atual, dados.credentials)
        previa, configurado = _previa(
            mescladas if mescladas is not None else atual
        )
        achado = await conn.fetchval(
            """
            UPDATE public.integrations SET
                name = $2, category = $3, key_name = $4, integration_type = $5,
                description = $6, icon = $7, type = $8,
                template_id = COALESCE(NULLIF($9,''), template_id),
                credentials   = COALESCE($10::text::jsonb, credentials),
                key_preview   = COALESCE($11, key_preview),
                is_configured = CASE WHEN $10 IS NULL THEN is_configured ELSE $12 END,
                agents_using = $13,
                -- Campo de banco vazio mantém o que está lá, mesma regra da
                -- credencial: a tela pode estar editando só o nome.
                db_host    = COALESCE(NULLIF($14,''), db_host),
                db_porta   = COALESCE($15, db_porta),
                db_base    = COALESCE(NULLIF($16,''), db_base),
                db_sslmode = $17,
                db_somente_leitura = $18,
                updated_at = now()
             WHERE id = $1::uuid
            RETURNING id
            """,
            conector_id, dados.name, dados.category, dados.key_name,
            dados.integration_type, dados.description, dados.icon, dados.type,
            dados.template_id or "",
            json.dumps(mescladas) if mescladas is not None else None,
            previa, configurado, dados.agents_using,
            dados.db_host or "", dados.db_porta, dados.db_base or "",
            dados.db_sslmode, dados.db_somente_leitura,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")


@router.delete("/conectores/{conector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_conector(
    conector_id: str, _: Usuario = Depends(exige_papel("administrador"))
):
    """Exclui o conector — e, se for banco, tira o MCP do gateway junto.

    ⚠️ **A ordem é: gateway primeiro, banco depois.** Se a limpeza do gateway
    falhar, o conector continua aqui e dá para tentar de novo; ao contrário, o
    registro sumiria e sobraria no gateway um servidor MCP com a senha nos
    `args`, sem nada no HS.OS apontando para ele. Órfão com credencial é pior
    que exclusão que não completou.
    """
    async with sessao(role="service_role") as conn:
        banco = await conn.fetchval(
            "SELECT name FROM public.integrations "
            " WHERE id = $1::uuid AND integration_type = 'database'",
            conector_id,
        )
    if banco:
        await _despublicar_banco(banco)

    async with sessao(role="service_role") as conn:
        marca = await conn.execute(
            "DELETE FROM public.integrations WHERE id = $1::uuid", conector_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")


# ─────────────────────────────────────────────────────────────────────────────
# Bancos de dados — o quarto tipo de conector
# ─────────────────────────────────────────────────────────────────────────────
#
# Banco é a ferramenta principal dos agentes, e até aqui o acesso existia
# **fora** da plataforma: variáveis de ambiente no processo do gateway
# (`DATACOREHS_PASSWORD`, `GROWTHHSAPI_DB_PASS`, `TALENTHS_PASSWORD`). Invisível
# pela tela, sem saber qual agente usa o quê, e trocar senha exigia mexer na VPS.
#
# ⚠️ **`db_somente_leitura` não protege nada sozinho.** Ele escolhe qual par de
# credenciais a conexão usa. Quem recusa um UPDATE é o usuário do Postgres do
# outro lado — e é lá que a trava tem que estar, porque essa não depende de o
# agente se comportar nem de a tela mandar o parâmetro certo.

_CHAVES_BANCO = {
    True:  ("ro_usuario", "ro_senha"),
    False: ("rw_usuario", "rw_senha"),
}


def _credencial_do_banco(credenciais, somente_leitura: bool) -> tuple[str, str]:
    """Tira o par usuário/senha do modo pedido. Levanta se não estiver lá."""
    lista = _pares_de_credencial(credenciais) or []
    por_nome = {str(c.get("key_name") or ""): str(c.get("value") or "") for c in lista}
    ku, ks = _CHAVES_BANCO[somente_leitura]
    usuario, senha = por_nome.get(ku, ""), por_nome.get(ks, "")
    if not usuario or not senha:
        modo = "leitura" if somente_leitura else "leitura e escrita"
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Este banco não tem credencial de {modo} cadastrada. "
            f"Preencha {ku} e {ks} antes de usá-lo nesse modo.",
        )
    return usuario, senha


def _url_do_banco(linha, credenciais, somente_leitura: bool) -> str:
    usuario, senha = _credencial_do_banco(credenciais, somente_leitura)
    # `quote` em usuário e senha: senha com `@` ou `/` quebra a URL em silêncio
    # e o erro que volta é "could not translate host name".
    return (
        f"postgresql://{quote(usuario, safe='')}:{quote(senha, safe='')}"
        f"@{linha['db_host']}:{linha['db_porta']}/{quote(str(linha['db_base']), safe='')}"
        f"?sslmode={linha['db_sslmode']}"
    )


@router.post("/conectores/{conector_id}/testar-banco")
async def testar_banco(
    conector_id: str,
    somente_leitura: bool = True,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Conecta de verdade e conta o que encontrou. **Nunca escreve.**

    Existe porque "cadastrei" e "funciona" são coisas diferentes, e a plataforma
    já acumulou casos em que a tela dizia a primeira achando que dizia a
    segunda. Um conector de banco que não conecta só vira erro na cara do agente
    depois — longe de quem pode consertar.

    Também confere se a credencial de leitura é **mesmo** de leitura: pergunta
    ao Postgres se aquele usuário poderia escrever. Quem responde é o banco, não
    a nossa coluna.
    """
    import asyncpg

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, db_host, db_porta, db_base, db_sslmode, credentials "
            "  FROM public.integrations WHERE id = $1::uuid AND integration_type = 'database'",
            conector_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector de banco não encontrado.")

    url = _url_do_banco(linha, linha["credentials"], somente_leitura)
    try:
        alvo = await asyncpg.connect(url, timeout=12)
    except Exception as e:
        # A mensagem do driver é a informação útil aqui (host errado, senha
        # recusada, banco inexistente) — engoli-la deixaria a tela dizendo só
        # "falhou", que é o que não ajuda ninguém.
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"Não consegui conectar: {type(e).__name__}: {e}",
        )

    try:
        usuario = await alvo.fetchval("SELECT current_user")
        versao = await alvo.fetchval("SHOW server_version")
        # `pg_read_all_data` e `default_transaction_read_only` não aparecem em
        # `role_table_grants`; perguntar direto ao banco é o que funciona nos
        # dois desenhos.
        escreve = await alvo.fetchval(
            """
            SELECT bool_or(
                     has_table_privilege(current_user, c.oid, 'INSERT') OR
                     has_table_privilege(current_user, c.oid, 'UPDATE') OR
                     has_table_privilege(current_user, c.oid, 'DELETE'))
              FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind = 'r'
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
            """
        )
        so_leitura_na_sessao = await alvo.fetchval("SHOW default_transaction_read_only")
        # ⚠️ Guardado porque `sslmode=prefer` significa coisas diferentes em
        # drivers diferentes — ver o aviso montado abaixo.
        ssl_no_servidor = await alvo.fetchval("SHOW ssl")
        tabelas = [
            dict(r) for r in await alvo.fetch(
                """
                SELECT n.nspname AS schema, count(*) AS tabelas
                  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE c.relkind = 'r'
                   AND n.nspname NOT IN ('pg_catalog', 'information_schema')
                 GROUP BY 1 ORDER BY 2 DESC
                """
            )
        ]
    finally:
        await alvo.close()

    # O aviso importa: um conector marcado como leitura cuja credencial pode
    # escrever é uma trava que não existe. Melhor dizer agora que descobrir
    # quando um agente alterar algo.
    avisos = []

    # ⚠️ **`sslmode=prefer` não quer dizer a mesma coisa em todo driver.** O
    # `libpq` (psql, asyncpg) tenta SSL e **rebaixa** para texto puro quando o
    # servidor recusa; o `node-postgres`, que é quem roda dentro do servidor
    # MCP, trata `prefer` como exigência e falha com "The server does not
    # support SSL connections".
    #
    # A consequência é traiçoeira: este teste passava e o agente falhava, porque
    # os dois falam com o mesmo banco por bibliotecas diferentes. Aconteceu em
    # 13/08/2026, no primeiro banco publicado. Testar com um driver e servir com
    # outro só vale se o teste souber da diferença.
    if str(ssl_no_servidor).lower() in ("off", "false") and linha["db_sslmode"] != "disable":
        avisos.append(
            f'Este servidor está com SSL desligado, e o conector diz '
            f'`sslmode={linha["db_sslmode"]}`. A conexão daqui funciona (o libpq '
            "rebaixa sozinho), mas a do agente **não vai**: o driver do MCP trata "
            "qualquer coisa diferente de `disable` como exigência de SSL. "
            "Mude para `disable`."
        )

    if somente_leitura and escreve and so_leitura_na_sessao != "on":
        avisos.append(
            f'O usuário "{usuario}" **pode escrever** neste banco, apesar de o '
            "conector estar marcado como só-leitura. Crie um usuário de leitura "
            "(GRANT pg_read_all_data + ALTER ROLE … SET default_transaction_read_only = on) "
            "— a marcação aqui não impede escrita, só escolhe a credencial."
        )

    logger.info("Teste de banco %s: OK como %s", linha["name"], usuario)
    return {
        "ok": True, "usuario": usuario, "versao": versao,
        "somente_leitura_na_sessao": so_leitura_na_sessao == "on",
        "pode_escrever": bool(escreve),
        "schemas": tabelas,
        "avisos": avisos,
    }


# O servidor MCP que transforma o banco em ferramenta do agente.
#
# Escolhido depois de rodar os dois candidatos contra o DataCore real em
# 13/08/2026. Este expõe **uma** tool, `query`, e embrulha tudo em transação
# `READ ONLY` — mandar `CREATE TABLE` volta com "cannot execute CREATE TABLE in
# a read-only transaction". Somado ao usuário de leitura do Postgres, são duas
# recusas independentes.
_MCP_PACOTE_LEITURA = "@modelcontextprotocol/server-postgres"

# ⚠️ **Este servidor recebe a URL por argv, e argv é visível em `ps`.** Não é
# hipotético: qualquer processo do mesmo usuário na VPS enxerga a senha. Hoje
# só o root roda lá, então o risco é contido — mas é dívida registrada, e o
# conserto é um servidor MCP nosso que leia a URL do ambiente. Quando existir
# escrita, essa dívida deixa de ser aceitável.


def _nome_mcp(nome: str) -> str:
    """Apelido curto e estável para o servidor no `mcp.servers`.

    ⚠️ Acento vira a letra sem acento, não hífen. A primeira versão jogava fora
    tudo que não fosse `[a-z0-9]`, e "Diretório HS.OS" virava
    `banco-diret-rio-hs-os` — ilegível, e o nome aparece na ferramenta que o
    agente vê (`mcp__<apelido>__query`). Com departamentos como LABORATÓRIO e
    EXPEDIÇÃO isso se repetiria sempre.
    """
    sem_acento = unicodedata.normalize("NFKD", nome).encode("ascii", "ignore").decode()
    base = re.sub(r"[^a-z0-9]+", "-", sem_acento.strip().lower()).strip("-")
    return f"banco-{base or 'sem-nome'}"


# Denies que não vêm de MCP e precisam sobreviver ao recálculo.
#
# ⚠️ **Esquecer um nome aqui o apaga na próxima publicação de conector**, sem
# erro e sem aviso: o `deny` é reescrito do zero, e o que não estiver nesta
# tupla some. Vale para toda trava que não seja de servidor MCP.
#
# - `sessions_send`/`sessions_spawn`: só a orquestradora aciona outro agente.
# - `skill_workshop`: criar, editar e instalar skill é do Erick ou da `nina`.
#   Um especialista que possa escrever a própria skill pode reescrever a régua
#   que o governa — e a `faturamento` é exatamente uma régua dessas.
_DENY_NAO_MCP = ("sessions_send", "sessions_spawn", "skill_workshop")


def _sem_prefixo(nome: str) -> str:
    return nome[len("mcp__"):] if nome.startswith("mcp__") else nome


def _deny_de_mcp(also_allow: list[str], deny_atual: list[str],
                 servidores: dict) -> list[str]:
    """As ferramentas MCP que este agente NÃO deve ter.

    ⚠️ **O `deny` casa pelo nome que o agente vê, que é SEM o prefixo `mcp__`.**
    O `alsoAllow` usa o nome com prefixo; os dois convivem no mesmo objeto e
    aceitam formatos diferentes. Aplicar o deny com prefixo grava na config,
    passa em qualquer conferência que releia a config — e não remove nada. Foi o
    que aconteceu na primeira tentativa, em 14/08/2026: a `iris` seguiu
    enxergando os dez bancos com o deny "aplicado". Quem desfez o engano foi
    perguntar a ela, não reler o `config.get`.
    """
    # ⚠️ **O alerta é infraestrutura, não conector por agente — nunca é negado.**
    #
    # Este cálculo é "tudo que existe menos o que é meu", e roda a cada
    # publicação. Se naquele instante o agente ainda não tiver o alerta no
    # `alsoAllow`, ele entra na lista de negados — e depois, mesmo concedido,
    # continua bloqueado, porque `deny` ganha de `alsoAllow`.
    #
    # Foi o que aconteceu com o `flow` em 17/08/2026: alerta concedido, alerta
    # negado, e o agente respondendo "NÃO" quando perguntado se o tinha. O
    # `SOUL.md` de todo agente manda avisar o administrador; deixar essa
    # ferramenta depender da ordem das operações é frágil demais para uma regra
    # de segurança.
    todas = {
        f"{s}__{t}"
        for s, cfg in servidores.items()
        if "alerta" not in s
        for t in ((((cfg or {}).get("toolFilter") or {}).get("include")) or ["query"])
    }
    meus = {_sem_prefixo(x) for x in also_allow}
    preservados = [x for x in deny_atual if x in _DENY_NAO_MCP]
    return sorted(todas - meus) + preservados


@router.post("/conectores/{conector_id}/publicar-banco")
async def publicar_banco(
    conector_id: str,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Declara o banco como ferramenta no gateway, e libera para os agentes.

    Banco é **ação**, não procedimento — por isso vira tool, e não skill. O
    agente não precisa reaprender a consultar a cada vez; precisa poder
    executar. (Skill continua sendo o certo para procedimento com julgamento
    nosso dentro, como criar um agente.)

    Duas escritas no mesmo `config.patch`:

    - `mcp.servers.<apelido>` — o servidor, com a URL de conexão
    - `agents.list[].tools.alsoAllow` — quem pode usar

    ⚠️ **`mcp.servers` é global, e declarar o servidor JÁ DÁ ACESSO A TODOS.**
    Este comentário afirmava o contrário até 14/08/2026, e a afirmação era falsa:
    `alsoAllow` é *aditivo* sobre a política global, e o perfil `coding` libera
    todo servidor MCP para todo agente. Quem publicava um banco para a `iris`
    entregava-o também à `nina` e ao `atlas` — a tela dizia que não, e ninguém
    conferiu com o agente. Descoberto perguntando à `nina` quais ferramentas ela
    via: os nove bancos da empresa, tendo três publicados.

    Quem exclui é o `deny`, e por isso ele é recalculado aqui a cada publicação:
    `deny = (todas as ferramentas de mcp.servers) − (as do alsoAllow do agente)`.
    Sem esse recálculo, publicar um banco novo o entrega a quem não deveria tê-lo.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, db_host, db_porta, db_base, db_sslmode, db_somente_leitura, "
            "       credentials, agents_using "
            "  FROM public.integrations "
            " WHERE id = $1::uuid AND integration_type = 'database'",
            conector_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector de banco não encontrado.")

    if not linha["db_somente_leitura"]:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            f'O banco "{linha["name"]}" está marcado como leitura e escrita, e o '
            "servidor MCP que usamos hoje só executa consulta — ele embrulha tudo "
            "em transação READ ONLY. Publicar assim entregaria uma ferramenta que "
            "recusa metade do que a tela promete. Escrita precisa de um servidor "
            "próprio, e ainda não existe.",
        )

    # ⚠️ Conferir o SSL **antes** de publicar, e não depois. O driver de dentro
    # do MCP (node-postgres) trata `sslmode` diferente do libpq: só `disable`
    # dispensa SSL de verdade. Publicar sem isso entrega uma ferramenta que
    # falha na primeira consulta, longe de quem pode consertar — foi o que
    # aconteceu no primeiro banco publicado, em 13/08/2026.
    if linha["db_sslmode"] != "disable":
        import asyncpg
        try:
            alvo = await asyncpg.connect(
                _url_do_banco(linha, linha["credentials"], True), timeout=12
            )
        except Exception as e:
            raise HTTPException(
                status.HTTP_502_BAD_GATEWAY,
                f"Não consegui conectar para conferir antes de publicar: {e}",
            )
        try:
            ssl_ligado = str(await alvo.fetchval("SHOW ssl")).lower() not in ("off", "false")
        finally:
            await alvo.close()
        if not ssl_ligado:
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f'Este servidor está com SSL desligado, mas o conector diz '
                f'`sslmode={linha["db_sslmode"]}`. A conexão de teste funciona '
                "porque o libpq rebaixa sozinho; a do agente falharia com "
                '"The server does not support SSL connections", porque o driver '
                "do MCP não rebaixa. Mude o conector para `disable` e publique "
                "de novo.",
            )

    url = _url_do_banco(linha, linha["credentials"], somente_leitura=True)
    apelido = _nome_mcp(linha["name"])
    agentes = list(linha["agents_using"] or [])

    parsed, base_hash = await patch_gw.config_do_gateway()

    servidor = {
        "command": "npx",
        "args": ["-y", _MCP_PACOTE_LEITURA, url],
        # Só `query` sai deste servidor. É o que ele tem hoje, mas fixar a lista
        # significa que uma versão futura com tool de escrita não passa a valer
        # sozinha num `npx -y`, que sempre pega a última.
        "toolFilter": {"include": ["query"]},
    }

    # O nome da tool que o agente vê. Sem isto no `alsoAllow`, o servidor existe
    # e nenhum agente o alcança.
    ferramenta = f"mcp__{apelido}__query"

    # ⚠️ **Publicar CONCEDE e REVOGA.** Acrescentar acesso a quem entrou na lista
    # sem tirar de quem saiu deixaria a tela dizendo uma coisa e o gateway
    # fazendo outra — e é a permissão que fica sobrando, não faltando. Aconteceu
    # em 13/08/2026: um banco ficou sem agente na tela e a Nina continuou com a
    # ferramenta dele.
    antes = (parsed.get("agents") or {}).get("list") or []
    servidores_depois = {**(((parsed.get("mcp") or {}).get("servers")) or {}),
                         apelido: servidor}

    lista_agentes = []
    for a in antes:
        t = dict(a.get("tools") or {})
        atuais = list(t.get("alsoAllow") or [])
        if a.get("id") in agentes:
            if ferramenta not in atuais:
                atuais.append(ferramenta)
        else:
            atuais = [x for x in atuais if x != ferramenta]
        t["alsoAllow"] = atuais
        t["deny"] = _deny_de_mcp(atuais, t.get("deny") or [], servidores_depois)
        lista_agentes.append({**a, "tools": t})

    ausentes = [a for a in agentes if a not in {x.get("id") for x in antes}]

    patch: dict = {"mcp": {"servers": {apelido: servidor}}}
    if lista_agentes != antes:
        # ⚠️ `agents.list` é ARRAY, e array SUBSTITUI no merge patch. Mandar só os
        # agentes alterados apagaria os demais. Por isso a lista vai inteira, com
        # os não-alterados preservados como estão.
        patch["agents"] = {"list": lista_agentes}

    # ⚠️ **Conferir a concessão, não só o servidor.** A versão anterior olhava
    # apenas se `mcp.servers.<apelido>` existia — e ele já existia de uma
    # publicação anterior para outro agente. O patch podia falhar em conceder a
    # ferramenta e mesmo assim ser dado como bem-sucedido. Foi assim que o
    # `atlas` "ganhou" dois conectores que nunca chegaram nele.
    #
    # ⚠️ E conferir **os dois lados**: a concessão e a exclusão. Conferir só o
    # `alsoAllow` deixaria passar exatamente o buraco que este recálculo existe
    # para fechar — o agente ganha a ferramenta certa e continua com as oito
    # erradas.
    esperado_deny = {a["id"]: set((a.get("tools") or {}).get("deny") or [])
                     for a in lista_agentes}

    def _conferir(c: dict) -> bool:
        if apelido not in (((c.get("mcp") or {}).get("servers")) or {}):
            return False
        vivos = {a.get("id"): (a.get("tools") or {})
                 for a in ((c.get("agents") or {}).get("list") or [])}
        tem = {i for i, t in vivos.items() if ferramenta in (t.get("alsoAllow") or [])}
        if not all(x in tem for x in agentes if x in vivos):
            return False
        return all(set(vivos[i].get("deny") or []) == d
                   for i, d in esperado_deny.items() if i in vivos)

    await patch_gw.aplicar_patch(patch, base_hash, conferir=_conferir)

    logger.info("Banco %s publicado como %s para %s", linha["name"], apelido, agentes)
    return {
        "ok": True, "servidor": apelido, "ferramenta": ferramenta,
        "agentes": [a for a in agentes if a not in ausentes],
        "agentes_inexistentes": ausentes,
        "somente_leitura": True,
    }


async def _despublicar_banco(nome: str) -> bool:
    """Tira o servidor MCP do gateway e a ferramenta dos agentes.

    ⚠️ Chamado ao **excluir** um conector de banco, e isso não é higiene: o
    servidor guarda a URL de conexão — com senha — nos `args`. Um conector
    apagado no HS.OS cujo MCP continua no gateway vira credencial esquecida numa
    config que ninguém mais olha, apontando para um banco que a plataforma
    deixou de gerenciar.

    Devolve `False` quando não havia o que remover. Nunca levanta: a exclusão do
    conector não pode ficar refém do gateway estar de pé — mas o que não deu
    para limpar vai para o log, nomeado.
    """
    apelido = _nome_mcp(nome)
    ferramenta = f"mcp__{apelido}__query"
    try:
        parsed, base_hash = await patch_gw.config_do_gateway()
    except HTTPException as e:
        logger.error("Gateway fora do ar: o MCP %s continua lá. (%s)", apelido, e.detail)
        return False

    if apelido not in ((parsed.get("mcp") or {}).get("servers") or {}):
        return False

    patch: dict = {"mcp": {"servers": {apelido: None}}}

    # `agents.list` é array: vai inteira, com a ferramenta tirada de quem a
    # tinha. Mandar só os alterados apagaria os demais agentes.
    #
    # O `deny` é recalculado junto: o servidor deixou de existir, e deixar o nome
    # dele nas listas de recusa acumula entrada morta a cada conector excluído.
    lista = (parsed.get("agents") or {}).get("list") or []
    restantes = {k: v for k, v in (((parsed.get("mcp") or {}).get("servers")) or {}).items()
                 if k != apelido}
    novos = []
    for a in lista:
        t = dict(a.get("tools") or {})
        atuais = [x for x in (t.get("alsoAllow") or []) if x != ferramenta]
        t["alsoAllow"] = atuais
        t["deny"] = _deny_de_mcp(atuais, t.get("deny") or [], restantes)
        novos.append({**a, "tools": t})
    if novos != lista:
        patch["agents"] = {"list": novos}

    try:
        await patch_gw.aplicar_patch(
            patch, base_hash,
            conferir=lambda c: apelido not in (((c.get("mcp") or {}).get("servers")) or {}),
        )
    except HTTPException as e:
        logger.error("Não removi o MCP %s do gateway: %s", apelido, e.detail)
        return False

    logger.info("MCP %s removido do gateway.", apelido)
    return True


@router.get("/bancos-do-agente/{agent_id}")
async def bancos_do_agente(
    agent_id: str,
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """Os bancos que este agente pode consultar, com a URL de conexão pronta.

    ⚠️ **Devolve senha em claro**, como o `/agent-credentials` — é o ponto do
    endpoint. Por isso está atrás do segredo compartilhado e nunca é exposto ao
    navegador.

    O modo vem do cadastro (`db_somente_leitura`), e o agente não escolhe: pedir
    escrita não é uma opção que ele tenha, porque a URL entregue já carrega o
    usuário do modo configurado.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT name, description, db_host, db_porta, db_base, db_sslmode, "
            "       db_somente_leitura, credentials "
            "  FROM public.integrations "
            " WHERE integration_type = 'database' AND is_configured = true "
            "   AND $1 = ANY(agents_using) ORDER BY name",
            agent_id,
        )

    bancos = []
    for linha in linhas:
        try:
            url = _url_do_banco(linha, linha["credentials"], linha["db_somente_leitura"])
        except HTTPException:
            # Banco cadastrado sem a credencial do modo dele: some da lista em
            # vez de derrubar as outras. O teste da tela é onde isso aparece.
            logger.warning("Banco %s sem credencial do modo configurado.", linha["name"])
            continue
        bancos.append({
            "nome": linha["name"],
            "descricao": linha["description"],
            "host": linha["db_host"], "porta": linha["db_porta"],
            "base": linha["db_base"],
            "somente_leitura": linha["db_somente_leitura"],
            "url": url,
        })

    logger.info("Bancos entregues a %s: %d", agent_id, len(bancos))
    return {"bancos": bancos}


@router.get("/modelos-de-conector")
async def modelos_de_conector(usuario: Usuario = Depends(usuario_atual)):
    """Os `integration_templates`, com os playbooks que os artefatos consultam."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT id::text AS id, integration_type, label, playbook "
            "  FROM public.integration_templates ORDER BY label"
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


