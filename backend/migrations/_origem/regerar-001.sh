#!/usr/bin/env bash
# Regera 001_initial_schema.sql a partir do dump de origem.
#
# O 001 é um arquivo GERADO — não edite à mão. Se precisar mudar o schema,
# crie uma migration nova (002, 003...). Este script existe para o caso de
# precisarmos extrair de novo com opções diferentes.
set -euo pipefail

cd "$(dirname "$0")/.."
DUMP="_origem/42055871-1cf6-4998-a33e-c74d8b1f2031_260804.backup"
SAIDA="001_initial_schema.sql"

# --schema=public   → só o schema da aplicação; auth/storage/realtime/vault são
#                     internos do Supabase e não vão para o Postgres próprio
# --schema-only     → o banco de origem está vazio (confirmado: 0 linhas em
#                     todas as 69 tabelas), então não há dado a trazer
# --no-owner        → o dono no destino é o role da aplicação, não o do Supabase
# (ACLs mantidas)   → os GRANTs para `authenticated` são necessários para o RLS
#                     funcionar; sem eles o role não enxerga tabela nenhuma
pg_restore --schema=public --schema-only --no-owner -f "$SAIDA.tmp" "$DUMP"

# Remove o encanamento de ownership do Supabase. Estes comandos definem
# privilégios padrão para objetos criados PELOS roles `postgres` e
# `supabase_admin` — no banco próprio quem cria objeto é o role da aplicação,
# então são inócuos, e mantê-los obrigaria a criar dois roles falsos para
# sempre só para o arquivo aplicar.
REMOVIDAS=$(grep -cE '^ALTER DEFAULT PRIVILEGES FOR ROLE (postgres|supabase_admin) ' "$SAIDA.tmp" || true)
grep -vE '^ALTER DEFAULT PRIVILEGES FOR ROLE (postgres|supabase_admin) ' \
  "$SAIDA.tmp" > "$SAIDA"
rm "$SAIDA.tmp"

echo "Gerado: $SAIDA ($(wc -l < "$SAIDA") linhas)"
echo "Removidas $REMOVIDAS linhas de default privileges do Supabase."
