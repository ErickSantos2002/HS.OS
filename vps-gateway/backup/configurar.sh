#!/usr/bin/env bash
# Liga o backup da VPS do gateway. Roda NO KONSOLE do Erick, uma vez:
#
#   bash ~/github/HS.OS/vps-gateway/backup/configurar.sh
#
# Antes, no painel da Cloudflare (README.md, ao lado): bucket próprio, regra de
# bloqueio e um token de R2 só desse bucket. As chaves são pedidas aqui, sem
# eco, e vão para a VPS pelo stdin do ssh — não passam por argv nem histórico.
#
# A SENHA DO RESTIC é a chave do cofre: sem ela o backup não abre, nem para
# nós. Gere uma forte e guarde no FortiPAM ANTES de rodar este script.
set -euo pipefail
VPS="${VPS:-root@2.24.85.122}"

read -rp  "Account ID da Cloudflare: " CONTA
read -rp  "Nome do bucket [hsos-backup-gateway]: " BUCKET; BUCKET=${BUCKET:-hsos-backup-gateway}
read -rp  "Access Key ID do token R2: " CHAVE
read -rsp "Secret Access Key do token R2: " SEGREDO; echo
read -rsp "Senha do restic (a que está no FortiPAM): " SENHA; echo
read -rsp "Repita a senha do restic: " SENHA2; echo
[ "$SENHA" = "$SENHA2" ] || { echo "As senhas não batem."; exit 1; }
[ ${#SENHA} -ge 20 ] || { echo "Use uma senha de 20+ caracteres."; exit 1; }

printf 'RESTIC_REPOSITORY=s3:https://%s.r2.cloudflarestorage.com/%s/gateway\nRESTIC_PASSWORD=%s\nAWS_ACCESS_KEY_ID=%s\nAWS_SECRET_ACCESS_KEY=%s\nAWS_DEFAULT_REGION=auto\n' \
  "$CONTA" "$BUCKET" "$SENHA" "$CHAVE" "$SEGREDO" |
ssh -o ConnectTimeout=10 "$VPS" 'umask 077; mkdir -p /root/.config/backup-openclaw && cat > /root/.config/backup-openclaw/env'

echo "→ criando o repositório"
ssh "$VPS" '/opt/backup-openclaw/backup-openclaw.sh --iniciar'
echo "→ primeiro backup"
ssh "$VPS" '/opt/backup-openclaw/backup-openclaw.sh'
echo "→ teste de restauração"
ssh "$VPS" '/opt/backup-openclaw/backup-openclaw.sh --testar'
echo
echo "Pronto. O timer roda todo dia às 03:30 BRT:"
ssh "$VPS" 'systemctl list-timers backup-openclaw.timer --no-pager | sed -n 2p'
