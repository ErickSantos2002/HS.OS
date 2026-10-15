#!/usr/bin/env bash
# Instala ou atualiza a mídia do escritório. Roda como root NA VPS:
#   scp -r escritoriohs/midia root@62.72.11.28:/opt/escritoriohs/ && ssh root@62.72.11.28 bash /opt/escritoriohs/midia/instalar.sh
# Gera os segredos só na primeira vez e NUNCA os imprime.
set -euo pipefail
install -d -m 700 /etc/escritoriohs
if [ ! -f /etc/escritoriohs/midia.env ]; then
  umask 077
  chave="hs$(openssl rand -hex 6)"
  segredo="$(openssl rand -hex 32)"
  {
    echo "LIVEKIT_KEYS=\"$chave: $segredo\""
    echo "LIVEKIT_API_KEY=$chave"
    echo "LIVEKIT_API_SECRET=$segredo"
    echo "TURN_STATIC_AUTH_SECRET=$(openssl rand -hex 32)"
  } > /etc/escritoriohs/midia.env
  echo "segredos gerados em /etc/escritoriohs/midia.env"
fi
install -m 644 /opt/escritoriohs/midia/escritoriohs-midia.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now escritoriohs-midia.service
cd /opt/escritoriohs/midia && docker compose pull -q && docker compose up -d
sleep 3
docker compose ps --format '{{.Service}} {{.State}}'
