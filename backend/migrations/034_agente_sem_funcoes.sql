-- 034_agente_sem_funcoes.sql — fecha as funções SECURITY DEFINER ao `hsos_agente`
--
-- ⚠️ **A 033 fechou as tabelas e deixou as funções abertas.** Achado pela
--    revisão de segurança do commit, no mesmo dia (10/11/2026). Toda função do
--    `public` herdada do Supabase tem `EXECUTE` para PUBLIC (`=X/administrador`
--    no `proacl`), e 32 delas são SECURITY DEFINER — rodam com a permissão do
--    dono e atravessam allowlist e RLS. `get_agents_last_activity` devolve
--    `LEFT(conversations.content, 120)`: pelo `banco-hsos` a `nina` voltaria a
--    ler trecho de conversa alheia por uma chamada de função.
--
-- O que muda: em cada função SECURITY DEFINER de `public`, o EXECUTE sai de
-- PUBLIC e volta, nominalmente, para quem sempre usou — os roles da aplicação
-- (`anon`, `authenticated`, `service_role`, `sandbox_exec`, `hsos_app`) e o
-- `leitura` do Erick. Para eles nada muda; ficam de fora `hsos_agente` e
-- `hsos_diretorio`. Função de trigger não depende de EXECUTE ao disparar.
--
-- ⚠️ **Função SECURITY DEFINER nova nasce com EXECUTE para PUBLIC** (padrão do
--    Postgres). Quem criar uma tem que repetir o REVOKE abaixo para ela — o
--    `~/aplicar-hsos-034.py` confere todas, e vale rodar a conferência de novo.
--
-- E `automation_runs.output` sai da allowlist: é o texto que a automação
-- produziu, e pode carregar dado de pessoa. Ficam os metadados da execução.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO.**

BEGIN;

DO $$
DECLARE
    f record;
    papel text;
BEGIN
    FOR f IN
        SELECT p.oid::regprocedure AS assinatura
          FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef
    LOOP
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', f.assinatura);
        FOREACH papel IN ARRAY ARRAY['anon', 'authenticated', 'service_role', 'sandbox_exec', 'hsos_app', 'leitura']
        LOOP
            IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = papel) THEN
                EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO %I', f.assinatura, papel);
            END IF;
        END LOOP;
    END LOOP;
END
$$;

REVOKE SELECT ON public.automation_runs FROM hsos_agente;
GRANT SELECT (id, automation_id, cron_job_name, started_at, finished_at, status)
    ON public.automation_runs TO hsos_agente;

COMMIT;
