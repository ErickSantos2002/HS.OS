---
name: faturamento
description: >-
  A régua do faturamento da Health & Safety no DataCoreHS. Use SEMPRE que
  perguntarem faturamento, receita, quanto foi vendido, quanto entrou no mês, ou
  qualquer número de dinheiro realizado — inclusive por cliente, por período ou
  comparando meses. Também para produto: quantos aparelhos saíram, quem comprou,
  ranking de clientes, comparação de unidades entre anos, CFOP e devolução.
  Somar nota fiscal sem estas regras infla o número em ~50%.
emoji: 💰
always: false
---

# Faturamento — a régua da casa

⚠️ **Não some nota fiscal por conta própria.** Em 14/08/2026 o faturamento de
agosto foi respondido como **R$ 654.645,95** somando toda nota "emitida". O
número certo era **R$ 441.712,80** — 48% de inflação, entregue com cara de
dado exato para quem ia levar à diretoria.

O que inflou: remessa, retorno de comodato, importação e notas com marcador de
cancelamento. São notas de verdade, emitidas de verdade, que **não são venda**.

## Faturamento é exatamente duas coisas

| | de onde vem | o que é |
|---|---|---|
| **Vendas** | `gold.fato_vendas` (NF-e, régua já aplicada) | produto vendido |
| **Serviços** | `tiny.servicos` (NFS-e) | calibração, anuidade de software, outros |

**Nada mais entra.** Não existe uma terceira fonte, e nenhuma outra tabela do
DataCoreHS é faturamento.

## Vendas — a régua é a do DataCoreHS, e já vem aplicada

**Venda é o que está em `gold.fato_vendas`.** A régua mora no dbt do DataCoreHS
(`analytics/models/silver/vendas.sql`) e a tabela já sai filtrada por ela:

1. **CFOP do ITEM é de venda** — 5102, 6102, 5108, 6108 e **7102** (exportação,
   marcada em `mercado = 'externo'`). Não a natureza de operação, que é texto
   livre: há nota com natureza vazia e nota cuja natureza diz 6102 com item 2202.
2. **Situação `emitida danfe`.**
3. **Nenhum marcador que exclua** — a classificação de `silver.stg_marcadores`,
   por radical (`cancel`, `devol`, `recusad`, `rejeit`, `inutiliz`, `nao quis`)
   mais uma seed de exceções.
4. **Não retirada à mão** pela curadoria (`notas_fora_do_faturamento`).

⚠️ **Não refaça esses filtros sobre o `tiny`, nem para "conferir".** Duas cópias
da régua foram o que fez o faturamento divergir entre relatórios por anos. Se o
número do `gold` parecer errado, diga o que viu — quem corrige é o DataCoreHS.

**Grão: ITEM da nota.** Faturamento é **`sum(valor_nota_rateado)`** — o valor da
nota repartido entre os itens; somado, devolve exatamente o `valor_nota` (frete e
desconto inclusos). Nota se conta com `count(DISTINCT id_nota)`. A data é
`data_venda`.

⚠️ **Nunca junte `tiny.notas_fiscais` e some `valor_nota`**: a nota se repete em
cada item e o total infla ~28%. Do `tiny`, por `id`, só o que o fato não traz —
o nome do item (`tiny.itens_nota i ON i.id = f.sk_venda_item`), o vendedor, o
cliente e as observações (`tiny.notas_fiscais nf ON nf.id = f.id_nota`).

⚠️ **A tabela é recalculada uma vez por dia, às 05:00.** Nota emitida hoje só
aparece amanhã. Em pergunta sobre hoje ou o mês corrente, diga **"até
DD/MM"** com o `max(data_venda)` — não "até hoje".

```sql
SELECT count(DISTINCT id_nota) AS notas,
       sum(valor_nota_rateado)::numeric(14,2) AS total,
       max(data_venda) AS dados_ate
FROM gold.fato_vendas
WHERE data_venda >= DATE '2026-08-01'
  AND data_venda <  DATE '2026-09-01';
```

⚠️ **Até 01/10/2026 a régua vinha de `tiny.configuracoes`** (`CFOP_VALIDOS` e
`MARCADORES_INVALIDOS`, com CFOP lido da natureza e marcador por `LIKE`). As
chaves foram aposentadas e saem do banco; consulta que as leia está errada. Medido na troca: a régua
antiga contava 27 notas que não são venda (natureza dizendo venda com item de
devolução; marcador "MATERIAL DEVOLVIDO", "NOTA REJEITADA" fora da lista) e
deixava de fora 13 que são (exportação, natureza vazia). Em 2025 o total cai
R$ 13.230 e em 2026 R$ 14.700; janeiro/2026 e o T3 de 2026 não mudam.

## Serviços — duas condições

1. **`cancelada = false`.**
2. O valor é **TEXT** com formato misto e precisa virar número.

⚠️ **A conversão é `replace(valor, ',', '.')::numeric` e nada mais.** Tirar o
ponto antes (`replace('.','')`) multiplica por 10 os ~10% de registros que já
usam ponto decimal — e o erro passa despercebido porque o total só fica "maior".

```sql
SELECT count(*) AS notas,
       sum(replace("valor_dos_serviços", ',', '.')::numeric)::numeric(14,2) AS total
FROM tiny.servicos
WHERE cancelada = false
  AND "data_da_emissão_nfs_e_dsr_e" >= DATE '2026-08-01'
  AND "data_da_emissão_nfs_e_dsr_e" <  DATE '2026-09-01';
```

Os nomes das colunas têm acento e aspas duplas são obrigatórias.

Categoria, quando pedirem a abertura, sai da `discriminação_dos_serviços`:
`Desenvolvimento de Plataforma` → anuidade de software; `Calibração e
Manutenção` → calibração (a grafia varia, com e sem acento); o resto → Outros.

## Meta — existe, é anual, e o acompanhamento é trimestral

⚠️ **"Quanto falta para a meta" tem resposta.** Ela mora na mesma tabela das
outras réguas, em `tiny.configuracoes`:

| chave | o que é |
|---|---|
| `META` | a meta **anual** da empresa |
| `TRIMESTRE_APURACAO` | o trimestre em acompanhamento: `auto` = o trimestre do calendário em que hoje está; `AAAA-TN` = trimestre fixado (ex.: `2026-T3` = jul/ago/set de 2026 — pode ser de outro ano) |

⚠️ **A meta cadastrada é ANUAL, mas ninguém acompanha por ano.** O DataCoreHS
divide por 4 e mede o trimestre de `TRIMESTRE_APURACAO`. Comparar o realizado do
trimestre com a meta anual inteira dá um percentual três vezes menor que o real e
assusta à toa.

```sql
WITH tri AS (SELECT ini, (ini + interval '3 months')::date fim
               FROM (SELECT CASE WHEN v ~ '^\d{4}-T[1-4]$'
                                 THEN make_date(left(v,4)::int, (right(v,1)::int-1)*3+1, 1)
                                 ELSE date_trunc('quarter', current_date)::date END ini
                       FROM (SELECT coalesce((SELECT upper(btrim(valor)) FROM tiny.configuracoes
                                               WHERE chave='TRIMESTRE_APURACAO'),'AUTO') v) c) x),
     meta AS (SELECT valor::numeric/4 m FROM tiny.configuracoes WHERE chave='META'),
     v AS (SELECT coalesce(sum(f.valor_nota_rateado),0)::numeric t
             FROM gold.fato_vendas f, tri
            WHERE f.data_venda >= tri.ini AND f.data_venda < tri.fim),
     s AS (SELECT coalesce(sum(replace("valor_dos_serviços",',','.')::numeric),0)::numeric t
             FROM tiny.servicos, tri WHERE cancelada=false
              AND "data_da_emissão_nfs_e_dsr_e" >= tri.ini
              AND "data_da_emissão_nfs_e_dsr_e" <  tri.fim)
SELECT extract(year from tri.ini)||'-T'||extract(quarter from tri.ini) AS trimestre,
       meta.m AS meta_trimestre, v.t+s.t AS realizado,
       round((v.t+s.t)/meta.m*100,1) AS pct,
       greatest(meta.m-(v.t+s.t),0) AS falta,
       (SELECT max(data_venda) FROM gold.fato_vendas) AS vendas_ate
  FROM tri, meta, v, s;
```

⚠️ **Sempre diga qual trimestre você mediu** — é a coluna `trimestre` — **e até
que dia vão as vendas** (`vendas_ate`: a carga é das 05:00, nota de hoje entra amanhã). No
primeiro dia de um trimestre o realizado é zero de verdade, e "0%" sem o
trimestre ao lado parece defeito. Se a pessoa perguntar de outro trimestre,
troque o valor da `tri` na consulta (ex.: `'2026-T2'` no lugar do `coalesce`) —
**não** altere a chave na tabela, que é a tela de todo mundo no DataCoreHS.

Âncora — trimestre fixado em `2026-T3`, apurado em 01/10/2026: meta do trimestre
**R$ 3.166.666,68**, realizado **R$ 2.783.902,24**, **87,9%**, faltando
**R$ 382.764,44**.

⚠️ **Se você viu 77,0% e R$ 2.438.461,71 em algum lugar, é o número errado.** Até
21/08/2026 a chave antiga, `MESES_ANALISE`, era uma lista de meses sem ano
(`6,7,8`) lida com duas convenções: o painel do DataCoreHS jogava direto no
`new Date` do JavaScript, que conta mês a partir de **zero**, e apurava
jul/ago/set; esta consulta usava `extract(month)`, que é **1-based**, e apurava
jun/jul/ago. Mesma chave, mesmo valor, um mês de diferença — e o briefing da
manhã saiu dois dias seguidos com R$ 787 mil a mais, dizendo que faltava metade
do que faltava de verdade. Em 01/10/2026 ela foi aposentada: `TRIMESTRE_APURACAO`
traz o ano e o número do trimestre, e não há mês para contar a partir de zero.

**A conferência que pega esse tipo de erro é bater com a tela Meta Trimestral do
DataCoreHS**, e não só com a página Financeiro: os totais mensais batendo não
provam que o recorte do trimestre está certo.

⚠️ **Existem faixas de bônus e elas NÃO são o percentual de atingimento.** O
DataCoreHS tem uma aba de Meta onde se escolhe uma faixa de 55% a 100% e ela
multiplica a meta trimestral (55%→0,9 · 85%→1,2 · 100%→1,4, interpolado). É
mecanismo de remuneração, não de acompanhamento. **Não calcule bônus** — se
perguntarem, diga que a régua está na aba Meta do DataCoreHS e que quem responde
por ela é o Erick.

## Por vendedor, e por produto — as duas perguntas que ficaram sem resposta

Em 17/08/2026 o CEO perguntou **"qual o faturamento por vendedor?"** e no dia
seguinte **"quais clientes compraram o Phoebus?"**. As duas voltaram como "não é
comigo" e nunca foram respondidas. As duas são respondíveis aqui.

### Por vendedor

O vendedor é o `nome_vendedor` da nota, em `tiny.notas_fiscais`. O valor continua
saindo do fato:

```sql
SELECT coalesce(nullif(btrim(nf.nome_vendedor),''),'(sem vendedor)') AS vendedor,
       count(DISTINCT f.id_nota) AS notas,
       sum(f.valor_nota_rateado)::numeric(14,2) AS total
  FROM gold.fato_vendas f
  JOIN tiny.notas_fiscais nf ON nf.id = f.id_nota
 WHERE f.data_venda >= DATE '2026-08-01' AND f.data_venda < DATE '2026-09-01'
 GROUP BY 1 ORDER BY 3 DESC;
```

⚠️ **Só vale para VENDAS. `tiny.servicos` não tem vendedor.** Se eu somar os dois
e apresentar como "faturamento por vendedor", o total por vendedor não fecha com
o faturamento total — e a diferença é justamente a receita de serviços, que não
tem a quem atribuir. **Diga isso ao responder**: "por vendedor cobre só as
vendas; os serviços do mês (R$ X) não têm vendedor no cadastro".

Agosto/2026 inteiro devolve: Eduardo Luna R$ 441.521,00 · Gislayne Nunes
R$ 214.367,20 · Adriana Oliveira R$ 137.116,60 · Sandra Silva R$ 90.564,50.

## Produto: unidades, compradores e devolução

⚠️ **Em 29/09/2026 o CEO recebeu "o Phoebus caiu 41,5%" e o certo era −2,9%.**
A comparação de aparelhos foi montada sem o filtro de CFOP: jan–set/2025 saiu
com **193** unidades, e as de venda eram **138**. Remessa para demonstração,
retorno de conserto e importação entraram como venda. Em cima desse número veio
um cenário de "quantos Phoebus faltam para empatar com 2025", que também saiu
errado. No mesmo dia, o ranking de compradores "não fechava", porque a lista usava
a régua e o total não usava.

**Pergunta de produto — quantos saíram, quem comprou, ranking, mês a mês,
comparação entre anos — usa a mesma régua de venda do faturamento.** Não existe
"régua de aparelho" separada. Um único bloco serve para tudo:

```sql
WITH venda AS (
  SELECT f.id_nota AS id, f.numero_nota AS numero, f.data_venda AS data_emissao,
         nf.id_cliente, i.descricao, f.cfop, f.quantidade,
         f.valor_total_item AS valor_total
    FROM gold.fato_vendas f
    JOIN tiny.itens_nota i ON i.id = f.sk_venda_item
    JOIN tiny.notas_fiscais nf ON nf.id = f.id_nota
   WHERE upper(btrim(i.descricao)) = 'BAFÔMETRO PHOEBUS')      -- o item exato
-- ano a ano:
SELECT extract(year FROM data_emissao)::int AS ano,
       sum(quantidade)::int AS unidades, sum(valor_total)::numeric(14,2) AS valor
  FROM venda GROUP BY 1 ORDER BY 1;
```

- **Unidades = `sum(quantidade)`**, e valor do produto = `sum(valor_total_item)`.
  Não é o `valor_nota_rateado`: aquele inclui o frete rateado; o do item é o
  preço do produto.
- **Filtre o item pelo nome exato, não por `ILIKE '%phoebus%'`.** O `ILIKE` traz
  junto `FONTE DE ALIMENTAÇÃO 12V - 3A (PHOEBUS)`, `Placa do Phoebus Link`,
  `IMPRESSORA BAFÔMETRO PHOEBUS` e o `PHOEBUS PRO C/ TAMPA`: em 2025 foram +40
  unidades que não são o aparelho. Se não souber o nome exato, liste antes os
  `descricao` distintos que casam e escolha.
- **Mês corrente é parcial.** Ao comparar com o ano anterior, corte o ano anterior
  no mesmo dia. Mês cheio contra mês pela metade não é comparação.

### Compradores — agrupar por raiz de CNPJ

⚠️ **Lista de compradores se pede à ferramenta `compradores_produto`, não se
escreve.** Em 30/09/2026 a lista de 137 compradores de Phoebus passou do teto de
saída do modelo e o turno inteiro se perdeu, três vezes. A ferramenta aplica
esta mesma régua (inclusive a devolução abaixo), guarda a planilha completa em
Documentos no nome de quem pediu e devolve totais e top 10. A consulta abaixo
continua valendo para conferir um número, não para despejar a lista.

Filiais da mesma empresa têm CNPJs diferentes com os mesmos 8 primeiros
dígitos. A Nacional Gás, por exemplo, tem 25 CNPJs. Agrupe pela raiz; quando o
cliente não tiver CNPJ, use o nome, e **diga quantos caíram em cada caso**:

```sql
-- … o bloco `venda` acima, e então:
SELECT coalesce(left(nullif(regexp_replace(c.cpf_cnpj,'\D','','g'),''), 8),
                'nome:' || upper(btrim(c.nome)))   AS grupo,
       min(c.nome) AS cliente, count(DISTINCT v.id) AS notas,
       sum(v.quantidade)::int AS unidades, sum(v.valor_total)::numeric(14,2) AS valor
  FROM venda v LEFT JOIN tiny.clientes c ON c.id = v.id_cliente
 WHERE v.data_emissao >= DATE '2025-01-01' AND v.data_emissao < DATE '2026-01-01'
 GROUP BY 1 ORDER BY 4 DESC;
```

**A soma da lista tem que ser igual ao total do período.** Se não for, a lista e
o total estão usando réguas diferentes. Pare e ache qual, porque não existe
"cliente órfão" nesta base: em 2025 todas as notas de venda de Phoebus casam com
um cliente que tem CNPJ.

Se pedirem para juntar "empresas de nome parecido" que têm raízes diferentes
(Rumo Malha Sul × Rumo Malha Paulista são CNPJs distintos), mostre os dois
agrupamentos e diga quais grupos você juntou por nome. Juntar por nome é
aproximação, e quem lê precisa saber disso.

### CFOP — o primeiro dígito diz o sentido da nota

⚠️ **Em 29/09/2026 eu descrevi três CFOPs errado, e o CEO decidiu em cima da
descrição.** Chamei o `3102` de "venda interestadual", mas é **importação**. Com
isso, a C4 Development, que é a nossa fornecedora no exterior, apareceu como
"maior compradora de 2026". Chamei o `6908` de "venda a não contribuinte", mas é
**comodato**. E o `2102`, que é **compra**, também entrou como venda.

**O significado está escrito na própria nota**, em `natureza_operacao`
(`"CFOP 6908 - Remessa de bem por conta de contrato de comodato e locação"`).
Leia de lá para DESCREVER. Não descreva CFOP de memória. Para decidir se é
venda, quem vale é o `cfop` do item — e o `gold.fato_vendas` já decidiu.

| 1º dígito | sentido |
|---|---|
| 1, 2, 3 | **entrada** (3 = do exterior, ou seja, importação). Nunca é venda nossa |
| 5, 6, 7 | **saída** (5 = no estado, 6 = outro estado, 7 = exterior) |

Os CFOPs de saída que aparecem nas nossas notas e **não são venda**: 6912/5912
(demonstração), 6916/5916 (retorno de conserto), 6915 (remessa para conserto),
6908 (comodato), 6910/5910 (bonificação), 5911 (amostra), 6923 (conta e ordem),
6949/5949 (outra saída). Importação (`3102`) é entrada e nunca está no fato.

**"Toda saída de venda" é o que está em `gold.fato_vendas`**: 5102, 6102, 5108,
6108 e 7102. A exportação (`7102`) **entra**, por decisão do DataCoreHS (D2), e
vem marcada em `mercado = 'externo'` — se a pergunta for só mercado interno,
filtre `mercado = 'interno'` e diga que filtrou. São 5 notas na base inteira
(2020 e dez/2023, R$ 467.523,36).

### Devolução — a régua já tira a maioria; abater de novo conta duas vezes

⚠️ **"Venda líquida de devolução" NÃO é `vendas − notas 2202`.** Quando o cliente
devolve ou recusa, a nota de venda original costuma ganhar um marcador
(`NF recusada`, `NF cancelada`…) e **já sai pela régua**. Subtrair também a nota
de entrada `2202` desconta a mesma devolução duas vezes. Foi o que aconteceu em
29/09/2026: das seis devoluções de Phoebus, só **duas** tinham a venda de origem
ainda contada — e com a régua do DataCoreHS, nenhuma: as duas vendas de origem
têm marcador de rejeição, que a lista antiga não pegava.

A nota de devolução cita a de origem nas `observacoes` ("faturado na DANFE de
venda 006031"). **Abata só quando a nota citada ainda está em
`gold.fato_vendas`:**

```sql
WITH conta AS (SELECT DISTINCT lpad(numero_nota, 6, '0') AS numero
                 FROM gold.fato_vendas),
devol AS (SELECT nf.numero, nf.data_emissao, i.quantidade, i.valor_total,
                 lpad(substring(nf.observacoes FROM '(?i)(?:DANFE|NF)[^0-9]{0,25}(\d{3,6})'), 6, '0') AS ref
            FROM tiny.notas_fiscais nf JOIN tiny.itens_nota i ON i.id_nota = nf.id
           WHERE upper(btrim(i.descricao)) = 'BAFÔMETRO PHOEBUS'
             AND lower(btrim(nf.descricao_situacao)) = 'emitida danfe'
             AND substring(nf.natureza_operacao FROM '\d{4}') IN ('1202','2202'))
SELECT d.*, CASE WHEN d.ref IS NULL THEN 'sem referência: não abater, relatar'
                 WHEN c.numero IS NULL THEN 'origem fora do gold: NÃO abater'
                 ELSE 'abater' END AS decisao
  FROM devol d LEFT JOIN conta c ON c.numero = d.ref;
```

Hoje, para o Phoebus, isso dá: **nenhuma abatida.** As origens de **004762**
(1 un, 2023) e **005745** (10 un, 2024) saíram pelo marcador de rejeição; as de
**006168** e **006377** estão marcadas como recusadas; a **005624** cita uma
remessa `6949`, não uma venda; a **005576** não cita nota. Na base inteira, 9 das
21 devoluções ainda abatem (2023–2024, todas de outros produtos) — são vendas
sem marcador, que o DataCoreHS conta como faturamento cheio. Diga ao responder
quais você abateu e por quê.

⚠️ **Nunca "reincluir a origem" para depois abater.** Em 30/09/2026 a Iris montou
um "bruto cheio − devoluções": pôs de volta as vendas que a régua tinha tirado
por recusa e subtraiu as devoluções delas. Deu **230** Phoebus em 2025, contra
**217**, e em cima disso um "faltam 95 para empatar" que era 83. 2024 bateu por
acaso em 194, e ela usou isso como prova do método. Nota que a régua tirou já
está abatida: o abatimento dela é justamente ficar fora. **Líquido = a régua de
venda − só as devoluções marcadas `abater` acima. Nada mais entra nem sai.**

| Phoebus líquido | 2024 | 2025 | 2026 (até 29/09) |
|---|---|---|---|
| unidades | **194** | **217** | **134** |
| abatido | nada (a origem da 005745 saiu pelo marcador) | nada (a origem da 006377 já está fora) | nada |

Confira **os três anos**. Um só pode bater por coincidência, como bateu.

**O valor abatido é o `valor_total` do item na nota de devolução, somado pela
consulta.** Não faça a conta de cabeça. Em 30/09/2026 a unidade saiu certa e o
valor saiu R$ 91 mil errado. Âncora: **Phoebus 2024 líquido = 194 un ·
R$ 3.919.607,00** — até 01/10/2026 isso era 204 un menos a 005745 (10 un ·
R$ 199.500,00); hoje a venda 005725 já não está no fato, e o 194 sai direto.

⚠️ **A soma dos itens não é o faturamento.** Para "quanto esse cliente comprou
do produto X" o certo é `valor_total_item`; para faturamento é o
`valor_nota_rateado`. São perguntas diferentes e números diferentes — não misture.

## Confira antes de responder

**Janeiro/2026 fecha em R$ 402.592,52 de vendas e R$ 147.333,40 de serviços.**
(Era R$ 409.592,52 até a nota 007677, de R$ 7.000, ganhar o marcador "NF
recusada". A régua passou a tirá-la, como deve.)
Esses dois números batem com a página Financeiro do DataCoreHS.

Se você mudar a consulta e quiser saber se continua certa, rode-a para janeiro
de 2026 e compare. Bateu, a régua está certa. Não bateu, **pare** — não entregue
o número, diga o que divergiu.

⚠️ **Janeiro conferido NÃO prova que a meta está certa.** Aquele teste valida a
régua de vendas e serviços num mês fechado — ele passa igual com o trimestre
recortado errado, e foi por isso que o erro do `MESES_ANALISE` sobreviveu a três
conferências. A meta tem âncora própria: **a soma dos meses que você apurou tem
que bater com a tela Meta Trimestral do DataCoreHS**, mês a mês. O
`2026-T3` fechado dá Julho R$ 1.103.748,54 · Agosto R$ 1.112.049,60 · Setembro
R$ 568.104,10 (apurado em 01/10/2026; notas recusadas ou marcadas depois mudam o
mês para baixo — julho era R$ 1.123.090,94 em 21/08).

Se os meses que a sua consulta somou não forem os mesmos que aparecem naquela
tela, o problema é o recorte, não a régua — **pare e diga qual trimestre você
usou**, em vez de entregar o total.

⚠️ **Janeiro conferido também NÃO prova que uma contagem de produto está certa.**
Janeiro valida a soma de `valor_nota_rateado`, e a contagem de unidades é outra consulta.
A âncora dela é o Phoebus, que exercita justamente o filtro de CFOP sobre os itens:

| Phoebus (item `BAFÔMETRO PHOEBUS`) | unidades | valor | notas |
|---|---|---|---|
| 2025 inteiro | **217** | R$ 4.936.796,00 | 115 |
| 2025 jan–set · out–dez | **138** · 79 | | |
| 2024 inteiro | **194** | R$ 3.919.607,00 | 74 |
| 2026 até 29/09 | **134** | | |

Se a sua consulta der **485** para 2025, você somou do `tiny` sem a régua. Se der
257, usou `ILIKE` e pegou acessório. Se der 204 para 2024, está usando a régua
antiga. Em todos os casos, **pare**.

## Ao responder

- **Separe vendas de serviços**, e some os dois no total. Quem pergunta
  "faturamento" quase sempre quer o total, mas a abertura é o que dá confiança.
- **Diga o período** que você usou, com dia inicial e final.
- Mês corrente é **parcial**. Diga isso — "até hoje", não "de agosto".
- **Comparando com o ano anterior, corte o ano anterior no mesmo dia.** Setembro
  de 2026 até o dia 29 se compara com 1–29/09/2025, não com setembro inteiro.
  Avisar a diferença não basta; entregue o número igual com igual (e, se
  quiser, o do mês cheio ao lado).
- Se o número for muito diferente de uma resposta anterior sua, **investigue
  antes de entregar**: pode ser emissão nova, e pode ser consulta errada.

⚠️ **Nunca entregue faturamento somando nota sem estes filtros**, nem que a
pergunta pareça simples e a pressa seja grande. Número errado com aparência de
exato é pior que dizer "me dá um minuto".
