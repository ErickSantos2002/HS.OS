-- 028_email_bots.sql — e-mail dos bots pessoais (piloto, 05/11/2026)
--
-- Spec: docs/superpowers/specs/2026-11-05-bot-email-piloto-design.md.
--
-- `agent_profiles.email_ligado` é a fonte da verdade: quem vê "Conectar
-- e-mail", quem ganha a entrada `hsos-email-<bot>` no gateway, e o que o
-- `tools_do_bot` considera fechado. Só o administrador liga.
--
-- ⚠️ Todas as tabelas são só do backend (`service_role`), no padrão da 018 —
-- e o refresh token vai CIFRADO (Fernet, `EMAIL_CHAVE_CIFRA`), porque o
-- usuário de leitura da empresa enxerga as tabelas: em claro, ele leria e
-- enviaria e-mail como qualquer pessoa conectada.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-028.py

BEGIN;

ALTER TABLE public.agent_profiles
  ADD COLUMN IF NOT EXISTS email_ligado boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.email_contas (
    user_id          uuid        PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    conta            text        NOT NULL,
    refresh_cifrado  text        NOT NULL,
    conectado_em     timestamptz NOT NULL DEFAULT now(),
    atualizado_em    timestamptz NOT NULL DEFAULT now()
);

-- Caixas compartilhadas não se descobrem pelo Graph: cadastradas pelo admin
-- e conferidas com uma leitura de teste antes de entrar aqui.
CREATE TABLE IF NOT EXISTS public.email_caixas (
    user_id       uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    endereco      text        NOT NULL,
    conferida_em  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, endereco)
);

-- `state` da OAuth: o JWT mora no localStorage e a navegação até a Microsoft
-- não o carrega — quem amarra a volta à pessoa é esta linha, de uso único.
CREATE TABLE IF NOT EXISTS public.email_oauth_estados (
    state      text        PRIMARY KEY,
    user_id    uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    criado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.email_pendentes (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_id     text        NOT NULL,
    conversa_id  uuid,
    caixa_de     text        NOT NULL,
    para         text[]      NOT NULL,
    cc           text[]      NOT NULL DEFAULT '{}',
    assunto      text        NOT NULL DEFAULT '',
    corpo        text        NOT NULL DEFAULT '',
    graph_id     text        NOT NULL,
    hash         text        NOT NULL,
    status       text        NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','enviado','descartado','vencido','erro')),
    erro         text,
    criado_em    timestamptz NOT NULL DEFAULT now(),
    decidido_em  timestamptz
);
CREATE INDEX IF NOT EXISTS email_pendentes_user_idx ON public.email_pendentes (user_id, criado_em DESC);

-- Auditoria SEM corpo: quem, qual bot, o quê, de que caixa, para quem.
CREATE TABLE IF NOT EXISTS public.email_eventos (
    id             bigserial   PRIMARY KEY,
    user_id        uuid        NOT NULL,
    agent_id       text,
    acao           text        NOT NULL,
    caixa          text,
    graph_id       text,
    destinatarios  text[]      NOT NULL DEFAULT '{}',
    criado_em      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_eventos_user_idx ON public.email_eventos (user_id, criado_em DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_contas','email_caixas','email_oauth_estados',
                           'email_pendentes','email_eventos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE public.email_eventos_id_seq TO service_role;

COMMIT;

-- Conferir depois de aplicar:
--   SELECT count(*) FROM information_schema.tables
--    WHERE table_schema='public' AND table_name LIKE 'email\_%';          -- 5
--   SELECT EXISTS(SELECT 1 FROM information_schema.columns
--    WHERE table_name='agent_profiles' AND column_name='email_ligado');  -- t
