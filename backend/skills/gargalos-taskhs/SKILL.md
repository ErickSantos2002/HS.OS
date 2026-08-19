---
name: gargalos-taskhs
description: Como medir tempo parado, gargalo por etapa e ciclo no TaskHS. Use ao responder "o que está parado", "onde perdemos tempo", "quanto demora cada etapa" ou qualquer pergunta de tempo sobre cards do TaskHS.
---

# Tempo, gargalo e ciclo no TaskHS

## A armadilha que você tem que conhecer antes de qualquer coisa

⚠️ **`cards.updated_at` NÃO serve para medir tempo.** Está congelado em
**18/07/2026** para todos os cards — foi a data da carga em massa, e o campo não
voltou a ser escrito. Usá-lo marca 100% dos cards como "parados há um mês", o que
é ruído, não resposta.

⚠️ **Comentário também não serve como régua principal.** É tentador (`card_comments`
tem data), mas movimento sem comentário existe o tempo todo — um card pode andar
cinco etapas sem ninguém escrever nada. Em 17/08/2026 esta foi a saída usada numa
resposta ao CEO, com a ressalva certa; deu um retrato plausível e impreciso.

**A régua certa é `public.audit_log`.**

```
10.243 registros · começa em 13/07/2026
2.589 movimentações de card (action = 'mover')
cada uma com  changes::jsonb -> 'list_id' -> 'de' / 'para'  e  created_at
```

⚠️ **E ela é COMPLETA, o que é raro — diga isso quando responder.** O `audit_log`
começa em **13/07** e o card mais antigo do sistema nasceu em **18/07**. Ou seja,
o registro cobre a vida inteira de todo card: não existe movimento anterior à
janela. Quando um card não aparece no `audit_log`, isso não é lacuna — é o fato
de que **ele nunca se moveu**.

Retrato de 19/08/2026, para você saber o tamanho do que está olhando:

| | cards ativos |
|---|---|
| já se moveram ao menos uma vez | 353 |
| **nunca saíram do lugar desde a importação de 18/07** | **957** |

## Como medir cada coisa

As três consultas abaixo foram rodadas contra produção em 19/08/2026 e voltaram
com dado coerente. Use-as como base e ajuste o período.

### 1. Onde se perde mais tempo (tempo médio POR ETAPA)

É a resposta para "onde estamos perdendo tempo" e "qual é o gargalo".

```sql
WITH mov AS (
  SELECT a.card_id,
         (a.changes::jsonb -> 'list_id' ->> 'para')::int AS lista_id,
         a.created_at AS entrou,
         LEAD(a.created_at) OVER (PARTITION BY a.card_id ORDER BY a.created_at) AS saiu
    FROM public.audit_log a
   WHERE a.action = 'mover' AND a.changes IS NOT NULL
     AND a.created_at >= now() - interval '30 days')
SELECT b.title AS board, l.title AS etapa, count(*) AS passagens,
       round(avg(EXTRACT(epoch FROM (mov.saiu - mov.entrou))/86400)::numeric, 1) AS dias_medios
  FROM mov JOIN public.lists  l ON l.id = mov.lista_id
           JOIN public.boards b ON b.id = l.board_id
 WHERE mov.saiu IS NOT NULL
 GROUP BY 1,2 HAVING count(*) >= 5
 ORDER BY dias_medios DESC;
```

⚠️ O `HAVING count(*) >= 5` existe para não reportar "12 dias médios" apoiado em
uma única passagem. Diga quantas passagens sustentam cada média.

### 2. O que está parado AGORA, e há quanto tempo

```sql
WITH ultimo AS (
  SELECT DISTINCT ON (a.card_id) a.card_id, a.created_at AS desde,
         (a.changes::jsonb -> 'list_id' ->> 'para')::int AS lista_id
    FROM public.audit_log a
   WHERE a.action = 'mover' AND a.changes IS NOT NULL
   ORDER BY a.card_id, a.created_at DESC)
SELECT b.title AS board, l.title AS etapa, count(*) AS cards,
       round(avg(EXTRACT(epoch FROM (now() - u.desde))/86400)::numeric,1) AS dias_medios,
       round(max(EXTRACT(epoch FROM (now() - u.desde))/86400)::numeric,1) AS pior
  FROM ultimo u
  JOIN public.cards  c ON c.id = u.card_id AND COALESCE(c.archived,false) = false
  JOIN public.lists  l ON l.id = u.lista_id AND COALESCE(l.archived,false) = false
  JOIN public.boards b ON b.id = l.board_id
 WHERE u.desde < now() - interval '48 hours'
 GROUP BY 1,2 ORDER BY cards DESC;
```

Para incluir os que **nunca** se moveram — que costumam ser o maior número e a
pior notícia:

```sql
SELECT b.title AS board, l.title AS etapa, count(*) AS nunca_moveram
  FROM public.cards c
  JOIN public.lists  l ON l.id = c.list_id  AND COALESCE(l.archived,false) = false
  JOIN public.boards b ON b.id = l.board_id
 WHERE COALESCE(c.archived,false) = false
   AND NOT EXISTS (SELECT 1 FROM public.audit_log a
                    WHERE a.action = 'mover' AND a.card_id = c.id)
 GROUP BY 1,2 ORDER BY 3 DESC;
```

### 3. Ciclo completo (quanto tempo um card leva de ponta a ponta)

```sql
WITH ciclo AS (
  SELECT a.card_id, a.board_id,
         min(a.created_at) AS inicio, max(a.created_at) AS fim, count(*) AS saltos
    FROM public.audit_log a
   WHERE a.action = 'mover' AND a.created_at >= now() - interval '45 days'
   GROUP BY 1,2 HAVING count(*) >= 3)
SELECT b.title AS board, count(*) AS cards,
       round(avg(EXTRACT(epoch FROM (fim-inicio))/86400)::numeric,1) AS dias_ciclo,
       round(avg(saltos)::numeric,1) AS etapas
  FROM ciclo JOIN public.boards b ON b.id = ciclo.board_id
 GROUP BY 1 ORDER BY cards DESC;
```

## Separar trabalho de arquivo

⚠️ **Nem toda lista é etapa de fluxo.** Há listas que são histórico importado —
"Gestão de Atividades – Abril/Maio/Junho", "Processo concluído", "Encerradas",
"L-R Entregue na H&S", "Setup já realizado". Card parado nelas **cumpriu** o
fluxo; contá-lo como pendência infla o número para mais de mil e transforma a
resposta em alarme falso.

Ao responder "o que está parado", **deixe essas listas de fora e diga que
deixou.**

## Como reportar

- Sempre em **quantidade e tempo**, nunca em adjetivo: "104 cards em Correios,
  16,2 dias em média, o pior com 29,9" — não "muitos cards atrasados".
- Diga **de onde veio o número**: TaskHS, medido pelo `audit_log`.
- Quando a média vier de poucas passagens, diga quantas.
- "Nunca se moveu" é uma afirmação forte e verdadeira aqui — use-a, e diga desde
  quando (a data de criação do card).

## Notas relacionadas

- O mesmo raciocínio **não** vale para o GestorHS e o ChamadosHS: eles têm fases e
  datas próprias. Esta skill é do TaskHS.
