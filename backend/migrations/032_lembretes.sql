-- 032_lembretes.sql — agenda e lembretes do Guardi (09/11/2026)
--
-- Spec: docs/superpowers/specs/2026-11-09-agenda-lembretes-design.md.
--
-- `lembretes` guarda o recado e, opcionalmente, a instrução que o Guardi
-- executa no disparo (nulo = só o recado). O próximo instante é calculado pelo
-- backend (`app/agenda/regras.py`) e gravado em UTC em `proximo_em`.
--
-- ⚠️ Só o backend (`service_role`) acessa, no padrão da 028: RLS ligada e SEM
-- policy. O usuário de leitura da empresa enxerga a tabela, por isso ela só
-- carrega o que a pessoa escreveu — nunca conteúdo de evento do Outlook.
--
-- `email_contas.escopos` guarda os escopos que a Microsoft CONCEDEU. O refresh
-- renova com eles; conta antiga (nulo) renova com os escopos de e-mail de hoje.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-032.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.lembretes (
    id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    agent_id             text        NOT NULL,
    titulo               text        NOT NULL CHECK (char_length(titulo) BETWEEN 1 AND 200),
    instrucao            text        CHECK (instrucao IS NULL OR char_length(instrucao) <= 2000),
    regra                jsonb       NOT NULL,
    proximo_em           timestamptz,
    ativo                boolean     NOT NULL DEFAULT true,
    criado_por           text        NOT NULL CHECK (criado_por IN ('pessoa','guardi')),
    disparando_em        timestamptz,
    turno_pendente_desde timestamptz,
    ultimo_disparo_em    timestamptz,
    ultimo_status        text        CHECK (ultimo_status IS NULL OR ultimo_status IN
                                   ('entregue','entregue_sem_agente','perdido','erro')),
    criado_em            timestamptz NOT NULL DEFAULT now(),
    atualizado_em        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lembretes_proximo_idx
    ON public.lembretes (proximo_em)
    WHERE ativo AND proximo_em IS NOT NULL;
CREATE INDEX IF NOT EXISTS lembretes_user_idx ON public.lembretes (user_id);

ALTER TABLE public.lembretes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lembretes FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lembretes TO service_role;

ALTER TABLE public.email_contas ADD COLUMN IF NOT EXISTS escopos text[];

COMMIT;

-- Conferir depois de aplicar:
--   SELECT to_regclass('public.lembretes') IS NOT NULL;                    -- t
--   SELECT EXISTS(SELECT 1 FROM information_schema.columns
--    WHERE table_name='email_contas' AND column_name='escopos');           -- t
