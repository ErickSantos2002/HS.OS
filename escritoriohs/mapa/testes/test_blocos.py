"""Catálogo de blocos do kit oficial. Um gid fora da folha vira bloco vazio no
WA — sem erro, só um buraco no chão — então cada valor é conferido contra a
própria imagem."""
from PIL import Image
import blocos

def test_todo_gid_do_catalogo_existe_na_folha():
    usados = set(blocos.PAREDE.values()) | {blocos.FACE_ALTA, blocos.FACE_BAIXA, blocos.COLISAO, blocos.START}
    usados |= set(blocos.PISO.values())
    for carimbo in blocos.CARIMBOS.values():
        usados |= {g for (_, _, _, g, _) in carimbo}
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
