-- 013_crons_no_gateway.sql — a `agent_crons` deixa de ser um espelho de nada
--
-- `POST /agents/{id}/crons` gravava nesta tabela e **nunca falava com o
-- gateway**, que é quem executa. A tabela tinha zero linhas desde sempre, e o
-- painel do `flow` dizia "nenhum agendamento" com dois crons rodando — o
-- levantamento de 19/08/2026 encontrou TRÊS coisas chamadas cron que não
-- concordavam entre si (`agent_crons`, `cron_jobs` e o `cron.list` do gateway).
--
-- Ao ligar a rota no gateway faltam duas colunas, e sem elas a ligação não se
-- sustenta:
--
--   `gateway_job_id` — o `cron.remove` e o `cron.update` do gateway exigem o
--   **id** do job, não o nome. Sem guardá-lo, criar funcionaria e editar ou
--   apagar não: seria preciso varrer o `cron.list` procurando pelo nome a cada
--   operação, e nome não é chave lá.
--
--   `instruction` — o que o agente deve FAZER quando o horário chegar. O
--   contrato antigo tinha `name`, `expression` e `description`, e nenhum dos
--   três é a mensagem. Sem `payload.message` não existe agendamento: o
--   `cron.add` recusa. Era a prova de que a rota nunca chegou a ser exercida.
--
-- `gateway_job_id` fica nulável de propósito. Linha com ele nulo é agendamento
-- que existe só aqui — não deveria acontecer com o código novo, mas se
-- acontecer é melhor enxergar do que fingir consistência.

ALTER TABLE public.agent_crons
  ADD COLUMN IF NOT EXISTS gateway_job_id text,
  ADD COLUMN IF NOT EXISTS instruction    text NOT NULL DEFAULT '';

-- Um job do gateway pertence a uma linha só. Parcial porque nulo é permitido e
-- vários nulos não se conflitam.
CREATE UNIQUE INDEX IF NOT EXISTS agent_crons_gateway_job_id_key
    ON public.agent_crons (gateway_job_id)
 WHERE gateway_job_id IS NOT NULL;

COMMENT ON COLUMN public.agent_crons.gateway_job_id IS
  'id do job no gateway (cron.list[].id). Nulo = agendamento órfão, só nosso.';
COMMENT ON COLUMN public.agent_crons.instruction IS
  'a mensagem enviada ao agente quando dispara — vira payload.message no cron.add.';
