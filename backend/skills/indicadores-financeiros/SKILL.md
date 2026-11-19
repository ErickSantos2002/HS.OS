---
name: indicadores-financeiros
description: >-
  Os indicadores de CFO da Health & Safety, pelo DataCoreHS: ponto de
  equilíbrio (quanto faturar por mês para empatar), concentração de clientes
  (quanto da receita depende dos maiores) e capital de giro (prazo médio de
  recebimento, dinheiro parado em estoque, dívida e parcelamentos por ano).
  Use SEMPRE que perguntarem ponto de equilíbrio, break-even, "quanto preciso
  faturar", dependência de cliente, maiores clientes, risco de perder um
  cliente, prazo de recebimento, PMR, estoque parado, capital de giro,
  endividamento ou "quanto devemos".
emoji: 📐
always: false
---

# Indicadores financeiros — equilíbrio, concentração e capital de giro

Três perguntas de CFO que o DRE e o caixa não respondem sozinhos. Tudo sai das
consultas abaixo, sobre as tabelas do DataCoreHS — **nenhuma conta de cabeça**,
nem a divisão final.

## Consulta 1 — ponto de equilíbrio

Média dos últimos **6 meses medidos** (fora o corrente e o anterior, que ainda
recebem lançamento).

```sql
WITH m AS (
  SELECT * FROM gold.dre_mensal
   WHERE mes_lancado
     AND mes <  (date_trunc('month', current_date) - interval '1 month')::date
   ORDER BY mes DESC LIMIT 6)
SELECT min(to_char(mes, 'MM/YYYY')) || ' a ' || max(to_char(mes, 'MM/YYYY')) AS periodo,
       round(avg(receita_bruta))                                       AS receita_media_mes,
       round(100 * sum(receita_bruta - impostos_sobre_venda - cmv)
                 / nullif(sum(receita_bruta), 0), 1)                    AS margem_contribuicao_pct,
       round(avg(despesa_operacional + despesa_financeira))             AS despesa_fixa_media_mes,
       round(avg(despesa_operacional + despesa_financeira)
             / nullif(sum(receita_bruta - impostos_sobre_venda - cmv)
                      / nullif(sum(receita_bruta), 0), 0))              AS ponto_de_equilibrio_mes,
       round(avg(despesa_operacional + despesa_financeira + amortizacao_de_divida)
             / nullif(sum(receita_bruta - impostos_sobre_venda - cmv)
                      / nullif(sum(receita_bruta), 0), 0))              AS equilibrio_com_divida_mes,
       round(100 * (avg(receita_bruta)
             / nullif(avg(despesa_operacional + despesa_financeira)
                      / nullif(sum(receita_bruta - impostos_sobre_venda - cmv)
                               / nullif(sum(receita_bruta), 0), 0), 0) - 1), 1)
                                                                        AS folga_sobre_equilibrio_pct,
       count(*) FILTER (WHERE receita_bruta
             < (despesa_operacional + despesa_financeira)
               / nullif((receita_bruta - impostos_sobre_venda - cmv)
                        / nullif(receita_bruta, 0), 0))                 AS meses_abaixo_do_equilibrio
  FROM m;
```

- **Margem de contribuição** = o que sobra de cada R$ 100 de receita depois dos
  impostos sobre venda e do custo da mercadoria.
- **Ponto de equilíbrio** = despesa operacional + financeira ÷ margem de
  contribuição: o faturamento bruto mensal em que o resultado zera.
  **Com a dívida**, o faturamento em que também se paga o banco sem tirar do caixa.
- ⚠️ É uma aproximação, e diga isso: a despesa operacional tem uma parte que
  varia com a venda (frete, comissão), tratada aqui como fixa — o equilíbrio sai
  um pouco **acima** do real, que é o erro seguro.

## Consulta 2 — concentração de clientes

Últimos 12 meses, vendas + serviços, agrupando a empresa pela **raiz do CNPJ**
(filial e grafia diferente são o mesmo cliente).

```sql
WITH r AS (
  SELECT f.sk_cliente, f.valor_nota_rateado AS valor
    FROM gold.fato_vendas f
   WHERE f.data_venda >= current_date - 365
  UNION ALL
  SELECT s.sk_cliente, s.valor_servicos
    FROM gold.fato_servicos s
   WHERE s.data_servico >= current_date - 365),
c AS (
  SELECT CASE WHEN length(regexp_replace(dc.documento, '\D', '', 'g')) = 14
              THEN left(regexp_replace(dc.documento, '\D', '', 'g'), 8)
              ELSE coalesce(nullif(dc.documento, ''), dc.nome) END AS empresa,
         max(dc.nome) AS nome, sum(r.valor) AS receita
    FROM r JOIN gold.dim_cliente dc USING (sk_cliente)
   GROUP BY 1),
o AS (
  SELECT nome, receita,
         row_number() OVER (ORDER BY receita DESC) AS posicao,
         sum(receita) OVER () AS total
    FROM c)
SELECT posicao, nome, round(receita) AS receita_12m,
       round(100 * receita / total, 1)                                   AS pct_da_receita,
       round(100 * sum(receita) OVER (ORDER BY posicao) / total, 1)      AS pct_acumulado,
       round(total)                                                      AS receita_total_12m,
       (SELECT count(*) FROM c)                                          AS clientes_com_receita
  FROM o
 WHERE posicao <= 10
 ORDER BY posicao;
```

- Leia o `pct_acumulado` na 1ª, na 5ª e na 10ª linha: é a dependência.
- ⚠️ **Nome de cliente é dado nominal**: só na conversa direta com quem pode ver
  dado financeiro; à Nina, só os percentuais.

## Consulta 3 — capital de giro

```sql
WITH pmr AS (
  SELECT round(sum((data_liquidacao - data_emissao) * valor) / nullif(sum(valor), 0))
           AS prazo_medio_recebimento_dias,
         round(sum((data_liquidacao - data_vencimento) * valor)
               FILTER (WHERE data_liquidacao > data_vencimento)
               / nullif(sum(valor) FILTER (WHERE data_liquidacao > data_vencimento), 0))
           AS atraso_medio_de_quem_atrasa_dias,
         round(100 * sum(valor) FILTER (WHERE data_liquidacao > data_vencimento)
               / nullif(sum(valor), 0), 1) AS pct_recebido_com_atraso
    FROM gold.fato_contas_receber
   WHERE NOT cancelada AND NOT excluida_na_origem
     AND data_liquidacao >= current_date - 180 AND data_liquidacao < current_date),
receber AS (
  SELECT round(sum(saldo)) AS a_receber_em_aberto
    FROM gold.fato_contas_receber WHERE em_aberto AND NOT excluida_na_origem),
custo AS (  -- custo unitário mais recente de cada produto vendido
  SELECT DISTINCT ON (sk_produto) sk_produto, custo_unitario
    FROM gold.fato_vendas WHERE custo_unitario IS NOT NULL
   ORDER BY sk_produto, data_venda DESC),
estoque AS (
  SELECT round(sum(p.saldo * coalesce(cu.custo_unitario, nullif(p.preco_custo_medio, 0),
                                      nullif(p.preco_custo, 0)))) AS estoque_a_custo,
         count(*) FILTER (WHERE p.saldo > 0
                          AND coalesce(cu.custo_unitario, nullif(p.preco_custo_medio, 0),
                                       nullif(p.preco_custo, 0)) IS NULL) AS produtos_em_estoque_sem_custo
    FROM gold.dim_produto p LEFT JOIN custo cu USING (sk_produto)
   WHERE p.saldo > 0 AND p.situacao = 'A'),
divida AS (
  SELECT extract(year FROM data_vencimento)::int AS ano,
         round(sum(saldo) FILTER (WHERE natureza = 'divida'))           AS emprestimo,
         round(sum(saldo) FILTER (WHERE natureza = 'imposto_venda'
                                    AND parcela_de_parcelamento))      AS impostos_parcelados
    FROM gold.fato_contas_pagar
   WHERE em_aberto AND (natureza = 'divida' OR parcela_de_parcelamento)
   GROUP BY 1)
SELECT 'prazo_medio_recebimento_dias' AS indicador, pmr.prazo_medio_recebimento_dias::text AS valor FROM pmr
UNION ALL SELECT 'atraso_medio_de_quem_atrasa_dias', atraso_medio_de_quem_atrasa_dias::text FROM pmr
UNION ALL SELECT 'pct_recebido_com_atraso', pct_recebido_com_atraso::text FROM pmr
UNION ALL SELECT 'a_receber_em_aberto', a_receber_em_aberto::text FROM receber
UNION ALL SELECT 'estoque_a_custo', estoque_a_custo::text FROM estoque
UNION ALL SELECT 'produtos_em_estoque_sem_custo', produtos_em_estoque_sem_custo::text FROM estoque
UNION ALL SELECT 'divida_' || ano || '_emprestimo', emprestimo::text FROM divida WHERE emprestimo IS NOT NULL
UNION ALL SELECT 'divida_' || ano || '_impostos_parcelados', impostos_parcelados::text FROM divida
                                                             WHERE impostos_parcelados IS NOT NULL
ORDER BY 1;
```

- **Prazo médio de recebimento**: da emissão ao dinheiro entrar, ponderado pelo
  valor, nos títulos recebidos nos últimos 180 dias. ⚠️ A baixa do boleto no Tiny
  é manual: o prazo pode sair alguns dias maior que o real.
- **Estoque a custo**: saldo do Tiny × custo unitário (o do Centro de Custo,
  senão o do cadastro). Produto em estoque sem custo fica fora — diga quantos.
- **Dívida por ano de vencimento**: empréstimo do Itaú e parcelamentos de imposto
  ainda em aberto. ⚠️ Os parcelamentos podem ter reajuste: o valor do Tiny é o
  do lançamento, não o atualizado nos portais (Financeiro, 19/11/2026).
- Prazo médio de **pagamento** não existe aqui: o a pagar é lançado depois de
  pago, então a data de lançamento não diz quando a conta nasceu.

## Ao responder

- **Uma frase com o número que responde a pergunta**, depois o resto: *"Para
  empatar, a empresa precisa faturar R$ X por mês (R$ Y pagando também o banco);
  nos últimos 6 meses a média foi R$ Z, Q% acima."*
- Concentração: *"Os 5 maiores clientes são X% da receita dos últimos 12 meses;
  o maior, sozinho, Y%."*
- Diga o período e a aproximação de cada indicador, em meia linha.
- Resposta de número é texto e tabela. Painel só se pedirem.

## Notas relacionadas

- Resultado do mês: skill `resultado-mensal`. Caixa das próximas semanas: skill
  `caixa-projetado`. Inadimplência e vencidos: skill `contas-receber`.
- Tabelas do DataCoreHS: `dre_mensal`, `fato_vendas`, `fato_servicos`,
  `fato_contas_receber`, `fato_contas_pagar`, `dim_produto`, `dim_cliente`.
