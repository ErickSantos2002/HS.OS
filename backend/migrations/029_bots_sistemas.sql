-- 029_bots_sistemas.sql — bot pessoal nos sistemas internos (05/11/2026)
--
-- Spec: docs/superpowers/specs/2026-11-05-bot-sistemas-internos-design.md.
--
-- `sistemas_ligados`: quais sistemas o bot acessa COMO a pessoa (token de
-- agente). `acoes_pendentes`: toda escrita do bot num sistema espera o clique
-- do dono — o que executa é o `payload` GRAVADO aqui, nunca um argumento novo
-- do agente. `agente_chamadas`: auditoria sem corpo.
--
-- Só `service_role` (padrão da 018). ⚠️ O usuário de leitura da empresa
-- enxerga as tabelas: o `payload` pode ter texto de comentário/tarefa.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO — ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-029.py

BEGIN;

ALTER TABLE public.agent_profiles
  ADD COLUMN IF NOT EXISTS sistemas_ligados text[] NOT NULL DEFAULT '{}';

CREATE TABLE IF NOT EXISTS public.acoes_pendentes (
    id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_id     text        NOT NULL,
    sistema      text        NOT NULL,
    acao         text        NOT NULL,
    payload      jsonb       NOT NULL,
    resumo       text        NOT NULL,
    status       text        NOT NULL DEFAULT 'pendente'
                 CHECK (status IN ('pendente','feita','cancelada','vencida','erro')),
    erro         text,
    resultado    text,
    conversa_id  uuid,
    criado_em    timestamptz NOT NULL DEFAULT now(),
    decidido_em  timestamptz
);
CREATE INDEX IF NOT EXISTS acoes_pendentes_user_idx ON public.acoes_pendentes (user_id, criado_em DESC);

CREATE TABLE IF NOT EXISTS public.agente_chamadas (
    id         bigserial   PRIMARY KEY,
    user_id    uuid        NOT NULL,
    agent_id   text        NOT NULL,
    sistema    text        NOT NULL,
    metodo     text        NOT NULL,
    caminho    text        NOT NULL,
    status     int,
    jti        text,
    criado_em  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agente_chamadas_user_idx ON public.agente_chamadas (user_id, criado_em DESC);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['acoes_pendentes','agente_chamadas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO service_role', t);
  END LOOP;
END $$;
GRANT USAGE ON SEQUENCE public.agente_chamadas_id_seq TO service_role;

COMMIT;
