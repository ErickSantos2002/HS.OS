-- 024_coletor_respostas.sql — resposta de agente gravada sem tela aberta
--
-- Quem buscava a resposta no gateway era só o `GET /reply`, chamado em laço
-- pelo navegador. Fechou o app depois de perguntar, ninguém buscava — e não
-- havia o que notificar. O `app/coletor_respostas.py` busca no lugar da tela,
-- e precisa de duas colunas:
--
--   tela_perguntou_em  a última vez que o `/reply` foi chamado para o run. O
--                      coletor só pega run em que a tela não pergunta há 45 s —
--                      com a tela esperando, ela mesma grava.
--   coletando_em       reserva entre os 2 workers. Quem fizer o UPDATE com
--                      `coletando_em IS NULL OR < now() - 30 s` leva o run.
--
-- Nulas nas linhas antigas: o coletor só olha runs dos últimos 30 minutos.
--
-- ⚠️ O `/reply` grava `tela_perguntou_em` mas sobrevive à coluna ausente (loga
-- e segue); o coletor, sem ela, só loga e espera. Mesmo assim: aplicar ANTES do
-- deploy do código (lição de 18/09).
--
-- ⚠️ APLICAR COMO SUPERUSUÁRIO —
--    ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-024.py

BEGIN;

ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS tela_perguntou_em timestamptz;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS coletando_em timestamptz;

-- A consulta do coletor roda a cada 5 s em cada worker: só os pendentes.
CREATE INDEX IF NOT EXISTS agent_runs_pendentes_idx
    ON public.agent_runs (criado_em) WHERE message_id IS NULL;

COMMENT ON COLUMN public.agent_runs.tela_perguntou_em IS
  'Última chamada do GET /reply para este run. O coletor de respostas só age '
  'quando a tela não pergunta há 45 s.';
COMMENT ON COLUMN public.agent_runs.coletando_em IS
  'Reserva do coletor de respostas entre os workers; vale 30 s.';

COMMIT;

-- Conferir depois de aplicar:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'agent_runs'
--      AND column_name IN ('tela_perguntou_em', 'coletando_em');   -- 2 linhas
