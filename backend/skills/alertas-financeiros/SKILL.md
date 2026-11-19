---
name: alertas-financeiros
description: >-
  Os alertas financeiros do dia da Health & Safety: o que pede ação do dono
  antes que ele pergunte — aperto de caixa nas próximas semanas, cliente que
  virou inadimplente desde o último dia útil, mês que fechou em prejuízo,
  importação grande lançada e projeção de caixa desatualizada. Use no resumo
  diário e SEMPRE que perguntarem "tem algo que eu precise saber?", "algum
  alerta?", "o que pede atenção?" ou "alguma coisa preocupante?".
emoji: 🚨
always: false
---

# Alertas financeiros — o que pede ação hoje

Um CFO não espera a pergunta. Esta consulta devolve **uma linha por alerta que
disparou hoje**, e **nenhuma linha quando não há nada**. Os limites estão nela e
foram medidos para não virar ruído: com eles, "cliente virou inadimplente" teria
disparado em 9 de 41 dias úteis (set–nov/2026).

⚠️ **Sem linha = sem seção de alerta.** Não escreva "nenhum alerta hoje", não
invente alerta, não promova um número do resumo a alerta por conta própria. O que
é alerta é o que a consulta devolveu.

⚠️ **Nunca some nem compare de cabeça** — os valores, as datas e os nomes vêm
prontos nas colunas.

## A consulta

```sql
WITH hoje AS (SELECT current_date AS d),
ant AS (SELECT max(t.data) AS d FROM gold.dim_tempo t, hoje
         WHERE t.dia_util AND t.data < hoje.d),
-- dia útil do mês (1º, 2º…): o alerta de mês fechado só vale nos 5 primeiros
du AS (SELECT count(*) AS n FROM gold.dim_tempo t, hoje
        WHERE t.dia_util AND t.data >= date_trunc('month', hoje.d) AND t.data <= hoje.d),
cx AS (SELECT * FROM gold.caixa_semanal),
pior AS (SELECT semana, inicio_semana, fim_semana, fluxo_acumulado_conservador
           FROM cx ORDER BY fluxo_acumulado_conservador, semana LIMIT 1),
rec AS (SELECT cliente_nome, vencimento, saldo FROM tiny.contas_receber
         WHERE excluida_na_origem_em IS NULL AND lower(situacao) IN ('aberto','pendente')),
-- passou de 30 dias de atraso desde o último dia útil (até 30 é atraso; depois, inadimplência)
virou AS (SELECT cliente_nome, count(*) AS titulos, sum(saldo) AS valor, min(vencimento) AS desde
            FROM rec, hoje, ant
           WHERE rec.vencimento + 30 >= ant.d AND rec.vencimento + 30 < hoje.d
           GROUP BY cliente_nome
          HAVING sum(saldo) >= 10000),
fechou AS (SELECT mes, resultado FROM gold.dre_mensal, hoje
            WHERE mes = (date_trunc('month', hoje.d) - interval '2 months')::date)
SELECT 1 AS ordem, 'projecao_desatualizada' AS alerta,
       'a projeção de caixa é de ' || to_char(max(data_referencia), 'DD/MM')
         || ': o cálculo da madrugada não rodou' AS o_que,
       NULL::numeric AS valor, NULL::text AS quando
  FROM cx, hoje HAVING max(data_referencia) < (SELECT d FROM hoje)
UNION ALL
SELECT 2, 'caixa_apertado',
       'no cenário pessimista o caixa fica negativo: é preciso ter este valor em conta, '
         || 'e o pior momento é a semana indicada',
       round(-pior.fluxo_acumulado_conservador),
       to_char(pior.inicio_semana, 'DD/MM') || ' a ' || to_char(pior.fim_semana, 'DD/MM')
  FROM pior WHERE pior.fluxo_acumulado_conservador < 0 AND pior.semana <= 4
UNION ALL
SELECT 3, 'importacao_lancada',
       'importação lançada para as próximas 4 semanas (sai do caixa e não é recorrente)',
       round(sum(saida_importacao)),
       to_char(min(inicio_semana) FILTER (WHERE saida_importacao > 0), 'DD/MM')
  FROM cx WHERE semana <= 4 HAVING sum(saida_importacao) >= 50000
UNION ALL
SELECT 4, 'cliente_virou_inadimplente',
       cliente_nome || ' passou de 30 dias de atraso (' || titulos || ' título(s))',
       round(valor), 'vencido desde ' || to_char(desde, 'DD/MM')
  FROM virou
UNION ALL
SELECT 5, 'mes_fechou_em_prejuizo',
       to_char(fechou.mes, 'MM/YYYY') || ' fechou em prejuízo (agora é número medido)',
       round(fechou.resultado), NULL
  FROM fechou, du WHERE du.n <= 5 AND fechou.resultado < 0
ORDER BY ordem, valor DESC NULLS LAST;
```

## Como cada alerta é dito

| `alerta` | o que dizer | o que oferecer |
|---|---|---|
| `projecao_desatualizada` | o caixa de hoje não é confiável: a projeção é de outro dia | chame `avisar_administrador` uma vez |
| `caixa_apertado` | "No cenário pessimista é preciso ter R$ `valor` em conta; o aperto é na semana de `quando`." | saldo mínimo projetado, se ele disser o saldo (skill `caixa-projetado`) |
| `importacao_lancada` | "Há R$ `valor` de importação lançada a partir de `quando`." | o caixa das semanas com ela |
| `cliente_virou_inadimplente` | uma linha por cliente: nome, valor em aberto, desde quando | a lista de inadimplência (`inadimplencia`) |
| `mes_fechou_em_prejuizo` | "`o_que`: R$ `valor`." | o DRE do mês (skill `resultado-mensal`) |

- **Alertas vão primeiro**, antes de qualquer outro número, em lista curta.
- **Não explique a causa** do alerta além do que a linha diz. Oferecer o próximo
  passo é o que faz o alerta virar decisão; adivinhar a causa não.
- **Cliente inadimplente é dado nominal**: só na conversa direta com quem pode ver
  dado financeiro, nunca à Nina, nunca em página.

## Notas relacionadas

- Caixa semana a semana: skill `caixa-projetado`. Resultado do mês: skill
  `resultado-mensal`. Títulos, vencidos e agenda: skill `contas-receber`.
- Limite mudou? Mude aqui, com a medição de quantos dias ele dispararia, e diga na
  nota: alerta que dispara todo dia ninguém lê.
