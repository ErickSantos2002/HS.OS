-- 040_varredura_financeiro.sql — semana financeira do Midas na fila de varreduras (18/11/2026)
--
-- O Midas (CFO, substitui a Iris) manda toda semana, no primeiro dia útil da
-- semana ISO às 08:00 de Brasília, a agenda de caixa da semana a quem ele
-- atende (`agent_profiles.allowed_user_ids` do `midas`). Não é um laço novo: é
-- mais um `tipo` na mesma fila da varredura do Guardi (037), disparado pela
-- porta única `disparar_turno` e fechado como o quadro da Nina (`entregue`
-- quando a resposta é gravada).
--
-- O CHECK da 037 foi criado inline, sem nome; o Postgres o batizou
-- `varreduras_tipo_check` (conferido no banco em 18/11/2026).
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO, ANTES do deploy que semeia o tipo —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-040.py
-- Sem ela, a semeadura da segunda-feira falha no INSERT e a etapa inteira da
-- varredura (inclusive a dos Guardis) morre naquela passada.

BEGIN;

ALTER TABLE public.varreduras DROP CONSTRAINT IF EXISTS varreduras_tipo_check;
ALTER TABLE public.varreduras ADD CONSTRAINT varreduras_tipo_check
    CHECK (tipo IN ('manha', 'tarde', 'pedida', 'quadro', 'financeiro'));

COMMIT;
