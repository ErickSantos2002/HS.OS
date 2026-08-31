"""Como cada rota é protegida. Procura a dependência na assinatura da função."""
import re, pathlib, collections
RAIZ = pathlib.Path("/home/ericks/github/HS.OS/backend/app/routers")

def classificar(assinatura, corpo):
    if "exige_papel(" in assinatura:
        m = re.search(r'exige_papel\("([a-z]+)"\)', assinatura)
        return f'papel:{m.group(1) if m else "?"}'
    if "exige_segredo(" in assinatura:
        return "segredo"
    if "usuario_atual" in assinatura:
        return "so logado"
    if "Depends(" in assinatura:
        return "outra dependencia"
    return "SEM AUTH"

linhas = []
for f in sorted(RAIZ.glob("*.py")):
    txt = f.read_text()
    m = re.search(r'APIRouter\([^)]*prefix="([^"]*)"', txt, re.S)
    prefixo = m.group(1) if m else ""
    # cada decorator + a assinatura da função que vem logo abaixo
    for mo in re.finditer(
        r'@router\.(get|post|put|patch|delete)\(\s*"([^"]*)"(?:[^)]*)\)\s*\n'
        r'(?:async\s+)?def\s+\w+\((.*?)\)\s*(?:->[^:]*)?:', txt, re.S):
        verbo, caminho, assin = mo.group(1).upper(), mo.group(2), mo.group(3)
        linhas.append((classificar(assin, txt), verbo, (prefixo + caminho) or "/", f.name))

por = collections.Counter(c for c, *_ in linhas)
print("=== proteção das rotas ===")
for k, v in por.most_common():
    print(f"  {k:22} {v}")
print()
sem = [l for l in linhas if l[0] == "SEM AUTH"]
print(f"=== as {len(sem)} SEM AUTH ===")
for _, v, c, a in sorted(sem, key=lambda x: x[2]):
    print(f"  {v:6} {c:52} {a}")
