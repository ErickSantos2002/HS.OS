#!/usr/bin/env bash
# ============================================================
# dnOS Remix — Atualização do OpenClaw
# Versão: 1.1.0 | Atualizado: 2026-07-12
# Uso: bash update-patch.sh
# ============================================================
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'
BOLD='\033[1m'

log_info()  { echo -e "${BLUE}[INFO]${NC}  $1"; }
log_ok()    { echo -e "${GREEN}[OK]${NC}    $1"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC}  $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

echo -e "${CYAN}${BOLD}"
echo "╔══════════════════════════════════════════╗"
echo "║   🔧 dnOS Remix — Atualizar OpenClaw    ║"
echo "║        v1.1.0 — $(date +%Y-%m-%d)         ║"
echo "╚══════════════════════════════════════════╝"
echo -e "${NC}"

# Root check
if [[ $EUID -ne 0 ]]; then
    log_error "Este script precisa ser executado como root."
    log_info "Use: sudo bash update-patch.sh"
    exit 1
fi

# Versão atual
CURRENT_VERSION=$(openclaw --version 2>/dev/null || echo "desconhecida")
log_info "Versão atual do OpenClaw: $CURRENT_VERSION"

# Atualizar OpenClaw
log_info "Atualizando OpenClaw para a versão mais recente..."
npm install -g openclaw@latest

NEW_VERSION=$(openclaw --version 2>/dev/null || echo "desconhecida")
log_ok "OpenClaw atualizado: $NEW_VERSION"

# Reiniciar Gateway
if systemctl is-active --quiet openclaw-gateway 2>/dev/null; then
    log_info "Reiniciando Gateway..."
    systemctl restart openclaw-gateway
    sleep 3
    if systemctl is-active --quiet openclaw-gateway; then
        log_ok "Gateway reiniciado com sucesso"
    else
        log_warn "Gateway não subiu após restart"
        log_info "Verifique: journalctl -u openclaw-gateway -n 20"
    fi
else
    log_info "Gateway não estava rodando — iniciando..."
    systemctl start openclaw-gateway 2>/dev/null || log_warn "Não foi possível iniciar"
fi

echo ""
echo -e "${GREEN}${BOLD}✅ Atualização concluída!${NC}"
log_info "OpenClaw: $CURRENT_VERSION → $NEW_VERSION"
