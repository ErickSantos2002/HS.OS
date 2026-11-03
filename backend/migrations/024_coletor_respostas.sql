-- 024_coletor_respostas.sql — resposta de agente gravada sem tela aberta
--
-- Quem buscava a resposta no gateway era só o `GET /reply`, chamado em laço
-- pelo navegador. Fechou o app depois de perguntar, ninguém buscava — e não
-- havia o que notificar. O `app/coletor_respostas.py` busca no lugar da tela,
-- e precisa de quatro colunas:
--
--   tela_perguntou_em  a última vez que o `/reply` foi chamado para o run. O
--                      coletor só pega run em que a tela não pergunta há 45 s —
--                      com a tela esperando, ela mesma grava.
--   coletando_em       reserva entre os 2 workers. Quem fizer o UPDATE com
--                      `coletando_em IS NULL OR < now() - 30 s` leva o run.
--   coleta_encerrada_em o coletor desistiu deste run e não volta a ele: o
--                      agente terminou sem texto, a pessoa mandou parar, ou
--                      o gateway falhou 3 vezes. Sem isso um run com `erro`
--                      era colhido de novo a cada 30 s por meia hora — e
--                      acabava gravando a resposta da PRÓXIMA pergunta.
--   coleta_tentativas  falhas de gateway/conexão já sofridas (teto 3).
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
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS coleta_encerrada_em timestamptz;
ALTER TABLE public.agent_runs ADD COLUMN IF NOT EXISTS coleta_tentativas integer NOT NULL DEFAULT 0;

-- A consulta do coletor roda a cada 5 s em cada worker: só os pendentes.
CREATE INDEX IF NOT EXISTS agent_runs_pendentes_idx
    ON public.agent_runs (criado_em) WHERE message_id IS NULL;

COMMENT ON COLUMN public.agent_runs.tela_perguntou_em IS
  'Última chamada do GET /reply para este run. O coletor de respostas só age '
  'quando a tela não pergunta há 45 s.';
COMMENT ON COLUMN public.agent_runs.coletando_em IS
  'Reserva do coletor de respostas entre os workers; vale 30 s.';
COMMENT ON COLUMN public.agent_runs.coleta_encerrada_em IS
  'O coletor de respostas desistiu deste run (erro, /stop ou 3 falhas de gateway).';
COMMENT ON COLUMN public.agent_runs.coleta_tentativas IS
  'Falhas de gateway/conexão do coletor neste run; no 3º ele desiste.';

COMMIT;

-- Conferir depois de aplicar:
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'agent_runs'
--      AND column_name IN ('tela_perguntou_em', 'coletando_em',
--                          'coleta_encerrada_em', 'coleta_tentativas'); -- 4 linhas
