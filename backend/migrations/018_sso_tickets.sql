-- 018_sso_tickets.sql — ticket de uso único do login com Microsoft
--
-- O callback da Microsoft não pode mandar o JWT na URL (histórico, log do
-- proxy, Referer). Ele grava aqui um ticket de 60 s e manda só o ticket; o
-- front troca por POST /auth/sso/exchange. Ver `app/auth/sso.py`.
--
-- Guarda só o sha256 do ticket: o usuário de leitura da empresa enxerga as
-- tabelas, e com o ticket em claro entraria na conta de outra pessoa.
--
-- Mora no Postgres, e não em memória, porque o backend roda com dois workers:
-- a troca cairia metade das vezes no processo que não emitiu o ticket.
--
-- Sem policy para `authenticated`, de propósito: só o backend, como
-- `service_role`, lê e escreve.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não tem CREATE em `public`.
--    python3 ~/aplicar-hsos-018.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.sso_tickets (
    ticket_hash  text        PRIMARY KEY,
    user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    expira_em    timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS sso_tickets_expira_idx ON public.sso_tickets (expira_em);

ALTER TABLE public.sso_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sso_tickets FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.sso_tickets TO service_role;

COMMIT;
