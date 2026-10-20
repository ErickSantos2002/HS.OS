# Mapa do EscritorioHS

O mapa `hs` (entrada: `START_ROOM_URL=/~/hs/hs.wam`) é **gerado**:
`planta.json` → `gerar.py` → `saida/` → `enviar.sh` → map-storage, pasta `hs/`.

## Quem manda em quê

| parte | quem manda | como muda |
|---|---|---|
| paredes, piso, portas, salas, placas, logo, áreas (tranca, reunião, silenciosa, entrada) | o **gerador** | editar `planta.json`/`gerar.py` e reenviar |
| **todo móvel** — mesas (inclusive balcões e a mesa de reunião), cadeiras, monitor, plantas, estantes, sofás, pufes, poltronas, relógios, cafeteira… | **o Erick, pelo editor do navegador**, depois de publicados | arrastar/apagar no navegador |

⚠️ **Móvel nunca é bloco** (decisão do Erick, 16/10/2026). Até essa data
balcões, mesa de reunião, TV, quadros, mesinhas e bancos eram carimbos de
blocos e saíam quebrados no WA (peça cortada, cadeira que era só o pé), além de
não se mexerem pelo editor. O que não existe na coleção (TV, quadros) saiu do
mapa. `test_nenhum_movel_e_bloco` recusa qualquer bloco das folhas de móveis.

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

A mescla preserva do ar o `lastCommandId`.

**Dono de sala** (sub-projeto B; diretoria também desde 16/10/2026).
⚠️ **Dono e nome NÃO ficam no repositório — ele é público.** Moram em
`~/escritoriohs-donos.json` (600), na máquina do Erick:

```json
{"Comercial 01": {"dono": "comercial01@healthsafetytech.com", "pessoa": "Gislayne"}}
```

`gerar.py` o lê se existir (sem ele, mapa sem dono e placa só de setor — é
assim que os testes rodam). `dono` vira o `ownerId` da área pessoal, em
minúsculas — o `userUuid` que a Admin API do HS.OS devolve, ou seja, o
**e-mail Microsoft com que a pessoa entra**. `pessoa` vira a segunda faixa da
placa, embaixo do setor; texto acima de 60 px para o gerador (encurte no
arquivo). Cômodo que não existe na planta também para. Por isso `saida/` está
no `.gitignore`: depois de gerada ela tem e-mails (`hs.wam`) e nomes
(`placas.png`).

⚠️ **Planta com `dono` vence o ar; sem `dono`, vale o do ar**
(`ownerId`/`allowedTags`): quem foi atribuído pelo editor do navegador
continua lá. Para tirar um dono, apague do arquivo **e** desfaça pelo
navegador. `placa_dx` (no `planta.json`) desloca a placa na parede — a da
Diretoria ficava atrás da estante grande.

⚠️ **A área pessoal cobre o cômodo inteiro, paredes inclusive** (20/10/2026).
O WA só deixa o dono pôr objeto cuja **imagem** caiba inteira numa área dele;
com a área só no interior, o que encostava na parede ficava vermelho. A borda
extra é só parede (`test_area_pessoal_cobre_o_comodo_com_as_paredes`): um bloco
a mais e a tranca fecharia o corredor. Vizinhos dividem a parede do meio.

⚠️ **Mesa (objeto com colisão) não entra em área pessoal sem Shift — defeito do
WA, não nosso.** Conferido no código da v1.33.11 e ainda igual no `develop` em
20/10/2026: `applyPathfindingAreaWeights` pinta todo bloco de área pessoal (e de
reunião) com um peso de caminho ≠ 0, e `isSpaceAvailable` trata qualquer valor
≠ 0 como ocupado. Vale até para quem pode editar o mapa inteiro. **Segurar
Shift** ao soltar ou arrastar (a prévia fica laranja) pula essa checagem — e
pula também a de parede, então confira onde soltou. Objeto sem colisão (planta,
quadro) não sofre disso.

Placas usam **Liberation Sans** (`fontes/`, SIL OFL 1.1): a fonte embutida do
Pillow não tem acento e "Expedição" saía com um quadrado no lugar do "çã".

A colisão dos objetos (mesas) **não vai para a camada `colisao` do mapa**: o
WA a aplica onde a mesa está. Pintada no mapa, mesa movida deixava parede
invisível no lugar antigo.

⚠️ **O editor do navegador não edita blocos** — só objetos e áreas. Edição de
área feita no navegador some no próximo envio (áreas são do gerador).

## Script do mapa: status do HS.OS no WA

`script/escritorio.js` vai na propriedade `script` do `hs.tmj` (o gerador
copia para `saida/` e o `enviar.sh` o põe no zip — ⚠️ o map-storage **apaga a
pasta `hs/` antes de gravar o zip**, então arquivo fora do zip some do ar).
Ao abrir e a cada 60 s ele lê `WA.player.userRoomToken` (o passe que a Admin
API do HS.OS emite), chama `GET hsosapi…/escritorio/meu-status?t=<token>` e
aplica `WA.player.setStatus(...)` **só quando o valor muda** — e no primeiro
carregamento não aplica `ONLINE`, para não desfazer o status escolhido dentro
do WA. 401 → desiste até a página ser recarregada.

- O WA o roda num iframe sandbox de origem `null`, como `type="module"`: o
  map-storage serve o `.js` com `Access-Control-Allow-Origin: *` (o `cors()`
  dele), e a rota do HS.OS também precisa responder com `*`.
- ⚠️ Sem Admin API (a volta atrás do B) o token é `undefined` e
  `WA.player.userRoomToken` **lança**; o script trata e fica quieto.
- Teste de comportamento: `testes/test_script.py` roda o script no `node` com
  um `WA` falso (pula se não houver `node`).

## Comandos (de `escritoriohs/mapa/`)

| quero… | faço |
|---|---|
| ambiente | `python3 -m venv .venv && .venv/bin/pip install pytest==8.3.3 pillow==12.3.0` |
| trocar a placa de uma sala por um nome | editar `"placa"` em `planta.json` |
| dar dono a uma sala | `~/escritoriohs-donos.json` (fora do repo) — ver acima |
| ver como ficou | `.venv/bin/python gerar.py && cp -r tilesets saida/ && .venv/bin/python previa.py saida/hs.tmj saida/previa.png 0.5` |
| conferir | `.venv/bin/python -m pytest testes -q` |
| pôr no ar | `./enviar.sh` (pasta `hs/`; o `office` fica intacto; precisa de `~/escritoriohs.env` com o `MAP_STORAGE_AUTHENTICATION_TOKEN`) |

## O que já custou caro

- ⚠️ **Depois de enviar, confira com Ctrl+Shift+R.** O map-storage serve o
  `hs.tmj` com `cache-control: public, s-max-age=10` — `s-max-age` não existe
  (o certo é `s-maxage`), então o navegador estima a validade pelo
  `last-modified` e segura o mapa velho por horas. Em 16/10/2026 isso mostrou
  os blocos antigos da mesa de reunião por baixo dos objetos novos (5 pés numa
  mesa de 4) e pareceu que a correção tinha piorado. O `.wam` vem `no-cache`,
  por isso os objetos atualizam e os blocos não.
- **Objeto publicado não muda de lugar pelo gerador.** Para reposicionar o que
  o gerador errou, tirar os ids do `publicados.json` antes do envio — o ar vence.
- **Colisão ignorada:** o WA só barra passagem em bloco cuja folha declara
  `collides: true`. Sem isso dava para atravessar todas as paredes.
- **Envio recusado (HTTP 400):** grupo de camadas sem `x`/`y` e camada
  aninhada sem `id`. O teste exige os campos do `office.tmj` oficial.
- **Planta grande da coleção é 3×3 blocos**, não 1: decoração de corredor
  calculada pelo tamanho da imagem.

Blocos: map-starter-kit do WorkAdventure (commit `1143646`, CC-BY-SA 3.0,
`tilesets/LICENSE.assets`). Objetos: coleções `basic furniture` e
`basic office decoration` que o próprio WA serve em `/collections/`.
