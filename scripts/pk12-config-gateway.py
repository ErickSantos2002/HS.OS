"""PK-12 — fila de 6 turnos e teto próprio da `nina` no gateway (25/11/2026).

    cd backend
    .venv/bin/python ../scripts/pk12-config-gateway.py            # ensaio
    .venv/bin/python ../scripts/pk12-config-gateway.py --aplicar  # config.patch + conferência
    .venv/bin/python ../scripts/pk12-config-gateway.py --voltar   # padrão do gateway de novo

- `agents.defaults.maxConcurrent: 6` — a fila `main` é UMA para a empresa
  inteira e o padrão é 4: em 25/11 foram 8 turnos esperando ~41 s (máx. 51 s)
  só para começar. 6 é a decisão do Erick de 23/11, condicionada ao swap
  (PK-47) e ao timeout dos MCP (mcp-ponte) — os dois no ar. Medir de novo
  antes de subir mais.
- `nina`: `bootstrapMaxChars 30000` e `bootstrapTotalMaxChars 80000`. O
  `AGENTS.md` dela tem 19.913 caracteres (87 do teto de 20 mil) e os sete
  somam 51.396 dos 60 mil do total — subir só o por-arquivo não bastava. O
  backend lê o teto vivo por agente (`teto_do_agente`), então as três portas
  que escrevem nos sete passam a aceitar o que o gateway aceita.

⚠️ O gateway mescla `agents.list` POR ID. A conferência relida exige que a
lista tenha o mesmo número de agentes e que a entrada da `nina` só tenha
ganhado as duas chaves — nada mais mudado.
"""
import asyncio
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.gateway.patch import aplicar_patch, config_do_gateway  # noqa: E402

FILA = 6
NINA = {"bootstrapMaxChars": 30000, "bootstrapTotalMaxChars": 80000}


def montar_patch(atual: dict, voltar: bool = False) -> dict:
    """A lista INTEIRA, igual à atual, só com a `nina` mudada.

    ⚠️ Não a lista parcial: o `aplicar_patch` repete com `replacePaths` quando o
    gateway acusa remoção em array, e com uma lista de um item só isso tiraria
    os outros 27 agentes. Com a lista inteira, não há o que remover.
    """
    lista = copy.deepcopy((atual.get("agents") or {}).get("list") or [])
    nina = next(x for x in lista if x.get("id") == "nina")
    for k, v in NINA.items():
        # `None` apaga no merge do config.patch; chave ausente deixaria como está.
        nina[k] = None if voltar else v
    return {"agents": {"defaults": {"maxConcurrent": None if voltar else FILA}, "list": lista}}


def conferir(antes: dict, depois: dict, voltar: bool = False) -> bool:
    a, d = antes.get("agents") or {}, depois.get("agents") or {}
    if len(a.get("list") or []) != len(d.get("list") or []):
        return False
    esperado_fila = None if voltar else FILA
    if (d.get("defaults") or {}).get("maxConcurrent") != esperado_fila:
        return False
    nina_a = copy.deepcopy(next(x for x in a["list"] if x.get("id") == "nina"))
    nina_d = next((x for x in d["list"] if x.get("id") == "nina"), None)
    if nina_d is None:
        return False
    for k, v in NINA.items():
        if voltar:
            nina_a.pop(k, None)
        else:
            nina_a[k] = v
    return nina_a == nina_d


async def principal(argv: list[str]) -> int:
    voltar = "--voltar" in argv
    antes, base_hash = await config_do_gateway()
    ag = antes.get("agents") or {}
    nina = next((x for x in ag.get("list") or [] if x.get("id") == "nina"), {})
    print(f"Hoje: maxConcurrent={(ag.get('defaults') or {}).get('maxConcurrent')} (padrão 4); "
          f"nina bootstrapMaxChars={nina.get('bootstrapMaxChars')} "
          f"bootstrapTotalMaxChars={nina.get('bootstrapTotalMaxChars')} (padrões 20000/60000); "
          f"{len(ag.get('list') or [])} agentes na lista.")
    patch = montar_patch(antes, voltar)
    mudados = [x["id"] for x, y in zip(patch["agents"]["list"], ag.get("list") or []) if x != y]
    print(f"Patch: agents.defaults.maxConcurrent={patch['agents']['defaults']['maxConcurrent']}; "
          f"agents.list com {len(patch['agents']['list'])} agentes, mudados: {mudados} → "
          f"{ {k: (None if voltar else v) for k, v in NINA.items()} }")
    if "--aplicar" not in argv and not voltar:
        print("\nEnsaio. Rode com --aplicar para gravar.")
        return 0
    await aplicar_patch(patch, base_hash, conferir=lambda c: conferir(antes, c, voltar))
    print("Gravado e conferido na config relida (lista com o mesmo tamanho; nina só com as chaves novas).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
