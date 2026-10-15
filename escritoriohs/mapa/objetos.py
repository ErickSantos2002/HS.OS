"""Peças da coleção do editor do WA usadas como OBJETOS (entities) no .wam.

Diferente dos blocos (blocos.py), objeto o Erick move e apaga pelo navegador.
As coleções são as que o próprio WA serve em /collections/ (cópia em
colecao/, com as imagens, para a prévia e para calcular a colisão).
"""
import json, os

_AQUI = os.path.dirname(os.path.abspath(__file__))
_COLECOES = {}
for _arq in ("basic-furniture.json", "basic-office.json"):
    _d = json.load(open(os.path.join(_AQUI, "colecao", _arq), encoding="utf-8"))
    _COLECOES[_d["collectionName"]] = _d["collection"]

URL_COLECOES = ["https://escritoriohs.healthsafetytech.com/collections/FurnitureCollection.json",
                "https://escritoriohs.healthsafetytech.com/collections/OfficeCollection.json"]

_F, _O = "basic furniture", "basic office decoration"
PECAS = {
    "mesa": (_F, "Basic Wood Table", "orange", "Down"),
    "mesinha": (_F, "Basic Small Table", "grey", "Down"),
    "cadeira_cima": (_F, "Basic Chair", "grey", "Up"),
    "cadeira": (_F, "Basic Chair", "grey", "Down"),
    "poltrona": (_F, "Armchair", "grey", "Down"),
    "poltrona_dir": (_F, "Armchair", "black", "Right"),
    "poltrona_esq": (_F, "Armchair", "black", "Left"),
    "sofa": (_F, "Couch", "grey", "Down"),
    "estante": (_F, "Shelf", "saddlebrown", "Down"),
    "estante_grande": (_F, "Big Shelf", "saddlebrown", "Down"),
    "estante_parede": (_F, "Mural Shelf", "saddlebrown", "Down"),
    "pufe": (_F, "Pouf", "brown", "Down"),
    "planta_grande": (_O, "Plant", "green", "Down"),
    "planta": (_O, "Small Plant", "green", "Down"),
    "planta_baixa": (_O, "Large Plant", "green", "Down"),
    "monitor": (_O, "Computer Screen", "black", "Down"),
    "notebook": (_O, "Laptop", "black", "Down"),
    "impressora": (_O, "Printer", "white", "Down"),
    "lixeira": (_O, "Bin", "grey", "Down"),
    "livros": (_O, "Books (Variant 1)", "black", "Down"),
    "canecas": (_O, "Mugs", "white", "Down"),
    "relogio": (_O, "Round Mural Clock", "white", "Down"),
    "cafeteira": (_O, "Coffee Dispenser", "black", "Down"),
    "pastas": (_O, "Folders", "black", "Down"),
}

def item(peca):
    colecao, nome, cor, direcao = PECAS[peca]
    for it in _COLECOES[colecao]:
        if (it["name"], it["color"], it["direction"]) == (nome, cor, direcao):
            return it
    raise KeyError(f"{peca}: {nome}/{cor}/{direcao} não está em {colecao}")

def prefab_id(peca):
    """Formato do WA: libs/map-editor/src/Migrations/EntitiesFileMigration.ts."""
    colecao, nome, cor, direcao = PECAS[peca]
    return f"{colecao}:{nome}:{cor}:{direcao}"

def caminho_imagem(peca):
    return os.path.join(_AQUI, "colecao", "imagens", item(peca)["imagePath"].replace("/", "__"))

def celulas_colisao(peca, x_px, y_px):
    """Blocos que a peça bloqueia, pela collisionGrid da coleção (1 = colide).
    Peça sem grade (cadeira, planta, pufe) não bloqueia — é como o WA faz."""
    grade = item(peca).get("collisionGrid") or []
    return {(x_px // 32 + i, y_px // 32 + j)
            for j, linha in enumerate(grade) for i, v in enumerate(linha) if v}
