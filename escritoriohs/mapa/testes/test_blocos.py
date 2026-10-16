"""Catálogo de blocos do kit oficial. Um gid fora da folha vira bloco vazio no
WA — sem erro, só um buraco no chão — então cada valor é conferido contra a
própria imagem."""
from PIL import Image
import blocos

def test_todo_gid_do_catalogo_existe_na_folha():
    usados = set(blocos.PAREDE.values()) | {blocos.FACE_ALTA, blocos.FACE_BAIXA, blocos.COLISAO, blocos.START}
    usados |= set(blocos.PISO.values())
    for g in usados:
        nome, indice = blocos.de_gid(g)
        img = Image.open(f"tilesets/{nome}.png")
        assert indice < (img.width // 32) * (img.height // 32), (g, nome, indice)

def test_parede_tem_as_16_mascaras():
    assert sorted(blocos.PAREDE) == list(range(16))

def test_firstgid_bate_com_o_tamanho_das_folhas():
    esperado = 1
    for nome, firstgid, colunas, total in blocos.TILESETS:
        assert firstgid == esperado, nome
        img = Image.open(f"tilesets/{nome}.png")
        assert (colunas, total) == (img.width // 32, (img.width // 32) * (img.height // 32)), nome
        esperado += total

def test_nenhum_movel_e_bloco():
    """Móvel desenhado como bloco saía quebrado no WA (16/10/2026): TV cortada
    numa linha, cadeira que era só o pé, mesa emendada de duas peças da folha,
    e o Erick não conseguia mexer em nada pelo editor. Decisão dele: tudo que é
    móvel é objeto. Nenhum gid das folhas de móveis pode ir para o mapa."""
    import gerar, json, tempfile
    proibidas = {"WA_Tables", "WA_Seats", "WA_Miscellaneous", "WA_Other_Furniture", "WA_Decoration"}
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        m = json.load(open(f"{d}/hs.tmj"))
    def camadas(ls):
        for l in ls:
            yield from camadas(l["layers"]) if l.get("type") == "group" else [l]
    achados = {(l["name"], blocos.de_gid(g)[0]) for l in camadas(m["layers"])
               if l.get("type") == "tilelayer" for g in l["data"]
               if g and (g & 0x1FFFFFFF) < blocos.TILESETS[-1][1] + blocos.TILESETS[-1][3]
               and blocos.de_gid(g)[0] in proibidas}
    assert not achados, achados
