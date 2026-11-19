"""Põe a Iris para dormir: o Midas assumiu (plano 2026-11-18-cfo-midas, Tarefa 8).

    PYTHONPATH=. .venv/bin/python scripts/dormir-iris.py            # ensaio
    PYTHONPATH=. .venv/bin/python scripts/dormir-iris.py --aplicar

Dormir é reversível, de propósito:
- a entrada dela no `agents.list` é guardada FORA do repositório (público), em `~/projetos/backups-hs/gateway/`
  (só config de ferramentas/modelo/workspace — nenhum segredo) e sai da config;
- sai do `tools.agentToAgent.allow`;
- as sessões `agent:iris:*` são arquivadas (`sessions.delete` arquiva, não destrói);
- `agent_profiles.status = 'inactive'` (some das telas e do roster da Nina).
O workspace `/root/.openclaw/workspace-iris` e a linha no banco ficam.

⚠️ Deixá-la no `agents.list` não serviria: o `publicar-anexos-mcp.py` cobre todo
agente da config e devolveria a ela a entrada de anexos a cada execução.

Religar: devolver o JSON ao `agents.list` (lista inteira), pôr `iris` de volta no
`agentToAgent.allow` e `status = 'active'`.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.database import close_db, init_db, sessao  # noqa: E402
from app.gateway import config as cfg  # noqa: E402
from app.gateway import patch as patch_gw  # noqa: E402
from app.gateway.client import obter_cliente  # noqa: E402
from app.routers.agents import _atualizar_roster_do_lider  # noqa: E402

AGENTE = "iris"
BACKUP = Path.home() / "projetos" / "backups-hs" / "gateway" / "iris-agents-list.json"


def _lista(conf: dict) -> list[dict]:
    return [dict(a) for a in (conf.get("agents") or {}).get("list") or []]


async def main(aplicar: bool) -> int:
    conf, base_hash = await patch_gw.config_do_gateway()
    lista = _lista(conf)
    entrada = next((a for a in lista if a.get("id") == AGENTE), None)
    allow = list((((conf.get("tools") or {}).get("agentToAgent")) or {}).get("allow") or [])
    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    s = await cli.chamar("sessions.list", {})
    s = s.get("payload") or s
    chaves = [x.get("key") for x in (s.get("sessions") or [])
              if str(x.get("key") or "").startswith(f"agent:{AGENTE}:")]

    print(f"no agents.list: {'sim' if entrada else 'não'} · no agentToAgent.allow: {AGENTE in allow}")
    print(f"sessões a arquivar: {len(chaves)}")
    if not aplicar:
        print("\n(ensaio — nada foi escrito; rode com --aplicar)")
        return 0

    if entrada:
        BACKUP.parent.mkdir(parents=True, exist_ok=True)
        BACKUP.write_text(json.dumps(entrada, ensure_ascii=False, indent=2) + "\n")
        print(f"backup: {BACKUP}")
        outros = {a.get("id"): a.get("tools") for a in lista if a.get("id") != AGENTE}
        nova = [a for a in lista if a.get("id") != AGENTE]
        novo_allow = [x for x in allow if x != AGENTE]

        def conferir(cf: dict) -> bool:
            ids = [a.get("id") for a in _lista(cf)]
            a2a = (((cf.get("tools") or {}).get("agentToAgent")) or {}).get("allow") or []
            # os outros agentes não podem perder o escopo no patch da lista inteira
            intactos = all(a.get("tools") == outros.get(a.get("id")) for a in _lista(cf))
            return AGENTE not in ids and AGENTE not in a2a and intactos

        # ⚠️ `replacePaths` explícito: o gateway mescla o `agents.list` POR ID, então
        # mandar a lista sem a Iris não a remove e nem dispara a recusa que faria o
        # `aplicar_patch` repetir com `replacePaths`. Foi o que aconteceu em 19/11/2026:
        # o `allow` mudou, a Iris ficou. (Esta versão do script é a corrigida.)
        corpo = {"raw": json.dumps({"agents": {"list": nova},
                                    "tools": {"agentToAgent": {"enabled": True, "allow": novo_allow}}}),
                 "baseHash": base_hash,
                 "replacePaths": ["agents.list", "tools.agentToAgent.allow"]}
        try:
            await cli.chamar("config.patch", corpo)
        except Exception as e:  # noqa: BLE001 — o reload derruba o WS depois de gravar
            print(f"exceção no patch (pode ter gravado): {e}")
        for _ in range(10):
            await asyncio.sleep(3)
            cf, _ = await patch_gw.config_do_gateway()
            if conferir(cf):
                print("saiu do agents.list e do agentToAgent.allow (conferido)")
                break
        else:
            print("❌ não confirmei a saída — confira à mão antes de seguir")
            return 1

    for k in chaves:
        try:
            await cli.chamar("sessions.delete", {"key": k})
            print(f"arquivada: {k}")
        except Exception as e:  # noqa: BLE001 — uma sessão não derruba o resto
            print(f"⚠️ não arquivei {k}: {e}")

    await init_db()  # script solto: o pool só existe no app
    try:
        async with sessao(role="service_role") as conn:
            n = await conn.execute(
                "UPDATE public.agent_profiles SET status = 'inactive' WHERE agent_id = $1", AGENTE)
        print(f"agent_profiles: {n}")
        await _atualizar_roster_do_lider("nina")
    finally:
        await close_db()
    print("roster da nina: pedido (confira relendo o AGENTS.md dela)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main("--aplicar" in sys.argv)))
