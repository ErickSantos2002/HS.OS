"""Cria os bots pessoais (`<nome>-bot`) — ensaio por padrão.

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/criar-bots-pessoais.py                 # ensaio
    PYTHONPATH=. .venv/bin/python scripts/criar-bots-pessoais.py --aplicar --so <user_id>
    PYTHONPATH=. .venv/bin/python scripts/criar-bots-pessoais.py --aplicar --todos

Lê o `backend/.env` (banco e gateway) e exige o túnel do OpenClaw aberto.
Spec: `docs/superpowers/specs/2026-11-05-bots-pessoais-cascas-design.md`.

⚠️ É ESCRITA NO GATEWAY. O ensaio lista quem ganha bot e o payload completo de
uma pessoa, sem escrever nada — e tem que ser mostrado ao Erick antes do
`--aplicar`. Primeiro uma casca (`--so`), conferida perguntando ao bot o que
ele enxerga; só depois o lote.

⚠️ **A lista de quem ganha é DECISÃO, não regra:** o Nicholson fica de fora
(continua só com os cinco especialistas), e isso vive em `FORA_POR_DECISAO`
(`app/bots_pessoais.py`), que a rota também confere. Quem for contratado depois entra sozinho no `--todos`.
"""
import argparse
import asyncio
import json
import sys

from dotenv import load_dotenv

load_dotenv()

from app.bots_pessoais import (  # noqa: E402
    EMOJI, FORA_POR_DECISAO, arquivos_do_bot, id_do_bot, motivo_inelegivel, nome_do_bot, tools_do_bot)
from app.database import close_db, get_pool, init_db, sessao  # noqa: E402
from app.routers.bots_pessoais import MODELO, _Deps, _servidores, _workspace, criar_bot  # noqa: E402



async def _candidatos() -> list[dict]:
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT p.id::text AS id, p.full_name, p.email, p.departamento, "
            "       COALESCE(u.is_active, false) AS ativo "
            "  FROM public.profiles p LEFT JOIN auth.users u ON u.id = p.id ORDER BY p.full_name")
    return [dict(r) for r in linhas
            if (r["email"] or "").lower() not in FORA_POR_DECISAO and motivo_inelegivel(dict(r)) is None]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--so", help="user_id de UMA pessoa")
    g.add_argument("--todos", action="store_true")
    ap.add_argument("--reescrever-agents-md", action="store_true",
                    help="regrava SÓ o AGENTS.md dos bots existentes (template novo, "
                         "preserva o bloco da empresa); com --so, só aquela pessoa")
    ap.add_argument("--reescrever-soul", action="store_true",
                    help="regrava SÓ o SOUL.md dos bots existentes com o template atual")
    a = ap.parse_args()

    if a.reescrever_agents_md:
        return await _reescrever_agents_md(a.aplicar, a.so)
    if a.reescrever_soul:
        return await _reescrever_agents_md(a.aplicar, a.so, arquivo="SOUL.md")

    candidatos = await _candidatos()
    ids = [id_do_bot(c["full_name"]) for c in candidatos]
    repetidos = {i for i in ids if ids.count(i) > 1}

    if not a.aplicar:
        print(f"{len(candidatos)} pessoas ganhariam bot:")
        for c, i in zip(candidatos, ids):
            print(f"  {i:16} {c['full_name']:45} {c['email']}{'  ⚠️ COLISÃO' if i in repetidos else ''}")
        alvo = next((c for c in candidatos if c["id"] == a.so), candidatos[0] if candidatos else None)
        if alvo:
            conf, _ = await _Deps().config()
            aid = id_do_bot(alvo["full_name"])
            print(f"\nPayload de {aid}:")
            print("agents.create", json.dumps({"name": aid, "workspace": _workspace(aid),
                                               "model": MODELO, "emoji": EMOJI}, ensure_ascii=False))
            print("agent_profiles", json.dumps({"name": nome_do_bot(alvo["full_name"]),
                                                "dono_id": alvo["id"], "access_type": "admins_only"},
                                               ensure_ascii=False))
            print("tools", json.dumps(tools_do_bot(_servidores(conf)), ensure_ascii=False, indent=1))
            for nome, conteudo in arquivos_do_bot(alvo).items():
                print(f"\n----- {nome} ({len(conteudo)} caracteres) -----\n{conteudo}")
        print("\n(ensaio — nada foi escrito)")
        return 0

    if repetidos:
        print("Colisão de primeiro nome, resolva antes:", sorted(repetidos))
        return 1
    if a.so:
        alvos = [a.so]
    elif a.todos:
        alvos = [c["id"] for c in candidatos]
    else:
        print("--aplicar exige --so <user_id> ou --todos")
        return 2
    falhas = 0
    for u in alvos:
        r = await criar_bot(u)
        falhas += r["resultado"] == "falhou"
        print(f"  {r['agent_id'] or '?':16} {r['resultado']:11} {r['motivo'] or ''}")
    return 1 if falhas else 0


async def _reescrever_agents_md(aplicar: bool, so: str | None, arquivo: str = "AGENTS.md") -> int:
    """Para mudança no template que precisa chegar aos bots VIVOS — a criação
    não reescreve arquivo de bot existente (é dele: MEMORY.md, empresa)."""
    from app.bots_pessoais import agents_md_novo
    from app.gateway.client import excede_o_teto
    deps = _Deps()
    async with sessao(role="service_role") as conn:
        linhas = await conn.fetch(
            "SELECT a.agent_id, a.name AS nome_bot, p.id::text AS id, p.full_name, p.email, p.departamento "
            "  FROM public.agent_profiles a JOIN public.profiles p ON p.id = a.dono_id "
            " WHERE ($1::uuid IS NULL OR p.id = $1::uuid) ORDER BY a.agent_id", so)
    falhas = 0
    for l in linhas:
        r = await deps.chamar("agents.files.get", {"agentId": l["agent_id"], "name": arquivo})
        atual = ((r.get("file") or {}).get("content")) or ""
        novo = (agents_md_novo(dict(l), atual) if arquivo == "AGENTS.md"
                else arquivos_do_bot(dict(l), nome_bot=l["nome_bot"])[arquivo])
        if excede_o_teto(novo):
            print(f"  {l['agent_id']:16} NÃO: passaria do teto")
            falhas += 1
            continue
        if novo == atual:
            print(f"  {l['agent_id']:16} já está igual")
            continue
        if not aplicar:
            print(f"  {l['agent_id']:16} mudaria ({len(atual)} → {len(novo)} caracteres)")
            continue
        await deps.chamar("agents.files.set",
                          {"agentId": l["agent_id"], "name": arquivo, "content": novo})
        v = await deps.chamar("agents.files.get", {"agentId": l["agent_id"], "name": arquivo})
        ok = ((v.get("file") or {}).get("content")) == novo
        falhas += not ok
        print(f"  {l['agent_id']:16} {'regravado' if ok else 'FALHOU na releitura'}")
    if not aplicar:
        print("(ensaio — nada foi escrito)")
    return 1 if falhas else 0


async def _rodar() -> int:
    # Fora do uvicorn ninguém abre o pool — sem isto, "banco indisponível".
    await init_db()
    if get_pool() is None:
        print("Não conectei no banco (DATABASE_URL do backend/.env).")
        return 1
    try:
        return await main()
    finally:
        await close_db()


if __name__ == "__main__":
    sys.exit(asyncio.run(_rodar()))
