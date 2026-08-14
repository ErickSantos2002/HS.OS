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
from datetime import datetime, timezone
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
    usuario: Usuario = Depends(usuario_atual),
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


async def _avisar_lider_ou_falhar(assunto: str, mensagem: str) -> None:
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
    await obter_cliente(c.url, c.token).chamar(
        "chat.send",
        {
            "agentId": lider["oid"],
            "sessionKey": f"agent:{lider['oid']}:sistema-{assunto}",
            "message": mensagem,
            "idempotencyKey": f"{assunto}:{uuid4()}",
        },
    )
    logger.info("Aviso '%s' entregue a %s.", assunto, lider["oid"])


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
                   is_leader, leader_id, is_official, color, sort_order
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
        linhas = await conn.fetch(
            "SELECT id::text AS id, name FROM public.integrations "
            " WHERE integration_type = 'database' AND name = ANY($1::text[])",
            nomes,
        )
        achados = {l["name"]: l["id"] for l in linhas}

        for nome in nomes:
            ident = achados.get(nome)
            if not ident:
                # Conector que não é banco (API, MCP) cai aqui e não é falha:
                # ele simplesmente não se publica desta forma.
                continue
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
    try:
        await _avisar_lider_ou_falhar(f"create-agent:{dados.openclaw_id}", briefing)
    except ErroGateway as e:
        logger.error("Briefing de %s não entregue — desfazendo: %s", dados.openclaw_id, e)
        await _desfazer_criacao(dados.openclaw_id)
        raise HTTPException(
            status.HTTP_502_BAD_GATEWAY,
            f"O agente não foi criado: não consegui avisar o orquestrador ({e}). "
            "Nada ficou pela metade — nem no gateway, nem aqui. Verifique se o "
            "agente líder está de pé e tente de novo.",
        ) from e

    # ⚠️ **Publicar os conectores escolhidos, e não só citá-los no briefing.**
    #
    # `integrations_used` virava texto no briefing ("INTEGRAÇÕES: DataCoreHS,
    # Diretório HS.OS") e coluna no banco, e mais nada. O agente nascia SEM as
    # ferramentas que a tela dizia ter dado — e o orquestrador, sem como
    # consultar o banco, descrevia o schema de memória. Em 14/08/2026 a `iris`
    # nasceu com um TOOLS.md citando `table_schema = 'public'` (é `tiny`) e
    # tabelas que não existem.
    #
    # É a mesma família de "a tela afirma o envio, não o resultado" que já
    # apareceu no gateway offline, no agente criado vazio e na fila de
    # provedores sem executor.
    publicados, falhos = await _publicar_conectores(
        dados.openclaw_id, dados.integrations_used
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
async def listar_arquivos(agent_id: str, _: Usuario = Depends(usuario_atual)):
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
async def ler_arquivo(agent_id: str, nome: str, _: Usuario = Depends(usuario_atual)):
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
async def guardrails(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
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
    return bruto if isinstance(bruto, list) else []


@router.get("/{agent_id}/contexto")
async def contexto(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Quanto da janela de contexto o agente está usando, na última medição.

    Devolve `null` quando não há medição — agente recém-criado ou que ainda não
    conversou. A tela esconde o indicador nesse caso, então um 404 só criaria
    ruído para o estado normal de quem acabou de chegar.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            SELECT total_tokens, context_tokens, model,
                   to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS updated_at
              FROM public.agent_context_state
             WHERE agent_id = $1
             ORDER BY updated_at DESC
             LIMIT 1
            """,
            agent_id,
        )
    return dict(linha) if linha else None


@router.get("/{agent_id}/log-criacao")
async def log_de_criacao(
    agent_id: str,
    usuario: Usuario = Depends(usuario_atual),
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
async def arquivos_espelhados(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
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
async def crons(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Os agendamentos do agente, do mais recente para o mais antigo."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            "SELECT * FROM public.agent_crons WHERE agent_id = $1 ORDER BY created_at DESC",
            agent_id,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


class CronIn(BaseModel):
    name: str = Field(min_length=1)
    expression: str = Field(min_length=1)
    description: str | None = None


@router.post("/{agent_id}/crons", status_code=status.HTTP_201_CREATED)
async def criar_cron(
    agent_id: str, dados: CronIn, usuario: Usuario = Depends(usuario_atual)
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "INSERT INTO public.agent_crons (agent_id, name, expression, description) "
            "VALUES ($1,$2,$3,$4) RETURNING *",
            agent_id, dados.name, dados.expression, dados.description,
        )
    return json.loads(json.dumps(dict(linha), default=str))


class CronPatchIn(BaseModel):
    enabled: bool


@router.patch("/{agent_id}/crons/{cron_id}", status_code=status.HTTP_204_NO_CONTENT)
async def alternar_cron(
    agent_id: str,
    cron_id: str,
    dados: CronPatchIn,
    usuario: Usuario = Depends(usuario_atual),
):
    """Liga e desliga o agendamento. Só isso — mudar a expressão é apagar e criar.

    ⚠️ **Isto não desliga o cron no gateway**, que é quem de fato executa. A
    tabela é o registro da plataforma; a sincronização é do
    `POST /automacoes/sincronizar-status`.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.agent_crons SET enabled = $3 "
            " WHERE id = $2::uuid AND agent_id = $1 RETURNING id",
            agent_id, cron_id, dados.enabled,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agendamento não encontrado.")


@router.delete("/{agent_id}/crons/{cron_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_cron(
    agent_id: str, cron_id: str, usuario: Usuario = Depends(usuario_atual)
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.agent_crons WHERE id = $2::uuid AND agent_id = $1",
            agent_id, cron_id,
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agendamento não encontrado.")


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
    usuario: Usuario = Depends(usuario_atual),
    desde: str | None = Query(default=None, description="ISO-8601."),
    limite: int = Query(default=5000, ge=1, le=20_000),
):
    """Os eventos de consumo deste agente, em ordem cronológica.

    Sem `desde`, olha os últimos dois dias — o painel de hoje/ontem. A aba de
    período manda a janela explícita.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT total_tokens, input_tokens, output_tokens, cached_tokens,
                   cost_usd, model,
                   to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS') || 'Z' AS ts
              FROM public.usage_events
             WHERE agent_id = $1
               AND ts >= COALESCE(NULLIF($2,'')::text::timestamptz, now() - interval '2 days')
             ORDER BY ts
             LIMIT $3
            """,
            agent_id, desde or "", limite,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


@router.get("/{agent_id}/estatisticas")
async def estatisticas_do_agente(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
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
    usuario: Usuario = Depends(usuario_atual),
    tipo: str | None = Query(default=None),
):
    """As integrações vinculadas a este agente."""
    condicoes, args = ["agent_id = $1"], [agent_id]
    if tipo:
        args.append(tipo)
        condicoes.append(f"type = ${len(args)}")
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            f"SELECT * FROM public.agent_integrations WHERE {' AND '.join(condicoes)} ORDER BY name",
            *args,
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


@router.get("/{agent_id}/agendamentos-do-gateway")
async def agendamentos_do_gateway(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    """Os crons que o **gateway** executa para este agente, como o coletor os viu.

    ⚠️ Não confundir com `GET /{id}/crons`, que é a tabela da plataforma. Esta
    aqui é `cron_jobs`, espelho do que está rodando lá — pode divergir, e é
    exatamente por isso que existe o `POST /automacoes/sincronizar-status`.

    O `agent <> 'system'` exclui os jobs da instalação, que não pertencem a
    agente nenhum e apareceriam em todos.
    """
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
