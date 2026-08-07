"""Provedores de LLM no cofre do gateway — portado de `configure-llm-provider`.

O gateway guarda as chaves de LLM na própria config (`models.providers`). A área
de Conectores só gravava a chave no banco e **nunca a levava ao gateway**, então
"configurar a LLM nos Conectores" não fazia a plataforma funcionar. Este módulo
fecha essa ponte.

⚠️ **Escrita de provedor NOVO vai por fila, e isso não é preferência.** Foi
bisseccionado contra o gateway real em 01/08/2026: adicionar provedor por
`config.patch` **escreve, o reload crasha e o gateway reverte com 503** — vale
para `openai` e `anthropic` igualmente. Editar provedor **existente** funciona.
Por isso provedor novo entra em `llm_provider_ops` e quem instala é o
sincronizador da VPS, que grava o arquivo e reinicia o gateway — o caminho
pré-boot do `setup.sh`, que comprovadamente funciona.

Não teste isso mexendo num provedor novo em produção: derruba o gateway.

Contrato do `config.patch`, confirmado com o corpo exato de uma chamada real:
  - `raw` é **string**, não objeto (objeto é recusado com "at /raw: must be string")
  - `baseHash` é **obrigatório** — lock otimista. O campo chama `baseHash`;
    mandar `hash` é rejeitado, e isso fez tentativas anteriores falharem sem
    ninguém entender
  - a semântica é JSON Merge Patch (RFC 7386): objeto faz merge profundo, array
    **substitui**, `null` **deleta**. Mandar só `models.providers.<x>` preserva
    crons, agentes e os demais provedores

A diferença em relação à edge: ela falava com o gateway por `POST /api/v1/admin/rpc`,
que é 404 hoje. `config.get` e `config.patch` existem no WebSocket e é por lá que
vamos — mesmos métodos, mesmo contrato.
"""

import json
import logging
import re

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, exige_papel
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente
from app.integracoes import exige_segredo

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/llm", tags=["llm"])

# Allowlist de `template_id` → chave do provedor no `openclaw.json`.
# É correção **e** segurança: sem ela, um template_id arbitrário viraria caminho
# arbitrário no `config.patch` (`/models/providers/<x>/apiKey`) — injeção de path
# na config do gateway.
_PROVEDORES = {"deepseek": "deepseek", "openai": "openai",
               "anthropic": "anthropic", "gemini": "gemini"}

# Pistas por nome, para conector sem `template_id` — que é o caso dos criados
# pelo fluxo "Personalizado". Sem isto, a função rejeitaria justamente os
# conectores que existem de verdade. O resultado continua restrito ao
# `_PROVEDORES`: nome livre nunca vira caminho.
_PISTAS = [("deepseek", "deepseek"), ("anthropic", "anthropic"), ("claude", "anthropic"),
           ("openai", "openai"), ("chatgpt", "openai"), ("gpt", "openai"),
           ("gemini", "gemini")]

# `baseUrl` é **obrigatório** no schema de `models.providers`. Sem ele o gateway
# até boota tolerando o nó, mas todo `config.patch` passa a falhar na validação
# ("baseUrl: Too small") e as chamadas dão 404. Medido em 01/08: `openai` sem
# `/v1` bate em `api.openai.com/responses` e 404; com `/v1`, responde.
_PADROES = {
    "openai": {"api": "openai-completions", "baseUrl": "https://api.openai.com/v1", "auth": "api-key"},
    "deepseek": {"api": "openai-completions", "baseUrl": "https://api.deepseek.com", "auth": "api-key"},
    "anthropic": {"api": "anthropic-messages", "baseUrl": "https://api.anthropic.com/v1", "auth": "api-key"},
    "gemini": {"api": "google-generative-ai", "baseUrl": "https://generativelanguage.googleapis.com/v1beta", "auth": "api-key"},
}

# O gateway devolve a chave mascarada com esta sentinela ao ler a config.
# Reenviá-la gravaria a máscara por cima da chave real.
_SENTINELA = "__OPENCLAW_REDACTED__"

_ID_CUSTOM = re.compile(r"^[a-z0-9][a-z0-9-]{1,23}$")

# Modelos que não são de chat só poluem a lista. Filtro heurístico — o usuário
# vê o que sobrou, então um falso negativo é recuperável digitando o id.
_NAO_CHAT = re.compile(
    r"embed|whisper|tts|audio|dall-e|image|moderation|vision-preview|realtime"
    r"|transcribe|search|similarity|edit-|-if-|guard", re.I
)


def _resolver_provedor(template_id: str | None, nome: str | None) -> str | None:
    porta = _PROVEDORES.get(str(template_id or "").strip().lower())
    if porta:
        return porta
    chave = str(nome or "").strip().lower()
    for pista, provedor in _PISTAS:
        if pista in chave:
            return provedor
    return None


def _sem_sentinela(no: dict) -> dict:
    return {k: v for k, v in no.items() if v != _SENTINELA}


async def _config_do_gateway() -> tuple[dict, str]:
    """Lê a config e devolve `(parsed, hash)`.

    O `hash` é o lock otimista do `config.patch`. Sem ele não se escreve —
    gravar sem lock arrisca sobrescrever mudança que entrou no meio.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        r = await obter_cliente(c.url, c.token).chamar("config.get", {})
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"config.get falhou: {e}")

    payload = r.get("payload") if isinstance(r.get("payload"), dict) else r
    parsed = payload.get("parsed") or payload.get("sourceConfig") or {}
    base_hash = payload.get("hash")
    if not isinstance(base_hash, str) or not base_hash:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            "Hash da config indisponível — abortado por segurança.",
        )
    return parsed, base_hash


def _provedores(parsed: dict) -> dict:
    return ((parsed.get("models") or {}).get("providers") or {})


# ─────────────────────────────────────────────────────────────────────────────
# Listagem
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/provedores")
async def listar(_: Usuario = Depends(exige_papel("super_admin"))):
    """Estado dos provedores no gateway, mais a fila de operações pendentes.

    Quando o gateway não responde, devolve `indisponivel` com as operações da
    fila em vez de erro: instalar provedor **reinicia o gateway**, e é
    justamente nesse minuto que o usuário abre a tela para ver se deu certo.
    Um erro seco aqui pareceria que a instalação falhou.
    """
    async def fila(conn):
        return [
            dict(l)
            for l in await conn.fetch(
                "SELECT id::text AS id, op, provider_id, status, error, "
                "to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') || 'Z' AS created_at "
                "FROM public.llm_provider_ops WHERE op <> 'discover_models' "
                "ORDER BY created_at DESC LIMIT 10"
            )
        ]

    try:
        parsed, _hash = await _config_do_gateway()
    except HTTPException as e:
        async with sessao(role="service_role") as conn:
            ops = await fila(conn)
        return {
            "indisponivel": True,
            "motivo": "O gateway pode estar reiniciando — acontece ao instalar um "
                      f"provedor e volta em segundos. ({e.detail})",
            "provedores": {}, "catalogo": [], "agentes": [], "padrao": None, "ops": ops,
        }

    provs = _provedores(parsed)
    agentes_cfg = (parsed.get("agents") or {})
    padroes = (agentes_cfg.get("defaults") or {})

    async with sessao(role="service_role") as conn:
        ops = await fila(conn)

    return {
        "provedores": {
            ident: {
                "api": no.get("api"),
                "baseUrl": no.get("baseUrl"),
                "auth": no.get("auth"),
                # Nunca o valor: só se existe. A chave não sai daqui.
                "temChave": bool(no.get("apiKey")),
                "modelos": [
                    {"id": m.get("id"), "name": m.get("name") or m.get("id"),
                     "contextWindow": m.get("contextWindow"), "cost": m.get("cost")}
                    for m in (no.get("models") or [])
                ],
            }
            for ident, no in provs.items()
        },
        "catalogo": list((padroes.get("models") or {}).keys()),
        "agentes": [{"id": a.get("id"), "model": a.get("model")}
                    for a in (agentes_cfg.get("list") or [])],
        "padrao": padroes.get("model"),
        "ops": ops,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Descoberta de modelos
# ─────────────────────────────────────────────────────────────────────────────


class DescobertaIn(BaseModel):
    provider_type: str = Field(min_length=1)
    api_key: str = ""
    base_url: str | None = None
    provider_id: str | None = None


async def _descobrir(tipo: str, chave: str, base_url: str | None) -> dict:
    """Pergunta à API do provedor quais modelos a chave enxerga.

    Sem lista fixa no código: modelo novo aparece sozinho quando o provedor o
    publica.
    """
    padrao = _PADROES.get(tipo, {})
    raiz = (base_url or padrao.get("baseUrl") or "").rstrip("/")
    if not raiz:
        return {"ok": False, "error": f"Não sei o endereço da API de '{tipo}'."}

    if tipo == "anthropic":
        url, cabecalhos = f"{raiz}/models", {"x-api-key": chave, "anthropic-version": "2023-06-01"}
    elif tipo == "gemini":
        url, cabecalhos = f"{raiz}/models?key={chave}", {}
    else:
        url, cabecalhos = f"{raiz}/models", {"Authorization": f"Bearer {chave}"}

    try:
        async with httpx.AsyncClient(timeout=15) as http:
            r = await http.get(url, headers=cabecalhos)
    except httpx.HTTPError as e:
        return {"ok": False, "error": f"Não foi possível falar com o provedor: {e}"}

    if not r.is_success:
        return {"ok": False, "error": f"O provedor recusou a chave (HTTP {r.status_code})."}

    try:
        corpo = r.json()
    except ValueError:
        return {"ok": False, "error": "O provedor respondeu algo que não é JSON."}

    brutos = corpo.get("data") or corpo.get("models") or []
    modelos = []
    for m in brutos:
        ident = str(m.get("id") or m.get("name") or "").split("/")[-1]
        if ident and not _NAO_CHAT.search(ident):
            modelos.append({"id": ident, "name": m.get("display_name") or m.get("name") or ident})
    return {"ok": True, "models": modelos}


@router.post("/descobrir")
async def descobrir(dados: DescobertaIn, _: Usuario = Depends(exige_papel("super_admin"))):
    """Lista os modelos que uma chave enxerga.

    Com `api_key` no corpo, pergunta na hora. **Sem** ela, enfileira: a chave já
    está no cofre do gateway e quem a tem é o sincronizador da VPS — o navegador
    não deve recebê-la de volta só para poder perguntar.
    """
    tipo = dados.provider_type.strip().lower()
    if dados.api_key.strip():
        r = await _descobrir(tipo, dados.api_key.strip(), dados.base_url)
        # Erro de negócio devolve 200 com `ok: false`: chave errada é resposta
        # esperada, não falha de servidor.
        return r

    ident = (dados.provider_id or "").strip().lower() if tipo == "custom" else _PROVEDORES.get(tipo)
    if not ident:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provedor inválido.")

    async with sessao(role="service_role") as conn:
        existente = await conn.fetchval(
            "SELECT id::text FROM public.llm_provider_ops "
            "WHERE op = 'discover_models' AND provider_id = $1 AND status = 'pending' LIMIT 1",
            ident,
        )
        if existente:
            # Já há um pedido igual na fila: devolver o mesmo id evita empilhar
            # trabalho para o sincronizador a cada clique.
            return {"ok": True, "queued": True, "op_id": existente}
        novo = await conn.fetchval(
            "INSERT INTO public.llm_provider_ops (op, provider_id) "
            "VALUES ('discover_models', $1) RETURNING id::text",
            ident,
        )
    return {"ok": True, "queued": True, "op_id": novo}


@router.get("/descobrir/{op_id}")
async def descoberta_status(op_id: str, _: Usuario = Depends(exige_papel("super_admin"))):
    """Resultado de uma descoberta enfileirada. Consome a linha ao entregar."""
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT status, error, result FROM public.llm_provider_ops WHERE id = $1::uuid",
            op_id,
        )
        if linha is None:
            return {"done": True, "error": "Operação não encontrada (já consumida?)."}
        if linha["status"] == "pending":
            return {"done": False}
        await conn.execute("DELETE FROM public.llm_provider_ops WHERE id = $1::uuid", op_id)

    if linha["status"] == "error":
        return {"done": True, "error": linha["error"] or "Falha na descoberta."}
    resultado = linha["result"] or "{}"
    dados = json.loads(resultado) if isinstance(resultado, str) else resultado
    return {"done": True, "models": dados.get("models", [])}


# ─────────────────────────────────────────────────────────────────────────────
# Salvar e remover provedor
# ─────────────────────────────────────────────────────────────────────────────


class ModeloIn(BaseModel):
    id: str
    name: str | None = None
    contextWindow: int | None = None


class SalvarIn(BaseModel):
    provider_type: str = Field(min_length=1)
    provider_id: str | None = None
    api_key: str = ""
    base_url: str | None = None
    models: list[ModeloIn] = []
    integration_id: str | None = None


def _identificador(tipo: str, provider_id: str | None) -> str:
    if tipo == "custom":
        ident = (provider_id or "").strip().lower()
        if not _ID_CUSTOM.match(ident):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "provider_id inválido.")
        if ident in _PROVEDORES:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "provider_id de personalizado não pode colidir com provedor conhecido.",
            )
        return ident
    ident = _PROVEDORES.get(tipo)
    if not ident:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Provedor inválido.")
    return ident


async def _chave_do_conector(integration_id: str) -> str:
    """Tira a `api_key` de um conector já cadastrado.

    Identifica o conector de LLM pelo `template_id` **ou pelo nome**, nunca pela
    `category`: a tela grava sempre "APIs" para conector de API, nunca "llm", e
    exigir `category` aqui rejeitava todo conector real — deixando esta função
    inalcançável pela interface.
    """
    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "SELECT name, template_id, credentials FROM public.integrations WHERE id = $1::uuid",
            integration_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Conector não encontrado.")
    if not _resolver_provedor(linha["template_id"], linha["name"]):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f'Não consegui identificar o provedor de LLM do conector "{linha["name"]}". '
            "Suportados: DeepSeek, OpenAI, Anthropic e Gemini.",
        )
    bruto = linha["credentials"] or "[]"
    creds = json.loads(bruto) if isinstance(bruto, str) else bruto
    # Preferência pela chave cujo nome contém `api_key`; se nenhuma, a primeira
    # com valor.
    for c in creds:
        if "api_key" in str((c or {}).get("key_name") or (c or {}).get("key") or "").lower():
            if str((c or {}).get("value") or "").strip():
                return str(c["value"]).strip()
    for c in creds:
        if str((c or {}).get("value") or "").strip():
            return str(c["value"]).strip()
    raise HTTPException(
        status.HTTP_400_BAD_REQUEST,
        "Conector sem chave configurada — cole a API key antes de conectar.",
    )


@router.post("/provedores")
async def salvar(dados: SalvarIn, _: Usuario = Depends(exige_papel("super_admin"))):
    """Grava o provedor no cofre do gateway.

    ⚠️ **Provedor novo vai por fila; provedor existente é editado na hora.** Não
    é escolha: adicionar por `config.patch` faz o reload do gateway crashar e
    reverter (bisseccionado em 01/08/2026, vale para openai e anthropic). Editar
    o que já existe funciona.
    """
    tipo = dados.provider_type.strip().lower()
    ident = _identificador(tipo, dados.provider_id)

    chave = dados.api_key.strip()
    if not chave and dados.integration_id:
        chave = await _chave_do_conector(dados.integration_id)

    parsed, base_hash = await _config_do_gateway()
    provs = _provedores(parsed)
    existente = provs.get(ident)
    padroes = ((parsed.get("agents") or {}).get("defaults") or {})
    catalogo_atual = [k for k in (padroes.get("models") or {}) if k.startswith(f"{ident}/")]

    if not chave and not existente:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Informe a API key para instalar o provedor."
        )

    catalogo_novo = {f"{ident}/{m.id}": {} for m in dados.models}
    # Entradas velhas deste provedor que não estão mais na seleção viram `null`
    # (o merge patch deleta). Foi o que deixou `openai/gpt-5.4-mini` fantasma no
    # seletor e derrubou um turno com timeout em 01/08 — provedor e catálogo
    # nunca podem andar separados.
    catalogo_remover = [k for k in catalogo_atual if k not in catalogo_novo]

    if not existente:
        no = dict(_PADROES.get(tipo) or {"api": "openai-completions", "auth": "api-key"})
        no["apiKey"] = chave
        no["models"] = [
            {"id": m.id, "name": m.name or m.id,
             **({"contextWindow": m.contextWindow} if m.contextWindow else {})}
            for m in dados.models
        ]
        if dados.base_url:
            no["baseUrl"] = dados.base_url

        async with sessao(role="service_role") as conn:
            await conn.execute(
                "INSERT INTO public.llm_provider_ops (op, provider_id, payload) "
                "VALUES ('upsert_provider', $1, $2::text::jsonb)",
                ident,
                json.dumps({"node": no, "catalogo": catalogo_novo,
                            "catalogo_remover": catalogo_remover}),
            )
        logger.info("Provedor %s enfileirado para instalação", ident)
        return {
            "ok": True, "queued": True, "provedor": ident,
            "nota": "Provedor novo é instalado pela VPS — o gateway não aceita a "
                    "quente. Confirma em segundos.",
        }

    # ── Provedor existente: patch direto ──
    # Array SUBSTITUI no merge patch, então a lista enviada é a lista final.
    # Modelo que já estava preserva os metadados ricos (custo, janela) — reenviar
    # só id e nome os apagaria.
    atuais = {m.get("id"): m for m in (existente.get("models") or [])}
    modelos = [
        atuais.get(m.id) or {
            "id": m.id, "name": m.name or m.id,
            **({"contextWindow": m.contextWindow} if m.contextWindow else {}),
        }
        for m in dados.models
    ]

    no: dict = {"models": modelos}
    if chave and chave != _SENTINELA:
        # Sem chave nova, não toca no campo: o gateway devolve a existente
        # mascarada, e reenviar a máscara gravaria ela por cima da chave real.
        no["apiKey"] = chave
    if dados.base_url:
        no["baseUrl"] = dados.base_url

    patch = {
        "models": {"providers": {ident: _sem_sentinela(no)}},
        "agents": {"defaults": {"models": {
            **catalogo_novo,
            **{k: None for k in catalogo_remover},
        }}},
    }

    c = await cfg.carregar()
    try:
        await obter_cliente(c.url, c.token).chamar(
            "config.patch",
            # `raw` é STRING e `baseHash` é obrigatório — os dois detalhes que
            # fizeram tentativas anteriores falharem sem ninguém entender.
            {"raw": json.dumps(patch), "baseHash": base_hash},
        )
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"O gateway recusou a alteração: {e}")

    logger.info("Provedor %s atualizado no gateway (%d modelos)", ident, len(modelos))
    return {"ok": True, "provedor": ident, "modelos": len(modelos)}


class RemocaoIn(BaseModel):
    provider_type: str = Field(min_length=1)
    provider_id: str | None = None


@router.post("/provedores/remover")
async def remover(dados: RemocaoIn, _: Usuario = Depends(exige_papel("super_admin"))):
    """Remove o provedor — pela fila, e só se ninguém estiver usando.

    A checagem de uso vem antes de tudo: remover um provedor que é o padrão da
    instância ou o modelo de um agente deixaria o sistema sem para onde apontar,
    e o sintoma seria agente mudo sem erro visível.
    """
    tipo = dados.provider_type.strip().lower()
    ident = _identificador(tipo, dados.provider_id)

    parsed, _hash = await _config_do_gateway()
    agentes = (parsed.get("agents") or {})
    padroes = (agentes.get("defaults") or {})
    padrao = padroes.get("model") or {}

    em_uso: list[str] = []
    if str(padrao.get("primary") or "").startswith(f"{ident}/"):
        em_uso.append("padrão da instância (primary)")
    for fb in padrao.get("fallbacks") or []:
        if str(fb).startswith(f"{ident}/"):
            em_uso.append("fallback da instância")
    for a in agentes.get("list") or []:
        if str(a.get("model") or "").startswith(f"{ident}/"):
            em_uso.append(f"agente {a.get('id')}")

    if em_uso:
        unicos = list(dict.fromkeys(em_uso))
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Este provedor está em uso: {', '.join(unicos)}. Reatribua antes de remover.",
        )

    catalogo = [k for k in (padroes.get("models") or {}) if k.startswith(f"{ident}/")]
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "INSERT INTO public.llm_provider_ops (op, provider_id, payload) "
            "VALUES ('remove_provider', $1, $2::text::jsonb)",
            ident, json.dumps({"catalogo_remover": catalogo}),
        )
    # Remoção a quente nunca foi provada, e o hot-add crasha o reload. Mesmo
    # caminho seguro: a VPS remove do arquivo e reinicia.
    logger.info("Provedor %s enfileirado para remoção", ident)
    return {"ok": True, "queued": True, "removido": ident}


# ─────────────────────────────────────────────────────────────────────────────
# Fila — lado do sincronizador da VPS
# ─────────────────────────────────────────────────────────────────────────────


class ResultadoOp(BaseModel):
    id: str
    ok: bool
    error: str | None = None
    result: dict | None = None


@router.get("/ops/pendentes")
async def ops_pendentes(_: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN"))):
    """O que o sincronizador da VPS tem para fazer.

    Exclusivo do sincronizador — o `payload` traz a **api_key em claro**, que é
    o que ele precisa escrever no arquivo de config. Por isso está atrás do
    segredo compartilhado e nunca é exposto ao navegador.
    """
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT id::text AS id, op, provider_id, payload FROM public.llm_provider_ops "
            "WHERE status = 'pending' ORDER BY created_at LIMIT 20"
        )
    return {"ops": [
        {**dict(l), "payload": json.loads(l["payload"]) if isinstance(l["payload"], str) else l["payload"]}
        for l in linhas
    ]}


@router.post("/ops/resultado", status_code=status.HTTP_204_NO_CONTENT)
async def ops_resultado(
    resultados: list[ResultadoOp],
    _: None = Depends(exige_segredo("GUARDRAILS_API_TOKEN")),
):
    """O sincronizador reporta o que fez.

    Operação que deu certo **e produziu resultado** (a descoberta de modelos)
    vira `done` guardando o resultado, para a tela buscar. As outras somem: a
    fila é de trabalho, não de histórico.

    Em qualquer desfecho o `payload` é apagado — é onde a api_key estava, e ela
    não tem por que continuar no banco depois de escrita no cofre.
    """
    async with sessao(role="service_role") as conn:
        for r in resultados:
            if r.ok and r.result:
                await conn.execute(
                    "UPDATE public.llm_provider_ops SET status = 'done', result = $2::text::jsonb, "
                    "payload = NULL WHERE id = $1::uuid",
                    r.id, json.dumps(r.result),
                )
            elif r.ok:
                await conn.execute(
                    "DELETE FROM public.llm_provider_ops WHERE id = $1::uuid", r.id
                )
            else:
                await conn.execute(
                    "UPDATE public.llm_provider_ops SET status = 'error', error = $2, "
                    "payload = NULL WHERE id = $1::uuid",
                    r.id, (r.error or "Falha no sincronizador")[:500],
                )
    logger.info("Sincronizador reportou %d operação(ões)", len(resultados))
