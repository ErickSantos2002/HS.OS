-- 038_varreduras_grant.sql — GRANT ao service_role na tabela varreduras (16/11/2026)
--
-- A 037 criou `public.varreduras` com RLS e um REVOKE, mas esqueceu o GRANT
-- que a 032 dá à `lembretes` (032:47). Em produção a tabela ficou com
-- relacl = {administrador=arwdDxtm/administrador} e
-- has_table_privilege('service_role', 'public.varreduras', 'INSERT') = false:
-- o backend entra como `hsos_app` (NOINHERIT) e faz `SET ROLE service_role`
-- em cada sessão, então toda semeadura, reserva e gravação da varredura
-- morreria com "permission denied" — e a etapa é best-effort no disparador,
-- ou seja, morreria em silêncio, num log a cada 30 s.
--
-- A 037 já está aplicada e não se edita; o conserto vem aqui. Idempotente:
-- GRANT repetido não faz nada.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-038.py

GRANT SELECT, INSERT, UPDATE, DELETE ON public.varreduras TO service_role;

-- Conferir depois de aplicar:
--   SELECT has_table_privilege('service_role', 'public.varreduras', 'INSERT');  -- t
--   SELECT has_table_privilege('hsos_agente', 'public.varreduras', 'SELECT');   -- f
