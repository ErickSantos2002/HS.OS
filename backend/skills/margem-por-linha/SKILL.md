---
name: margem-por-linha
description: >-
  O que dá dinheiro na Health & Safety, pelo DataCoreHS: receita, custo da
  mercadoria e margem bruta por linha de negócio (aparelho, consumível,
  acessório, calibração, plataforma, locação, serviço técnico) e por produto.
  Use SEMPRE que perguntarem margem de produto, margem por linha, "o que dá
  dinheiro?", "qual produto rende mais?", mix de receita, participação da
  calibração ou da plataforma, ou custo e margem de um aparelho.
emoji: 🧮
always: false
---

# Margem por linha — o que dá dinheiro

Duas fontes, as duas do DataCoreHS (dbt, refeito toda madrugada às 05:00):

- **`gold.margem_por_linha_mensal`** — mês × linha: `receita`, `cmv`, `lucro_bruto`,
  `receita_com_custo`, `cobertura_custo_pct`, `quantidade`, `notas`. ⚠️ O
  `lucro_bruto` da tabela é a receita INTEIRA menos o cmv — inclui a receita de
  produto sem custo. Use o `lucro_bruto_com_custo` da consulta, nunca divida o
  `lucro_bruto` pela receita com custo (dá margem acima de 100%).
- **`gold.fato_vendas`** — item a item, para o detalhe por produto: `linha`,
  `quantidade`, `valor_nota_rateado`, `custo_unitario`, `cmv`, `fonte_custo`.

A linha é régua do DataCoreHS (seed produto a produto; serviço pela discriminação
da nota). **Não reclassifique produto nem nota aqui** — linha errada se corrige lá.

## O que você precisa saber antes de responder

1. ⚠️ **A margem daqui é sobre a RECEITA BRUTA, antes dos impostos sobre venda.**
   A margem bruta da skill `resultado-mensal` é sobre a receita líquida. As duas
   estão certas e não são o mesmo número — diga sempre qual é: *"margem bruta sobre
   a receita bruta, antes dos impostos"*.
2. **Só produto tem custo direto.** Calibração, plataforma, locação e serviço
   técnico entram só com receita: o custo deles (gás, laboratório, pessoal) está na
   despesa operacional, sem rateio por linha. **Nunca diga que serviço tem margem
   de 100%** — diga que o custo direto não é rastreado e mostre a receita e a
   participação.
3. **A margem é sobre a receita COM custo.** Produto sem custo cadastrado não entra
   na margem; a `cobertura_custo_pct` diz quanto da receita ficou de fora. Abaixo
   de 95%, diga isso junto da margem.
4. O custo do aparelho já inclui importação: preço do fornecedor, II, PIS, COFINS e
   desembaraço (confirmado pelo Financeiro em 19/11/2026). Margem alta de aparelho
   é real, não falta de custo.
5. `outro` são notas de serviço que não são de nenhuma linha, cada uma com motivo
   registrado no DataCoreHS. Mostre como linha própria, sem explicar além disso.

⚠️ **Nunca some, divida nem compare de cabeça.** Participação, margem, receita por
unidade: tudo sai das consultas.

## Consulta 1 — por linha, no período

Troque só o período.

```sql
WITH p AS (
  SELECT tipo, linha,
         sum(receita)          AS receita,
         sum(receita_com_custo) AS receita_com_custo,
         sum(cmv)              AS cmv,
         sum(lucro_bruto)      AS lucro_bruto,
         sum(quantidade)       AS quantidade,
         sum(notas)            AS notas
    FROM gold.margem_por_linha_mensal
   WHERE mes BETWEEN DATE '2026-01-01' AND DATE '2026-10-01'
   GROUP BY tipo, linha)
SELECT tipo, linha,
       round(receita)                                              AS receita,
       round(100 * receita / sum(receita) OVER (), 1)              AS participacao_pct,
       round(cmv)                                                  AS cmv,
       round(receita_com_custo - cmv)                              AS lucro_bruto_com_custo,
       round(100 * (receita_com_custo - cmv) / nullif(receita_com_custo, 0), 1)
                                                                   AS margem_bruta_pct,
       round(100 * receita_com_custo / nullif(receita, 0), 1)      AS cobertura_custo_pct,
       round(quantidade)                                           AS quantidade,
       notas,
       round(sum(receita) OVER ())                                 AS receita_total_periodo
  FROM p
 ORDER BY receita DESC;
```

Para a evolução mês a mês de uma linha: mesma tabela, `WHERE linha = '…'`,
`GROUP BY mes`, e a margem calculada no SQL do mesmo jeito.

## Consulta 2 — por produto

```sql
SELECT f.linha, p.nome AS produto,
       sum(f.quantidade)::int                                           AS quantidade,
       round(sum(f.valor_nota_rateado))                                 AS receita,
       round(sum(f.valor_nota_rateado) / nullif(sum(f.quantidade), 0))  AS receita_por_unidade,
       round(sum(f.cmv) / nullif(sum(f.quantidade) FILTER (WHERE f.cmv IS NOT NULL), 0))
                                                                        AS custo_por_unidade,
       round(sum(f.cmv))                                                AS cmv,
       round(100 * (sum(f.valor_nota_rateado) FILTER (WHERE f.cmv IS NOT NULL) - sum(f.cmv))
             / nullif(sum(f.valor_nota_rateado) FILTER (WHERE f.cmv IS NOT NULL), 0), 1)
                                                                        AS margem_bruta_pct,
       string_agg(DISTINCT f.fonte_custo, ', ')                         AS fonte_custo
  FROM gold.fato_vendas f
  JOIN gold.dim_produto p USING (sk_produto)
 WHERE f.data_venda >= DATE '2026-01-01' AND f.data_venda < DATE '2026-11-01'
 GROUP BY f.linha, p.nome
 ORDER BY receita DESC
 LIMIT 15;
```

`fonte_custo` diz de onde veio o custo: `centro_custo` (a tela Centro de Custo,
com importação), `cadastro` (o preço de custo do Tiny) ou `sem_custo`. Produto
`sem_custo` aparece com custo e margem nulos: diga "custo não cadastrado", nunca
zero.

## Ao responder

- **Comece pela linha que mais pesa e pela margem do aparelho**, em uma frase:
  *"De jan a out/2026, aparelho é X% da receita, com margem bruta de Y% sobre a
  receita bruta; calibração é a segunda linha, Z%, sem custo direto rastreado."*
- Depois a tabela da Consulta 1 (linha, receita, participação, margem, cobertura).
- Produto, só se perguntarem ou se um produto explicar a resposta (Consulta 2).
- **Não ranqueie serviço contra produto por margem** — serviço não tem margem
  calculada. Compare serviço por receita e participação.
- Mês corrente na conta: diga que está em curso.
- Lista longa de produtos vai para planilha (`enviar_arquivo`), não para o chat.

## Notas relacionadas

- Lucro do mês, depois de todas as despesas: skill `resultado-mensal`.
- Custo de operar e estoque: skill `custos`. Faturamento por cliente e vendedor:
  skill `faturamento`.
- A régua mora no DataCoreHS: `analytics/models/gold/margem_por_linha_mensal.sql`,
  seeds `linha_produto` e `linha_servico_excecao`. ⚠️ **Régua muda lá primeiro.**
