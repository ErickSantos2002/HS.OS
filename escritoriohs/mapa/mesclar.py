"""Junta o .wam recém-gerado com o que está no ar antes de enviar.

Paredes, salas, áreas e placas são do gerador. Os OBJETOS (móveis, plantas…)
viram do Erick depois de publicados: o gerador cria cada um uma vez só e anota
o id em `publicados.json`. Nos envios seguintes:
  - objeto que está no ar fica como está (se o Erick moveu, continua movido);
  - objeto já publicado que sumiu do ar foi apagado pelo Erick — não volta;
  - objeto novo do gerador (sala nova, peça nova) é acrescentado.

Uso: python3 mesclar.py saida/hs.wam <hs.wam do ar | -> publicados.json
     (grava publicados.json.novo; o enviar.sh o promove só se o envio der 200)
"""
import json, sys

def mesclar(novo, no_ar, publicados):
    gerados = novo.get("entities") or {}
    entidades = dict((no_ar or {}).get("entities") or {})
    for k, v in gerados.items():
        if k not in publicados:
            entidades[k] = v
    r = dict(novo)
    r["entities"] = entidades
    return r, set(publicados) | set(gerados)

if __name__ == "__main__":
    caminho, origem, caminho_pub = sys.argv[1], sys.argv[2], sys.argv[3]
    novo = json.load(open(caminho))
    no_ar = None
    if origem != "-":
        try:
            no_ar = json.load(open(origem))
        except (OSError, ValueError):
            no_ar = None
    try:
        publicados = set(json.load(open(caminho_pub)))
    except (OSError, ValueError):
        publicados = set()
    wam, pub = mesclar(novo, no_ar, publicados)
    json.dump(wam, open(caminho, "w"), sort_keys=True, ensure_ascii=False, indent=1)
    json.dump(sorted(pub), open(caminho_pub + ".novo", "w"), indent=0)
    print(f"objetos no ar mantidos: {len((no_ar or {}).get('entities') or {})} · "
          f"novos do gerador: {len(set(novo.get('entities') or {}) - publicados)} · total: {len(wam['entities'])}")
