#!/usr/bin/env bash
# Sobe um Postgres 17 descartável e aplica as migrations do `hsos` em ordem.
#
# Existe porque o schema do HS.OS não cabe num teste de unidade: trigger, policy
# de RLS e função SQL só se provam num banco de verdade. Este é descartável de
# propósito — ele é recriado do zero a cada execução, e portanto nada que se
# faça nele precisa de cuidado.
#
#   bash scripts/banco-rascunho.sh          # recria e aplica tudo
#   psql "$(bash scripts/banco-rascunho.sh --url)" -f arquivo.sql
#
# ⚠️ A `008_pessoas_talenths.sql` NÃO é deste banco — ela se aplica no
#    `talenths-banco`. Aplicá-la aqui falharia em `public.departments`, que não
#    existe no schema do HS.OS.
set -euo pipefail

NOME=${NOME:-hsos-rascunho}
PORTA=${PORTA:-5433}
SENHA=rascunho
URL="postgresql://postgres:${SENHA}@127.0.0.1:${PORTA}/hsos"

if [ "${1:-}" = "--url" ]; then echo "$URL"; exit 0; fi

RAIZ="$(cd "$(dirname "$0")/.." && pwd)"

docker rm -f "$NOME" >/dev/null 2>&1 || true
# POSTGRES_DB=hsos porque a `006_diretorio.sql` faz `GRANT CONNECT ON DATABASE
# hsos` — nome fixo, igual ao de produção. Sem isso a 006 falha com "database
# hsos does not exist" no banco descartável (que por padrão nasceria `postgres`).
docker run -d --name "$NOME" \
    -e POSTGRES_PASSWORD="$SENHA" \
    -e POSTGRES_DB="hsos" \
    -p "${PORTA}:5432" postgres:17 >/dev/null

echo "esperando o banco subir…"
until docker exec "$NOME" pg_isready -U postgres -q 2>/dev/null; do sleep 1; done

cd "$RAIZ/backend/migrations"
for f in [0-9][0-9][0-9]_*.sql; do
    case "$f" in
        008_*) echo "pulando $f (é do talenths-banco)"; continue ;;
    esac
    echo "aplicando $f"
    psql "$URL" -v ON_ERROR_STOP=1 -q -f "$f"
done

echo
echo "pronto: $URL"
