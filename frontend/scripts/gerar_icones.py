"""Gera os ícones do app instalável (PWA) a partir do símbolo da HS.

Uso (Pillow num venv qualquer, nada global):

    python3 -m venv /tmp/venv-icones && /tmp/venv-icones/bin/pip install Pillow
    /tmp/venv-icones/bin/python frontend/scripts/gerar_icones.py

Fonte: `public/logo-hs-padrao.png`. O logo é símbolo (a figura com a cabeça e
as duas folhas) + o texto "H&S"; o ícone usa só o símbolo, porque o texto vira
borrão em 48px. O recorte é pela coluna transparente que separa os dois.

⚠️ O azul do símbolo é praticamente o fundo pedido (#1f89ca contra #1885c8).
Pintado como está, a metade azul some no ícone. Por isso o símbolo é
REDESENHADO em branco: o que era azul vira branco cheio e o que era cinza vira
branco translúcido, o que mantém a leitura de duas cores sem inventar uma
terceira.

Saída em `public/icons/`:

- icon-192.png, icon-512.png   purpose "any": símbolo em ~70% do quadro
- icon-maskable-512.png        purpose "maskable": símbolo dentro do círculo de
                               80% (a área segura da especificação), sem canto
                               transparente — o sistema recorta a forma
- apple-touch-icon.png         180×180, opaco (o iOS pinta transparência de preto)
- badge-96.png                 branco sobre transparente, para a barra de status
                               do Android, que usa só o canal alfa

e `scripts/previa-icones.png`, os quatro lado a lado (o maskable com a máscara
circular simulada), para aprovar o visual antes do merge.
"""

from pathlib import Path

from PIL import Image, ImageDraw

RAIZ = Path(__file__).resolve().parent.parent
ORIGEM = RAIZ / "public" / "logo-hs-padrao.png"
DESTINO = RAIZ / "public" / "icons"
PREVIA = RAIZ / "scripts" / "previa-icones.png"

FUNDO = (0x18, 0x85, 0xC8, 255)
BRANCO = (255, 255, 255)
# Opacidade do branco no lugar do cinza: sobre o azul dá um azul-claro que
# separa as folhas sem competir com a parte cheia.
ALFA_CINZA = 0.55


def recortar_simbolo(logo: Image.Image) -> Image.Image:
    """Recorta o símbolo: o primeiro trecho de colunas com pixel visível."""
    alfa = logo.getchannel("A")
    largura, altura = logo.size
    visivel = [alfa.crop((x, 0, x + 1, altura)).getbbox() is not None for x in range(largura)]
    inicio = visivel.index(True)
    fim = inicio
    # O símbolo acaba na primeira faixa larga (> 2% da largura) sem nada.
    folga = int(largura * 0.02)
    vazio = 0
    for x in range(inicio, largura):
        if visivel[x]:
            fim, vazio = x, 0
        else:
            vazio += 1
            if vazio > folga:
                break
    simbolo = logo.crop((inicio, 0, fim + 1, altura))
    return simbolo.crop(simbolo.getbbox())


def em_branco(simbolo: Image.Image, duas_cores: bool) -> Image.Image:
    """Redesenha o símbolo em branco. Azul → cheio; cinza → translúcido."""
    rgba = simbolo.convert("RGBA")
    saida = Image.new("RGBA", rgba.size, (0, 0, 0, 0))
    px_in = rgba.load()
    px_out = saida.load()
    for y in range(rgba.height):
        for x in range(rgba.width):
            r, g, b, a = px_in[x, y]
            if a == 0:
                continue
            azul = (b - r) > 40
            fator = 1.0 if (azul or not duas_cores) else ALFA_CINZA
            px_out[x, y] = (*BRANCO, int(a * fator))
    return saida


def compor(simbolo: Image.Image, lado: int, ocupacao: float, fundo) -> Image.Image:
    """Centraliza o símbolo num quadro `lado`×`lado`, com a maior dimensão em `ocupacao`."""
    quadro = Image.new("RGBA", (lado, lado), fundo)
    escala = (lado * ocupacao) / max(simbolo.size)
    tamanho = (round(simbolo.width * escala), round(simbolo.height * escala))
    reduzido = simbolo.resize(tamanho, Image.LANCZOS)
    pos = ((lado - tamanho[0]) // 2, (lado - tamanho[1]) // 2)
    quadro.alpha_composite(reduzido, pos)
    return quadro


def mascara_circular(icone: Image.Image) -> Image.Image:
    """Simula o recorte do Android (círculo inscrito) para a prévia."""
    mascara = Image.new("L", icone.size, 0)
    ImageDraw.Draw(mascara).ellipse((0, 0, icone.width - 1, icone.height - 1), fill=255)
    recortado = Image.new("RGBA", icone.size, (0, 0, 0, 0))
    recortado.paste(icone, (0, 0), mascara)
    return recortado


def previa(itens: list[tuple[str, Image.Image]]) -> Image.Image:
    lado, margem = 200, 24
    largura = margem + len(itens) * (lado + margem)
    tela = Image.new("RGBA", (largura, lado + 2 * margem + 30), (40, 40, 40, 255))
    d = ImageDraw.Draw(tela)
    for i, (rotulo, img) in enumerate(itens):
        x = margem + i * (lado + margem)
        # Badge é branco sobre transparente: sem fundo escuro ele some.
        tela.alpha_composite(img.resize((lado, lado), Image.LANCZOS) if img.width != lado else img, (x, margem))
        # A fonte embutida do Pillow não tem acento: rótulos em ASCII.
        d.text((x, margem + lado + 8), rotulo, fill=(230, 230, 230, 255))
    return tela


def main() -> None:
    DESTINO.mkdir(parents=True, exist_ok=True)
    simbolo = recortar_simbolo(Image.open(ORIGEM).convert("RGBA"))
    duas = em_branco(simbolo, duas_cores=True)
    mono = em_branco(simbolo, duas_cores=False)

    icones = {
        "icon-192.png": compor(duas, 192, 0.70, FUNDO),
        "icon-512.png": compor(duas, 512, 0.70, FUNDO),
        # 0.56 da altura cabe no círculo de 80%: o símbolo é mais alto que
        # largo, e a diagonal do retângulo dele tem que ficar dentro do raio.
        "icon-maskable-512.png": compor(duas, 512, 0.56, FUNDO),
        "apple-touch-icon.png": compor(duas, 180, 0.66, FUNDO),
        "badge-96.png": compor(mono, 96, 0.80, (0, 0, 0, 0)),
    }
    for nome, img in icones.items():
        if nome == "apple-touch-icon.png":
            img = img.convert("RGB")
        img.save(DESTINO / nome, optimize=True)
        print(f"gerado {DESTINO / nome} {img.size}")

    previa(
        [
            ("any 192", icones["icon-192.png"]),
            ("maskable (circulo)", mascara_circular(icones["icon-maskable-512.png"])),
            ("iOS 180", icones["apple-touch-icon.png"].convert("RGBA")),
            ("badge 96", icones["badge-96.png"]),
        ]
    ).convert("RGB").save(PREVIA, optimize=True)
    print(f"prévia {PREVIA}")


if __name__ == "__main__":
    main()
