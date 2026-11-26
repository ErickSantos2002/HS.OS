"""Liga a sandbox Docker no `exec` da nina e do atlas (PK-06, 26/11/2026).

    cd backend
    .venv/bin/python ../scripts/sandbox-especialistas.py            # ensaio: mostra o payload
    .venv/bin/python ../scripts/sandbox-especialistas.py --aplicar  # grava, relê e confere
    .venv/bin/python ../scripts/sandbox-especialistas.py --voltar   # tira a sandbox dos dois

Só depois do `vps-gateway/sandbox/instalar.sh` (Docker + imagem + a parede
provada). Spec: docs/superpowers/specs/2026-11-26-pk06-sandbox-especialistas-design.md.

⚠️ **A sandbox tem uma SEGUNDA lista de permitidas** (`tools.sandbox.tools`).
O padrão do OpenClaw deixa só `exec`, arquivos e `sessions_*`: ligar a sandbox
sem `alsoAllow` tiraria da nina `create_goal`, `update_plan`, `subagents`… e
TODAS as MCP. O `alsoAllow` é o inventário de hoje (`tools.effective`) mais
`bundle-mcp` — e a conferência exige o mesmo inventário depois.

⚠️ `agents.list` é array e array SUBSTITUI no merge patch: vai a lista inteira.
"""
import asyncio
import copy
import importlib.util
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

ALVOS = ("nina", "atlas")

SANDBOX = {
    "mode": "all",
    "backend": "docker",
    "scope": "agent",
    "workspaceAccess": "rw",
    "docker": {
        "image": "openclaw-sandbox:bookworm-slim",
        "network": "none",
        "readOnlyRoot": True,
        "tmpfs": ["/tmp", "/var/tmp", "/run"],
        # root DENTRO do contêiner: o workspace é root:root com diretórios 700.
        # Sem capability, sem rede, raiz só-leitura, uma pasta montada (spec).
        "user": "0:0",
        "capDrop": ["ALL"],
        "memory": "512m",
        "pidsLimit": 128,
    },
}

# Rótulos de origem que o `tools.effective` devolve junto dos nomes; não são
# ferramentas e não vão para a lista.
_ROTULOS = {"core", "plugin"}


def lista_da_sandbox(inventario: set[str]) -> list[str]:
    nomes = {n for n in inventario if not n.startswith("mcp__")} - _ROTULOS
    if "exec" not in nomes:
        # Sem `exec` hoje, não há o que isolar — e um inventário vazio (sessão
        # errada, gateway de mau humor) viraria uma lista que corta tudo.
        raise ValueError("inventário sem exec — não monto a lista da sandbox a partir disto")
    return sorted(nomes | {"bundle-mcp"})


def montar_patch(conf: dict, inventarios: dict[str, set[str]]) -> dict:
    agentes = copy.deepcopy((conf.get("agents") or {}).get("list") or [])
    ids = {a.get("id") for a in agentes}
    if not set(ALVOS) <= ids:
        raise ValueError(f"faltam agentes na config: {set(ALVOS) - ids}")
    for a in agentes:
        if a.get("id") in ALVOS:
            a["sandbox"] = copy.deepcopy(SANDBOX)
            tools = a.setdefault("tools", {})
            tools["sandbox"] = {"tools": {"alsoAllow": lista_da_sandbox(inventarios[a["id"]])}}
    return {"agents": {"list": agentes}}


def montar_volta(conf: dict) -> dict:
    agentes = copy.deepcopy((conf.get("agents") or {}).get("list") or [])
    for a in agentes:
        if a.get("id") in ALVOS:
            a.pop("sandbox", None)
            (a.get("tools") or {}).pop("sandbox", None)
    return {"agents": {"list": agentes}}


def _elevated_ligado(conf: dict, agente: dict) -> bool:
    glob = ((conf.get("tools") or {}).get("elevated") or {}).get("enabled") is True
    proprio = ((agente.get("tools") or {}).get("elevated") or {}).get("enabled")
    return glob and proprio is not False


def conferir(parsed: dict, antes: dict) -> bool:
    """Na config relida: os dois com a sandbox certa, sem `elevated`, e os
    OUTROS agentes exatamente como estavam."""
    depois = {a.get("id"): a for a in (parsed.get("agents") or {}).get("list") or []}
    velhos = {a.get("id"): a for a in (antes.get("agents") or {}).get("list") or []}
    for ag in ALVOS:
        a = depois.get(ag) or {}
        if a.get("sandbox") != SANDBOX or _elevated_ligado(parsed, a):
            return False
        if "bundle-mcp" not in (((a.get("tools") or {}).get("sandbox") or {}).get("tools") or {}).get("alsoAllow", []):
            return False
    return all(depois.get(i) == v for i, v in velhos.items() if i not in ALVOS)


def sem_sandbox(parsed: dict) -> bool:
    return all("sandbox" not in a and "sandbox" not in (a.get("tools") or {})
               for a in (parsed.get("agents") or {}).get("list") or [] if a.get("id") in ALVOS)


def _efetivas():
    spec = importlib.util.spec_from_file_location(
        "cortar_ferramentas", os.path.join(os.path.dirname(os.path.abspath(__file__)), "cortar-ferramentas.py"))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.efetivas


async def principal(argv: list[str]) -> int:
    import json
    from app.gateway import config as cfg
    from app.gateway.client import obter_cliente
    from app.gateway.patch import aplicar_patch, config_do_gateway

    efetivas = _efetivas()
    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    parsed, base_hash = await config_do_gateway()

    if "--voltar" in argv:
        await aplicar_patch(montar_volta(parsed), base_hash, conferir=sem_sandbox)
        print("Sandbox tirada da nina e do atlas, conferido na config relida.")
        return 0

    inventarios = {ag: await efetivas(cli, ag) for ag in ALVOS}
    patch = montar_patch(parsed, inventarios)
    for a in patch["agents"]["list"]:
        if a.get("id") in ALVOS:
            print(f"── {a['id']}")
            print(json.dumps({"sandbox": a["sandbox"], "tools.sandbox": a["tools"]["sandbox"]},
                             indent=2, ensure_ascii=False))
    if "--aplicar" not in argv:
        print("\nEnsaio. Rode com --aplicar para gravar.")
        return 0

    await aplicar_patch(patch, base_hash, conferir=lambda p: conferir(p, parsed))
    print("Gravado e conferido na config relida.")
    ok = True
    for ag in ALVOS:
        depois = await efetivas(cli, ag)
        diferenca = inventarios[ag] ^ depois
        print(f"  {ag}: inventário {'igual' if not diferenca else 'MUDOU: ' + ', '.join(sorted(diferenca))}")
        ok &= not diferenca
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
