#!/usr/bin/env python3
"""Confere se os campos que o front declara existem mesmo na resposta da API.

Existe porque esta classe de erro já custou três correções separadas nesta
migração, e nenhuma foi pega por `tsc`, ESLint ou teste:

- 07/08 — `/agents` passou a devolver `{agents, defaultId, gatewayOk}` e seis
  lugares continuaram tratando como array
- 10/08 — `AutomacoesPage` declarava `agent_id` num payload cujo campo é `id`;
  o seletor listava nomes com valor `undefined`
- 10/08 — `/gateway/models` repassava `{id, name}` do gateway e a tela lia
  `{qualifiedId, label}`; o seletor de modelo do chat mostrava quatro linhas em
  branco e nunca marcava a escolha

O padrão é sempre o mesmo: **a rota responde 200 e a tela não funciona.** O
TypeScript não ajuda porque o tipo é uma afirmação sobre o que vem da rede, não
uma verificação — `api<{ label: string }>(...)` compila mesmo quando a API nunca
mandou `label`.

Uso (com backend de pé e um token válido):

    python3 scripts/conferir-contratos.py --token "$(cat /caminho/token)"

⚠️ **Um relatório limpo NÃO quer dizer que está tudo certo.** Ele cobre um
subconjunto, e vale saber qual antes de confiar. Ficam de fora:

- rota com parâmetro na URL, POST, PUT e DELETE — para essas continua valendo
  abrir a tela;
- `api<{ x: T[]; y: Record<string, string> }>` — o `>` de dentro do
  `Record<...>` fecha o genérico cedo demais para este regex, e a chamada é
  ignorada em silêncio. **É exatamente a forma do bug do `/gateway/models` que
  motivou o script**: testei reintroduzindo o defeito e o relatório continuou
  limpo. Consertar isso direito pede um parser de TypeScript, não um regex.

Ou seja: isto pega a repetição barata do erro, não todas as suas formas. Serve
como rede, não como prova.
"""

import argparse
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

RAIZ = pathlib.Path(__file__).resolve().parent.parent
FRONT = RAIZ / "frontend" / "src"

# ⚠️ O terceiro grupo captura o caractere logo após a rota. Sem ele, uma
# template literal como `/channels/${id}/mensagens` é TRUNCADA em `/channels/`
# e o script confere o tipo das mensagens contra a resposta da lista de canais
# — três falsos positivos na primeira versão.
CHAMADA = re.compile(r'api<\s*([^>]+?)\s*>\s*\(\s*[`"\']([^`"\'$]{2,}?)([`"\'$])', re.S)
DECL = re.compile(r"(?:export\s+)?(?:interface|type)\s+(\w+)\s*=?\s*\{(.*?)\n\}", re.S)
CAMPO = re.compile(r"^\s*(\w+)\??\s*:", re.M)


def arquivos_do_front():
    # `_legado/` está fora da compilação — conferir o que não roda só gera ruído.
    return [f for f in FRONT.rglob("*.ts*") if "_legado" not in str(f)]


def coletar_tipos(arquivos) -> dict[str, list[str]]:
    tipos: dict[str, list[str]] = {}
    for f in arquivos:
        for nome, corpo in DECL.findall(f.read_text(errors="ignore")):
            tipos.setdefault(nome, CAMPO.findall(corpo))
    return tipos


def coletar_chamadas(arquivos, tipos):
    for f in arquivos:
        for expr, rota, terminador in CHAMADA.findall(f.read_text(errors="ignore")):
            # `$` de terminador = a rota continua numa interpolação. Só a parte
            # estática foi capturada, e conferi-la seria comparar outra rota.
            if terminador == "$":
                continue
            rota = rota.split("?")[0]
            # Rota montada em runtime não dá para chamar às cegas.
            if not rota.startswith("/") or "{" in rota:
                continue
            inline = CAMPO.findall(expr) if expr.lstrip().startswith("{") else []
            # ⚠️ Um tipo só é conferível quando é o ÚNICO nomeado na expressão.
            # `api<{a: X[]; b: Y[]}>` mistura campos de X e Y, e a checagem
            # acusaria falta que não existe — foi assim que a primeira versão
            # deste script deu três falsos positivos.
            nomeados = [n for n in re.findall(r"\b([A-Z]\w+)\b", expr) if n in tipos]
            campos = inline or (tipos[nomeados[0]] if len(nomeados) == 1 else [])
            if campos:
                yield {
                    "arquivo": str(f.relative_to(RAIZ)),
                    "rota": rota,
                    "tipo": nomeados[0] if nomeados else "inline",
                    "campos": sorted(set(campos)),
                    "envelope": re.findall(r"^\s*\{\s*(\w+)\??\s*:", expr),
                }


def buscar(base: str, rota: str, token: str):
    req = urllib.request.Request(f"{base}{rota}", headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return json.load(r), None
    except urllib.error.HTTPError as e:
        return None, f"HTTP {e.code}"
    except Exception as e:  # noqa: BLE001 — qualquer falha aqui é "não conferido"
        return None, type(e).__name__


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--token", required=True, help="JWT de um super_admin")
    p.add_argument("--base", default="http://127.0.0.1:8002")
    args = p.parse_args()

    arquivos = arquivos_do_front()
    tipos = coletar_tipos(arquivos)
    chamadas = {}
    for c in coletar_chamadas(arquivos, tipos):
        chamadas.setdefault((c["rota"], c["tipo"]), c)

    divergencias = pulados = 0
    for (rota, _), c in sorted(chamadas.items()):
        corpo, erro = buscar(args.base, rota, args.token)
        if erro:
            pulados += 1
            continue
        # Compara contra o corpo E contra cada lista dentro dele. Um tipo como
        # `{agents: Agente[]; defaultId: string}` descreve os dois níveis ao
        # mesmo tempo, e olhar só um deles acusa falta do outro.
        niveis = [corpo]
        if isinstance(corpo, dict):
            niveis += [v[0] for v in corpo.values() if isinstance(v, list) and v]
        for k in c["envelope"]:
            if isinstance(corpo, dict) and isinstance(corpo.get(k), list) and corpo[k]:
                niveis.append(corpo[k][0])
        if isinstance(corpo, list) and corpo:
            niveis.append(corpo[0])

        dicts = [n for n in niveis if isinstance(n, dict)]
        if not dicts:
            pulados += 1
            continue
        conhecidos = set().union(*(set(d) for d in dicts))
        amostra = conhecidos
        faltando = [x for x in c["campos"] if x not in conhecidos]
        # Nenhum campo batendo = o tipo é de outra rota, não é divergência.
        if faltando and len(faltando) < len(c["campos"]):
            divergencias += 1
            print(f"\n⚠️  {rota}   (tipo {c['tipo']}, em {c['arquivo']})")
            print(f"    o front lê     : {', '.join(c['campos'])}")
            print(f"    a api devolve  : {', '.join(sorted(amostra))}")
            print(f"    NÃO EXISTE     : {', '.join(faltando)}")

    print(f"\n{len(chamadas)} pares rota/tipo · {pulados} não conferidos · "
          f"{divergencias} divergência(s)")
    return 1 if divergencias else 0


if __name__ == "__main__":
    sys.exit(main())
