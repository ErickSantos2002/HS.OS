-- Prova que o piso do corte anda com a conversa em vez de congelar.
--
-- Os números são os da conversa do CEO em 08/09/2026: o `seq_antes` ficou em
-- 119 por três turnos enquanto o `/reply` já tinha lido até 125, e o que veio
-- entre os dois voltou colado na frente da resposta.
--
--   psql "$(bash scripts/banco-rascunho.sh --url)" -v ON_ERROR_STOP=1 \
--        -f backend/migrations/_testes/016_seq_depois.test.sql

BEGIN;

INSERT INTO auth.users (id, email)
VALUES ('11111111-1111-1111-1111-111111111111', 'ceo@exemplo.test');
INSERT INTO public.profiles (id, email, full_name)
VALUES ('11111111-1111-1111-1111-111111111111', 'ceo@exemplo.test', 'CEO de teste');

-- Os três turnos que travaram: o gateway devolveu 119 nos três, e o `/reply`
-- leu até 125, 131 e 137.
INSERT INTO public.agent_runs (run_id, agent_id, session_key, seq_antes, seq_depois, user_id)
VALUES ('run-1', 'nina', 'agent:nina:hsos-teste', 115, 125, '11111111-1111-1111-1111-111111111111'),
       ('run-2', 'nina', 'agent:nina:hsos-teste', 119, 131, '11111111-1111-1111-1111-111111111111'),
       ('run-3', 'nina', 'agent:nina:hsos-teste', 119, 137, '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE
  piso_novo  int;
  piso_velho int;
BEGIN
  -- O piso de hoje: o maior entre o que enviamos e o que já lemos.
  SELECT max(greatest(seq_antes, coalesce(seq_depois, 0)))
    INTO piso_novo
    FROM public.agent_runs WHERE session_key = 'agent:nina:hsos-teste';

  -- O piso de antes de 09/09/2026, que só olhava `seq_antes`.
  SELECT max(seq_antes) INTO piso_velho
    FROM public.agent_runs WHERE session_key = 'agent:nina:hsos-teste';

  ASSERT piso_novo = 137,
    format('o piso devia acompanhar o que o /reply leu (137), veio %s', piso_novo);
  ASSERT piso_velho = 119,
    format('o piso antigo devia congelar em 119, veio %s', piso_velho);
  ASSERT piso_novo > piso_velho,
    'sem seq_depois o corte congela e o turno anterior volta colado';
END $$;

-- Linha antiga, sem `seq_depois`: continua valendo pelo `seq_antes`, sem backfill.
INSERT INTO public.agent_runs (run_id, agent_id, session_key, seq_antes, user_id)
VALUES ('run-velho', 'nina', 'agent:nina:hsos-antiga', 42, '11111111-1111-1111-1111-111111111111');

DO $$
DECLARE piso int;
BEGIN
  SELECT max(greatest(seq_antes, coalesce(seq_depois, 0))) INTO piso
    FROM public.agent_runs WHERE session_key = 'agent:nina:hsos-antiga';
  ASSERT piso = 42, format('o NULL zerou o corte de uma linha antiga: %s', piso);
END $$;

ROLLBACK;
