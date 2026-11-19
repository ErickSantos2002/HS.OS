---
name: custos
description: >-
  A régua de custo da Health & Safety no DataCoreHS: quanto a empresa gasta por
  mês (com ou sem impostos, por grupo do plano de contas) e quanto custa e
  quanto há em estoque de cada produto. Use SEMPRE que perguntarem custo,
  despesa, gasto, custo mensal, "custo empresa", custo sem impostos, estoque,
  saldo de produto, preço de compra, preço de custo ou margem de produto.
emoji: 🧾
always: false
---

# Custos — o que a empresa gasta e o que o produto custa

⚠️ **Em 28/09/2026 o CEO perguntou "qual meu custo empresa mensal médio sem
impostos" e ouviu que "não existe sistema nosso que responda isso — teria que
vir da contabilidade".** Existe: é o contas a pagar do Tiny, com plano de contas
que já separa os impostos. Na mesma tarde, "meu estoque de bafômetros e seu
preço de aquisição e venda" foi mandado para o GestorHS. Também é daqui, de uma
tabela só.

São duas perguntas diferentes, e esta skill cobre as duas:

| pergunta | onde |
|---|---|
| quanto a empresa gasta (por mês, por grupo, sem impostos) | `tiny.contas_pagar` |
| quanto tem em estoque, quanto custa, por quanto vende | `gold.dim_produto` |

## Parte 1 — custo da empresa

### A régua é a do Balancete do DataCoreHS

A tela **Gerenciamento Financeiro → Balancete** é a autoridade. Ela faz
exatamente isto, e nada além:

1. **`excluida_na_origem_em IS NULL`** — conta apagada no Tiny continua na
   tabela com a data da exclusão; a API do painel a tira por padrão, e você lê o
   Postgres cru, sem padrão nenhum. Faça à mão.
2. **Mês pela `data_emissao`** — não por `vencimento` nem por `competencia`.
   Março/2026 por vencimento dá R$ 580.035,39; pela régua, R$ 568.648,31.
3. **Não filtra situação.** Paga e em aberto entram as duas: o custo existiu.
4. **Soma `valor`**, não `saldo` — aqui a pergunta é quanto custou, não quanto
   falta pagar (isso é a skill `contas-receber`).
5. **Grupo = o número que abre a `categoria`.** O Tiny não tem campo de grupo;
   ele mora no começo do texto (`"7.4 - ICMS"` → grupo 7).

### O plano de contas

| grupo | o que é |
|---|---|
| 1 | fixas — equipe (salário, benefícios, comissão, FGTS, férias) |
| 2 | fixas — sede (aluguel, condomínio, energia, telefone) |
| 3 | fixas — serviços de apoio (sistemas, contabilidade, frete, marketing) |
| 4 | fixas — gerais |
| 5 | fixas — diretoria (**dividendos**) |
| 6 | variáveis — materiais (**importação, serviços aduaneiros**: é compra de mercadoria) |
| 7 | **imposto indireto** (ICMS, PIS, COFINS, ISS, ICMS-ST) |
| 8 | **imposto direto** (IRPJ, CSLL, taxas, IPTU) |
| 9 | financeiras (tarifas bancárias, amortização de empréstimo) |
| 10 | outros custos |

**"Sem impostos" = fora os grupos 7 e 8.** Isso é o plano de contas dizendo,
não interpretação.

⚠️ **O grupo 6 não é custo de operar, é compra de estoque — e é enorme e
irregular.** Em jan–ago/2026 ele foi mais da metade do custo sem impostos, e só
junho teve R$ 1,5 milhão de adiantamento de importação. Uma média mensal que o
inclui oscila com o calendário de importação, não com a operação. **Entregue os
dois números lado a lado** — com e sem o grupo 6 — e diga o que cada um é. Quem
escolhe qual usar é quem perguntou; não escolha por ele.

Os grupos 5 (dividendos) e 9 (financeiras) são menores, mas também não são
"custo de operar" no sentido estrito. Mostre-os como linha própria quando a
pergunta for de custo operacional.

### A consulta

```sql
SELECT to_char(data_emissao, 'YYYY-MM')                       AS mes,
       coalesce(substring(categoria FROM '^(\d+)'), 'sem')     AS grupo,
       count(*)                                                AS contas,
       sum(valor)::numeric(14,2)                               AS valor
  FROM tiny.contas_pagar
 WHERE excluida_na_origem_em IS NULL
   AND data_emissao >= DATE '2026-01-01'
   AND data_emissao <  DATE '2026-09-01'
 GROUP BY 1, 2
 ORDER BY 1, 2;
```

⚠️ **Nunca some de cabeça — os totais saem da consulta.** Em 19/11/2026, na
conferência do Midas, o custo de outubro saiu com três totais diferentes na
mesma resposta (R$ 979 mil, R$ 1,96 mi e um "custo operacional" R$ 2 mil acima
do certo): o modelo somou oito grupos à mão e errou. Para o total de UM mês, use
esta consulta — ela já devolve cada total pronto, e a resposta só copia:

```sql
WITH m AS (
  SELECT coalesce(substring(categoria FROM '^(\d+)'), 'sem') AS grupo,
         valor,
         (cliente_nome = 'Itaú' AND categoria = '9.3 - Tarifas Bancárias'
          AND historico ILIKE '%parcela%') AS parcela_itau
    FROM tiny.contas_pagar
   WHERE excluida_na_origem_em IS NULL
     AND data_emissao >= DATE '2026-10-01'        -- o mês pedido
     AND data_emissao <  DATE '2026-11-01')
SELECT count(*)                                                        AS contas,
       sum(valor)::numeric(14,2)                                       AS total_com_impostos,
       sum(valor) FILTER (WHERE grupo NOT IN ('7','8'))::numeric(14,2) AS sem_impostos,
       sum(valor) FILTER (WHERE parcela_itau)::numeric(14,2)           AS parcelas_itau,
       sum(valor) FILTER (WHERE grupo NOT IN ('7','8')
                            AND NOT parcela_itau)::numeric(14,2)       AS operacional_sem_itau,
       sum(valor) FILTER (WHERE grupo NOT IN ('6','7','8')
                            AND NOT parcela_itau)::numeric(14,2)       AS operacional_sem_mercadoria,
       sum(valor) FILTER (WHERE grupo = 'sem')::numeric(14,2)          AS sem_categoria
  FROM m;
```

A resposta **começa** pelo `operacional_sem_itau` (é o custo de operar no mês),
diz o tipo do número, e só depois mostra os outros totais e, se pedirem, os
grupos da consulta anterior. `sem_categoria` diferente de zero é conta lançada
sem categoria no Tiny: nomeie, não esconda. Comparação entre meses, ritmo ou
média também sai do SQL (`GROUP BY` mês), nunca da sua conta.

### ⚠️ O mês corrente está sempre incompleto — e mês antigo também pode estar

**O mês em curso não entra na média.** Os pagamentos de um mês são lançados no
Tiny ao longo do mês e até depois dele; enquanto isso, a soma do mês é baixa por
falta de lançamento, não por economia. Em 29/09/2026 setembro tinha 17 contas
contra 147 a 184 nos meses anteriores.

⚠️ **E mês fechado já esteve quebrado sem ninguém ver.** Até 29/09/2026 a carga
do DataCoreHS só trazia conta nova por uma janela de 14 dias de emissão, e o
financeiro exclui a conta vencida e a reemite com id novo. Resultado: agosto
tinha 11 contas vivas em vez de 170, e maio, junho e julho também estavam
faltando conta. O backfill corrigiu, e a média de jan–jul entregue ao CEO na
véspera mudou de R$ 689.859 para R$ 729.347. Não foi erro de régua: foi base
incompleta.

Por isso, toda vez, antes de responder, rode:

```sql
SELECT to_char(data_emissao, 'YYYY-MM') AS mes,
       count(*) FILTER (WHERE excluida_na_origem_em IS NULL)     AS vivas,
       count(*) FILTER (WHERE excluida_na_origem_em IS NOT NULL) AS excluidas
  FROM tiny.contas_pagar
 WHERE data_emissao >= date_trunc('month', current_date) - interval '6 months'
 GROUP BY 1 ORDER BY 1;
```

O mês corrente fica fora, sempre. Mês fechado com muito menos contas vivas que
os vizinhos, ou mais excluídas que vivas, **também fica fora** — e você diz isso
na resposta: *"setembro ficou fora porque os pagamentos do mês ainda estão sendo
lançados"*. Média com mês incompleto dentro é número errado com cara de certo.

### Confira antes de responder

Rode a consulta para **julho/2026** e compare:

| resultado sem impostos | leitura |
|---|---|
| **R$ 462.917,93** | ✅ certo — siga |
| R$ 469.937,84 | esqueceu `excluida_na_origem_em IS NULL` |
| R$ 588.441,24 | não tirou os grupos 7 e 8 |
| R$ 442.445,75 | tirou também o grupo 6 (é o número "sem mercadoria", não o sem impostos) |
| R$ 458.955,19 | perdeu a conta sem categoria (R$ 3.962,74) — use o `coalesce` da consulta |

**Bateu, siga. Não bateu, PARE** e diga o que divergiu. Julho foi escolhido por
ter contas excluídas, grupo 6 pequeno e uma conta sem categoria — exercita os
três filtros que erram. ⚠️ Se nenhuma linha bater, pode ter entrado conta
retroativa em julho: diga isso e não entregue o número.

Retrato de jan–ago/2026, média por mês (conferido em 29/09/2026), para você
saber o tamanho:

| | média/mês |
|---|---|
| total (com impostos) | R$ 867.292 |
| sem impostos (fora 7 e 8) | **R$ 674.376** |
| sem impostos e sem mercadoria (fora 6, 7 e 8) | **R$ 321.658** |
| … dos quais equipe (grupo 1) | R$ 113.194 |

### Ressalvas do dado — o que o Balancete não diz sozinho

Levantadas em 18/11/2026 sobre `tiny.contas_pagar`. A régua acima **não muda**
(o Balancete é a autoridade); o que muda é o que você **diz** junto do número.

⚠️ **R1 — O Itaú em "9.3 - Tarifas Bancárias" é dívida, não tarifa** (confirmado pelo Djalma (Financeiro) em 19/11/2026). São
parcelas ("Parcela N/44", "Parcela Giro N/57") com vencimento até 2030, em
volume que domina o a pagar. O Balancete as soma em 9.3 e o mês fica inflado: o
financeiro as lança em bloco, então o mês do lançamento (out/2026, 136 parcelas
de uma vez) tem 9.3 muitas vezes maior que o ritmo normal de tarifas dos meses
anteriores. Meça mês a mês com a consulta abaixo. Sempre que o grupo 9 aparecer, mostre
**tarifas com e sem as parcelas do Itaú**, nomeando-as:

```sql
SELECT to_char(data_emissao,'YYYY-MM') AS mes,
       sum(valor) FILTER (WHERE categoria = '9.3 - Tarifas Bancárias')::numeric(14,2)
         AS tarifas_total,
       sum(valor) FILTER (WHERE categoria = '9.3 - Tarifas Bancárias'
            AND cliente_nome = 'Itaú' AND historico ILIKE '%Parcela%')::numeric(14,2)
         AS parcelas_itau
  FROM tiny.contas_pagar
 WHERE excluida_na_origem_em IS NULL
   AND data_emissao >= DATE '2026-01-01'
 GROUP BY 1 ORDER BY 1;
```

A classificação como dívida (amortização) está confirmada. Não mude a categoria
no número do Balancete: reclassifique numa linha à parte e diga que fez. Se alguém pedir "custo do mês" com out/2026
dentro, o número sem esse ajuste engana.

⚠️ **R2 — Os dois últimos meses são provisórios.** O financeiro lança conta
paga com emissão retroativa, 30–60 dias depois (nota do vault *Contas a pagar
lançadas com emissão retroativa*). Mês corrente e o anterior crescem depois de
fechados. Diga "provisório" neles, sempre.

⚠️ **R3 — Até ago/2026 a fatura do cartão está em "9.3 - Tarifas Bancárias".**
A categoria `9.1 - Cartão de Crédito` só aparece em set/2026; antes, a fatura era
paga por boleto no Santander e lançada em 9.3 com o histórico "pagamento de
boleto" (confirmado pelo Djalma (Financeiro) em 19/11/2026). O **total** do mês está completo — a despesa existe, só está no
grupo 9 como tarifa. Quando a pergunta for por grupo, diga que o cartão de
jan–ago/2026 está dentro de 9.3. O DRE (skill `resultado-mensal`) já o move para
o cartão.

```sql
SELECT to_char(data_emissao,'YYYY-MM') AS mes,
       count(*) FILTER (WHERE categoria LIKE '9.1 - %') AS contas_cartao
  FROM tiny.contas_pagar
 WHERE excluida_na_origem_em IS NULL
   AND data_emissao >= DATE '2026-01-01'
 GROUP BY 1 ORDER BY 1;
```

⚠️ **R4 — O INSS e o IRRF da folha estão no grupo 8, não no 1.** "1.3 - Salário" é
o líquido; o INSS e o IRRF saem numa guia única da Receita Federal (DCTFWeb), lançada
em `8.4 - Taxas Diversas` com o histórico "Recibo Declaração … Apuração MM/AAAA"
(confirmado pelo Djalma (Financeiro) em 19/11/2026). Consequência: o **"sem impostos" do Balancete tira também o encargo da
folha** (uma guia por mês, medida com a consulta do grupo 8). Ao responder custo de pessoal ou custo de
operar, diga isso — o grupo 1 sozinho não é a folha. O DRE (skill
`resultado-mensal`) já põe a guia no pessoal, no mês da apuração. Custo por
colaborador não sai daqui.

### Toda resposta de custo diz o estado do número

Cada resposta de custo ou despesa termina marcando o que entrou como **medido**
(mês fechado, base conferida), **provisório** (os dois últimos meses — R2) ou
**incompleto** (pessoal sem a guia do INSS/IRRF quando o recorte tira o grupo 8 —
R4; 9.3 com as parcelas do Itaú — R1). Sem esse rótulo o número parece mais firme do que é.

## Parte 2 — estoque e custo de produto

### Leia do `gold.dim_produto`, não do `tiny.estoque`

O DataCoreHS tem camada analítica (dbt). `gold.dim_produto` é o cadastro do
estoque **mais** os produtos que aparecem em nota sem estar cadastrados, com
`procedencia` dizendo qual é qual. Colunas: `nome`, `codigo_produto`,
`situacao`, `saldo`, `preco` (venda), `preco_custo`, `preco_custo_medio`,
`procedencia`, `existe_no_estoque`, `ja_foi_vendido`.

`nome` vem normalizado; o original está no `tiny.estoque`, se precisar citar.

```sql
SELECT nome, saldo, preco, preco_custo_medio, procedencia
  FROM gold.dim_produto
 WHERE situacao = 'A'
   AND nome ~* 'bafometro|etilometro|phoebus|iblow|mark x|deimos|titan|mercury'
   AND saldo > 0
 ORDER BY saldo DESC;
```

⚠️ **Bafômetro no nome não quer dizer aparelho.** A consulta acima devolve
no topo "bocal passivo mark x" (2.120) e "cabo usb - iblow" — peça, sensor,
cabo e bocal vêm junto com o aparelho. Quem pergunta
"meu estoque de bafômetros" quer os aparelhos: separe na resposta aparelho de
peça/acessório, e diga que separou.

⚠️ **Estoque de produto é daqui, não do GestorHS.** O GestorHS guarda o
aparelho **do cliente** que volta para calibrar; a prateleira da empresa é o
Tiny.

### O preço de custo quase nunca está preenchido

Dos 296 produtos da `dim_produto` (281 do cadastro e 15 órfãos), **só 12 têm
`preco_custo_medio`** maior que zero. Custo zerado
é **campo vazio, não produto de graça** — nunca calcule margem com ele, e diga
que o custo não está cadastrado.

Para os três carros-chefe, o custo de verdade é calculado na aba **Centro de
Custo** do DataCoreHS, que rateia a nota de importação, o desembaraço e o
overhead por unidade. A configuração fica em `tiny.centro_custo_config`
(`produto`, `ano`, `config_json`), mas **a conta é da tela, não do banco**:

| produto no Centro de Custo | ano |
|---|---|
| `BAFÔMETRO PHOEBUS` | 2026 |
| `BAFÔMETRO PASSIVO - IBLOW 10 PRO` | 2026 |
| `BAFÔMETRO - MARK X PLUS` | 2026 |

⚠️ **Não reconstrua esse custo somando `custos_diretos` do `config_json`.** Isso
dá só o custo direto e deixa de fora o rateio da importação e do overhead, que é
a maior parte. Para custo cheio, aponte para a aba Centro de Custo; o que você
pode entregar é o `preco_custo_medio` onde ele existir, dito como tal.

## Ao responder

- **Diga a régua em uma linha:** "contas a pagar por data de emissão, fora os
  grupos 7 e 8 (impostos), jan–ago/2026".
- **Diga o período e o que ficou fora** — mês incompleto, grupo 6.
- ⚠️ **Tabela mês a mês: cada número sai de uma linha do resultado da consulta,
  e a soma das linhas tem que dar a média × número de meses.** Em 29/09/2026 a
  média veio certa (R$ 674.376) e a tabela mensal ao lado veio inventada —
  janeiro com R$ 1,04 mi em vez de R$ 948.709, as linhas somando uma média de
  R$ 905 mil. Some antes de entregar; se não fechar, refaça a consulta por mês
  em vez de corrigir à mão. O mesmo vale para contagem: "N aparelhos sem custo"
  é a soma das linhas sem custo, não uma estimativa.
- **Mostre os grupos**, não só o total. "R$ 690 mil" sem dizer que metade é
  importação leva a uma decisão errada.
- Estoque: **quantidade, preço de venda e custo por modelo**, e onde o custo
  não existe, escreva "custo não cadastrado" — não zero, não traço mudo.

## Notas relacionadas

- Em aberto, vencido, quanto falta pagar: skill `contas-receber` (cobre as duas
  tabelas).
- Faturamento (receita): skill `faturamento`.
- A régua mora no DataCoreHS: `frontend/src/pages/financeiro/financeiro.ts`
  (`montarBalancete`, `GRUPOS_DE_CATEGORIA`) e `centroCusto.ts`. ⚠️ **Régua muda
  lá primeiro** — ao divergir, o número do painel manda.
