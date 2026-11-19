---
name: resultado-mensal
description: >-
  O resultado do mês da Health & Safety (DRE) pelo DataCoreHS: se o mês deu lucro
  ou prejuízo, quanto sobrou, margem, resultado operacional, resultado depois de
  pagar a dívida, e a comparação entre meses ou no período. Use SEMPRE que
  perguntarem lucro, prejuízo, resultado, DRE, margem da empresa, "quanto
  sobrou", "deu lucro?", "fechamos no azul?" ou "como foi o mês".
emoji: 📊
always: false
---

# Resultado do mês — o DRE do DataCoreHS

O resultado mora numa tabela só: **`gold.dre_mensal`**, uma linha por mês, montada
pelo dbt do DataCoreHS (refeita toda madrugada às 05:00). A régua é dela.

⚠️ **Nunca monte resultado como "faturamento − custo" com as outras skills.** Seria
uma segunda régua: a receita da `faturamento` e a despesa da `custos` não usam as
mesmas exceções que o DRE (parcelamento no mês da parcela, dívida fora do
resultado), e o número mudaria conforme você montasse o SQL.

**O DRE desconta o custo da mercadoria vendida (CMV)** desde 19/11/2026: cada item
vendido leva o custo unitário do produto — dos carros-chefe, o da tela Centro de
Custo (importação e custos diretos, sem a despesa fixa, que já está no DRE); dos
outros, o do cadastro. ⚠️ **Produto sem custo cadastrado entra sem CMV**, e o
resultado daquele mês sai acima do real: a `cobertura_cmv_pct` diz quanto da
receita de produto tem custo, e a consulta transforma isso em ressalva. ⚠️ Antes
de 2026 o custo é o de 2026 aplicado ao passado (`cmv_de_outro_ano`): o lucro de
2024 e 2025 é aproximado.

⚠️ **Nunca some nem divida de cabeça.** Toda conta — total do período, margem,
variação contra o mês anterior, veredito — sai das consultas abaixo. A sua
resposta copia as colunas. Em 19/11/2026, na conferência, os três números que o
Midas calculou à mão saíram errados; os que vieram prontos da consulta, certos.

## As linhas do DRE

```
  receita bruta              vendas (gold.fato_vendas) + serviços (gold.fato_servicos)
− impostos sobre venda       grupo 7 do plano de contas
= receita líquida
− CMV                        custo da mercadoria vendida (fato_vendas.cmv)
= lucro bruto
− despesa operacional        grupos 1 a 6, 9 (cartão) e 10, mais conta sem categoria
= resultado operacional
− despesa financeira         tarifas bancárias
− impostos sobre lucro       grupo 8
= resultado                  ← "o lucro do mês"
− amortização de dívida      parcelas de empréstimo
= resultado após dívida      ← "o que sobrou depois de pagar o banco"

abaixo da linha, fora do resultado: importação (compra de estoque — o que já foi
vendido está no CMV), dividendos, investimento
```

Regras da tabela que você **diz** quando importam:

- **Mês = mês de emissão da conta**, a régua do Balancete. Exceção: **parcela de
  parcelamento** (empréstimo e imposto parcelado) entra no mês do **vencimento**.
  Sem isso, quatro anos de parcelas caíam no mês em que foram lançadas.
- **Dívida não é despesa.** A amortização fica fora do `resultado` e entra só no
  `resultado_apos_divida`. O Tiny lança a parcela inteira (principal + juros) numa
  conta só, então os juros também estão na amortização: o `resultado` sai um pouco
  **maior** que o contábil, e o `resultado_apos_divida` está certo.
- **Importação, dividendos e investimento** não entram no resultado. Mostre-os em
  linha própria quando aparecerem.
- **É resultado por competência de emissão, não caixa.** "Quanto entrou na conta"
  é a skill `contas-receber` (agenda de caixa), e saldo bancário não chega a você.

## Consulta 1 — o mês, ou meses lado a lado

Troque só o intervalo de `d.mes`. Para "o mês passado", ponha o mesmo mês nas duas
pontas.

```sql
WITH base AS (
  SELECT d.*,
         lag(d.resultado) OVER (ORDER BY d.mes) AS resultado_mes_anterior
    FROM gold.dre_mensal d
), hoje AS (SELECT date_trunc('month', current_date)::date AS m)
SELECT to_char(b.mes, 'YYYY-MM') AS mes,
       CASE WHEN NOT b.mes_lancado OR b.mes > h.m THEN 'futuro — ainda não é resultado'
            WHEN b.mes = h.m THEN 'em curso — parcial'
            WHEN b.mes = (h.m - interval '1 month')::date THEN 'provisório'
            ELSE 'medido' END                                          AS estado,
       b.receita_bruta, b.impostos_sobre_venda, b.receita_liquida,
       b.cmv, b.lucro_bruto,
       CASE WHEN b.mes_lancado AND b.mes <= h.m
            THEN round(100 * b.lucro_bruto / nullif(b.receita_liquida, 0), 1) END AS margem_bruta_pct,
       b.cobertura_cmv_pct, b.receita_produto_sem_custo,
       b.despesa_operacional, b.resultado_operacional,
       b.despesa_financeira, b.impostos_sobre_lucro,
       b.resultado,
       CASE WHEN b.mes_lancado AND b.mes <= h.m
            THEN round(100 * b.resultado / nullif(b.receita_liquida, 0), 1) END AS margem_pct,
       CASE WHEN NOT b.mes_lancado OR b.mes > h.m THEN NULL
            WHEN b.mes >= (h.m - interval '1 month')::date
              THEN 'ainda não fechou: falta despesa a lançar'
            WHEN b.resultado >= 0 THEN 'lucro' ELSE 'prejuízo' END      AS veredito,
       CASE WHEN b.mes_lancado AND b.mes <= h.m
            THEN (b.resultado - b.resultado_mes_anterior)::numeric(14,2) END
                                                                        AS variacao_vs_mes_anterior,
       b.amortizacao_de_divida, b.resultado_apos_divida,
       CASE WHEN NOT b.mes_lancado OR b.mes > h.m THEN NULL
            WHEN b.mes >= (h.m - interval '1 month')::date THEN 'ainda não fechou'
            WHEN b.resultado_apos_divida >= 0 THEN 'sobrou' ELSE 'faltou' END
                                                                        AS depois_da_divida,
       b.importacao, b.dividendos, b.investimento,
       b.despesa_grupo_1_equipe, b.despesa_grupo_2_sede,
       b.despesa_grupo_3_servicos_de_apoio, b.despesa_grupo_4_gerais,
       b.despesa_grupo_5_diretoria, b.despesa_grupo_6_materiais,
       b.despesa_grupo_9_cartoes, b.despesa_grupo_10_outros, b.despesa_sem_categoria,
       concat_ws('; ',
         CASE WHEN b.cobertura_cmv_pct < 95
              THEN 'só ' || round(b.cobertura_cmv_pct) || '% da receita de produto tem custo cadastrado: o resultado sai acima do real' END,
         CASE WHEN b.cmv_de_outro_ano <> 0
              THEN 'custo da mercadoria de outro ano: lucro aproximado' END,
         CASE WHEN NOT b.tem_fatura_cartao
              THEN 'sem fatura de cartão no Tiny: despesa subestimada' END,
         CASE WHEN b.despesa_sem_categoria <> 0
              THEN 'há conta sem categoria no Tiny' END,
         CASE WHEN b.valor_reclassificado_nao_confirmado <> 0
              THEN 'parcelas do Itaú tratadas como dívida, a confirmar pelo Financeiro' END,
         'pessoal parcial: o Tiny tem o salário líquido, não a folha')  AS ressalvas,
       (    abs(b.receita_liquida - (b.receita_bruta - b.impostos_sobre_venda)) < 0.01
        AND abs(b.lucro_bruto - (b.receita_liquida - b.cmv)) < 0.01
        AND abs(b.resultado_operacional - (b.lucro_bruto - b.despesa_operacional)) < 0.01
        AND abs(b.despesa_operacional - (b.despesa_grupo_1_equipe + b.despesa_grupo_2_sede
              + b.despesa_grupo_3_servicos_de_apoio + b.despesa_grupo_4_gerais
              + b.despesa_grupo_5_diretoria + b.despesa_grupo_6_materiais
              + b.despesa_grupo_9_cartoes + b.despesa_grupo_10_outros
              + b.despesa_sem_categoria)) < 0.01
        AND abs(b.resultado - (b.resultado_operacional
              - b.despesa_financeira - b.impostos_sobre_lucro)) < 0.01
        AND abs(b.resultado_apos_divida - (b.resultado - b.amortizacao_de_divida)) < 0.01
       )                                                                AS fecha
  FROM base b CROSS JOIN hoje h
 WHERE b.mes BETWEEN DATE '2026-08-01' AND DATE '2026-10-01'
 ORDER BY b.mes;
```

## Consulta 2 — o período (trimestre, ano, "até agora")

Soma só mês que já aconteceu, e conta quantos dos meses somados ainda não são firmes.

```sql
WITH hoje AS (SELECT date_trunc('month', current_date)::date AS m),
p AS (
  SELECT d.*,
         (d.mes >= (h.m - interval '1 month')::date) AS nao_firme
    FROM gold.dre_mensal d CROSS JOIN hoje h
   WHERE d.mes BETWEEN DATE '2026-01-01' AND DATE '2026-12-01'   -- o período pedido
     AND d.mes_lancado
     AND d.mes <= h.m
)
SELECT min(to_char(mes, 'YYYY-MM')) AS de, max(to_char(mes, 'YYYY-MM')) AS ate,
       count(*)                                        AS meses,
       count(*) FILTER (WHERE nao_firme)               AS meses_provisorios_ou_em_curso,
       count(*) FILTER (WHERE NOT tem_fatura_cartao)   AS meses_sem_cartao,
       sum(receita_bruta)::numeric(14,2)               AS receita_bruta,
       sum(receita_liquida)::numeric(14,2)             AS receita_liquida,
       sum(cmv)::numeric(14,2)                         AS cmv,
       sum(lucro_bruto)::numeric(14,2)                 AS lucro_bruto,
       round(100 * sum(lucro_bruto) / nullif(sum(receita_liquida), 0), 1) AS margem_bruta_pct,
       sum(receita_produto_sem_custo)::numeric(14,2)   AS receita_produto_sem_custo,
       sum(cmv_de_outro_ano)::numeric(14,2)            AS cmv_de_outro_ano,
       sum(despesa_operacional)::numeric(14,2)         AS despesa_operacional,
       sum(resultado)::numeric(14,2)                   AS resultado,
       round(100 * sum(resultado) / nullif(sum(receita_liquida), 0), 1) AS margem_pct,
       sum(amortizacao_de_divida)::numeric(14,2)       AS amortizacao_de_divida,
       sum(resultado_apos_divida)::numeric(14,2)       AS resultado_apos_divida,
       sum(importacao)::numeric(14,2)                  AS importacao_no_periodo,
       count(*) FILTER (WHERE resultado < 0)           AS meses_com_prejuizo,
       CASE WHEN sum(resultado) FILTER (WHERE NOT nao_firme) >= 0
            THEN 'lucro' ELSE 'prejuízo' END              AS veredito_so_meses_medidos,
       sum(resultado) FILTER (WHERE NOT nao_firme)::numeric(14,2) AS resultado_so_meses_medidos
  FROM p;
```

O veredito do período é o dos meses medidos (`veredito_so_meses_medidos`). Se
`meses_provisorios_ou_em_curso` > 0, a resposta diz quais meses ficaram de fora do
veredito e por quê, e mostra o `resultado` com eles só como informação.

## Confira antes de responder

- **`fecha` tem que ser `true` em toda linha.** Ela refaz as contas do DRE dentro
  da própria linha. `false` = a tabela mudou de forma ou veio quebrada: **PARE**,
  não entregue número e chame `avisar_administrador` dizendo o mês.
- **Mês pedido sem linha, ou com `estado` "futuro"**: não há resultado desse mês.
  Diga isso; não preencha com zero.

## O estado do número — vai em toda resposta

| `estado` | o que dizer |
|---|---|
| `medido` | o número, com as `ressalvas` |
| `provisório` | ⚠️ **"provisório"**, sempre. O Financeiro lança conta já paga com emissão retroativa (mediana de 31 dias depois do pagamento; a meta da equipe é tudo lançado até o dia 15 do mês seguinte, segundo o Djalma em 19/11/2026): a despesa deste mês ainda vai subir |
| `em curso — parcial` | o mês não acabou; o número é só do que já foi lançado |
| `futuro — ainda não é resultado` | não é resultado de ninguém: são parcelas agendadas |

⚠️ **Mês provisório com margem alta é falta de lançamento, não lucro.** Despesa de
equipe ou impostos muito abaixo dos meses anteriores, num mês provisório, é conta
que ainda não entrou no Tiny. Nunca chame esse mês de "o melhor mês", nunca o use
como base de média ou de projeção, e não compare um mês provisório com um medido
sem dizer isso.

As `ressalvas` da consulta vão na resposta como estão, em uma linha. "Pessoal
parcial" vale sempre: nunca chame o grupo 1 de folha nem de custo de pessoal.

## Ao responder

- ⚠️ **Mês provisório ou em curso NÃO abre com "lucro" nem "prejuízo"** — a
  consulta já devolve `veredito` = "ainda não fechou". Quem lê só a primeira
  linha (o CEO, no celular) leva o veredito embora. Abra assim: *"Outubro ainda
  não fechou: o que está lançado dá R$ X, mas falta despesa a lançar."* Em 19/11/2026 a abertura dizia "lucro" e a frase seguinte
  "não é lucro".
- **Mês medido: comece pelo veredito e pelo `resultado`**, com o mês e o `estado`: *"Setembro/2026
  fechou com prejuízo de R$ X (medido)."* Depois a margem, o lucro bruto e a
  margem bruta, o resultado após a dívida e, se pedirem, as linhas do DRE e os
  grupos de despesa.
- **Duas margens, com nome:** `margem_bruta_pct` (depois do custo da mercadoria) e
  `margem_pct` (depois de tudo). Nunca "a margem" sem dizer qual.
- **Importação não é custo do mês**: é estoque comprado. Se perguntarem por que o
  caixa não acompanha o lucro, ela é uma das razões — mostre-a como linha própria.
- **"Quanto sobrou"** é o `resultado_apos_divida` — diga que é depois de pagar as
  parcelas do empréstimo. **"Lucro"** é o `resultado`.
- **Explique o veredito só com o que a consulta mostrou.** Causa que você não
  mediu, você não afirma (ver o AGENTS.md: achado tem cadeia).
- Tabela de vários meses: cada número sai de uma linha da Consulta 1; total do
  período sai da Consulta 2. Não some as linhas da Consulta 1 na resposta.

## Notas relacionadas

- Receita detalhada (por produto, vendedor, cliente; meta do trimestre): skill
  `faturamento`.
- Despesa detalhada por conta, estoque e preço de custo: skill `custos`.
- Caixa — o que entra e sai nas próximas semanas: skill `contas-receber`.
- A régua mora no DataCoreHS: `analytics/models/gold/dre_mensal.sql` e
  `fato_contas_pagar.sql` (onde nasce o mês do DRE). ⚠️ **Régua muda lá
  primeiro.**
