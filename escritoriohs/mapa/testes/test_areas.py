"""As áreas do .wam são o comportamento: área trancável maior que a sala
trancaria o corredor; sala sem área pessoal não ganha dono no sub-projeto B."""
import json, os, tempfile
from PIL import Image, ImageDraw, ImageFont
import gerar, modelo

P = modelo.carregar("planta.json")
with tempfile.TemporaryDirectory() as _d:
    gerar.gerar("planta.json", _d)
    WAM = json.load(open(os.path.join(_d, "hs.wam")))
AREAS = {a["name"]: a for a in WAM["areas"]}

def _tipos(nome):
    return sorted(p["type"] for p in AREAS[nome]["properties"])

def test_cada_sala_tem_tranca_e_area_pessoal():
    for c in P.comodos:
        if c.tipo == "sala":
            assert _tipos(c.nome) == ["lockableAreaPropertyData", "personalAreaPropertyData"], c.nome

def test_areas_cobrem_so_o_interior():
    for c in P.comodos:
        if c.nome not in AREAS:
            continue
        a = AREAS[c.nome]
        x1, y1, x2, y2 = c.interior()
        assert (a["x"], a["y"]) == (x1 * 32, y1 * 32), c.nome
        assert (a["width"], a["height"]) == ((x2 - x1 + 1) * 32, (y2 - y1 + 1) * 32), c.nome

def test_reunioes_sao_livekit_e_nao_jitsi():
    for c in P.comodos:
        if c.tipo == "reuniao":
            assert _tipos(c.nome) == ["livekitRoomProperty"], c.nome

def test_um_unico_start_na_recepcao():
    starts = [a["name"] for a in WAM["areas"] for p in a["properties"] if p["type"] == "start"]
    assert starts == ["Recepção"]

def test_silenciosa_e_silent():
    assert _tipos("Silenciosa") == ["silent"]

def test_ids_unicos():
    ids = [a["id"] for a in WAM["areas"]] + [p["id"] for a in WAM["areas"] for p in a["properties"]]
    assert len(ids) == len(set(ids))

def test_placa_cabe_na_largura():
    fonte = ImageFont.load_default(size=9)
    d = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    for c in P.comodos:
        if c.placa:
            assert d.textlength(c.placa, font=fonte) <= 60, c.placa

def test_editor_tem_a_colecao_de_moveis():
    """Sem entityCollections o editor do navegador abre sem nada para arrastar."""
    urls = {c["url"] for c in WAM["entityCollections"]}
    assert any(u.endswith("/collections/FurnitureCollection.json") for u in urls)
    assert any(u.endswith("/collections/OfficeCollection.json") for u in urls)

def test_envio_preserva_objetos_postos_no_navegador():
    """O Erick decora pelo editor (objetos = `entities` do .wam). O gerador manda
    em paredes, salas e áreas; os objetos soltos são dele e sobrevivem ao envio."""
    import mesclar
    novo = {"areas": [{"id": "a"}], "entities": {}, "lastCommandId": "x"}
    no_ar = {"areas": [{"id": "velha"}], "entities": {"e1": {"x": 64, "y": 96}}, "lastCommandId": "y"}
    r = mesclar.mesclar(novo, no_ar)
    assert r["entities"] == {"e1": {"x": 64, "y": 96}}
    assert r["areas"] == [{"id": "a"}]            # áreas: sempre as do gerador
    assert mesclar.mesclar(novo, None)["entities"] == {}   # primeiro envio: nada no ar
