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

def test_areas_comuns_cobrem_so_o_interior():
    for c in P.comodos:
        if c.nome not in AREAS or c.tipo in modelo.TEM_DONO:
            continue
        a = AREAS[c.nome]
        x1, y1, x2, y2 = c.interior()
        assert (a["x"], a["y"]) == (x1 * 32, y1 * 32), c.nome
        assert (a["width"], a["height"]) == ((x2 - x1 + 1) * 32, (y2 - y1 + 1) * 32), c.nome

def test_area_pessoal_cobre_o_comodo_com_as_paredes():
    """Com a área só no interior, móvel encostado na parede tinha a imagem
    passando da borda e o WA recusava ao dono (20/10/2026: o pessoal não
    conseguia montar a própria sala; o Erick alargou a do Welton à mão). A
    borda extra tem que ser só parede: um bloco a mais e a tranca fecharia o
    corredor."""
    g = gerar.grade(P)
    for c in P.comodos:
        if c.tipo not in modelo.TEM_DONO:
            continue
        a = AREAS[c.nome]
        assert (a["x"], a["y"], a["width"], a["height"]) == \
            (c.x * 32, c.y * 32, c.w * 32, c.h * 32), c.nome
        borda = {(x, y) for x in range(c.x, c.x + c.w) for y in range(c.y, c.y + c.h)
                 if not (c.x < x < c.x + c.w - 1 and c.y < y < c.y + c.h - 1)}
        assert borda <= g["parede"] | g["porta"], c.nome

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
    fonte = gerar.fonte_da_placa()
    d = ImageDraw.Draw(Image.new("RGBA", (1, 1)))
    for c in P.comodos:
        if c.placa:
            assert d.textlength(c.placa, font=fonte) <= 60, c.placa

def test_editor_tem_a_colecao_de_moveis():
    """Sem entityCollections o editor do navegador abre sem nada para arrastar."""
    urls = {c["url"] for c in WAM["entityCollections"]}
    assert any(u.endswith("/collections/FurnitureCollection.json") for u in urls)
    assert any(u.endswith("/collections/OfficeCollection.json") for u in urls)

def test_placa_tem_os_acentos():
    """Com a fonte embutida do Pillow, toda letra acentuada saía como o mesmo
    quadrado (.notdef) — no ar, em Expedição, Cláudia e André. Letras
    diferentes têm que desenhar diferente."""
    fonte = gerar.fonte_da_placa()
    def desenho(letra):
        img = Image.new("L", (16, 16))
        ImageDraw.Draw(img).text((2, 2), letra, font=fonte, fill=255)
        return img.tobytes()
    desenhos = [desenho(c) for c in "çáéãõ"]
    assert len(set(desenhos)) == len(desenhos)
