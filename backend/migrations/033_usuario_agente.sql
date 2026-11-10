-- 033_usuario_agente.sql — o `banco-hsos` da `nina` deixa de ler tudo
--
-- ⚠️ **Até 10/11/2026 o conector `HsOs` entrava com o usuário `leitura`**, que
--    tem `BYPASSRLS` e `pg_read_all_data`. Pela ferramenta `banco-hsos__query`
--    a `nina` lia toda DM entre pessoas, as `email_*` e a coluna
--    `integrations.credentials` — as senhas dos conectores, em texto puro.
--    Bastava alguém pedir, ou uma injeção vinda de documento ou e-mail. A
--    `006_diretorio.sql` já tinha descrito o risco para os outros agentes; o
--    da orquestradora ficou aberto. Achado ao desenhar a conversa consigo
--    mesmo (spec 2026-11-10), cujas anotações cairiam na mesma tabela.
--
-- ⚠️ **O `leitura` NÃO muda.** É o usuário de consulta do Erick
--    (`~/.config/bancos/leitura.toml`); cortar nele cortaria o dono.
--
-- **Allowlist, não denylist.** Revogar o sensível deixaria toda tabela nova
-- aberta por padrão. Aqui é o contrário: o que não está abaixo, o agente não
-- lê. A lista saiu do uso real — 2.004 chamadas da `nina` nos traces da VPS
-- (10/11/2026): nenhuma lia conteúdo de conversa, canal ou e-mail.
--
-- Fora de propósito: `profiles` (a `diretorio` é a vista estreita),
-- `access_logs`, `user_roles`, `anexos` (o `ler_anexo` é o caminho, com a
-- regra de turno), `agent_runs`/`agent_turns`/`agent_turn_events`/
-- `agent_activity*` (podem carregar trecho de conversa), tudo de canal, DM,
-- conversa, e-mail, push, lembrete e ação, `integration_secrets`,
-- `vps_config`, `sso_tickets`.
--
-- A senha não está aqui: `~/aplicar-hsos-033.py` gera, grava no role e no
-- `integrations.credentials` do conector, e confere tabela por tabela.
--
-- ⚠️ **APLICAR COMO SUPERUSUÁRIO.**

BEGIN;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hsos_agente') THEN
        CREATE ROLE hsos_agente LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
    END IF;
END
$$;

-- ⚠️ **BYPASSRLS aqui é de propósito, e não reabre nada.** Quem protege é o
-- GRANT por tabela, não a RLS: as policies das tabelas da lista são para
-- `authenticated` (com `auth.uid()`), e sem BYPASSRLS o agente veria todas
-- VAZIAS — falha silenciosa, cara de "não há dados". O `leitura` era perigoso
-- pelo `pg_read_all_data`, não pelo BYPASSRLS.
ALTER ROLE hsos_agente BYPASSRLS;

ALTER ROLE hsos_agente SET default_transaction_read_only = on;
ALTER ROLE hsos_agente SET statement_timeout = '30s';

GRANT CONNECT ON DATABASE hsos TO hsos_agente;
GRANT USAGE ON SCHEMA public TO hsos_agente;

-- Zera antes de conceder: rodar de novo depois de mexer na lista tira o que saiu.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hsos_agente;

GRANT SELECT ON
    public.agent_profiles,
    public.agent_results,
    public.agent_crons,
    public.agent_skills,
    public.agent_integrations,
    public.agent_stats,
    public.artifacts_published,
    public.artifact_titles,
    public.diretorio,
    public.usage_events,
    public.usage_daily,
    public.usage_by_agent_day,
    public.usage_by_model_day,
    public.usage_by_task_day,
    public.teams,
    public.team_agents,
    public.company_profile,
    public.branding,
    public.skills,
    public.wiki_spaces,
    public.wiki_documents,
    public.automations,
    public.automation_runs,
    public.model_pricing,
    public.gateway_health,
    public.integration_templates
TO hsos_agente;

-- `integrations`: só os metadados que a `nina` consulta. `credentials` fica de fora.
GRANT SELECT (id, name, key_name, integration_type, is_configured, agents_using,
              category, template_id, description, db_base, db_somente_leitura,
              last_validated_at, last_validation_ok)
    ON public.integrations TO hsos_agente;

COMMIT;
