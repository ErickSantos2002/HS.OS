-- 030_assinatura_email.sql — assinatura de e-mail por pessoa (05/11/2026)
--
-- No modelo do HSGrowth: a pessoa cadastra no Perfil (texto antes, até 2
-- imagens — GIF animado incluso — e texto depois, ex. aviso LGPD). Todo
-- e-mail que o bot PREPARA sai em HTML com ela no fim, imagens embutidas
-- (inline, cid:) para animar no Outlook e no Gmail de quem recebe.
--
-- Imagens no banco (bytea): duas por pessoa, ≤ 2 MB cada — não justifica
-- bucket novo. O usuário de leitura enxerga; assinatura não é segredo.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO — ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-030.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_assinaturas (
    user_id        uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    texto_antes    text        NOT NULL DEFAULT '',
    texto_depois   text        NOT NULL DEFAULT '',
    atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_assinatura_imagens (
    user_id  uuid    NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    ordem    int     NOT NULL CHECK (ordem IN (1, 2)),
    mime     text    NOT NULL,
    nome     text    NOT NULL,
    dados    bytea   NOT NULL,
    PRIMARY KEY (user_id, ordem)
);

ALTER TABLE public.email_pendentes ADD COLUMN IF NOT EXISTS assinatura boolean NOT NULL DEFAULT false;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_assinaturas','email_assinatura_imagens'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END $$;

COMMIT;
