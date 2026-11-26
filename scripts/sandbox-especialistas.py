"""Liga a sandbox Docker no `exec` da nina e do atlas (PK-06, 26/11/2026).

    cd backend
    .venv/bin/python ../scripts/sandbox-especialistas.py            # ensaio: mostra o payload
    .venv/bin/python ../scripts/sandbox-especialistas.py --aplicar  # grava, relê e confere
    .venv/bin/python ../scripts/sandbox-especialistas.py --voltar   # tira a sandbox dos dois
    .venv/bin/python ../scripts/sandbox-especialistas.py --visibilidade [--aplicar]
                                                    # só a trava de sessão, no padrão (26/11, 13:49)

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

# Bruce entrou em 26/11 com o `bruce-calculo-em-arquivo.py`: o único `exec` real dele
# (espelhos do Flash, 24/11) lia a própria sessão, que na sandbox não existe.
ALVOS = ("nina", "atlas", "bruce")

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

# ⚠️ 26/11/2026, 13:49: a nina parou de acionar atlas e midas ("Session not
# visible from this sandboxed agent session"). Sessão em sandbox tem trava
# própria — `sandbox.sessionToolsVisibility`, padrão "spawned": só as sessões
# que ela criou, MESMO com `tools.sessions.visibility="all"` (docs.openclaw.ai,
# gateway/config-tools/sessions-and-subagents).
# ⚠️ E ela só vale em `agents.defaults.sandbox`: gravada em
# `agents.list[nina].sandbox` o schema ACEITA e o gateway IGNORA — às 13:55,
# depois da gravação, o `sessions_send` seguia "forbidden". Vale para todo
# agente em sandbox (nina, atlas, bruce): o estado de antes das 09:43.
SANDBOX_PADRAO = {"sessionToolsVisibility": "all"}


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
            # ⚠️ O `elevated` (rodar `exec` FORA da sandbox) vem LIGADO por
            # padrão — `openclaw sandbox explain` mostrou `enabled: true` com a
            # lista de remetentes vazia. Vazia hoje é sorte, não parede: o
            # portão por agente só restringe, e fica fechado aqui.
            tools["elevated"] = {"enabled": False}
    return {"agents": {"list": agentes}}


def montar_volta(conf: dict) -> dict:
    agentes = copy.deepcopy((conf.get("agents") or {}).get("list") or [])
    for a in agentes:
        if a.get("id") in ALVOS:
            a.pop("sandbox", None)
            (a.get("tools") or {}).pop("sandbox", None)
    return {"agents": {"list": agentes}}


def _elevated_ligado(conf: dict, agente: dict) -> bool:
    """Só o portão do próprio agente em `False` conta como fechado: o global
    vem ligado por padrão mesmo ausente da config (26/11/2026)."""
    return ((agente.get("tools") or {}).get("elevated") or {}).get("enabled") is not False


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


def montar_visibilidade(conf: dict) -> dict:
    """Só a trava de sessão no PADRÃO da sandbox — objeto, sem `agents.list`.

    ⚠️ Tentar tirar no mesmo patch a chave por agente (ignorada) da nina NÃO
    funcionou (26/11/2026, 13:57): o padrão gravou e a chave do item ficou.
    Ela é inofensiva justamente por ser a que o gateway ignora."""
    return {"agents": {"defaults": {"sandbox": dict(SANDBOX_PADRAO)}}}


def conferir_visibilidade(parsed: dict, antes: dict) -> bool:
    """Na config relida: o padrão com a trava solta e os agentes intocados."""
    padrao = (((parsed.get("agents") or {}).get("defaults") or {}).get("sandbox") or {})
    if any(padrao.get(k) != v for k, v in SANDBOX_PADRAO.items()):
        return False
    return ((parsed.get("agents") or {}).get("list") or []) == ((antes.get("agents") or {}).get("list") or [])


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

    if "--visibilidade" in argv:
        patch = montar_visibilidade(parsed)
        print(f"── agents.defaults.sandbox = {patch['agents']['defaults']['sandbox']}")
        if "--aplicar" not in argv:
            print("\nEnsaio. Rode com --visibilidade --aplicar para gravar.")
            return 0
        await aplicar_patch(patch, base_hash, conferir=lambda p: conferir_visibilidade(p, parsed))
        print("Gravado e conferido na config relida: padrão com a trava solta, agentes intactos.")
        return 0

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
