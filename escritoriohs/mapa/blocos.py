"""Catálogo dos blocos do map-starter-kit usados pelo gerador.

Os índices vieram do `office.tmj` oficial (lidos célula a célula em 15/10/2026)
e da folha WA_Room_Builder. ⚠️ O encaixe de parede (PAREDE) é a primeira
versão; a Task 5 confere cada máscara na prévia e corrige aqui.
"""
from PIL import Image
import os

_AQUI = os.path.dirname(os.path.abspath(__file__))
_ORDEM = ["WA_Special_Zones", "WA_Room_Builder", "WA_Decoration", "WA_Miscellaneous",
          "WA_Other_Furniture", "WA_Seats", "WA_Tables", "WA_Exterior", "WA_User_Interface"]

def _montar():
    lista, prox = [], 1
    for nome in _ORDEM:
        img = Image.open(os.path.join(_AQUI, "tilesets", f"{nome}.png"))
        col = img.width // 32
        total = col * (img.height // 32)
        lista.append((nome, prox, col, total))
        prox += total
    return lista

TILESETS = _montar()
_PRIMEIRO = {nome: f for nome, f, _, _ in TILESETS}

def gid(nome, indice):
    return _PRIMEIRO[nome] + indice

def de_gid(g):
    g &= 0x1FFFFFFF
    escolhido = None
    for nome, f, _, _ in TILESETS:
        if g >= f:
            escolhido = (nome, g - f)
    return escolhido

RB = lambda i: gid("WA_Room_Builder", i)  # noqa: E731

# Encaixe da parede pelo que há em volta: N=1, E=2, S=4, W=8.
PAREDE = {
    0: RB(106), 1: RB(56), 2: RB(58), 3: RB(50), 4: RB(31), 5: RB(102), 6: RB(25), 7: RB(108),
    8: RB(59), 9: RB(51), 10: RB(104), 11: RB(110), 12: RB(26), 13: RB(158), 14: RB(160), 15: RB(100),
}
FACE_ALTA, FACE_BAIXA = RB(203), RB(228)        # face branca com rodapé
FACE_ALTA_EXT, FACE_BAIXA_EXT = RB(310), RB(310)  # tijolo claro, parede externa norte
PISO = {"madeira": RB(350), "carpete": RB(360), "carpete_escuro": RB(362),
        "corredor": RB(383), "piso_claro": RB(358)}
COLISAO = gid("WA_Special_Zones", 2)
START = gid("WA_Special_Zones", 1)

T, S, M, O, D = (lambda i: gid("WA_Tables", i)), (lambda i: gid("WA_Seats", i)), \
    (lambda i: gid("WA_Miscellaneous", i)), (lambda i: gid("WA_Other_Furniture", i)), \
    (lambda i: gid("WA_Decoration", i))

# Carimbos: (dx, dy, camada, gid, colide). dx/dy relativos ao canto do
# interior caminhável da sala (abaixo das faces).
CARIMBOS = {
    "mesa_trabalho": [  # estação de UMA pessoa. Colunas dx 2–3 livres: é por onde a porta entra.
        # mesa 2×2 inteira (borda de cima + pés), à direita
        (4, 0, "moveis1", T(10), True), (5, 0, "moveis1", T(13), True),
        (4, 1, "moveis1", T(20), True), (5, 1, "moveis1", T(23), True),
        (4, 0, "moveis2", M(1), True),   # monitor
        (5, 0, "moveis2", M(74), True),  # livros
        (4, 1, "moveis2", M(13), True),  # teclado
        (5, 1, "moveis2", M(59), True),  # caneca
        (4, 2, "moveis1", S(117), False),  # cadeira de frente para a mesa
        (5, 2, "moveis1", M(60), True),    # lixeira
        # à esquerda: arquivo de gavetas e estante
        (0, 0, "moveis1", M(37), True), (1, 0, "moveis1", O(27), True),
        (0, 3, "moveis1", S(120), False),  # cadeira de visita
        (5, 3, "moveis1", D(91), True),    # planta grande
        # na parede (linha de face logo acima): quadrinho e relógio
        (4, -1, "placas", D(5), False), (5, -2, "placas", M(78), False),
    ],
    "mesa_diretor": [  # mesa grande de madeira 3×2, cadeira, monitores
        *[(x, y, "moveis1", T(200 + 10 * y + x), True) for x in range(3) for y in range(2)],
        (0, 0, "moveis2", M(25), True), (1, 0, "moveis2", M(24), True),
        (1, 2, "moveis1", S(119), False),
    ],
    "sofa": [(x, 0, "moveis1", S(13 + x), True) for x in range(3)],
    "sofa_azul": [(x, 0, "moveis1", S(16 + x), True) for x in range(3)],
    "pufes": [(2 * x, 0, "moveis1", S(176 + x), False) for x in range(4)],
    "balcao_cafe": [(0, 0, "moveis1", T(70), True), (0, 0, "moveis2", M(46), True),
                    (1, 0, "moveis1", T(70), True), (1, 0, "moveis2", M(67), True),
                    (2, 0, "moveis1", T(70), True)],
    "mesa_redonda": [(1, 0, "moveis1", T(141), True), (0, 0, "moveis1", S(164), False),
                     (2, 0, "moveis1", S(164), False)],
    "balcao_recepcao": [(0, 0, "moveis1", T(170), True), (1, 0, "moveis1", T(171), True),
                        (0, 1, "moveis1", T(180), True), (1, 1, "moveis1", T(181), True),
                        (0, 0, "moveis2", M(24), True)],
    "estante": [(0, 0, "moveis1", O(34), True), (1, 0, "moveis1", O(35), True),
                (0, -1, "acima", O(22), False), (1, -1, "acima", O(23), False)],
    "planta": [(0, 0, "moveis1", D(90), True)],
    "planta_alta": [(0, 0, "moveis1", D(91), True)],
    "banco": [(0, 0, "moveis1", S(143), True), (1, 0, "moveis1", S(144), True)],
    "maquina_cafe": [(0, 0, "moveis1", M(57), True), (1, 0, "moveis1", M(56), True)],
    "tv": [(x, -1, "placas", M(40 + x), False) for x in range(3)],       # na face da parede
    "quadro": [(0, -1, "placas", D(0), False), (1, -1, "placas", D(1), False)],
}
