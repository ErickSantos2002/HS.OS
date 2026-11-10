# Corte de acesso da `nina` ao banco — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o conector `HsOs` (o `banco-hsos` da `nina`) deixa de usar o usuário `leitura` (BYPASSRLS + `pg_read_all_data`) e passa a um usuário próprio que só lê uma lista fechada de tabelas — nada de DM, canal, e-mail, credencial.

**Architecture:** migração `033_usuario_agente.sql` cria o role `hsos_agente` (LOGIN, NOBYPASSRLS, read-only) com `SELECT` por tabela; um script admin gera a senha, grava no role e no `integrations.credentials` do conector (a senha nunca é impressa) e republica o conector pelo `publicar_banco` do backend.

**Tech Stack:** Postgres 18, script Python com `bancos` (perfil admin), backend FastAPI local contra o banco de produção + túnel do gateway.

**Spec:** `docs/superpowers/specs/2026-11-10-conversa-consigo-mesmo-design.md` (seção "Corte de acesso da `nina` ao banco").

## Global Constraints

- **Não mexer no role `leitura`** — é o do Erick (`~/.config/bancos/leitura.toml`).
- Allowlist, não denylist: tabela nova nasce fora.
- O Claude não lê o `admin.toml`; o script usa `bancos.conectar("hsos", perfil="admin")` e roda com `~/projetos/bancos/.venv/bin/python`.
- A senha gerada não aparece em saída, log nem transcript.
- Escrita no gateway (`config.patch` via `publicar_banco`): mostrar o que vai mudar e confirmar com o Erick antes (regra do `CLAUDE.md`).

## Levantamento (feito em 10/11/2026, traces da VPS)

2.004 chamadas `banco-hsos__query` da `nina` (+ 22 do `atlas`, 9 da `iris`, antigas). Tabelas do HS.OS usadas: `agent_profiles`, `artifacts_published`, `diretorio`, `agent_results`, `usage_events`, `integrations` (só metadados: `id, name, key_name, integration_type, is_configured, agents_using, category, template_id, db_base, db_somente_leitura`), `profiles` (nome/e-mail — coberto pela `diretorio`), `access_logs`, `user_roles`, `anexos` (metadado de um id — o `ler_anexo` cobre). **Nenhuma leitura de conteúdo** de `channel_messages`, `conversations` ou `email_*` (só contagem em `pg_stat_user_tables`).

**Allowlist** (`SELECT`): `agent_profiles`, `agent_results`, `agent_crons`, `agent_skills`, `agent_integrations`, `agent_stats`, `artifacts_published`, `artifact_titles`, `diretorio`, `usage_events`, `usage_daily`, `usage_by_agent_day`, `usage_by_model_day`, `usage_by_task_day`, `teams`, `team_agents`, `company_profile`, `branding`, `skills`, `wiki_spaces`, `wiki_documents`, `automations`, `automation_runs`, `model_pricing`, `gateway_health`, `integration_templates` e, em `integrations`, **só as colunas** listadas acima.

Ficam de fora de propósito: `profiles` (a `diretorio` é a vista estreita), `access_logs`, `user_roles`, `anexos`, `agent_runs`, `agent_turns`, `agent_turn_events`, `agent_activity*` (podem carregar trecho de conversa), tudo de canal/DM/conversa/e-mail/push/lembrete/ação, `integration_secrets`, `vps_config`, `sso_tickets`.

## Review Focus

1. `PUBLIC` com privilégio herdado em alguma tabela (compat Supabase) furaria a allowlist — conferir `has_table_privilege('hsos_agente', …)` em **todas** as 91, não só nas sensíveis.
2. A `diretorio` é view `security_invoker = false` dono `administrador`: precisa funcionar com só `SELECT` na view.
3. Publicar com a credencial nova e o SSL: `publicar_banco` conecta para conferir SSL antes — se a senha não colou, ele falha ANTES de escrever no gateway (bom).
4. Erro de conexão logo após `config.patch` não quer dizer que não gravou (`CLAUDE.md`) — reler a config.
5. `iris`/`atlas` não têm mais `banco-hsos` no `alsoAllow` — o republish recalcula o `deny` de todos; conferir que o `alsoAllow` dos outros sobreviveu.

---

### Task 1: Migração `033_usuario_agente.sql`

**Files:**
- Create: `backend/migrations/033_usuario_agente.sql`
- Create: `~/aplicar-hsos-033.py` (fora do repo, padrão dos anteriores)

**Interfaces:**
- Produces: role `hsos_agente` (LOGIN, sem senha na migração), `default_transaction_read_only = on`, `CONNECT`/`USAGE public`, `SELECT` exatamente na allowlist.

- [ ] **Step 1:** Escrever a migração no estilo da `006` (cabeçalho explicando o porquê com o levantamento acima; `CREATE ROLE` em `DO $$ IF NOT EXISTS`; `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM hsos_agente` antes dos `GRANT`; `GRANT SELECT (col, …) ON public.integrations`). Idempotente.
- [ ] **Step 2:** Script `~/aplicar-hsos-033.py`: aplica o SQL, gera senha (`secrets.token_urlsafe(32)`), `ALTER ROLE hsos_agente PASSWORD %s`, e atualiza em `integrations` (linha `name = 'HsOs'`, `db_base = 'hsos'`) os pares `ro_usuario = 'hsos_agente'` e `ro_senha = <senha>` dentro do array `credentials`, tudo numa transação. **Confere o efeito:** para cada uma das 91 relações de `public`, `has_table_privilege('hsos_agente', 'public.'||t, 'SELECT')` tem que ser verdadeiro **exatamente** na allowlist; `has_column_privilege('hsos_agente','public.integrations','credentials','SELECT')` falso; conecta como `hsos_agente` (lendo a URL montada da própria linha, sem imprimir) e roda `SELECT count(*) FROM public.diretorio` (ok) e `SELECT 1 FROM public.channel_messages LIMIT 1` (tem que dar `permission denied`). Sai com erro se qualquer conferência falhar.
- [ ] **Step 3:** Rodar: `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-033.py`. Esperado: `ok` e nenhuma linha de divergência.
- [ ] **Step 4:** Commit da migração.

### Task 2: Republicar o conector e conferir

**Files:** nenhum no repo (operação).

- [ ] **Step 1:** Mostrar ao Erick o que muda no gateway: só a URL de `mcp.servers.banco-hsos` (usuário `leitura` → `hsos_agente`) e o recálculo de `deny`. Aguardar o ok.
- [ ] **Step 2:** Chamar `publicar_banco(<id do HsOs>)` do backend (script local com o `.env` do backend, túnel aberto, coletores desligados — ver `CLAUDE.md`).
- [ ] **Step 3:** Reler `config.get`: `mcp.servers.banco-hsos` aponta para `hsos_agente` (imprimir só o usuário da URL) e o `alsoAllow` dos 5 especialistas segue igual.
- [ ] **Step 4:** Conferência que vale: perguntar à `nina` (com ok do Erick) para rodar no `banco-hsos` uma leitura de `channel_messages` (espera recusa por permissão) e uma de `agent_profiles` (espera funcionar).
- [ ] **Step 5:** Registrar no `CLAUDE.md` (seção de escopo de banco por agente): o `banco-hsos` usa `hsos_agente`, allowlist na `033`, tabela nova nasce fora; e o porquê.
