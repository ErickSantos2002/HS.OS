#!/usr/bin/env bash
# Cópia diária dos mapas (volume do map-storage) para o R2. Roda como root na
# VPS, pelo escritoriohs-backup.timer. Credenciais em /etc/escritoriohs/backup.env:
#   VOLUME=<nome do volume>  R2_ACCOUNT_ID=  R2_ACCESS_KEY_ID=  R2_SECRET_ACCESS_KEY=  R2_BUCKET=hsos-arquivos
set -euo pipefail
set -a; . /etc/escritoriohs/backup.env; set +a
dia=$(date +%F)
arq="/tmp/mapas-$dia.tar.gz"
trap 'rm -f "$arq"' EXIT
docker run --rm -v "$VOLUME":/maps:ro -v /tmp:/out alpine:3.20 tar czf "/out/mapas-$dia.tar.gz" -C /maps .
aws() {
  docker run --rm -v /tmp:/tmp -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    -e AWS_DEFAULT_REGION=auto amazon/aws-cli:2.17.0 --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" "$@"
}
aws s3 cp "$arq" "s3://$R2_BUCKET/escritoriohs/backups/mapas-$dia.tar.gz" --only-show-errors
# Mantém os 30 mais recentes.
aws s3 ls "s3://$R2_BUCKET/escritoriohs/backups/" | awk '{print $4}' | sort | head -n -30 \
  | while read -r velho; do [ -n "$velho" ] && aws s3 rm "s3://$R2_BUCKET/escritoriohs/backups/$velho" --only-show-errors; done
echo "backup ok: mapas-$dia.tar.gz ($(stat -c %s "$arq") bytes)"
