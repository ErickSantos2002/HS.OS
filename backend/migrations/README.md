# Migrations — HS.OS

Schema do Postgres próprio, extraído do Supabase e validado em Postgres puro.

## Arquivos

| Arquivo | O que é |
|---|---|
| `000_compat_supabase.sql` | Camada de compatibilidade. Escrito à mão. |
| `001_initial_schema.sql` | Schema `public` completo. **Gerado** — não edite. |
| `_origem/` | Dump de origem + script de regeração + export do SQL editor |

Aplicar em ordem, num banco vazio:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 000_compat_supabase.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 001_initial_schema.sql
```

## Convenção

Arquivos `.sql` numerados, aplicados em ordem. **Nunca edite uma migration já
aplicada** — crie a próxima. O arquivo aplicado é histórico, não rascunho.

O `001` é gerado a partir do dump: para extrair de novo, rode
`_origem/regerar-001.sh`. Mudanças de schema daqui pra frente vão na `002+`.

## Por que existe o 000

O schema veio de um banco Supabase e depende de coisas que não existem num
Postgres comum. Sem o `000`, o `001` falha com 213 erros. O `000` recria o
mínimo:

- **Roles** `anon`, `authenticated`, `service_role`, `sandbox_exec` — 164
  policies e 385 GRANTs referenciam esses nomes
- **Schema `auth`** com `auth.users` (11 FKs apontam para lá) e as funções
  `auth.uid()` / `auth.role()` — 123 policies chamam `auth.uid()`, e duas
  tabelas (`arenas`, `message_reactions`) usam `DEFAULT auth.uid()` numa coluna
- **Extensões** `pgcrypto` (54 defaults usam `gen_random_uuid()`) e
  `moddatetime` (2 triggers)

### Como o backend conversa com isso

`auth.uid()` no Supabase lê o JWT. Aqui ele lê um setting de sessão que o
backend precisa preencher a cada request autenticado, antes de qualquer query:

```sql
SET LOCAL app.current_user_id = '<uuid do usuário>';
SET LOCAL app.user_role       = 'authenticated';
```

Sem isso, `auth.uid()` devolve `NULL` e as policies negam — que é o padrão
seguro. Se você inserir numa tabela com `created_by NOT NULL DEFAULT auth.uid()`
sem setar o usuário, a transação falha com violação de not-null.

⚠️ O setting **não** pode se chamar `app.current_role`: `current_role` é palavra
reservada no Postgres e o parser rejeita o `SET LOCAL` com erro de sintaxe.

## Decisão em aberto: manter RLS?

As 191 policies foram preservadas e **funcionam** — validado com teste real. Mas
elas duplicam a autorização que o FastAPI também vai fazer (`app/dependencies.py`).

- **Manter**: segunda linha de defesa. Um endpoint que esqueça o `require_roles`
  ainda esbarra na policy. Custo: todo request precisa do `SET LOCAL`, e a regra
  de acesso vive em dois lugares.
- **Aposentar**: uma fonte de verdade só, mais simples de raciocinar. Custo: cada
  endpoint esquecido é um furo aberto.

O TalentHS manteve RLS. Se a decisão aqui for aposentar, ela vira a `002` — e o
`000` continua necessário (roles e `auth.users` seguem servindo às FKs).

## O que ficou de fora do 001

- **Schemas internos do Supabase** — `auth` (o real), `storage`, `realtime`,
  `vault`, `graphql`, `pgmq`, `pgbouncer`. Não vão para o Postgres próprio.
- **Dados** — não há. Confirmado: as 69 tabelas do `public` estão com 0 linhas, e
  `auth.users` também. A migração é 100% de estrutura.
- **`ALTER DEFAULT PRIVILEGES FOR ROLE postgres|supabase_admin`** — 26 linhas de
  encanamento de ownership do Supabase, sem efeito no banco próprio. Removidas
  pelo `regerar-001.sh`.
- **Cron jobs** — os 5 jobs operacionais (scheduler de automações, sync de agentes,
  limpeza de arquivos, watchdog) rodavam via `pg_cron` no Supabase. ⚠️ **`pg_cron`
  NÃO está disponível no Postgres da VPS** (só `pgcrypto`, `moddatetime`, `plpgsql`).
  Então não é opção: os jobs viram tarefas agendadas do backend (APScheduler no
  FastAPI, ou cron do sistema chamando endpoints). **Pendente — decidir o mecanismo.**
- **Storage** — 6 buckets a recriar como `UPLOADS_DIR`/S3: `agent-files`,
  `audio-messages`, `wiki-uploads` (públicos), `company-docs`,
  `generated-documents` (privados). **Pendente.**

## Validação feita

Restaurado num Postgres 18.4 limpo (container `pg-teste`), do zero:

```
000 → 0 erros      001 → 0 erros
tabelas 69/69 · views 3/3 · policies 191/191 · FKs 32/32 · triggers 21/21 · enums 3/3
```

Teste funcional: com `app.current_user_id` setado, o INSERT em `arenas` preenche
`created_by` via `auth.uid()` e a leitura respeita a policy; sem o setting, a
transação é negada.


## `003_realtime.sql` — substitui o `postgres_changes`

Cria a função `notificar_mudanca()` e um trigger em 16 tabelas observadas pelo
front. Ver `docs/PLANO-REALTIME.md`.

⚠️ **Precisa de superusuário.** O `hsos_app` não tem CREATE no schema public, e
é assim de propósito. Aplicar com o `administrador`.

⚠️ **Ainda não aplicada** em 07/08/2026 — a senha do superusuário não está no
`.env` do backend, e nem deve estar.
