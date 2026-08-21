"""Agentes — junção do banco com o gateway.

A lista de agentes tem **duas fontes**, e nenhuma basta sozinha:

- `public.agent_profiles` — metadados (nome de exibição, emoji, avatar, modelo,
  departamento) e o controle de acesso por usuário
- `agents.list` do gateway — quais agentes existem de fato

O código herdado fazia essa junção **no navegador**, e para isso precisava do
`admin_token` no cliente. Aqui ela acontece no servidor, que é o que permitiu
tirar o token do front (ver Lote 1 em `docs/ROADMAP.md`).

Um agente que existe no banco e não no gateway aparece como inativo, em vez de
sumir da lista: desaparecer sem explicação é pior do que aparecer apagado.

Os campos saem em camelCase, diferente do resto da API, porque este endpoint
existe para alimentar o `GatewayAgent` do frontend — traduzir aqui evita uma
camada de renomeação em `use-agents.ts`.
"""

import json
import logging
import re
from datetime import datetime, timedelta, timezone
import asyncio
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, exige_papel, usuario_atual
from app.gateway import config as cfg
from app.gateway.client import ErroGateway, obter_cliente

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["agents"])


class AgenteOut(BaseModel):
    id: str
    name: str
    status: str = "inactive"  # active | inactive
    model: str = ""
    channels: list[str] = []
    systemPrompt: str = ""
    tokensUsed: int = 0
    sessions: int = 0
    lastActive: str | None = None
    lastChannel: str = ""
    # Metadados que só existem em agent_profiles
    emoji: str | None = None
    avatarUrl: str | None = None
    department: str | None = None
    description: str | None = None
    specialty: str | None = None
    workspace: str | None = None
    isLeader: bool = False
    # ⚠️ Quem alcança este agente. O mapa neural desenhava TODA pessoa ligada ao
    # centro, porque não tinha esta informação — o que mostrava 26 linhas iguais
    # e escondia o que interessa: cada agente atende um grupo diferente.
    accessType: str = "all"
    allowedUserIds: list[str] = []
    # Quem lidera este agente. Vem na lista porque a tela de liderança precisa do
    # estado de **todos** para regravá-lo em lote sem apagar o dos outros.
    leaderId: str | None = None
    # Id no gateway quando difere do `agent_id`. A tela de usuários mostra os dois
    # e o drawer usava o `openclaw_id` como chave em algumas chamadas.
    openclawId: str | None = None
    # `status` acima é liveness do gateway (existe em `agents.list` ou não).
    # Este é o status gravado em `agent_profiles` — active | inactive |
    # configuring — e são coisas diferentes: um agente pode estar `configuring`
    # no banco e já responder no gateway. A tela de administração precisa deste.
    profileStatus: str = "active"
    isOfficial: bool = False
    color: str | None = None
    # Ordem de exibição no catálogo. Sai do banco porque a ordem é curadoria —
    # ordenar por nome faria o líder aparecer no meio da lista.
    sortOrder: int | None = None


class ListaAgentesOut(BaseModel):
    agents: list[AgenteOut]
    defaultId: str | None = None
    # Falso quando o gateway não respondeu: a tela mostra os metadados do banco
    # e avisa que o estado ao vivo não pôde ser confirmado, em vez de mentir
    # que todos estão inativos.
    gatewayOnline: bool = True
    gatewayErro: str | None = Field(default=None)


def _pode_ver(perfil: dict, user_id: str, is_admin: bool) -> bool:
    """Controle de acesso herdado de `agent_profiles.access_type`.

    `all` libera; `admins_only` restringe a administrador; `specific_users` exige
    estar em `allowed_user_ids`. Admin passa por cima de tudo — era assim no
    código herdado e mudar isso aqui seria mudança de produto, não de portagem.
    """
    if is_admin:
        return True
    tipo = perfil.get("access_type") or "all"
    if tipo == "all":
        return True
    if tipo == "admins_only":
        return False
    if tipo == "specific_users":
        permitidos = perfil.get("allowed_user_ids") or []
        return user_id in [str(u) for u in permitidos]
    return True


@router.get("", response_model=ListaAgentesOut)
async def listar(
    usuario: Usuario = Depends(usuario_atual),
    incluir_inativos: bool = False,
):
    """`incluir_inativos` existe para a tela de administração de usuários, que
    precisa enxergar o agente desativado — é de lá que se reativa. As telas de
    uso normal (chat, lista de agentes) continuam sem ver inativo, que era o
    comportamento herdado."""
    is_admin = usuario.papel == "administrador"

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT p.agent_id, p.name, p.emoji, p.avatar_url, p.model, p.channels,
                   p.status, p.access_type, p.allowed_user_ids, p.department,
                   p.description, p.specialty, p.workspace, p.is_leader,
                   p.leader_id, p.is_official, p.color, p.sort_order,
                   p.openclaw_id,
                   -- Presença: a tela derivava online/recente/offline da distância
                   -- até `latest_updated_at`. Sem este join todo mundo apareceria
                   -- offline.
                   to_char(s.latest_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS last_active
              FROM public.agent_profiles p
              LEFT JOIN public.agent_stats s ON s.agent_id = p.agent_id
             WHERE ($1::bool OR p.status IS DISTINCT FROM 'inactive')
             ORDER BY p.sort_order NULLS LAST, p.name
            """,
            incluir_inativos,
        )

    perfis: dict[str, dict] = {}
    for l in linhas:
        d = dict(l)
        aid = (d.get("agent_id") or "").strip()
        if aid and _pode_ver(d, usuario.id, is_admin):
            perfis[aid] = d

    # Estado ao vivo. Falha aqui não derruba a lista — sem o gateway ainda dá
    # para mostrar quem existe, só não dá para dizer quem está de pé.
    vivos: dict[str, dict] = {}
    default_id = None
    online = True
    erro = None
    try:
        c = await cfg.carregar()
        if not c.configurado:
            raise ErroGateway("Gateway não configurado.")
        payload = await obter_cliente(c.url, c.token).chamar("agents.list")
        default_id = payload.get("defaultId")
        for a in payload.get("agents") or []:
            aid = (a.get("id") or "").strip()
            if aid:
                vivos[aid] = a
    except ErroGateway as e:
        online = False
        erro = str(e)
        logger.warning("agents.list falhou: %s", e)

    saida: list[AgenteOut] = []
    for aid in {**{k: None for k in vivos}, **{k: None for k in perfis}}:
        # Agente vivo no gateway mas sem perfil ainda não é erro: aparece com o
        # que o gateway sabe, e o perfil pode ser criado depois.
        if aid not in perfis and aid not in vivos:
            continue
        if aid in vivos and aid not in perfis and not is_admin:
            # Sem perfil não há como avaliar access_type; só admin enxerga.
            continue

        p = perfis.get(aid) or {}
        g = vivos.get(aid) or {}

        saida.append(
            AgenteOut(
                id=aid,
                name=p.get("name") or g.get("name") or aid,
                status="active" if aid in vivos else "inactive",
                model=p.get("model") or "",
                channels=[str(ch) for ch in (p.get("channels") or [])],
                emoji=p.get("emoji"),
                avatarUrl=p.get("avatar_url"),
                department=p.get("department"),
                description=p.get("description"),
                specialty=p.get("specialty"),
                workspace=g.get("workspace") or p.get("workspace"),
                isLeader=bool(p.get("is_leader")),
                accessType=p.get("access_type") or "all",
                allowedUserIds=[str(u) for u in (p.get("allowed_user_ids") or [])],
                leaderId=p.get("leader_id"),
                openclawId=p.get("openclaw_id") or aid,
                lastActive=p.get("last_active"),
                profileStatus=p.get("status") or "active",
                isOfficial=bool(p.get("is_official")),
                sortOrder=p.get("sort_order"),
                color=p.get("color"),
            )
        )

    saida.sort(key=lambda a: (a.status != "active", a.name.lower()))
    return ListaAgentesOut(
        agents=saida, defaultId=default_id, gatewayOnline=online, gatewayErro=erro
    )


class PerfilCompletoOut(BaseModel):
    """Perfil inteiro de um agente — o que a tela de edição precisa.

    Separado do `AgenteOut` da lista de propósito: a lista carrega 5 agentes e
    não deveria arrastar persona, skills e crons de cada um. Aqui vem tudo,
    porque é uma tela por vez.
    """

    agent_id: str
    name: str = ""
    emoji: str | None = None
    specialty: str | None = None
    model: str | None = None
    persona_description: str | None = None
    skills_description: str | None = None
    skills_tags: list[str] = []
    crons_description: str | None = None
    description: str | None = None
    department: str | None = None
    color: str | None = None
    avatar_url: str | None = None
    workspace: str | None = None
    is_leader: bool = False
    leader_id: str | None = None
    access_type: str = "all"
    allowed_user_ids: list[str] = []
    status: str = "active"
    openclaw_id: str | None = None
    role: str | None = None
    behavior: str | None = None
    tts_voice_id: str | None = None
    tts_voice_name: str | None = None


@router.get("/resultados")
async def resultados(
    usuario: Usuario = Depends(usuario_atual),
    agent_id: str | None = Query(default=None),
    category: str | None = Query(default=None),
    desde: str | None = Query(default=None, description="ISO-8601."),
    limite: int = Query(default=200, ge=1, le=2000),
    inicio: int = Query(default=0, ge=0, description="Deslocamento, para paginar."),
    apenas_contagem: bool = Query(default=False, description="Devolve só `{count}`."),
):
    """Os resultados registrados pelos agentes.

    ⚠️ **Dois segmentos** (`/agents/resultados`) seria engolido por
    `GET /agents/{agent_id}` — por isso este caminho e não `/agents/{id}/…`
    para a listagem geral. A por agente usa o filtro.
    """
    condicoes, args = ["true"], []
    for coluna, valor in (("agent_id", agent_id), ("category", category)):
        if valor:
            args.append(valor)
            condicoes.append(f"{coluna} = ${len(args)}")
    if desde:
        args.append(desde)
        condicoes.append(f"created_at >= ${len(args)}::text::timestamptz")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        if apenas_contagem:
            # `head: true` do Supabase virava um COUNT sem trazer linha. Aqui é
            # explícito: a tela do painel só quer o número do dia.
            total = await conn.fetchval(
                f"SELECT count(*) FROM public.agent_results WHERE {' AND '.join(condicoes)}",
                *args,
            )
            return {"count": total}

        linhas = await conn.fetch(
            f"SELECT {_COLUNAS_RESULTADO} FROM public.agent_results "
            f" WHERE {' AND '.join(condicoes)} ORDER BY created_at DESC "
            f" LIMIT ${len(args) + 1} OFFSET ${len(args) + 2}",
            *args, limite, inicio,
        )
    return [_resultado(l) for l in linhas]


class ResultadoIn(BaseModel):
    agent_id: str = Field(min_length=1)
    title: str = Field(min_length=1)
    description: str | None = None
    category: str | None = None
    value: float | None = None
    metadata: dict = {}


@router.post("/resultados", status_code=status.HTTP_201_CREATED)
async def registrar_resultado(dados: ResultadoIn, usuario: Usuario = Depends(usuario_atual)):
    """Registra um resultado **em nome da pessoa**.

    ⚠️ Não confundir com `POST /broadcast/resultado`, que é o caminho do agente e
    autentica por segredo compartilhado. Aqui o `user_id` sai do token.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            f"""
            INSERT INTO public.agent_results
                (agent_id, title, description, category, value, metadata, user_id)
            VALUES ($1,$2,$3,$4,$5,$6::text::jsonb,$7::uuid)
            RETURNING {_COLUNAS_RESULTADO}
            """,
            dados.agent_id, dados.title, dados.description, dados.category,
            dados.value, json.dumps(dados.metadata), usuario.id,
        )
    return _resultado(linha)


@router.delete("/resultados/{resultado_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_resultado(resultado_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.agent_results WHERE id = $1::uuid", resultado_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Resultado não encontrado.")


@router.get("/{agent_id}/atividade-recente")
async def atividade_recente(
    agent_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
    limite: int = Query(default=60, ge=1, le=200),
):
    """As últimas conversas deste agente, **com quem quer que tenha sido**.

    ⚠️ É a única leitura de `conversations` que **não** é escopada ao usuário do
    token: o painel do agente mostra quem falou com ele, e limitar a "minhas
    conversas" faria a tela dizer que ninguém usou um agente que a equipe inteira
    usa. Roda como `authenticated`, então o RLS ainda decide o que aparece.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT user_id::text AS user_id, content,
                   to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
              FROM public.conversations
             WHERE agent_id = $1
             ORDER BY created_at DESC
             LIMIT $2
            """,
            agent_id, limite,
        )
    return [dict(l) for l in linhas]


@router.get("/atividades/registro")
async def registro_de_atividades(
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=20, ge=1, le=200),
):
    """O feed geral de atividade dos agentes, do mais recente para o mais antigo.

    ⚠️ Dois segmentos porque `/agents/{agent_id}` engoliria "atividades".
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.agent_activity_log ORDER BY timestamp DESC LIMIT $1",
            limite,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


@router.get("/{agent_id}", response_model=PerfilCompletoOut)
async def obter(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            SELECT agent_id, name, emoji, specialty, model, persona_description,
                   skills_description, skills_tags, crons_description, description,
                   department, color, avatar_url, workspace, is_leader, leader_id,
                   access_type, allowed_user_ids, status,
                   openclaw_id, role, behavior, tts_voice_id, tts_voice_name
            FROM public.agent_profiles WHERE agent_id = $1
            """,
            agent_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")

    d = dict(linha)
    if not _pode_ver(d, usuario.id, usuario.papel == "administrador"):
        # 404 e não 403: quem não pode ver o agente também não deveria descobrir
        # que ele existe.
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")

    return PerfilCompletoOut(
        agent_id=d["agent_id"],
        name=d.get("name") or d["agent_id"],
        emoji=d.get("emoji"),
        specialty=d.get("specialty"),
        model=d.get("model"),
        persona_description=d.get("persona_description"),
        skills_description=d.get("skills_description"),
        skills_tags=[str(t) for t in (d.get("skills_tags") or [])],
        crons_description=d.get("crons_description"),
        description=d.get("description"),
        department=d.get("department"),
        color=d.get("color"),
        avatar_url=d.get("avatar_url"),
        workspace=d.get("workspace"),
        is_leader=bool(d.get("is_leader")),
        leader_id=d.get("leader_id"),
        access_type=d.get("access_type") or "all",
        allowed_user_ids=[str(u) for u in (d.get("allowed_user_ids") or [])],
        status=d.get("status") or "active",
        openclaw_id=d.get("openclaw_id"),
        role=d.get("role"),
        behavior=d.get("behavior"),
        tts_voice_id=d.get("tts_voice_id"),
        tts_voice_name=d.get("tts_voice_name"),
    )


class SincronizacaoOut(BaseModel):
    criados: int
    atualizados: int
    total_no_gateway: int


@router.post("/sync", response_model=SincronizacaoOut)
async def sincronizar(_: Usuario = Depends(exige_papel("administrador"))):
    """Cria em `agent_profiles` os agentes que existem no gateway.

    Sem isto a tabela nasce vazia e não há o que editar: os agentes aparecem com
    o nome que o gateway conhece e nada mais. Portado de `sync-agents`.

    **Preserva o que já foi editado à mão.** Nome, especialidade e liderança só
    são preenchidos a partir do gateway quando ainda não existem — quem editou o
    nome de exibição não perde a edição na próxima sincronização. Era assim na
    edge function e é o comportamento certo: o gateway é fonte de existência,
    não de curadoria.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado."
        )
    try:
        payload = await obter_cliente(c.url, c.token).chamar("agents.list")
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))

    do_gateway = [a for a in (payload.get("agents") or []) if (a.get("id") or "").strip()]

    criados = atualizados = 0
    async with sessao(role="service_role") as conn:
        for a in do_gateway:
            aid = a["id"].strip()
            existente = await conn.fetchrow(
                "SELECT agent_id FROM public.agent_profiles WHERE agent_id = $1", aid
            )
            if existente:
                # COALESCE preserva o valor atual; só preenche o que está vazio.
                await conn.execute(
                    """
                    UPDATE public.agent_profiles
                       SET name      = COALESCE(NULLIF(name, ''), $2),
                           workspace = COALESCE($3, workspace),
                           status    = 'active',
                           updated_at = now()
                     WHERE agent_id = $1
                    """,
                    aid, a.get("name") or aid, a.get("workspace"),
                )
                atualizados += 1
            else:
                await conn.execute(
                    """
                    INSERT INTO public.agent_profiles
                        (agent_id, openclaw_id, name, workspace, status, access_type)
                    VALUES ($1, $1, $2, $3, 'active', 'all')
                    """,
                    aid, a.get("name") or aid, a.get("workspace"),
                )
                criados += 1

    logger.info("Sync de agentes: %d criados, %d atualizados", criados, atualizados)
    return SincronizacaoOut(
        criados=criados, atualizados=atualizados, total_no_gateway=len(do_gateway)
    )


class PerfilAgentePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    emoji: str | None = Field(default=None, max_length=16)
    description: str | None = None
    specialty: str | None = None
    department: str | None = Field(default=None, max_length=120)
    color: str | None = Field(default=None, max_length=40)
    model: str | None = Field(default=None, max_length=120)
    avatar_url: str | None = Field(default=None, max_length=2000)
    access_type: str | None = None
    allowed_user_ids: list[str] | None = None
    is_leader: bool | None = None
    # Campos das abas Persona e Automações — o drawer os gravava por
    # `update-agent-profile`, que era a única rota que os conhecia.
    persona_description: str | None = None
    skills_description: str | None = None
    skills_tags: list[str] | None = None
    crons_description: str | None = None
    leader_id: str | None = None
    status: str | None = None
    # `role` é o cargo do agente ("SDR", "analista"), distinto do papel de acesso.
    # Vem da importação de agente, que traz o cargo junto com o resto do perfil.
    role: str | None = Field(default=None, max_length=200)
    # Voz do agente na Arena. Fica no perfil e não numa tabela à parte porque é
    # um atributo dele, não uma configuração da tela.
    tts_voice_id: str | None = Field(default=None, max_length=120)
    tts_voice_name: str | None = Field(default=None, max_length=200)


_ACESSOS = {"all", "admins_only", "specific_users"}
# Espelha o CHECK de `agent_profiles_status_check`. Não restringir mais que o
# banco: `configuring` é o estado em que `create-agent` deixa um agente novo, e
# recusá-lo aqui quebraria esse fluxo quando ele for portado.
_STATUS = {"active", "inactive", "configuring"}

# Campos que o gateway também guarda. Mudar um deles só no banco faz a tela
# mostrar uma coisa e o agente rodar outra — o caso que a portagem tinha que
# evitar.
_CAMPOS_DO_GATEWAY = ("name", "model")


async def _sincronizar_no_gateway(openclaw_id: str, campos: dict) -> None:
    """Propaga nome/modelo para o gateway. Levanta se não conseguir.

    **Gateway primeiro, banco depois.** Se esta chamada falhar, o PATCH aborta e
    nada muda em lugar nenhum — é o único arranjo em que as duas pontas não
    divergem. A edge function herdada fazia o contrário (gravava no banco e
    seguia com um `openclaw_warning` que a UI ignorava), e por isso um gateway
    fora do ar deixava o banco dizendo um modelo e o agente rodando outro.

    Cuidado registrado: `agents.update` **não valida o modelo** — aceita qualquer
    string e grava. Um id errado aqui deixa o agente mudo sem erro nenhum. É por
    isso que existe `POST /agents/test-model`.
    """
    payload = {"agentId": openclaw_id}
    for c in _CAMPOS_DO_GATEWAY:
        if c in campos:
            # `model` vai como string nua. O gateway devolve `{"primary": ...}`
            # no `agents.list`, mas recusa esse formato na escrita
            # ("at /model: must be string") — assimetria confirmada ao vivo.
            payload[c] = campos[c]

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Gateway não configurado — nome e modelo não podem ser alterados agora.",
        )
    try:
        await obter_cliente(c.url, c.token).chamar("agents.update", payload)
    except ErroGateway as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"O gateway recusou a alteração e nada foi salvo: {e}",
        )


async def _avisar_agente(openclaw_id: str, assunto: str, mensagem: str) -> None:
    """Manda uma mensagem a um agente. Nunca levanta.

    Portado dos blocos "notify" das edges de acesso e liderança, que eram
    explicitamente *best effort* (`EdgeRuntime.waitUntil`, falha só no log):
    o aviso é consequência da mudança, não parte dela, e nunca derrubava a
    gravação.

    Uma diferença forçada, que não é escolha: a edge chamava
    `POST /v1/chat/completions` com `model: "openclaw:<agente>"`. A rota é 404
    no gateway atual e o substituto é `chat.send` — ver `CLAUDE.md`.
    """
    try:
        c = await cfg.carregar()
        if not c.configurado:
            logger.warning("Gateway não configurado — aviso '%s' não enviado.", assunto)
            return
        await obter_cliente(c.url, c.token).chamar(
            "chat.send",
            {
                # `agentId` explícito e obrigatório na prática: sem ele o
                # gateway manda para o agente padrão, silenciosamente.
                "agentId": openclaw_id,
                # ⚠️ **A chave da sessão é composta, e o gateway VALIDA isso.**
                # Aqui era `system:{assunto}`, e todo aviso ao líder morria com
                # `agentId "nina" does not match session key "system:…"`. Como
                # o envio é best-effort, o erro só ia para o log: a tela dizia
                # "agente criado", o agente nascia com o template em branco, e
                # ninguém sabia que o líder nunca tinha sido avisado.
                #
                # A chave vai COMPOSTA — `agent:<id>:<sufixo>` — porque o
                # gateway extrai o agente dela e confere contra o `agentId`.
                # Mandar só o sufixo é recusado, e mandar um prefixo qualquer
                # (era `system:…`) é recusado do mesmo jeito. O
                # `_chave_sessao` de conversations.py já documentava isto; o
                # aviso ao líder tinha ficado de fora.
                "sessionKey": f"agent:{openclaw_id}:sistema-{assunto}",
                "message": mensagem,
                # Único por envio, senão o gateway deduplica pelo runId e o
                # segundo aviso do mesmo assunto some.
                "idempotencyKey": f"{assunto}:{uuid4()}",
            },
        )
        logger.info("Aviso '%s' enviado a %s.", assunto, openclaw_id)
    except ErroGateway as e:
        logger.warning("Aviso '%s' a %s falhou: %s", assunto, openclaw_id, e)


# O modelo que a orquestradora usa **enquanto cria um agente**. Escrever os sete
# arquivos de alguém é a tarefa mais difícil que ela faz, e a diferença de
# qualidade paga — decisão do Erick em 17/08/2026.
#
# ⚠️ **Não existe "modelo por tarefa" no gateway.** Foram sondados três
# caminhos: `chat.send` recusa `model`, `modelId` e `overrides` no schema; o
# `utilityModel` por agente é declaradamente para "short internal tasks"; e o
# `models` por agente é catálogo, não seletor. O que resta é trocar o modelo do
# agente em volta da operação e devolver depois.
#
# ⚠️ **A troca é global enquanto dura.** Quem conversar com a orquestradora
# durante a criação também será atendido por este modelo. É mais caro, não é
# errado, e a criação leva minutos — com três pessoas na instalação, o risco de
# cruzar é pequeno e o ganho é grande. Se um dia isso incomodar, o caminho é
# `sessions_spawn`, que aceita `model` por sessão-filha.
_MODELO_PARA_CRIAR = "anthropic/claude-sonnet-5"


async def _trocar_modelo(agent_id: str, modelo: str | None) -> str | None:
    """Troca o modelo do agente no gateway. Devolve o que estava lá antes.

    `modelo=None` não faz nada e devolve `None` — deixa o chamador escrever o
    caminho feliz sem `if`.
    """
    if not modelo:
        return None
    from app.gateway import patch as patch_gw

    parsed, base_hash = await patch_gw.config_do_gateway()
    lista = [dict(a) for a in (parsed.get("agents") or {}).get("list") or []]
    atual = next((a for a in lista if str(a.get("id")) == agent_id), None)
    if atual is None:
        raise ErroGateway(f"Agente {agent_id} não está no gateway.")

    anterior = atual.get("model")
    # `model` aceita string ou `{primary, fallbacks}`; normalizamos para
    # comparar e para devolver depois exatamente o que estava.
    def primario(m):
        return m.get("primary") if isinstance(m, dict) else m

    if primario(anterior) == modelo:
        return None  # já está nele: nada a desfazer

    for a in lista:
        if str(a.get("id")) == agent_id:
            a["model"] = modelo

    await patch_gw.aplicar_patch(
        {"agents": {"list": lista}}, base_hash,
        conferir=lambda c: any(
            str(x.get("id")) == agent_id and primario(x.get("model")) == modelo
            for x in ((c.get("agents") or {}).get("list") or [])
        ),
    )
    return anterior


async def _devolver_modelo(agent_id: str, anterior) -> None:
    """Volta o modelo de antes. Best effort: falhar aqui não desfaz a criação.

    ⚠️ Se falhar, o agente **fica** no modelo caro. Por isso vai para o log com
    o que era, para dar como restaurar à mão.
    """
    if anterior is None:
        return
    try:
        from app.gateway import patch as patch_gw

        parsed, base_hash = await patch_gw.config_do_gateway()
        lista = [dict(a) for a in (parsed.get("agents") or {}).get("list") or []]
        for a in lista:
            if str(a.get("id")) == agent_id:
                a["model"] = anterior
        await patch_gw.aplicar_patch(
            {"agents": {"list": lista}}, base_hash,
            conferir=lambda c: any(
                str(x.get("id")) == agent_id and x.get("model") == anterior
                for x in ((c.get("agents") or {}).get("list") or [])
            ),
        )
    except Exception as e:  # noqa: BLE001
        logger.error(
            "NÃO devolvi o modelo de %s: ele ficou em %s e o anterior era %r. (%s)",
            agent_id, _MODELO_PARA_CRIAR, anterior, e,
        )


async def _avisar_lider_ou_falhar(assunto: str, mensagem: str) -> str:
    """Como `_avisar_lider`, mas **levanta** quando não consegue entregar.

    Existe porque há um caso em que o aviso não é consequência da mudança —
    ele **é** a mudança: criar agente. O `create-agent` registra o agente no
    gateway e depende do orquestrador para escrever a alma dele. Se a mensagem
    não chega, o agente nasce com o template em branco do OpenClaw e ninguém
    fica sabendo.

    Foi exatamente o que aconteceu em 12/08/2026: a chave de sessão ia no
    formato errado, o gateway recusava, o erro morria no log, e a tela dizia
    "agente criado" para um agente vazio.
    """
    async with sessao(role="service_role") as conn:
        lider = await conn.fetchrow(
            "SELECT COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid "
            "FROM public.agent_profiles WHERE is_leader = true LIMIT 1"
        )
    if lider is None:
        raise ErroGateway("Nenhum agente está marcado como líder.")

    c = await cfg.carregar()
    if not c.configurado:
        raise ErroGateway("Gateway não configurado.")
    chave = f"agent:{lider['oid']}:sistema-{assunto}"
    await obter_cliente(c.url, c.token).chamar(
        "chat.send",
        {
            "agentId": lider["oid"],
            "sessionKey": chave,
            "message": mensagem,
            "idempotencyKey": f"{assunto}:{uuid4()}",
        },
    )
    logger.info("Aviso '%s' entregue a %s.", assunto, lider["oid"])
    # Devolve a chave para quem precisa acompanhar a sessão depois. Remontá-la
    # do lado de fora duplicaria a regra do formato composto — e foi um formato
    # errado de chave que derrubou todos os avisos em 12/08/2026.
    return chave


async def _avisar_lider(assunto: str, mensagem: str) -> None:
    """Avisa o agente líder da instalação.

    A edge de acesso mandava para `openclaw:lia` fixo, e `lia` não existe aqui.
    O líder sai de `agent_profiles.is_leader` — o `CLAUDE.md` proíbe reintroduzir
    o nome fixo, e a resolução dinâmica já tinha sido corrigida antes.
    """
    async with sessao(role="service_role") as conn:
        lider = await conn.fetchrow(
            "SELECT COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid "
            "FROM public.agent_profiles WHERE is_leader = true LIMIT 1"
        )
    if lider is None:
        logger.warning("Sem agente líder — aviso '%s' não foi enviado.", assunto)
        return
    await _avisar_agente(lider["oid"], assunto, mensagem)


def _rotulo(emoji: str | None, nome: str | None, aid: str) -> str:
    """`emoji nome` como a edge montava, tolerando ambos ausentes."""
    return " ".join(p for p in (emoji or "", nome or aid) if p).strip()


async def _avisar_lideranca(
    agent_id: str, rotulo_agente: str, lider_anterior: str | None, lider_novo: str | None
) -> None:
    """Avisa os orquestradores envolvidos numa troca de liderança.

    Dois avisos possíveis, exatamente como na edge: o líder que **perdeu** o
    agente é mandado tirar a referência do `IDENTITY.md` dele, e o que **ganhou**
    recebe as instruções de escrever nos dois arquivos. Os textos são cópia —
    são instruções que o agente executa, não mensagem para humano.
    """
    async def perfil(aid: str):
        async with sessao(role="service_role") as conn:
            return await conn.fetchrow(
                "SELECT COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid, agent_id, "
                "name, emoji FROM public.agent_profiles WHERE agent_id = $1",
                aid,
            )

    if lider_anterior and lider_anterior != lider_novo:
        anterior = await perfil(lider_anterior)
        if anterior:
            await _avisar_agente(
                anterior["oid"],
                f"leadership:{anterior['agent_id']}",
                "ATUALIZAÇÃO DE LIDERANÇA:\n\n"
                f"O agente {rotulo_agente} (ID: {agent_id}) não está mais sob sua "
                "coordenação direta.\n\n"
                "Por favor:\n"
                '1. No seu IDENTITY.md, remova a referência a este agente da seção '
                '"## Super agentes sob sua coordenação".\n'
                "2. Confirme quando concluído.",
            )

    if not lider_novo:
        return

    novo = await perfil(lider_novo)
    if novo is None:
        # A edge devolvia 404 aqui — **depois** de já ter gravado o leader_id.
        # Mantido o efeito (grava e avisa que o líder não existe) sem derrubar o
        # PATCH inteiro, que também gravou outros campos legítimos.
        logger.warning("Líder %s não encontrado — aviso não enviado.", lider_novo)
        return

    rotulo_lider = _rotulo(novo["emoji"], novo["name"], novo["agent_id"])
    await _avisar_agente(
        novo["oid"],
        f"leadership:{novo['agent_id']}",
        "CONFIGURAÇÃO DE LIDERANÇA:\n\n"
        f"Um agente foi vinculado à sua coordenação: {rotulo_agente} (ID: {agent_id}).\n\n"
        "Por favor, faça o seguinte:\n"
        f"1. Acesse o workspace do agente {rotulo_agente} em "
        f"/root/.openclaw/workspace-{agent_id}/\n"
        "2. No arquivo IDENTITY.md desse agente, adicione (se ainda não existir) a seção:\n\n"
        "## Estrutura de Liderança\n"
        f"Seu orquestrador direto é {rotulo_lider}. Em decisões estratégicas, conflitos "
        "de prioridade ou dúvidas sobre direcionamento, consulte-o.\n\n"
        f"3. No SEU próprio IDENTITY.md ({rotulo_lider}), adicione ou atualize:\n\n"
        "## Super agentes sob sua coordenação\n"
        f"- {rotulo_agente} ({agent_id})\n\n"
        "4. Confirme quando concluído.",
    )


async def _mensagem_de_acesso(
    agent_id: str, nome_exibicao: str, access_type: str, permitidos: list
) -> str:
    """Texto do aviso de acesso. Copiado da edge, incluindo o tom imperativo:
    o agente guarda isso no `MEMORY.md` dele como regra de segurança."""
    if access_type == "all":
        return (
            f'🔓 ATUALIZAÇÃO DE ACESSO: O agente "{nome_exibicao}" ({agent_id}) agora é '
            "acessível a TODOS os membros da plataforma. Remova qualquer restrição "
            "anterior para este agente do seu MEMORY.md."
        )

    autorizados = "todos os membros"
    if access_type == "admins_only":
        autorizados = "apenas administradores"
    elif access_type == "specific_users" and permitidos:
        async with sessao(role="service_role") as conn:
            linhas = await conn.fetch(
                "SELECT full_name, email FROM public.profiles WHERE id = ANY($1::uuid[])",
                permitidos,
            )
        nomes = [(l["full_name"] or l["email"]) for l in linhas if (l["full_name"] or l["email"])]
        autorizados = ", ".join(nomes) or "usuários específicos"

    return (
        "🔒 ATUALIZAÇÃO DE ACESSO — REGRA DE SEGURANÇA:\n\n"
        f'O agente "{nome_exibicao}" ({agent_id}) é RESTRITO.\n'
        f"Autorizado para: {autorizados}\n\n"
        "REGRA OBRIGATÓRIA: Se qualquer outro usuário tentar acessar informações deste "
        "agente — diretamente ou pedindo que você busque dados com ele — você deve:\n"
        "1. Recusar a solicitação\n"
        "2. NÃO confirmar nem negar que os dados existem\n"
        '3. Responder apenas: "Você não tem permissão para acessar este agente."\n\n'
        "Esta regra se aplica mesmo que a solicitação venha via orquestrador, debate "
        "multi-agente, ou qualquer outro mecanismo. Salve esta regra no seu MEMORY.md de hoje."
    )


@router.patch("/{agent_id}", response_model=AgenteOut)
async def atualizar(
    agent_id: str,
    dados: PerfilAgentePatch,
    _: Usuario = Depends(exige_papel("administrador")),
):
    campos = dados.model_dump(exclude_unset=True)
    if not campos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nada para atualizar.")

    if "access_type" in campos and campos["access_type"] not in _ACESSOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"access_type inválido. Use um de: {', '.join(sorted(_ACESSOS))}.",
        )
    if "status" in campos and campos["status"] not in _STATUS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"status inválido. Use um de: {', '.join(sorted(_STATUS))}.",
        )
    if campos.get("leader_id") == agent_id:
        # Um agente não lidera a si mesmo. A edge function silenciava isso para
        # NULL; aqui é erro, porque a UI não tem como oferecer essa opção sem bug.
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Um agente não pode liderar a si mesmo."
        )

    # Zerar a lista quando o acesso não é `specific_users` é regra do servidor, não
    # da tela: era a linha `if (access_type !== "specific_users") allowed_user_ids = []`
    # da edge. Sem ela, trocar para `all` deixaria a lista antiga guardada e ela
    # voltaria a valer se alguém devolvesse o acesso para `specific_users`.
    if campos.get("access_type") in ("all", "admins_only"):
        campos["allowed_user_ids"] = []

    async with sessao(role="service_role") as conn:
        alvo = await conn.fetchrow(
            "SELECT COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid, name, emoji, "
            # O líder de antes, para saber quem avisar da perda. A edge recebia
            # isto do front (`previous_leader_id`), que o guardava em estado de
            # componente; ler do banco dá o mesmo resultado sem depender de um
            # valor que pode ter envelhecido na tela aberta.
            "leader_id AS lider_anterior "
            "FROM public.agent_profiles WHERE agent_id = $1",
            agent_id,
        )
    if alvo is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Agente não encontrado. Rode POST /agents/sync se ele existe no gateway.",
        )

    # Antes de tocar no banco: só quando a mudança realmente alcança o gateway.
    # Persona, skills, crons e acesso são metadados nossos — editá-los com o
    # gateway fora do ar é legítimo e não pode ficar bloqueado.
    if any(c in campos for c in _CAMPOS_DO_GATEWAY):
        await _sincronizar_no_gateway(alvo["oid"], campos)

    virou_lider = campos.pop("is_leader", None)

    if "allowed_user_ids" in campos:
        # A coluna é `uuid[]`. Um id malformado aqui viraria um erro de driver
        # sem indicação de qual campo estava errado.
        try:
            campos["allowed_user_ids"] = [
                UUID(str(u)) for u in (campos["allowed_user_ids"] or [])
            ]
        except ValueError:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "allowed_user_ids contém um identificador que não é UUID.",
            )

    async with sessao(role="service_role") as conn:
        if campos:
            atribuicoes = ", ".join(f"{c} = ${i}" for i, c in enumerate(campos, start=1))
            await conn.execute(
                f"UPDATE public.agent_profiles SET {atribuicoes}, updated_at = now() "
                f"WHERE agent_id = ${len(campos) + 1}",
                *campos.values(), agent_id,
            )

        if virou_lider is not None:
            # `agent_profiles_single_leader_idx` é um índice único parcial sobre
            # (true) WHERE is_leader — só existe UM líder por instalação. Marcar
            # um segundo sem limpar o anterior viola a constraint, então a troca
            # tem que ser atômica.
            if virou_lider:
                await conn.execute(
                    "UPDATE public.agent_profiles SET is_leader = false "
                    "WHERE is_leader = true AND agent_id <> $1", agent_id
                )
            await conn.execute(
                "UPDATE public.agent_profiles SET is_leader = $2, updated_at = now() "
                "WHERE agent_id = $1", agent_id, virou_lider
            )

        linha = await conn.fetchrow(
            """
            SELECT agent_id, name, emoji, avatar_url, model, channels, status,
                   department, description, specialty, workspace,
                   is_leader, leader_id, is_official, color, sort_order,
                   -- ⚠️ Estes dois faltavam, e o `AgenteOut` tem default
                   -- `"all"` / `[]`: a resposta do PATCH afirmava que o agente
                   -- estava aberto a todo mundo mesmo quando o banco dizia
                   -- `specific_users` com onze pessoas. O banco nunca foi
                   -- alterado — mentia só a resposta, que é o que a tela usa
                   -- para atualizar o cache depois de salvar.
                   access_type, allowed_user_ids
            FROM public.agent_profiles WHERE agent_id = $1
            """,
            agent_id,
        )

    if linha is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "Agente não encontrado. Rode POST /agents/sync se ele existe no gateway.",
        )

    # Avisos aos agentes, depois de gravado — a ordem da edge. Best effort: a
    # falha já foi tratada lá dentro e não afeta esta resposta.
    if "access_type" in campos:
        await _avisar_lider(
            f"update-agent-access:{agent_id}",
            await _mensagem_de_acesso(
                agent_id,
                (dict(linha).get("name") or agent_id),
                campos["access_type"],
                campos.get("allowed_user_ids") or [],
            ),
        )

    # Sem condicionar a "mudou": a edge avisava o líder novo **sempre** que era
    # chamada, e a tela depende disso — "Sincronizar com orquestrador" e
    # "Re-configurar" remandam o mesmo líder só para disparar a mensagem. Só o
    # aviso ao líder *anterior* é condicional, e essa guarda está lá dentro.
    if "leader_id" in campos:
        await _avisar_lideranca(
            agent_id,
            _rotulo(alvo["emoji"], alvo["name"], agent_id),
            alvo["lider_anterior"],
            campos["leader_id"],
        )

    d = dict(linha)
    return AgenteOut(
        id=d["agent_id"],
        name=d.get("name") or d["agent_id"],
        status=d.get("status") or "inactive",
        model=d.get("model") or "",
        channels=[str(ch) for ch in (d.get("channels") or [])],
        emoji=d.get("emoji"),
        avatarUrl=d.get("avatar_url"),
        department=d.get("department"),
        description=d.get("description"),
        specialty=d.get("specialty"),
        workspace=d.get("workspace"),
        isLeader=bool(d.get("is_leader")),
        leaderId=d.get("leader_id"),
        isOfficial=bool(d.get("is_official")),
        sortOrder=d.get("sort_order"),
        color=d.get("color"),
        accessType=d.get("access_type") or "all",
        allowedUserIds=[str(x) for x in (d.get("allowed_user_ids") or [])],
    )


# ─────────────────────────────────────────────────────────────────────────────
# Verificação de modelo — sucessora de `test-llm-model`
# ─────────────────────────────────────────────────────────────────────────────

# Por que existe: `agents.update` **não valida o modelo**. Aceita qualquer string
# e grava — comprovado ao vivo em 06/08/2026, gravando um id inventado num agente
# real. Sem uma verificação, um id errado deixa o agente mudo em silêncio.
#
# **Isto não é a portagem do `test-llm-model`, é a substituição dele.** A edge
# function provava que a LLM respondia mandando uma mensagem de verdade em
# `POST /v1/chat/completions` com o header `x-openclaw-model`. Essa rota **não
# existe mais** no gateway 2026.7.1-2 (404, verificado), e o equivalente novo
# (`chat.send`) manda mensagem real: cria histórico num agente e gasta tokens a
# cada clique.
#
# Em compensação o gateway hoje entrega de graça o que antes só a chamada real
# revelava:
#   - `models.list`       → `available` por modelo
#   - `models.authStatus` → status e expiração da credencial de cada provedor
#
# Então a verificação passou a ser barata e sem efeito colateral, ao preço de ser
# mais fraca: ela confirma que o modelo está **registrado e disponível** e que a
# **credencial do provedor está válida**, não que a LLM respondeu. A UI diz isso
# com todas as letras — prometer "funciona" seria mentira.

_PROVEDORES = {"deepseek", "openai", "anthropic", "gemini"}

# Status de credencial que reprovam. O gateway usa `expired` para OAuth vencido;
# os outros aparecem em falha de refresh e revogação.
_AUTH_RUIM = {"expired", "invalid", "error", "revoked"}


class TesteModeloIn(BaseModel):
    model: str = Field(min_length=1, max_length=200)


class TesteModeloOut(BaseModel):
    model: str
    # ok | credencial_invalida | indisponivel | nao_registrado | erro
    status: str
    mensagem: str
    detalhe: str | None = None
    # Falso quando não há credencial OAuth para o provedor: aí o gateway usa API
    # key, que o `authStatus` não cobre, e a validade não pôde ser checada.
    credencial_verificada: bool = False


def _perfis_do_provedor(auth: dict, provedor: str) -> list[dict]:
    """Perfis de credencial que pertencem a um provedor.

    O `authStatus` identifica o provedor de dois jeitos que não coincidem: a
    entrada de topo traz um nome de integração (`claude-cli`), e o perfil traz
    `profileId` no formato `provedor:integração` (`anthropic:claude-cli`). Casar
    só pelo nome de topo perderia a credencial da Anthropic.
    """
    achados = []
    for p in auth.get("providers") or []:
        nome = str(p.get("provider") or "").lower()
        for perfil in p.get("profiles") or [{}]:
            pid = str(perfil.get("profileId") or "").lower()
            if nome == provedor or pid.startswith(f"{provedor}:"):
                achados.append(perfil or p)
    return achados


@router.post("/test-model", response_model=TesteModeloOut)
async def testar_modelo(
    dados: TesteModeloIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Confere se um modelo está registrado, disponível e com credencial válida.

    `administrador` porque configuração de LLM é superfície de admin.
    """
    requisitado = dados.model.strip()

    # Exige `provedor/modelo`. Sem prefixo o gateway assume `deepseek/` e a
    # verificação reprovaria um modelo de outro provedor por engano.
    provedor, _barra, id_modelo = requisitado.partition("/")
    provedor = provedor.lower()
    if not id_modelo or provedor not in _PROVEDORES:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "Informe o modelo no formato provedor/modelo (ex.: anthropic/claude-sonnet-4-6).",
        )

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "Gateway não configurado — conecte o gateway em Configurações primeiro.",
        )

    cliente = obter_cliente(c.url, c.token)
    try:
        modelos = await cliente.chamar("models.list", {"view": "configured"})
        auth = await cliente.chamar("models.authStatus")
    except ErroGateway as e:
        logger.warning("Verificação do modelo %s falhou: %s", requisitado, e)
        return TesteModeloOut(
            model=requisitado,
            status="erro",
            mensagem="Não foi possível falar com o gateway.",
            detalhe=str(e)[:300],
        )

    encontrado = next(
        (
            m
            for m in (modelos.get("models") or [])
            if str(m.get("id") or "").lower() == id_modelo.lower()
            and str(m.get("provider") or "").lower() == provedor
        ),
        None,
    )

    if encontrado is None:
        disponiveis = ", ".join(
            f"{m.get('provider')}/{m.get('id')}" for m in (modelos.get("models") or [])[:8]
        )
        return TesteModeloOut(
            model=requisitado,
            status="nao_registrado",
            mensagem="O gateway não reconhece esse modelo. Verifique se ele está "
            "registrado na configuração.",
            detalhe=f"Registrados: {disponiveis}" if disponiveis else None,
        )

    if encontrado.get("available") is False:
        return TesteModeloOut(
            model=requisitado,
            status="indisponivel",
            mensagem="O modelo está registrado mas o gateway o marca como "
            "indisponível agora.",
        )

    perfis = _perfis_do_provedor(auth, provedor)
    ruins = [p for p in perfis if str(p.get("status") or "").lower() in _AUTH_RUIM]
    if ruins:
        rotulo = (ruins[0].get("expiry") or {}).get("at")
        return TesteModeloOut(
            model=requisitado,
            status="credencial_invalida",
            mensagem=f"O modelo existe e está disponível, mas a credencial de "
            f"{provedor} está {ruins[0].get('status')}. Reconecte o provedor — "
            "o agente vai ficar mudo assim que precisar dela.",
            detalhe=f"perfil {ruins[0].get('profileId')}, expira em {rotulo}" if rotulo else None,
            credencial_verificada=True,
        )

    if not perfis:
        # Provedor por API key não aparece no authStatus. Não dá para afirmar que
        # a chave é boa — e afirmar seria pior que não verificar.
        return TesteModeloOut(
            model=requisitado,
            status="ok",
            mensagem="Modelo registrado e disponível. A credencial do provedor não "
            "pôde ser verificada (sem perfil OAuth — provavelmente API key).",
            credencial_verificada=False,
        )

    return TesteModeloOut(
        model=requisitado,
        status="ok",
        mensagem="Modelo registrado, disponível e com credencial válida.",
        credencial_verificada=True,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Liderança em lote — portado de `sync-agent-leadership`
# ─────────────────────────────────────────────────────────────────────────────


class LiderancaItem(BaseModel):
    agent_id: str = Field(min_length=1, max_length=120)
    is_leader: bool
    leader_id: str | None = Field(default=None, max_length=120)


class LiderancaIn(BaseModel):
    agents: list[LiderancaItem] = Field(min_length=1, max_length=500)


class LiderancaResultado(BaseModel):
    agent_id: str
    is_leader: bool
    leader_id: str | None
    atualizado: bool


class LiderancaOut(BaseModel):
    atualizados: int
    total: int
    agents: list[LiderancaResultado]


@router.post("/leadership/sync", response_model=LiderancaOut)
async def sincronizar_lideranca(
    dados: LiderancaIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Grava `is_leader`/`leader_id` de vários agentes de uma vez.

    Existe para o agente orquestrador (na VPS) empurrar a liderança que ele lê do
    `SOUL.md` de cada agente, que é a fonte canônica.

    ⚠️ **O botão da UI que chama isto é inócuo** e já era assim na edge function:
    a tela lê `is_leader`/`leader_id` do banco e devolve os mesmos valores, então
    o round-trip nunca muda nada. Foi portado como estava, de propósito — corrigir
    o produto é outra tarefa, registrada em `docs/ROADMAP.md`. Pelo caminho da
    VPS, que manda um payload de verdade, o endpoint funciona.

    A autorização aqui é só `administrador`. A edge function também aceitava um
    `GUARDRAILS_API_TOKEN` para o caminho automatizado; esse segundo caminho
    entra quando a autenticação máquina-a-máquina for portada, e não antes —
    aceitar um token que ainda não tem dono seria abrir uma porta sem tranca.
    """
    resultados: list[LiderancaResultado] = []

    async with sessao(role="service_role") as conn:
        for a in dados.agents:
            # Um agente não lidera a si mesmo.
            leader_id = a.leader_id if a.leader_id and a.leader_id != a.agent_id else None
            marca = await conn.execute(
                """
                UPDATE public.agent_profiles
                   SET is_leader = $2, leader_id = $3, updated_at = now()
                 WHERE agent_id = $1
                """,
                a.agent_id, a.is_leader, leader_id,
            )
            resultados.append(
                LiderancaResultado(
                    agent_id=a.agent_id,
                    is_leader=a.is_leader,
                    leader_id=leader_id,
                    # asyncpg devolve "UPDATE <n>"; 0 significa que o agent_id
                    # não existe no banco.
                    atualizado=marca.rsplit(" ", 1)[-1] != "0",
                )
            )

    atualizados = sum(1 for r in resultados if r.atualizado)
    logger.info("Sync de liderança: %d/%d atualizados", atualizados, len(resultados))
    return LiderancaOut(atualizados=atualizados, total=len(resultados), agents=resultados)


class ExclusaoAgenteOut(BaseModel):
    agent_id: str
    removido_do_gateway: bool
    aviso_gateway: str | None = None


@router.delete("/{agent_id}", response_model=ExclusaoAgenteOut)
async def excluir(
    agent_id: str,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Apaga o agente no gateway e no banco. Portado de `delete-agent`.

    ⚠️ **A ordem aqui é o contrário do `PATCH`, e de propósito.** No `PATCH`, o
    gateway vem primeiro e a falha aborta tudo, porque divergir seria pior que
    não salvar. Aqui não: se o gateway recusar, o banco é limpo **mesmo assim** e
    a resposta traz o aviso. Era o comportamento da edge e é o certo para
    exclusão — deixar o perfil órfão no banco porque o gateway estava fora
    significa um agente fantasma na tela que ninguém consegue remover.
    """
    aid = (agent_id or "").strip()
    if not re.match(r"^[A-Za-z0-9_-]{2,80}$", aid):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "agent_id inválido.")

    async with sessao(role="service_role") as conn:
        alvo = await conn.fetchrow(
            "SELECT agent_id, COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid, name "
            "FROM public.agent_profiles WHERE agent_id = $1",
            aid,
        )
    if alvo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")

    removido = False
    aviso: str | None = None
    try:
        c = await cfg.carregar()
        if not c.configurado:
            raise ErroGateway("Gateway não configurado.")
        cliente = obter_cliente(c.url, c.token)
        # Duas formas de parâmetro, como na edge: `agentId` primeiro, `name`
        # como alternativa. Só insiste quando a recusa foi de validação — erro
        # de outra natureza não melhora tentando o outro formato.
        for params in ({"agentId": alvo["oid"]}, {"name": alvo["name"] or alvo["oid"]}):
            try:
                await cliente.chamar("agents.delete", params)
                removido = True
                break
            except ErroGateway as e:
                msg = str(e).lower()
                if "not found" in msg or "does not exist" in msg or "no such" in msg:
                    removido = True  # já não existia lá
                    break
                aviso = str(e)
                if "unexpected property" not in msg and "invalid" not in msg:
                    break
    except ErroGateway as e:
        aviso = str(e)

    async with sessao(role="service_role") as conn:
        async with conn.transaction():
            await conn.execute(
                "DELETE FROM public.agent_profiles "
                "WHERE agent_id = $1 OR openclaw_id = $2",
                alvo["agent_id"], alvo["oid"],
            )
            # Limpeza do que depende do agente. `best effort` na edge; aqui vai
            # na mesma transação, que é mais forte e não custa nada.
            for tabela in ("agent_avatars", "agent_integrations"):
                await conn.execute(
                    f"DELETE FROM public.{tabela} WHERE agent_id = ANY($1::text[])",
                    [alvo["agent_id"], alvo["oid"]],
                )

    logger.info(
        "Agente %s excluído (gateway: %s)", aid, "ok" if removido else f"falhou — {aviso}"
    )
    return ExclusaoAgenteOut(
        agent_id=aid, removido_do_gateway=removido, aviso_gateway=None if removido else aviso
    )


# ─────────────────────────────────────────────────────────────────────────────
# Criação de agente — portado de `create-agent`
# ─────────────────────────────────────────────────────────────────────────────


class AgenteNovoIn(BaseModel):
    openclaw_id: str = Field(min_length=2, max_length=32)
    name: str = Field(min_length=2, max_length=200)
    specialty: str = Field(min_length=5)
    model: str = Field(min_length=1)
    workspace: str = Field(min_length=1)
    channels: list[str] = Field(min_length=1)
    emoji: str = "🤖"
    description: str = ""
    behavior: str = ""
    skills_description: str = ""
    skills_tags: list[str] = []
    integrations_used: list[str] = []
    persona_description: str = ""
    behavior_restrictions: str = ""
    crons_description: str = ""
    # Quando falso, o orquestrador só monta a infraestrutura e o usuário escreve
    # os arquivos do agente à mão.
    lia_onboarding: bool = True
    access_type: str = "all"
    allowed_user_ids: list[str] = []
    leader_id: str | None = None


class AgenteNovoOut(BaseModel):
    agent_id: str
    criado_no_gateway: bool
    orquestrador_avisado: bool
    # O que de fato foi ligado. A tela mostrava as integrações escolhidas como
    # se tivessem sido aplicadas; agora ela recebe o resultado, não a intenção.
    conectores_publicados: list[str] = []
    conectores_com_falha: list[dict] = []


def _briefing(d: AgenteNovoIn) -> str:
    """Instruções para o orquestrador montar o agente no VPS.

    Copiado da edge, incluindo o tom imperativo e o aviso em maiúsculas de que
    ele deve **executar** as ferramentas em vez de descrever o que faria. Isso
    não é estilo: era a correção de um comportamento real em que o agente
    respondia com um plano e não criava arquivo nenhum.
    """
    integracoes = ", ".join(d.integrations_used) or "Nenhuma selecionada"
    crons = (
        f'AUTOMAÇÕES (configure os crons após criar o agente):\n"{d.crons_description}"'
        if d.crons_description
        else "Sem automações configuradas."
    )

    if not d.lia_onboarding:
        return (
            "🤖 NOVO AGENTE CRIADO — CONFIGURAÇÃO BÁSICA\n\n"
            "⚠️ EXECUTE as ferramentas (SSH) — não responda apenas com texto.\n\n"
            f"ID: {d.openclaw_id} | Nome: {d.name} {d.emoji}\n"
            f"Workspace: {d.workspace}\n"
            f"{crons}\n\n"
            "Execute apenas os passos de infraestrutura do AGENT_CREATION.md "
            "(criar workspace, registrar no gateway, reiniciar). O usuário vai "
            "configurar os arquivos manualmente."
        )

    return (
        "🤖 NOVO AGENTE CRIADO — EXECUTE ONBOARDING COMPLETO\n\n"
        "⚠️ INSTRUÇÃO CRÍTICA: você DEVE executar as ferramentas (SSH/file write) "
        "para criar os arquivos no VPS. Não responda apenas com texto descrevendo "
        "o que faria — EXECUTE. Ao final, liste cada arquivo criado com o caminho "
        "completo.\n\n"
        "Dados técnicos:\n"
        f"- ID: {d.openclaw_id}\n"
        f"- Nome: {d.name} {d.emoji}\n"
        f"- Modelo: {d.model}\n"
        f"- Workspace: {d.workspace}\n"
        f"- Canais: {', '.join(d.channels) or 'webchat'}\n\n"
        f"Especialidade: {d.specialty or d.skills_description or 'Não definida'}\n"
        f"Tags: {', '.join(d.skills_tags) or 'Nenhuma'}\n"
        f"Integrações selecionadas: {integracoes}\n\n"
        "PERSONA (base para SOUL.md e IDENTITY.md):\n"
        f'"{d.persona_description or "Não definida — use a especialidade como referência"}"\n\n'
        "Restrições importantes:\n"
        f'"{d.behavior_restrictions or "Nenhuma definida"}"\n\n'
        f"{crons}\n\n"
        # ⚠️ **O procedimento mora no AGENT_CREATION.md, não aqui.** Esta lista
        # era de 11 passos e três estavam errados em 12/08/2026: mandava criar
        # o workspace (a API já criou, com os arquivos semeados), atualizar um
        # AGENTS_DIRECTORY.md que não existe, e reiniciar o gateway — que
        # derruba o túnel e as sessões de todo mundo, sem necessidade.
        #
        # Repetir procedimento em dois lugares garante que um dos dois fique
        # velho. O briefing manda os DADOS daquele agente; o documento manda o
        # COMO, e é atualizável sem deploy.
        "O agente já existe no gateway: workspace criado e os sete arquivos "
        "semeados com o template em branco do OpenClaw. Seu trabalho é "
        "substituir esse template.\n\n"
        "Siga o AGENT_CREATION.md do seu workspace. Ele diz o que vai em cada "
        "arquivo, o que todo agente herda e o que muda por agente.\n\n"
        "Ao terminar, liste cada arquivo criado com o caminho completo e "
        "resuma o que ficou configurado.\n\n"
        "Capricha no SOUL.md — é a alma do agente. NÃO pule a execução das "
        "ferramentas: descrever o que faria não cria arquivo nenhum."
    )


_PEDIDO_AO_AGENTE = """Você acabou de ser criado, e a orquestradora escreveu os seus sete arquivos. Falta a parte que só você pode fazer.

Ela não tem as suas ferramentas — quem tem é você. Então o TOOLS.md dela foi escrito sem poder abrir o que você abre.

Sua tarefa, agora:

1. Veja quais ferramentas você de fato tem.
2. Se alguma for banco de dados, CONSULTE o schema real antes de descrevê-lo:
   SELECT table_schema, table_name FROM information_schema.tables
    WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2;
3. Reescreva o seu TOOLS.md com o que existe de verdade: o schema certo, uma
   tabela de "pergunta -> onde" com tabelas que existem, e as regras de
   consultar sem desperdiçar contexto (LIMIT sempre, count(*) para "quantos",
   só as colunas que importam).
4. Documente TODAS as suas ferramentas, inclusive a de avisar o administrador.
5. Releia o arquivo depois de escrever e confirme o que ficou.

Se você não tem ferramenta nenhuma, diga isso — não descreva o que não pode abrir."""


async def _completar_agente(
    agent_id: str, sessao_lider: str,
    lider_id: str | None = None, modelo_anterior=None,
) -> None:
    """Espera o orquestrador terminar e manda o agente completar o próprio TOOLS.md.

    ⚠️ **Só o agente pode escrever o próprio `TOOLS.md` com honestidade**, porque
    só ele tem as ferramentas. Fazer o orquestrador documentar o banco de outro
    exigiria dar a ele acesso a TODOS os bancos da empresa — o oposto do que o
    diretório de pessoas resolveu, e um alvo bem maior.

    Foi o que aconteceu por acidente com a `iris` em 14/08/2026: o arquivo
    escrito pela orquestradora citava schema errado e tabelas inexistentes; o
    que a própria agente escreveu, com o banco aberto, saiu correto.

    ⚠️ Roda em segundo plano de propósito. O orquestrador leva minutos, e
    segurar a requisição HTTP até lá deixaria a tela pendurada. Falhar aqui não
    quebra nada: o agente existe, os arquivos estão escritos, e o pedido pode
    ser refeito à mão.
    """
    c = await cfg.carregar()
    if not c.configurado:
        logger.error("Sem gateway: %s não foi completado.", agent_id)
        if lider_id:
            await _devolver_modelo(lider_id, modelo_anterior)
        return
    cliente = obter_cliente(c.url, c.token)

    # Espera o orquestrador sair de `running`. O teto existe porque sessão
    # pendurada não pode segurar a tarefa para sempre.
    # ⚠️ **"Não está `running`" quer dizer duas coisas opostas:** já terminou, e
    # ainda nem começou. A primeira versão só olhava isso e disparava o pedido
    # no primeiro ciclo — em 14/08/2026 o `atlas` recebeu o pedido de completar
    # o TOOLS.md enquanto a orquestradora ainda escrevia os arquivos dele, e os
    # dois trabalharam no mesmo workspace ao mesmo tempo.
    #
    # Por isso são dois laços: primeiro espera COMEÇAR, só então espera TERMINAR.
    async def estado() -> str | None:
        try:
            h = await cliente.chamar("chat.history", {"sessionKey": sessao_lider, "limit": 2})
            payload = h.get("payload") if isinstance(h.get("payload"), dict) else h
            return (payload.get("sessionInfo") or {}).get("status")
        except (ErroGateway, OSError) as e:
            logger.info("Aguardando o orquestrador (%s): %s", agent_id, e)
            return None

    for _ in range(20):  # até 5 min para a sessão aparecer e começar a rodar
        await asyncio.sleep(15)
        if await estado() == "running":
            break
    else:
        # Nunca começou: o briefing foi entregue mas o orquestrador não rodou.
        # Pedir ao agente que complete o TOOLS.md agora seria pedir que ele
        # remende um template em branco.
        logger.error("Orquestrador não começou a montar %s — nada a completar.", agent_id)
        return

    for _ in range(80):  # ~20 min para terminar
        await asyncio.sleep(15)
        if await estado() != "running":
            break
    else:
        logger.warning("Orquestrador não terminou a tempo; %s segue configurando.", agent_id)
        if lider_id:
            await _devolver_modelo(lider_id, modelo_anterior)
        return

    # ⚠️ **Devolve o modelo AQUI, não no fim.** A orquestradora acabou; o que
    # vem a seguir é o agente novo escrevendo o próprio TOOLS.md, e isso é
    # trabalho dele, no modelo dele. Devolver só no fim manteria a
    # orquestradora no modelo caro por mais alguns minutos, à toa.
    if lider_id:
        await _devolver_modelo(lider_id, modelo_anterior)

    try:
        await cliente.chamar("chat.send", {
            "agentId": agent_id,
            "sessionKey": f"agent:{agent_id}:sistema-completar-setup",
            "message": _PEDIDO_AO_AGENTE,
            "idempotencyKey": f"hsos-{uuid4()}",
        })
    except ErroGateway as e:
        logger.error("Não consegui pedir a %s que complete o setup: %s", agent_id, e)
        return

    # ⚠️ **Alguém tem que fechar o `configuring`.** Até aqui ninguém fechava: a
    # `iris` ficou pronta, funcionando, e o banco dizia "configurando" para
    # sempre. Estado que nunca muda é pior que estado errado — ninguém
    # desconfia dele.
    async with sessao(role="service_role") as conn:
        await conn.execute(
            "UPDATE public.agent_profiles SET status = 'active', updated_at = now() "
            " WHERE openclaw_id = $1 AND status = 'configuring'",
            agent_id,
        )
    logger.info("Agente %s completou o setup e está ativo.", agent_id)


# As travas que todo especialista carrega. A orquestradora não recebe: coordenar
# o time e escrever skill é o trabalho dela.
_TRAVAS_DE_ESPECIALISTA = ("sessions_send", "sessions_spawn", "skill_workshop")

# O roster do time no `AGENTS.md` da orquestradora, entre marcadores. Mesmo
# padrão do bloco da empresa, e pelo mesmo motivo: é dado, não redação.
_ROSTER_INICIO = "<!-- hsos:roster:inicio -->"
_ROSTER_FIM = "<!-- hsos:roster:fim -->"


async def _liberar_entre_agentes(agent_id: str) -> None:
    """Põe o agente no `tools.agentToAgent.allow`.

    ⚠️ **`allow` lista quem PARTICIPA, não quem recebe** — os dois lados
    precisam estar nela. Agente fora da lista não é alcançável **nem alcança**,
    e a recusa não chega a quem perguntou: em 17/08/2026 o `flow` nasceu de fora
    e a orquestradora simplesmente não conseguia acioná-lo.
    """
    from app.gateway import patch as patch_gw

    parsed, base_hash = await patch_gw.config_do_gateway()
    a2a = dict(((parsed.get("tools") or {}).get("agentToAgent")) or {})
    atual = list(a2a.get("allow") or [])
    if agent_id in atual:
        return
    novo = sorted(set(atual) | {agent_id})
    await patch_gw.aplicar_patch(
        {"tools": {"agentToAgent": {"enabled": True, "allow": novo}}}, base_hash,
        conferir=lambda c: agent_id in (
            (((c.get("tools") or {}).get("agentToAgent")) or {}).get("allow") or []
        ),
    )
    logger.info("Agente %s liberado no agentToAgent", agent_id)


async def _atualizar_roster_do_lider(lider_id: str | None) -> None:
    """Reescreve, no `AGENTS.md` da orquestradora, a tabela de quem é quem.

    ⚠️ **Ninguém atualizava o roster DELA.** A orquestradora escreve os sete
    arquivos do agente novo — inclusive o roster que ele recebe — e o próprio
    fica velho. Em 17/08/2026 o `flow` nasceu e a `nina` não sabia que ele
    existia: pergunta de operação ficava sem dono, ou ela tentava responder
    sozinha.

    ⚠️ **Isto NÃO substitui a tabela de roteamento dela, e a primeira versão
    substituía.** A tabela escrita à mão tem a coluna "Não é dele", que é a que
    de fato evita roteamento errado — "faturamento é da Iris, pipeline é do
    Atlas". Gerada a partir de `specialty`, ela virou *"Gerente do comercial."*
    e a coluna sumiu: automação que piorou o conteúdo.

    Roteamento é **editorial**; presença é **dado**. O que se automatiza aqui é
    só a presença — a lista de quem existe, para que agente novo nunca fique
    invisível para quem coordena. A tabela com a nuance continua sendo dela, e
    fica fora dos marcadores.
    """
    if not lider_id:
        return
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT COALESCE(NULLIF(openclaw_id,''), agent_id) AS oid, name, specialty, "
            "       description, is_leader "
            "  FROM public.agent_profiles "
            " WHERE status IS DISTINCT FROM 'inactive' ORDER BY is_leader DESC, name"
        )
    if not linhas:
        return

    nomes = [f"`{l['oid']}` ({l['name']})" for l in linhas if not l["is_leader"]]
    if not nomes:
        return
    corpo = (
        "**Agentes vivos hoje:** " + ", ".join(nomes) + ".\n\n"
        "Esta linha é gerada pelo sistema a cada agente criado — serve só para "
        "nenhum ficar invisível para você. Quem faz o quê, e o que **não** é de "
        "cada um, está na tabela acima, que é escrita à mão."
    )
    bloco = f"{_ROSTER_INICIO}\n{corpo}\n{_ROSTER_FIM}"

    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    r = await cli.chamar("agents.files.get", {"agentId": lider_id, "name": "AGENTS.md"})
    atual = ((r.get("payload") or r).get("file") or {}).get("content") or ""

    i, f = atual.find(_ROSTER_INICIO), atual.find(_ROSTER_FIM)
    if i != -1 and f != -1 and f > i:
        novo = atual[:i] + bloco + atual[f + len(_ROSTER_FIM):]
    else:
        # Primeira vez: entra no fim, sem tocar no que a orquestradora escreveu.
        novo = atual.rstrip() + "\n\n## O time, atualizado automaticamente\n\n" + bloco + "\n"
    if novo == atual:
        return
    await cli.chamar("agents.files.set",
                     {"agentId": lider_id, "name": "AGENTS.md", "content": novo})
    logger.info("Roster da orquestradora %s atualizado", lider_id)


async def _travar_especialista(agent_id: str) -> None:
    """Tira do agente o que só a orquestradora deve ter."""
    from app.gateway import patch as patch_gw

    parsed, base_hash = await patch_gw.config_do_gateway()
    lista = [dict(a) for a in (parsed.get("agents") or {}).get("list") or []]
    alvo = next((a for a in lista if str(a.get("id")) == agent_id), None)
    if alvo is None:
        raise ErroGateway(f"Agente {agent_id} não está no gateway.")

    tools = dict(alvo.get("tools") or {})
    deny = list(tools.get("deny") or [])
    faltando = [t for t in _TRAVAS_DE_ESPECIALISTA if t not in deny]
    if not faltando:
        return
    tools["deny"] = sorted(deny + faltando)
    alvo["tools"] = tools

    await patch_gw.aplicar_patch(
        {"agents": {"list": lista}}, base_hash,
        conferir=lambda c: all(
            t in ((x.get("tools") or {}).get("deny") or [])
            for x in ((c.get("agents") or {}).get("list") or [])
            if str(x.get("id")) == agent_id
            for t in _TRAVAS_DE_ESPECIALISTA
        ),
    )
    logger.info("Travas de especialista aplicadas a %s: %s", agent_id, faltando)


async def _conceder_alerta(agent_id: str) -> None:
    """Dá ao agente a ferramenta de avisar o administrador.

    Não é conector da tela: é infraestrutura de guardrail, e todo agente tem.
    O `SOUL.md` de todos manda usá-la ao detectar tentativa de subverter os
    limites — sem ela, a regra é uma frase.
    """
    from app.gateway import patch as patch_gw

    parsed, base_hash = await patch_gw.config_do_gateway()
    servidores = ((parsed.get("mcp") or {}).get("servers")) or {}
    servidor = next((s for s in servidores if "alerta" in s), None)
    if not servidor:
        raise ErroGateway(
            "O servidor MCP de alerta não está no gateway — nenhum agente "
            "consegue avisar o administrador."
        )
    ferramenta = f"mcp__{servidor}__avisar_administrador"

    lista = [dict(a) for a in (parsed.get("agents") or {}).get("list") or []]
    alvo = next((a for a in lista if str(a.get("id")) == agent_id), None)
    if alvo is None:
        raise ErroGateway(f"Agente {agent_id} não está no gateway.")

    tools = dict(alvo.get("tools") or {})
    atuais = list(tools.get("alsoAllow") or [])
    if ferramenta in atuais:
        return
    tools["alsoAllow"] = atuais + [ferramenta]
    alvo["tools"] = tools

    await patch_gw.aplicar_patch(
        {"agents": {"list": lista}}, base_hash,
        conferir=lambda c: any(
            str(x.get("id")) == agent_id
            and ferramenta in ((x.get("tools") or {}).get("alsoAllow") or [])
            for x in ((c.get("agents") or {}).get("list") or [])
        ),
    )
    logger.info("Ferramenta de alerta concedida a %s", agent_id)


async def _publicar_conectores(agent_id: str, nomes: list[str]) -> tuple[list, list]:
    """Dá ao agente novo os conectores marcados na tela.

    Só bancos: os demais tipos de conector ainda são consumidos por segredo
    compartilhado, não por ferramenta, e publicá-los não significaria nada.

    ⚠️ **Falha aqui não desfaz a criação.** O agente existe, os arquivos foram
    escritos, e o conector é recuperável com dois cliques na tela de Conectores.
    Desfazer tudo por causa disso trocaria um problema pequeno e visível por um
    grande. Mas o resultado volta na resposta, nomeado — silêncio aqui seria
    repetir o defeito que esta função existe para corrigir.
    """
    from app.routers.integracoes import publicar_banco

    publicados: list[str] = []
    falhos: list[dict] = []
    if not nomes:
        return publicados, falhos

    async with sessao(role="service_role") as conn:
        # ⚠️ **A tela manda o `key_name`, não o `name`.** O seletor de
        # integrações grava `HSGROWTH_DB` e `DIRETORIO_DB`; a coluna `name` tem
        # "HSGrowth" e "Diretório HS.OS". Casar só por `name` não achava nada — e
        # como "não achei" não é falha (conector de API cai aqui e é ignorado de
        # propósito), o `atlas` nasceu sem ferramenta nenhuma e sem aviso.
        #
        # Aceitar os dois é mais barato que descobrir qual a tela manda hoje: se
        # ela mudar amanhã, continua funcionando.
        linhas = await conn.fetch(
            "SELECT id::text AS id, name FROM public.integrations "
            " WHERE integration_type = 'database' "
            "   AND (name = ANY($1::text[]) OR key_name = ANY($1::text[]))",
            nomes,
        )
        achados = {l["name"]: l["id"] for l in linhas}

        # ⚠️ Itera o que foi ACHADO, não o que foi pedido. O dicionário é
        # indexado por `name` ("HSGrowth") e a tela manda `key_name`
        # ("HSGROWTH_DB") — procurar por `nomes` aqui nunca casava, o UPDATE não
        # rodava, e o `atlas` nasceu sem ferramenta enquanto a função relatava
        # sucesso. Conector que não é banco simplesmente não entra em `achados`.
        for ident in achados.values():
            # `agents_using` é a fonte de quem tem acesso; o publicar lê dela.
            await conn.execute(
                "UPDATE public.integrations "
                "   SET agents_using = array_append(agents_using, $2), updated_at = now() "
                " WHERE id = $1::uuid AND NOT ($2 = ANY(agents_using))",
                ident, agent_id,
            )

    for nome, ident in achados.items():
        try:
            await publicar_banco(ident, _=None)  # type: ignore[arg-type]
            publicados.append(nome)
        except Exception as e:  # noqa: BLE001
            detalhe = getattr(e, "detail", None) or str(e)
            logger.error("Conector %s não publicado para %s: %s", nome, agent_id, detalhe)
            falhos.append({"conector": nome, "motivo": str(detalhe)[:300]})

    return publicados, falhos


async def _desfazer_criacao(openclaw_id: str) -> None:
    """Apaga o que a criação já tinha feito, quando ela não pôde terminar.

    Best-effort de propósito, e na ordem inversa da criação: primeiro o
    gateway, depois o banco. Se um dos dois falhar, o outro é limpo mesmo
    assim — sobra menos lixo do que abortar no meio do desfazer.

    O `agent_creation_log` **fica**: é a trilha de que a tentativa existiu, e
    apagá-la esconderia justamente o que se quer investigar depois.
    """
    try:
        c = await cfg.carregar()
        if c.configurado:
            await obter_cliente(c.url, c.token).chamar("agents.delete", {"agentId": openclaw_id})
            logger.info("Desfazendo: %s removido do gateway.", openclaw_id)
    except ErroGateway as e:
        logger.warning("Desfazendo: gateway não removeu %s: %s", openclaw_id, e)

    try:
        async with sessao(role="service_role") as conn:
            await conn.execute("DELETE FROM public.agent_profiles WHERE agent_id = $1", openclaw_id)
        logger.info("Desfazendo: %s removido do banco.", openclaw_id)
    except Exception as e:  # noqa: BLE001
        logger.error("Desfazendo: banco não removeu %s: %s", openclaw_id, e)


@router.post("", response_model=AgenteNovoOut, status_code=status.HTTP_201_CREATED)
async def criar(
    dados: AgenteNovoIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Registra o agente no gateway, grava o perfil e manda o orquestrador montá-lo.

    **Gateway primeiro**, como no `PATCH`: se `agents.create` falhar, nada é
    gravado. O contrário deixaria um perfil apontando para um agente que não
    existe do outro lado — visível na tela, impossível de usar.

    O agente nasce com `status = 'configuring'`: quem termina de montá-lo é o
    orquestrador, e até lá a tela mostra o estado \"configurando\" em vez de
    fingir que está pronto.
    """
    if not re.match(r"^[a-z0-9-]{2,32}$", dados.openclaw_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "openclaw_id inválido: use letras minúsculas, números e hífen (2 a 32).",
        )
    if dados.access_type not in _ACESSOS:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"access_type inválido. Use um de: {', '.join(sorted(_ACESSOS))}.",
        )

    async with sessao(role="service_role") as conn:
        if await conn.fetchval(
            "SELECT 1 FROM public.agent_profiles WHERE agent_id = $1", dados.openclaw_id
        ):
            raise HTTPException(
                status.HTTP_409_CONFLICT, "Já existe um agente com este identificador."
            )

    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        # ⚠️ **`model` e `emoji` vão aqui, e não só para o nosso banco.** Até
        # 14/08/2026 mandávamos apenas nome e workspace: o agente nascia com
        # `model: null` no gateway e não respondia nada, enquanto
        # `agent_profiles.model` dizia `anthropic/claude-sonnet-4-6`. Os dois
        # lados discordando, e o lado que executa era o vazio.
        #
        # Confirmado que o schema aceita os dois — sondado em 14/08. (E sondar
        # custou caro: `agents.create` CRIA mesmo com workspace inexistente, ao
        # contrário do que eu supunha. Não sonde escrita neste método.)
        await obter_cliente(c.url, c.token).chamar(
            "agents.create", {
                "name": dados.name,
                "workspace": dados.workspace,
                "model": dados.model,
                "emoji": dados.emoji,
            }
        )
    except ErroGateway as e:
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"O gateway recusou a criação e nada foi salvo: {e}",
        )

    permitidos = [UUID(str(u)) for u in dados.allowed_user_ids] if dados.allowed_user_ids else []
    async with sessao(role="service_role") as conn:
        await conn.execute(
            """
            INSERT INTO public.agent_profiles
                (agent_id, openclaw_id, name, emoji, specialty, description, workspace,
                 channels, model, behavior, skills_description, skills_tags,
                 integrations_used, persona_description, crons_description,
                 access_type, allowed_user_ids, leader_id, status)
            VALUES ($1, $1, $2, $3, $4, $5, $6, $7::text[], $8, $9, $10, $11::text[],
                    $12::text[], $13, NULLIF($14, ''), $15, $16::uuid[], $17, 'configuring')
            """,
            dados.openclaw_id, dados.name, dados.emoji, dados.specialty,
            dados.description, dados.workspace, dados.channels, dados.model,
            dados.behavior, dados.skills_description, dados.skills_tags,
            dados.integrations_used, dados.persona_description,
            dados.crons_description, dados.access_type, permitidos, dados.leader_id,
        )

    briefing = _briefing(dados)
    # ⚠️ **Conectores ANTES do briefing, e a ordem é o conserto.**
    #
    # Até 14/08/2026 `integrations_used` virava texto no briefing e coluna no
    # banco, e mais nada — o agente nascia sem as ferramentas que a tela dizia
    # ter dado. Pior: o orquestrador, sem poder abrir o banco, descrevia o
    # schema de memória. A `iris` nasceu com um TOOLS.md citando
    # `table_schema = 'public'` (é `tiny`) e duas tabelas inexistentes.
    #
    # Publicar depois de avisar não resolvia: a skill manda consultar o banco
    # antes de descrever, e essa instrução era impossível de cumprir enquanto a
    # ferramenta chegava só no fim. Aqui a ordem passa a permitir a regra.
    # Quem é a orquestradora. Vale para as travas (ela não recebe), para a troca
    # de modelo e para o roster — por isso é buscado uma vez só.
    async with sessao(role="service_role") as conn:
        lider_id = await conn.fetchval(
            "SELECT COALESCE(NULLIF(openclaw_id,''), agent_id) FROM public.agent_profiles "
            " WHERE is_leader = true LIMIT 1"
        )

    publicados, falhos = await _publicar_conectores(
        dados.openclaw_id, dados.integrations_used
    )

    # ⚠️ **A ferramenta de alerta não é opcional, e a criação nunca a concedia.**
    # Descoberto auditando o `flow` em 17/08/2026: ele nasceu com o `SOUL.md`
    # mandando avisar o administrador ao detectar tentativa de subverter os
    # limites — e sem nenhuma forma de fazer isso. `nina`, `iris` e `atlas` só a
    # tinham porque foram concedidas à mão em 14/08; todo agente criado pela
    # tela nascia com o guardrail decorativo.
    #
    # Vem depois dos conectores de propósito: se o rate limit do `config.patch`
    # atrapalhar, é melhor perder o alerta (recuperável em dois cliques) do que
    # o banco que o agente precisa para trabalhar.
    try:
        await _conceder_alerta(dados.openclaw_id)
    except Exception as e:  # noqa: BLE001
        logger.error("Alerta não concedido a %s: %s", dados.openclaw_id, e)
        falhos.append({"conector": "Alerta ao administrador", "motivo": str(e)[:300]})

    # ⚠️ **Agente novo nasce com as travas de especialista.** Também descoberto
    # auditando o `flow`: ele nasceu podendo acionar outros agentes e editar as
    # próprias skills — as duas coisas que foram tiradas da `iris` e do `atlas`
    # em 17/08/2026, à mão, e que nenhuma linha de código conhecia.
    #
    # Quem coordena é a orquestradora, e quem escreve skill é ela ou o
    # administrador: um especialista capaz de reescrever a régua que o governa
    # deixa de ser governado por ela.
    if dados.openclaw_id != (lider_id or ''):
        try:
            await _travar_especialista(dados.openclaw_id)
        except Exception as e:  # noqa: BLE001
            logger.error("Travas de especialista não aplicadas a %s: %s", dados.openclaw_id, e)
            falhos.append({"conector": "Travas de especialista", "motivo": str(e)[:300]})

    # Sem isto o agente nasce inalcançável pela orquestradora, e a recusa não
    # chega a quem perguntou.
    try:
        await _liberar_entre_agentes(dados.openclaw_id)
    except Exception as e:  # noqa: BLE001
        logger.error("Agente %s não entrou no agentToAgent: %s", dados.openclaw_id, e)
        falhos.append({"conector": "Conversa entre agentes", "motivo": str(e)[:300]})

    # E sem isto a orquestradora não sabe que ele existe.
    try:
        await _atualizar_roster_do_lider(lider_id)
    except Exception as e:  # noqa: BLE001
        logger.error("Roster da orquestradora não atualizado: %s", e)
        falhos.append({"conector": "Roster da orquestradora", "motivo": str(e)[:300]})

    async with sessao(role="service_role") as conn:
        # Trilha do que foi pedido ao orquestrador. Sem isto não há como saber
        # depois por que um agente nasceu diferente do que se esperava.
        await conn.execute(
            "INSERT INTO public.agent_creation_log (agent_id, briefing) VALUES ($1, $2)",
            dados.openclaw_id, briefing,
        )

    # ⚠️ **Briefing não entregue desfaz a criação inteira.**
    #
    # Antes daqui saía `orquestrador_avisado: false` e o agente ficava. Só que
    # `_avisar_lider` **nunca levanta** — está no docstring dela —, então o
    # `except` era código morto e o campo vinha `true` sempre. Em 12/08/2026 um
    # agente foi criado assim: a tela disse "criado", ele apareceu na lista com
    # status `configuring`, e nasceu com o template em branco do OpenClaw
    # porque o orquestrador jamais foi avisado.
    #
    # Agente sem alma é pior que erro na criação: o erro a pessoa vê e refaz;
    # o agente vazio fica na lista parecendo pronto. Por isso, aqui, falha na
    # entrega desfaz o que já foi feito — no gateway e no banco — e devolve
    # 502 dizendo o que houve.
    # A orquestradora escreve os sete arquivos do agente novo, que é a tarefa
    # mais difícil que ela faz — vai num modelo melhor e volta ao dela depois.
    modelo_anterior = None
    try:
        if lider_id:
            modelo_anterior = await _trocar_modelo(lider_id, _MODELO_PARA_CRIAR)
    except Exception as e:  # noqa: BLE001
        # Não conseguir trocar o modelo não impede criar o agente: ele nasce no
        # modelo de sempre, que é o comportamento de antes desta melhoria.
        logger.warning("Segui no modelo atual da orquestradora: %s", e)
        modelo_anterior = None

    try:
        sessao_lider = await _avisar_lider_ou_falhar(
            f"create-agent:{dados.openclaw_id}", briefing
        )
    except ErroGateway as e:
        if lider_id:
            await _devolver_modelo(lider_id, modelo_anterior)
        logger.error("Briefing de %s não entregue — desfazendo: %s", dados.openclaw_id, e)
        await _desfazer_criacao(dados.openclaw_id)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"O agente não foi criado: não consegui avisar o orquestrador ({e}). "
            "Nada ficou pela metade — nem no gateway, nem aqui. Verifique se o "
            "agente líder está de pé e tente de novo.",
        ) from e

    # A segunda etapa vai para segundo plano: o orquestrador demora minutos e a
    # tela não pode esperar por ele.
    asyncio.create_task(
        _completar_agente(dados.openclaw_id, sessao_lider, lider_id, modelo_anterior)
    )

    logger.info("Agente %s criado por administrador", dados.openclaw_id)
    return AgenteNovoOut(
        agent_id=dados.openclaw_id, criado_no_gateway=True, orquestrador_avisado=True,
        conectores_publicados=publicados, conectores_com_falha=falhos,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Reenvio de briefing — portado de `resend-agent-briefing`
# ─────────────────────────────────────────────────────────────────────────────


@router.post("/{agent_id}/briefing", status_code=status.HTTP_202_ACCEPTED)
async def reenviar_briefing(
    agent_id: str,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Manda o orquestrador refazer os arquivos do agente no VPS.

    Existe para quando o onboarding não terminou, ou os arquivos foram perdidos:
    remonta o briefing a partir do perfil **atual** — não do que foi mandado na
    criação. Se alguém editou a persona depois, o reenvio leva a versão nova.
    """
    async with sessao(role="service_role") as conn:
        a = await conn.fetchrow(
            "SELECT agent_id, name, emoji, model, workspace, channels, specialty, "
            "skills_description, skills_tags, integrations_used, persona_description, "
            "behavior, crons_description FROM public.agent_profiles WHERE agent_id = $1",
            agent_id,
        )
    if a is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")

    integracoes = ", ".join(a["integrations_used"] or []) or "Nenhuma selecionada"
    crons = (
        f'AUTOMAÇÕES:\n"{a["crons_description"]}"' if a["crons_description"]
        else "Sem automações configuradas."
    )
    mensagem = (
        f"🤖 REENVIO DE BRIEFING — REEXECUTE O ONBOARDING DO AGENTE {a['name']}\n\n"
        "⚠️ INSTRUÇÃO CRÍTICA: você DEVE executar as ferramentas (SSH/file write) "
        "para criar/atualizar os arquivos no VPS. NÃO responda apenas com texto — "
        "EXECUTE. Ao final, liste cada arquivo criado/atualizado com o caminho "
        "completo.\n\n"
        "Dados técnicos:\n"
        f"- ID: {a['agent_id']}\n"
        f"- Nome: {a['name']} {a['emoji'] or ''}\n"
        f"- Modelo: {a['model']}\n"
        f"- Workspace: {a['workspace']}\n"
        f"- Canais: {', '.join(a['channels'] or ['webchat'])}\n\n"
        f"Especialidade: {a['specialty'] or a['skills_description'] or 'Não definida'}\n"
        f"Tags: {', '.join(a['skills_tags'] or []) or 'Nenhuma'}\n"
        f"Integrações: {integracoes}\n\n"
        f'PERSONA:\n"{a["persona_description"] or "Não definida — use a especialidade como referência"}"\n\n'
        f'Restrições:\n"{a["behavior"] or "Nenhuma definida"}"\n\n'
        f"{crons}\n\n"
        f"Verifique se SOUL.md, IDENTITY.md, TOOLS.md, AGENTS.md, MEMORY.md e "
        f"HEARTBEAT.md existem no workspace {a['workspace']}. Se não existirem, crie. "
        "Se existirem mas estiverem incompletos, atualize. Confirme no "
        "AGENTS_DIRECTORY.md, reinicie o gateway e liste os arquivos "
        "criados/atualizados."
    )

    async with sessao(role="service_role") as conn:
        await conn.execute(
            "INSERT INTO public.agent_creation_log (agent_id, briefing) VALUES ($1, $2)",
            agent_id, mensagem,
        )
    await _avisar_lider(f"resend-briefing:{agent_id}", mensagem)
    logger.info("Briefing de %s reenviado ao orquestrador", agent_id)
    return {"ok": True, "agent_id": agent_id}


# ─────────────────────────────────────────────────────────────────────────────
# Arquivos do workspace do agente — portado de `gateway-files-proxy`
# ─────────────────────────────────────────────────────────────────────────────
#
# A edge existia porque o navegador não alcança o gateway direto (CORS, e o
# token não pode ir ao cliente). Aqui o motivo é o mesmo, só que o proxy é nosso.
#
# ⚠️ **Não há remoção.** A edge chamava `agents.files.delete`, e o gateway
# responde `unknown method` — confirmado em 07/08/2026. O método não existe.
# Para "apagar", grave conteúdo vazio.


class ArquivoWorkspaceOut(BaseModel):
    name: str
    path: str | None = None
    size: int | None = None
    missing: bool = False


class ConteudoOut(BaseModel):
    name: str
    content: str
    size: int | None = None


class GravarArquivoIn(BaseModel):
    content: str


@router.get("/{agent_id}/arquivos", response_model=list[ArquivoWorkspaceOut])
async def listar_arquivos(agent_id: str, _: Usuario = Depends(exige_papel("administrador"))):
    """Os arquivos canônicos do agente: SOUL, IDENTITY, TOOLS, AGENTS, MEMORY…"""
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        r = await obter_cliente(c.url, c.token).chamar(
            "agents.files.list", {"agentId": agent_id}
        )
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    return [
        ArquivoWorkspaceOut(
            name=f.get("name", ""), path=f.get("path"),
            size=f.get("size"), missing=bool(f.get("missing")),
        )
        for f in (r.get("files") or [])
        if f.get("name")
    ]


@router.get("/{agent_id}/arquivos/{nome}", response_model=ConteudoOut)
async def ler_arquivo(agent_id: str, nome: str, _: Usuario = Depends(exige_papel("administrador"))):
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        r = await obter_cliente(c.url, c.token).chamar(
            "agents.files.get", {"agentId": agent_id, "name": nome}
        )
    except ErroGateway as e:
        msg = str(e).lower()
        # O gateway responde `unsupported file "X"` — ele só aceita os nomes
        # canônicos (SOUL.md, IDENTITY.md, …), não um caminho qualquer. Isso é
        # pedido inválido, não falha nossa: 404 em vez de 502.
        if any(x in msg for x in ("unsupported file", "not found", "no such")):
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                f'O gateway não reconhece o arquivo "{nome}". Use os nomes '
                "canônicos que o GET /agents/{id}/arquivos lista.",
            )
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    arquivo = r.get("file") or {}
    return ConteudoOut(
        name=arquivo.get("name") or nome,
        content=arquivo.get("content") or "",
        size=arquivo.get("size"),
    )


@router.put("/{agent_id}/arquivos/{nome}", status_code=status.HTTP_204_NO_CONTENT)
async def gravar_arquivo(
    agent_id: str,
    nome: str,
    dados: GravarArquivoIn,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    """Escreve o arquivo no workspace do agente.

    Só `administrador`: estes arquivos são a identidade e as instruções do agente
    — quem os edita muda como ele se comporta com todo mundo.
    """
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "Gateway não configurado.")
    try:
        await obter_cliente(c.url, c.token).chamar(
            "agents.files.set", {"agentId": agent_id, "name": nome, "content": dados.content}
        )
    except ErroGateway as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(e))
    logger.info("Arquivo %s de %s gravado por %s", nome, agent_id, usuario.id)


# ─────────────────────────────────────────────────────────────────────────────
# Quem pode falar com o agente — portado de `update-agent-access`
# ─────────────────────────────────────────────────────────────────────────────

_TIPOS_ACESSO = {"all", "admins_only", "specific_users"}


class AcessoIn(BaseModel):
    access_type: str
    allowed_user_ids: list[str] = []
    agent_name: str | None = None


class AcessoOut(BaseModel):
    agent_id: str
    access_type: str
    allowed_user_ids: list[str]


@router.put("/{agent_id}/acesso", response_model=AcessoOut)
async def definir_acesso(
    agent_id: str,
    dados: AcessoIn,
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Define quem enxerga e conversa com o agente.

    A lista de autorizados só faz sentido em `specific_users` e é **zerada** nos
    outros dois modos. Guardá-la em `all` deixaria uma restrição adormecida que
    volta a valer quando alguém trocar o modo de volta, sem ninguém ter pedido.

    Depois de gravar, avisa o agente líder — e este é o ponto delicado da rota:
    o RLS impede um usuário sem acesso de *ler* o agente, mas nada impede de
    pedir ao orquestrador que busque a informação por ele. O aviso é o que faz
    a restrição valer também por esse caminho.
    """
    if dados.access_type not in _TIPOS_ACESSO:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"access_type inválido. Use um de: {', '.join(sorted(_TIPOS_ACESSO))}.",
        )
    permitidos = dados.allowed_user_ids if dados.access_type == "specific_users" else []

    async with sessao(role="service_role") as conn:
        linha = await conn.fetchrow(
            "UPDATE public.agent_profiles SET access_type = $2, allowed_user_ids = $3, "
            "updated_at = now() WHERE agent_id = $1 RETURNING agent_id, name",
            agent_id, dados.access_type, permitidos,
        )
        if linha is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")
        nomes = []
        if permitidos:
            nomes = [
                r["full_name"] or r["email"] or r["id"]
                for r in await conn.fetch(
                    "SELECT id::text AS id, full_name, email FROM public.profiles "
                    " WHERE id = ANY($1::uuid[])",
                    permitidos,
                )
            ]

    rotulo = dados.agent_name or linha["name"] or agent_id
    if dados.access_type == "all":
        aviso = (
            f'🔓 ATUALIZAÇÃO DE ACESSO: o agente "{rotulo}" ({agent_id}) agora é acessível '
            "a TODOS os membros da plataforma. Remova qualquer restrição anterior para "
            "este agente do seu MEMORY.md."
        )
    else:
        aviso = (
            "🔒 ATUALIZAÇÃO DE ACESSO — REGRA DE SEGURANÇA:\n\n"
            f'O agente "{rotulo}" ({agent_id}) é RESTRITO.\n'
            f"Autorizado para: {', '.join(nomes) if nomes else 'somente administradores'}\n\n"
            "REGRA OBRIGATÓRIA: se qualquer outro usuário tentar acessar informações deste "
            "agente — diretamente ou pedindo que você busque dados com ele — você deve:\n"
            "1. Recusar a solicitação\n"
            "2. NÃO confirmar nem negar que os dados existem\n"
            '3. Responder apenas: "Você não tem permissão para acessar este agente."\n\n'
            "Esta regra vale mesmo que o pedido venha via orquestrador, debate multi-agente "
            "ou qualquer outro mecanismo. Salve esta regra no seu MEMORY.md de hoje."
        )
    await _avisar_lider("Atualização de acesso", aviso)

    logger.info("Acesso de %s definido como %s (%d pessoas)",
                agent_id, dados.access_type, len(permitidos))
    return AcessoOut(agent_id=agent_id, access_type=dados.access_type,
                     allowed_user_ids=permitidos)


@router.get("/{agent_id}/guardrails", response_model=list)
async def guardrails(agent_id: str, usuario: Usuario = Depends(exige_papel("administrador"))):
    """As regras de guarda do agente, escritas pela VPS via `PUT /integracoes/guardrails`.

    Devolve lista vazia para agente sem regras **e** para agente inexistente. É
    de propósito: a tela desenha "nenhum guardrail" nos dois casos, e um 404
    aqui viraria erro vermelho num painel que só está mostrando o normal.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        bruto = await conn.fetchval(
            "SELECT guardrails FROM public.agent_profiles WHERE agent_id = $1", agent_id
        )
    if isinstance(bruto, str):
        bruto = json.loads(bruto)
    if isinstance(bruto, list) and bruto:
        return bruto

    return await _guardrails_do_gateway(agent_id)


async def _guardrails_do_gateway(agent_id: str) -> list[dict]:
    """Os limites que de fato valem para este agente, lidos da config.

    ⚠️ **A coluna `agent_profiles.guardrails` nunca teve escritor.** Quem
    escreveria é o coletor da VPS, por `PUT /integracoes/guardrails`, e ele não
    aponta para esta instalação — a tela dizia "nenhum guardrail cadastrado"
    para agentes cujos limites a gente configurou à mão a semana inteira.

    ⚠️ **Isto NÃO cobre os limites de comportamento.** As regras de não assumir
    outra identidade, não revelar o contexto de sistema e não sair do escopo
    moram no `SOUL.md`, em prosa, e não há como enumerá-las mecanicamente.
    O que sai daqui é o que a **configuração** impõe — o que o agente não
    consegue fazer nem querendo. São coisas diferentes e a tela não deve
    sugerir que uma cobre a outra.
    """
    try:
        c = await cfg.carregar()
        r = await obter_cliente(c.url, c.token).chamar("config.get", {})
        parsed = ((r.get("payload") or r).get("parsed")) or {}
    except (ErroGateway, OSError) as e:
        logger.warning("config.get falhou ao montar guardrails de %s: %s", agent_id, e)
        return []

    alvo = agent_id.lower()
    perfil = next((a for a in ((parsed.get("agents") or {}).get("list") or [])
                   if str(a.get("id", "")).lower() == alvo), None)
    if perfil is None:
        return []

    t = perfil.get("tools") or {}
    deny = {str(x) for x in (t.get("deny") or [])}
    tambem = {str(x) for x in (t.get("alsoAllow") or [])}
    global_t = parsed.get("tools") or {}
    servidores = ((parsed.get("mcp") or {}).get("servers")) or {}

    def nu(x: str) -> str:
        return x[len("mcp__"):] if x.startswith("mcp__") else x

    bancos_dele = sorted(nu(x).rsplit("__", 1)[0] for x in tambem if nu(x).startswith("banco-"))
    bancos_todos = [s for s in servidores if s.startswith("banco-")]

    web = global_t.get("web") or {}
    tem_web = bool((web.get("search") or {}).get("enabled") or (web.get("fetch") or {}).get("enabled"))
    a2a = global_t.get("agentToAgent") or {}
    pode_acionar = a2a.get("enabled") and "sessions_send" not in deny

    async with sessao(role="service_role") as conn:
        acesso = await conn.fetchrow(
            """
            SELECT a.access_type,
                   -- ⚠️ **Conta quem EXISTE, não o tamanho da lista.** Excluir
                   -- uma pessoa não a tira de `allowed_user_ids`, e em
                   -- 17/08/2026 o Atlas tinha 11 ids com 2 pessoas vivas — o
                   -- painel anunciava "só 11 autorizadas" para um agente que
                   -- 9 daquelas pessoas não podiam mais nem abrir.
                   (SELECT count(*) FROM unnest(a.allowed_user_ids) u
                     WHERE EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = u))
                     AS pessoas
              FROM public.agent_profiles a WHERE a.agent_id = $1
            """,
            agent_id,
        )
    tipo_acesso = (acesso or {}).get("access_type") or "all"
    quantos = (acesso or {}).get("pessoas") or 0

    lista_skills = perfil.get("skills")

    # ⚠️ **Nome FIXO, e `active` = a proteção está em vigor.** Duas tentativas
    # antes desta, e as duas erradas por motivos opostos:
    #
    # 1. Nome fixo de restrição + descrição alarmada: a `nina`, que **deve**
    #    acionar agentes e **deve** ter o `skill_workshop`, aparecia com dois
    #    ⚠️ como se estivesse quebrada.
    # 2. Nome variável ("Aciona" para a nina, "Não aciona" para a iris): sumiu
    #    o defeito, e sumiu junto a comparação — não dá para bater um agente
    #    contra o outro se as linhas mudam de nome, e `active` passa a
    #    significar coisas opostas conforme a linha.
    #
    # A saída é nome fixo, `active` quando a proteção vale, e a **descrição**
    # dizendo que o desligamento é deliberado quando for. Num painel chamado
    # Guardrails, verde tem que ser "protegido" — e a orquestradora ter duas
    # proteções a menos é fato relevante, que deve saltar aos olhos em vez de
    # ser dissolvido numa mudança de rótulo.
    def regra(nome, desc, categoria, ok):
        return {"name": nome, "description": desc, "category": categoria,
                "status": "active" if ok else "inactive"}

    orquestra = bool(perfil.get("is_leader")) or alvo == "nina"

    return [
        regra("Sem acesso à internet",
              "Busca e leitura de páginas estão desligadas no gateway, para todos."
              if not tem_web else
              "A busca ou a leitura de páginas está LIGADA para todos os agentes.",
              "internet", not tem_web),

        regra("Não aciona outros agentes",
              "Responde quando a orquestradora chama, mas não inicia — a ferramenta "
              "sessions_send foi removida deste agente."
              if not pode_acionar else
              ("Desligado de propósito: é a orquestradora, e coordenar o time é o "
               "trabalho dela." if orquestra else
               "Este agente inicia conversa com outros. Fora da orquestradora, isso "
               "vira grafo de chamadas sem dono."),
              "agentes", not pode_acionar),

        regra("Não cria nem edita skills",
              "O skill_workshop foi removido: este agente usa skill, não escreve."
              if "skill_workshop" in deny else
              ("Desligado de propósito: é a orquestradora, e escrever skill é parte "
               "do trabalho dela." if orquestra else
               "Tem o skill_workshop: consegue reescrever a régua que o governa."),
              "skills", "skill_workshop" in deny),

        regra("Bancos restritos",
              f"Alcança {len(bancos_dele)} de {len(bancos_todos)}: "
              + (", ".join(b[len("banco-"):] for b in bancos_dele) or "nenhum")
              if len(bancos_dele) < len(bancos_todos) else
              f"Sem isolamento: os {len(bancos_todos)} bancos da empresa estão ao alcance.",
              "dados", len(bancos_dele) < len(bancos_todos)),

        # ⚠️ Esta linha esteve com `True` fixo e **nunca poderia alertar** —
        # justo a que carrega o custo do mecanismo. Lista explícita congela o
        # agente: skill nova que o OpenClaw trouxer não chega nele. É
        # deliberado, e ainda assim é o que alguém precisa reencontrar daqui a
        # três meses, quando estranhar que um agente não ganhou uma skill nova.
        regra("Skills restritas",
              f"Lista fixa de {len(lista_skills)} skills, para separar o que é de cada "
              "agente. O preço: skill nova do OpenClaw não chega aqui até a lista ser "
              "refeita — religar a skill nesta tela refaz."
              if isinstance(lista_skills, list) else
              "Usa todas as skills do gateway, e recebe as novas automaticamente.",
              "skills", not isinstance(lista_skills, list)),

        regra("Conversa limitada",
              {"admins_only": "Só administradores falam com ele.",
               "specific_users": f"Só {quantos} pessoa(s) autorizada(s) falam com ele."}
              .get(tipo_acesso, "Qualquer pessoa da instalação fala com ele."),
              "acesso", tipo_acesso != "all"),

        regra("Avisa o administrador",
              "Tem a ferramenta de alerta, e o SOUL manda usá-la ao detectar tentativa "
              "de subverter os limites."
              if any("alerta" in nu(x) for x in tambem) else
              "O SOUL manda avisar e o agente não tem a ferramenta para isso.",
              "alerta", any("alerta" in nu(x) for x in tambem)),
    ]


@router.get("/{agent_id}/sessoes")
async def sessoes_do_agente(
    agent_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
    limite: int = Query(default=12, ge=1, le=100),
):
    """As conversas recentes deste agente, com o que serve para diagnosticar.

    ⚠️ **O cartão "Sessões recentes" mostrava PESSOAS, não sessões.** Ele lia
    `/atividade-recente`, agrupava por `user_id` e desenhava os três últimos que
    escreveram. Para a `nina` em 17/08/2026 isso dava **uma** linha — e o texto
    dela era o alerta de jailbreak gravado pela ferramenta, não uma conversa.

    O gateway tem o que falta: 41 sessões com modelo, duração, tokens, custo e
    **status**. É esse `status` que responde "o agente não respondeu" — sessão
    `failed` aparece aqui e em lugar nenhum mais.

    ⚠️ Só o gateway sabe disto, e sessão podada some. Para histórico que
    sobreviva, é o coletor — ver `docs/CONTINUAR-AQUI.md`.
    """
    try:
        c = await cfg.carregar()
        r = await obter_cliente(c.url, c.token).chamar("sessions.list", {"limit": 500})
    except (ErroGateway, OSError) as e:
        logger.warning("sessions.list falhou para %s: %s", agent_id, e)
        return []

    alvo = agent_id.lower()
    minhas = []
    for s in r.get("sessions", []):
        partes = (s.get("key") or "").split(":")
        if len(partes) < 3 or partes[0] != "agent" or partes[1].lower() != alvo:
            continue
        minhas.append((s, ":".join(partes[2:])))

    # Resolve o nome de quem conversou. O sufixo `hsos-<uuid>` é o id da pessoa
    # — é a mesma convenção que o agente usa para se situar, no `USER.md`.
    ids = {suf[len("hsos-"):] for _, suf in minhas if suf.startswith("hsos-")}
    nomes: dict[str, str] = {}
    if ids:
        async with sessao(role="service_role") as conn:
            for x in await conn.fetch(
                "SELECT id::text AS id, full_name, email FROM public.profiles "
                " WHERE id = ANY($1::uuid[])",
                list(ids),
            ):
                nomes[x["id"]] = x["full_name"] or (x["email"] or "").split("@")[0] or "Pessoa"

    saida = []
    for s, sufixo in minhas:
        quando = s.get("endedAt") or s.get("updatedAt")
        if not isinstance(quando, (int, float)):
            continue
        if sufixo.startswith("hsos-"):
            uid = sufixo[len("hsos-"):]
            rotulo, tipo = nomes.get(uid, "Pessoa desconhecida"), "dm"
        elif sufixo == "main":
            rotulo, tipo = "Sessão principal", "channel"
        else:
            # `sistema-…`, `teste-…`, disparo automático: não há pessoa do outro
            # lado, e inventar um nome aqui seria pior que mostrar a chave.
            rotulo, tipo = sufixo, "channel"

        tokens = s.get("totalTokens") or 0
        segundos = round((s.get("runtimeMs") or 0) / 1000)
        status = s.get("status")
        partes = [str(s.get("model") or "—")]
        if tokens:
            partes.append(f"{tokens // 1000}k tokens" if tokens >= 1000 else f"{tokens} tokens")
        if segundos:
            partes.append(f"{segundos}s")
        if status and status != "done":
            partes.append(status)

        saida.append({
            "key": s.get("key"),
            "kind": tipo,
            "label": rotulo,
            "preview": " · ".join(partes),
            "created_at": datetime.fromtimestamp(quando / 1000, tz=timezone.utc)
            .strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": status,
            "total_tokens": tokens,
            "cost_usd": s.get("estimatedCostUsd") or 0,
            "model": s.get("model"),
        })

    saida.sort(key=lambda x: x["created_at"], reverse=True)
    return saida[:limite]


@router.get("/{agent_id}/contexto")
async def contexto(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Quanto da janela de contexto o agente está usando, na última medição.

    Devolve `null` quando não há medição — agente recém-criado ou que ainda não
    conversou. A tela esconde o indicador nesse caso, então um 404 só criaria
    ruído para o estado normal de quem acabou de chegar.
    """
    # ⚠️ **A sessão de QUEM PERGUNTA, não a mais recente do agente.** O agente
    # tem sessão de cron, de sistema e uma por pessoa; ordenar por `updated_at`
    # entregava o contexto do briefing das 07h30 para quem estava conversando.
    # O `ORDER BY` no fim é só o recuo para quem ainda não tem sessão própria.
    minha = f"agent:{agent_id}:hsos-{usuario.id}"
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            SELECT total_tokens, context_tokens, model,
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS updated_at
              FROM public.agent_context_state
             WHERE agent_id = $1
             ORDER BY (session_key = $2) DESC, updated_at DESC
             LIMIT 1
            """,
            agent_id, minha,
        )
    return dict(linha) if linha else None


@router.get("/{agent_id}/log-criacao")
async def log_de_criacao(
    agent_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
    limite: int = Query(default=20, ge=1, le=200),
):
    """O diário do onboarding do agente, do mais recente para o mais antigo."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.agent_creation_log WHERE agent_id = $1 "
            " ORDER BY created_at DESC LIMIT $2",
            agent_id, limite,
        )
    return json.loads(json.dumps([dict(l) for l in linhas], default=str))


@router.get("/{agent_id}/arquivos-espelhados")
async def arquivos_espelhados(agent_id: str, usuario: Usuario = Depends(exige_papel("administrador"))):
    """Os arquivos do agente **como estão na tabela `agent_files`**.

    ⚠️ Não confundir com `GET /{id}/arquivos`, que lê do gateway ao vivo. Esta
    é a cópia que a ponte `dnos-files-bridge` espelha na VPS a cada 60s, e pode
    estar atrasada. Existe porque a tela mostra o `synced_at` justamente para a
    pessoa saber o quão velha é a informação.

    Aceita o id curto e o `openclaw:<id>` na mesma consulta: as duas formas
    convivem na tabela por herança, e escolher uma perderia linhas.
    """
    curto = agent_id.removeprefix("openclaw:")
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT agent_id, file_name, content, "
            "       to_char(synced_at AT TIME ZONE 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS') || 'Z' AS synced_at "
            "  FROM public.agent_files WHERE agent_id = ANY($1::text[]) ORDER BY file_name",
            [curto, f"openclaw:{curto}"],
        )
    return [dict(l) for l in linhas]


# ⚠️ Dois segmentos de propósito: `/agents/produtividade` seria engolido por
# `GET /agents/{agent_id}`, que está declarado antes.
@router.get("/frota/produtividade")
async def produtividade(usuario: Usuario = Depends(usuario_atual), dias: int = Query(default=30, ge=1, le=365)):
    """Produtividade da frota nos últimos N dias, agregada pela função do banco.

    A soma fica no Postgres (`get_fleet_productivity`) e não aqui: o cálculo já
    existia como função e reimplementá-lo em Python só criaria duas versões da
    mesma conta para divergirem depois.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.get_fleet_productivity((now() - make_interval(days => $1)))",
            dias,
        )
    return json.loads(json.dumps([dict(l) for l in linhas], default=str))


# ─────────────────────────────────────────────────────────────────────────────
# Resultados e crons — sub-recursos do agente
# ─────────────────────────────────────────────────────────────────────────────

_COLUNAS_RESULTADO = """
    id::text AS id, agent_id, title, description, category, value, metadata,
    user_id::text AS user_id,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS created_at
"""


def _resultado(linha) -> dict:
    d = dict(linha)
    bruto = d.get("metadata")
    d["metadata"] = (json.loads(bruto) if isinstance(bruto, str) else bruto) or {}
    return json.loads(json.dumps(d, default=str))


@router.get("/{agent_id}/crons")
async def crons(agent_id: str, usuario: Usuario = Depends(exige_papel("administrador"))):
    """Os agendamentos do agente, do mais recente para o mais antigo.

    Lê da nossa tabela, que desde a `013` é espelho de algo real: cada linha com
    `gateway_job_id` tem um job correspondente no `cron.list`. Quem quer a
    verdade do gateway sem intermediário usa `GET /{id}/agendamentos-do-gateway`.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.agent_crons WHERE agent_id = $1 ORDER BY created_at DESC",
            agent_id,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


class CronIn(BaseModel):
    name: str = Field(min_length=1)
    expression: str = Field(min_length=1)
    instruction: str = Field(min_length=1)
    description: str | None = None


async def _cliente_ou_502():
    """O cliente do gateway, ou 502 na cara — nunca seguir sem ele."""
    c = await cfg.carregar()
    if not c.configurado:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "Gateway não configurado.")
    return obter_cliente(c.url, c.token)


@router.post("/{agent_id}/crons", status_code=status.HTTP_201_CREATED)
async def criar_cron(
    agent_id: str, dados: CronIn, usuario: Usuario = Depends(exige_papel("administrador"))
):
    """Agenda no gateway e só então grava aqui.

    ⚠️ **Gateway primeiro, banco depois** — a regra da casa para escrita que toca
    as duas pontas. Até a `013` esta rota gravava só na tabela e a tela dizia
    "agendamento criado" para algo que nunca ia disparar.

    ⚠️ **O `expr` é UTC e o gateway não tem campo de fuso.** `30 10 * * 1-5` é
    07h30 de Brasília. Não convertemos aqui de propósito: traduzir expressão
    cron entre fusos erra no dia da semana quando a hora cruza a meia-noite. Em
    vez disso devolvemos o `next_run` que o próprio gateway calculou, e a tela o
    mostra em Brasília — a pessoa confere o efeito em vez de confiar na conta.

    ⚠️ **`cron.add` NÃO valida o `agentId`** (levantado em 19/08/2026: uma
    sondagem com agente inexistente criou o job). Por isso conferimos o agente
    aqui antes, senão a tela deixaria criar agendamento fantasma.
    """
    cliente = await _cliente_ou_502()

    try:
        r = await cliente.chamar("agents.list", {})
        existe = any(str(a.get("id")) == agent_id
                     for a in ((r.get("payload") or r).get("agents") or []))
    except (ErroGateway, OSError) as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"Gateway indisponível: {e}")
    if not existe:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Agente {agent_id} não existe no gateway.")

    linha_id = str(uuid4())
    nome_job = f"hsos-agentcron-{linha_id}"
    try:
        r = await cliente.chamar("cron.add", {
            "name": nome_job,
            "schedule": {"kind": "cron", "expr": dados.expression},
            "sessionTarget": "isolated",
            "agentId": agent_id,
            "payload": {"kind": "agentTurn", "message": dados.instruction,
                        "timeoutSeconds": 900},
            "delivery": {"mode": "none"},
        })
    except (ErroGateway, OSError) as e:
        # Expressão inválida cai aqui. Nada foi gravado — é o ponto de abortar.
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"O gateway recusou o agendamento: {e}")

    job = (r.get("payload") or r).get("job") or {}
    proximo = (job.get("state") or {}).get("nextRunAtMs") or job.get("nextRunAtMs")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "INSERT INTO public.agent_crons "
            "  (id, agent_id, name, expression, instruction, description, "
            "   gateway_job_id, next_run) "
            "VALUES ($1::uuid,$2,$3,$4,$5,$6,$7, "
            "        CASE WHEN $8::bigint IS NULL THEN NULL "
            "             ELSE to_timestamp($8::bigint / 1000.0) END) RETURNING *",
            linha_id, agent_id, dados.name, dados.expression, dados.instruction,
            dados.description, job.get("id"), proximo,
        )
    return json.loads(json.dumps(dict(linha), default=str))


class CronPatchIn(BaseModel):
    enabled: bool


@router.patch("/{agent_id}/crons/{cron_id}", status_code=status.HTTP_204_NO_CONTENT)
async def alternar_cron(
    agent_id: str,
    cron_id: str,
    dados: CronPatchIn,
    usuario: Usuario = Depends(exige_papel("administrador")),
):
    """Liga e desliga o agendamento — no gateway e aqui. Mudar a expressão é apagar e criar.

    ⚠️ Antes da `013` o docstring desta rota avisava que "isto não desliga o cron
    no gateway". Não desligava mesmo, e como o gateway era quem executava, o
    botão da tela não fazia nada além de mudar uma cor.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        alvo = await conn.fetchrow(
            "SELECT gateway_job_id FROM public.agent_crons "
            " WHERE id = $2::uuid AND agent_id = $1", agent_id, cron_id)
    if alvo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agendamento não encontrado.")

    if alvo["gateway_job_id"]:
        cliente = await _cliente_ou_502()
        try:
            await cliente.chamar("cron.update", {"id": alvo["gateway_job_id"],
                                                 "patch": {"enabled": dados.enabled}})
        except (ErroGateway, OSError) as e:
            raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                f"Não consegui mudar o agendamento no gateway: {e}")

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "UPDATE public.agent_crons SET enabled = $3 "
            " WHERE id = $2::uuid AND agent_id = $1", agent_id, cron_id, dados.enabled)


@router.delete("/{agent_id}/crons/{cron_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_cron(
    agent_id: str, cron_id: str, usuario: Usuario = Depends(exige_papel("administrador"))
):
    """Remove no gateway e depois aqui.

    ⚠️ **`cron.remove` é por `id`, não por `name`.** É para isso que a `013`
    guarda o `gateway_job_id`.

    Job que o gateway não conhece mais (removido por fora) não impede a limpeza
    daqui: apagar a linha é justamente o que reconcilia os dois lados.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        alvo = await conn.fetchrow(
            "SELECT gateway_job_id FROM public.agent_crons "
            " WHERE id = $2::uuid AND agent_id = $1", agent_id, cron_id)
    if alvo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agendamento não encontrado.")

    if alvo["gateway_job_id"]:
        cliente = await _cliente_ou_502()
        try:
            await cliente.chamar("cron.remove", {"id": alvo["gateway_job_id"]})
        except (ErroGateway, OSError) as e:
            if "not found" not in str(e).lower():
                raise HTTPException(status.HTTP_502_BAD_GATEWAY,
                                    f"Não consegui remover o agendamento no gateway: {e}")
            logger.info("Cron %s já não existia no gateway; sigo apagando a linha.",
                        alvo["gateway_job_id"])

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "DELETE FROM public.agent_crons WHERE id = $2::uuid AND agent_id = $1",
            agent_id, cron_id)


@router.get("/{agent_id}/atividades")
async def atividades_do_agente(
    agent_id: str,
    usuario: Usuario = Depends(usuario_atual),
    limite: int = Query(default=50, ge=1, le=200),
):
    """As atividades deste agente que dizem respeito a mim.

    ⚠️ **`user_id` nulo é atividade de sistema e entra na lista.** É herança: as
    linhas antigas não guardavam de quem era, e filtrá-las faria o histórico
    encolher sem explicação. As novas trazem o dono, e aí só as minhas aparecem —
    um mesmo agente atende várias pessoas, e sem isso as chamadas de ferramenta
    de outra conversa apareciam misturadas na sua.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT * FROM public.agent_activity
             WHERE agent_id = $1 AND (user_id IS NULL OR user_id = $2::uuid)
             ORDER BY created_at DESC
             LIMIT $3
            """,
            agent_id, usuario.id, limite,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


@router.get("/{agent_id}/consumo")
async def consumo_do_agente(
    agent_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
    desde: str | None = Query(default=None, description="ISO-8601."),
    limite: int = Query(default=5000, ge=1, le=20_000),
):
    """Os eventos de consumo deste agente, em ordem cronológica.

    Sem `desde`, olha os últimos dois dias — o painel de hoje/ontem. A aba de
    período manda a janela explícita.

    ⚠️ **Do coletor quando há, do gateway quando não há** — igual ao
    `/estatisticas` logo abaixo, e pelo mesmo motivo. A `usage_events` tem um
    escritor só, o coletor da VPS, e enquanto ele não apontar para esta
    instalação a tabela fica **zerada**. O painel lia zero e mostrava
    "US$ 0,00 · 0 tokens" — que não é "ainda não gastamos", é "não fui olhar".

    Em 14/08/2026 o gateway tinha 38 sessões, 1,01 milhão de tokens e US$ 4,77
    de custo estimado enquanto a tela dizia zero.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT total_tokens, input_tokens, output_tokens, cached_tokens,
                   -- ⚠️ `numeric` vira Decimal no asyncpg e **string** no JSON.
                   -- Pelo gateway este campo volta número; o mesmo campo mudar
                   -- de tipo conforme a fonte é armadilha para quem somar sem
                   -- converter. A tela usa `Number()` e sobrevive; quem vier
                   -- depois pode não usar.
                   cost_usd::float8 AS cost_usd, model,
                   to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS ts
              FROM public.usage_events
             WHERE agent_id = $1
               AND ts >= COALESCE(NULLIF($2,'')::text::timestamptz, now() - interval '2 days')
             ORDER BY ts
             LIMIT $3
            """,
            agent_id, desde or "", limite,
        )
    if linhas:
        return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]

    return await _consumo_do_gateway(agent_id, desde, limite)


async def _consumo_do_gateway(agent_id: str, desde: str | None, limite: int) -> list[dict]:
    """Consumo derivado das sessões vivas do gateway, no formato da `usage_events`.

    O `sessions.list` traz `totalTokens`, `inputTokens`, `outputTokens` e
    `estimatedCostUsd` por sessão — é o mesmo número que o gateway usa para
    cobrar, não uma estimativa nossa.

    ⚠️ **É uma sessão por linha, não um turno por linha.** O consumo inteiro da
    sessão é carimbado no instante da última atividade dela. Para o painel de
    hoje/ontem isso é fiel, porque aqui as sessões duram uma conversa; para uma
    sessão que atravesse a virada do dia, o gasto todo cai no dia em que ela
    terminou. Quem resolve isso é o coletor, gravando por turno — este caminho
    é o que faz a tela parar de mentir enquanto ele não existe.

    ⚠️ **Sessão podada some com o histórico.** Por isso "quanto gastamos em
    julho" não sai daqui, e a resposta certa a essa pergunta continua sendo o
    coletor.
    """
    try:
        c = await cfg.carregar()
        r = await obter_cliente(c.url, c.token).chamar("sessions.list", {"limit": 500})
    except (ErroGateway, OSError) as e:
        logger.warning("sessions.list falhou ao medir consumo de %s: %s", agent_id, e)
        return []

    try:
        corte = (
            datetime.fromisoformat(desde.replace("Z", "+00:00"))
            if desde else datetime.now(timezone.utc) - timedelta(days=2)
        )
    except ValueError:
        corte = datetime.now(timezone.utc) - timedelta(days=2)

    alvo = agent_id.lower()
    saida: list[dict] = []
    for s in r.get("sessions", []):
        partes = (s.get("key") or "").split(":")
        if len(partes) < 3 or partes[0] != "agent" or partes[1].lower() != alvo:
            continue
        # `endedAt` é o fim do último run; `updatedAt` cobre sessão ainda aberta.
        quando = s.get("endedAt") or s.get("updatedAt")
        if not isinstance(quando, (int, float)):
            continue
        ts = datetime.fromtimestamp(quando / 1000, tz=timezone.utc)
        if ts < corte:
            continue
        total = s.get("totalTokens") or 0
        if not total and not s.get("estimatedCostUsd"):
            continue
        saida.append({
            "ts": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "total_tokens": total,
            "input_tokens": s.get("inputTokens") or 0,
            "output_tokens": s.get("outputTokens") or 0,
            "cached_tokens": None,
            "cost_usd": s.get("estimatedCostUsd") or 0,
            "model": s.get("model"),
            # A tela não usa, mas quem for depurar precisa saber que este número
            # não veio da `usage_events`.
            "origem": "gateway",
        })

    saida.sort(key=lambda x: x["ts"])
    return saida[-limite:]


@router.get("/{agent_id}/estatisticas")
async def estatisticas_do_agente(agent_id: str, usuario: Usuario = Depends(exige_papel("administrador"))):
    """Atividade deste agente: do coletor quando há, do gateway quando não há.

    ⚠️ **Antes isto devolvia `null` e a tela concluía "OFFLINE".** A `agent_stats`
    tem um único escritor — o coletor que roda na VPS — e enquanto ele não
    apontar para esta instalação a tabela fica vazia. O painel lia `null` em
    `latest_updated_at` e mostrava o agente como fora do ar, com ele
    respondendo normalmente no gateway. Afirmar "offline" a partir de "não sei"
    é o erro; é o mesmo que o `/monitoring` cometia.

    Mas a correção boa não é dizer "sem dados" — é ir buscar. O
    `sessions.list` do gateway traz `updatedAt` por sessão, e a chave é
    composta (`agent:<id>:<resto>`), então dá para saber a última atividade de
    cada agente **ao vivo**, sem coletor nenhum. É informação melhor que a do
    coletor, que é um retrato de alguns minutos atrás.

    O coletor continua tendo precedência quando existe: ele traz `top_sessions`
    e custo, que o `sessions.list` não dá de graça. O gateway preenche a
    lacuna, e `origem` diz de onde veio — a tela precisa distinguir "ao vivo"
    de "última coleta".
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "SELECT session_count, latest_updated_at, top_sessions, model "
            "  FROM public.agent_stats WHERE agent_id = $1 "
            " ORDER BY collected_at DESC LIMIT 1",
            agent_id,
        )
    if linha and linha["latest_updated_at"]:
        d = json.loads(json.dumps(dict(linha), default=str))
        d["origem"] = "coletor"
        return d

    try:
        c = await cfg.carregar()
        r = await obter_cliente(c.url, c.token).chamar("sessions.list", {"limit": 200})
    except ErroGateway as e:
        logger.warning("sessions.list falhou ao medir atividade de %s: %s", agent_id, e)
        return None

    alvo = agent_id.lower()
    mais_recente, quantas, modelo = None, 0, None
    for s in r.get("sessions", []):
        partes = (s.get("key") or "").split(":")
        # `agent:nina:hsos-<uuid>` — o id fica no meio. Qualquer outro formato
        # não é sessão de agente e não conta.
        if len(partes) < 3 or partes[0] != "agent" or partes[1].lower() != alvo:
            continue
        quantas += 1
        modelo = modelo or s.get("model")
        q = s.get("updatedAt")
        if isinstance(q, (int, float)) and (mais_recente is None or q > mais_recente):
            mais_recente = q

    if not quantas:
        return None
    return {
        "session_count": quantas,
        # `updatedAt` vem em milissegundos; a tela espera ISO.
        "latest_updated_at": (
            datetime.fromtimestamp(mais_recente / 1000, tz=timezone.utc).isoformat()
            if mais_recente else None
        ),
        "top_sessions": [],
        "model": modelo,
        "origem": "gateway",
    }


@router.get("/{agent_id}/integracoes")
async def integracoes_do_agente(
    agent_id: str,
    usuario: Usuario = Depends(exige_papel("administrador")),
    tipo: str | None = Query(default=None),
):
    """As integrações vinculadas a este agente: canais, ferramentas e skills.

    ⚠️ **Do banco quando há, do gateway quando não há** — mesmo desenho do
    `/consumo` e do `/estatisticas`. A `agent_integrations` nunca teve escritor:
    em 14/08/2026 estava com **zero linhas** enquanto os três agentes tinham
    conector de banco e ferramenta de alerta publicados por nós mesmos, naquele
    mesmo dia. A tela dizia "Nenhuma ferramenta configurada" para um agente com
    três.
    """
    condicoes, args = ["agent_id = $1"], [agent_id]
    if tipo:
        args.append(tipo)
        condicoes.append(f"type = ${len(args)}")
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT * FROM public.agent_integrations WHERE {' AND '.join(condicoes)} ORDER BY name",
            *args,
        )
    if linhas:
        return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]

    return await _integracoes_do_gateway(agent_id, tipo)


def _rotulo_do_servidor(servidor: str) -> str:
    """`banco-diretorio-hs-os` → `Diretório HS.OS`. Cosmético e sem custo."""
    if servidor.startswith("banco-"):
        return "Banco " + servidor[len("banco-"):].replace("-", " ").title()
    return servidor.replace("-", " ").title()


async def _integracoes_do_gateway(agent_id: str, tipo: str | None) -> list[dict]:
    """Canais, ferramentas e skills deste agente, lidos do gateway.

    ⚠️ **A config do servidor MCP guarda a URL de conexão COM SENHA nos `args`.**
    Nada daqui pode devolvê-la: o `config` que sai é só transporte e nome da
    tool. Em 12/08/2026 já encontramos senha de superusuário em texto puro num
    workspace de agente; não vamos reintroduzi-la por um painel.

    Skills: só as **não-embutidas**. As 51 do próprio OpenClaw afogariam as
    nossas num cartão pequeno — o catálogo completo é a página de Skills, que
    tem espaço para ele.
    """
    saida: list[dict] = []
    try:
        c = await cfg.carregar()
        cli = obter_cliente(c.url, c.token)
        bruto = await cli.chamar("config.get", {})
        parsed = ((bruto.get("payload") or bruto).get("parsed")) or {}
    except (ErroGateway, OSError) as e:
        logger.warning("config.get falhou ao listar integrações de %s: %s", agent_id, e)
        return []

    alvo = agent_id.lower()
    perfil = next(
        (a for a in ((parsed.get("agents") or {}).get("list") or [])
         if str(a.get("id", "")).lower() == alvo),
        None,
    )
    servidores = ((parsed.get("mcp") or {}).get("servers")) or {}

    if perfil and (not tipo or tipo == "tool"):
        negados = {str(x) for x in ((perfil.get("tools") or {}).get("deny") or [])}
        for ferramenta in ((perfil.get("tools") or {}).get("alsoAllow") or []):
            nu = ferramenta[len("mcp__"):] if ferramenta.startswith("mcp__") else ferramenta
            servidor = nu.rsplit("__", 1)[0]
            existe = servidor in servidores
            # ⚠️ Ferramenta concedida cujo servidor sumiu: o agente a enxerga e
            # ela não conecta. É o defeito que o `auditar-agente.py` procura, e
            # o painel tem que mostrá-lo em vez de fingir que está tudo certo.
            status = "error" if not existe else ("inactive" if nu in negados else "active")
            s = servidores.get(servidor) or {}
            saida.append({
                "id": f"tool:{nu}",
                "name": _rotulo_do_servidor(servidor),
                "type": "tool",
                "status": status,
                # Sem `args`: é lá que mora a URL com senha.
                "config": {"tool": nu, "transporte": s.get("transport") or "stdio"},
                "description": (
                    "Servidor MCP não existe mais na configuração"
                    if not existe else f"Ferramenta `{nu}`"
                ),
            })

    if not tipo or tipo == "channel":
        async with sessao(role="service_role") as conn:
            canais = await conn.fetchval(
                "SELECT channels FROM public.agent_profiles WHERE agent_id = $1", agent_id
            )
        for ch in (canais or []):
            saida.append({
                "id": f"channel:{ch}", "name": str(ch), "type": "channel",
                "status": "active", "config": None, "description": None,
            })

    if not tipo or tipo == "skill":
        try:
            r = await cli.chamar("skills.status", {"agentId": agent_id})
            p = r.get("payload") or r
        except (ErroGateway, OSError) as e:
            logger.warning("skills.status falhou para %s: %s", agent_id, e)
            p = {}
        for s in (p.get("skills") or []):
            if s.get("bundled"):
                continue
            # ⚠️ **`modelVisible`, não `eligible`.** Duas armadilhas seguidas no
            # mesmo campo: `missing` parece flag e é um dict (dict vazio é
            # verdadeiro em Python, e isso marcava tudo como inativo); e
            # `eligible` continua **true** quando a skill está bloqueada pela
            # allowlist do agente — quem muda é `blockedByAgentFilter`.
            # `modelVisible` responde a pergunta certa: este agente vê a skill?
            saida.append({
                "id": f"skill:{s.get('name')}",
                "name": f"{s.get('emoji') or ''} {s.get('name')}".strip(),
                "type": "skill",
                "status": "active" if s.get("modelVisible") else "inactive",
                "config": {
                    "fonte": s.get("source"),
                    "sempre": bool(s.get("always")),
                    "invocavel_por_pessoa": bool(s.get("userInvocable")),
                },
                "description": s.get("description"),
            })

    saida.sort(key=lambda x: (x["type"], x["name"]))
    return saida


@router.get("/{agent_id}/agendamentos-do-gateway")
async def agendamentos_do_gateway(agent_id: str, usuario: Usuario = Depends(exige_papel("administrador"))):
    """Os crons que o **gateway** executa para este agente — perguntando a ele.

    ⚠️ **Isto lia a tabela `cron_jobs`, e ela está vazia desde sempre.** Aquele
    espelho é preenchido por `POST /coletor/estatisticas`, que um coletor na VPS
    deveria empurrar — e não empurra, igual à ponte de arquivos que saiu do
    caminho em 11/08/2026. O resultado: o gateway com dois crons rodando e o
    painel do agente dizendo "nenhum agendamento", que é pior que não ter a
    seção. Levantado em 19/08/2026 clicando no `flow`.

    Agora a resposta vem de `cron.list`, que é a fonte. **Com recuo para o
    espelho** se o gateway estiver fora: melhor mostrar o que se sabia do que
    trocar um vazio silencioso por um erro.

    ⚠️ Não confundir com `GET /{id}/crons`, que é a tabela `agent_crons` da
    plataforma — e que também não agenda nada, porque ninguém a envia ao
    gateway. São três coisas com o mesmo nome.
    """
    c = await cfg.carregar()
    if c.configurado:
        try:
            r = await obter_cliente(c.url, c.token).chamar("cron.list", {})
            jobs = ((r.get("payload") or r).get("jobs")) or []
            saida = []
            for j in jobs:
                if j.get("agentId") != agent_id:
                    continue
                ms = j.get("nextRunAtMs") or (j.get("state") or {}).get("nextRunAtMs")
                sched = j.get("schedule") or {}
                saida.append({
                    "id": j.get("id"),
                    "name": j.get("name"),
                    # `expr` para o recorrente, `at` para o de tiro único.
                    "cron_expression": sched.get("expr") or sched.get("at"),
                    "last_run": None,
                    "next_run": (datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat()
                                 if ms else None),
                    "status": "active" if j.get("enabled") else "disabled",
                    "enabled": bool(j.get("enabled")),
                    "agent": agent_id,
                })
            return sorted(saida, key=lambda x: x["next_run"] or "9999")
        except (ErroGateway, OSError) as e:
            logger.warning("cron.list falhou para %s, caindo no espelho: %s", agent_id, e)

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT id, name, cron_expression, last_run, next_run, status, enabled, agent "
            "  FROM public.cron_jobs WHERE agent = $1 AND agent <> 'system' "
            " ORDER BY next_run NULLS LAST",
            agent_id,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


class ArquivoEspelhadoIn(BaseModel):
    file_name: str = Field(min_length=1)
    content: str = ""


@router.put("/{agent_id}/arquivos-espelhados", status_code=status.HTTP_204_NO_CONTENT)
async def gravar_arquivos_espelhados(
    agent_id: str,
    arquivos: list[ArquivoEspelhadoIn],
    _: Usuario = Depends(exige_papel("administrador")),
):
    """Grava os arquivos do agente na tabela, para a ponte levá-los ao disco.

    ⚠️ **`pending_write = true` é o que faz o arquivo sair do banco.** A ponte
    (`dnos-files-bridge`, na VPS) varre por essa marca a cada 60s e escreve no
    workspace de verdade. Sem ela, os arquivos param aqui e o agente nasce sem
    alma no filesystem — foi o que a importação fazia antes de existir a marca.

    Existe separado de `POST /integracoes/agent-files` porque aquele autentica
    por segredo compartilhado (é a própria ponte confirmando o que escreveu) e
    este é ação de pessoa, com JWT. Mesma tabela, dois chamadores diferentes.
    """
    if not arquivos:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Nenhum arquivo informado.")
    async with sessao(role="service_role") as conn:
        for a in arquivos:
            await conn.execute(
                """
                INSERT INTO public.agent_files (agent_id, file_name, content, pending_write, synced_at)
                VALUES ($1, $2, $3, true, now())
                ON CONFLICT (agent_id, file_name) DO UPDATE
                    SET content = EXCLUDED.content, pending_write = true, synced_at = now()
                """,
                agent_id, a.file_name, a.content,
            )
    logger.info("%d arquivo(s) de %s gravados para a ponte levar.", len(arquivos), agent_id)
