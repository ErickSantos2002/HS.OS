# EscritorioHS — mapa próprio da HS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar por código, a partir da planta que o Erick desenhou, o mapa `hs` do EscritorioHS (28 salas individuais com porta trancável, 2 salas de reunião LiveKit, recepção, café, silenciosa, Diretoria), aprová-lo por prévia em PNG e colocá-lo como sala de entrada.

**Architecture:** `planta.json` descreve cômodos em blocos de 32 px. `gerar.py` transforma a planta em `hs.tmj` (camadas de blocos do kit oficial: piso, paredes com encaixe automático, faces, móveis, placas, colisão) e `hs.wam` (áreas: start, LiveKit, silent, lockable, personal). `previa.py` desenha o `.tmj` em PNG. `enviar.sh` empacota e envia ao `map-storage` por `POST /map-storage/upload`, em diretório próprio (`hs/`), sem tocar no `office`.

**Tech Stack:** Python 3 (stdlib + Pillow 12), pytest, tilesets `WA_*` do map-starter-kit (commit `1143646`, CC-BY-SA 3.0), curl.

**Spec:** `docs/superpowers/specs/2026-10-15-escritoriohs-mapa-design.md`

## Global Constraints

- 1 bloco = 32 px. Mapa: **73 × 69** blocos.
- Sala individual: **8 × 8 blocos externos**, parede compartilhada com a vizinha (passo 7), porta de **2 blocos** centrada no lado indicado.
- As faces de parede (2 blocos de altura) ficam **abaixo de toda parede com piso logo ao sul**, exceto nas colunas de porta.
- Nomes das 28 salas: Financeiro 01–02, RH, Suporte 01–03, TI 01–03, Lab 01–03, Qualidade 01–02, Expedição 01–02, Comercial 01–12. "Suporte 03" e "Lab 03" são as vagas do desenho.
- Placa = texto "Setor NN" (ou "RH"); trocar por nome de pessoa é editar `planta.json`.
- Áreas no `.wam` (formato `libs/map-editor/src/types.ts` do WA, versão do arquivo `2.1.0`): `start`, `livekitRoomProperty`, `silent`, `lockableAreaPropertyData` (sem `allowedTags`), `personalAreaPropertyData` (`accessClaimMode: "static"`, `ownerId: null`).
- Envio para o diretório **`hs`**, nunca `/` (apaga os outros `.wam`). Entrada final: `START_ROOM_URL=/~/hs/hs.wam`.
- Determinístico: mesma planta → mesmos bytes (JSON com `sort_keys`, ids derivados do nome, sem `uuid4`/hora).
- Código, comentários e mensagens em português. Python roda com `python3` do sistema (Pillow já instalado: 12.3.0).
- Segredo nenhum no repo (é público). O token do `map-storage` é lido de `~/escritoriohs.env` por `enviar.sh`, sem imprimir.
- Ação em produção (envio, EasyPanel) é confirmada com o Erick antes.

## Review Focus

1. **Sala com porta virada para a parede ou para outra sala** — a pessoa nasce e não consegue entrar na própria sala. Teste: `test_toda_sala_alcancavel_a_partir_da_recepcao` (Task 3) e `test_porta_abre_para_area_livre` (Task 2).
2. **Área trancável maior que a sala** — trancar a própria sala bloquearia o corredor. Teste: `test_areas_cobrem_so_o_interior` (Task 4).
3. **Envio sobrescrevendo o `office`** — diretório `/` apaga os outros mapas. Teste: `test_enviar_usa_diretorio_hs` (Task 6, estático sobre o `enviar.sh`).
4. **Placa ilegível ou cortada** — nome longo ("Expedição 02") não cabe em 2 blocos. Teste: `test_placa_cabe_na_largura` (Task 4).
5. **Mesa encostada bloqueando a porta** — móvel na frente da porta prende a pessoa fora. Coberto pelo teste de alcance (Task 3), que considera colisão dos móveis.

---

## Estrutura de arquivos

```
escritoriohs/mapa/
  README.md            como mudar a planta, gerar, ver a prévia e enviar
  planta.json          a planta em blocos (Task 2)
  modelo.py            carrega e valida a planta (Task 2)
  blocos.py            catálogo de blocos: gids, encaixe de parede, carimbos de móveis (Task 1)
  gerar.py             planta → saida/hs.tmj + saida/hs.wam + saida/placas.png (Tasks 3–4)
  previa.py            .tmj → PNG (Task 1)
  enviar.sh            zip + POST /map-storage/upload (Task 6)
  tilesets/            WA_*.png do kit + LICENSE.assets + logo-hs.png (Task 1)
  saida/               gerado; versionado (é o que vai ao ar)
  testes/test_*.py     pytest
```

---

### Task 1: Tilesets, catálogo de blocos e prévia

**Files:**
- Create: `escritoriohs/mapa/tilesets/` (cópia de `tilesets/*.png` e `LICENSE.assets` do map-starter-kit, commit `1143646`)
- Create: `escritoriohs/mapa/blocos.py`, `escritoriohs/mapa/previa.py`, `escritoriohs/mapa/testes/test_blocos.py`

**Interfaces:**
- Produces: `blocos.TILESETS` (lista ordenada de `(nome, firstgid, colunas, total)`), `blocos.gid(nome_tileset, indice) -> int`, `blocos.PAREDE[mascara] -> gid` (máscara N=1,E=2,S=4,W=8), `blocos.FACE_ALTA`, `blocos.FACE_BAIXA`, `blocos.PISO[tipo] -> gid`, `blocos.COLISAO`, `blocos.START`, `blocos.CARIMBOS[nome] -> list[(dx, dy, camada, gid, colide)]`; `previa.desenhar(caminho_tmj, caminho_png)`.

- [ ] **Step 0: Branch**

```bash
cd ~/github/HS.OS && git checkout main && git pull -q && git checkout -b escritoriohs-mapa
```

- [ ] **Step 1: Copiar os tilesets**

```bash
mkdir -p escritoriohs/mapa/tilesets escritoriohs/mapa/testes escritoriohs/mapa/saida
d=$(mktemp -d) && git clone -q https://github.com/workadventure/map-starter-kit.git $d && git -C $d checkout -q 1143646 \
  && cp $d/tilesets/WA_*.png $d/LICENSE.assets escritoriohs/mapa/tilesets/ && rm -rf $d && ls escritoriohs/mapa/tilesets
```

Expected: os 10 `WA_*.png` e `LICENSE.assets`.

- [ ] **Step 2: Teste do catálogo (falha: `blocos` não existe)**

`escritoriohs/mapa/testes/test_blocos.py`:

```python
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
```

Run: `cd escritoriohs/mapa && python3 -m pytest testes/test_blocos.py -q` → FAIL (`No module named 'blocos'`).

- [ ] **Step 3: `escritoriohs/mapa/blocos.py`**

```python
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
        "corredor": RB(355), "piso_claro": RB(358)}
COLISAO = gid("WA_Special_Zones", 2)
START = gid("WA_Special_Zones", 1)

T, S, M, O, D = (lambda i: gid("WA_Tables", i)), (lambda i: gid("WA_Seats", i)), \
    (lambda i: gid("WA_Miscellaneous", i)), (lambda i: gid("WA_Other_Furniture", i)), \
    (lambda i: gid("WA_Decoration", i))

# Carimbos: (dx, dy, camada, gid, colide). dx/dy relativos ao canto do
# interior caminhável da sala (abaixo das faces).
CARIMBOS = {
    "mesa_trabalho": [  # mesa com computador, cadeira de frente e cadeira de visita
        (1, 0, "moveis1", T(12), True), (2, 0, "moveis1", T(12), True),
        (1, 0, "moveis2", M(25), True), (2, 0, "moveis2", M(24), True),
        (1, 1, "moveis1", S(119), False),
        (4, 2, "moveis1", S(120), False),
        (0, 0, "acima", O(20), True),
    ],
    "mesa_reuniao": [  # mesa longa 4×2 com cadeiras em volta
        *[(x, 1, "moveis1", T(10 if x == 0 else 13 if x == 3 else 11), True) for x in range(4)],
        *[(x, 2, "moveis1", T(20 if x == 0 else 23 if x == 3 else 21), True) for x in range(4)],
        *[(x, 0, "moveis1", S(134), False) for x in range(4)],
        *[(x, 3, "moveis1", S(150), False) for x in range(4)],
    ],
    "sofa": [(x, 0, "moveis1", S(13 + x), True) for x in range(3)],
    "balcao_cafe": [(0, 0, "moveis1", T(70), True), (0, 0, "moveis2", M(46), True),
                    (1, 0, "moveis1", T(70), True)],
    "planta": [(0, 0, "moveis1", O(20), True), (0, -1, "acima", D(67), False)],
}
```

- [ ] **Step 4: `escritoriohs/mapa/previa.py`**

```python
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
    if escala != 1.0:
        out = out.resize((int(out.width * escala), int(out.height * escala)), Image.NEAREST)
    out.save(caminho_png)

if __name__ == "__main__":
    desenhar(sys.argv[1], sys.argv[2], float(sys.argv[3]) if len(sys.argv) > 3 else 1.0)
```

- [ ] **Step 5: Teste passa**

Run: `cd escritoriohs/mapa && python3 -m pytest testes/test_blocos.py -q` → 3 passed. (Se `test_todo_gid_do_catalogo_existe_na_folha` acusar índice, o carimbo errado é corrigido aqui — o teste diz qual.)

- [ ] **Step 6: Commit**

```bash
git add escritoriohs/mapa && git commit -m "feat(escritoriohs/mapa): tilesets do kit, catálogo de blocos e prévia"
```

---

### Task 2: A planta em blocos e a validação

**Files:**
- Create: `escritoriohs/mapa/planta.json`, `escritoriohs/mapa/modelo.py`, `escritoriohs/mapa/testes/test_planta.py`

**Interfaces:**
- Produces: `modelo.carregar(caminho) -> Planta`; `Planta(largura, altura, comodos: list[Comodo])`; `Comodo(nome, tipo, x, y, w, h, porta: "N"|"S"|"E"|"W"|None, placa: str|None)` com `.interior()` → `(x1, y1, x2, y2)` inclusivo e `.celulas_porta()` → lista de `(x, y)` das 2 células da porta na parede. Tipos: `sala`, `reuniao`, `diretoria`, `recepcao`, `cafe`, `silenciosa`.

- [ ] **Step 1: `escritoriohs/mapa/planta.json`**

Grade regular (ver Global Constraints). Paredes compartilhadas: salas vizinhas se sobrepõem exatamente na linha/coluna da parede. A parede externa do mapa é a linha 0, a coluna 0, a linha 68 e a coluna 72.

```json
{
  "largura": 73,
  "altura": 69,
  "comodos": [
    {"nome": "Café",         "tipo": "cafe",       "x": 0,  "y": 0,  "w": 21, "h": 14, "porta": "S"},
    {"nome": "Recepção",     "tipo": "recepcao",   "x": 20, "y": 0,  "w": 32, "h": 14, "porta": null},
    {"nome": "Reunião 02",   "tipo": "reuniao",    "x": 51, "y": 0,  "w": 12, "h": 14, "porta": "S"},
    {"nome": "Silenciosa",   "tipo": "silenciosa", "x": 62, "y": 0,  "w": 11, "h": 14, "porta": "S"},

    {"nome": "Reunião 01",   "tipo": "reuniao",    "x": 0,  "y": 18, "w": 22, "h": 13, "porta": "N"},
    {"nome": "Financeiro 02","tipo": "sala",       "x": 21, "y": 18, "w": 8,  "h": 8,  "porta": "N", "placa": "Financeiro 02"},
    {"nome": "RH",           "tipo": "sala",       "x": 28, "y": 18, "w": 8,  "h": 8,  "porta": "N", "placa": "RH"},
    {"nome": "Financeiro 01","tipo": "sala",       "x": 28, "y": 25, "w": 8,  "h": 8,  "porta": "W", "placa": "Financeiro 01"},

    {"nome": "Suporte 01",   "tipo": "sala",       "x": 0,  "y": 30, "w": 8,  "h": 8,  "porta": "S", "placa": "Suporte 01"},
    {"nome": "Suporte 02",   "tipo": "sala",       "x": 7,  "y": 30, "w": 8,  "h": 8,  "porta": "S", "placa": "Suporte 02"},
    {"nome": "Suporte 03",   "tipo": "sala",       "x": 14, "y": 30, "w": 8,  "h": 8,  "porta": "S", "placa": "Suporte 03"},

    {"nome": "TI 01",        "tipo": "sala",       "x": 0,  "y": 43, "w": 8,  "h": 8,  "porta": "N", "placa": "TI 01"},
    {"nome": "TI 02",        "tipo": "sala",       "x": 7,  "y": 43, "w": 8,  "h": 8,  "porta": "N", "placa": "TI 02"},
    {"nome": "TI 03",        "tipo": "sala",       "x": 14, "y": 43, "w": 8,  "h": 8,  "porta": "N", "placa": "TI 03"},

    {"nome": "Lab 01",       "tipo": "sala",       "x": 0,  "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Lab 01"},
    {"nome": "Lab 02",       "tipo": "sala",       "x": 7,  "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Lab 02"},
    {"nome": "Lab 03",       "tipo": "sala",       "x": 14, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Lab 03"},
    {"nome": "Qualidade 01", "tipo": "sala",       "x": 21, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Qualidade 01"},
    {"nome": "Qualidade 02", "tipo": "sala",       "x": 28, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Qualidade 02"},
    {"nome": "Expedição 01", "tipo": "sala",       "x": 36, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Expedição 01"},
    {"nome": "Expedição 02", "tipo": "sala",       "x": 43, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Expedição 02"},

    {"nome": "Comercial 01", "tipo": "sala",       "x": 51, "y": 18, "w": 8,  "h": 8,  "porta": "S", "placa": "Comercial 01"},
    {"nome": "Comercial 02", "tipo": "sala",       "x": 58, "y": 18, "w": 8,  "h": 8,  "porta": "S", "placa": "Comercial 02"},
    {"nome": "Comercial 03", "tipo": "sala",       "x": 65, "y": 18, "w": 8,  "h": 8,  "porta": "S", "placa": "Comercial 03"},
    {"nome": "Comercial 04", "tipo": "sala",       "x": 51, "y": 30, "w": 8,  "h": 8,  "porta": "N", "placa": "Comercial 04"},
    {"nome": "Comercial 05", "tipo": "sala",       "x": 58, "y": 30, "w": 8,  "h": 8,  "porta": "N", "placa": "Comercial 05"},
    {"nome": "Comercial 06", "tipo": "sala",       "x": 65, "y": 30, "w": 8,  "h": 8,  "porta": "N", "placa": "Comercial 06"},
    {"nome": "Diretoria",    "tipo": "diretoria",  "x": 51, "y": 37, "w": 22, "h": 12, "porta": "W", "placa": "Diretoria"},
    {"nome": "Comercial 07", "tipo": "sala",       "x": 51, "y": 48, "w": 8,  "h": 8,  "porta": "S", "placa": "Comercial 07"},
    {"nome": "Comercial 08", "tipo": "sala",       "x": 58, "y": 48, "w": 8,  "h": 8,  "porta": "S", "placa": "Comercial 08"},
    {"nome": "Comercial 09", "tipo": "sala",       "x": 65, "y": 48, "w": 8,  "h": 8,  "porta": "S", "placa": "Comercial 09"},
    {"nome": "Comercial 10", "tipo": "sala",       "x": 51, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Comercial 10"},
    {"nome": "Comercial 11", "tipo": "sala",       "x": 58, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Comercial 11"},
    {"nome": "Comercial 12", "tipo": "sala",       "x": 65, "y": 61, "w": 8,  "h": 8,  "porta": "N", "placa": "Comercial 12"}
  ]
}
```

Corredores não são cômodos: todo bloco do interior do mapa fora de cômodo é piso de corredor caminhável (y 14–17 em toda a largura; o corredor central x 36–50; o da esquerda x 22–35 de y 33 a 60; os horizontais entre fileiras).

- [ ] **Step 2: Testes da planta (falham: `modelo` não existe)**

`escritoriohs/mapa/testes/test_planta.py`:

```python
"""A planta é a fonte da verdade do mapa: cada erro aqui vira, lá no jogo,
uma pessoa que não acha a sala ou não consegue entrar nela."""
import modelo

P = modelo.carregar("planta.json")
SALAS = {"Financeiro 01", "Financeiro 02", "RH", "Suporte 01", "Suporte 02", "Suporte 03",
         "TI 01", "TI 02", "TI 03", "Lab 01", "Lab 02", "Lab 03", "Qualidade 01", "Qualidade 02",
         "Expedição 01", "Expedição 02", *{f"Comercial {i:02d}" for i in range(1, 13)}}

def test_as_28_salas_da_spec_estao_la():
    assert {c.nome for c in P.comodos if c.tipo == "sala"} == SALAS

def test_tudo_cabe_no_mapa():
    for c in P.comodos:
        assert c.x >= 0 and c.y >= 0 and c.x + c.w <= P.largura and c.y + c.h <= P.altura, c.nome

def test_interiores_nao_se_sobrepoem():
    """Paredes podem ser compartilhadas; o interior, nunca."""
    ocupado = {}
    for c in P.comodos:
        x1, y1, x2, y2 = c.interior()
        for x in range(x1, x2 + 1):
            for y in range(y1, y2 + 1):
                assert (x, y) not in ocupado, (c.nome, ocupado.get((x, y)))
                ocupado[(x, y)] = c.nome

def test_porta_abre_para_area_livre():
    """A célula do lado de fora da porta não pode ser interior nem parede de
    outro cômodo — senão a porta dá para a parede do vizinho."""
    for c in P.comodos:
        if not c.porta:
            continue
        for (x, y) in c.celulas_porta():
            dx, dy = {"N": (0, -1), "S": (0, 1), "W": (-1, 0), "E": (1, 0)}[c.porta]
            fora = (x + dx, y + dy)
            for outro in P.comodos:
                if outro is c:
                    continue
                assert not outro.contem(*fora), (c.nome, "porta dá para", outro.nome)

def test_placas_unicas_e_so_em_comodo_com_placa():
    placas = [c.placa for c in P.comodos if c.placa]
    assert len(placas) == len(set(placas))
    assert all(c.placa for c in P.comodos if c.tipo == "sala")
```

Run: `cd escritoriohs/mapa && python3 -m pytest testes/test_planta.py -q` → FAIL (`No module named 'modelo'`).

- [ ] **Step 3: `escritoriohs/mapa/modelo.py`**

```python
"""Planta do mapa: cômodos em blocos de 32 px, com paredes por fora e porta."""
import json
from dataclasses import dataclass

@dataclass(frozen=True)
class Comodo:
    nome: str
    tipo: str
    x: int
    y: int
    w: int
    h: int
    porta: str | None = None
    placa: str | None = None

    def interior(self):
        return (self.x + 1, self.y + 1, self.x + self.w - 2, self.y + self.h - 2)

    def contem(self, x, y):
        """Paredes inclusive."""
        return self.x <= x < self.x + self.w and self.y <= y < self.y + self.h

    def celulas_porta(self):
        if not self.porta:
            return []
        if self.porta in ("N", "S"):
            y = self.y if self.porta == "N" else self.y + self.h - 1
            meio = self.x + self.w // 2
            return [(meio - 1, y), (meio, y)]
        x = self.x if self.porta == "W" else self.x + self.w - 1
        meio = self.y + self.h // 2
        return [(x, meio), (x, meio + 1)]

@dataclass(frozen=True)
class Planta:
    largura: int
    altura: int
    comodos: tuple

def carregar(caminho):
    d = json.load(open(caminho, encoding="utf-8"))
    return Planta(d["largura"], d["altura"], tuple(Comodo(**c) for c in d["comodos"]))
```

- [ ] **Step 4: Testes passam**

Run: `cd escritoriohs/mapa && python3 -m pytest testes/ -q` → 8 passed. Se `test_porta_abre_para_area_livre` ou `test_interiores_nao_se_sobrepoem` falhar, o erro está na `planta.json` (coordenada), não no teste: corrigir a planta mantendo a disposição do desenho e registrar a correção.

- [ ] **Step 5: Commit**

```bash
git add escritoriohs/mapa && git commit -m "feat(escritoriohs/mapa): planta em blocos e validação"
```

---

### Task 3: Gerador — piso, paredes, portas, colisão (o esqueleto caminhável)

**Files:**
- Create: `escritoriohs/mapa/gerar.py`, `escritoriohs/mapa/testes/test_gerar.py`

**Interfaces:**
- Consumes: `modelo.carregar`, `blocos.*`.
- Produces: `gerar.grade(planta) -> dict` com `parede: set[(x,y)]`, `porta: set[(x,y)]`, `bloqueado: set[(x,y)]` (paredes + móveis que colidem); `gerar.gerar(caminho_planta, pasta_saida)` escreve `hs.tmj`, `hs.wam`, `placas.png`. Camadas do `.tmj`: `inicio`, `colisao`, grupo `piso` (`piso1`), grupo `paredes` (`paredes1`, `paredes2`), grupo `moveis` (`moveis1`, `moveis2`, `placas`), `floorLayer` (objectgroup vazio — o WA exige), grupo `acima` (`acima`).

- [ ] **Step 1: Testes (falham: `gerar` não existe)**

`escritoriohs/mapa/testes/test_gerar.py`:

```python
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
                           for f in ("hs.tmj", "hs.wam", "placas.png")])
    assert hashes[0] == hashes[1]

def test_tmj_tem_as_dimensoes_e_camadas():
    with tempfile.TemporaryDirectory() as d:
        gerar.gerar("planta.json", d)
        m = json.load(open(os.path.join(d, "hs.tmj")))
    assert (m["width"], m["height"], m["tilewidth"]) == (P.largura, P.altura, 32)
    nomes = [l["name"] for l in m["layers"]]
    assert nomes == ["inicio", "colisao", "piso", "paredes", "moveis", "floorLayer", "acima"]
```

Run: `cd escritoriohs/mapa && python3 -m pytest testes/test_gerar.py -q` → FAIL (`No module named 'gerar'`).

- [ ] **Step 2: `escritoriohs/mapa/gerar.py` (esqueleto + móveis + áreas)**

```python
"""planta.json → saida/hs.tmj (blocos) + saida/hs.wam (áreas) + saida/placas.png.

Uso: python3 gerar.py [planta.json] [saida]
⚠️ O gerador é a fonte da verdade do mapa: edição feita no editor do
navegador some no próximo envio.
"""
import hashlib, json, os, sys
from PIL import Image, ImageDraw, ImageFont
import blocos, modelo

TIPO_PISO = {"sala": "madeira", "reuniao": "carpete", "diretoria": "carpete_escuro",
             "recepcao": "piso_claro", "cafe": "madeira", "silenciosa": "carpete"}
MOVEIS_POR_TIPO = {"sala": ["mesa_trabalho"], "diretoria": ["mesa_trabalho", "sofa"],
                   "reuniao": ["mesa_reuniao"], "cafe": ["balcao_cafe", "sofa", "planta"],
                   "silenciosa": ["sofa", "planta"], "recepcao": ["sofa", "planta"]}

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
        for nome in MOVEIS_POR_TIPO[c.tipo]:
            ox, oy = _origem(nome, c, (x1, y1, x2, y2))
            for dx, dy, _, _, colide in blocos.CARIMBOS[nome]:
                if colide:
                    bloqueado.add((ox + dx, oy + dy))
    # face de parede: 2 blocos abaixo de parede com piso logo ao sul — também colide
    for (x, y) in sorted(parede):
        if (x, y + 1) not in parede and y + 1 < H:
            bloqueado |= {(x, y + 1), (x, y + 2)} - porta
    return {"parede": parede, "porta": porta, "bloqueado": bloqueado}

def _origem(nome, c, area):
    """Onde cada carimbo cai dentro do interior caminhável de cada tipo."""
    x1, y1, x2, y2 = area
    return {"mesa_trabalho": (x1, y1), "sofa": (x2 - 3, y2), "planta": (x1, y2),
            "balcao_cafe": (x1, y1), "mesa_reuniao": ((x1 + x2) // 2 - 2, (y1 + y2) // 2 - 2)}[nome]

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
    for (x, y) in g["bloqueado"]:
        pôr("colisao", x, y, blocos.COLISAO)

    for c in P.comodos:
        area = _interior_caminhavel(c, g["parede"])
        for nome in MOVEIS_POR_TIPO[c.tipo]:
            ox, oy = _origem(nome, c, area)
            for dx, dy, camada, gid_, _ in blocos.CARIMBOS[nome]:
                pôr(camada, ox + dx, oy + dy, gid_)

    nomes = _placas(P, pasta)
    primeiro_placa = blocos.TILESETS[-1][1] + blocos.TILESETS[-1][3]
    for c in P.comodos:
        if c.placa:
            i = nomes.index(c.placa)
            x1, y1, _, _ = c.interior()
            pôr("placas", x1 + 1, y1, primeiro_placa + 2 * i)
            pôr("placas", x1 + 2, y1, primeiro_placa + 2 * i + 1)

    rec = next(c for c in P.comodos if c.tipo == "recepcao")
    rx1, ry1, rx2, ry2 = rec.interior()
    pôr("inicio", (rx1 + rx2) // 2, ry2, blocos.START)

    def camada(nome, rotulo=None):
        return {"type": "tilelayer", "name": rotulo or nome, "width": W, "height": H,
                "x": 0, "y": 0, "opacity": 1, "visible": True, "data": cam[nome]}
    def grupo(nome, filhos):
        return {"type": "group", "name": nome, "opacity": 1, "visible": True, "layers": filhos}

    tilesets = [{"firstgid": f, "name": n, "image": f"tilesets/{n}.png", "columns": col,
                 "tilecount": tot, "tilewidth": 32, "tileheight": 32, "margin": 0, "spacing": 0,
                 "imagewidth": col * 32, "imageheight": (tot // col) * 32,
                 "properties": [{"name": "tilesetCopyright", "type": "string",
                                 "value": "WorkAdventure map-starter-kit — CC-BY-SA 3.0"}]}
                for n, f, col, tot in blocos.TILESETS]
    tilesets.append({"firstgid": primeiro_placa, "name": "placas_hs", "image": "placas.png",
                     "columns": 2, "tilecount": 2 * len(nomes), "tilewidth": 32, "tileheight": 32,
                     "margin": 0, "spacing": 0, "imagewidth": 64, "imageheight": 32 * len(nomes)})
    tmj = {"type": "map", "orientation": "orthogonal", "renderorder": "right-down",
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
                       "visible": True, "draworder": "topdown"},
                      grupo("acima", [camada("acima")])]}
    for i, l in enumerate(tmj["layers"]):
        l["id"] = i + 1
    json.dump(tmj, open(os.path.join(pasta, "hs.tmj"), "w"), sort_keys=True, ensure_ascii=False)
    json.dump(_wam(P), open(os.path.join(pasta, "hs.wam"), "w"), sort_keys=True, ensure_ascii=False, indent=1)

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
    return {"version": "2.1.0", "mapUrl": "./hs.tmj", "entities": {}, "areas": areas,
            "entityCollections": [], "lastCommandId": _id("cmd", "inicial"),
            "metadata": {"name": "EscritorioHS", "description": "Escritório virtual da Health & Safety",
                         "copyright": "Blocos: WorkAdventure (CC-BY-SA 3.0). Planta: Health & Safety."}}

if __name__ == "__main__":
    gerar(*(sys.argv[1:3] or ["planta.json", "saida"]))
```

- [ ] **Step 3: Testes passam**

Run: `cd escritoriohs/mapa && python3 -m pytest testes/ -q` → 13 passed.
Se `test_toda_sala_alcancavel_a_partir_da_recepcao` falhar para uma sala, ver o motivo antes de mexer: porta encostada em face de parede do vizinho, ou carimbo sobre a porta. Corrigir no carimbo/origem, nunca afrouxar o teste.

- [ ] **Step 4: Commit**

```bash
git add escritoriohs/mapa && git commit -m "feat(escritoriohs/mapa): gerador de blocos, colisão, placas e áreas"
```

---

### Task 4: Áreas e placas — os testes do comportamento

**Files:**
- Create: `escritoriohs/mapa/testes/test_areas.py`

**Interfaces:**
- Consumes: `gerar.gerar`, `gerar._placas`, `modelo`.

- [ ] **Step 1: Testes**

`escritoriohs/mapa/testes/test_areas.py`:

```python
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
```

- [ ] **Step 2: Rodar**

Run: `cd escritoriohs/mapa && python3 -m pytest testes/ -q` → 20 passed. (Os testes desta task exercitam o `_wam` e o `_placas` da Task 3; se algum falhar, a correção é no `gerar.py`.)

- [ ] **Step 3: Commit**

```bash
git add escritoriohs/mapa/testes/test_areas.py && git commit -m "test(escritoriohs/mapa): áreas, tranca e placas"
```

---

### Task 5: Prévia, ajuste visual e aprovação do Erick

**Files:**
- Modify: `escritoriohs/mapa/blocos.py` (encaixe de parede e carimbos, conforme a prévia)
- Create: `escritoriohs/mapa/saida/hs.tmj`, `saida/hs.wam`, `saida/placas.png`, `saida/previa.png`

- [ ] **Step 1: Gerar e desenhar**

```bash
cd escritoriohs/mapa && python3 gerar.py && cp -r tilesets saida/ && python3 previa.py saida/hs.tmj saida/previa.png 0.5
```

- [ ] **Step 2: Conferir o encaixe das paredes**

Abrir `saida/previa.png` (Read). Conferir: cantos de sala, junções em T (onde a parede de duas salas encontra o corredor), pontas de parede ao lado das portas, faces brancas só ao sul de paredes. Cada encaixe errado é uma máscara errada em `blocos.PAREDE`: trocar o índice olhando a folha `WA_Room_Builder` (linhas 0–6 têm as peças escuras com borda) e regerar. Registrar no ledger cada máscara corrigida.

- [ ] **Step 3: Conferir os carimbos**

Mesa, cadeira, computador, sofá, balcão e mesa de reunião aparecem inteiros e virados para o lado certo (cadeira de frente para a mesa). Ajustar `blocos.CARIMBOS` e regerar. `python3 -m pytest testes/ -q` tem que continuar verde a cada ajuste.

- [ ] **Step 4: Mostrar ao Erick**

Publicar a prévia no visual companion (fragmento HTML com `<img src="/files/previa.png">` copiando o PNG para o `screen_dir`) e, num segundo bloco, um recorte ampliado (2×) de uma fileira do Comercial. Pedir aprovação ou ajustes. Repetir Steps 1–4 até o Erick aprovar.

- [ ] **Step 5: Commit**

```bash
git add escritoriohs/mapa && git commit -m "feat(escritoriohs/mapa): mapa hs gerado e aprovado na prévia"
```

---

### Task 6: Envio, conferência ao vivo e troca da sala de entrada

**Files:**
- Create: `escritoriohs/mapa/enviar.sh`, `escritoriohs/mapa/testes/test_enviar.py`
- Modify: `escritoriohs/.env.example` (`START_ROOM_URL=/~/hs/hs.wam`), `escritoriohs/testes/verificar.sh` (checa `hs.wam`)

- [ ] **Step 1: Teste estático do envio (falha: arquivo não existe)**

`escritoriohs/mapa/testes/test_enviar.py`:

```python
"""Enviar com diretório "/" apaga os outros .wam do map-storage — inclusive o
office, que é o plano de volta. O envio tem que ir para hs/."""
import re

def test_enviar_usa_diretorio_hs():
    s = open("enviar.sh").read()
    assert re.search(r'-F\s+"directory=hs"', s)
    assert 'directory=/' not in s

def test_enviar_nao_imprime_o_token():
    s = open("enviar.sh").read()
    assert "set -x" not in s and "echo \"$TOKEN" not in s and "echo $TOKEN" not in s
```

Run: `cd escritoriohs/mapa && python3 -m pytest testes/test_enviar.py -q` → FAIL.

- [ ] **Step 2: `escritoriohs/mapa/enviar.sh`**

```bash
#!/usr/bin/env bash
# Envia saida/ ao map-storage do EscritorioHS, no diretório hs/ (o office fica
# intacto). O token é o MAP_STORAGE_AUTHENTICATION_TOKEN, lido de
# ~/escritoriohs.env — nunca impresso.
set -euo pipefail
cd "$(dirname "$0")"
python3 -m pytest testes -q
python3 gerar.py
rm -rf saida/tilesets && cp -r tilesets saida/
z=$(mktemp -d)/hs.zip
(cd saida && zip -qr "$z" hs.tmj hs.wam placas.png tilesets)
TOKEN=$(grep -oP '^MAP_STORAGE_AUTHENTICATION_TOKEN=\K.+' ~/escritoriohs.env)
codigo=$(curl -s -o /dev/null -w '%{http_code}' -X POST \
  -H "Authorization: Bearer $TOKEN" -H "X-Map-Storage-Host: escritoriohs.healthsafetytech.com" \
  -F "file=@$z" -F "directory=hs" \
  https://escritoriohs.healthsafetytech.com/map-storage/upload)
unset TOKEN; rm -f "$z"
echo "envio: HTTP $codigo"
[ "$codigo" = 200 ] || exit 1
curl -s -o /dev/null -w 'hs.wam no ar: HTTP %{http_code}\n' https://escritoriohs.healthsafetytech.com/map-storage/hs/hs.wam
```

`chmod +x escritoriohs/mapa/enviar.sh`; rodar o teste → PASS.

⚠️ O `~/escritoriohs.env` existe só enquanto o Erick não o apaga (pendência do sub-projeto A). Se tiver sido apagado: o Erick roda o `enviar.sh` com `TOKEN` colado no Konsole, ou recria o arquivo só com essa linha.

- [ ] **Step 3: Enviar (confirmar com o Erick antes)**

```bash
escritoriohs/mapa/enviar.sh
```

Expected: `envio: HTTP 200` e `hs.wam no ar: HTTP 200`. Conferir que o `office` sobreviveu: `curl -s -o /dev/null -w '%{http_code}' https://escritoriohs.healthsafetytech.com/map-storage/office.wam` → 200. E que o `hs.wam` que voltou tem as áreas (o map-storage pode reescrever o arquivo):

```bash
curl -s https://escritoriohs.healthsafetytech.com/map-storage/hs/hs.wam | python3 -c "import json,sys; w=json.load(sys.stdin); print(len(w['areas']),'áreas')"
```

Expected: `33 áreas` (28 salas + Diretoria + 2 reuniões + recepção + silenciosa; o café não tem área). Se vier 0, o map-storage descartou o `.wam` enviado: parar e investigar (log do `escritoriohs_wa-map-storage-1`).

- [ ] **Step 4: Conferência ao vivo com o Erick (link direto, antes de trocar a entrada)**

O Erick abre `https://escritoriohs.healthsafetytech.com/~/hs/hs.wam` e confere, com uma segunda pessoa:
1. nasce na recepção, anda até "Comercial 03" e entra;
2. dentro da sala, tranca; a outra pessoa não consegue entrar; ao sair, destranca sozinho;
3. três pessoas na Reunião 01 ficam na mesma chamada sem estarem lado a lado;
4. na Silenciosa, duas pessoas lado a lado não abrem conversa.

Registrar o resultado no `escritoriohs/README.md` (tabela de aceite do mapa).

- [ ] **Step 5: Trocar a entrada (o Erick, no EasyPanel)**

`START_ROOM_URL=/~/hs/hs.wam` no Environment do serviço `wa` → deploy. Atualizar `escritoriohs/.env.example` igual. No `verificar.sh`, trocar a sala do teste de login (`$base/~/office.wam`) por `$base/~/hs/hs.wam` e rodar `escritoriohs/testes/verificar.sh tudo` → `tudo certo (14 checagens)`. Voltar atrás = `START_ROOM_URL=/~/office.wam`.

- [ ] **Step 6: Commit**

```bash
git add escritoriohs && git commit -m "feat(escritoriohs/mapa): mapa hs no ar como sala de entrada"
```

---

### Task 7: Documentação e merge

**Files:**
- Create: `escritoriohs/mapa/README.md`
- Modify: `escritoriohs/README.md` (seção "Mapa"), `CLAUDE.md` (bloco do EscritorioHS)

- [ ] **Step 1: `escritoriohs/mapa/README.md`**

```markdown
# Mapa do EscritorioHS

O mapa `hs` é **gerado**: `planta.json` → `gerar.py` → `saida/`. Não edite o
mapa no editor do navegador — a edição some no próximo envio.

| quero… | faço |
|---|---|
| trocar a placa de uma sala por um nome | editar `"placa"` em `planta.json` |
| mover/criar uma sala | editar `planta.json` (blocos de 32 px; salas 8×8, paredes compartilhadas) |
| ver como ficou | `python3 gerar.py && cp -r tilesets saida/ && python3 previa.py saida/hs.tmj saida/previa.png 0.5` |
| conferir | `python3 -m pytest testes -q` (toda sala alcançável a partir da recepção, áreas só no interior, 28 salas) |
| pôr no ar | `./enviar.sh` (vai para `hs/`; o `office` fica intacto) |

Blocos gráficos: map-starter-kit do WorkAdventure, commit `1143646`,
CC-BY-SA 3.0 (`tilesets/LICENSE.assets`).
```

- [ ] **Step 2: `escritoriohs/README.md` e `CLAUDE.md`**

Em `escritoriohs/README.md`, seção "Mapa": substituir a descrição do `office` por: mapa `hs` gerado (`escritoriohs/mapa/`), entrada `/~/hs/hs.wam`, `office` mantido como plano de volta, e a tabela de aceite do Step 4 da Task 6. No `CLAUDE.md`, no bloco do EscritorioHS, uma linha: "O mapa é gerado por `escritoriohs/mapa/gerar.py` a partir de `planta.json`; editar no navegador some no próximo envio."

- [ ] **Step 3: Testes finais e merge**

```bash
(cd escritoriohs/mapa && python3 -m pytest testes -q) && escritoriohs/testes/testar-config.sh && escritoriohs/testes/verificar.sh tudo
git add -A && git commit -m "docs(escritoriohs/mapa): README do gerador e aceite"
git checkout main && git merge --no-ff escritoriohs-mapa -m "Merge: EscritorioHS — mapa próprio da HS" && git push && git branch -d escritoriohs-mapa
```
