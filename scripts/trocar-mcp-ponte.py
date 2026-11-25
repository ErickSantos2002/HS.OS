"""Aponta as entradas `hsos-*` do gateway para a `mcp-ponte` no loopback (25/11/2026).

    cd backend   # o .env do backend é lido daqui
    .venv/bin/python ../scripts/trocar-mcp-ponte.py             # ensaio: diz o que mudaria
    .venv/bin/python ../scripts/trocar-mcp-ponte.py --aplicar   # backup na VPS + config.patch
    .venv/bin/python ../scripts/trocar-mcp-ponte.py --voltar    # devolve à API pública

Ver docs/superpowers/specs/2026-11-25-mcp-ponte-design.md. Exige o túnel para o
gateway e a ponte de pé (`vps-gateway/mcp-ponte/instalar.sh`), já conferida com
o `comparar.mjs`.

Só troca a ORIGEM: `https://hsosapi.healthsafetytech.com/mcp/...` vira
`http://127.0.0.1:18791/mcp/...`, mesmo caminho, mesmos cabeçalhos. Como os
scripts de publicação copiam a base do `hsos-relatorios`, publicações futuras
herdam a ponte sozinhas.

⚠️ **O patch descarta os runtimes de MCP de todas as sessões** (mudança em
`mcp.*` é a quente). Como o runtime já é refeito a cada execução, o efeito é o
de sempre: a próxima execução reconecta — agora pela ponte.

⚠️ O backup fica NA VPS (`/root/openclaw.json.antes-mcp-ponte`): ele tem as
assinaturas por bot. A montagem e a conferência são puras, com teste.
"""
import asyncio
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.gateway.patch import aplicar_patch, config_do_gateway  # noqa: E402

VPS = os.environ.get("VPS", "root@2.24.85.122")
BACKUP = "/root/openclaw.json.antes-mcp-ponte"
API = "https://hsosapi.healthsafetytech.com"
PONTE = "http://127.0.0.1:18791"


def _trocar_origem(servidores: dict, de: str, para: str) -> dict:
    novos = {}
    for nome, s in servidores.items():
        url = s.get("url") or ""
        if nome.startswith("hsos") and url.startswith(de + "/mcp/"):
            novos[nome] = {"url": para + url[len(de):]}
    return novos


def montar_patch(servidores: dict) -> dict:
    """Só a `url` das `hsos-*` que ainda vão à API. Rodar duas vezes não reescreve."""
    novos = _trocar_origem(servidores, API, PONTE)
    return {"mcp": {"servers": novos}} if novos else {}


def montar_volta(servidores: dict) -> dict:
    novos = _trocar_origem(servidores, PONTE, API)
    return {"mcp": {"servers": novos}} if novos else {}


def apontam_para(parsed: dict, origem: str) -> bool:
    hsos = {n: s for n, s in (((parsed.get("mcp") or {}).get("servers")) or {}).items()
            if n.startswith("hsos") and "/mcp/" in (s.get("url") or "")}
    return bool(hsos) and all(s["url"].startswith(origem + "/mcp/") for s in hsos.values())


def _ssh(cmd: str) -> str:
    return subprocess.run(["ssh", "-o", "ConnectTimeout=10", VPS, cmd],
                          check=True, capture_output=True, text=True).stdout


async def principal(argv: list[str]) -> int:
    parsed, base_hash = await config_do_gateway()
    servidores = ((parsed.get("mcp") or {}).get("servers")) or {}

    if "--voltar" in argv:
        patch = montar_volta(servidores)
        if not patch:
            print("Nada a voltar: nenhuma hsos-* aponta para a ponte.")
            return 0
        await aplicar_patch(patch, base_hash, conferir=lambda c: apontam_para(c, API))
        print(f"{len(patch['mcp']['servers'])} entradas de volta à API pública.")
        return 0

    patch = montar_patch(servidores)
    if not patch:
        print("Nada a trocar: todas as hsos-* já apontam para a ponte." if apontam_para(parsed, PONTE)
              else "Nenhuma entrada hsos-* encontrada.")
        return 0

    nomes = sorted(patch["mcp"]["servers"])
    print(f"Trocaria a origem de {len(nomes)} entrada(s): {API} → {PONTE} (caminho e cabeçalhos iguais).")
    print("Exemplos:", ", ".join(nomes[:3]), "…", ", ".join(nomes[-2:]))
    if "--aplicar" not in argv:
        print("\nEnsaio. Rode com --aplicar para gravar.")
        return 0

    saude = _ssh("curl -sf http://127.0.0.1:18791/saude || true")
    if '"ok":true' not in saude:
        print("A mcp-ponte não respondeu na VPS — abortado.")
        return 1
    _ssh(f"[ -e {BACKUP} ] || install -m 600 /root/.openclaw/openclaw.json {BACKUP}")
    print(f"Backup em {VPS}:{BACKUP}")
    await aplicar_patch(patch, base_hash, conferir=lambda c: apontam_para(c, PONTE))
    print("Trocado e conferido na config relida.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
