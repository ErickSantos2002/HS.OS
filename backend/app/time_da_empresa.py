"""O time da Health & Safety, no `USER.md` de todo agente (05/11/2026).

⚠️ Origem: o `erick-bot` não sabia quem era o Gustavo (coordenador da
Qualidade) e, sem saber, INVENTOU acesso ("consigo ver na tabela de perfis").
Fato organizacional que o agente precisa saber tem que estar escrito — senão
ele deduz, com a mesma confiança de um dado.

Bloco GERADO do cadastro (`profiles` + `agent_profiles`), entre marcadores —
mesmo padrão do `hsos:empresa`. No `USER.md` porque o `AGENTS.md` da `nina`
vive no teto e os `USER.md` têm folga.
"""
from __future__ import annotations

import logging

from app.bots_pessoais import _linha

logger = logging.getLogger(__name__)

MARCA_INICIO = "<!-- hsos:time:inicio -->"
MARCA_FIM = "<!-- hsos:time:fim -->"


def montar_bloco(pessoas: list[dict], especialistas: list[dict], bots: list[dict]) -> str:
    linhas = [MARCA_INICIO, "## O time da Health & Safety (atualizado automaticamente)", "",
              "Conhecer alguém daqui **não** me dá acesso à agenda, ao e-mail ou aos dados dessa "
              "pessoa — só sei quem é, o que faz e como contatar.", "", "### Pessoas"]
    for p in sorted(pessoas, key=lambda p: ((p.get("departamento") or "~"), p.get("full_name") or "")):
        partes = [_linha(p.get("full_name"))]
        papel = ", ".join(x for x in (_linha(p.get("cargo")), _linha(p.get("departamento"))) if x)
        if papel:
            partes.append(papel)
        if p.get("email"):
            partes.append(_linha(p["email"]))
        linhas.append("- " + " — ".join(partes))
    if especialistas:
        linhas += ["", "### Agentes especialistas (atendem o Nicholson)"]
        for e in especialistas:
            linhas.append(f"- {_linha(e.get('name'))} (`{e['agent_id']}`) — {_linha(e.get('specialty'))}")
    if bots:
        linhas += ["", "### Bots pessoais (cada um trabalha para uma pessoa)"]
        for b in sorted(bots, key=lambda b: b.get("dono") or ""):
            linhas.append(f"- {_linha(b.get('name'))} (`{b['agent_id']}`) — de {_linha(b.get('dono'))}")
    linhas.append(MARCA_FIM)
    return "\n".join(linhas) + "\n"


def com_bloco(atual: str, bloco: str) -> str:
    i, f = atual.find(MARCA_INICIO), atual.find(MARCA_FIM)
    if i != -1 and f > i:
        return atual[:i] + bloco.rstrip("\n") + atual[f + len(MARCA_FIM):]
    return atual.rstrip() + "\n\n" + bloco


async def carregar(conn) -> tuple[list, list, list]:
    pessoas = await conn.fetch(
        "SELECT p.full_name, p.cargo, p.departamento, p.email FROM public.profiles p "
        "  JOIN auth.users u ON u.id = p.id "
        " WHERE u.is_active AND p.email ILIKE '%@healthsafetytech.com' AND p.email NOT ILIKE 'teste%'")
    especialistas = await conn.fetch(
        "SELECT agent_id, name, specialty FROM public.agent_profiles "
        " WHERE dono_id IS NULL AND status IS DISTINCT FROM 'inactive' ORDER BY sort_order, name")
    bots = await conn.fetch(
        "SELECT a.agent_id, a.name, p.full_name AS dono FROM public.agent_profiles a "
        "  JOIN public.profiles p ON p.id = a.dono_id ORDER BY p.full_name")
    return [dict(x) for x in pessoas], [dict(x) for x in especialistas], [dict(x) for x in bots]


async def atualizar(agentes: list[str], aplicar: bool = True) -> dict[str, str]:
    """Regrava o bloco no `USER.md` de cada agente. Confere o teto e relê."""
    from app.database import sessao
    from app.gateway import config as cfg
    from app.gateway.client import excede_o_teto, obter_cliente
    async with sessao(role="service_role") as conn:
        bloco = montar_bloco(*await carregar(conn))
    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    out = {}
    for aid in agentes:
        r = await cli.chamar("agents.files.get", {"agentId": aid, "name": "USER.md"})
        atual = ((r.get("file") or {}).get("content")) or ""
        novo = com_bloco(atual, bloco)
        if excede_o_teto(novo):
            out[aid] = f"NÃO: passaria do teto ({len(novo)})"
        elif novo == atual:
            out[aid] = "já igual"
        elif not aplicar:
            out[aid] = f"mudaria ({len(atual)} → {len(novo)})"
        else:
            await cli.chamar("agents.files.set", {"agentId": aid, "name": "USER.md", "content": novo})
            v = await cli.chamar("agents.files.get", {"agentId": aid, "name": "USER.md"})
            out[aid] = "regravado" if ((v.get("file") or {}).get("content")) == novo else "FALHOU na releitura"
    return out


async def agentes_com_bloco() -> list[str]:
    """Quem já recebeu o bloco — para renomear um bot atualizar todos eles."""
    from app.gateway import config as cfg
    from app.gateway.client import obter_cliente
    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    lista = (await cli.chamar("agents.list", {})).get("agents") or []
    com = []
    for a in lista:
        r = await cli.chamar("agents.files.get", {"agentId": a["id"], "name": "USER.md"})
        if MARCA_INICIO in (((r.get("file") or {}).get("content")) or ""):
            com.append(a["id"])
    return com
