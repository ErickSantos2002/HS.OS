"""Troca as entradas `banco-*` do gateway de `npx` para o `banco-mcp` (PK-47).

    cd backend   # o .env do backend é lido daqui; de outra pasta dá "banco indisponível"
    .venv/bin/python ../scripts/trocar-banco-mcp.py             # ensaio: diz o que mudaria
    .venv/bin/python ../scripts/trocar-banco-mcp.py --aplicar   # backup na VPS + config.patch
    .venv/bin/python ../scripts/trocar-banco-mcp.py --voltar    # restaura as entradas do backup

Exige o túnel para o gateway aberto (lê a config real mesmo no ensaio) e o
`banco-mcp` de pé na VPS (`vps-gateway/banco-mcp/instalar.sh`), já conferido
com o `comparar.mjs` nos bancos reais.

⚠️ **O patch descarta os runtimes de MCP de TODAS as sessões** — a referência
do OpenClaw diz que mudança em `mcp.*` é aplicada a quente assim. Um turno no
meio de uma chamada de ferramenta pode perdê-la. Por isso o `--aplicar` recusa
se houver `npm exec` vivo na VPS (sinal de sessão com MCP aberto nos últimos 10
minutos), a menos que receba `--forcar`.

⚠️ O backup fica NA VPS (`/root/openclaw.json.antes-pk47`), não aqui: ele tem
as URLs com senha. O `--voltar` o lê por SSH, em memória.

A montagem e a conferência são puras (`montar_patch`, `trocado`, `montar_volta`)
para serem testadas sem gateway.
"""
import asyncio
import json
import os
import subprocess
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.gateway.patch import aplicar_patch, config_do_gateway  # noqa: E402
from app.routers.integracoes import BANCO_MCP_URL, entrada_mcp_banco  # noqa: E402

VPS = os.environ.get("VPS", "root@2.24.85.122")
BACKUP = "/root/openclaw.json.antes-pk47"


def _bancos(servidores: dict) -> dict:
    return {n: s for n, s in servidores.items() if n.startswith("banco-")}


def montar_patch(servidores: dict) -> dict:
    """As entradas `banco-*` ainda em `npx`, no formato novo. As já trocadas
    ficam de fora — rodar duas vezes não reescreve nada."""
    novos = {}
    for nome, s in _bancos(servidores).items():
        if s.get("command"):
            args = s.get("args") or []
            if len(args) < 3 or not str(args[2]).startswith(("postgres://", "postgresql://")):
                raise ValueError(f"{nome}: args fora do formato esperado do server-postgres")
            entrada = entrada_mcp_banco(args[2])
            entrada["toolFilter"] = s.get("toolFilter") or entrada["toolFilter"]
            novos[nome] = entrada
    return {"mcp": {"servers": novos}} if novos else {}


def trocado(parsed: dict) -> bool:
    """Todo `banco-*` aponta para o serviço e nenhum tem mais `command`."""
    bancos = _bancos(((parsed.get("mcp") or {}).get("servers")) or {})
    return bool(bancos) and all(
        s.get("url") == BANCO_MCP_URL and not s.get("command") for s in bancos.values()
    )


def montar_volta(servidores_backup: dict) -> dict:
    """O patch que devolve as entradas `banco-*` ao que estava no backup."""
    volta = {}
    for nome, s in _bancos(servidores_backup).items():
        volta[nome] = {
            "command": s.get("command"), "args": s.get("args"),
            "toolFilter": s.get("toolFilter"),
            "transport": None, "url": None, "headers": None,
        }
    return {"mcp": {"servers": volta}}


def _ssh(cmd: str) -> str:
    return subprocess.run(["ssh", "-o", "ConnectTimeout=10", VPS, cmd],
                          check=True, capture_output=True, text=True).stdout


async def principal(argv: list[str]) -> int:
    parsed, base_hash = await config_do_gateway()
    servidores = ((parsed.get("mcp") or {}).get("servers")) or {}

    if "--voltar" in argv:
        backup = json.loads(_ssh(f"cat {BACKUP}"))
        patch = montar_volta(backup["mcp"]["servers"])
        print("Voltando:", ", ".join(sorted(patch["mcp"]["servers"])))
        await aplicar_patch(patch, base_hash, conferir=lambda c: all(
            (((c.get("mcp") or {}).get("servers")) or {}).get(n, {}).get("command")
            for n in patch["mcp"]["servers"]))
        print("Entradas antigas restauradas.")
        return 0

    patch = montar_patch(servidores)
    if not patch:
        print("Nada a trocar: todos os banco-* já apontam para o banco-mcp." if trocado(parsed)
              else "Nenhuma entrada banco-* encontrada.")
        return 0

    nomes = sorted(patch["mcp"]["servers"])
    print(f"Trocaria {len(nomes)} entrada(s) para {BANCO_MCP_URL}:")
    for n in nomes:
        print(f"  - {n}")
    if "--aplicar" not in argv:
        print("\nEnsaio. Rode com --aplicar para gravar.")
        return 0

    saude = _ssh("curl -sf http://127.0.0.1:18790/saude || true")
    if '"ok":true' not in saude:
        print("O banco-mcp não respondeu na VPS — abortado.")
        return 1
    vivos = int(_ssh("ps -eo args | grep -c '[n]pm exec' || true").strip() or 0)
    if vivos and "--forcar" not in argv:
        print(f"Há {vivos} `npm exec` vivo(s) na VPS — sessão com MCP aberto. "
              "Espere um momento quieto ou use --forcar.")
        return 1

    _ssh(f"[ -e {BACKUP} ] || install -m 600 /root/.openclaw/openclaw.json {BACKUP}")
    print(f"Backup em {VPS}:{BACKUP}")

    await aplicar_patch(patch, base_hash, conferir=trocado)
    print("Trocado e conferido na config relida.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
