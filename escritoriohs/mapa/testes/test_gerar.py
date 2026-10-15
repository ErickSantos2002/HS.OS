"""O que o gerador escreve é o que a pessoa vai andar. O teste de alcance é o
que garante que ninguém nasce e não consegue entrar na própria sala."""
import collections, hashlib, json, os, tempfile
import gerar, modelo

P = modelo.carregar("planta.json")
G = gerar.grade(P)

def _alcancaveis():
    rec = next(c for c in P.comodos if c.tipo == "recepcao")
    x1, y1, x2, y2 = rec.interior()
    ini = ((x1 + x2) // 2, y2)
    vistos, fila = {ini}, collections.deque([ini])
    while fila:
        x, y = fila.popleft()
        for nx, ny in ((x+1, y), (x-1, y), (x, y+1), (x, y-1)):
            if 0 <= nx < P.largura and 0 <= ny < P.altura and (nx, ny) not in vistos \
                    and (nx, ny) not in G["bloqueado"]:
                vistos.add((nx, ny)); fila.append((nx, ny))
    return vistos

def test_toda_sala_alcancavel_a_partir_da_recepcao():
    alc = _alcancaveis()
    for c in P.comodos:
        x1, y1, x2, y2 = c.interior()
        livres = {(x, y) for x in range(x1, x2+1) for y in range(y1, y2+1)} - G["bloqueado"]
        assert livres & alc, f"{c.nome}: nenhuma célula do interior é alcançável da recepção"

def test_porta_nao_e_parede():
    for c in P.comodos:
        for cel in c.celulas_porta():
            assert cel not in G["parede"] and cel not in G["bloqueado"], (c.nome, cel)

def test_borda_do_mapa_e_parede():
    for x in range(P.largura):
        assert (x, 0) in G["parede"] and (x, P.altura - 1) in G["parede"]
    for y in range(P.altura):
        assert (0, y) in G["parede"] and (P.largura - 1, y) in G["parede"]

def test_gerar_duas_vezes_da_os_mesmos_bytes():
    hashes = []
    for _ in range(2):
        with tempfile.TemporaryDirectory() as d:
            gerar.gerar("planta.json", d)
            hashes.append([hashlib.sha256(open(os.path.join(d, f), "rb").read()).hexdigest()
                           for f in ("hs.tmj", "hs.wam", "placas.png", "logo-hs.png")])
    assert hashes[0] == hashes[1]

def test_tmj_tem_as_dimensoes_e_camadas():
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        m = json.load(open(os.path.join(d, "hs.tmj")))
    assert (m["width"], m["height"], m["tilewidth"]) == (P.largura, P.altura, 32)
    nomes = [l["name"] for l in m["layers"]]
    assert nomes == ["inicio", "colisao", "piso", "paredes", "moveis", "floorLayer", "acima"]

def test_camadas_tem_os_campos_que_o_map_storage_exige():
    """O map-storage recusou o primeiro envio (HTTP 400, "layers.2: Invalid
    input"): grupo sem x/y e camada aninhada sem id. Os campos abaixo são os do
    office.tmj oficial, que o servidor aceita."""
    exigidos = {"group": {"id", "name", "opacity", "type", "visible", "x", "y"},
                "tilelayer": {"height", "id", "name", "opacity", "type", "visible", "width", "x", "y", "data"},
                "objectgroup": {"draworder", "id", "name", "opacity", "type", "visible", "x", "y", "objects"}}
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        m = json.load(open(os.path.join(d, "hs.tmj")))
    ids = []
    def andar(ls):
        for l in ls:
            assert exigidos[l["type"]] <= set(l), (l["name"], exigidos[l["type"]] - set(l))
            ids.append(l["id"])
            if l["type"] == "group":
                andar(l["layers"])
    andar(m["layers"])
    assert len(ids) == len(set(ids))
    assert m["nextlayerid"] > max(ids)

def test_bloco_de_colisao_declara_collides():
    """O WA só barra a passagem em bloco cuja folha declara `collides: true`.
    Sem a declaração, a camada de colisão inteira é ignorada — no primeiro envio
    (15/10/2026) dava para atravessar todas as paredes e móveis."""
    import blocos
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        m = json.load(open(os.path.join(d, "hs.tmj")))
    t = next(t for t in m["tilesets"] if t["name"] == "WA_Special_Zones")
    indice = blocos.COLISAO - t["firstgid"]
    props = {p["name"]: p["value"] for x in t.get("tiles", []) if x["id"] == indice for p in x["properties"]}
    assert props.get("collides") is True
    camada = next(l for l in m["layers"] if l["name"] == "colisao")
    assert sum(1 for g in camada["data"] if g == blocos.COLISAO) > 1000
