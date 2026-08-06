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

import logging
import re
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, status
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

    `all` libera; `admins_only` restringe a super_admin; `specific_users` exige
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
    is_admin = usuario.papel == "super_admin"

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


@router.get("/{agent_id}", response_model=PerfilCompletoOut)
async def obter(agent_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            """
            SELECT agent_id, name, emoji, specialty, model, persona_description,
                   skills_description, skills_tags, crons_description, description,
                   department, color, avatar_url, workspace, is_leader, leader_id,
                   access_type, allowed_user_ids, status
            FROM public.agent_profiles WHERE agent_id = $1
            """,
            agent_id,
        )
    if linha is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Agente não encontrado.")

    d = dict(linha)
    if not _pode_ver(d, usuario.id, usuario.papel == "super_admin"):
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
    )


class SincronizacaoOut(BaseModel):
    criados: int
    atualizados: int
    total_no_gateway: int


@router.post("/sync", response_model=SincronizacaoOut)
async def sincronizar(_: Usuario = Depends(exige_papel("super_admin"))):
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
                "sessionKey": f"system:{assunto}",
                "message": mensagem,
                # Único por envio, senão o gateway deduplica pelo runId e o
                # segundo aviso do mesmo assunto some.
                "idempotencyKey": f"{assunto}:{uuid4()}",
            },
        )
        logger.info("Aviso '%s' enviado a %s.", assunto, openclaw_id)
    except ErroGateway as e:
        logger.warning("Aviso '%s' a %s falhou: %s", assunto, openclaw_id, e)


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
    _: Usuario = Depends(exige_papel("super_admin")),
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
                   is_leader, leader_id, is_official, color
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
    _: Usuario = Depends(exige_papel("super_admin")),
):
    """Confere se um modelo está registrado, disponível e com credencial válida.

    `super_admin` porque configuração de LLM é superfície de admin.
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
    _: Usuario = Depends(exige_papel("super_admin")),
):
    """Grava `is_leader`/`leader_id` de vários agentes de uma vez.

    Existe para o agente orquestrador (na VPS) empurrar a liderança que ele lê do
    `SOUL.md` de cada agente, que é a fonte canônica.

    ⚠️ **O botão da UI que chama isto é inócuo** e já era assim na edge function:
    a tela lê `is_leader`/`leader_id` do banco e devolve os mesmos valores, então
    o round-trip nunca muda nada. Foi portado como estava, de propósito — corrigir
    o produto é outra tarefa, registrada em `docs/ROADMAP.md`. Pelo caminho da
    VPS, que manda um payload de verdade, o endpoint funciona.

    A autorização aqui é só `super_admin`. A edge function também aceitava um
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
    _: Usuario = Depends(exige_papel("super_admin")),
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
        "Execute TODOS os passos do AGENT_CREATION.md:\n"
        f"1. Crie o workspace {d.workspace} no VPS\n"
        "2. Escreva SOUL.md com a personalidade descrita acima — seja criativo e "
        "detalhado, capture a essência do agente\n"
        "3. Escreva IDENTITY.md com missão, especialidade, tom de voz e exemplos "
        "de respostas\n"
        f"4. Escreva TOOLS.md listando as integrações: {integracoes}\n"
        "5. Escreva AGENTS.md (relações com outros agentes da equipe)\n"
        "6. Escreva MEMORY.md (vazio, pronto para uso)\n"
        "7. Escreva HEARTBEAT.md (status inicial)\n"
        "8. Atualize /root/.openclaw/AGENTS_DIRECTORY.md adicionando o novo agente\n"
        "9. Configure os crons descritos acima no openclaw.json\n"
        "10. Reinicie o gateway para carregar o novo agente\n"
        "11. Ao final desta mensagem, resuma o que foi configurado e liste os "
        "arquivos criados com o caminho completo\n\n"
        "Capricha no SOUL.md — é a alma do agente. NÃO pule a execução das ferramentas."
    )


@router.post("", response_model=AgenteNovoOut, status_code=status.HTTP_201_CREATED)
async def criar(
    dados: AgenteNovoIn,
    _: Usuario = Depends(exige_papel("super_admin")),
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
        await obter_cliente(c.url, c.token).chamar(
            "agents.create", {"name": dados.name, "workspace": dados.workspace}
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

    avisado = True
    try:
        await _avisar_lider(f"create-agent:{dados.openclaw_id}", briefing)
    except Exception as e:  # noqa: BLE001
        avisado = False
        logger.warning("Briefing de %s não enviado: %s", dados.openclaw_id, e)

    logger.info("Agente %s criado por super_admin", dados.openclaw_id)
    return AgenteNovoOut(
        agent_id=dados.openclaw_id, criado_no_gateway=True, orquestrador_avisado=avisado
    )
