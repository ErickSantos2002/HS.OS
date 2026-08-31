"""Rotas do backend sem chamador no front — versão larga.

A primeira versão casava só `api(...)` e perdeu a `/busca`, que é chamada com um
genérico multilinha. Esta coleta TODO literal que começa com `/` no front, em
qualquer contexto. Mais larga = menos falso positivo; em troca, uma rota citada
só num comentário passa por chamada.
"""
import re, pathlib, collections
RAIZ = pathlib.Path("/home/ericks/github/HS.OS")

rotas = []
for f in sorted((RAIZ / "backend/app/routers").glob("*.py")):
    txt = f.read_text()
    m = re.search(r'APIRouter\([^)]*prefix="([^"]*)"', txt, re.S)
    prefixo = m.group(1) if m else ""
    for verbo, caminho in re.findall(r'@router\.(get|post|put|patch|delete)\(\s*"([^"]*)"', txt):
        rotas.append((verbo.upper(), (prefixo + caminho) or "/", f.name))

lits = set()
for f in list((RAIZ / "frontend/src").rglob("*.ts")) + list((RAIZ / "frontend/src").rglob("*.tsx")):
    if "_legado" in str(f):
        continue
    for s in re.findall(r'[`"\']((?:/[A-Za-z0-9_${}./:-]*)+)', f.read_text()):
        lits.add(s.split("?")[0].split("${")[0].rstrip("/"))

def est(c):
    return c.split("{")[0].rstrip("/")

orfas = [(v, c, a) for v, c, a in rotas
         if not any(p and (est(c) == p or est(c).startswith(p + "/") or p.startswith(est(c)))
                    for p in lits)]

print(f"rotas: {len(rotas)}  literais no front: {len(lits)}  orfas: {len(orfas)}\n")
por = collections.defaultdict(list)
for v, c, a in orfas:
    por[a].append(f"{v} {c}")
for a in sorted(por):
    print(f"-- {a}")
    for r in sorted(por[a]):
        print(f"     {r}")
