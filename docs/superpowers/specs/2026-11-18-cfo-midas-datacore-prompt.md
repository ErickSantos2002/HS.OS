# Prompt para a sessão do DataCore — base financeira do Midas

> Abrir `cd ~/github/DataCore && claude` e colar o texto abaixo. Vem da seção "Para o DataCore" de
> `~/github/HS.OS/docs/superpowers/specs/2026-11-18-cfo-midas-design.md`.

---

Você vai construir, no dbt do DataCore (`analytics/`), a base de contas a pagar e o DRE mensal que
o Midas (agente CFO do HS.OS) vai ler. Só leitura do `tiny.contas_pagar`; nada de escrita no Tiny.

**Antes de escrever qualquer coisa**, confira as convenções reais de `analytics/`: como são
os modelos `silver/stg_*`, onde ficam os seeds, como os testes e o `dim_tempo` são declarados.
Use `analytics/models/gold/fato_contas_receber.sql` como modelo (grão, três datas, nada que
dependa de "hoje" dentro do fato). O que estiver abaixo e divergir das convenções, vale a convenção.

## Entregas

1. **`silver.stg_contas_pagar`** — de `tiny.contas_pagar`, sem `excluida_na_origem_em`, com a
   situação normalizada: `aberto`/`pendente` = aberto, `pago` = quitado, `cancelada` fora dos dois.

2. **Seed `categoria_dre.csv`** — `categoria` (texto exato do Tiny) → `linha_dre`, `grupo`,
   `natureza` (`operacional`, `imposto_venda`, `imposto_lucro`, `financeiro`, `divida`,
   `dividendo`, `importacao`, `investimento`). Categorias duplicadas no Tiny apontam para a mesma
   linha. **Teste dbt: toda categoria que existe no Tiny tem linha no seed** — categoria nova
   precisa quebrar o build, nunca sumir do DRE em silêncio.

3. **Seed `excecoes_contas_pagar.csv`** — reclassificação por (`cliente_nome`, `categoria`,
   padrão de `historico`) → `linha_dre`, com colunas `motivo` e `confirmado` (sim/não). Primeira
   linha: Itaú, categoria 9.3, histórico com "Parcela" → dívida, **`confirmado = não`** (a
   classificação ainda não foi confirmada com o Financeiro).

4. **`gold.fato_contas_pagar`** — grão: a conta. Quatro datas (emissão, vencimento, competência,
   liquidação) ligadas ao `dim_tempo`; `linha_dre`, `natureza`, `reclassificada` e
   `reclassificacao_confirmada`.

5. **`gold.dre_mensal`** — **por mês de EMISSÃO**, a mesma régua de data do Balancete da tela
   (um DRE por competência ao lado do Balancete por emissão seriam dois "custos de outubro").
   Receita bruta = `fato_vendas` + `fato_servicos` (as réguas que já existem, sem refazê-las),
   impostos sobre venda, despesas por grupo, resultado operacional, financeiro e dívida, impostos
   sobre lucro, resultado; abaixo da linha: importação e dividendos. Coluna de qualidade
   `tem_fatura_cartao`. **Nada de "provisório" dentro do fato** — isso depende de hoje e é dito
   na consulta.

## Âncoras (obrigatórias)

- Despesa de **jul/2026** no `dre_mensal` = **R$ 462.917,93 sem impostos**, grupos 7 e 8 fora —
  o número do Balancete da tela, que é a autoridade de custo.
- ⚠️ Conferir só a soma passa igual com categoria na linha errada. A âncora tem que exercitar o
  mapeamento: confira também o total **por grupo** e à mão, no Tiny, as linhas de um mês fechado.
- O teste "toda categoria do Tiny tem linha no DRE" faz parte da entrega.

## Fora do escopo

- **Não mexer na tela do Balancete nesta entrega.** Ela pode passar a ler o `gold` depois.
- Nenhuma tela nova no painel.
- Quem lê: o usuário de leitura (já lê `tiny.contas_pagar`); confira o `GRANT` nos schemas novos.

Ao terminar, rode o build, informe as âncoras conferidas e o que ficou dependendo de
confirmação (o Itaú).
