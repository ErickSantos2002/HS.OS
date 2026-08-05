-- 002 — Auth própria e role de aplicação
-- ======================================
-- Duas mudanças que andam juntas:
--
-- 1. `auth.users` deixa de ser shim e vira a tabela de identidade de verdade,
--    ganhando senha. Ela já era o alvo de 11 FKs e de 123 policies — movê-la
--    para `public.users` significaria reescrever tudo isso sem ganho nenhum.
--    O schema `auth` não é do Supabase; é só um schema, e agora é nosso.
--
-- 2. Nasce o role `hsos_app`, com que o backend conecta. Ele NÃO é superuser —
--    e isso é o ponto: superuser bypassa RLS por design, então conectar como
--    `administrador` deixaria as 191 policies inertes. Comprovado em teste:
--    superuser via 2 de 2 linhas, `authenticated` via 1 de 2.
--
-- A senha do hsos_app NÃO fica aqui. É definida fora do versionamento com
--    ALTER ROLE hsos_app PASSWORD '...';
-- e guardada só no backend/.env.

-- ── Identidade ───────────────────────────────────────────────────────────
ALTER TABLE auth.users
  ADD COLUMN IF NOT EXISTS password_hash      text,
  ADD COLUMN IF NOT EXISTS is_active          boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS email_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sign_in_at    timestamptz;

-- Login é sempre por e-mail, case-insensitive: o usuário que se cadastrou como
-- Erick@... precisa conseguir entrar digitando erick@...
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key
  ON auth.users (lower(email));

COMMENT ON COLUMN auth.users.password_hash IS
  'bcrypt. NULL = conta sem senha (convite pendente), não autentica.';

-- ── Role de aplicação ────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hsos_app') THEN
    -- Sem senha aqui de propósito; definida fora do versionamento.
    CREATE ROLE hsos_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS NOINHERIT;
  END IF;
END
$$;

-- NOINHERIT é essencial e não é detalhe de estilo: com INHERIT (o padrão), o
-- `GRANT authenticated TO hsos_app` abaixo faria o backend já nascer com todos
-- os privilégios de `authenticated`, e o `SET LOCAL ROLE` viraria opcional —
-- uma query que esquecesse o SET rodaria sem contexto de usuário e o RLS
-- filtraria por `auth.uid()` NULL, ou pior, passaria batido. Com NOINHERIT o
-- privilégio só existe depois do SET ROLE explícito.
ALTER ROLE hsos_app NOINHERIT;

-- hsos_app pode assumir os três papéis. É assim que o RLS entra em ação: a
-- cada request o backend faz `SET LOCAL ROLE authenticated` e as policies
-- passam a valer. `service_role` tem BYPASSRLS e é reservado para operações
-- internas (bootstrap, jobs), nunca para request de usuário.
--
-- WITH INHERIT FALSE é obrigatório, e o motivo é uma sutileza do PG 16+: a
-- opção de herança é gravada POR ASSOCIAÇÃO, capturada no momento do GRANT.
-- Um `ALTER ROLE ... NOINHERIT` posterior NÃO altera associações já criadas —
-- elas continuam herdando. Sem o WITH INHERIT FALSE aqui, hsos_app nasce com
-- todos os privilégios de `authenticated` sem precisar de SET ROLE nenhum.
REVOKE anon, authenticated, service_role FROM hsos_app;
GRANT  anon, authenticated, service_role TO   hsos_app WITH INHERIT FALSE;

GRANT USAGE ON SCHEMA public TO hsos_app;
GRANT USAGE ON SCHEMA auth   TO hsos_app, anon, authenticated, service_role;

-- Acesso à tabela de identidade. Precisa existir para hsos_app (fluxo de login,
-- antes de haver usuário autenticado) E para service_role (bootstrap, criação
-- de usuário) — com NOINHERIT, depois de um SET ROLE valem só os privilégios
-- daquele role, não os de hsos_app.
GRANT SELECT, INSERT, UPDATE ON auth.users TO hsos_app;
-- service_role também remove: a exclusão de usuário é operação interna
-- (existe `delete-user` entre as Edge Functions a portar).
GRANT SELECT, INSERT, UPDATE, DELETE ON auth.users TO service_role;
-- authenticated só lê, e só a própria linha (ver RLS abaixo).
GRANT SELECT ON auth.users TO authenticated;

-- auth.users não tinha RLS: sem isto, qualquer usuário logado leria o hash de
-- senha de todo mundo. O e-mail e o hash de outra pessoa não são da conta dela.
ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS users_select_self ON auth.users;
CREATE POLICY users_select_self ON auth.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

-- Nenhum GRANT em public.* para hsos_app: toda query de dado precisa passar
-- por um SET LOCAL ROLE explícito. Esquecer o SET vira erro de permissão na
-- hora, não vazamento silencioso.
