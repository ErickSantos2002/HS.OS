"""Publica no gateway a entrada `hsos-email-<bot>` dos bots com e-mail ligado.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/publicar-email-mcp.py                     # ensaio
    PYTHONPATH=. .venv/bin/python scripts/publicar-email-mcp.py --ligar erick-bot   # só banco
    PYTHONPATH=. .venv/bin/python scripts/publicar-email-mcp.py --aplicar           # escreve no gateway

Lê o `backend/.env` (banco, gateway, `ANEXOS_MCP_SEGREDO`, `GUARDRAILS_API_TOKEN`)
e exige o túnel do OpenClaw. Spec: 2026-11-05-bot-email-piloto.

⚠️ **Declarar um servidor MCP o entrega a todo agente de perfil `coding`.** O
MESMO patch que declara as entradas recalcula o `tools` de TODOS os agentes:
bot com e-mail → `tools_do_bot(email=True)`; outros bots → fechados como
antes; especialistas → `escopo_mcp_do_agente`, que passa a negar
`hsos-email-*`. Sem isso a `nina` teria `email_listar` na caixa do Erick.

⚠️ A URL aponta para o backend de PRODUÇÃO (copiada do `hsos-relatorios`): o
gateway só alcança ele. Aplicar antes do deploy publica uma ferramenta que
responde 404. É ESCRITA NO GATEWAY: mostrar o ensaio ao Erick antes.
"""
import argparse
import asyncio
import copy
import json
import sys

from dotenv import load_dotenv

load_dotenv()

from app.bots_pessoais import tools_do_bot  # noqa: E402
from app.email.regras import FERRAMENTAS_EMAIL  # noqa: E402
from app.routers.integracoes import escopo_mcp_do_agente  # noqa: E402
from app.routers.mcp_email import assinatura_email  # noqa: E402


def _cabecalhos(modelo: dict, token: str) -> dict:
    """Nomes do modelo, valor do GUARDRAILS_API_TOKEN — o `config.get` devolve
    os cabeçalhos redigidos e o `config.patch` recusa o sentinela."""
    nomes = list((modelo.get("headers") or {}).keys()) or ["Authorization"]
    return {n: (f"Bearer {token}" if n.lower() == "authorization" else token) for n in nomes}


def montar_patch(conf: dict, segredo: str, token: str, bots: set[str],
                 com_email: set[str]) -> tuple[dict, dict]:
    servidores = (conf.get("mcp") or {}).get("servers") or {}
    modelo = servidores.get("hsos-relatorios")
    if not modelo:
        raise ValueError("não achei hsos-relatorios em mcp.servers para copiar URL e cabeçalhos")
    if not token:
        raise ValueError("falta GUARDRAILS_API_TOKEN no ambiente")
    base = modelo["url"].rsplit("/mcp/", 1)[0]
    novos = {}
    for aid in sorted(com_email):
        e = {k: v for k, v in modelo.items() if k not in ("url", "toolFilter", "headers")}
        e["headers"] = _cabecalhos(modelo, token)
        e["url"] = f"{base}/mcp/email/{aid}/{assinatura_email(segredo, aid)}"
        e["toolFilter"] = {"include": list(FERRAMENTAS_EMAIL)}
        novos[f"hsos-email-{aid}"] = e
    depois = {**servidores, **novos}
    agentes = copy.deepcopy((conf.get("agents") or {}).get("list") or [])
    for a in agentes:
        aid = str(a.get("id"))
        if aid in bots:
            a["tools"] = tools_do_bot(depois, aid, email=aid in com_email)
        else:
            a["tools"] = escopo_mcp_do_agente(aid, a.get("tools") or {}, depois)
    return {"mcp": {"servers": novos}, "agents": {"list": agentes}}, novos


def conferir(parsed: dict, novos: dict, bots: set[str], com_email: set[str]) -> bool:
    """Na config RELIDA: entradas com a URL certa; bot com e-mail fechado COM
    e-mail; todo o resto nega todas as entradas de e-mail que não são suas."""
    from app.bots_pessoais import bot_esta_fechado
    s = (parsed.get("mcp") or {}).get("servers") or {}
    if not all(n in s and s[n].get("url") == e["url"] for n, e in novos.items()):
        return False
    for a in (parsed.get("agents") or {}).get("list") or []:
        aid, t = str(a.get("id")), a.get("tools") or {}
        if aid in bots and not bot_esta_fechado(t, s, aid, aid in com_email):
            return False
        deny = set(t.get("deny") or [])
        for n in s:
            if n.startswith("hsos-email-") and n != f"hsos-email-{aid}":
                if not {f"{n}__{f}" for f in FERRAMENTAS_EMAIL} <= deny:
                    return False
    return True


def _mascarar(novos: dict) -> dict:
    return {n: {**e, "url": e["url"].rsplit("/", 1)[0] + "/<assinatura>",
                "headers": "<GUARDRAILS_API_TOKEN>"} for n, e in novos.items()}


async def main() -> int:
    import os

    from app.database import close_db, get_pool, init_db, sessao
    from app.gateway.patch import aplicar_patch, config_do_gateway

    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--ligar", help="liga email_ligado de UM bot pessoal (só banco)")
    a = ap.parse_args()

    await init_db()
    if get_pool() is None:
        print("Não conectei no banco.")
        return 1
    try:
        async with sessao(role="service_role") as conn:
            if a.ligar:
                ok = await conn.fetchval(
                    "UPDATE public.agent_profiles SET email_ligado = true "
                    " WHERE agent_id = $1 AND dono_id IS NOT NULL RETURNING agent_id", a.ligar)
                print(f"email_ligado em {a.ligar}: {'ok' if ok else 'NÃO (não é bot pessoal?)'}")
                return 0 if ok else 1
            linhas = await conn.fetch("SELECT agent_id, email_ligado FROM public.agent_profiles "
                                      " WHERE dono_id IS NOT NULL")
        bots = {l["agent_id"] for l in linhas}
        com_email = {l["agent_id"] for l in linhas if l["email_ligado"]}
        conf, base_hash = await config_do_gateway()
        patch, novos = montar_patch(conf, os.environ.get("ANEXOS_MCP_SEGREDO", ""),
                                    os.environ.get("GUARDRAILS_API_TOKEN", ""), bots, com_email)
        print("Bots com e-mail:", sorted(com_email) or "(nenhum)")
        print("Entradas:", json.dumps(_mascarar(novos), ensure_ascii=False, indent=1))
        print(f"agents.list reescrito: {len(patch['agents']['list'])} agentes")
        if not a.aplicar:
            print("(ensaio — nada foi escrito)")
            return 0
        await aplicar_patch(patch, base_hash,
                            conferir=lambda c: conferir(c, novos, bots, com_email))
        print("✅ aplicado e conferido na releitura")
        return 0
    finally:
        await close_db()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
