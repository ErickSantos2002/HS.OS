"""Desenha um .tmj em PNG com os blocos reais — é o que o Erick aprova antes
de qualquer envio. Uso: python3 previa.py saida/hs.tmj saida/previa.png"""
import json, os, sys
from PIL import Image

def desenhar(caminho_tmj, caminho_png, escala=1.0):
    m = json.load(open(caminho_tmj))
    base = os.path.dirname(os.path.abspath(caminho_tmj))
    folhas = sorted(((t["firstgid"], t, Image.open(os.path.join(base, t["image"])).convert("RGBA"))
                     for t in m["tilesets"]), key=lambda x: x[0])
    W, H, TT = m["width"], m["height"], m["tilewidth"]
    out = Image.new("RGBA", (W * TT, H * TT), (40, 40, 48, 255))

    def bloco(g):
        g &= 0x1FFFFFFF
        f, t, img = [x for x in folhas if g >= x[0]][-1]
        i, c = g - f, t["columns"]
        return img.crop(((i % c) * TT, (i // c) * TT, (i % c) * TT + TT, (i // c) * TT + TT))

    def camadas(ls):
        for l in ls:
            if l["type"] == "group":
                yield from camadas(l["layers"])
            elif l["type"] == "tilelayer" and l["name"] not in ("colisao", "inicio"):
                yield l

    for l in camadas(m["layers"]):
        for k, g in enumerate(l["data"]):
            if g:
                out.alpha_composite(bloco(g), ((k % W) * TT, (k // W) * TT))
    # objetos do editor (hs.wam ao lado do .tmj), na ordem de profundidade do WA
    caminho_wam = os.path.splitext(caminho_tmj)[0] + ".wam"
    if os.path.exists(caminho_wam):
        import objetos
        por_id = {objetos.prefab_id(p): p for p in objetos.PECAS}
        ents = []
        for e in json.load(open(caminho_wam)).get("entities", {}).values():
            peca = por_id.get(e["prefabRef"]["id"])
            if peca:
                img = Image.open(objetos.caminho_imagem(peca)).convert("RGBA")
                prof = e["y"] + img.height + (objetos.item(peca).get("depthOffset") or 0)
                ents.append((prof, e["x"], e["y"], img))
        for _, x, y, img in sorted(ents, key=lambda t: t[0]):
            out.alpha_composite(img, (int(x), int(y)))
    if escala != 1.0:
        out = out.resize((int(out.width * escala), int(out.height * escala)), Image.NEAREST)
    out.save(caminho_png)

if __name__ == "__main__":
    desenhar(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
