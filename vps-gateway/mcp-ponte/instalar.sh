#!/usr/bin/env bash
# Instala ou atualiza a mcp-ponte na VPS do gateway. Roda da máquina do Erick:
#
#   bash vps-gateway/mcp-ponte/instalar.sh
#
# Idempotente. NÃO mexe na config do gateway — trocar as 78 entradas `hsos-*`
# é outro passo (`scripts/trocar-mcp-ponte.py`). Reiniciar derruba só os
# pedidos em voo naquele segundo e esvazia o cache (que se refaz sozinho).
set -euo pipefail

VPS="${VPS:-root@2.24.85.122}"
AQUI="$(cd "$(dirname "$0")" && pwd)"

echo "→ copiando para $VPS:/opt/mcp-ponte"
ssh -o ConnectTimeout=10 "$VPS" 'mkdir -p /opt/mcp-ponte'
scp -q "$AQUI"/{server.mjs,comparar.mjs,mcp-ponte.service} "$VPS:/opt/mcp-ponte/"

ssh -o ConnectTimeout=10 "$VPS" bash -s <<'REMOTO'
set -euo pipefail
chmod -R a+rX /opt/mcp-ponte
install -m 0644 /opt/mcp-ponte/mcp-ponte.service /etc/systemd/system/mcp-ponte.service
systemctl daemon-reload
systemctl enable mcp-ponte >/dev/null 2>&1
systemctl restart mcp-ponte
for i in $(seq 1 20); do
  curl -sf http://127.0.0.1:18791/saude >/dev/null && break
  sleep 0.5
done
echo "→ saúde: $(curl -sf http://127.0.0.1:18791/saude || echo 'NÃO RESPONDEU')"
systemctl --no-pager --lines=0 status mcp-ponte | sed -n 1,5p
REMOTO
