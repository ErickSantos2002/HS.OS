#!/usr/bin/env bash
# Docker para a sandbox da nina e do atlas (PK-06, 26/11/2026). Roda NA VPS do
# gateway, como root — pelo Konsole do Erick:
#
#   scp ~/github/HS.OS/vps-gateway/sandbox/instalar.sh root@2.24.85.122:/root/
#   ssh root@2.24.85.122 'bash /root/instalar.sh'
#
# Idempotente. Não liga sandbox em ninguém: isso é o
# `scripts/sandbox-especialistas.py`, depois. Ver a spec
# docs/superpowers/specs/2026-11-26-pk06-sandbox-especialistas-design.md.
set -euo pipefail

echo "═══ 1. Memória antes ═══"; free -m | sed -n 2p

echo "═══ 2. Docker ═══"
# ⚠️ Sem iptables e sem bridge: os contêineres da sandbox rodam com
# `network: none`, e o Docker padrão reescreveria o firewall do host (FORWARD
# em DROP, NAT) numa máquina que tem Caddy e túnel em produção.
mkdir -p /etc/docker
cat > /etc/docker/daemon.json <<'JSON'
{
  "iptables": false,
  "ip6tables": false,
  "bridge": "none",
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "2" },
  "live-restore": true
}
JSON
if ! command -v docker >/dev/null; then
  apt-get update -q && DEBIAN_FRONTEND=noninteractive apt-get install -y -q docker.io
fi
systemctl enable --now docker
systemctl restart docker
docker version --format '  docker {{.Server.Version}}'

echo "═══ 3. Imagem (a da documentação do OpenClaw) ═══"
# Sem rede para construir? O build usa a rede do daemon, que é a do host.
docker build -q --network host -t openclaw-sandbox:bookworm-slim - <<'DOCKERFILE'
FROM debian:bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
  bash ca-certificates curl git jq python3 ripgrep gawk \
  && rm -rf /var/lib/apt/lists/*
RUN useradd --create-home --shell /bin/bash sandbox
USER sandbox
WORKDIR /home/sandbox
CMD ["sleep", "infinity"]
DOCKERFILE

echo "═══ 4. A parede segura? (mesmas opções que a config vai usar) ═══"
falhou=0
confere() { local r=$1; shift; if "$@"; then echo "  ✅ $r"; else echo "  ❌ $r"; falhou=1; fi; }
roda() {
  docker run --rm --network none --read-only --tmpfs /tmp --user 0:0 --cap-drop ALL \
    --memory 512m --pids-limit 128 -v /root/.openclaw/workspace-atlas:/workspace \
    openclaw-sandbox:bookworm-slim "$@"
}
confere "python3 roda" roda python3 -c 'print(1)' >/dev/null
confere "/tmp gravável" roda sh -c 'echo x > /tmp/t && cat /tmp/t' >/dev/null
confere "lê o workspace montado" roda test -s /workspace/AGENTS.md
confere "NÃO vê o openclaw.json" roda sh -c '! test -e /root/.openclaw/openclaw.json'
confere "NÃO tem rede" roda sh -c '! curl -s -m 5 https://1.1.1.1 >/dev/null'
confere "raiz só-leitura" roda sh -c '! touch /etc/x 2>/dev/null'

echo "═══ 5. Memória depois ═══"; free -m | sed -n 2p
exit "$falhou"
