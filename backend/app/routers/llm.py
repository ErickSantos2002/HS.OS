"""Provedores de LLM — o catálogo de modelos do gateway.

⚠️ **Este módulo não grava credencial, e não é por opção.** Levantado ao vivo em
13/08/2026: a chave de LLM não vive na config do gateway. Vive em
`auth_profile_store`, no SQLite de **cada agente**, e o `openclaw.json` só
declara que o perfil existe e em que modo (`auth.profiles`). Sondamos 17 nomes
de método de escrita de auth — `models.auth.set`, `auth.profiles.set`,
`credentials.set`, … — e **todos** respondem `unknown method`. A única escrita
suportada é pelo CLI, na própria VPS:

    openclaw models auth paste-api-key --agent <id>

O que sobra para cá, e funciona bem, é **o catálogo**: quais modelos aparecem no
seletor, em `agents.defaults.models`. Esse o `config.patch` altera a quente.

Por isso "o provedor existe" significa **tem perfil em `auth.profiles`**, não
"tem nó em `models.providers`". Nesta instalação a seção `models` nem existe no
`openclaw.json` — `models.providers` estava vazio enquanto `anthropic:default`
alimentava a Nina normalmente.

⚠️ Isso reinterpreta a nota de 01/08/2026, que concluiu que "adicionar provedor
a quente crasha o reload" e criou a fila `llm_provider_ops` para contornar. O que
crashava era **injetar uma seção `models` que o schema não conhece**. A fila
tratou o sintoma, e nunca funcionou por outro motivo: o sincronizador que a
consumiria não foi escrito. Uma op de 13/08 ficou `pending` enquanto a tela
prometia "confirma em segundos".

Contrato do `config.patch`, confirmado com o corpo exato de uma chamada real:
  - `raw` é **string**, não objeto (objeto é recusado com "at /raw: must be string")
  - `baseHash` é **obrigatório** — lock otimista. O campo chama `baseHash`;
    mandar `hash` é rejeitado, e isso fez tentativas anteriores falharem sem
    ninguém entender
  - a semântica é JSON Merge Patch (RFC 7386): objeto faz merge profundo, array
    **substitui**, `null` **deleta**. Mandar só `agents.defaults.models` preserva
    crons, agentes e o resto da config
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

_ID_CUSTOM = re.compile(r"^[a-z0-9][a-z0-9-]{1,23}$")

# Modelos que não são de chat só poluem a lista. Filtro heurístico — o usuário
# vê o que sobrou, então um falso negativo é recuperável digitando o id.
_NAO_CHAT = re.compile(
    r"embed|whisper|tts|audio|dall-e|image|moderation|vision-preview|realtime"
    r"|transcribe|search|similarity|edit-|-if-|guard", re.I
)




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


async def _saude_auth() -> dict:
    """Estado das credenciais segundo o próprio gateway (`models.authStatus`).

    Só reporta perfil que tem validade — na prática, OAuth. Perfil de `api_key`
    não aparece aqui, e a ausência **não** significa problema: significa que não
    há o que expirar.

    Vale a pena porque expira em silêncio. Em 13/08/2026 o `anthropic:claude-cli`
    estava vencido havia três meses e nada na tela dizia isso; só não quebrou
    porque o `api_key` vem antes dele na ordem.

    Nunca levanta: é enfeite informativo, e derrubar a listagem inteira porque a
    saúde não veio seria trocar uma tela completa por nenhuma.
    """
    try:
        c = await cfg.carregar()
        if not c.configurado:
            return {}
        r = await obter_cliente(c.url, c.token).chamar("models.authStatus", {})
    except (ErroGateway, HTTPException, OSError) as e:
        logger.info("authStatus indisponível (seguindo sem): %s", e)
        return {}

    payload = r.get("payload") if isinstance(r.get("payload"), dict) else r
    saude: dict[str, dict] = {}
    for p in payload.get("providers") or []:
        for perfil in p.get("profiles") or []:
            ident = perfil.get("profileId")
            if not ident:
                continue
            saude[ident] = {
                "tipo": perfil.get("type"),
                "status": perfil.get("status"),
                "expira_em": ((perfil.get("expiry") or {}).get("at")),
            }
    return saude


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
            "perfis": {}, "ordem_perfis": {}, "saude_auth": {},
        }

    provs = _provedores(parsed)
    agentes_cfg = (parsed.get("agents") or {})
    padroes = (agentes_cfg.get("defaults") or {})

    # ⚠️ **`perfis` é o que diz a verdade sobre a credencial**, e sem ele a tela
    # mente. A chave de LLM não vive em `models.providers` neste gateway — vive
    # no SQLite de cada agente, e o `openclaw.json` só declara que o perfil
    # existe e em que modo. Levantado em 13/08/2026: `models.providers` estava
    # vazio, `auth.profiles` tinha `anthropic:default` em modo `api_key`, e era
    # esse perfil que alimentava a Nina.
    #
    # O front já sabia disso — o `nativas` em `LlmProvidersSection.tsx` existe
    # exatamente para marcar "funciona, mas não é gerenciado por aqui". Ele
    # nunca funcionou porque este endpoint não mandava o campo, e o card da
    # Anthropic dizia "não conectado" sobre a chave que estava respondendo.
    auth_cfg = (parsed.get("auth") or {})
    perfis = auth_cfg.get("profiles") or {}
    ordem = auth_cfg.get("order") or {}

    async with sessao(role="service_role") as conn:
        ops = await fila(conn)

    return {
        # Só `provider` e `mode`: o valor da chave não está aqui nem no gateway
        # — e se um dia estiver, não é para sair.
        "perfis": {
            chave: {"provider": (no or {}).get("provider"),
                    "mode": (no or {}).get("mode")}
            for chave, no in perfis.items()
            if isinstance(no, dict)
        },
        "ordem_perfis": ordem,
        "saude_auth": await _saude_auth(),
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



@router.post("/provedores")
async def salvar(dados: SalvarIn, _: Usuario = Depends(exige_papel("super_admin"))):
    """Gerencia o provedor no gateway — **o catálogo, nunca a credencial.**

    A divisão não é escolha nossa, é como este gateway funciona:

    - **A credencial** (a API key) vive em `auth_profile_store`, no SQLite de
      cada agente. Não está na config, e o gateway **não expõe método nenhum**
      para gravá-la — 17 nomes sondados em 13/08/2026, todos `unknown method`.
      Só o CLI da VPS escreve: `openclaw models auth paste-api-key`.
    - **O catálogo** (quais modelos aparecem no seletor) vive em
      `agents.defaults.models`, na config, e esse sim o `config.patch` altera a
      quente. É o que fazemos aqui.

    Por isso "provedor existe" passou a significar **tem credencial** — ou seja,
    tem perfil em `auth.profiles` — e não "tem nó em `models.providers`". Esse
    nó está vazio nesta instalação e o gateway nem lê a seção: `models` não
    existe no `openclaw.json`.

    ⚠️ Isso reinterpreta a nota de 01/08/2026 que dizia que "adicionar provedor
    a quente crasha o reload". O que crashava era injetar uma seção `models` que
    o schema não conhece. Removida a injeção, o patch de catálogo é seguro —
    ele mexe numa seção que já existe.
    """
    tipo = dados.provider_type.strip().lower()
    ident = _identificador(tipo, dados.provider_id)

    if dados.api_key.strip() or dados.integration_id:
        raise HTTPException(
            status.HTTP_501_NOT_IMPLEMENTED,
            "A API key não pode ser gravada por aqui — nem para instalar, nem para "
            f'rotacionar. A credencial do "{ident}" vive no banco de cada agente e '
            "só o CLI da VPS a escreve:\n\n"
            f"    openclaw models auth paste-api-key --agent <id-do-agente>\n\n"
            "Aceitar a chave aqui e não gravá-la seria pior: a tela diria que "
            "mudou algo que continuaria igual.",
        )

    parsed, base_hash = await _config_do_gateway()
    padroes = ((parsed.get("agents") or {}).get("defaults") or {})
    perfis = ((parsed.get("auth") or {}).get("profiles") or {})

    # Credencial existe se há QUALQUER perfil deste provedor. O nó legado em
    # `models.providers` também conta, para instalação que ainda o tenha.
    tem_credencial = bool(_provedores(parsed).get(ident)) or any(
        str(chave).split(":", 1)[0] == ident for chave in perfis
    )
    if not tem_credencial:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f'O provedor "{ident}" não tem credencial no gateway, então não há o que '
            "pôr no seletor. Grave a chave na VPS primeiro:\n\n"
            f"    openclaw models auth paste-api-key --agent <id-do-agente>\n\n"
            "Feito isso, ele aparece aqui sozinho e você escolhe os modelos.",
        )

    catalogo_atual = [k for k in (padroes.get("models") or {}) if k.startswith(f"{ident}/")]
    catalogo_novo = {f"{ident}/{m.id}": {} for m in dados.models}
    # Entradas velhas deste provedor que saíram da seleção viram `null` (o merge
    # patch deleta). Foi o que deixou `openai/gpt-5.4-mini` fantasma no seletor e
    # derrubou um turno com timeout em 01/08 — catálogo e realidade não podem
    # andar separados.
    catalogo_remover = [k for k in catalogo_atual if k not in catalogo_novo]

    if not catalogo_novo:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Escolha ao menos um modelo — esvaziar o catálogo deixaria o seletor "
            "sem opção deste provedor.",
        )

    # ⚠️ Só `agents.defaults.models`. Nada de `models.providers`: é a seção que
    # este gateway ignora e que derrubava o reload.
    patch = {"agents": {"defaults": {"models": {
        **catalogo_novo,
        **{k: None for k in catalogo_remover},
    }}}}

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

    logger.info(
        "Catálogo de %s atualizado: %d modelo(s), %d removido(s)",
        ident, len(catalogo_novo), len(catalogo_remover),
    )
    return {"ok": True, "provedor": ident, "modelos": len(catalogo_novo),
            "removidos": len(catalogo_remover)}


class RemocaoIn(BaseModel):
    provider_type: str = Field(min_length=1)
    provider_id: str | None = None


@router.post("/provedores/remover")
async def remover(dados: RemocaoIn, _: Usuario = Depends(exige_papel("super_admin"))):
    """Tira os modelos do provedor do seletor. **A credencial fica.**

    A checagem de uso vem antes de tudo: remover um provedor que é o padrão da
    instância ou o modelo de um agente deixaria o sistema sem para onde apontar,
    e o sintoma seria agente mudo sem erro visível.

    ⚠️ **Isto não apaga a chave**, e não é limitação disfarçada de decisão: o
    gateway não expõe método para apagá-la, do mesmo jeito que não expõe para
    gravá-la. O que some é a presença do provedor no seletor de modelos. Para
    tirar a credencial de vez, é no CLI da VPS.

    Antes daqui saía uma op para `llm_provider_ops` esperando um sincronizador
    que não existe — a remoção ficava `pending` para sempre e a tela dizia que
    ia confirmar. Agora o que dá para fazer é feito na hora, e o que não dá é
    dito.
    """
    tipo = dados.provider_type.strip().lower()
    ident = _identificador(tipo, dados.provider_id)

    parsed, base_hash = await _config_do_gateway()
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
    if not catalogo:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            f'O provedor "{ident}" não tem modelo nenhum no seletor — não há o que '
            "remover daqui.",
        )

    patch = {"agents": {"defaults": {"models": {k: None for k in catalogo}}}}
    c = await cfg.carregar()
    try:
        await obter_cliente(c.url, c.token).chamar(
            "config.patch", {"raw": json.dumps(patch), "baseHash": base_hash}
        )
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"O gateway recusou a remoção: {e}")

    logger.info("Provedor %s saiu do seletor (%d modelos)", ident, len(catalogo))
    return {"ok": True, "removido": ident, "modelos": len(catalogo),
            "credencial_mantida": True}


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
