# Migrations — TeamsHS

Schema do Postgres próprio. **Pasta ainda vazia**: o schema atual vive só no projeto
Supabase remoto (`urbityqksiiderlvaubl`) e precisa ser extraído de lá antes de qualquer
coisa. Ver "Extraindo o schema" abaixo.

## Convenção

Arquivos `.sql` numerados em sequência, aplicados em ordem:

```
001_initial_schema.sql
002_<assunto>.sql
003_<assunto>.sql
```

**Nunca edite uma migration já aplicada.** Mudou de ideia? Crie a próxima. O arquivo
aplicado é histórico, não rascunho — editar quebra qualquer ambiente que já rodou.

## Extraindo o schema do Supabase

O ponto de partida é um dump só de estrutura do projeto remoto, que vira o `001`:

```bash
pg_dump --schema-only --no-owner --no-privileges \
  "postgresql://postgres:<senha>@db.urbityqksiiderlvaubl.supabase.co:5432/postgres" \
  > 001_initial_schema.sql
```

O que o dump traz e precisa de decisão consciente antes de virar migration:

- **Políticas de RLS** — dependem de `auth.uid()` e `auth.jwt()`, funções do Supabase que
  não existem num Postgres puro. Com a auth própria, a autorização vira responsabilidade
  do backend (`app/dependencies.py`). Ou você recria um equivalente de `auth.uid()`, ou
  descarta as policies e move a regra para a API. Não dá para copiar e colar.
- **Schema `auth`** — tabelas de usuário do Supabase (`auth.users`). A tabela `profiles` e
  `user_roles` referenciam esses IDs; a migração de auth precisa preservar os UUIDs para
  não órfãos os dados existentes.
- **Schema `storage`** — buckets de arquivos. Substituído por `UPLOADS_DIR` ou S3.
- **Extensões** — `pgcrypto`, `uuid-ossp` e afins precisam existir no Postgres de destino.
- **Cron jobs** — os 5 jobs operacionais (scheduler de automações, sync de agentes, limpeza
  de arquivos, watchdog) hoje rodam via `pg_cron` no Supabase. No servidor próprio viram
  `pg_cron` também ou tarefas do backend.

## Referência

As ~70 tabelas, views e RPCs estão tipadas em
`frontend/src/integrations/supabase/types.ts` — é o inventário mais fiel do schema que
existe dentro do repositório, útil para conferir se o dump veio completo.
