---
name: alertas-financeiros
description: >-
  Os alertas financeiros do dia da Health & Safety: o que pede ação do dono
  antes que ele pergunte — aperto de caixa nas próximas semanas, cliente que
  virou inadimplente desde o último dia útil, mês que fechou em prejuízo (no dia do fechamento),
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
-- o dia do fechamento: 1º dia útil a partir do dia 25 (o mês anterior fecha)
df AS (SELECT min(t.data) AS d FROM gold.dim_tempo t, hoje
        WHERE t.dia_util AND t.data >= date_trunc('month', hoje.d)::date + 24),
cx AS (SELECT * FROM gold.caixa_semanal),
pior AS (SELECT semana, inicio_semana, fim_semana, fluxo_acumulado_conservador
           FROM cx ORDER BY fluxo_acumulado_conservador, semana LIMIT 1),
rec AS (SELECT cliente_nome, cliente_cpf_cnpj, vencimento, saldo FROM tiny.contas_receber
         WHERE excluida_na_origem_em IS NULL AND lower(situacao) IN ('aberto','pendente')),
-- passou de 30 dias de atraso desde o último dia útil (até 30 é atraso; depois, inadimplência)
-- pela RAIZ do CNPJ (8 dígitos): o mesmo cliente aparece com grafias diferentes no
-- Tiny e com filiais de CNPJ diferente — o atraso de uma filial diz da empresa
virou AS (SELECT CASE WHEN length(regexp_replace(cliente_cpf_cnpj, '\D', '', 'g')) = 14
                      THEN left(regexp_replace(cliente_cpf_cnpj, '\D', '', 'g'), 8)
                      ELSE coalesce(nullif(cliente_cpf_cnpj, ''), cliente_nome) END AS chave,
                 max(cliente_nome) AS cliente_nome,
                 count(*) AS titulos, sum(saldo) AS valor, min(vencimento) AS desde
            FROM rec, hoje, ant
           WHERE rec.vencimento + 30 >= ant.d AND rec.vencimento + 30 < hoje.d
           GROUP BY 1
          HAVING sum(saldo) >= 10000),
-- histórico de 24 meses de quem virou: atraso habitual não é calote provável
hist AS (SELECT CASE WHEN length(regexp_replace(r.cliente_cpf_cnpj, '\D', '', 'g')) = 14
                      THEN left(regexp_replace(r.cliente_cpf_cnpj, '\D', '', 'g'), 8)
                      ELSE coalesce(nullif(r.cliente_cpf_cnpj, ''), r.cliente_nome) END AS chave,
                count(*) FILTER (WHERE r.liquidacao - r.vencimento > 30)   AS pagos_depois_de_30,
                round(percentile_cont(0.5) WITHIN GROUP (ORDER BY r.liquidacao - r.vencimento)
                      FILTER (WHERE r.liquidacao - r.vencimento > 0))        AS atraso_mediano
           FROM tiny.contas_receber r, hoje
          WHERE r.excluida_na_origem_em IS NULL AND r.liquidacao IS NOT NULL
            AND r.vencimento >= hoje.d - 730
            AND CASE WHEN length(regexp_replace(r.cliente_cpf_cnpj, '\D', '', 'g')) = 14
                      THEN left(regexp_replace(r.cliente_cpf_cnpj, '\D', '', 'g'), 8)
                      ELSE coalesce(nullif(r.cliente_cpf_cnpj, ''), r.cliente_nome) END IN (SELECT chave FROM virou)
          GROUP BY 1),
-- faturamento recorrente: contrato de locação faturado em cada um dos 3
-- meses anteriores e ainda não neste (a locação da APERAM sai todo dia 05)
mrec AS (SELECT CASE WHEN length(regexp_replace(dc.documento, '\D', '', 'g')) = 14
                      THEN left(regexp_replace(dc.documento, '\D', '', 'g'), 8)
                      ELSE coalesce(nullif(dc.documento, ''), dc.nome) END AS chave,
                max(dc.nome) AS nome, s.linha,
                date_trunc('month', s.data_servico)::date AS mes,
                date_trunc('month', s.data_servico) = date_trunc('month', hoje.d) AS atual,
                sum(s.valor_servicos) AS v
           FROM gold.fato_servicos s JOIN gold.dim_cliente dc USING (sk_cliente), hoje
          WHERE s.data_servico >= date_trunc('month', hoje.d) - interval '3 months'
            AND s.data_servico <= hoje.d
            -- só locação: é contrato mensal. Calibração em 3 meses seguidos é cliente
            -- mandando aparelho, não recorrência — medido, viraria alerta todo dia
            AND s.linha = 'locacao'
          GROUP BY 1, s.linha, 4, 5),
recorrente AS (SELECT chave, max(nome) AS nome, linha,
                      round(avg(v) FILTER (WHERE NOT atual)) AS valor_mes
                 FROM mrec GROUP BY chave, linha
                HAVING count(*) FILTER (WHERE NOT atual) = 3
                   AND count(*) FILTER (WHERE atual) = 0),
fechou AS (SELECT mes, resultado FROM gold.dre_mensal, hoje
            WHERE mes = (date_trunc('month', hoje.d) - interval '1 month')::date)
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
SELECT CASE WHEN coalesce(h.pagos_depois_de_30, 0) >= 2 THEN 4.5 ELSE 4 END,
       'cliente_virou_inadimplente',
       v.cliente_nome || ' passou de 30 dias de atraso (' || v.titulos || ' título(s)) — '
         || CASE WHEN coalesce(h.pagos_depois_de_30, 0) >= 2
                 THEN 'costuma pagar com atraso: ' || h.pagos_depois_de_30
                      || ' título(s) pagos depois de 30 dias nos últimos 24 meses, atraso mediano de '
                      || h.atraso_mediano || ' dias'
                 ELSE 'atraso fora do padrão deste cliente' END,
       round(v.valor), 'vencido desde ' || to_char(v.desde, 'DD/MM')
  FROM virou v LEFT JOIN hist h USING (chave)
UNION ALL
SELECT 5, 'mes_fechou_em_prejuizo',
       to_char(fechou.mes, 'MM/YYYY') || ' fechou em prejuízo (fechamento de hoje)',
       round(fechou.resultado), NULL
  FROM fechou, df, hoje WHERE hoje.d = df.d AND fechou.resultado < 0
UNION ALL
SELECT 6, 'faturamento_recorrente_nao_emitido',
       nome || ' (' || linha || ') foi faturado nos últimos 3 meses e ainda não neste',
       valor_mes, 'valor mensal típico'
  FROM recorrente, hoje WHERE extract(day FROM hoje.d) >= 8
ORDER BY ordem, valor DESC NULLS LAST;
```

## Como cada alerta é dito

| `alerta` | o que dizer | o que oferecer |
|---|---|---|
| `projecao_desatualizada` | o caixa de hoje não é confiável: a projeção é de outro dia | chame `avisar_administrador` uma vez |
| `caixa_apertado` | "No cenário pessimista é preciso ter R$ `valor` em conta; o aperto é na semana de `quando`." | saldo mínimo projetado, se ele disser o saldo (skill `caixa-projetado`) |
| `importacao_lancada` | "Há R$ `valor` de importação lançada a partir de `quando`." | o caixa das semanas com ela |
| `cliente_virou_inadimplente` | uma linha por cliente: nome, valor em aberto, desde quando, e o que o `o_que` diz do histórico — **"atraso fora do padrão"** é o que pede ação (vem primeiro); **"costuma pagar com atraso"** é informação, dita em meia linha, sem alarme. ⚠️ A baixa do boleto no Tiny é **manual**, depois que o Financeiro confirma o recebimento: o título pode já estar pago. Diga "em aberto no Tiny", não "não pagou" | a lista de inadimplência (`inadimplencia`) e conferir no banco se já entrou |
| `faturamento_recorrente_nao_emitido` | "`o_que`: R$ `valor` por mês." Pode ser contrato que acabou — diga que é para conferir, não que alguém esqueceu | conferir com o Financeiro (a locação da APERAM é o FIN-16, todo dia 05) |
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
