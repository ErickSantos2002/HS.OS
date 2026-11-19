---
name: caixa-projetado
description: >-
  O caixa projetado da Health & Safety para as próximas 13 semanas, pelo
  DataCoreHS: o que deve entrar e sair por semana, o fluxo acumulado, a semana
  mais apertada e quanto é preciso ter em conta hoje para não ficar no vermelho.
  Use SEMPRE que perguntarem "vamos ter caixa?", fluxo de caixa, caixa projetado,
  próximas semanas ou meses, aperto de caixa, "dá para pagar X em tal data",
  "quanto preciso ter em conta" ou capital de giro.
emoji: 💧
always: false
---

# Caixa projetado — as próximas 13 semanas

A projeção mora numa tabela só: **`gold.caixa_semanal`**, uma linha por semana
(`semana` 0 = a corrente, a partir de hoje; 1 a 12 = as seguintes), refeita toda
madrugada às 05:00. A conta é do DataCoreHS (`analytics/macros/caixa_projetado.sql`):
**não refaça, não "corrija" e não some de cabeça.** Tudo o que a resposta diz sai das
duas consultas abaixo.

Para "o que vence esta semana" ou "quanto está vencido", título a título, a skill é a
`contas-receber`. Esta é para o **futuro agregado**.

## O que você precisa saber antes de responder

1. **É FLUXO, não saldo.** O saldo bancário não chega a você. A tabela diz quanto
   entra menos quanto sai; o saldo é o de hoje somado a isso. Se a pessoa disser o
   saldo, use-o (Consulta 2). Se não disser, a resposta é *quanto precisa ter em conta*.
2. **O a pagar é quase todo ESTIMADO.** O Financeiro lança a conta depois de paga,
   então a saída das próximas semanas vem do ritmo histórico de pagamento, por dia do
   mês. A entrada das primeiras semanas é quase toda **conhecida** (títulos já
   lançados); a das últimas é ritmo.
3. ⚠️ **A importação fica FORA, salvo se já estiver lançada** (`saida_importacao`). Ela é
   grande e irregular — já houve mês com mais de R$ 1,5 milhão. Toda resposta diz isso
   e pergunta se há importação prevista no período.
4. ⚠️ **O erro é grande.** Testada em datas passadas, a projeção errou o fluxo de 13
   semanas entre −77% e +100%. Ela serve para mostrar **a direção e onde está o aperto**,
   não para cravar um número. Por isso a resposta se apoia no `fluxo_acumulado_conservador`
   — o acumulado corrigido pelo viés do teste, só na direção pessimista.

## Consulta 1 — semana a semana

```sql
SELECT semana,
       to_char(inicio_semana, 'DD/MM') || ' a ' || to_char(fim_semana, 'DD/MM') AS periodo,
       round(entrada_total)               AS entra,
       round(entrada_conhecida)           AS entra_conhecido,
       round(saida_total)                 AS sai,
       round(saida_conhecida)             AS sai_conhecido,
       round(saida_importacao)            AS importacao_lancada,
       round(fluxo_liquido)               AS fluxo_da_semana,
       round(fluxo_acumulado)             AS acumulado,
       round(fluxo_acumulado_conservador) AS acumulado_pessimista,
       confianca,
       erro_tipico_entrada_pct, erro_tipico_saida_pct,
       data_referencia
  FROM gold.caixa_semanal
 ORDER BY semana;
```

## Consulta 2 — o veredito

Troque `NULL` pelo saldo em conta **se a pessoa o informou** (número, sem pontuação de
milhar). Sem saldo, deixe `NULL`.

```sql
WITH s AS (SELECT NULL::numeric AS saldo_hoje),
c AS (SELECT * FROM gold.caixa_semanal),
pior AS (
  SELECT semana, inicio_semana, fim_semana, fluxo_acumulado_conservador
    FROM c ORDER BY fluxo_acumulado_conservador, semana LIMIT 1),
imp AS (
  SELECT round(avg(importacao)) AS importacao_media_mes,
         count(*) FILTER (WHERE importacao > 0) AS meses_com_importacao
    FROM gold.dre_mensal
   WHERE mes_lancado
     AND mes >= date_trunc('month', current_date) - interval '12 months'
     AND mes <  date_trunc('month', current_date))
SELECT (SELECT data_referencia FROM c LIMIT 1)                       AS data_referencia,
       round((SELECT sum(fluxo_liquido) FROM c))                     AS fluxo_13_semanas,
       round((SELECT max(fluxo_acumulado_conservador) FILTER (WHERE semana = 12) FROM c))
                                                                     AS acumulado_pessimista_13_semanas,
       pior.semana                                                   AS semana_mais_apertada,
       to_char(pior.inicio_semana, 'DD/MM') || ' a ' || to_char(pior.fim_semana, 'DD/MM')
                                                                     AS periodo_mais_apertado,
       round(pior.fluxo_acumulado_conservador)                       AS pior_acumulado_pessimista,
       round(greatest(0, -pior.fluxo_acumulado_conservador))         AS precisa_ter_em_conta_hoje,
       round(s.saldo_hoje + pior.fluxo_acumulado_conservador)        AS saldo_minimo_projetado,
       CASE WHEN s.saldo_hoje IS NULL THEN
              CASE WHEN pior.fluxo_acumulado_conservador >= 0
                   THEN 'o fluxo não fica negativo em nenhuma semana, mesmo no cenário pessimista'
                   ELSE 'é preciso ter em conta hoje pelo menos o valor de precisa_ter_em_conta_hoje' END
            WHEN s.saldo_hoje + pior.fluxo_acumulado_conservador >= 0
              THEN 'o saldo informado cobre as 13 semanas no cenário pessimista'
            ELSE 'o saldo informado NÃO cobre: falta dinheiro na semana mais apertada' END
                                                                     AS veredito,
       (SELECT count(*) FILTER (WHERE confianca = 'alta')  FROM c)   AS semanas_confianca_alta,
       (SELECT count(*) FILTER (WHERE confianca = 'baixa') FROM c)   AS semanas_confianca_baixa,
       round((SELECT sum(saida_importacao) FROM c))                  AS importacao_lancada_no_periodo,
       imp.importacao_media_mes, imp.meses_com_importacao
  FROM s CROSS JOIN pior CROSS JOIN imp;
```

## Confira antes de responder

- **`data_referencia` tem que ser hoje.** A tabela é refeita de madrugada. Se a data
  for antiga, o build parou: diga a data e chame `avisar_administrador` — projeção
  velha com cara de nova é pior que nenhuma.
- A Consulta 1 tem que ter as semanas 0 a 12. Faltou semana: pare e avise.

## Ao responder

- **Comece pelo veredito da Consulta 2**, em uma frase. Sem saldo: *"Nas próximas 13
  semanas, no cenário pessimista, o aperto maior é a semana de 16/11 a 22/11: é preciso
  ter pelo menos R$ X em conta hoje."* Com saldo: *"Com R$ Y em conta, o saldo mínimo
  projetado é R$ Z, na semana de …"*.
- Em seguida, **o fluxo das 13 semanas** e, se pedirem, a tabela da Consulta 1 —
  `entra`, `sai`, `acumulado` e `confianca`. Semana com confiança `baixa` vai marcada.
- **Sempre, as três ressalvas, curtas:** (1) é fluxo, não saldo; (2) a importação
  só entra se lançada — cite `importacao_media_mes` e `meses_com_importacao` do último
  ano e pergunte se há importação prevista; (3) o erro típico é grande, então o número
  é direção, não valor exato.
- **Pagamento ou investimento pontual** ("dá para pagar R$ 200 mil em dezembro?"):
  subtraia o valor do `acumulado_pessimista` a partir da semana do pagamento **pela
  consulta**, não de cabeça — some uma coluna no SQL com `CASE WHEN inicio_semana >=
  DATE '…' THEN fluxo_acumulado_conservador - 200000 ELSE fluxo_acumulado_conservador END`
  e leia o menor valor.
- **Não explique o porquê** de uma semana ser negativa além do que as colunas mostram
  (conhecido × estimado, importação lançada, parcelas). Causa que você não mediu, você
  não afirma.
- Resposta de número é texto e tabela. Painel só se pedirem.

## Notas relacionadas

- Título a título, vencido, inadimplência, agenda desta semana: skill `contas-receber`.
- Resultado do mês (lucro, que é competência e não caixa): skill `resultado-mensal`.
  Lucro alto com caixa apertado é normal quando há importação, parcela de dívida ou
  venda a prazo — diga isso se perguntarem por que um não acompanha o outro.
- A régua mora no DataCoreHS: `analytics/macros/caixa_projetado.sql` e
  `models/gold/caixa_semanal.sql`. ⚠️ **Régua muda lá primeiro.**
