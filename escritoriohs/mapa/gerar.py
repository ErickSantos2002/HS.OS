"""planta.json → saida/hs.tmj (blocos) + saida/hs.wam (áreas e objetos) + PNGs.

Uso: python3 gerar.py [planta.json] [saida]
O gerador manda em paredes, salas, áreas e placas. Os objetos (móveis) ele
cria uma vez; depois de publicados são do Erick (ver mesclar.py).
"""
import hashlib, json, os, sys
from PIL import Image, ImageDraw, ImageFont
import blocos, modelo, objetos

TIPO_PISO = {"sala": "madeira", "reuniao": "carpete", "diretoria": "carpete",
             "recepcao": "piso_claro", "cafe": "madeira", "silenciosa": "carpete"}
# Cada tipo de cômodo: (carimbo, onde) — `onde` recebe o interior caminhável
# (x1, y1, x2, y2) e devolve o canto do carimbo. y1 é a primeira linha abaixo
# das faces; carimbos com dy=-1 (tv, quadro, topo da estante) caem na face.
MOVEIS_POR_TIPO = {   # BLOCOS fixos: só o que não existe na coleção do editor
    "sala": [],
    "diretoria": [("quadro", lambda a: (a[2] - 5, a[1]))],
    "reuniao": [("mesa_reuniao", lambda a: ((a[0] + a[2]) // 2 - 2, (a[1] + a[3]) // 2 - 2)),
                ("tv", lambda a: (a[0] + 2, a[1]))],
    "cafe": [("balcao_cafe", lambda a: (a[0], a[1])),
             ("mesa_redonda", lambda a: (a[0] + 2, a[1] + 3)),
             ("mesa_redonda", lambda a: (a[0] + 7, a[1] + 3)),
             ("mesa_redonda", lambda a: (a[0] + 12, a[1] + 3)),
             ("mesa_redonda", lambda a: (a[0] + 4, a[1] + 6)),
             ("mesa_redonda", lambda a: (a[0] + 9, a[1] + 6)),
             ("quadro", lambda a: (a[2] - 7, a[1]))],
    "silenciosa": [],
    "recepcao": [("balcao_recepcao", lambda a: ((a[0] + a[2]) // 2 - 1, a[1] + 1)),
                 ("quadro", lambda a: (a[0] + 3, a[1])),
                 ("quadro", lambda a: (a[2] - 4, a[1]))],
}

# OBJETOS do editor: (peça, onde) — o Erick move e apaga pelo navegador.
# `onde` devolve o bloco do canto de cima da IMAGEM (que pode subir na face).
OBJETOS_POR_TIPO = {
    "sala": [("estante_parede", lambda a: (a[0], a[1] - 1)),   # logo abaixo da placa
             ("mesa", lambda a: (a[0] + 4, a[1] - 1)),
             ("monitor", lambda a: (a[0] + 4, a[1])),
             ("canecas", lambda a: (a[0] + 5, a[1])),
             ("cadeira_cima", lambda a: (a[0] + 4, a[1] + 2)),
             ("planta", lambda a: (a[0] + 5, a[1] + 2)),
             ("poltrona_dir", lambda a: (a[0], a[1] + 2)),
             ("lixeira", lambda a: (a[0] + 1, a[1] + 3)),
             ("relogio", lambda a: (a[0] + 5, a[1] - 2))],
    "diretoria": [("estante_grande", lambda a: (a[0] + 1, a[1] - 2)),
                  ("mesa", lambda a: (a[0] + 6, a[1] - 1)),
                  ("monitor", lambda a: (a[0] + 6, a[1])),
                  ("livros", lambda a: (a[0] + 7, a[1])),
                  ("cadeira_cima", lambda a: (a[0] + 6, a[1] + 2)),
                  ("sofa", lambda a: (a[2] - 2, a[3] - 1)),
                  ("poltrona_esq", lambda a: (a[2] - 3, a[3] - 1)),
                  ("planta_grande", lambda a: (a[2] - 2, a[1] - 1)),
                  ("relogio", lambda a: (a[0] + 4, a[1] - 2))],
    "reuniao": [("planta_grande", lambda a: (a[0], a[1] - 1)),
                ("planta_grande", lambda a: (a[2] - 2, a[1] - 1)),
                ("relogio", lambda a: (a[2] - 3, a[1] - 2))],
    "cafe": [("estante", lambda a: (a[0] + 4, a[1] - 2)),
             ("sofa", lambda a: (a[2] - 2, a[1])),
             ("sofa", lambda a: (a[2] - 5, a[1])),
             ("planta_grande", lambda a: (a[0], a[3] - 2)),
             ("planta_grande", lambda a: (a[2] - 2, a[3] - 2)),
             ("cafeteira", lambda a: (a[0] + 3, a[1])),
             ("relogio", lambda a: (a[0] + 8, a[1] - 2))],
    "silenciosa": [("estante_grande", lambda a: (a[0], a[1] - 2)),
                   ("estante_grande", lambda a: (a[2] - 1, a[1] - 2)),
                   ("pufe", lambda a: (a[0] + 2, a[1] + 2)),
                   ("pufe", lambda a: (a[0] + 4, a[1] + 2)),
                   ("pufe", lambda a: (a[0] + 6, a[1] + 2)),
                   ("poltrona", lambda a: (a[0] + 3, a[1] + 5)),
                   ("poltrona", lambda a: (a[0] + 5, a[1] + 5)),
                   ("planta_grande", lambda a: (a[0], a[3] - 2)),
                   ("planta_grande", lambda a: (a[2] - 2, a[3] - 2))],
    "recepcao": [("sofa", lambda a: (a[0] + 2, a[1] + 4)),
                 ("sofa", lambda a: (a[0] + 4, a[1] + 4)),
                 ("sofa", lambda a: (a[2] - 5, a[1] + 4)),
                 ("sofa", lambda a: (a[2] - 3, a[1] + 4)),
                 ("planta_grande", lambda a: (a[0], a[1] - 1)),
                 ("planta_grande", lambda a: (a[2] - 2, a[1] - 1)),
                 ("monitor", lambda a: ((a[0] + a[2]) // 2 - 1, a[1] + 1)),
                 ("relogio", lambda a: ((a[0] + a[2]) // 2 + 4, a[1] - 2))],
}

def _com_ids(itens, prefixo):
    """Id por (cômodo, peça, ocorrência): inserir uma peça no meio da lista não
    muda o id das outras — com id por posição, a peça nova virava cópia da última."""
    vistos, out = {}, []
    for peca, x, y, rotulo in itens:
        k = vistos.get(peca, 0); vistos[peca] = k + 1
        out.append((_id("obj", prefixo, peca, str(k)), peca, x, y, rotulo))
    return out

def objetos_do_mapa(planta):
    """[(id, peça, x_px, y_px, rótulo)] de todos os objetos do gerador."""
    out = []
    for c in planta.comodos:
        x1, y1, x2, y2 = c.interior()
        area = (x1, y1 + 2, x2, y2)
        itens = []
        for peca, onde in OBJETOS_POR_TIPO[c.tipo]:
            tx, ty = onde(area)
            itens.append((peca, tx * 32, ty * 32, f"{c.nome} · {peca}"))
        out += _com_ids(itens, c.nome)
    out += _com_ids([(d["objeto"], d["x"] * 32, d["y"] * 32, f"corredor · {d['objeto']}")
                     for d in planta.decoracao if "objeto" in d], "corredor")
    return out

def ids_antigos(planta):
    """{id antigo: id novo}. Até 15/10/2026 o id era (cômodo, índice na lista) —
    os 303 objetos publicados nesse dia usam esse formato. Vale para as listas
    como estavam naquele envio (commit ac82568); não reordenar antes de migrar."""
    novos = {(r, p, x, y): i for i, p, x, y, r in objetos_do_mapa(planta)}
    mapa = {}
    for c in planta.comodos:
        x1, y1, x2, y2 = c.interior()
        area = (x1, y1 + 2, x2, y2)
        for i, (peca, onde) in enumerate(OBJETOS_POR_TIPO[c.tipo]):
            tx, ty = onde(area)
            mapa[_id("obj", c.nome, str(i))] = novos[(f"{c.nome} · {peca}", peca, tx * 32, ty * 32)]
    for i, d in enumerate(planta.decoracao):
        if "objeto" in d:
            mapa[_id("obj", "corredor", str(i))] = novos[(f"corredor · {d['objeto']}", d["objeto"], d["x"] * 32, d["y"] * 32)]
    return mapa

def _id(*partes):
    """Id estável: derivado do nome, nunca aleatório (bytes iguais a cada geração)."""
    return hashlib.sha1("/".join(partes).encode()).hexdigest()[:8] + "-" + \
        hashlib.sha1(("x" + "/".join(partes)).encode()).hexdigest()[:4] + "-4000-8000-" + \
        hashlib.sha1(("y" + "/".join(partes)).encode()).hexdigest()[:12]

def _interior_caminhavel(c, parede):
    """Interior menos as duas linhas de face sob a parede norte."""
    x1, y1, x2, y2 = c.interior()
    return x1, y1 + 2, x2, y2

def grade(planta):
    W, H = planta.largura, planta.altura
    parede = {(x, 0) for x in range(W)} | {(x, H - 1) for x in range(W)} | \
             {(0, y) for y in range(H)} | {(W - 1, y) for y in range(H)}
    for c in planta.comodos:
        lados = {"N": [(x, c.y) for x in range(c.x, c.x + c.w)],
                 "S": [(x, c.y + c.h - 1) for x in range(c.x, c.x + c.w)],
                 "W": [(c.x, y) for y in range(c.y, c.y + c.h)],
                 "E": [(c.x + c.w - 1, y) for y in range(c.y, c.y + c.h)]}
        for lado, cels in lados.items():
            if c.tipo == "recepcao" and lado == "S":
                continue  # recepção aberta para o corredor
            parede |= set(cels)
    porta = {cel for c in planta.comodos for cel in c.celulas_porta()}
    parede -= porta
    bloqueado = set(parede)
    for c in planta.comodos:
        x1, y1, x2, y2 = _interior_caminhavel(c, parede)
        for nome, onde in MOVEIS_POR_TIPO[c.tipo]:
            ox, oy = onde((x1, y1, x2, y2))
            for dx, dy, _, _, colide in blocos.CARIMBOS[nome]:
                if colide:
                    bloqueado.add((ox + dx, oy + dy))
    for d in planta.decoracao:
        if "carimbo" in d:
            for dx, dy, _, _, colide in blocos.CARIMBOS[d["carimbo"]]:
                if colide:
                    bloqueado.add((d["x"] + dx, d["y"] + dy))
    fixo = set(bloqueado)   # o que vai para a camada `colisao`: só blocos
    # Objetos: o WA aplica a collisionGrid onde a entidade ESTÁ. Pintá-la no tmj
    # deixaria parede invisível quando o Erick move ou apaga a mesa. Entra só
    # aqui, para os testes de alcance e de porta.
    for _, peca, x_px, y_px, _ in objetos_do_mapa(planta):
        bloqueado |= objetos.celulas_colisao(peca, x_px, y_px)
    # face de parede: 2 blocos abaixo de parede com piso logo ao sul — também colide
    for (x, y) in sorted(parede):
        if (x, y + 1) not in parede and y + 1 < H:
            bloqueado |= {(x, y + 1), (x, y + 2)} - porta
            fixo |= {(x, y + 1), (x, y + 2)} - porta
    return {"parede": parede, "porta": porta, "bloqueado": bloqueado, "fixo": fixo}

def _mascara(parede, x, y):
    return ((x, y - 1) in parede) * 1 + ((x + 1, y) in parede) * 2 + \
           ((x, y + 1) in parede) * 4 + ((x - 1, y) in parede) * 8

def _placas(planta, pasta):
    """Folha de placas: cada placa é 2×1 blocos com o texto. O nome mais longo
    ("Expedição 02") tem que caber em 64 px — test_placa_cabe_na_largura."""
    nomes = sorted({c.placa for c in planta.comodos if c.placa})
    img = Image.new("RGBA", (64, 32 * len(nomes)), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    fonte = ImageFont.load_default(size=9)
    for i, n in enumerate(nomes):
        d.rounded_rectangle((1, 32 * i + 9, 62, 32 * i + 23), 3, fill=(24, 133, 200, 255),
                            outline=(14, 79, 120, 255))
        w = d.textlength(n, font=fonte)
        d.text(((64 - w) / 2, 32 * i + 11), n, font=fonte, fill=(255, 255, 255, 255))
    img.save(os.path.join(pasta, "placas.png"), optimize=False)
    return nomes

def _logo(pasta):
    """Folha 192×128 a partir do logo oficial (tilesets/logo-hs-original.png):
    linhas 0–1 = placa para a parede; linhas 2–3 = tapete da entrada."""
    orig = Image.open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                   "tilesets", "logo-hs-original.png")).convert("RGBA")
    folha = Image.new("RGBA", (192, 128), (0, 0, 0, 0))
    d = ImageDraw.Draw(folha)
    d.rounded_rectangle((2, 6, 189, 60), 6, fill=(255, 255, 255, 255), outline=(14, 79, 120, 255), width=2)
    d.rounded_rectangle((0, 66, 191, 125), 10, fill=(24, 133, 200, 255))
    d.rounded_rectangle((5, 71, 186, 120), 7, fill=(236, 244, 250, 255))
    for caixa in ((8, 10, 184, 56), (12, 75, 180, 116)):
        logo = orig.copy()
        logo.thumbnail((caixa[2] - caixa[0], caixa[3] - caixa[1]), Image.LANCZOS)
        folha.alpha_composite(logo, (caixa[0] + (caixa[2] - caixa[0] - logo.width) // 2,
                                     caixa[1] + (caixa[3] - caixa[1] - logo.height) // 2))
    folha.save(os.path.join(pasta, "logo-hs.png"), optimize=False)

def gerar(caminho_planta="planta.json", pasta="saida"):
    os.makedirs(pasta, exist_ok=True)
    P = modelo.carregar(caminho_planta)
    W, H = P.largura, P.altura
    g = grade(P)
    vazio = lambda: [0] * (W * H)  # noqa: E731
    cam = {n: vazio() for n in ("inicio", "colisao", "piso1", "paredes1", "paredes2",
                                "moveis1", "moveis2", "placas", "acima")}
    def pôr(nome, x, y, gid_):
        if 0 <= x < W and 0 <= y < H:
            cam[nome][y * W + x] = gid_

    for y in range(H):
        for x in range(W):
            pôr("piso1", x, y, blocos.PISO["corredor"])
    for c in P.comodos:
        x1, y1, x2, y2 = c.interior()
        for x in range(x1, x2 + 1):
            for y in range(y1, y2 + 1):
                pôr("piso1", x, y, blocos.PISO[TIPO_PISO[c.tipo]])
    for (x, y) in g["parede"]:
        pôr("paredes1", x, y, blocos.PAREDE[_mascara(g["parede"], x, y)])
        if (x, y + 1) not in g["parede"] and y + 1 < H - 1:
            externa = y == 0
            for k, gid_ in ((1, blocos.FACE_ALTA_EXT if externa else blocos.FACE_ALTA),
                            (2, blocos.FACE_BAIXA_EXT if externa else blocos.FACE_BAIXA)):
                if (x, y + k) not in g["porta"] and (x, y + k) not in g["parede"]:
                    pôr("paredes2", x, y + k, gid_)
    for (x, y) in g["fixo"]:
        pôr("colisao", x, y, blocos.COLISAO)

    for c in P.comodos:
        area = _interior_caminhavel(c, g["parede"])
        for nome, onde in MOVEIS_POR_TIPO[c.tipo]:
            ox, oy = onde(area)
            for dx, dy, camada, gid_, _ in blocos.CARIMBOS[nome]:
                pôr(camada, ox + dx, oy + dy, gid_)

    for d in P.decoracao:
        if "carimbo" in d:
            for dx, dy, camada, gid_, _ in blocos.CARIMBOS[d["carimbo"]]:
                pôr(camada, d["x"] + dx, d["y"] + dy, gid_)

    nomes = _placas(P, pasta)
    primeiro_placa = blocos.TILESETS[-1][1] + blocos.TILESETS[-1][3]
    for c in P.comodos:
        if c.placa:
            i = nomes.index(c.placa)
            x1, y1, _, _ = c.interior()
            # canto esquerdo da parede: as colunas do meio são da porta norte
            pôr("placas", x1, y1, primeiro_placa + 2 * i)
            pôr("placas", x1 + 1, y1, primeiro_placa + 2 * i + 1)

    rec = next(c for c in P.comodos if c.tipo == "recepcao")
    rx1, ry1, rx2, ry2 = rec.interior()
    pôr("inicio", (rx1 + rx2) // 2, ry2, blocos.START)

    _logo(pasta)
    primeiro_logo = primeiro_placa + 2 * len(nomes)
    lx = (rx1 + rx2) // 2 - 3
    for k in range(6):
        for j in range(2):
            pôr("placas", lx + k, ry1 + j, primeiro_logo + j * 6 + k)            # placa na face
            pôr("moveis1", lx + k, ry2 - 3 + j, primeiro_logo + (j + 2) * 6 + k)  # tapete no chão

    def camada(nome, rotulo=None):
        return {"type": "tilelayer", "name": rotulo or nome, "width": W, "height": H,
                "x": 0, "y": 0, "opacity": 1, "visible": True, "data": cam[nome]}
    def grupo(nome, filhos):
        return {"type": "group", "name": nome, "opacity": 1, "visible": True, "x": 0, "y": 0, "layers": filhos}

    tilesets = [{"firstgid": f, "name": n, "image": f"tilesets/{n}.png", "columns": col,
                 "tilecount": tot, "tilewidth": 32, "tileheight": 32, "margin": 0, "spacing": 0,
                 "imagewidth": col * 32, "imageheight": (tot // col) * 32,
                 "properties": [{"name": "tilesetCopyright", "type": "string",
                                 "value": "WorkAdventure map-starter-kit — CC-BY-SA 3.0"}]}
                for n, f, col, tot in blocos.TILESETS]
    # ⚠️ Sem isto o WA ignora a camada de colisão inteira: o bloco só barra a
    # passagem se a folha declarar `collides` (igual ao office.tmj oficial).
    zonas = next(t for t in tilesets if t["name"] == "WA_Special_Zones")
    zonas["tiles"] = [{"id": blocos.COLISAO - zonas["firstgid"],
                       "properties": [{"name": "collides", "type": "bool", "value": True}]}]
    tilesets.append({"firstgid": primeiro_placa, "name": "placas_hs", "image": "placas.png",
                     "columns": 2, "tilecount": 2 * len(nomes), "tilewidth": 32, "tileheight": 32,
                     "margin": 0, "spacing": 0, "imagewidth": 64, "imageheight": 32 * len(nomes)})
    tilesets.append({"firstgid": primeiro_logo, "name": "logo_hs", "image": "logo-hs.png",
                     "columns": 6, "tilecount": 24, "tilewidth": 32, "tileheight": 32,
                     "margin": 0, "spacing": 0, "imagewidth": 192, "imageheight": 128})
    tmj = {"type": "map", "orientation": "orthogonal", "renderorder": "right-down", "compressionlevel": -1,
           "width": W, "height": H, "tilewidth": 32, "tileheight": 32, "infinite": False,
           "version": "1.10", "tiledversion": "1.10.2", "nextlayerid": 20, "nextobjectid": 1,
           "properties": [{"name": "mapName", "type": "string", "value": "EscritorioHS"},
                          {"name": "mapCopyright", "type": "string",
                           "value": "Blocos: WorkAdventure (CC-BY-SA 3.0). Planta: Health & Safety."}],
           "tilesets": tilesets,
           "layers": [camada("inicio"), camada("colisao"),
                      grupo("piso", [camada("piso1")]),
                      grupo("paredes", [camada("paredes1"), camada("paredes2")]),
                      grupo("moveis", [camada("moveis1"), camada("moveis2"), camada("placas")]),
                      {"type": "objectgroup", "name": "floorLayer", "objects": [], "opacity": 1,
                       "visible": True, "draworder": "topdown", "x": 0, "y": 0},
                      grupo("acima", [camada("acima")])]}
    # id em toda camada, inclusive as de dentro dos grupos — o map-storage exige.
    proximo = [1]
    def numerar(ls):
        for l in ls:
            l["id"] = proximo[0]; proximo[0] += 1
            if l["type"] == "group":
                numerar(l["layers"])
    numerar(tmj["layers"])
    tmj["nextlayerid"] = proximo[0]
    json.dump(tmj, open(os.path.join(pasta, "hs.tmj"), "w"), sort_keys=True, ensure_ascii=False)
    json.dump(_wam(P), open(os.path.join(pasta, "hs.wam"), "w"), sort_keys=True, ensure_ascii=False, indent=1)
    json.dump(ids_antigos(P), open(os.path.join(pasta, "ids-antigos.json"), "w"), sort_keys=True, indent=1)

def _area(nome, x1, y1, x2, y2, props):
    return {"id": _id("area", nome), "name": nome, "visible": True,
            "x": x1 * 32, "y": y1 * 32, "width": (x2 - x1 + 1) * 32, "height": (y2 - y1 + 1) * 32,
            "properties": props}

def _wam(P):
    areas = []
    for c in P.comodos:
        x1, y1, x2, y2 = c.interior()
        if c.tipo == "recepcao":
            areas.append(_area(c.nome, x1, y1, x2, y2,
                               [{"id": _id(c.nome, "start"), "type": "start", "isDefault": True}]))
        elif c.tipo == "reuniao":
            areas.append(_area(c.nome, x1, y1, x2, y2, [{
                "id": _id(c.nome, "livekit"), "type": "livekitRoomProperty",
                "roomName": c.nome, "livekitRoomConfig": {"startWithAudioMuted": False,
                                                          "startWithVideoMuted": True}}]))
        elif c.tipo == "silenciosa":
            areas.append(_area(c.nome, x1, y1, x2, y2, [{"id": _id(c.nome, "silent"), "type": "silent"}]))
        elif c.tipo in ("sala", "diretoria"):
            props = [{"id": _id(c.nome, "lock"), "type": "lockableAreaPropertyData"}]
            if c.tipo == "sala":
                props.append({"id": _id(c.nome, "pessoal"), "type": "personalAreaPropertyData",
                              "accessClaimMode": "static", "allowedTags": [], "ownerId": None})
            areas.append(_area(c.nome, x1, y1, x2, y2, props))
    entidades = {oid: {"x": x, "y": y, "name": rotulo,
                       "prefabRef": {"collectionName": objetos.PECAS[peca][0], "id": objetos.prefab_id(peca)}}
                 for oid, peca, x, y, rotulo in objetos_do_mapa(P)}
    return {"version": "2.1.0", "mapUrl": "./hs.tmj", "entities": entidades, "areas": areas,
            # Os móveis que o editor do navegador oferece — sem isto ele abre vazio.
            "entityCollections": [{"type": "file", "url": f"https://escritoriohs.healthsafetytech.com/collections/{n}.json"}
                                  for n in ("FurnitureCollection", "OfficeCollection")],
            "lastCommandId": _id("cmd", "inicial"),
            "metadata": {"name": "EscritorioHS", "description": "Escritório virtual da Health & Safety",
                         "copyright": "Blocos: WorkAdventure (CC-BY-SA 3.0). Planta: Health & Safety."}}

if __name__ == "__main__":
    gerar(*(sys.argv[1:3] or ["planta.json", "saida"]))
