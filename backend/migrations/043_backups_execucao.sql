-- 043_backups_execucao.sql — cada backup registra o próprio resultado (26/11/2026)
--
-- ⚠️ O backup do banco falhou todo dia de 08/09 a 26/11/2026 e ninguém soube.
-- Daqui em diante cada execução grava uma linha — a do banco direto pelo
-- container, a do gateway por `POST /backups/registro` — e o
-- `app/guardiao_backups.py` avisa o administrador quando a última falhou ou
-- quando não há sucesso há mais de 26 h (inclusive nunca).
--
-- RLS ligado e sem policy: só o backend, como `service_role`.
--
-- Idempotente. ⚠️ Superusuário: ~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-043.py
-- Pode ir ANTES do deploy (nada lê a tabela até lá) e deve: o script do banco
-- passa a gravar nela, e o guardião sem tabela só registra que está parado.

CREATE TABLE IF NOT EXISTS public.backups_execucao (
  id       bigserial PRIMARY KEY,
  origem   text NOT NULL CHECK (origem IN ('banco-hsos', 'gateway')),
  ok       boolean NOT NULL,
  tamanho  bigint,
  detalhe  text,
  em       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS backups_execucao_origem_em_idx
  ON public.backups_execucao (origem, em DESC);

ALTER TABLE public.backups_execucao ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, DELETE ON public.backups_execucao TO service_role;
-- SELECT junto do USAGE: sem ele o `pg_dump` do backup morre nesta sequence
-- (a lição da 042, no mesmo dia).
GRANT USAGE, SELECT ON SEQUENCE public.backups_execucao_id_seq TO service_role;
