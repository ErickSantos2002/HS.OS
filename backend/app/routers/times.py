"""Times de agentes e configuração da instalação.

Duas coisas pequenas que não têm casa melhor: `teams` (agrupamento de agentes,
com o elenco em `team_agents`) e `app_settings` (o par chave/valor que
substituiu o `localStorage` para configuração).
"""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.database import sessao
from app.dependencies import Usuario, usuario_atual

logger = logging.getLogger(__name__)

router = APIRouter(tags=["times e configuração"])


# ─────────────────────────────────────────────────────────────────────────────
# Times
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/times")
async def listar_times(usuario: Usuario = Depends(usuario_atual)):
    """Os times, cada um com a lista de agentes.

    O elenco vem agregado no mesmo SELECT. A tela usava o join embutido do
    PostgREST (`*, team_agents(agent_id)`), sintaxe que só existe lá.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linhas = await conn.fetch(
            """
            SELECT t.*, COALESCE(
                     (SELECT array_agg(ta.agent_id ORDER BY ta.agent_id)
                        FROM public.team_agents ta WHERE ta.team_id = t.id),
                     ARRAY[]::text[]
                   ) AS agent_ids
              FROM public.teams t
             ORDER BY t.name
            """
        )
    return [json.loads(json.dumps(dict(l), default=str)) for l in linhas]


class TimeIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    color: str | None = None
    emoji: str | None = None


@router.post("/times", status_code=status.HTTP_201_CREATED)
async def criar_time(dados: TimeIn, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        linha = await conn.fetchrow(
            "INSERT INTO public.teams (name, description, color, emoji) "
            "VALUES ($1,$2,$3,$4) RETURNING *",
            dados.name, dados.description, dados.color, dados.emoji,
        )
    d = json.loads(json.dumps(dict(linha), default=str))
    d["agent_ids"] = []
    return d


class TimePatchIn(BaseModel):
    name: str | None = None
    description: str | None = None
    color: str | None = None
    emoji: str | None = None


@router.patch("/times/{time_id}", status_code=status.HTTP_204_NO_CONTENT)
async def editar_time(
    time_id: str, dados: TimePatchIn, usuario: Usuario = Depends(usuario_atual)
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        achado = await conn.fetchval(
            "UPDATE public.teams SET name = COALESCE($2, name), "
            "    description = COALESCE($3, description), color = COALESCE($4, color), "
            "    emoji = COALESCE($5, emoji) "
            " WHERE id = $1::uuid RETURNING id",
            time_id, dados.name, dados.description, dados.color, dados.emoji,
        )
    if achado is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Time não encontrado.")


@router.delete("/times/{time_id}", status_code=status.HTTP_204_NO_CONTENT)
async def excluir_time(time_id: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        marca = await conn.execute(
            "DELETE FROM public.teams WHERE id = $1::uuid", time_id
        )
    if marca.rsplit(" ", 1)[-1] == "0":
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Time não encontrado.")


@router.put("/times/{time_id}/agentes/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def entrar_no_time(
    time_id: str, agent_id: str, usuario: Usuario = Depends(usuario_atual)
):
    """Põe o agente no time. Repetir não duplica."""
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "INSERT INTO public.team_agents (team_id, agent_id) VALUES ($1::uuid, $2) "
            "ON CONFLICT DO NOTHING",
            time_id, agent_id,
        )


@router.delete("/times/{time_id}/agentes/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def sair_do_time(
    time_id: str, agent_id: str, usuario: Usuario = Depends(usuario_atual)
):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "DELETE FROM public.team_agents WHERE team_id = $1::uuid AND agent_id = $2",
            time_id, agent_id,
        )


# ─────────────────────────────────────────────────────────────────────────────
# Configuração da instalação
# ─────────────────────────────────────────────────────────────────────────────


@router.get("/configuracoes/{chave}")
async def ler_configuracao(chave: str, usuario: Usuario = Depends(usuario_atual)):
    """Lê uma configuração. Devolve `null` quando não existe.

    ⚠️ `null` e não 404: "esta configuração ainda não foi definida" é o estado
    normal de uma instalação nova, e a tela trata o ausente com o padrão dela.
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        valor = await conn.fetchval(
            "SELECT value FROM public.app_settings WHERE key = $1", chave
        )
    if isinstance(valor, str):
        try:
            valor = json.loads(valor)
        except ValueError:
            pass
    return {"value": valor}


class ConfiguracaoIn(BaseModel):
    value: object = None


@router.put("/configuracoes/{chave}", status_code=status.HTTP_204_NO_CONTENT)
async def gravar_configuracao(
    chave: str, dados: ConfiguracaoIn, usuario: Usuario = Depends(usuario_atual)
):
    """Grava a configuração, criando ou substituindo.

    O `updated_at` é `now()` do servidor. A tela mandava o horário do navegador,
    e é o mesmo problema de sempre: relógio adiantado faz "alterado há 5 minutos"
    virar "daqui a 5 minutos".
    """
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute(
            "INSERT INTO public.app_settings (key, value, updated_at) "
            "VALUES ($1, $2::text::jsonb, now()) "
            "ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()",
            chave, json.dumps(dados.value),
        )


@router.delete("/configuracoes/{chave}", status_code=status.HTTP_204_NO_CONTENT)
async def apagar_configuracao(chave: str, usuario: Usuario = Depends(usuario_atual)):
    async with sessao(role="authenticated", user_id=usuario.id) as conn:
        await conn.execute("DELETE FROM public.app_settings WHERE key = $1", chave)
