"""Junta o .wam recém-gerado com o que está no ar antes de enviar.

O gerador manda em paredes, salas, áreas e placas. Os objetos que o Erick
arrasta pelo editor do navegador (`entities`) são dele: o envio os lê do mapa
no ar e os mantém. Sem isto, cada mudança na planta apagaria a decoração.

Uso: python3 mesclar.py saida/hs.wam <hs.wam baixado do ar | ->
"""
import json, sys

def mesclar(novo, no_ar):
    r = dict(novo)
    if no_ar:
        r["entities"] = no_ar.get("entities") or {}
    return r

if __name__ == "__main__":
    caminho, origem = sys.argv[1], sys.argv[2]
    novo = json.load(open(caminho))
    no_ar = None
    if origem != "-":
        try:
            no_ar = json.load(open(origem))
        except (OSError, ValueError):
            no_ar = None
    json.dump(mesclar(novo, no_ar), open(caminho, "w"), sort_keys=True, ensure_ascii=False, indent=1)
    print(f"objetos preservados do mapa no ar: {len((no_ar or {}).get('entities') or {})}")
