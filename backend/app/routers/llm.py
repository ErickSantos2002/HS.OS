"""Provedores de LLM — credencial e catálogo, os dois pelo `config.patch`.

Duas coisas, dois lugares da config, **um patch só**:

- **a credencial** em `models.providers.<id>.apiKey`
- **o catálogo** (quais modelos aparecem no seletor) em `agents.defaults.models`

Separá-los foi o que deixou modelo no seletor apontando para provedor
inexistente em 01/08/2026.

⚠️ **A precedência do cofre do agente.** A credencial também pode existir em
`auth_profile_store`, no SQLite de cada agente — é o que o `openclaw onboard`
cria. Quando existe, ela **ganha** do `models.providers` da config: em
13/08/2026 uma chave nova gravada aqui foi solenemente ignorada enquanto o
gateway insistia num perfil morto (`profile=sha256:154a23a3efe6`, 401 a cada
turno). Esvaziar `auth.profiles` não resolve — o cofre sobrevive à declaração.
O que resolve é zerar a ordem:

    {"auth": {"order": {"anthropic": []}}}

Com a ordem vazia o gateway não tenta perfil nenhum daquele provedor e usa a
config. Instalação nascida pela API (como as do dn.os) nunca tem esse conflito;
a nossa tem porque foi criada pelo CLI.

⚠️ **Duas conclusões anteriores estavam erradas.** Ficam escritas para não
voltarem, porque as duas custaram horas:

1. *"Adicionar provedor a quente crasha o reload"* (01/08/2026). O `config.schema`
   declara `models.providers` com `apiKey` aceitando string,
   `additionalProperties: false` e **nenhum campo obrigatório** — o nó que
   mandávamos era válido em cada campo. Naquele dia houve escrita de provedor
   **e** um `openai/gpt-5.4-mini` que o gateway não resolvia no catálogo, e
   entrada irresolvível derruba toda execução de agente. O crash foi atribuído à
   escrita que coincidiu.

2. *"O gateway não expõe como gravar credencial"* (13/08/2026). Sondei 17 nomes
   de método de auth-profile, todos `unknown method`, e concluí impossível. Era
   a abstração errada: quem grava é o `config.patch`. E inferi "não suportado"
   de "não usado" — `models` estava ausente do `openclaw.json` porque esta
   instância foi configurada pelo CLI, não porque a seção fosse rejeitada.

O padrão comum: **culpar a escrita que coincidiu, em vez de ler o contrato.** O
`config.schema` existe e responde; consultar leva trinta segundos.

Contrato do `config.patch`, levantado contra o gateway real:
  - `raw` é **string**, não objeto ("at /raw: must be string")
  - `baseHash` é **obrigatório** — lock otimista. O campo chama `baseHash`;
    mandar `hash` é rejeitado
  - semântica de JSON Merge Patch (RFC 7386): objeto faz merge profundo, array
    **substitui**, `null` **deleta**
  - remover item de **array** exige `replacePaths` com os caminhos exatos, ou
    `config.apply` para troca da config inteira
  - o patch dispara reload, e **o reload derruba o WebSocket**: erro de conexão
    logo depois não quer dizer que não gravou. Ver `_aplicar_patch`.
"""

import asyncio
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
from app.gateway.patch import aplicar_patch as _aplicar_patch, config_do_gateway as _config_do_gateway
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

# O gateway devolve a chave mascarada com esta sentinela em `config.get`.
# Reenviá-la gravaria a máscara POR CIMA da credencial real — o campo tem 21
# caracteres e passaria por uma chave curta sem ninguém notar.
_SENTINELA = "__OPENCLAW_REDACTED__"

_ID_CUSTOM = re.compile(r"^[a-z0-9][a-z0-9-]{1,23}$")

# Modelos que não são de chat só poluem a lista. Filtro heurístico — o usuário
# vê o que sobrou, então um falso negativo é recuperável digitando o id.
_NAO_CHAT = re.compile(
    r"embed|whisper|tts|audio|dall-e|image|moderation|vision-preview|realtime"
    r"|transcribe|search|similarity|edit-|-if-|guard", re.I
)




def _provedores(parsed: dict) -> dict:
    return ((parsed.get("models") or {}).get("providers") or {})


async def _modelos_sem_api(esperados: set[str]) -> set[str]:
    """Quais dos `esperados` o gateway **não** conseguiu resolver.

    O `models.list` espelha o catálogo, mas só preenche `api` para id que o
    registro interno conhece. `api` vazio é o sinal de que o id entrou no
    catálogo e não virou modelo utilizável.

    Em caso de dúvida devolve vazio: acusar falsamente um modelo bom e recolhê-lo
    seria pior que deixar passar — quem valida de fato é a execução.
    """
    try:
        c = await cfg.carregar()
        r = await obter_cliente(c.url, c.token).chamar("models.list", {})
    except (ErroGateway, HTTPException, OSError) as e:
        logger.info("models.list indisponível na verificação: %s", e)
        return set()

    payload = r.get("payload") if isinstance(r.get("payload"), dict) else r
    vistos = payload.get("models")
    if not isinstance(vistos, list) or not vistos:
        return set()

    resolvidos = {
        f"{m.get('provider')}/{m.get('id')}"
        for m in vistos
        if isinstance(m, dict) and m.get("api")
    }
    # Só acusa id que apareceu na lista e veio sem `api`. Id que sumiu por
    # completo é outro problema e não se conserta recolhendo-o.
    presentes = {
        f"{m.get('provider')}/{m.get('id')}" for m in vistos if isinstance(m, dict)
    }
    return (esperados & presentes) - resolvidos


async def _retirar_do_catalogo(modelos: set[str]) -> None:
    """Desfaz a inclusão de modelos que não resolveram. Relê o hash: o patch
    anterior o invalidou, e reusá-lo é recusado pelo lock otimista."""
    if not modelos:
        return
    _parsed, base_hash = await _config_do_gateway()
    patch = {"agents": {"defaults": {"models": {m: None for m in modelos}}}}
    try:
        await _aplicar_patch(
            patch, base_hash,
            conferir=lambda cfg_: not (
                set(modelos) & set(((cfg_.get("agents") or {}).get("defaults") or {}).get("models") or {})
            ),
        )
    except (HTTPException, ErroGateway) as e:
        # Não levanta: o catálogo principal já foi gravado e a resposta vai
        # avisar quais não colaram. Levantar aqui faria a tela dizer que nada
        # foi salvo, o que seria falso.
        logger.error("Falhei ao recolher %s do catálogo: %s", modelos, e)


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
    """Grava o provedor no gateway: a credencial **e** o catálogo de modelos.

    Duas coisas, em lugares diferentes da config:

    - **A credencial** vai em `models.providers.<id>.apiKey`.
    - **O catálogo** (quais modelos aparecem no seletor) vai em
      `agents.defaults.models`.

    As duas por `config.patch`, a quente. Vão no **mesmo patch**: provedor e
    catálogo separados foi o que deixou modelo fantasma no seletor em 01/08.

    ⚠️ **Duas conclusões anteriores sobre isto estavam erradas, e as duas
    custaram caro.** Ficam registradas para não voltarem:

    1. *"Adicionar provedor a quente crasha o reload"* (01/08/2026). O `config.
       schema` do gateway declara `models.providers` com `apiKey` aceitando
       string, `additionalProperties: false` e **nenhum campo obrigatório** —
       o nó que mandávamos era válido. Naquele dia houve escrita de provedor
       **e** um `openai/gpt-5.4-mini` que o gateway não resolvia no catálogo, e
       hoje sabemos que entrada irresolvível derruba toda execução de agente. O
       crash foi atribuído à escrita que coincidiu.

    2. *"O gateway não expõe como gravar credencial"* (13/08/2026, manhã). Eu
       sondei 17 nomes de método de auth-profile, todos `unknown method`, e
       concluí que era impossível. Era a abstração errada: quem grava é o
       `config.patch`, que eu já tinha na mão. E inferi "não suportado" de "não
       usado" — `models` estava ausente do `openclaw.json` porque esta
       instância foi configurada pelo CLI (`auth.profiles`), não porque a seção
       fosse ignorada.

    O padrão comum aos dois: **culpar a escrita que coincidiu, em vez de ler o
    contrato.** O schema estava a uma chamada de distância nas duas vezes.

    ⚠️ `models.mode` é `merge` por padrão: os provedores embutidos continuam e o
    nosso nó sobrepõe. Por isso mandamos o mínimo — só `apiKey` para provedor
    nativo. Reenviar `api`/`baseUrl` de um built-in é chance de divergir dele
    sem ganho.
    """
    tipo = dados.provider_type.strip().lower()
    ident = _identificador(tipo, dados.provider_id)
    chave = dados.api_key.strip()
    if chave == _SENTINELA:
        # A tela nunca deveria reenviar a máscara, mas se reenviar, gravá-la
        # trocaria a credencial real por 21 caracteres inúteis — e o sintoma
        # seria 401 em todo agente, sem nada dizendo o que houve.
        chave = ""

    parsed, base_hash = await _config_do_gateway()
    padroes = ((parsed.get("agents") or {}).get("defaults") or {})
    perfis = ((parsed.get("auth") or {}).get("profiles") or {})

    # Credencial já existente: nó em `models.providers` ou perfil em
    # `auth.profiles` (o caminho do CLI). Qualquer um serve — o que não pode é
    # gravar catálogo para um provedor sem nenhuma forma de autenticar.
    tem_credencial = bool(_provedores(parsed).get(ident)) or any(
        str(k).split(":", 1)[0] == ident for k in perfis
    )
    if not chave and not tem_credencial:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f'O provedor "{ident}" não tem credencial no gateway. Cole a API key '
            "para instalá-lo — sem ela não há como executar modelo nenhum.",
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

    # Provedor e catálogo no MESMO patch. Separá-los foi o que deixou modelo no
    # seletor apontando para provedor que não existia.
    patch: dict = {"agents": {"defaults": {"models": {
        **catalogo_novo,
        **{k: None for k in catalogo_remover},
    }}}}

    if chave:
        # Mínimo possível. Com `models.mode: merge` o provedor embutido continua
        # valendo e só a chave sobrepõe; reenviar `api`/`baseUrl` de um built-in
        # é chance de divergir dele sem ganho nenhum.
        no: dict = {"apiKey": chave}
        if tipo not in _PROVEDORES:
            # Provedor personalizado não tem built-in para herdar: precisa dizer
            # como falar e para onde.
            no.update(_PADROES.get(tipo) or {"api": "openai-completions", "auth": "api-key"})
            if dados.base_url:
                no["baseUrl"] = dados.base_url
            no["apiKey"] = chave
        elif dados.base_url:
            no["baseUrl"] = dados.base_url
        patch["models"] = {"providers": {ident: no}}

    await _aplicar_patch(
        patch, base_hash,
        # Pegou se todo modelo escolhido está no catálogo — e, quando veio
        # chave, se o provedor passou a existir.
        conferir=lambda cfg_: (
            set(catalogo_novo)
            <= set(((cfg_.get("agents") or {}).get("defaults") or {}).get("models") or {})
            and (not chave or ident in _provedores(cfg_))
        ),
    )

    logger.info(
        "Catálogo de %s atualizado: %d modelo(s), %d removido(s)",
        ident, len(catalogo_novo), len(catalogo_remover),
    )

    # ⚠️ **Confere depois de escrever, e desfaz o que não resolveu.**
    #
    # O catálogo aceita qualquer id: são chaves com valor `{}`. Quem resolve o
    # modelo é um registro interno do gateway, e id que ele não conhece entra no
    # catálogo e volta no `models.list` **sem `api`**. Isso não é cosmético —
    # em 13/08/2026 bastou um `claude-sonnet-4-5-20250929` inválido no catálogo
    # para toda execução de agente morrer em 261 ms com zero token, inclusive a
    # de quem usava um modelo válido. O sintoma foi "The agent run failed before
    # producing a reply", sem nenhuma pista do motivo.
    #
    # A lista de modelos vem da API do provedor, que oferece ids que este
    # gateway pode não suportar — então não dá para validar antes. Escrever,
    # conferir e recolher o que não colou é o que resta.
    nao_resolvidos = await _modelos_sem_api(set(catalogo_novo))
    if nao_resolvidos:
        await _retirar_do_catalogo(nao_resolvidos)
        logger.warning(
            "Modelos recolhidos do catálogo por não resolverem no gateway: %s",
            ", ".join(sorted(nao_resolvidos)),
        )

    aplicados = [m for m in catalogo_novo if m not in nao_resolvidos]
    return {
        "ok": True, "provedor": ident,
        "modelos": len(aplicados),
        "removidos": len(catalogo_remover),
        # A tela avisa em vez de fingir que salvou os que voltaram atrás.
        "nao_suportados": sorted(m.split("/", 1)[-1] for m in nao_resolvidos),
    }


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
    await _aplicar_patch(
        patch, base_hash,
        conferir=lambda cfg_: not (
            set(catalogo) & set(((cfg_.get("agents") or {}).get("defaults") or {}).get("models") or {})
        ),
    )

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
