# Mapa do EscritorioHS

O mapa `hs` (entrada: `START_ROOM_URL=/~/hs/hs.wam`) é **gerado**:
`planta.json` → `gerar.py` → `saida/` → `enviar.sh` → map-storage, pasta `hs/`.

## Quem manda em quê

| parte | quem manda | como muda |
|---|---|---|
| paredes, piso, portas, salas, placas, logo, áreas (tranca, reunião, silenciosa, entrada) | o **gerador** | editar `planta.json`/`gerar.py` e reenviar |
| balcões, mesa longa de reunião, TV, quadros, mesas redondas, bancos, máquina de café | o **gerador** (são blocos: não existem na coleção do editor) | idem |
| móveis-objeto: mesa, cadeira, monitor, plantas, estantes, sofás, pufes, poltronas, relógios… | **o Erick, pelo editor do navegador**, depois de publicados | arrastar/apagar no navegador |

⚠️ **Objeto publicado é do Erick.** `publicados.json` registra os ids que o
gerador já pôs no ar. No envio, `mesclar.py`: mantém os objetos do ar como
estão (movido fica onde ele pôs), **não recria** id já publicado que sumiu
(apagado não volta) e só acrescenta objetos novos (sala nova). Para "resetar"
uma sala: tirar os ids dela do `publicados.json` e reenviar.

⚠️ **Sem ler o mapa do ar, o envio para.** Só 404 conta como "ainda não há
mapa". Qualquer outra falha (5xx, timeout, resposta que não é JSON) interrompe
o envio: subir sem os objetos do ar apagaria todos e o registro impediria
recriá-los. Registro corrompido também interrompe.

⚠️ **Id de objeto = cômodo + peça + ocorrência** (desde 15/10/2026). Inserir
peça no meio da lista não muda o id das outras. Os 303 objetos publicados antes
usavam (cômodo, índice); `saida/ids-antigos.json` os renomeia na mescla.

⚠️ **Envie com ninguém mexendo no editor.** O map-storage grava sozinho o que
se edita no navegador ("saving map hs/hs.wam" no log); o que for editado entre
a leitura do mapa do ar e o envio se perde.

A mescla preserva do ar o `lastCommandId` e o **dono das áreas pessoais**
(`ownerId`/`allowedTags`) — o sub-projeto B pode atribuir dono pelo navegador
sem que o próximo envio o apague.

A colisão dos objetos (mesas) **não vai para a camada `colisao` do mapa**: o
WA a aplica onde a mesa está. Pintada no mapa, mesa movida deixava parede
invisível no lugar antigo.

⚠️ **O editor do navegador não edita blocos** — só objetos e áreas. Edição de
área feita no navegador some no próximo envio (áreas são do gerador).

## Comandos (de `escritoriohs/mapa/`)

| quero… | faço |
|---|---|
| ambiente | `python3 -m venv .venv && .venv/bin/pip install pytest==8.3.3 pillow==12.3.0` |
| trocar a placa de uma sala por um nome | editar `"placa"` em `planta.json` |
| ver como ficou | `.venv/bin/python gerar.py && cp -r tilesets saida/ && .venv/bin/python previa.py saida/hs.tmj saida/previa.png 0.5` |
| conferir | `.venv/bin/python -m pytest testes -q` |
| pôr no ar | `./enviar.sh` (pasta `hs/`; o `office` fica intacto; precisa de `~/escritoriohs.env` com o `MAP_STORAGE_AUTHENTICATION_TOKEN`) |

## O que já custou caro

- **Colisão ignorada:** o WA só barra passagem em bloco cuja folha declara
  `collides: true`. Sem isso dava para atravessar todas as paredes.
- **Envio recusado (HTTP 400):** grupo de camadas sem `x`/`y` e camada
  aninhada sem `id`. O teste exige os campos do `office.tmj` oficial.
- **Planta grande da coleção é 3×3 blocos**, não 1: decoração de corredor
  calculada pelo tamanho da imagem.

Blocos: map-starter-kit do WorkAdventure (commit `1143646`, CC-BY-SA 3.0,
`tilesets/LICENSE.assets`). Objetos: coleções `basic furniture` e
`basic office decoration` que o próprio WA serve em `/collections/`.
