#!/usr/bin/env bash
# Túnel SSH persistente: 62.72.11.28 (backend) → 2.24.85.122 (OpenClaw)
#
# Por que existe: o OpenClaw só concede os scopes de operador para conexões que
# chegam no loopback dele. Pelo nginx (gateway.healthsafetytech.com) a sessão é
# proxiada, e o gateway zera a lista de scopes de propósito — "a session not
# bound to an approved paired device/token cannot self-declare permissions".
# Pelo túnel, a conexão chega como loopback real e os scopes voltam.
#
# Rodar na VPS 62.72.11.28, como root:  sudo bash tunel-openclaw.sh
set -euo pipefail

REMOTO_USER=root
REMOTO_HOST=2.24.85.122
PORTA=18789
SERVICO=openclaw-tunnel

echo "═══ 1. Diagnóstico da rede Docker ═══"
# O backend roda em container: o túnel precisa escutar num IP que o container
# alcance. 127.0.0.1 do host NÃO serve — dentro do container isso é o próprio
# container.
# Em Docker Swarm (que é o caso do EasyPanel) os containers ficam em rede
# overlay e alcançam o host pelo docker_gwbridge, NÃO pelo docker0. Confirmado
# lendo a rota padrão de dentro do container: gateway 172.18.0.1.
# A ordem abaixo importa — gwbridge primeiro, docker0 só como fallback.
for IFACE in docker_gwbridge docker0; do
  BRIDGE_IP=$(ip -4 -o addr show "$IFACE" 2>/dev/null | awk '{print $4}' | cut -d/ -f1 || true)
  [ -n "$BRIDGE_IP" ] && { echo "  bridge encontrada: $IFACE ($BRIDGE_IP)"; break; }
done
if [ -z "${BRIDGE_IP:-}" ]; then
  echo "  ⚠️  nenhuma bridge Docker encontrada. Redes disponíveis:"
  ip -4 -o addr show | awk '{print "     " $2 " " $4}'
  exit 1
fi
echo "  o backend usará: http://$BRIDGE_IP:$PORTA"

echo
echo "═══ 2. Chave SSH para o túnel ═══"
KEY=/root/.ssh/openclaw_tunnel
if [ -f "$KEY" ]; then
  echo "  chave já existe em $KEY"
else
  ssh-keygen -t ed25519 -N "" -f "$KEY" -C "tunel-openclaw-hsos"
  echo "  chave criada"
fi
echo
echo "═══ 3. Testando a conexão ═══"
if ssh -i "$KEY" -o BatchMode=yes -o StrictHostKeyChecking=accept-new \
       -o ConnectTimeout=10 "$REMOTO_USER@$REMOTO_HOST" "echo ok" >/dev/null 2>&1; then
  echo "  ✅ SSH autentica sem senha"
else
  echo "  ❌ A chave ainda não está autorizada no $REMOTO_HOST."
  echo
  echo "     Rode LÁ no $REMOTO_HOST — o printf com \\n é essencial:"
  echo "     se o authorized_keys não terminar em quebra de linha, um >> cola"
  echo "     a chave no fim da linha anterior e corrompe as duas."
  echo
  echo "     ─────────────────────────────────────────────────────────"
  echo "     printf '\\n%s\\n' '$(cat "$KEY".pub)' >> /root/.ssh/authorized_keys"
  echo "     ssh-keygen -lf /root/.ssh/authorized_keys   # deve listar a chave nova"
  echo "     ─────────────────────────────────────────────────────────"
  echo
  echo "     Depois rode este script de novo. Ele é idempotente."
  exit 1
fi

echo
echo "═══ 4. Serviço systemd ═══"
cat > /etc/systemd/system/$SERVICO.service <<UNIT
[Unit]
Description=Tunel SSH para o OpenClaw Gateway (2.24.85.122)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
# -N: sem shell remoto, só encaminhamento.
# ExitOnForwardFailure: se a porta não puder ser aberta, falhe em vez de ficar
#   de pé sem encaminhar nada — senão o systemd acha que está tudo bem.
# ServerAliveInterval/CountMax: derruba em 90s de silêncio para o Restart agir;
#   sem isso o túnel vira zumbi e o backend só descobre no timeout.
ExecStart=/usr/bin/ssh -N \\
  -i $KEY \\
  -o BatchMode=yes \\
  -o StrictHostKeyChecking=accept-new \\
  -o ExitOnForwardFailure=yes \\
  -o ServerAliveInterval=30 \\
  -o ServerAliveCountMax=3 \\
  -L $BRIDGE_IP:$PORTA:127.0.0.1:$PORTA \\
  $REMOTO_USER@$REMOTO_HOST
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable --now $SERVICO
sleep 3

echo
echo "═══ 5. Verificação ═══"
systemctl is-active --quiet $SERVICO && echo "  ✅ serviço ativo" || { echo "  ❌ serviço inativo"; journalctl -u $SERVICO -n 20 --no-pager; exit 1; }

if ss -ltn | grep -q "$BRIDGE_IP:$PORTA"; then
  echo "  ✅ escutando em $BRIDGE_IP:$PORTA"
else
  echo "  ❌ não está escutando. Log:"; journalctl -u $SERVICO -n 20 --no-pager; exit 1
fi

if curl -s -m 8 "http://$BRIDGE_IP:$PORTA/health" | grep -q '"ok"'; then
  echo "  ✅ o OpenClaw responde pelo túnel"
else
  echo "  ⚠️  túnel de pé mas /health não respondeu — confira o OpenClaw no 2.24.85.122"
fi

echo
echo "═══ Pronto ═══"
echo "  No EasyPanel, ajuste a variável do serviço backend:"
echo "      OPENCLAW_GATEWAY_URL=http://$BRIDGE_IP:$PORTA"
echo
echo "  Comandos úteis:"
echo "      systemctl status $SERVICO"
echo "      journalctl -u $SERVICO -f"
echo "      systemctl restart $SERVICO"
