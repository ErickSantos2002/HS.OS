#!/usr/bin/env bash
# Instala ou atualiza o banco-mcp na VPS do gateway. Roda da máquina do Erick:
#
#   bash vps-gateway/banco-mcp/instalar.sh
#
# Idempotente. NÃO mexe na config do gateway — trocar as entradas `banco-*` é
# outro passo (ver README.md). Reiniciar o serviço derruba só as consultas em
# voo naquele segundo; o `Restart=always` e o pool sem estado fazem o resto.
set -euo pipefail

VPS="${VPS:-root@2.24.85.122}"
AQUI="$(cd "$(dirname "$0")" && pwd)"

echo "→ copiando para $VPS:/opt/banco-mcp"
ssh -o ConnectTimeout=10 "$VPS" 'mkdir -p /opt/banco-mcp'
scp -q "$AQUI"/{server.mjs,comparar.mjs,package.json,package-lock.json,banco-mcp.service} "$VPS:/opt/banco-mcp/"

ssh -o ConnectTimeout=10 "$VPS" bash -s <<'EOF'
set -euo pipefail
cd /opt/banco-mcp
# `ci` e não `install`: falha se o lockfile divergir, em vez de resolver versão
# nova em silêncio. A saída do serviço depende da versão exata do `pg`.
npm ci --omit=dev --no-audit --no-fund --loglevel=error
chmod -R a+rX /opt/banco-mcp
install -m 0644 banco-mcp.service /etc/systemd/system/banco-mcp.service
systemctl daemon-reload
systemctl enable banco-mcp >/dev/null 2>&1
systemctl restart banco-mcp
for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:18790/saude >/dev/null && break
  sleep 0.5
done
echo "→ saúde: $(curl -sf http://127.0.0.1:18790/saude || echo 'NÃO RESPONDEU')"
systemctl --no-pager --lines=0 status banco-mcp | sed -n 1,5p
EOF
