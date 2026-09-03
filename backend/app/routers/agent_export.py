"""Exportação de agente em `.hsos` (era `.dnos`) — portado de `export-agent`.

O arquivo exportado viaja entre instalações, então **tudo que identifica esta
empresa tem que virar placeholder**. A limpeza é determinística e acontece em
três passadas, na ordem em que a edge as aplicava:

1. `_restaurar_placeholders` — valores exatos do `company_profile`
2. `_sanitizar_uuids` — ids de plataforma, com placeholder por contexto
3. `_sanitizar_infra_e_nomes` — IP/host da VPS e nomes de pessoas

A ordem importa: a terceira passada é a mais agressiva (qualquer palavra de 4+
letras dos campos de gente vira `{{COMPANY_REF}}`) e rodar antes das outras
apagaria o texto que elas usariam para casar.

**Uma diferença forçada em relação à edge.** Ela lia os arquivos pedindo ao LLM
do orquestrador que os lesse e devolvesse JSON, com timeout de 170s — e o
comentário dela explica por quê: em 19/07/2026 o gateway não expunha nenhuma
leitura de arquivo. Isso mudou. `agents.files.get` funciona (ver `CLAUDE.md`), e
a rota `/v1/chat/completions` que a edge usava para falar com o orquestrador é
404 hoje. Ou seja, o caminho antigo não é portável: não existe mais. A fonte
primária continua sendo a tabela `agent_files`, como na edge; só o fallback
mudou de mecanismo.
"""

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import settings
from app.database import sessao
from app.dependencies import Usuario, usuario_atual
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])

# Nomes canônicos que compõem o pacote. `LEARNINGS.md` entra quando existe: é o
# aprendizado portável, limpo por construção, mas passa pela mesma sanitização
# dos demais — cinto e suspensório para o arquivo que viaja entre empresas.
# ⚠️ **Lista curada, não "tudo do workspace" — e a diferença é deliberada.**
# O agente tem sete arquivos; estes quatro são os que definem *o que ele é* e
# viajam bem para outra instalação.
#
# Ficam de fora, de propósito:
#   MEMORY.md    — memória acumulada: nomes de cliente, detalhe de negócio,
#                  conversa específica. A limpeza deste módulo é regex, e
#                  confiar quilobytes de texto livre a um regex é pior do que
#                  não levar o arquivo.
#   USER.md      — para quem o agente trabalha. Mesma razão.
#   HEARTBEAT.md — estado operacional, sem sentido em outra instalação.
#
# `LEARNINGS.md` estava aqui e **não existe no gateway** — sobra da instância
# de origem, removida em 11/08/2026.
_ARQUIVOS = ["SOUL.md", "IDENTITY.md", "TOOLS.md", "AGENTS.md"]

_ID_VALIDO = re.compile(r"^[a-z0-9-]{2,32}$")


# ─────────────────────────────────────────────────────────────────────────────
# Passada 1 — valores do company_profile viram placeholder
# ─────────────────────────────────────────────────────────────────────────────

# `(campo do profile, placeholder)`. Alguns campos não existem na tabela desta
# instalação (`mission`, `differentials`, `gateway_url`, `brand_voice`,
# `product`): a edge fazia `select *` e acessava a chave, que vinha `undefined`.
# Aqui é `.get()`, com a mesma tolerância — a lista é o contrato do formato,
# não do schema.
_CAMPOS_PLACEHOLDER: list[tuple[tuple[str, ...], str]] = [
    (("name", "company_name"), "{{COMPANY_NAME}}"),
    (("founder_name",), "{{FOUNDER_NAME}}"),
    (("segment",), "{{COMPANY_SEGMENT}}"),
    (("description",), "{{COMPANY_DESCRIPTION}}"),
    (("target_audience",), "{{TARGET_AUDIENCE}}"),
    (("products_services", "product"), "{{COMPANY_PRODUCT}}"),
    (("tone", "brand_voice"), "{{BRAND_VOICE}}"),
    (("mission",), "{{MISSION}}"),
    (("differentials",), "{{DIFFERENTIALS}}"),
    (("gateway_url",), "{{GATEWAY_URL}}"),
]


def _primeiro(perfil: dict, chaves: tuple[str, ...]):
    for c in chaves:
        v = perfil.get(c)
        if v is not None:
            return v
    return None


def _restaurar_placeholders(conteudo: str, perfil: dict | None) -> str:
    if not conteudo or not perfil:
        return conteudo
    pares = []
    for chaves, token in _CAMPOS_PLACEHOLDER:
        v = _primeiro(perfil, chaves)
        # Mínimo de 3 caracteres: abaixo disso o valor casaria dentro de
        # palavras comuns e destruiria o texto.
        if isinstance(v, str) and len(v.strip()) >= 3:
            pares.append((v, token))
    # Do maior para o menor: se "Health & Safety" e "Health" estão os dois na
    # lista, trocar o curto primeiro impediria o longo de casar.
    pares.sort(key=lambda p: len(p[0]), reverse=True)
    saida = conteudo
    for valor, token in pares:
        saida = re.sub(re.escape(valor), token, saida)
    return saida


# ─────────────────────────────────────────────────────────────────────────────
# Passada 2 — UUIDs de plataforma
# ─────────────────────────────────────────────────────────────────────────────

_UUID = re.compile(
    r"\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b", re.I
)

# O contexto anterior ao UUID diz o que ele é. Mantém a dica semântica em vez de
# achatar tudo em `{{PLATFORM_UUID}}` — quem importa o `.dnos` precisa saber que
# aquele id era de um board, não de um cron.
_PISTAS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"\bboard\b"), "{{DN_TASK_BOARD_ID}}"),
    (re.compile(r"\blist(a)?\b"), "{{DN_TASK_LIST_ID}}"),
    (re.compile(r"\b(member|membro|user|usuario|usuário)\b"), "{{DN_TASK_MEMBER_ID}}"),
    (re.compile(r"\bcard\b"), "{{DN_TASK_CARD_ID}}"),
    (re.compile(r"\bcron\b"), "{{CRON_ID}}"),
    (re.compile(r"\bagent(e)?\b"), "{{AGENT_UUID}}"),
]


def _sanitizar_uuids(conteudo: str) -> str:
    if not conteudo:
        return conteudo

    def troca(m: re.Match) -> str:
        # ⚠️ A janela de 60 caracteres atravessa quebras de linha, então UUIDs
        # vizinhos herdam a palavra-chave do anterior — dois ids em linhas
        # seguidas podem sair ambos como `{{DN_TASK_BOARD_ID}}`. É o
        # comportamento do original (mesma janela, mesma ordem de teste) e foi
        # mantido de propósito: só troca o rótulo, o id sai sanitizado de todo
        # jeito. Corrigir é tarefa separada.
        ctx = conteudo[max(0, m.start() - 60) : m.start()].lower()
        for padrao, token in _PISTAS:
            if padrao.search(ctx):
                return token
        return "{{PLATFORM_UUID}}"

    return _UUID.sub(troca, conteudo)


# ─────────────────────────────────────────────────────────────────────────────
# Passada 3 — infraestrutura e nomes de pessoas
# ─────────────────────────────────────────────────────────────────────────────

# `esquema://usuario:senha@host` — a credencial fica entre o `://` e o primeiro
# `@`, e nem o usuário nem a senha podem conter `/`, o que impede casar um `@`
# que apareça depois, no caminho da URL. Sem `://` antes não casa, então
# `contato@empresa.com` no meio do texto passa intacto.
_CREDENCIAL_EM_URL = re.compile(r"([a-z][a-z0-9+.\-]*://)[^\s/@:]+:[^\s/@]*@", re.IGNORECASE)

_SSH_IP = re.compile(r"\b(?:user|root)@\d{1,3}(?:\.\d{1,3}){3}\b")
# Loopback e 0.0.0.0 ficam: são genéricos e às vezes explicam a configuração.
_IP = re.compile(r"\b(?!127\.0\.0\.1\b)(?!0\.0\.0\.0\b)\d{1,3}(?:\.\d{1,3}){3}\b")


def _coletar_nomes(valor, minimo: int, destino: set[str]) -> None:
    if not isinstance(valor, str):
        return
    for palavra in re.split(r"[\s,;/]+", valor):
        limpo = palavra.strip()
        if len(limpo) >= minimo:
            destino.add(limpo)
            # "dn.ia" também gera "dnia": o texto pode citar a marca sem a
            # pontuação, e sem esta variante o nome escaparia.
            sem_pontuacao = re.sub(r"[^\w]", "", limpo, flags=re.UNICODE)
            if len(sem_pontuacao) >= minimo and sem_pontuacao != limpo:
                destino.add(sem_pontuacao)


def _sanitizar_infra_e_nomes(
    conteudo: str, url_gateway: str, perfil: dict | None, outros_nomes: list[str]
) -> str:
    """Pega o que a troca por valores exatos não alcança.

    Levantado na auditoria do primeiro `.dnos` real (29/07/2026): IP da VPS com
    usuário SSH, URL do projeto Supabase (14 ocorrências) e primeiros nomes
    soltos — "Rodrigo" não casa com "Rodrigo Nascimento".
    """
    if not conteudo:
        return conteudo
    saida = conteudo

    # ⚠️ **Primeiro de todos, e por um motivo específico.** A regra de IP mais
    # abaixo troca o host e deixaria a senha encostada no placeholder —
    # `postgresql://usuario:senha@{{IP_ADDRESS}}/banco`, que tem cara de arquivo
    # já limpo e é o pior resultado possível: some o sinal e fica o segredo.
    #
    # O `.hsos` viaja entre instalações, e os agentes falam com os nove bancos
    # da empresa por servidores MCP — string de conexão é exatamente o que
    # aparece escrito num `TOOLS.md`. O host e o banco continuam no texto, que
    # é contexto útil para quem for ler o agente noutro lugar; sai a credencial.
    saida = _CREDENCIAL_EM_URL.sub(r"\1{{CREDENCIAL}}@", saida)

    # URL do Supabase da instalação. A edge lia do próprio ambiente; aqui vem da
    # config, e só existe enquanto o front ainda tiver Supabase configurado.
    url_supabase = (getattr(settings, "supabase_url", "") or "").strip()
    if url_supabase:
        host = re.sub(r"^https?://", "", url_supabase)
        saida = saida.replace(url_supabase, "{{SUPABASE_URL}}")
        saida = saida.replace(host, "{{SUPABASE_HOST}}")

    # Host do gateway, que vem do `vps_config`. Pega também "root@host".
    host_gw = re.sub(r":\d+.*$", "", re.sub(r"^\w+://", "", url_gateway or ""))
    if host_gw:
        saida = saida.replace(f"root@{host_gw}", "{{VPS_SSH}}")
        saida = saida.replace(host_gw, "{{VPS_HOST}}")

    # Regra categórica: num arquivo exportável não existe IP legítimo. O
    # `vps_config` pode guardar um domínio (gateway atrás de proxy) e o IP cru
    # aparecer só no texto — flagrado no TOOLS.md, na seção de SSH.
    saida = _SSH_IP.sub("{{VPS_SSH}}", saida)
    saida = _IP.sub("{{IP_ADDRESS}}", saida)

    # Nomes próprios, palavra inteira, sem diferenciar maiúsculas.
    tokens: set[str] = set()
    p = perfil or {}
    _coletar_nomes(p.get("founder_name"), 4, tokens)
    _coletar_nomes(_primeiro(p, ("name", "company_name")), 3, tokens)
    # As pessoas da instalação: fonte determinística para os nomes que o
    # company_profile não carrega (sócios que não são o fundador, por exemplo).
    for n in outros_nomes:
        _coletar_nomes(n, 4, tokens)

    for token in sorted(tokens, key=len, reverse=True):
        # `[^\W_]` é "letra ou dígito" com consciência de Unicode — o
        # equivalente possível do `\p{L}\p{N}` do JS, já que o `re` do Python
        # não tem classes Unicode nomeadas. Evita casar dentro de palavra.
        saida = re.sub(
            rf"(?<![^\W_]){re.escape(token)}(?![^\W_])",
            "{{COMPANY_REF}}",
            saida,
            flags=re.IGNORECASE | re.UNICODE,
        )
    return saida


def _bloco_agente(a: dict, aid: str) -> dict:
    """O bloco `agent` do arquivo exportado.

    ⚠️ **`role` sai preenchido com o `specialty` quando o `role` está vazio, e
    é o caso de todos os agentes daqui.** O `role` é o campo do schema original
    do dn.os; nesta instalação ele está vazio nos cinco e quem carrega o papel é
    o `specialty` (levantado em 01/09/2026, montando a War room). A importação
    faz `specialty = agent.role || agent.description || "Agente importado do
    HS.OS"` — então exportar a `nina`, que tem `role` **e** `description`
    nulos, produzia um agente chamado "Agente importado do HS.OS" no lugar de
    "Orquestradora do time"; os outros quatro degradavam para a descrição
    longa.

    Não é defeito da portagem: a edge original mandava `role` porque lá ele era
    o campo vivo. O schema mudou embaixo e a exportação seguiu fiel a um campo
    morto.

    Preencher o `role` (em vez de criar um campo novo) mantém o arquivo legível
    por instalação que não conheça `specialty` — e é semanticamente honesto: o
    que está indo ali é o papel do agente, que é o que `role` sempre quis dizer.
    """
    return {
        "agent_id": a.get("agent_id") or aid,
        "name": a.get("name") or aid,
        "role": a.get("role") or a.get("specialty"),
        "department": a.get("department"),
        "description": a.get("description"),
        "author": "exportado via HS.OS",
        "color": a.get("color"),
        "emoji": a.get("emoji"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# Extração de metadados
# ─────────────────────────────────────────────────────────────────────────────

_CONECTORES: list[tuple[str, list[str]]] = [
    ("meta-ads", ["meta ads", "meta-ads", "meta_ads"]),
    ("meta", ["facebook graph", "meta graph"]),
    ("instagram", ["instagram"]),
    ("google-ads", ["google ads", "google-ads"]),
    ("google-oauth", ["google sheets", "google drive"]),
    ("linkedin", ["linkedin"]),
    ("telegram", ["telegram"]),
    ("slack", ["slack"]),
    ("whatsapp", ["whatsapp"]),
    ("canva", ["canva"]),
    ("elevenlabs", ["elevenlabs", "eleven labs"]),
    ("perplexity", ["perplexity"]),
    ("anthropic", ["anthropic", "claude"]),
    ("deepseek", ["deepseek"]),
    ("gemini", ["gemini"]),
]


def _extrair_conectores(soul: str, identity: str) -> list[str]:
    palheiro = f"{soul}\n{identity}".lower()
    achados = []
    for ident, chaves in _CONECTORES:
        if any(k in palheiro for k in chaves) and ident not in achados:
            achados.append(ident)
    return achados


_SECAO_CAPACIDADES = re.compile(
    r"(?:capacidades|habilidades|skills)[^\n]*\n((?:\s*[-*]\s+.+\n?)+)", re.I
)


def _extrair_capacidades(soul: str) -> list[str]:
    achadas: list[str] = []
    for m in _SECAO_CAPACIDADES.finditer(soul):
        for linha in m.group(1).split("\n"):
            item = re.sub(r"^\s*[-*]\s+", "", linha).strip()
            if item:
                # 60 caracteres e minúsculas: é rótulo para a tela de
                # importação, não o texto da skill.
                chave = item.lower()[:60]
                if chave not in achadas:
                    achadas.append(chave)
    return achadas


# ─────────────────────────────────────────────────────────────────────────────
# Endpoint
# ─────────────────────────────────────────────────────────────────────────────


async def _ler_do_gateway(agent_id: str) -> dict[str, str | None]:
    """Fallback quando a ponte ainda não espelhou o agente.

    A edge pedia ao LLM do orquestrador para ler e devolver JSON. Aquela rota é
    404 hoje, e o gateway ganhou leitura direta — o resultado é o mesmo conteúdo,
    sem depender de o modelo obedecer ao formato pedido.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise ErroGateway("Gateway não configurado.")
    cliente = obter_cliente(c.url, c.token)

    lidos: dict[str, str | None] = {}
    for nome in _ARQUIVOS:
        try:
            r = await cliente.chamar("agents.files.get", {"agentId": agent_id, "name": nome})
            conteudo = ((r.get("file") or {}).get("content") or "").strip()
            lidos[nome] = conteudo or None
        except ErroGateway as e:
            # Arquivo ausente não é falha da exportação: TOOLS.md e AGENTS.md
            # são opcionais, e SOUL/IDENTITY faltando vira 404 mais adiante.
            logger.info("Arquivo %s de %s não veio do gateway: %s", nome, agent_id, e)
            lidos[nome] = None
    return lidos


@router.get("/{agent_id}/export")
async def exportar(agent_id: str, _: Usuario = Depends(usuario_atual)):
    """Monta o `.dnos` do agente, com os dados da empresa substituídos.

    Era `POST` com o id no corpo; virou `GET` porque é leitura pura e o
    frontend baixa o resultado como arquivo.
    """
    aid = (agent_id or "").strip().lower()
    if not _ID_VALIDO.match(aid):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "agent_id inválido.")

    # ⚠️ **O gateway vem primeiro, e a tabela é só reserva.** A ordem era a
    # inversa, herdada da edge, de quando o gateway não expunha leitura de
    # arquivo e a `agent_files` era a única fonte. Hoje `agents.files.get`
    # funciona e é o disco de verdade; a tabela é um espelho de até 60s de
    # atraso mantido por uma ponte na VPS que, nesta instalação, nunca
    # escreveu nada — está com zero linhas. Perguntar primeiro a ela era
    # consultar um cache vazio para depois fazer a pergunta certa.
    por_nome: dict[str, str | None] = {}
    origem = "gateway"
    try:
        por_nome = dict(await _ler_do_gateway(aid))
    except ErroGateway as e:
        logger.warning("Leitura pelo gateway falhou para %s: %s", aid, e)

    if not por_nome.get("SOUL.md") or not por_nome.get("IDENTITY.md"):
        origem = "bridge"
        async with sessao(role="service_role") as conn:
            linhas = await conn.fetch(
                "SELECT file_name, content FROM public.agent_files "
                "WHERE agent_id = $1 AND file_name = ANY($2::text[])",
                aid, _ARQUIVOS,
            )
        do_espelho = {
            l["file_name"]: (l["content"] or "").strip() or None for l in linhas
        }
        # Preenche só o que faltou: o gateway, quando responde, é a verdade.
        for nome, conteudo in do_espelho.items():
            por_nome[nome] = por_nome.get(nome) or conteudo

    soul, identity = por_nome.get("SOUL.md"), por_nome.get("IDENTITY.md")
    if not soul or not identity:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Não foi possível exportar: SOUL.md/IDENTITY.md deste agente não "
            "foram encontrados. O agente pode não ter terminado o onboarding.",
        )

    async with sessao(role="service_role") as conn:
        perfil_empresa = await conn.fetchrow("SELECT * FROM public.company_profile LIMIT 1")
        agente = await conn.fetchrow(
            "SELECT agent_id, name, role, specialty, department, color, emoji, description "
            "FROM public.agent_profiles WHERE agent_id = $1",
            aid,
        )
        pessoas = await conn.fetch(
            "SELECT full_name FROM public.profiles WHERE full_name IS NOT NULL LIMIT 50"
        )
        skills_bruto = await conn.fetch(
            """
            SELECT s.slug, s.name, s.description, s.content
              FROM public.agent_skills a
              JOIN public.skills s ON s.id = a.skill_id
             WHERE a.agent_id = $1 AND s.content IS NOT NULL AND s.slug IS NOT NULL
            """,
            aid,
        )

    empresa = dict(perfil_empresa) if perfil_empresa else None
    nomes_pessoas = [l["full_name"] for l in pessoas if l["full_name"]]
    c = await cfg.carregar()

    def limpar(texto: str | None) -> str | None:
        if not texto:
            return texto
        t = _restaurar_placeholders(texto, empresa)
        t = _sanitizar_uuids(t)
        return _sanitizar_infra_e_nomes(t, c.url or "", empresa, nomes_pessoas)

    arquivos: dict[str, str] = {}
    for nome in _ARQUIVOS:
        limpo = limpar(por_nome.get(nome))
        if limpo:
            arquivos[nome] = limpo

    # Conectores e capacidades saem do texto **já limpo**: se um conector for
    # citado só dentro de um nome de empresa, ele some junto — e é o certo,
    # porque o `.dnos` não deve carregar dedução sobre dado que foi removido.
    soul_limpo = arquivos.get("SOUL.md", "")
    identity_limpo = arquivos.get("IDENTITY.md", "")

    return {
        # ⚠️ **Os dois nomes saem no arquivo, de propósito.** `hsos_version` é
        # o campo desta plataforma; `dnos_version` fica junto porque um
        # `.hsos` pode acabar sendo aberto por uma instalação que ainda não
        # conhece o nome novo — e ela recusaria o arquivo inteiro por causa de
        # uma chave. Escrever os dois custa uma linha; não escrever custa uma
        # importação que falha sem a pessoa entender por quê.
        #
        # O caminho de volta já é tolerante: quem importa aceita qualquer um
        # dos dois. Quando não houver mais instalação antiga, some daqui.
        "hsos_version": "1.1",
        "dnos_version": "1.1",
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "source": origem,
        "agent": _bloco_agente(dict(agente) if agente else {}, aid),
        "required_connectors": _extrair_conectores(soul_limpo, identity_limpo),
        "capabilities": _extrair_capacidades(soul_limpo),
        "skills": [
            {
                "slug": s["slug"],
                "name": s["name"],
                "description": s["description"] or "",
                # Skill escrita por agente pode citar dados da empresa.
                "content": limpar(s["content"]),
            }
            for s in skills_bruto
        ],
        "files": arquivos,
    }
