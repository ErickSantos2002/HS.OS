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
irregular.** Em jan–jul/2026 ele foi quase metade do custo sem impostos, e só
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
   AND data_emissao <  DATE '2026-08-01'
 GROUP BY 1, 2
 ORDER BY 1, 2;
```

Some os grupos na resposta, não na consulta: assim você tem o detalhe para
mostrar "sem impostos" e "sem impostos e sem mercadoria" a partir do mesmo
resultado.

### ⚠️ Antes de usar um mês recente, confira se ele está completo

**Agosto/2026 está quebrado na base** — 11 contas vivas e 44 marcadas como
excluídas, contra 98 a 141 contas nos meses anteriores; a soma sem impostos
cai para menos de R$ 10 mil. Não é a empresa gastando pouco, é carga
incompleta (em investigação no DataCoreHS). Setembro também está baixo.

Toda vez, antes de responder, rode:

```sql
SELECT to_char(data_emissao, 'YYYY-MM') AS mes,
       count(*) FILTER (WHERE excluida_na_origem_em IS NULL)     AS vivas,
       count(*) FILTER (WHERE excluida_na_origem_em IS NOT NULL) AS excluidas
  FROM tiny.contas_pagar
 WHERE data_emissao >= date_trunc('month', current_date) - interval '6 months'
 GROUP BY 1 ORDER BY 1;
```

Mês com muito menos contas vivas que os vizinhos, ou mais excluídas que vivas,
**fica fora da média** — e você diz isso na resposta: *"agosto e setembro ficaram
fora porque a base deles está incompleta"*. Média com mês quebrado dentro é
número errado com cara de certo.

### Confira antes de responder

Rode a consulta para **julho/2026** e compare:

| resultado sem impostos | leitura |
|---|---|
| **R$ 425.234,96** | ✅ certo — siga |
| R$ 432.254,87 | esqueceu `excluida_na_origem_em IS NULL` |
| R$ 550.758,27 | não tirou os grupos 7 e 8 |
| R$ 418.382,85 | tirou também o grupo 6 (é o número "sem mercadoria", não o sem impostos) |

**Bateu, siga. Não bateu, PARE** e diga o que divergiu. Julho foi escolhido por
ter contas excluídas e grupo 6 pequeno — exercita os dois filtros que erram.

Retrato de jan–jul/2026, média por mês, para você saber o tamanho:

| | média/mês |
|---|---|
| total (com impostos) | R$ 869.311 |
| sem impostos (fora 7 e 8) | **R$ 689.859** |
| sem impostos e sem mercadoria (fora 6, 7 e 8) | **R$ 318.546** |
| … dos quais equipe (grupo 1) | R$ 114.083 |

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
  grupos 7 e 8 (impostos), jan–jul/2026".
- **Diga o período e o que ficou fora** — mês incompleto, grupo 6.
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
