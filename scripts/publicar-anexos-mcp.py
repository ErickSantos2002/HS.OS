"""Declara no gateway uma entrada `hsos-anexos-<agente>` por agente.

    ANEXOS_MCP_SEGREDO=… OPENCLAW_ADMIN_TOKEN=… python scripts/publicar-anexos-mcp.py           # ensaio
    ANEXOS_MCP_SEGREDO=… OPENCLAW_ADMIN_TOKEN=… python scripts/publicar-anexos-mcp.py --aplicar

URL base e cabeçalhos são copiados da entrada `hsos-relatorios`, que já
funciona — o mesmo backend, o mesmo `GUARDRAILS_API_TOKEN`. O que muda é o
caminho, que leva o HMAC do agente.

⚠️ É ESCRITA NO GATEWAY: o ensaio imprime o payload com a assinatura mascarada
e tem que ser mostrado ao Erick antes do `--aplicar`. Mesmo o ensaio LÊ a config
do gateway real (`config.get`), então também exige o túnel aberto.

A montagem das entradas e o mascaramento são funções puras (`montar_entradas`,
`mascarar_url`) justamente para serem testadas sem gateway.
"""
import asyncio
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.gateway.patch import aplicar_patch, config_do_gateway  # noqa: E402
from app.routers.mcp_anexos import assinatura_do_agente  # noqa: E402

AGENTES = ("nina", "iris", "atlas", "flow", "bruce")
FERRAMENTAS = ["ler_anexo", "enviar_arquivo"]


def montar_entradas(modelo: dict, segredo: str, agentes=AGENTES) -> dict:
    """Uma entrada `hsos-anexos-<id>` por agente, copiada do `modelo`.

    Tudo que não é `url`/`toolFilter` (cabeçalhos, transporte) vem do modelo; a
    URL leva o HMAC do agente — é ele que o servidor confere para saber QUEM
    chama, já que o gateway não repassa a identidade.
    """
    base = modelo["url"].rsplit("/mcp/", 1)[0]
    novos = {}
    for aid in agentes:
        entrada = {k: v for k, v in modelo.items() if k not in ("url", "toolFilter")}
        entrada["url"] = f"{base}/mcp/anexos/{aid}/{assinatura_do_agente(segredo, aid)}"
        entrada["toolFilter"] = {"include": list(FERRAMENTAS)}
        novos[f"hsos-anexos-{aid}"] = entrada
    return novos


def mascarar_url(url: str) -> str:
    """Esconde a assinatura (último segmento do caminho), deixando 6 caracteres
    para o Erick distinguir uma entrada da outra. A assinatura inteira é a
    credencial do agente: não pode ir para terminal nem para transcript."""
    cabeca, _, assinatura = url.rpartition("/")
    return f"{cabeca}/{assinatura[:6]}…"


def mascarar_entradas(novos: dict) -> dict:
    return {n: {**e, "url": mascarar_url(e["url"]), "headers": "<copiados de hsos-relatorios>"}
            for n, e in novos.items()}


async def main() -> int:
    segredo = os.environ.get("ANEXOS_MCP_SEGREDO", "")
    if not segredo:
        print("❌ falta ANEXOS_MCP_SEGREDO no ambiente")
        return 1
    conf, base_hash = await config_do_gateway()
    servidores = (conf.get("mcp") or {}).get("servers") or {}
    modelo = servidores.get("hsos-relatorios")
    if not modelo:
        print("❌ não achei hsos-relatorios em mcp.servers para copiar URL e cabeçalhos")
        return 1

    novos = montar_entradas(modelo, segredo)
    print(json.dumps({"mcp": {"servers": mascarar_entradas(novos)}}, indent=2, ensure_ascii=False))
    if "--aplicar" not in sys.argv:
        print("\n  (ensaio — nada foi escrito; mostre ao Erick e rode com --aplicar)")
        return 0

    def conferir(parsed: dict) -> bool:
        s = (parsed.get("mcp") or {}).get("servers") or {}
        return all(n in s and s[n]["url"] == e["url"] for n, e in novos.items())

    await aplicar_patch({"mcp": {"servers": novos}}, base_hash, conferir)
    print("\n  aplicado e conferido na config. Agora rode scripts/escopo-mcp.py.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
