"""Criação do bot pessoal — `POST /agents/bots-pessoais` e o script local.

Spec: `docs/superpowers/specs/2026-11-05-bots-pessoais-cascas-design.md`.

⚠️ **Não é o `POST /agents`.** Aquele foi feito para especialista, e três passos
dele contrariam o bot: põe o agente no `agentToAgent`, reescreve o roster no
`AGENTS.md` da `nina` (a ~500 caracteres do teto) e pede à orquestradora que
escreva os sete arquivos com LLM. Aqui o backend escreve os arquivos, o bot
fica fora do `agentToAgent` e a `nina` nem fica sabendo.

⚠️ **Gateway primeiro, fechado ou nada, e repetível.** Mesma regra do
`POST /agents`: se o escopo não fechar, a criação é desfeita. E como são 23 de
uma vez, rodar de novo ADOTA o que ficou pela metade em vez de duplicar.

`criar_bot` recebe as dependências por parâmetro (`_Deps`) para ser testada
sem gateway nem banco — ver `tests/test_bots_pessoais_criacao.py`.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.bots_pessoais import (
    EMOJI, arquivos_do_bot, bot_esta_fechado, id_do_bot, motivo_inelegivel,
    nome_do_bot, tools_do_bot,
)
from app.database import sessao
from app.dependencies import Usuario, exige_papel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/agents", tags=["bots-pessoais"])

# O mesmo dos especialistas (`agent_profiles.model`, 05/11/2026). Mudar o
# modelo deles não muda este: o `models.json` de cada agente já não acompanha a
# config sozinho (ver CLAUDE.md), e com 28 agentes isso é assunto à parte.
MODELO = "deepseek/deepseek-chat"


def _workspace(agent_id: str) -> str:
    return f"/root/.openclaw/workspace-{agent_id}"


class _Deps:
    """As pontas reais: banco, gateway e o desfazer do `POST /agents`."""

    async def perfil(self, user_id: str) -> dict | None:
        async with sessao(role="service_role") as conn:
            r = await conn.fetchrow(
                "SELECT p.id::text AS id, p.full_name, p.email, p.departamento, "
                "       COALESCE(u.is_active, false) AS ativo "
                "  FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id "
                " WHERE p.id = $1::uuid", user_id)
        return dict(r) if r else None

    async def linha(self, agent_id: str) -> dict | None:
        async with sessao(role="service_role") as conn:
            r = await conn.fetchrow(
                "SELECT agent_id, dono_id::text AS dono_id FROM public.agent_profiles "
                " WHERE agent_id = $1", agent_id)
        return dict(r) if r else None

    async def inserir(self, agent_id: str, dono: dict, nome_bot: str) -> None:
        async with sessao(role="service_role") as conn:
            await conn.execute(
                """
                INSERT INTO public.agent_profiles
                    (agent_id, openclaw_id, name, emoji, specialty, workspace, model,
                     access_type, allowed_user_ids, status, is_official, dono_id)
                VALUES ($1, $1, $2, $3, $4, $5, $6, 'admins_only', '{}', 'active',
                        false, $7::uuid)
                ON CONFLICT (agent_id) DO UPDATE SET
                    dono_id = EXCLUDED.dono_id, name = EXCLUDED.name,
                    specialty = EXCLUDED.specialty, access_type = 'admins_only',
                    allowed_user_ids = '{}'
                """,
                agent_id, nome_bot, EMOJI,
                f"Assistente pessoal de {(dono.get('full_name') or '').strip()}",
                _workspace(agent_id), MODELO, dono["id"],
            )

    async def chamar(self, metodo: str, params: dict) -> dict:
        from app.gateway import config as cfg
        from app.gateway.client import obter_cliente

        c = await cfg.carregar()
        return await obter_cliente(c.url, c.token).chamar(metodo, params)

    async def config(self) -> tuple[dict, str]:
        from app.gateway import patch as patch_gw

        return await patch_gw.config_do_gateway()

    async def patch(self, patch: dict, base_hash: str, conferir) -> None:
        from app.gateway import patch as patch_gw

        await patch_gw.aplicar_patch(patch, base_hash, conferir=conferir)

    async def desfazer(self, agent_id: str) -> bool:
        from app.routers.agents import _desfazer_criacao

        return await _desfazer_criacao(agent_id)


def _no_gateway(conf: dict, agent_id: str) -> dict | None:
    return next((a for a in (conf.get("agents") or {}).get("list") or []
                 if str(a.get("id")) == agent_id), None)


def _servidores(conf: dict) -> dict:
    return ((conf.get("mcp") or {}).get("servers")) or {}


async def criar_bot(user_id: str, deps=None) -> dict:
    """Cria (ou adota, ou reconhece) o bot de UMA pessoa. Nunca levanta.

    Devolve `{user_id, agent_id, resultado, motivo}`, com `resultado` em
    `criado` · `adotado` · `já existia` · `falhou`.
    """
    deps = deps or _Deps()
    perfil = await deps.perfil(user_id)
    if perfil is None:
        return {"user_id": user_id, "agent_id": None, "resultado": "falhou",
                "motivo": "perfil não encontrado"}
    aid = id_do_bot(perfil.get("full_name") or "")
    saida = {"user_id": user_id, "agent_id": aid, "resultado": "falhou", "motivo": None}

    motivo = motivo_inelegivel(perfil)
    if motivo:
        return {**saida, "motivo": motivo}

    linha = await deps.linha(aid)
    if linha and (linha.get("dono_id") or None) != user_id:
        # Especialista (dono NULL) ou bot de outra pessoa com o mesmo primeiro
        # nome: não se mexe em agente que não é desta pessoa.
        return {**saida, "motivo": f"colisão: já existe o agente {aid} de outro dono"}

    conf, _ = await deps.config()
    try:
        # Antes de qualquer escrita: config que não permite fechar o bot recusa
        # aqui, sem criar nada e sem desfazer bot que já existia.
        tools_do_bot(_servidores(conf))
    except ValueError as e:
        return {**saida, "motivo": str(e)}
    no_gw = _no_gateway(conf, aid)
    if linha and no_gw and bot_esta_fechado(no_gw.get("tools") or {}, _servidores(conf)):
        return {**saida, "resultado": "já existia"}
    adotado = bool(linha or no_gw)

    try:
        if not no_gw:
            # `name` = id: os agentes desta instalação têm id = nome minúsculo,
            # e é o id que precisamos controlar. O nome exibido mora no banco.
            await deps.chamar("agents.create", {
                "name": aid, "workspace": _workspace(aid), "model": MODELO, "emoji": EMOJI,
            })
            conf, _ = await deps.config()
            if not _no_gateway(conf, aid):
                raise RuntimeError(f"agents.create respondeu, mas {aid} não apareceu na config")

        await deps.inserir(aid, perfil, nome_do_bot(perfil.get("full_name") or ""))

        for nome, conteudo in arquivos_do_bot(perfil).items():
            await deps.chamar("agents.files.set", {"agentId": aid, "name": nome, "content": conteudo})

        conf, base_hash = await deps.config()
        servidores = _servidores(conf)
        lista = [dict(a) for a in (conf.get("agents") or {}).get("list") or []]
        alvo = next(a for a in lista if str(a.get("id")) == aid)
        alvo["tools"] = tools_do_bot(servidores)
        await deps.patch(
            {"agents": {"list": lista}}, base_hash,
            lambda c: bot_esta_fechado((_no_gateway(c, aid) or {}).get("tools") or {}, servidores),
        )
    except Exception as e:  # noqa: BLE001
        logger.error("Bot %s não fechou — desfazendo: %s", aid, e)
        if not await deps.desfazer(aid):
            logger.error("Bot %s ficou no gateway sem escopo — remova à mão", aid)
        return {**saida, "motivo": str(e)[:300]}

    logger.info("Bot pessoal %s %s para %s", aid, "adotado" if adotado else "criado", user_id)
    return {**saida, "resultado": "adotado" if adotado else "criado"}


class BotsIn(BaseModel):
    user_ids: list[str]


@router.post("/bots-pessoais")
async def criar_bots(dados: BotsIn, _: Usuario = Depends(exige_papel("administrador"))):
    """Cria o bot de cada pessoa da lista, uma de cada vez. Idempotente.

    Em série de propósito: cada criação faz um `config.patch`, e o patch
    derruba o WebSocket no reload — em paralelo, um pisaria no hash do outro.
    """
    return {"resultados": [await criar_bot(u) for u in dados.user_ids]}
