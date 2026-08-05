-- Extração do schema do Supabase/Lovable Cloud
-- ============================================
-- Rode no SQL editor do Lovable (Cloud → SQL editor). Cada bloco devolve UMA
-- coluna de texto: copie o resultado e cole no arquivo indicado.
--
-- Ordem importa: tipos antes de tabelas, tabelas antes de constraints.
-- Este arquivo não é uma migration — é a ferramenta que gera a 001.


-- ─────────────────────────────────────────────────────────────
-- BLOCO 1 — Tudo de uma vez (tente este primeiro)
-- Devolve o DDL inteiro numa única célula de texto.
-- Se o editor truncar o resultado, use os blocos 2 a 8 separados.
-- ─────────────────────────────────────────────────────────────
WITH
enums AS (
  SELECT 1 AS ord, 'CREATE TYPE public.' || quote_ident(t.typname) || ' AS ENUM (' ||
         string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) || ');' AS ddl,
         t.typname AS nome
  FROM pg_type t
  JOIN pg_enum e ON e.enumtypid = t.oid
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public'
  GROUP BY t.typname
),
tabelas AS (
  SELECT 2 AS ord, 'CREATE TABLE public.' || quote_ident(c.relname) || ' (' || chr(10) ||
         string_agg('  ' || quote_ident(a.attname) || ' ' || format_type(a.atttypid, a.atttypmod) ||
                    COALESCE(' DEFAULT ' || pg_get_expr(d.adbin, d.adrelid), '') ||
                    CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE '' END,
                    ',' || chr(10) ORDER BY a.attnum) ||
         chr(10) || ');' AS ddl,
         c.relname AS nome
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind = 'r'
  GROUP BY c.relname
),
constraints AS (
  -- contype: p=PK, u=UNIQUE, c=CHECK, f=FK. PK e UNIQUE antes das FKs.
  SELECT 3 AS ord, 'ALTER TABLE public.' || quote_ident(t.relname) ||
         ' ADD CONSTRAINT ' || quote_ident(c.conname) || ' ' ||
         pg_get_constraintdef(c.oid) || ';' AS ddl,
         CASE c.contype WHEN 'p' THEN '1' WHEN 'u' THEN '2' WHEN 'c' THEN '3' ELSE '4' END
         || t.relname AS nome
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
),
indices AS (
  SELECT 4 AS ord, indexdef || ';' AS ddl, indexname AS nome
  FROM pg_indexes
  WHERE schemaname = 'public'
    -- índices de PK/UNIQUE já vêm pelas constraints acima
    AND indexname NOT IN (SELECT conname FROM pg_constraint WHERE contype IN ('p','u'))
),
funcoes AS (
  SELECT 5 AS ord, pg_get_functiondef(p.oid) || ';' AS ddl, p.proname AS nome
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
),
visoes AS (
  SELECT 6 AS ord, 'CREATE OR REPLACE VIEW public.' || quote_ident(viewname) ||
         ' AS ' || definition AS ddl, viewname AS nome
  FROM pg_views WHERE schemaname = 'public'
),
gatilhos AS (
  SELECT 7 AS ord, pg_get_triggerdef(tg.oid) || ';' AS ddl, tg.tgname AS nome
  FROM pg_trigger tg
  JOIN pg_class c ON c.oid = tg.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT tg.tgisinternal
),
politicas AS (
  SELECT 8 AS ord,
         'ALTER TABLE public.' || quote_ident(tablename) || ' ENABLE ROW LEVEL SECURITY;' || chr(10) ||
         'CREATE POLICY ' || quote_ident(policyname) || ' ON public.' || quote_ident(tablename) ||
         ' AS ' || permissive || ' FOR ' || cmd ||
         ' TO ' || array_to_string(roles, ', ') ||
         COALESCE(' USING (' || qual || ')', '') ||
         COALESCE(' WITH CHECK (' || with_check || ')', '') || ';' AS ddl,
         tablename || policyname AS nome
  FROM pg_policies WHERE schemaname = 'public'
),
tudo AS (
  SELECT * FROM enums   UNION ALL SELECT * FROM tabelas     UNION ALL
  SELECT * FROM constraints UNION ALL SELECT * FROM indices UNION ALL
  SELECT * FROM funcoes UNION ALL SELECT * FROM visoes      UNION ALL
  SELECT * FROM gatilhos UNION ALL SELECT * FROM politicas
)
SELECT string_agg(ddl, chr(10) || chr(10) ORDER BY ord, nome) AS schema_completo
FROM tudo;


-- ─────────────────────────────────────────────────────────────
-- Blocos individuais — use se o bloco 1 truncar.
-- Rode um por vez e concatene os resultados na mesma ordem.
-- ─────────────────────────────────────────────────────────────

-- BLOCO 2 — Tipos ENUM
-- SELECT 'CREATE TYPE public.' || quote_ident(t.typname) || ' AS ENUM (' ||
--        string_agg(quote_literal(e.enumlabel), ', ' ORDER BY e.enumsortorder) || ');'
-- FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
-- JOIN pg_namespace n ON n.oid = t.typnamespace
-- WHERE n.nspname = 'public' GROUP BY t.typname;

-- BLOCO 3 — Tabelas       → o CTE `tabelas` acima, sem o `2 AS ord`
-- BLOCO 4 — Constraints   → o CTE `constraints`
-- BLOCO 5 — Índices       → o CTE `indices`
-- BLOCO 6 — Funções/RPCs  → o CTE `funcoes`
-- BLOCO 7 — Views         → o CTE `visoes`
-- BLOCO 8 — Triggers      → o CTE `gatilhos`
-- BLOCO 9 — RLS policies  → o CTE `politicas`


-- ─────────────────────────────────────────────────────────────
-- BLOCO 10 — Inventário (rode para conferir se veio tudo)
-- Compare os números com os do CLAUDE.md: ~70 tabelas, 3 views, ~14 RPCs.
-- ─────────────────────────────────────────────────────────────
-- SELECT 'tabelas' AS tipo, count(*) FROM pg_tables WHERE schemaname='public'
-- UNION ALL SELECT 'views', count(*) FROM pg_views WHERE schemaname='public'
-- UNION ALL SELECT 'funcoes', count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'
-- UNION ALL SELECT 'policies', count(*) FROM pg_policies WHERE schemaname='public'
-- UNION ALL SELECT 'triggers', count(*) FROM pg_trigger tg JOIN pg_class c ON c.oid=tg.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT tg.tgisinternal
-- UNION ALL SELECT 'extensoes', count(*) FROM pg_extension;

-- BLOCO 11 — Extensões (precisam existir no Postgres de destino)
-- SELECT 'CREATE EXTENSION IF NOT EXISTS ' || quote_ident(extname) || ';' FROM pg_extension;

-- BLOCO 12 — Cron jobs (pg_cron). Os 5 jobs operacionais moram aqui.
-- SELECT jobid, schedule, command, jobname FROM cron.job ORDER BY jobid;

-- BLOCO 13 — Confirmação de que o banco está mesmo vazio.
-- n_live_tup é estimativa; rode ANALYZE antes se quiser exatidão.
-- SELECT relname, n_live_tup FROM pg_stat_user_tables
-- WHERE n_live_tup > 0 ORDER BY n_live_tup DESC;
