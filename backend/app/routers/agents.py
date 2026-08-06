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
async def listar(usuario: Usuario = Depends(usuario_atual)):
    is_admin = usuario.papel == "super_admin"

    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT agent_id, name, emoji, avatar_url, model, channels, status,
                   access_type, allowed_user_ids, department, description,
                   specialty, workspace, is_leader, leader_id, is_official, color,
                   sort_order
            FROM public.agent_profiles
            WHERE status IS DISTINCT FROM 'inactive'
            ORDER BY sort_order NULLS LAST, name
            """
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


async def _avisar_lider(assunto: str, mensagem: str) -> None:
    """Manda uma mensagem ao agente líder. Nunca levanta.

    Portado do bloco "notify Lia" das edges de acesso e liderança, que era
    explicitamente *best effort*: falha ali nunca derrubava a gravação, só ia
    para o log. Mantido assim — o aviso é consequência da mudança, não parte dela.

    Duas diferenças forçadas em relação ao código herdado, e nenhuma é escolha:

    1. A edge chamava `POST /v1/chat/completions` com `model: "openclaw:lia"`.
       A rota é 404 no gateway atual; o substituto é `chat.send`.
    2. `lia` não existe nesta instalação. O líder sai de
       `agent_profiles.is_leader` — o `CLAUDE.md` proíbe reintroduzir o nome
       fixo, e a resolução dinâmica já tinha sido corrigida antes.
    """
    async with sessao(role="service_role") as conn:
        lider = await conn.fetchrow(
            "SELECT COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid, name "
            "FROM public.agent_profiles WHERE is_leader = true LIMIT 1"
        )
    if lider is None:
        logger.warning("Sem agente líder — aviso '%s' não foi enviado.", assunto)
        return

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
                "agentId": lider["oid"],
                "sessionKey": f"system:{assunto}",
                "message": mensagem,
                # Precisa ser único por envio, senão o gateway deduplica e o
                # segundo aviso do mesmo assunto some.
                "idempotencyKey": f"{assunto}:{uuid4()}",
            },
        )
        logger.info("Aviso '%s' enviado ao líder %s.", assunto, lider["oid"])
    except ErroGateway as e:
        logger.warning("Aviso '%s' ao líder falhou: %s", assunto, e)


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
            "SELECT COALESCE(NULLIF(openclaw_id, ''), agent_id) AS oid, name "
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

    # Aviso ao líder, depois de gravado — a ordem da edge. Best effort: a falha
    # já foi tratada dentro de `_avisar_lider` e não afeta esta resposta.
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
