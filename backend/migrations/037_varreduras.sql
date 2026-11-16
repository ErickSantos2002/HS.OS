-- 037_varreduras.sql — varredura do Guardi (16/11/2026)
--
-- Spec: docs/superpowers/specs/2026-11-16-varredura-do-guardi-design.md.
--
-- Uma linha por varredura de um Guardi (bot pessoal): a agendada da manhã e da
-- tarde, a pedida (pela agenda ou pela Nina) e o quadro da equipe. É a fila e
-- também o registro do que saiu:
--
--   tipo         manha | tarde | pedida | quadro
--   pedida_por   agenda | nina (só em tipo = 'pedida')
--   status       agendada → rodando → entregue | nada_novo | sem_registro |
--                pulada | erro
--   run_id       o run do gateway que fez a varredura (índice: o coletor acha
--                a linha pelo run)
--   resumo_cifrado  o resumo entregue, CIFRADO (Fernet) — o usuário de leitura
--                da empresa enxerga as tabelas, então texto de pessoa não fica
--                em claro aqui
--   numeros      contagens para métrica, sem texto
--   proximo_em / disparando_em / turno_pendente_desde  mesma mecânica de lease
--                e adiamento do disparador de lembretes (posse por carimbo)
--
-- Uma agendada por pessoa, dia e tipo (índice único parcial); as pedidas não
-- têm limite de unicidade.
--
-- ⚠️ Mesmo padrão da 032: só o backend acessa, RLS ligada e SEM policy. O
-- `hsos_agente` (a Nina, no banco-hsos) NÃO lê esta tabela: o REVOKE é
-- explícito porque privilégio padrão pode concedê-la (ver a 033/034).
-- Nenhuma função nova, logo nada de SECURITY DEFINER.
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-037.py

BEGIN;

CREATE TABLE IF NOT EXISTS public.varreduras (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    agent_id              text        NOT NULL,
    dia                   date        NOT NULL,
    tipo                  text        NOT NULL CHECK (tipo IN ('manha', 'tarde', 'pedida', 'quadro')),
    pedida_por            text        CHECK (pedida_por IN ('agenda', 'nina')),
    status                text        NOT NULL DEFAULT 'agendada'
        CHECK (status IN ('agendada', 'rodando', 'entregue', 'nada_novo',
                          'sem_registro', 'pulada', 'erro')),
    run_id                text,
    resumo_cifrado        text,
    numeros               jsonb,
    proximo_em            timestamptz NOT NULL,
    disparando_em         timestamptz,
    turno_pendente_desde  timestamptz,
    criado_em             timestamptz DEFAULT now(),
    entregue_em           timestamptz,
    -- pedida_por só existe (e é obrigatório) na varredura pedida.
    CONSTRAINT varreduras_pedida_por_check CHECK ((tipo = 'pedida') = (pedida_por IS NOT NULL))
);

ALTER TABLE public.varreduras ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.varreduras FROM PUBLIC, anon, authenticated, hsos_agente;

-- Uma agendada por pessoa, dia e tipo; pedida pode repetir.
CREATE UNIQUE INDEX IF NOT EXISTS varreduras_unica_idx
    ON public.varreduras (user_id, dia, tipo)
    WHERE tipo <> 'pedida';

-- O disparador procura o que venceu por status e horário.
CREATE INDEX IF NOT EXISTS varreduras_fila_idx
    ON public.varreduras (status, proximo_em);

-- O coletor de respostas acha a varredura pelo run.
CREATE INDEX IF NOT EXISTS varreduras_run_idx
    ON public.varreduras (run_id);

COMMIT;

-- Conferir depois de aplicar:
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'varreduras';         -- 15
--   SELECT to_regclass('public.varreduras_unica_idx') IS NOT NULL;        -- t
