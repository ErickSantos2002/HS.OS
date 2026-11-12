"""Publica no gateway as entradas dos bots pessoais: `hsos-email-<bot>` (flag
`email_ligado`), `hsos-bot-<bot>` (memória, agenda e sistemas — todo bot desde
09/11/2026; o servidor trava os `taskhs_*` sem `sistemas_ligados`) e
`hsos-anexos-<bot>` (todo bot).

    cd backend
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py                                  # ensaio
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py --ligar-email erick-bot          # só banco
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py --ligar-sistema erick-bot taskhs # só banco
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py --ligar-docshs-todos [--aplicar] # só quem tem conta lá
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py --ligar-gestorhs-todos [--aplicar] # idem, GestorHS
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py --ligar-hsgrowth-vendedores [--aplicar] # só salesperson, HSGrowth
    PYTHONPATH=. .venv/bin/python scripts/publicar-bots-mcp.py --aplicar                        # gateway

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
from app.email.regras import FERRAMENTAS_BOT, FERRAMENTAS_EMAIL  # noqa: E402
from app.routers.integracoes import escopo_mcp_do_agente, ferramentas_anexos  # noqa: E402
from app.routers.mcp_anexos import assinatura_do_agente  # noqa: E402
from app.routers.mcp_bot import assinatura_bot  # noqa: E402
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
        raise ValueError("falta GUARDRAILS_API_TOKEN")
    if not segredo:
        raise ValueError("falta ANEXOS_MCP_SEGREDO — sem ele a assinatura não bate com a da "
                         "produção e toda chamada dá 404")
    base = modelo["url"].rsplit("/mcp/", 1)[0]
    novos = {}
    def entrada(caminho, assinatura, ferramentas):
        e = {k: v for k, v in modelo.items() if k not in ("url", "toolFilter", "headers")}
        e["headers"] = _cabecalhos(modelo, token)
        e["url"] = f"{base}/mcp/{caminho}/{assinatura}"
        e["toolFilter"] = {"include": list(ferramentas)}
        return e
    for aid in sorted(com_email):
        novos[f"hsos-email-{aid}"] = entrada(f"email/{aid}", assinatura_email(segredo, aid),
                                             FERRAMENTAS_EMAIL)
    # `hsos-bot` e anexos: todo bot, sem flag (09/11/2026). A agenda mora no
    # `hsos-bot`; publicado só para quem tinha sistema ligado, o Guardi dos
    # outros nunca teria `agenda_criar`. O `publicar-anexos-mcp.py` pula perfil
    # `minimal` de propósito — a entrada do Guardi sai daqui, junto do
    # `tools_do_bot` que a libera só para ele.
    for aid in sorted(bots):
        novos[f"hsos-bot-{aid}"] = entrada(f"bot/{aid}", assinatura_bot(segredo, aid), FERRAMENTAS_BOT)
        novos[f"hsos-anexos-{aid}"] = entrada(f"anexos/{aid}", assinatura_do_agente(segredo, aid),
                                              ferramentas_anexos(aid))
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
            for pref, ferr in (("hsos-email-", FERRAMENTAS_EMAIL), ("hsos-bot-", FERRAMENTAS_BOT),
                               ("hsos-anexos-", None)):
                if n.startswith(pref) and n != f"{pref}{aid}":
                    nomes = ferr or ferramentas_anexos(n[len(pref):])
                    if not {f"{n}__{f}" for f in nomes} <= deny:
                        return False
    return True


def _mascarar(novos: dict) -> dict:
    return {n: {**e, "url": e["url"].rsplit("/", 1)[0] + "/<assinatura>",
                "headers": "<GUARDRAILS_API_TOKEN>"} for n, e in novos.items()}


_ROTULO = {"docshs": "DocsHS", "gestorhs": "GestorHS", "hsgrowth": "HSGrowth"}


async def _ligar_quem_tem_conta(conn, sistema: str, modulo, caminho_eu: str, aplicar: bool,
                                 aceita=None) -> int:
    """Liga `sistema` só em quem TEM conta ativa lá (DocsHS e GestorHS, 11/11/2026).

    Ao contrário do DataCore, nem todo colaborador tem conta em todo sistema:
    ligar para quem não tem faria o Guardi responder "sem conta" a cada
    pergunta, e o AGENTS.md já promete a ferramenta. Pergunta `caminho_eu` com
    o token de cada dono — 200 entra, o resto é listado. Só GET; o sistema
    precisa estar com a chave pública do HS.OS no ar, senão todo mundo sai como
    "sem conta". `aceita(eu)` (opcional) decide, sobre a resposta do "eu", se a
    pessoa entra nesta fase — o HSGrowth só liga para `salesperson`."""
    rotulo = _ROTULO[sistema]
    linhas = await conn.fetch(
        "SELECT a.agent_id, pr.email FROM public.agent_profiles a "
        "  JOIN public.profiles pr ON pr.id = a.dono_id "
        "  JOIN auth.users u ON u.id = a.dono_id "
        " WHERE a.dono_id IS NOT NULL AND u.is_active AND pr.email IS NOT NULL "
        "   AND NOT ($1 = ANY(coalesce(a.sistemas_ligados, '{}'))) ORDER BY a.agent_id", sistema)
    com_conta, sem_conta, fora_da_fase = [], [], []
    for l in linhas:
        try:
            eu = await modulo.chamar(l["email"], l["agent_id"], caminho_eu, dono=None)
            if aceita is not None and not aceita(eu if isinstance(eu, dict) else {}):
                papel = eu.get("role") if isinstance(eu, dict) else None
                fora_da_fase.append(f"{l['agent_id']} (fora desta fase: {papel})")
                continue
            com_conta.append(l["agent_id"])
        except modulo.ErroSistema as e:
            sem_conta.append(f"{l['agent_id']} ({e.status or 'sem resposta'})")
    print(f"Com conta no {rotulo}:", ", ".join(com_conta) or "(nenhum)")
    print(f"Sem conta no {rotulo} (ou inativo lá):", ", ".join(sem_conta) or "(nenhum)")
    if aceita is not None:
        print(f"{rotulo}: com conta, fora desta fase —", ", ".join(fora_da_fase) or "(nenhum)")
    if not aplicar:
        print("(ensaio — nada foi escrito)")
        return 0
    if com_conta:
        n = await conn.fetchval(
            "WITH u AS (UPDATE public.agent_profiles SET sistemas_ligados = (SELECT "
            "  array_agg(DISTINCT x) FROM unnest(sistemas_ligados || $2::text) x) "
            "  WHERE agent_id = ANY($1::text[]) AND dono_id IS NOT NULL RETURNING 1) "
            "SELECT count(*) FROM u", com_conta, sistema)
        print(f"{rotulo} ligado em {n} bots")
    return 0


async def _ligar_docshs_todos(conn, aplicar: bool) -> int:
    """Spec 2026-11-11-guardi-docshs: confere por `/auth/eu`."""
    from app.sistemas import docshs
    return await _ligar_quem_tem_conta(conn, "docshs", docshs, "/auth/eu", aplicar)


async def _ligar_gestorhs_todos(conn, aplicar: bool) -> int:
    """Spec 2026-11-11-guardi-gestorhs: confere por `/auth/me` (o "eu" de lá)."""
    from app.sistemas import gestorhs
    return await _ligar_quem_tem_conta(conn, "gestorhs", gestorhs, "/auth/me", aplicar)


def _so_vendedor(eu: dict) -> bool:
    """Fase 1 do HSGrowth: só a função `salesperson` (gerente e admin ficam fora)."""
    return eu.get("role") == "salesperson"


async def _ligar_hsgrowth_vendedores(conn, aplicar: bool) -> int:
    """Spec 2026-11-12-guardi-hsgrowth-vendas: confere por `/users/me` e só
    liga para quem tem conta lá E função de vendedor."""
    from app.sistemas import hsgrowth
    return await _ligar_quem_tem_conta(conn, "hsgrowth", hsgrowth, "/users/me", aplicar,
                                       aceita=_so_vendedor)


async def main() -> int:
    import os

    from app.database import close_db, get_pool, init_db, sessao
    from app.gateway.patch import aplicar_patch, config_do_gateway

    ap = argparse.ArgumentParser()
    ap.add_argument("--aplicar", action="store_true")
    ap.add_argument("--ligar-email", help="liga email_ligado de UM bot pessoal (só banco)")
    ap.add_argument("--ligar-todos", action="store_true",
                    help="liga e-mail e TaskHS em TODOS os bots pessoais (só banco)")
    ap.add_argument("--ligar-sistema", nargs=2, metavar=("BOT", "SISTEMA"),
                    help="acrescenta um sistema (taskhs, datacore, docshs, gestorhs, hsgrowth) a sistemas_ligados de UM bot (só banco)")
    ap.add_argument("--ligar-datacore-todos", action="store_true",
                    help="acrescenta datacore a sistemas_ligados de TODOS os bots pessoais (só banco)")
    ap.add_argument("--ligar-docshs-todos", action="store_true",
                    help="acrescenta docshs a sistemas_ligados dos bots cujo dono TEM conta ativa no "
                         "DocsHS (confere por /auth/eu; ensaio sem --aplicar; só banco)")
    ap.add_argument("--ligar-gestorhs-todos", action="store_true",
                    help="acrescenta gestorhs a sistemas_ligados dos bots cujo dono TEM conta ativa no "
                         "GestorHS (confere por /auth/me; ensaio sem --aplicar; só banco)")
    ap.add_argument("--ligar-hsgrowth-vendedores", action="store_true",
                    help="acrescenta hsgrowth a sistemas_ligados dos bots cujo dono TEM conta no HSGrowth "
                         "com função salesperson (confere por /users/me; ensaio sem --aplicar; só banco)")
    a = ap.parse_args()

    await init_db()
    if get_pool() is None:
        print("Não conectei no banco.")
        return 1
    try:
        async with sessao(role="service_role") as conn:
            if a.ligar_todos:
                n = await conn.fetchval(
                    "WITH u AS (UPDATE public.agent_profiles SET email_ligado = true, "
                    "  sistemas_ligados = (SELECT array_agg(DISTINCT x) FROM unnest(sistemas_ligados || "
                    "  '{taskhs}'::text[]) x) WHERE dono_id IS NOT NULL RETURNING 1) SELECT count(*) FROM u")
                print(f"e-mail e TaskHS ligados em {n} bots")
                return 0
            if a.ligar_datacore_todos:
                n = await conn.fetchval(
                    "WITH u AS (UPDATE public.agent_profiles SET sistemas_ligados = (SELECT "
                    "  array_agg(DISTINCT x) FROM unnest(sistemas_ligados || '{datacore}'::text[]) x) "
                    "  WHERE dono_id IS NOT NULL RETURNING 1) SELECT count(*) FROM u")
                print(f"DataCore ligado em {n} bots")
                return 0
            if a.ligar_docshs_todos:
                return await _ligar_docshs_todos(conn, a.aplicar)
            if a.ligar_gestorhs_todos:
                return await _ligar_gestorhs_todos(conn, a.aplicar)
            if a.ligar_hsgrowth_vendedores:
                return await _ligar_hsgrowth_vendedores(conn, a.aplicar)
            if a.ligar_email:
                ok = await conn.fetchval(
                    "UPDATE public.agent_profiles SET email_ligado = true "
                    " WHERE agent_id = $1 AND dono_id IS NOT NULL RETURNING agent_id", a.ligar_email)
                print(f"email_ligado em {a.ligar_email}: {'ok' if ok else 'NÃO (não é bot pessoal?)'}")
                return 0 if ok else 1
            if a.ligar_sistema:
                bot, sistema = a.ligar_sistema
                if sistema not in ("taskhs", "datacore", "docshs", "gestorhs", "hsgrowth"):
                    print("sistema desconhecido (por ora: taskhs, datacore, docshs, gestorhs, hsgrowth)")
                    return 1
                ok = await conn.fetchval(
                    "UPDATE public.agent_profiles SET sistemas_ligados = "
                    "  (SELECT array_agg(DISTINCT x) FROM unnest(sistemas_ligados || $2::text) x) "
                    " WHERE agent_id = $1 AND dono_id IS NOT NULL RETURNING agent_id", bot, sistema)
                print(f"{sistema} em {bot}: {'ok' if ok else 'NÃO (não é bot pessoal?)'}")
                return 0 if ok else 1
            linhas = await conn.fetch("SELECT agent_id, email_ligado "
                                      "  FROM public.agent_profiles WHERE dono_id IS NOT NULL")
        bots = {l["agent_id"] for l in linhas}
        com_email = {l["agent_id"] for l in linhas if l["email_ligado"]}
        conf, base_hash = await config_do_gateway()
        # Como a produção lê: `integration_secrets` primeiro, depois o ambiente.
        from app.integracoes import ler_segredo
        segredo = await ler_segredo("ANEXOS_MCP_SEGREDO") or os.environ.get("ANEXOS_MCP_SEGREDO", "")
        token = await ler_segredo("GUARDRAILS_API_TOKEN") or os.environ.get("GUARDRAILS_API_TOKEN", "")
        try:
            patch, novos = montar_patch(conf, segredo, token, bots, com_email)
        except ValueError as e:
            print("❌", e)
            return 1
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
