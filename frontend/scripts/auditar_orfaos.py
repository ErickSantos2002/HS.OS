"""Arquivo do front que ninguém importa.

⚠️ A primeira versão só casava `from "x"` e deu `live-artifacts-context` como
órfão — ele é carregado por `import("x")` dinâmico dentro do `chat-sender`.
Esta casa os dois, mais `require` e `lazy(() => import(...))`.

Ignora `_legado/` (não roteado), `components/ui/` (shadcn, gerado) e testes.
"""
import re
import pathlib
import collections

RAIZ = pathlib.Path("/home/ericks/github/HS.OS/frontend/src")
PADRAO = re.compile(r'''(?:from|import|require)\s*\(?\s*["'`]([^"'`]+)["'`]''')

arquivos = [
    f for f in RAIZ.rglob("*.ts*")
    if "_legado" not in str(f)
    and "/components/ui/" not in str(f)
    and not f.name.endswith(".d.ts")
    and ".test." not in f.name
]

importados = set()
for f in arquivos:
    for alvo in PADRAO.findall(f.read_text()):
        importados.add(alvo.split("/")[-1].removesuffix(".tsx").removesuffix(".ts"))

orfaos = collections.defaultdict(list)
for f in arquivos:
    if f.stem in ("main", "App", "vite-env", "sw", "setup") or f.stem in importados:
        continue
    orfaos[f.parent.relative_to(RAIZ).as_posix() or "."].append(f.name)

total = sum(len(v) for v in orfaos.values())
print(f"arquivos varridos: {len(arquivos)}   sem ninguém importando: {total}\n")
for pasta in sorted(orfaos):
    print(f"-- {pasta}/")
    for n in sorted(orfaos[pasta]):
        print(f"     {n}")
