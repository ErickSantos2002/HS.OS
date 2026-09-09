-- 016_seq_depois.sql — o piso do corte para de congelar
--
-- Em 08/09/2026 o CEO recebeu duas respostas da `nina` com a resposta anterior
-- colada na frente: 1.895 → 3.556 → 5.137 caracteres, cada uma contendo a
-- anterior inteira a partir do primeiro caractere. É a **terceira** vez que este
-- defeito aparece, e cada correção anterior tratou uma camada dele:
--
--   17/08  `chat.history` com `limit=1` devolvia a mensagem de `seq=41` numa
--          sessão de 52 → corrigido para `limit=5`
--   19/08  `limit=5` erra mais adiante → acrescentado um `piso` vindo do nosso
--          `agent_runs.seq_antes`
--   08/09  o piso não sobe sozinho — ele é `max(seq_antes)`, ou seja o último
--          valor que o GATEWAY acertou. Numa sessão de 120+ mensagens ele
--          congelou em 119 por três turnos seguidos, e tudo com `seq > 119`
--          voltou colado.
--
-- A informação que faltava sempre esteve à mão e era jogada fora: o `GET /reply`
-- lê o histórico com `limit=40` para montar a resposta, então ele SABE qual foi
-- o maior `seq` que consumiu. `seq_depois` guarda esse número, e o piso passa a
-- ser `greatest(seq_antes, seq_depois)` — que anda com a conversa em vez de
-- esperar o gateway acertar de novo.
--
-- Nulo nas linhas antigas de propósito: `coalesce(seq_depois, 0)` dentro do
-- `greatest` faz elas continuarem valendo pelo `seq_antes`, sem backfill.
--
-- Ver `docs/CONFERENCIA-CONVERSA-2026-09-08.md`, seção 1.2.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO** — `hsos_app` não tem CREATE em `public`:
--
--      psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
--           -v ON_ERROR_STOP=1 -f backend/migrations/016_seq_depois.sql

BEGIN;

ALTER TABLE public.agent_runs
  ADD COLUMN IF NOT EXISTS seq_depois integer;

COMMENT ON COLUMN public.agent_runs.seq_depois IS
  'Maior seq do chat.history que o /reply consumiu ao montar esta resposta. '
  'Com o seq_antes, forma o piso do corte do próximo envio — ver _piso_do_seq. '
  'Nulo nas linhas anteriores a 09/09/2026.';

COMMIT;
