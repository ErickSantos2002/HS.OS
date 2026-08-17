"""Skills — o catálogo do gateway e as skills gerenciadas no banco.

Portado de `skill-manage` (647 linhas). São duas coisas diferentes que a tela
mistura, e vale separar antes de ler o resto:

**Catálogo** (`GET /skills/catalogo`) é o que o OpenClaw sabe fazer. Vem do
gateway, é só leitura, e o banco não participa. Hoje são 53 skills reais —
51 embutidas no OpenClaw e 2 extras instaladas na VPS.

**Gerenciadas** (`GET /skills`) são as que *nós* escrevemos: um markdown na
tabela `skills`, ligado a agentes pela `agent_skills`. É a parte com CRUD.

⚠️ **A instalação no gateway mudou de protocolo.** A edge falava REST
(`/skills-api/agents/{id}/skills`, `/admin/agents/{id}/skills`) com três URLs
de fallback — caminhos que hoje devolvem 404 ou o HTML do painel, como todo o
resto da API REST do OpenClaw. O substituto é `skills.install` por JSON-RPC,
levantado em 10/08/2026. Ver `_instalar_no_gateway`.
"""

import logging
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/skills", tags=["skills"])

# ⚠️ **As duas tabelas são só-leitura sob RLS.** `skills` e `agent_skills` têm
# uma única policy cada, `SELECT` para `authenticated` — nenhuma de INSERT,
# UPDATE ou DELETE. Não é descuido: a edge escrevia com a `service_role`, que
# passa por cima do RLS, e a autorização vivia no código dela. Aqui é igual —
# leitura como `authenticated`, escrita como `service_role`, e quem pode o quê
# é decidido nos `Depends` de cada rota. Trocar isso por policies de escrita
# seria melhor, mas é mudança de schema (`003+`), não parte da portagem.

# `source` da tabela `skills`. A edge aceitava qualquer string; aqui a lista é
# fechada porque a tela só sabe desenhar estas quatro.
_FONTES = {"clawhub", "git", "manual", "agent"}


class SkillIn(BaseModel):
    slug: str
    name: str
    description: str | None = None
    content: str
    source: str = "manual"
    source_url: str | None = None
    is_default: bool = False
    agent_ids: list[str] = Field(default_factory=list)


class SkillPatch(BaseModel):
    name: str | None = None
    description: str | None = None
    content: str | None = None
    source_url: str | None = None
    is_default: bool | None = None


class AtribuirIn(BaseModel):
    agent_ids: list[str]


def _validar_slug(slug: str) -> str:
    """O slug vira nome de pasta no workspace do agente.

    Por isso a validação é apertada: qualquer coisa fora de `[a-z0-9-]` pode
    virar travessia de caminho quando o gateway cria o diretório.
    """
    limpo = (slug or "").strip().lower()
    if not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,62}", limpo):
        raise HTTPException(
            400,
            "slug inválido — use letras minúsculas, números e hífen (ex.: 'analise-de-risco')",
        )
    return limpo


# ─────────────────────────── catálogo (gateway) ───────────────────────────


@router.get("/catalogo")
async def catalogo(
    agent_id: str | None = Query(default=None),
    usuario: Usuario = Depends(usuario_atual),
) -> dict:
    """As skills que o OpenClaw realmente tem, para um agente.

    ⚠️ **Isto substitui uma lista inventada.** O `use-skills.ts` trazia 54
    skills escritas à mão no próprio arquivo (`web-search`, `pdf-read`,
    `docker-run`…) como "fallback" — nomes plausíveis que nunca vieram de
    lugar nenhum. Quem lia a tela via um catálogo que não correspondia ao
    gateway: skills que não existem e ausência das que existem.

    O `skills.status` devolve o de verdade, com o que a tela nunca teve:
    `eligible` (se o agente pode usar), `missing` (o que falta instalar na
    VPS) e `disabled`.

    Sem `agent_id` o gateway responde pelo agente padrão dele — o mesmo
    comportamento silencioso do `chat.send`. Mandamos sempre explícito.
    """
    c = await cfg.carregar()
    params: dict[str, Any] = {"agentId": agent_id} if agent_id else {}
    try:
        r = await obter_cliente(c.url, c.token).chamar("skills.status", params)
    except ErroGateway as e:
        raise HTTPException(502, f"gateway recusou skills.status: {e}") from e

    skills = [
        {
            "name": s.get("name"),
            "description": s.get("description"),
            "emoji": s.get("emoji"),
            "homepage": s.get("homepage"),
            # "openclaw-bundled" vira "built-in" para a tela não precisar
            # aprender o vocabulário do gateway.
            "type": "built-in" if s.get("bundled") else "custom",
            "source": s.get("source"),
            "eligible": bool(s.get("eligible")),
            "disabled": bool(s.get("disabled")),
            # O que impede o uso, quando impede. Três motivos distintos no
            # gateway; a tela só precisa saber que está bloqueado e por quê.
            "bloqueio": (
                "plataforma incompatível"
                if s.get("platformIncompatible")
                else "fora da allowlist"
                if s.get("blockedByAllowlist")
                else "não liberada para este agente"
                if s.get("blockedByAgentFilter")
                else None
            ),
            "missing": s.get("missing") or [],
        }
        for s in r.get("skills", [])
    ]
    return {
        "agentId": r.get("agentId"),
        "skillsDir": r.get("managedSkillsDir"),
        "skills": skills,
    }


# ─────────────────────────── gerenciadas (banco) ───────────────────────────


async def _listar(conn, agent_id: str | None) -> list[dict]:
    if agent_id:
        linhas = await conn.fetch(
            """
            SELECT s.*, a.installed_by, a.sync_status AS link_sync_status, a.sync_error
              FROM public.agent_skills a
              JOIN public.skills s ON s.id = a.skill_id
             WHERE a.agent_id = $1
             ORDER BY s.name
            """,
            agent_id,
        )
        return [dict(x) for x in linhas]

    # Uma query só, com os vínculos e o nome do agente já agregados. A edge
    # fazia três idas ao banco (skills, agent_skills embutido, agent_profiles
    # por `.in()`) para montar exatamente isto.
    linhas = await conn.fetch(
        """
        SELECT s.*,
               COALESCE(
                 (SELECT json_agg(json_build_object(
                           'agent_id',     a.agent_id,
                           'installed_by', a.installed_by,
                           'sync_status',  a.sync_status,
                           'sync_error',   a.sync_error,
                           'agent', json_build_object(
                              'name',       COALESCE(p.name, a.agent_id),
                              'avatar_url', p.avatar_url)))
                    FROM public.agent_skills a
                    LEFT JOIN public.agent_profiles p ON p.agent_id = a.agent_id
                   WHERE a.skill_id = s.id),
                 '[]'::json) AS agent_skills
          FROM public.skills s
         ORDER BY s.created_at DESC
        """
    )
    return [dict(x) for x in linhas]


# De onde uma skill vem. A tela precisa disto para saber o que pode oferecer:
# só a `plataforma` é editável, porque só ela tem linha no banco.
ORIGEM_PLATAFORMA = "plataforma"    # criada por esta tela, mora em `public.skills`
ORIGEM_REPOSITORIO = "repositorio"  # mora em `skills/<slug>/SKILL.md`, no nosso git
ORIGEM_VPS = "vps"                  # plugin instalado na VPS, fora do repositório
ORIGEM_OPENCLAW = "openclaw"        # embutida no OpenClaw

# `source` do `skills.status` → nossa origem.
#
# ⚠️ **`openclaw-extra` NÃO é nossa.** São plugins em
# `/root/.openclaw/plugin-skills/` (hoje `browser-automation` e `canvas`),
# instalados na VPS e ausentes do nosso repositório. Tratá-los como
# `repositorio` fazia a tela mandar editar `skills/canvas/SKILL.md`, arquivo
# que não existe aqui. Só `openclaw-managed` vem do `publicar-skills.sh`.
_FONTE_GATEWAY = {
    "openclaw-managed": ORIGEM_REPOSITORIO,
    "openclaw-extra": ORIGEM_VPS,
    "openclaw-bundled": ORIGEM_OPENCLAW,
}


@router.get("")
async def listar(
    agent_id: str | None = Query(default=None),
    usuario: Usuario = Depends(usuario_atual),
) -> list[dict]:
    """As skills gerenciadas **mais** as que existem de fato no gateway.

    ⚠️ **A tabela `skills` está zerada e a página mostrava nada** enquanto o
    gateway tinha 55 — 51 embutidas e 4 nossas, entre elas a `faturamento`, que
    é justamente a que tira 48% de erro do número que vai para a diretoria.
    Levantado em 17/08/2026.

    ⚠️ **Só a origem `plataforma` é editável, e isso é o ponto do campo
    `origem`.** As outras não têm linha em `public.skills`: oferecer "editar" ou
    "excluir" nelas produziria 404 — trocaria uma tela vazia por uma tela que
    mente, que é pior.

    ⚠️ **`repositorio` é só-leitura por decisão, não por limitação.** Essas
    skills moram em `skills/<slug>/SKILL.md` e chegam à VPS por
    `scripts/publicar-skills.sh --enviar`. Editá-las pela tela criaria uma
    segunda fonte de verdade que a próxima publicação sobrescreve **em
    silêncio** — e o conteúdo delas é código disfarçado de texto: a
    `faturamento` carrega o SQL que vira número para a diretoria, e isso merece
    revisão e histórico.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        gerenciadas = await _listar(conn, agent_id)
    for s in gerenciadas:
        s["origem"] = ORIGEM_PLATAFORMA
        s["somente_leitura"] = False

    conhecidos = {str(s.get("slug") or s.get("name")) for s in gerenciadas}
    return gerenciadas + await _skills_do_gateway(agent_id, conhecidos)


_SLUG_OK = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def _dir_das_skills() -> Path:
    """Onde estão os `SKILL.md` do repositório.

    ⚠️ **A imagem do backend não os carrega hoje.** O Dockerfile faz `COPY . .`
    com contexto `backend/`, e `skills/` está na raiz do repositório — então em
    produção este diretório não existe e a leitura devolve 404 explicando. Em
    desenvolvimento funciona direto. Resolver isso é mudar o contexto do build
    ou montar um volume; está anotado em `docs/CONTINUAR-AQUI.md`.
    """
    if env := os.environ.get("SKILLS_DIR"):
        return Path(env)
    # backend/app/routers/skills.py → raiz do repositório
    return Path(__file__).resolve().parents[3] / "skills"


@router.get("/{slug}/conteudo")
async def conteudo(slug: str, _: Usuario = Depends(exige_papel("administrador"))) -> dict:
    """O markdown inteiro de uma skill do repositório.

    ⚠️ **O gateway não tem por onde entregar isto.** `skills.read`, `skills.get`,
    `skills.show` e `skills.content` não existem; `skills.status` não aceita
    conteúdo; e `agents.workspace.get` recusa o caminho com "path escapes the
    agent workspace" — trava correta, aliás. Levantado em 17/08/2026.

    Por isso lemos do nosso próprio repositório, que é a fonte de verdade dessas
    skills de qualquer forma. As embutidas do OpenClaw **não** têm conteúdo
    recuperável por lugar nenhum, e a tela mostra só os metadados delas.
    """
    # `slug` vem da URL e vira caminho: sem esta validação, `../../etc/passwd`
    # sai daqui como arquivo lido.
    if not _SLUG_OK.match(slug):
        raise HTTPException(400, "Slug inválido.")

    raiz = _dir_das_skills()
    arquivo = raiz / slug / "SKILL.md"
    # Cinto e suspensório: mesmo com o slug validado, conferir que o caminho
    # resolvido continua dentro da raiz.
    try:
        arquivo.resolve().relative_to(raiz.resolve())
    except (ValueError, OSError):
        raise HTTPException(400, "Caminho fora do diretório de skills.")

    if not arquivo.is_file():
        raise HTTPException(
            404,
            f'A skill "{slug}" não está em {raiz}. Skills embutidas do OpenClaw '
            "não têm conteúdo recuperável, e em produção o diretório do "
            "repositório ainda não é enviado para a imagem do backend.",
        )
    return {"slug": slug, "arquivo": str(arquivo), "conteudo": arquivo.read_text(encoding="utf-8")}


class AgentesDaSkill(BaseModel):
    agent_ids: list[str]


@router.put("/{slug}/agentes")
async def definir_agentes(
    slug: str,
    dados: AgentesDaSkill,
    _: Usuario = Depends(exige_papel("administrador")),
) -> dict:
    """Quais agentes podem usar esta skill. Lista vazia = desativada para todos.

    O mecanismo é `agents.list[].skills`, a allowlist **por agente**. A tela
    pensa por skill; a conversão para lista por agente é feita aqui.

    ⚠️ **"Sem lista" significa TODAS, e lista explícita substitui tudo.** É a
    armadilha central: escrever `skills: ["faturamento"]` num agente não
    acrescenta a `faturamento` — deixa esse agente **só** com ela, tirando as
    outras 54. Por isso o que se calcula aqui é o conjunto de **exclusões**, e a
    lista gravada é *todas menos as excluídas*.

    ⚠️ **E por isso a chave é apagada quando não há exclusão nenhuma.** Um
    agente com lista explícita fica **congelado**: skill nova que o OpenClaw
    trouxer numa atualização não chega nele, porque não está na lista. Manter o
    agente sem a chave enquanto ele pode usar tudo evita congelar quem não
    precisa estar restrito.
    """
    if not _SLUG_OK.match(slug):
        raise HTTPException(400, "Slug inválido.")

    from app.gateway import patch as patch_gw

    parsed, base_hash = await patch_gw.config_do_gateway()
    lista = (parsed.get("agents") or {}).get("list") or []
    if not lista:
        raise HTTPException(502, "O gateway não devolveu nenhum agente.")

    ids = {str(a.get("id")) for a in lista if a.get("id")}
    desconhecidos = [a for a in dados.agent_ids if a not in ids]
    if desconhecidos:
        raise HTTPException(400, f"Agente(s) inexistente(s): {', '.join(desconhecidos)}")

    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)

    nova_lista, alvo = [], {}
    for a in lista:
        aid = str(a.get("id"))
        # Todas as skills que ESTE agente enxerga. É o universo do "todas menos
        # as excluídas" — e ele é por agente porque `skills.status` é por agente.
        try:
            r = await cli.chamar("skills.status", {"agentId": aid})
            todas = [str(s.get("name")) for s in ((r.get("payload") or r).get("skills") or []) if s.get("name")]
        except ErroGateway as e:
            raise HTTPException(502, f"skills.status falhou para {aid}: {e}")

        atual = a.get("skills")
        excluidas = set(todas) - set(atual) if isinstance(atual, list) else set()
        if aid in dados.agent_ids:
            excluidas.discard(slug)
        elif slug in todas:
            excluidas.add(slug)

        novo = dict(a)
        # ⚠️ **`None` explícito, não `pop`.** Em JSON Merge Patch, chave ausente
        # significa "não mexe" e só `null` apaga — e o gateway mescla cada item
        # de `agents.list` em vez de substituí-lo. Com `pop`, o patch era aceito
        # e a lista velha continuava lá: o agente ficava restrito para sempre,
        # sem jeito de voltar pela tela. Custou um `atlas` preso em 54 skills
        # em 17/08/2026, e só apareceu porque o teste restaurava no fim.
        novo["skills"] = sorted(set(todas) - excluidas) if excluidas else None
        alvo[aid] = novo["skills"]
        nova_lista.append(novo)

    def conferir(cf: dict) -> bool:
        viva = {str(x.get("id")): x.get("skills") for x in ((cf.get("agents") or {}).get("list") or [])}
        if set(viva) != set(alvo):
            return False
        return all(
            (viva[i] is None and alvo[i] is None)
            or (viva[i] is not None and alvo[i] is not None and set(viva[i]) == set(alvo[i]))
            for i in alvo
        )

    # ⚠️ `agents.list` é array: merge patch substitui o array inteiro, então a
    # lista vai completa, com os agentes não alterados preservados.
    await patch_gw.aplicar_patch({"agents": {"list": nova_lista}}, base_hash, conferir)

    logger.info("Skill %s liberada para %s", slug, dados.agent_ids or "(ninguém)")
    return {
        "ok": True,
        "slug": slug,
        "agentes": sorted(dados.agent_ids),
        "restritos": sorted(i for i, v in alvo.items() if v is not None),
    }


async def _skills_do_gateway(agent_id: str | None, ignorar: set[str]) -> list[dict]:
    """O que o gateway realmente tem, no formato que a tela já sabe desenhar.

    `ignorar` são os slugs que já vieram do banco: skill gerenciada que também
    está instalada apareceria duas vezes, e a linha do banco é a que tem CRUD.
    """
    try:
        c = await cfg.carregar()
        cli = obter_cliente(c.url, c.token)
    except Exception as e:  # noqa: BLE001
        logger.warning("Gateway indisponível ao listar skills: %s", e)
        return []

    # Quais agentes perguntar. `skills.status` é por agente — é assim que se
    # sabe quem enxerga o quê quando houver `agents.list[].skills` preenchido.
    if agent_id:
        alvos = [agent_id]
    else:
        try:
            r = await cli.chamar("agents.list", {})
            alvos = [a.get("id") for a in ((r.get("payload") or r).get("agents") or []) if a.get("id")]
        except ErroGateway as e:
            logger.warning("agents.list falhou ao listar skills: %s", e)
            return []

    async with sessao(role="service_role") as conn:
        nomes = {
            x["agent_id"]: (x["name"], x["avatar_url"])
            for x in await conn.fetch(
                "SELECT agent_id, name, avatar_url FROM public.agent_profiles"
            )
        }

    por_slug: dict[str, dict] = {}
    for alvo in alvos:
        try:
            r = await cli.chamar("skills.status", {"agentId": alvo})
        except ErroGateway as e:
            logger.warning("skills.status falhou para %s: %s", alvo, e)
            continue
        for s in ((r.get("payload") or r).get("skills") or []):
            slug = str(s.get("name") or "")
            if not slug or slug in ignorar:
                continue
            item = por_slug.get(slug)
            if item is None:
                origem = _FONTE_GATEWAY.get(str(s.get("source")), ORIGEM_OPENCLAW)
                item = por_slug[slug] = {
                    "id": f"gateway:{slug}",
                    "slug": slug,
                    "name": slug,
                    "emoji": s.get("emoji"),
                    "description": s.get("description"),
                    # O conteúdo mora em arquivo na VPS; a tela mostra o caminho
                    # em vez de fingir que tem o markdown.
                    "content": "",
                    "arquivo": s.get("filePath"),
                    "source": s.get("source"),
                    "source_url": s.get("homepage"),
                    "version": "",
                    # `always: true` é a skill que entra no contexto sempre — o
                    # equivalente ao "padrão" da tela.
                    "is_default": bool(s.get("always")),
                    "sync_status": "synced",
                    "created_at": None,
                    "origem": origem,
                    "somente_leitura": True,
                    "agent_skills": [],
                }
            # ⚠️ **`modelVisible` é o campo, não `eligible`.** Foram dois erros
            # seguidos aqui, e vale guardar os dois:
            #
            # 1. Montar o booleano à mão com `disabled or missing or …` marcava
            #    TUDO como inativo, porque `missing` não é flag — é um dict, e
            #    dict vazio é verdadeiro em Python.
            # 2. Trocar para `eligible` consertou o caso 1 e errou este: com a
            #    skill bloqueada pela allowlist do agente, `eligible` continua
            #    **true** e quem muda é `blockedByAgentFilter`/`modelVisible`.
            #    A tela dizia que `criar-agente` valia para os três agentes no
            #    mesmo dia em que a `iris` respondeu "NÃO" quando perguntada.
            #
            # `modelVisible` é a pergunta que a tela faz: o agente vê a skill?
            if s.get("modelVisible"):
                nome, avatar = nomes.get(alvo, (alvo, None))
                item["agent_skills"].append({
                    "agent_id": alvo,
                    "installed_by": "sync",
                    "sync_status": "synced",
                    "sync_error": None,
                    "agent": {"name": nome, "avatar_url": avatar},
                })

    return sorted(
        por_slug.values(),
        # As nossas primeiro; entre iguais, por nome.
        key=lambda x: (x["origem"] != ORIGEM_REPOSITORIO, x["name"].lower()),
    )


async def _instalar_no_gateway(agent_id: str, slug: str, fonte: str, url: str | None) -> dict:
    """Instala a skill no workspace do agente.

    ⚠️ **O caminho feliz nunca rodou.** O que foi confirmado em 10/08/2026,
    contra um `agentId` inexistente, é o formato: `{agentId, slug, source}`
    atravessa a validação de schema e morre depois, em `unknown agent id` —
    ou seja, o payload está certo e o que faltou foi um alvo real. Instalar
    de verdade é escrita no gateway de produção e não se sonda sozinho; está
    na lista de "fazer junto" do `TESTAR-SEGUNDA.md`.

    O primeiro palpite era `{name, source}`, pelo erro de params vazios. Ele
    é recusado: a mensagem completa mostra um `anyOf` com mais de um formato,
    e `name` pertence a outro ramo.

    Falhar aqui não desfaz o banco: a skill fica gravada com
    `sync_status='error'` e a tela mostra o motivo, que é como a edge se
    comportava. Perder o markdown escrito porque a VPS estava fora seria pior.
    """
    c = await cfg.carregar()
    params: dict[str, Any] = {"agentId": agent_id, "slug": slug, "source": fonte}
    if url:
        params["url"] = url
    try:
        await obter_cliente(c.url, c.token).chamar("skills.install", params)
        return {"ok": True}
    except ErroGateway as e:
        logger.warning("skills.install falhou agent=%s slug=%s: %s", agent_id, slug, e)
        return {"ok": False, "error": str(e)}


async def _sincronizar(conn, skill_id: str, slug: str, fonte: str, url: str | None,
                       agent_ids: list[str], quem: str) -> dict:
    """Grava os vínculos e tenta instalar em cada agente."""
    resultado: dict[str, dict] = {}
    for agent_id in agent_ids:
        r = await _instalar_no_gateway(agent_id, slug, fonte, url)
        await conn.execute(
            """
            INSERT INTO public.agent_skills
                   (agent_id, skill_id, installed_by, sync_status, sync_error)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (agent_id, skill_id) DO UPDATE
               SET sync_status = EXCLUDED.sync_status,
                   sync_error  = EXCLUDED.sync_error
            """,
            agent_id, skill_id, quem,
            "synced" if r["ok"] else "error",
            None if r["ok"] else r.get("error"),
        )
        resultado[agent_id] = r
    return resultado


@router.post("", status_code=201)
async def criar(dados: SkillIn, usuario: Usuario = Depends(usuario_atual)) -> dict:
    slug = _validar_slug(dados.slug)
    if dados.source not in _FONTES:
        raise HTTPException(400, f"source deve ser um de: {', '.join(sorted(_FONTES))}")
    if not dados.content.strip():
        raise HTTPException(400, "content é obrigatório — a skill é o markdown")

    async with sessao(role="service_role") as conn:
        existe = await conn.fetchval("SELECT id FROM public.skills WHERE slug = $1", slug)
        if existe:
            raise HTTPException(409, f"já existe uma skill com o slug '{slug}'")

        skill_id = await conn.fetchval(
            """
            INSERT INTO public.skills
                   (slug, name, description, content, source, source_url, is_default, sync_status)
            VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
            RETURNING id
            """,
            slug, dados.name, dados.description, dados.content,
            dados.source, dados.source_url, dados.is_default,
        )
        sync = await _sincronizar(
            conn, skill_id, slug, dados.source, dados.source_url, dados.agent_ids, "user"
        )
        # A skill fica "synced" só quando todo mundo aceitou. Com um agente
        # fora, o estado honesto é "error" — a tela precisa saber que há
        # alguém dessincronizado, não a média.
        todos_ok = all(v["ok"] for v in sync.values()) if sync else True
        await conn.execute(
            "UPDATE public.skills SET sync_status = $2, last_synced_at = now() WHERE id = $1",
            skill_id, "synced" if todos_ok else "error",
        )
    return {"skillId": str(skill_id), "sync": sync}


@router.patch("/{skill_id}")
async def editar(skill_id: str, dados: SkillPatch,
                 usuario: Usuario = Depends(usuario_atual)) -> dict:
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(400, "nada para atualizar")

    async with sessao(role="service_role") as conn:
        atual = await conn.fetchrow(
            "SELECT slug, source, source_url FROM public.skills WHERE id = $1", skill_id
        )
        if not atual:
            raise HTTPException(404, "skill não encontrada")

        sets = ", ".join(f"{k} = ${i}" for i, k in enumerate(campos, start=2))
        await conn.execute(
            f"UPDATE public.skills SET {sets}, updated_at = now() WHERE id = $1",
            skill_id, *campos.values(),
        )

        # Mudou o conteúdo → o que está nos agentes ficou velho. Reinstala em
        # todos os que já a tinham, sem precisar de nova atribuição.
        sync: dict[str, dict] = {}
        if "content" in campos:
            agentes = [
                r["agent_id"] for r in await conn.fetch(
                    "SELECT agent_id FROM public.agent_skills WHERE skill_id = $1", skill_id
                )
            ]
            sync = await _sincronizar(
                conn, skill_id, atual["slug"], atual["source"], atual["source_url"],
                agentes, "sync",
            )
    return {"ok": True, "sync": sync}


@router.post("/{skill_id}/agentes")
async def atribuir(skill_id: str, dados: AtribuirIn,
                   usuario: Usuario = Depends(usuario_atual)) -> dict:
    async with sessao(role="service_role") as conn:
        s = await conn.fetchrow(
            "SELECT slug, source, source_url FROM public.skills WHERE id = $1", skill_id
        )
        if not s:
            raise HTTPException(404, "skill não encontrada")
        sync = await _sincronizar(
            conn, skill_id, s["slug"], s["source"], s["source_url"], dados.agent_ids, "user"
        )
    return {"ok": True, "sync": sync}


@router.put("/por-slug/{slug}")
async def upsert(slug: str, dados: SkillIn,
                 usuario: Usuario = Depends(usuario_atual)) -> dict:
    """Cria ou atualiza pelo slug, e vincula a um agente.

    É o caminho da **importação de agente**: um `.dnos` traz as skills do
    agente exportado embutidas, e importar duas vezes não pode duplicar nem
    falhar. `source` fica `'agent'` — veio de um pacote, não de alguém
    escrevendo no editor.

    O vínculo entra como `synced` sem consultar o gateway, e isso é do
    original: os arquivos do agente importado já foram gravados pelo passo
    anterior da importação, então a skill *está* lá. Chamar `skills.install`
    aqui reinstalaria por cima do que acabou de ser escrito.
    """
    slug = _validar_slug(slug)
    if not dados.agent_ids:
        raise HTTPException(400, "agent_ids é obrigatório no upsert")

    async with sessao(role="service_role") as conn:
        skill_id = await conn.fetchval(
            """
            INSERT INTO public.skills (slug, name, description, content, source, sync_status)
            VALUES ($1, $2, $3, $4, 'agent', 'synced')
            ON CONFLICT (slug) DO UPDATE
               SET name = EXCLUDED.name,
                   description = EXCLUDED.description,
                   content = EXCLUDED.content,
                   updated_at = now()
            RETURNING id
            """,
            slug, dados.name, dados.description or "", dados.content,
        )
        for agent_id in dados.agent_ids:
            await conn.execute(
                """
                INSERT INTO public.agent_skills
                       (agent_id, skill_id, installed_by, sync_status)
                VALUES ($1, $2, 'agent', 'synced')
                ON CONFLICT (agent_id, skill_id) DO UPDATE
                   SET sync_status = 'synced', sync_error = NULL
                """,
                agent_id, skill_id,
            )
    return {"ok": True, "skillId": str(skill_id)}


@router.delete("/{skill_id}/agentes/{agent_id}")
async def desatribuir(skill_id: str, agent_id: str,
                      usuario: Usuario = Depends(usuario_atual)) -> dict:
    """Tira a skill de um agente.

    Só o vínculo — a skill continua existindo e nos outros agentes. Como o
    gateway não tem desinstalação (ver `excluir`), o arquivo permanece no
    workspace; o que muda é que a tela para de listá-la para este agente.
    """
    async with sessao(role="service_role") as conn:
        apagou = await conn.execute(
            "DELETE FROM public.agent_skills WHERE skill_id = $1 AND agent_id = $2",
            skill_id, agent_id,
        )
    if apagou.endswith(" 0"):
        raise HTTPException(404, "este agente não tem esta skill")
    return {"ok": True}


@router.delete("/{skill_id}")
async def excluir(skill_id: str,
                  usuario: Usuario = Depends(exige_papel("administrador"))) -> dict:
    """Apagar é ato de administrador, pela interface.

    A regra vem da edge e o comentário de lá explica: nem membro comum, nem
    agente com o token de sync. O sync cria e atualiza; apagar o conhecimento
    da rede é decisão humana.

    ⚠️ **O gateway não tem desinstalação.** `skills.uninstall`, `.remove` e
    `.delete` respondem `unknown method` (sondado em 10/08/2026). A edge
    chamava `DELETE` nas URLs REST, que hoje são 404 — ou seja, também não
    desinstalava. Apagamos o registro e os vínculos; o arquivo continua no
    workspace do agente até alguém removê-lo na VPS.
    """
    async with sessao(role="service_role") as conn:
        alvo = await conn.fetchval("SELECT slug FROM public.skills WHERE id = $1", skill_id)
        if not alvo:
            raise HTTPException(404, "skill não encontrada")
        await conn.execute("DELETE FROM public.agent_skills WHERE skill_id = $1", skill_id)
        await conn.execute("DELETE FROM public.skills WHERE id = $1", skill_id)
    return {"ok": True, "aviso": "removida do sistema; o arquivo no workspace do agente permanece"}
