-- 000 — Camada de compatibilidade Supabase → Postgres puro
-- =========================================================
-- O schema veio de um banco Supabase e depende de coisas que não existem num
-- Postgres comum: os roles `authenticated`/`anon`, o schema `auth` e a função
-- `auth.uid()`. Sem isto, 191 policies e 2 tabelas não sobem.
--
-- Esta migration recria o mínimo necessário — nada além. Ela NÃO decide se o
-- projeto vai manter RLS: apenas torna o schema aplicável. Se a decisão for
-- aposentar RLS, a 002 derruba as policies e este arquivo continua válido
-- (os roles e a auth.users seguem servindo às FKs).
--
-- Como o backend usa isto: a cada request autenticado, antes de qualquer query,
--     SET LOCAL app.current_user_id = '<uuid do usuário>';
--     SET LOCAL app.user_role       = 'authenticated';
-- Com isso `auth.uid()` volta a funcionar e as policies existentes valem como
-- segunda linha de defesa, atrás da autorização do FastAPI.
--
-- ATENÇÃO ao nome do setting: `app.current_role` NÃO funciona — `current_role`
-- é palavra reservada e o parser rejeita com erro de sintaxe. Daí `app.user_role`.

-- ── Roles ────────────────────────────────────────────────────────────────
-- NOLOGIN: são rótulos de permissão usados nas policies, não contas de acesso.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  -- sandbox_exec: role do Lovable, com SELECT/INSERT em todas as tabelas do
  -- public. Recriado só para os GRANTs da 001 aplicarem; provavelmente vira
  -- candidato a remoção depois que a plataforma sair do Lovable.
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sandbox_exec') THEN
    CREATE ROLE sandbox_exec NOLOGIN NOINHERIT;
  END IF;
END
$$;

-- ── Extensões ────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- gen_random_uuid(), usado em 54 defaults
CREATE EXTENSION IF NOT EXISTS moddatetime; -- 2 triggers de updated_at

-- ── Schema auth ──────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS auth;

-- Só as colunas que o schema público realmente referencia. 11 FKs apontam
-- para auth.users(id); o resto da tabela do Supabase não interessa aqui.
CREATE TABLE IF NOT EXISTS auth.users (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- auth.uid() — no Supabase lê o JWT; aqui lê o que o backend setou na sessão.
-- Aceita também o nome de setting do Supabase, para o caso de algum SQL herdado
-- ainda usar aquele formato. Retorna NULL quando nada foi setado, o que faz as
-- policies negarem por padrão — o comportamento seguro.
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    COALESCE(
      current_setting('app.current_user_id', true),
      current_setting('request.jwt.claim.sub', true)
    ), ''
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.user_role', true), ''),
    'anon'
  );
$$;

-- Nenhuma policy do schema usa auth.jwt() hoje (conferido: 0 ocorrências).
-- Se alguma vier a usar, adicionar aqui.

GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
