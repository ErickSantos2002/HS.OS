"""Declara no gateway uma entrada `hsos-anexos-<agente>` por agente.

    ANEXOS_MCP_SEGREDO=… GUARDRAILS_API_TOKEN=… python scripts/publicar-anexos-mcp.py           # ensaio
    ANEXOS_MCP_SEGREDO=… GUARDRAILS_API_TOKEN=… python scripts/publicar-anexos-mcp.py --aplicar

URL base e cabeçalhos são copiados da entrada `hsos-relatorios`, que já
funciona — o mesmo backend, o mesmo `GUARDRAILS_API_TOKEN`. O que muda é o
caminho, que leva o HMAC do agente.

⚠️ **Declarar a entrada a entrega a TODO agente.** O perfil `coding` libera todo
servidor MCP e o `alsoAllow` só acrescenta; quem exclui é o `deny`. Por isso o
MESMO patch que declara as entradas regrava o `tools` de todos os agentes da
config (a lista sai do `agents.list`, não de uma tupla fixa — agente criado pela
tela também conta): cada um ganha a própria entrada no `alsoAllow` e nega as dos
outros. Sem isso, o agente que não estivesse numa lista fixa enxergaria a
`hsos-anexos-<outro>` e agiria com a identidade do outro.

⚠️ É ESCRITA NO GATEWAY: o ensaio imprime o payload com a assinatura mascarada
e tem que ser mostrado ao Erick antes do `--aplicar`. Mesmo o ensaio LÊ a config
do gateway real (`config.get`), então também exige o túnel aberto.

A montagem das entradas e do patch, a conferência e o mascaramento são funções
puras (`montar_entradas`, `montar_patch`, `conferir_escopo`, `mascarar_entradas`)
justamente para serem testadas sem gateway.
"""
import asyncio
import copy
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))
from app.gateway.patch import aplicar_patch, config_do_gateway  # noqa: E402
from app.routers.integracoes import escopo_mcp_do_agente, ferramentas_anexos  # noqa: E402
from app.routers.mcp_anexos import assinatura_do_agente  # noqa: E402



REDIGIDO = "__OPENCLAW_REDACTED__"


def cabecalhos_com_token(modelo: dict, token: str) -> dict:
    """Os cabeçalhos do modelo com o valor real do token.

    ⚠️ **O `config.get` nunca devolve segredo em claro**: o valor de cada
    cabeçalho de `mcp.servers` volta como `__OPENCLAW_REDACTED__`, e o
    `config.patch` recusa esse sentinela ("is not valid as real data"). Copiar o
    cabeçalho do `hsos-relatorios` foi exatamente o que a primeira aplicação
    tentou, em 13/10/2026 — o gateway recusou antes de gravar. Os NOMES dos
    cabeçalhos vêm do modelo; o VALOR vem do `GUARDRAILS_API_TOKEN`, que é o que
    o `exige_segredo` confere (Bearer em `Authorization`, cru nos outros).
    """
    nomes = list((modelo.get("headers") or {}).keys()) or ["Authorization"]
    return {n: (f"Bearer {token}" if n.lower() == "authorization" else token) for n in nomes}


def montar_entradas(modelo: dict, segredo: str, agentes, token: str = "") -> dict:
    """Uma entrada `hsos-anexos-<id>` por agente, copiada do `modelo`.

    Tudo que não é `url`/`toolFilter` (cabeçalhos, transporte) vem do modelo; a
    URL leva o HMAC do agente — é ele que o servidor confere para saber QUEM
    chama, já que o gateway não repassa a identidade.
    """
    base = modelo["url"].rsplit("/mcp/", 1)[0]
    novos = {}
    for aid in agentes:
        entrada = {k: v for k, v in modelo.items() if k not in ("url", "toolFilter")}
        if token:
            entrada["headers"] = cabecalhos_com_token(modelo, token)
        elif REDIGIDO in json.dumps(entrada.get("headers") or {}):
            raise ValueError("os cabeçalhos do modelo vieram redigidos pelo config.get; "
                             "passe GUARDRAILS_API_TOKEN no ambiente")
        entrada["url"] = f"{base}/mcp/anexos/{aid}/{assinatura_do_agente(segredo, aid)}"
        entrada["toolFilter"] = {"include": list(ferramentas_anexos(aid))}
        novos[f"hsos-anexos-{aid}"] = entrada
    return novos


def mascarar_url(url: str) -> str:
    """Esconde a assinatura (último segmento do caminho), deixando 6 caracteres
    para o Erick distinguir uma entrada da outra. A assinatura inteira é a
    credencial do agente: não pode ir para terminal nem para transcript."""
    cabeca, _, assinatura = url.rpartition("/")
    return f"{cabeca}/{assinatura[:6]}…"


# ⚠️ LISTA BRANCA, não lista negra. A primeira versão copiava a entrada e só
# trocava `url` e `headers` — um campo novo no `hsos-relatorios` (um `env`, um
# `auth` com token) sairia inteiro no terminal e no transcript.
_EXIBIDOS = ("transport", "toolFilter")


def mascarar_entradas(novos: dict) -> dict:
    saida = {}
    for nome, e in novos.items():
        m = {}
        for k, v in e.items():
            if k == "url":
                m[k] = mascarar_url(v)
            elif k == "headers":
                m[k] = "<copiados de hsos-relatorios>"
            elif k in _EXIBIDOS:
                m[k] = v
            else:
                m[k] = "<omitido>"
        saida[nome] = m
    return saida


def montar_patch(conf: dict, segredo: str, token: str = "") -> tuple[dict, dict]:
    """O patch inteiro: entradas novas + `agents.list` com o escopo de todos.

    ⚠️ `agents.list` é ARRAY e array SUBSTITUI no merge patch: a lista vai
    inteira, com cada agente que existe na config. O `deny` é recalculado sobre
    os servidores JÁ COM as entradas novas — calcular sobre os de antes deixaria
    as novas de fora do deny de todo mundo.
    """
    servidores = (conf.get("mcp") or {}).get("servers") or {}
    modelo = servidores.get("hsos-relatorios")
    if not modelo:
        raise ValueError("não achei hsos-relatorios em mcp.servers para copiar URL e cabeçalhos")
    agentes = copy.deepcopy((conf.get("agents") or {}).get("list") or [])
    if not agentes:
        raise ValueError("agents.list vazio na config — sem agentes, não há o que publicar")
    ids = [str(a["id"]) for a in agentes]
    novos = montar_entradas(modelo, segredo, ids, token)
    depois = {**servidores, **novos}
    for a in agentes:
        a["tools"] = escopo_mcp_do_agente(str(a["id"]), a.get("tools") or {}, depois)
    return {"mcp": {"servers": novos}, "agents": {"list": agentes}}, novos


def conferir_escopo(parsed: dict, novos: dict) -> bool:
    """Confere na config RELIDA: as entradas estão lá com a URL certa, nenhum
    agente tem no `alsoAllow` a entrada de outro, e todos negam as dos outros."""
    s = (parsed.get("mcp") or {}).get("servers") or {}
    if not all(n in s and s[n].get("url") == e["url"] for n, e in novos.items()):
        return False
    lista = (parsed.get("agents") or {}).get("list") or []
    ids = {str(a.get("id")) for a in lista}
    for a in lista:
        aid = str(a.get("id"))
        t = a.get("tools") or {}
        also, deny = t.get("alsoAllow") or [], set(t.get("deny") or [])
        for outro in ids - {aid}:
            for f in ferramentas_anexos(outro):
                if f"mcp__hsos-anexos-{outro}__{f}" in also:
                    return False
                if f"hsos-anexos-{outro}" in s and f"hsos-anexos-{outro}__{f}" not in deny:
                    return False
    return True


async def main() -> int:
    segredo = os.environ.get("ANEXOS_MCP_SEGREDO", "")
    if not segredo:
        print("❌ falta ANEXOS_MCP_SEGREDO no ambiente")
        return 1
    conf, base_hash = await config_do_gateway()
    try:
        patch, novos = montar_patch(conf, segredo, os.environ.get("GUARDRAILS_API_TOKEN", ""))
    except ValueError as e:
        print(f"❌ {e}")
        return 1

    print(json.dumps({"mcp": {"servers": mascarar_entradas(novos)}}, indent=2, ensure_ascii=False))
    for a in patch["agents"]["list"]:
        t = a["tools"]
        print(f"  {a['id']:8} alsoAllow {len(t['alsoAllow']):>2} | nega {len(t['deny']):>2}")
    if "--aplicar" not in sys.argv:
        print("\n  (ensaio — nada foi escrito; mostre ao Erick e rode com --aplicar)")
        return 0

    await aplicar_patch(patch, base_hash, lambda parsed: conferir_escopo(parsed, novos))
    print("\n  aplicado e conferido na config. Confira perguntando a um agente "
          "se ele enxerga a entrada de outro.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
