"""Corta dos especialistas as ferramentas que eles não usam (PK-05, 24/11/2026).

    cd backend
    PYTHONPATH=. .venv/bin/python ../scripts/cortar-ferramentas.py              # ensaio
    PYTHONPATH=. .venv/bin/python ../scripts/cortar-ferramentas.py --aplicar    # grava
    PYTHONPATH=. .venv/bin/python ../scripts/cortar-ferramentas.py --conferir   # efeito real

Exige o túnel do gateway. Evidência de uso (30 dias de histórico) e o porquê
de cada corte: `backend/tests/test_pk05_ferramentas_cortadas.py`.

⚠️ **A conferência é o `tools.effective`, não a config relida.** Reler o
`config.get` não distingue um deny que funcionou de um que não casou com nada
(foi assim que a `iris` seguiu vendo dez bancos com o deny "aplicado", em
14/08). O `tools.effective` devolve o inventário que a sessão de fato recebe,
já com a política aplicada — e é só leitura.

O patch manda o `agents.list` INTEIRO (array substitui no merge patch), com os
agentes que não mudam preservados como estão.
"""
import asyncio
import sys

from app.gateway import config as cfg
from app.gateway.client import obter_cliente
from app.gateway.patch import aplicar_patch, config_do_gateway
from app.routers.integracoes import EXECUCAO_E_ESCRITA

LEITURA_ALHEIA = ("sessions_list", "sessions_history")
QUEBRADA = ("memory_search",)

CORTES = {
    "midas": LEITURA_ALHEIA + QUEBRADA + EXECUCAO_E_ESCRITA,
    "flow": LEITURA_ALHEIA + QUEBRADA + EXECUCAO_E_ESCRITA,
    "atlas": LEITURA_ALHEIA + QUEBRADA,   # roda script: exec fica (PK-06)
    "bruce": LEITURA_ALHEIA + QUEBRADA,   # ponto do Flash por exec: fica (PK-06)
    "nina": QUEBRADA,                     # orquestra: sessions_* ficam
}


def montar_lista(lista: list[dict]) -> tuple[list[dict], dict[str, list[str]]]:
    """A lista de agentes com os cortes e, por agente, o que entrou de novo."""
    nova, novos = [], {}
    for a in lista:
        cortes = CORTES.get(str(a.get("id")))
        if not cortes:
            nova.append(a)
            continue
        t = dict(a.get("tools") or {})
        deny = list(t.get("deny") or [])
        faltam = [c for c in cortes if c not in deny]
        if faltam:
            novos[a["id"]] = faltam
            t["deny"] = deny + faltam
        nova.append({**a, "tools": t})
    return nova, novos


async def efetivas(cli, agente: str) -> set[str]:
    s = await cli.chamar("sessions.list", {"limit": 500})
    sess = (s.get("payload") or s).get("sessions") or []
    chave = next((x["key"] for x in sess if str(x.get("key", "")).startswith(f"agent:{agente}:")),
                 f"agent:{agente}:main")
    r = await cli.chamar("tools.effective", {"sessionKey": chave})
    nomes: set[str] = set()

    def junta(o):
        if isinstance(o, dict):
            if o.get("source") and isinstance(o.get("id"), str):
                nomes.add(o["id"])
            for v in o.values():
                junta(v)
        elif isinstance(o, list):
            for v in o:
                junta(v)

    junta(r.get("payload") or r)
    return nomes


async def principal(argv: list[str]) -> int:
    if "--conferir" in argv:
        c = await cfg.carregar()
        cli = obter_cliente(c.url, c.token)
        ok = True
        for ag, cortes in CORTES.items():
            ainda = sorted(set(cortes) & await efetivas(cli, ag))
            print(f"  {ag:6} {'OK' if not ainda else 'AINDA TEM: ' + ', '.join(ainda)}")
            ok &= not ainda
        return 0 if ok else 1

    parsed, base_hash = await config_do_gateway()
    lista = (parsed.get("agents") or {}).get("list") or []
    nova, novos = montar_lista(lista)
    if not novos:
        print("Nada a cortar: os denies já estão na config. Rode --conferir.")
        return 0
    for ag, f in novos.items():
        print(f"  {ag:6} passa a negar: {', '.join(f)}")
    if "--aplicar" not in argv:
        print("\nEnsaio. Rode com --aplicar para gravar.")
        return 0

    esperado = {a["id"]: set((a.get("tools") or {}).get("deny") or []) for a in nova if a["id"] in novos}

    def conferir(c: dict) -> bool:
        vivos = {a.get("id"): set((a.get("tools") or {}).get("deny") or [])
                 for a in ((c.get("agents") or {}).get("list") or [])}
        return all(vivos.get(i) == d for i, d in esperado.items())

    await aplicar_patch({"agents": {"list": nova}}, base_hash, conferir=conferir)
    print("Gravado e conferido na config relida. Agora: --conferir (o efeito real).")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(principal(sys.argv[1:])))
