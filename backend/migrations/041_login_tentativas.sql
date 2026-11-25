-- 041_login_tentativas.sql — limite de tentativas no login por senha (PK-04, 25/11/2026)
--
-- `POST /auth/login` não tinha limite nem bloqueio, e é a única porta anônima
-- com senha de um repositório público. Mora no Postgres, e não em memória,
-- porque o backend roda com dois workers: um contador por processo deixaria
-- passar o dobro e zeraria a cada deploy.
--
-- Guarda só FALHAS, e só o sha256 do e-mail e do IP: o usuário de leitura da
-- empresa enxerga as tabelas por privilégio padrão. Ver `app/auth/tentativas.py`.
--
-- Sem policy para `authenticated`: só o backend, como `service_role`.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO, ANTES do deploy — sem a tabela, todo login por
--    senha dá 500.
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-041.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.login_tentativas (
    id         bigserial   PRIMARY KEY,
    email_hash text        NOT NULL,
    ip_hash    text        NOT NULL,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_tentativas_email_idx ON public.login_tentativas (email_hash, criado_em);
CREATE INDEX IF NOT EXISTS login_tentativas_ip_idx    ON public.login_tentativas (ip_hash, criado_em);

ALTER TABLE public.login_tentativas ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.login_tentativas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.login_tentativas TO service_role;
GRANT USAGE ON SEQUENCE public.login_tentativas_id_seq TO service_role;

COMMIT;
