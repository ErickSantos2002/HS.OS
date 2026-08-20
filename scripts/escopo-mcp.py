"""Escopo de MCP por agente: cada um enxerga o que é dele.

⚠️ O `alsoAllow` usa o nome COM `mcp__`; o `deny` usa SEM. Os dois convivem no
mesmo objeto e aceitam formatos diferentes — aplicar o deny com prefixo grava,
passa em qualquer conferência que releia a config, e não remove nada.
"""
import asyncio, json, os, sys
sys.path.insert(0, "/home/ericks/github/HS.OS/backend")
from app.gateway.client import obter_cliente
from app.gateway.patch import aplicar_patch, config_do_gateway

# Todo agente tem: identidade de quem fala com ele, base de conhecimento,
# publicar página e o alerta. Cortar qualquer um contradiz os arquivos dele.
COMUM = ["banco-diretorio-hs-os__query",
         "hsos-documentos__documento_listar", "hsos-documentos__documento_ler",
         "hsos-documentos__documento_criar", "hsos-documentos__documento_editar",
         "hsos-relatorios__publicar_pagina"]
PROPRIO = {
    "nina":  ["banco-hsos__query"],                       # orquestra: delega o domínio
    "iris":  ["banco-datacorehs__query"],                 # faturamento
    "atlas": ["banco-hsgrowth__query",                    # CRM
              "hsos-relatorios__relatorio_vendedores"],
    "flow":  ["banco-gestorhs__query", "banco-taskhs__query",
              "banco-chamadoshs__query"],                 # operação
    "bruce": ["banco-talenths__query", "banco-pessoas-hs__query"],
}

async def main() -> int:
    aplicar = "--aplicar" in sys.argv
    cli = obter_cliente("ws://127.0.0.1:18789", os.environ.get("OPENCLAW_ADMIN_TOKEN", ""))
    conf, base_hash = await config_do_gateway()
    servidores = (conf.get("mcp") or {}).get("servers") or {}

    todas = {f"{s}__{t}"
             for s, c in servidores.items() if "alerta" not in s
             for t in ((((c or {}).get("toolFilter") or {}).get("include")) or ["query"])}

    agentes = json.loads(json.dumps(conf.get("agents", {}).get("list") or []))
    if not agentes:
        a = await cli.chamar("agents.list", {})
        agentes = json.loads(json.dumps((a.get("payload") or a).get("agents") or []))

    for ag in agentes:
        aid = ag.get("id")
        if aid not in PROPRIO:
            continue
        meus = set(COMUM) | set(PROPRIO[aid])
        faltando = meus - todas
        assert not faltando, f"{aid}: ferramenta que não existe no gateway: {faltando}"
        t = dict(ag.get("tools") or {})
        # Preserva o que não é MCP (sessions_send, sessions_spawn, …)
        nao_mcp = [x for x in (t.get("deny") or []) if x not in todas]
        t["alsoAllow"] = sorted(f"mcp__{x}" for x in meus)
        t["deny"] = sorted(todas - meus) + nao_mcp
        ag["tools"] = t
        print(f"  {aid:6} enxerga {len(meus):>2} | perde {len(todas - meus):>2}"
              f" | preservado: {nao_mcp or '—'}")
        print(f"         {', '.join(sorted(x.split('__')[0] for x in meus if x.startswith('banco-')))}")

    if not aplicar:
        print("\n  (ensaio — nada foi escrito; rode com --aplicar)")
        return 0
    def conferir(parsed: dict) -> bool:
        lista = (parsed.get("agents") or {}).get("list") or []
        alvo = {a.get("id"): a for a in lista}
        return all(
            "mcp__banco-datacorehs__query" not in ((alvo.get(x, {}).get("tools") or {}).get("alsoAllow") or [])
            for x in ("atlas", "flow", "bruce")
        ) and "banco-hsgrowth__query" in ((alvo.get("iris", {}).get("tools") or {}).get("deny") or [])

    await aplicar_patch({"agents": {"list": agentes}}, base_hash, conferir)
    print("\n  aplicado e conferido na config.")
    return 0

if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
