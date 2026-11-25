"""Grava as regras-base (PK-07) no `SOUL.md` dos cinco especialistas.

    cd backend
    .venv/bin/python ../scripts/regras-base-especialistas.py            # ensaio
    .venv/bin/python ../scripts/regras-base-especialistas.py --aplicar  # grava e relê

⚠️ **Só depois do deploy do backend com o carimbo** (`_carimbo_de_quem_fala`):
a regra diz que só a linha "quem fala neste turno" identifica a pessoa. Gravada
antes, a `nina` passaria a ler o Nicholson sem a linha — e mensagem sem ela,
pela regra, não ganha a autoridade de ninguém.

Mede antes de gravar: o teto do arquivo (do próprio agente, lido da config) e o
total dos sete (`bootstrapTotalMaxChars`, padrão 60.000). Passar de qualquer um
não dá erro — o gateway corta em silêncio. Idempotente: o bloco fica entre
marcadores e é substituído inteiro.

A conferência de verdade é perguntar ao agente (regra dos sete), não reler.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.agentes.regras_base import com_regras_base  # noqa: E402
from app.gateway import config as cfg  # noqa: E402
from app.gateway.client import obter_cliente, teto_do_agente  # noqa: E402
from app.gateway.patch import config_do_gateway  # noqa: E402

ESPECIALISTAS = ("nina", "atlas", "flow", "bruce", "midas")
TOTAL_PADRAO = 60_000


def teto_total(parsed: dict, agent_id: str) -> int:
    ag = parsed.get("agents") or {}
    proprio = next((a for a in ag.get("list") or [] if a.get("id") == agent_id), {})
    for v in (proprio.get("bootstrapTotalMaxChars"), (ag.get("defaults") or {}).get("bootstrapTotalMaxChars")):
        if isinstance(v, int) and v > 0:
            return v
    return TOTAL_PADRAO


async def _conteudo(cli, aid: str, nome: str) -> str:
    r = await cli.chamar("agents.files.get", {"agentId": aid, "name": nome})
    return ((r.get("file") or {}).get("content")) or ""


async def principal(argv: list[str]) -> int:
    aplicar = "--aplicar" in argv
    c = await cfg.carregar()
    cli = obter_cliente(c.url, c.token)
    parsed, _ = await config_do_gateway()
    falhou = False
    for aid in ESPECIALISTAS:
        lista = await cli.chamar("agents.files.list", {"agentId": aid})
        nomes = [f["name"] for f in lista.get("files", []) if not f.get("missing")]
        tamanhos = {n: len(await _conteudo(cli, aid, n)) for n in nomes}
        atual = await _conteudo(cli, aid, "SOUL.md")
        novo = com_regras_base(atual)
        teto, total = await teto_do_agente(cli, aid), teto_total(parsed, aid)
        soma = sum(tamanhos.values()) - tamanhos.get("SOUL.md", 0) + len(novo)
        linha = f"{aid:6s} SOUL {len(atual):5d} → {len(novo):5d} (teto {teto}); sete {soma:6d} (teto {total})"
        if len(novo) > teto or soma > total:
            print(f"❌ {linha} — passaria do teto, NÃO gravo")
            falhou = True
            continue
        if novo == atual:
            print(f"=  {linha} — já igual")
            continue
        if not aplicar:
            print(f"~  {linha} — mudaria")
            continue
        await cli.chamar("agents.files.set", {"agentId": aid, "name": "SOUL.md", "content": novo})
        ok = await _conteudo(cli, aid, "SOUL.md") == novo
        print(f"{'✅' if ok else '❌'} {linha} — {'gravado e relido' if ok else 'FALHOU na releitura'}")
        falhou |= not ok
    if not aplicar:
        print("\nEnsaio. Rode com --aplicar para gravar.")
    return 1 if falhou else 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
