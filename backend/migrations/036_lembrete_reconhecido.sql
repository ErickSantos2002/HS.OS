-- 036_lembrete_reconhecido.sql — lembrete que chama atenção (13/11/2026)
--
-- Spec: docs/superpowers/specs/2026-11-13-lembrete-que-chama-atencao-design.md.
--
-- Um lembrete não é mensagem: fica na frente até a pessoa decidir ("Adiar 10
-- min" ou "Feito"), e sem resposta toca de novo UMA vez em 5 min. O estado de
-- cada aviso mora no próprio lembrete:
--
--   aviso_em          quando o último aviso (recado) saiu — é a chave do token
--                     de ação do push: token de um aviso não serve para outro
--   reconhecido_em    quando a pessoa respondeu ao aviso atual
--   reconhecido_como  'feito' | 'adiado'
--   reaviso_em        próximo re-aviso (insistência de 5 min ou fim do adiar)
--   reavisos          quantos re-avisos saíram desde o último disparo
--
-- Tudo é zerado a cada disparo novo (recorrente começa limpo).
--
-- ⚠️ Mesmo padrão da 032: só o backend (`service_role`) acessa, RLS ligada e
-- SEM policy — as colunas novas herdam isso, não há GRANT a acrescentar.
-- Nenhuma função nova, logo nada de SECURITY DEFINER (ver a 034).
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-036.py

BEGIN;

ALTER TABLE public.lembretes
    ADD COLUMN IF NOT EXISTS aviso_em         timestamptz,
    ADD COLUMN IF NOT EXISTS reconhecido_em   timestamptz,
    ADD COLUMN IF NOT EXISTS reconhecido_como text,
    ADD COLUMN IF NOT EXISTS reaviso_em       timestamptz,
    ADD COLUMN IF NOT EXISTS reavisos         integer NOT NULL DEFAULT 0;

ALTER TABLE public.lembretes DROP CONSTRAINT IF EXISTS lembretes_reconhecido_como_check;
ALTER TABLE public.lembretes ADD CONSTRAINT lembretes_reconhecido_como_check
    CHECK (reconhecido_como IS NULL OR reconhecido_como IN ('feito', 'adiado'));

-- O disparador procura re-aviso vencido a cada 30 s.
CREATE INDEX IF NOT EXISTS lembretes_reaviso_idx
    ON public.lembretes (reaviso_em)
    WHERE ativo AND reaviso_em IS NOT NULL;

-- A janela do app busca "avisados e não reconhecidos" ao carregar.
CREATE INDEX IF NOT EXISTS lembretes_pendentes_idx
    ON public.lembretes (user_id, aviso_em)
    WHERE reconhecido_em IS NULL AND aviso_em IS NOT NULL;

COMMIT;

-- Conferir depois de aplicar:
--   SELECT count(*) FROM information_schema.columns
--    WHERE table_schema = 'public' AND table_name = 'lembretes'
--      AND column_name IN ('aviso_em', 'reconhecido_em', 'reconhecido_como',
--                          'reaviso_em', 'reavisos');                   -- 5
--   SELECT to_regclass('public.lembretes_reaviso_idx') IS NOT NULL;     -- t
