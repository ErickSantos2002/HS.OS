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

import httpx
from datetime import UTC, datetime, timedelta
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
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
async def revelar_token_guardrails(_: Usuario = Depends(exige_papel("super_admin"))):
    """Mostra o token que a VPS usa para escrever guardrails. Só `super_admin`.

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
    logger.info("Token de guardrails revelado para um super_admin")
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
    usuario: Usuario = Depends(exige_papel("super_admin")),
):
    """Mostra um segredo de integração ao administrador.

    Existe para o admin cadastrar o mesmo valor do lado da VPS. **Lê da mesma
    fonte que a autenticação usa** — banco primeiro, ambiente depois. Se lesse
    só do ambiente, mostraria um valor diferente do que de fato autentica
    quando o segredo vier do banco, e alguém cadastraria o token errado na VPS.

    Só `super_admin`, e o valor não vai para log.
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
    _: Usuario = Depends(exige_papel("super_admin")),
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
    usuario: Usuario = Depends(exige_papel("super_admin")),
):
    """Mostra ao admin as credenciais que o **ambiente** tem para este conector.

    ⚠️ Devolve valor em claro, e por isso é `super_admin`. Existe para o admin
    conferir o que de fato está configurado no servidor — a tela normal mostra
    só `key_preview`.

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


@router.post("/onboarding-empresa", status_code=status.HTTP_202_ACCEPTED)
async def onboarding_empresa(usuario: Usuario = Depends(exige_papel("super_admin"))):
    """Manda o orquestrador escrever o `COMPANY.md` no workspace de cada agente.

    O arquivo é injetado no contexto de todo agente, e é o que faz o time saber
    para qual empresa trabalha. Sem ele, cada agente responde no vácuo.

    Marca `onboarding_notified_at` ao fim — é o que a tela usa para saber se o
    time já foi apresentado à empresa.
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

    mensagem = (
        "Você precisa atualizar o contexto de todos os agentes do time com as "
        "informações da empresa cliente.\n"
        "Siga estes passos:\n"
        "1. Leia o arquivo de configuração do OpenClaw em ~/.openclaw/openclaw.json "
        "para obter a lista de agentes e seus workspaces\n"
        "2. Para cada agente listado em agents.list, escreva ou sobrescreva o arquivo "
        "COMPANY.md no workspace desse agente com o conteúdo abaixo\n"
        "3. Confirme quando todos os arquivos tiverem sido escritos\n\n"
        "Conteúdo do COMPANY.md a ser escrito em cada workspace:\n---\n"
        f"{company_md}\n---\n\n"
        "Este arquivo será injetado automaticamente no contexto de cada agente e "
        "permitirá que eles conheçam a empresa para qual trabalham."
    )

    from app.routers.agents import _avisar_lider

    await _avisar_lider("onboarding-empresa", mensagem)
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE public.company_profile SET onboarding_notified_at = now() WHERE id = $1",
            p["id"],
        )
    logger.info("Onboarding da empresa disparado por %s", usuario.id)
    return {"dispatched": True}


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
    _: Usuario = Depends(exige_papel("super_admin")),
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
# no servidor. A tela nunca precisou dele — só de saber se está configurado e de
# mostrar a ponta da chave para a pessoa reconhecer qual é.

_COLUNAS_CONECTOR = """
    id::text AS id, name, category, key_name, key_preview, is_configured,
    description, icon, integration_type, type, template_id::text AS template_id,
    agents_using, added_by_agent, last_validation_ok, last_validation_error,
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


def _previa(credenciais) -> tuple[str | None, bool]:
    """A ponta da chave, para a pessoa reconhecer qual é sem ver o resto."""
    valor = _token_da_integracao(credenciais, None)
    if not valor:
        return None, False
    return (f"…{valor[-4:]}" if len(valor) > 4 else "…"), True


@router.post("/conectores", status_code=status.HTTP_201_CREATED)
async def criar_conector(
    dados: ConectorIn, _: Usuario = Depends(exige_papel("super_admin"))
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
                 agents_using)
            VALUES ($1,$2,$3,$4,$5,$6,$7, NULLIF($8,''),
                    $9::text::jsonb, $10, $11, $12)
            RETURNING id::text
            """,
            dados.name, dados.category, dados.key_name, dados.integration_type,
            dados.description, dados.icon, dados.type, dados.template_id or "",
            json.dumps(dados.credentials) if dados.credentials is not None else None,
            previa, configurado, dados.agents_using,
        )
    logger.info("Conector %s criado.", dados.name)
    return {"id": ident}


@router.patch("/conectores/{conector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def editar_conector(
    conector_id: str,
    dados: ConectorIn,
    _: Usuario = Depends(exige_papel("super_admin")),
):
    """Edita o conector. **Credencial ausente mantém a que está lá.**

    Não é descuido: a tela não recebe a credencial de volta na listagem, então
    ela não tem como reenviá-la ao editar só o nome. Tratar ausente como "apagar"
    faria renomear um conector desconectá-lo.
    """
    previa, configurado = _previa(dados.credentials)
    async with sessao(role="service_role") as conn:
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
                updated_at = now()
             WHERE id = $1::uuid
            RETURNING id
            """,
            conector_id, dados.name, dados.category, dados.key_name,
            dados.integration_type, dados.description, dados.icon, dados.type,
            dados.template_id or "",
            json.dumps(dados.credentials) if dados.credentials is not None else None,
            previa, configurado, dados.agents_using,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")


@router.delete("/conectores/{conector_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_conector(
    conector_id: str, _: Usuario = Depends(exige_papel("super_admin"))
):
    async with sessao(role="service_role") as conn:
        marca = await conn.execute(
            "DELETE FROM public.integrations WHERE id = $1::uuid", conector_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")


@router.get("/modelos-de-conector")
async def modelos_de_conector(usuario: Usuario = Depends(usuario_atual)):
    """Os `integration_templates`, com os playbooks que os artefatos consultam."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT id::text AS id, integration_type, label, playbook "
            "  FROM public.integration_templates ORDER BY label"
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


# Sufixos convencionais de variável de ambiente. A edge tentava esta lista
# porque não há registro de qual variável pertence a qual conector — a
# convenção `{TEMPLATE}_{CAMPO}` é o que existe de acordo.
_SUFIXOS_CONVENCIONAIS = (
    "API_KEY", "ACCESS_TOKEN", "CLIENT_ID", "CLIENT_SECRET", "REFRESH_TOKEN",
    "SECRET_KEY", "WEBHOOK_SECRET", "BOT_TOKEN", "ACCOUNT_SID", "AUTH_TOKEN",
    "PHONE_NUMBER_ID", "PAGE_ID", "AD_ACCOUNT_ID", "APP_ID", "BASE_URL", "TOKEN",
)


@router.get("/conectores/{conector_id}/credenciais")
async def revelar_credenciais(
    conector_id: str, _: Usuario = Depends(exige_papel("super_admin"))
):
    """Mostra as credenciais guardadas em variável de ambiente. Só `super_admin`.

    ⚠️ **Este é o único ponto do sistema que devolve credencial ao navegador**, e
    existe por um motivo estreito: o formulário de editar conector precisa
    preencher os campos que já estão configurados, senão salvar uma alteração de
    nome apagaria a chave por vir com o campo vazio.

    Só lê **variáveis de ambiente do backend**, nunca o `credentials` do banco.
    A diferença importa: o que está no banco a tela já sabe que existe (pelo
    `is_configured`), e o que está no ambiente é o que ela não tem como
    adivinhar.

    A busca é por convenção porque não há registro de qual variável pertence a
    qual conector: tenta o `key_name` de cada credencial, o `key_name` da linha,
    e `{TEMPLATE}_{CAMPO}` para os sufixos usuais.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, key_name, credentials, template_id "
            "  FROM public.integrations WHERE id = $1::uuid",
            conector_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")

    nomes: list[str] = []
    credenciais = linha["credentials"]
    if isinstance(credenciais, str):
        try:
            credenciais = json.loads(credenciais)
        except ValueError:
            credenciais = None
    if isinstance(credenciais, list):
        nomes += [
            str(c.get("key_name") or c.get("key") or "").strip()
            for c in credenciais
            if isinstance(c, dict)
        ]
    if linha["key_name"]:
        nomes.append(str(linha["key_name"]))
    if linha["template_id"]:
        prefixo = re.sub(r"[^A-Z0-9]+", "_", str(linha["template_id"]).upper())
        nomes += [f"{prefixo}_{s}" for s in _SUFIXOS_CONVENCIONAIS]

    achadas = {n: os.environ[n] for n in nomes if n and os.environ.get(n)}
    logger.info(
        "Credenciais do conector %s reveladas: %d variáveis.", linha["name"], len(achadas)
    )
    return {"success": True, "credentials": achadas}
