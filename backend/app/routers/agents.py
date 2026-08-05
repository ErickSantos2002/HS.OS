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

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual
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
                   specialty, workspace, is_leader, is_official, color, sort_order
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
                isOfficial=bool(p.get("is_official")),
                color=p.get("color"),
            )
        )

    saida.sort(key=lambda a: (a.status != "active", a.name.lower()))
    return ListaAgentesOut(
        agents=saida, defaultId=default_id, gatewayOnline=online, gatewayErro=erro
    )
