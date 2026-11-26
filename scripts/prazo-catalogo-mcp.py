"""Dá prazo explícito à listagem de ferramentas dos MCP do gateway (26/11/2026).

    cd backend   # o .env do backend é lido daqui
    .venv/bin/python ../scripts/prazo-catalogo-mcp.py             # ensaio: diz o que mudaria
    .venv/bin/python ../scripts/prazo-catalogo-mcp.py --aplicar   # backup na VPS + config.patch

⚠️ **O OpenClaw dá 1,5 s ao `tools/list` de cada servidor que não declara
`requestTimeoutMs`** (`BUNDLE_MCP_CATALOG_LIST_TIMEOUT_MS = 1500` em
`agent-bundle-mcp-runtime-*.js`; com o campo, vale o valor dele). Nenhuma das
87 entradas declarava. Na rajada de 26/11 07:30 — seis execuções ao mesmo tempo,
87 clientes cada — o laço do gateway atrasou a leitura das respostas e houve 23
`Request timed out`, com a ponte respondendo do cache (o log dela não registrou
falha nenhuma) e o `banco-mcp`, outro serviço, caindo igual. Três falhas tiram o
servidor por 60 s (`BUNDLE_MCP_FAILURE_COOLDOWN_MS`): foi assim que bots
perderam o PRÓPRIO servidor de anexos e de e-mail.

O valor é 60.000 porque é o `DEFAULT_REQUEST_TIMEOUT_MS` — o mesmo campo
governa o `tools/call`, e qualquer número menor passaria a cortar relatório e
anexo que hoje terminam. Só a listagem muda: de 1,5 s para 60 s.

Não mexe em mais nada da entrada (url, cabeçalhos com a assinatura, toolFilter).
Entrada que já declara prazo fica como está. O `publicar-anexos-mcp.py` copia a
entrada modelo inteira, então publicações futuras herdam o campo.
"""
import asyncio
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

VPS = os.environ.get("VPS", "root@2.24.85.122")
BACKUP = "/root/openclaw.json.antes-prazo-catalogo"
PRAZO_MS = 60_000


def _tem_prazo(s: dict) -> bool:
    # Mesma regra do `hasConfiguredMcpRequestTimeout` do OpenClaw.
    for k in ("requestTimeoutMs", "timeout"):
        v = s.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool) and v > 0:
            return True
    return False


def _servidores(parsed: dict) -> dict:
    return ((parsed.get("mcp") or {}).get("servers")) or {}


def montar_patch(servidores: dict) -> dict:
    """Só `requestTimeoutMs` nas entradas sem prazo. Rodar duas vezes não reescreve."""
    novos = {n: {"requestTimeoutMs": PRAZO_MS} for n, s in servidores.items()
             if isinstance(s, dict) and not _tem_prazo(s)}
    return {"mcp": {"servers": novos}} if novos else {}


def todos_com_prazo(parsed: dict) -> bool:
    s = _servidores(parsed)
    return bool(s) and all(_tem_prazo(v) for v in s.values() if isinstance(v, dict))


def _ssh(cmd: str) -> str:
    return subprocess.run(["ssh", "-o", "ConnectTimeout=10", VPS, cmd],
                          check=True, capture_output=True, text=True).stdout


async def principal(argv: list[str]) -> int:
    from app.gateway.patch import aplicar_patch, config_do_gateway

    parsed, base_hash = await config_do_gateway()
    patch = montar_patch(_servidores(parsed))
    if not patch:
        print("Nada a fazer: todas as entradas já declaram prazo.")
        return 0

    nomes = sorted(patch["mcp"]["servers"])
    print(f"Poria requestTimeoutMs={PRAZO_MS} em {len(nomes)} de {len(_servidores(parsed))} entrada(s).")
    print("Exemplos:", ", ".join(nomes[:3]), "…", ", ".join(nomes[-2:]))
    if "--aplicar" not in argv:
        print("\nEnsaio. Rode com --aplicar para gravar.")
        return 0

    _ssh(f"[ -e {BACKUP} ] || install -m 600 /root/.openclaw/openclaw.json {BACKUP}")
    print(f"Backup em {VPS}:{BACKUP}")
    await aplicar_patch(patch, base_hash, conferir=todos_com_prazo)
    print("Gravado e conferido na config relida.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
