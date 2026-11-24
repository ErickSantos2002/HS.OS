#!/usr/bin/env bash
# Backup cifrado da VPS do gateway para o R2 (PK-10, 24/11/2026).
#
#   backup-openclaw.sh             # faz um snapshot
#   backup-openclaw.sh --testar    # restaura o último numa pasta temporária e confere
#   backup-openclaw.sh --iniciar   # cria o repositório (uma vez)
#
# Lê a credencial de /root/.config/backup-openclaw/env (0600), escrita pelo
# `configurar-backup-gateway.sh` da máquina do Erick. Sem ele, não faz nada.
#
# ⚠️ Por que restic e não `aws s3 cp`: o `openclaw.json` tem o token do gateway
# e as URLs dos 9 bancos com senha. O backup sai CIFRADO da máquina, com senha
# guardada no FortiPAM. E a chave do R2 é de escrita SEM permissão de apagar:
# quem invadir a VPS não apaga as cópias. Consequência: `restic forget/prune`
# não roda daqui — a poda é da máquina do Erick, com outra chave (README).
#
# ⚠️ Antes deste script a VPS não tinha backup nenhum (verificação de 23/11):
# crontab vazio, nenhum timer, um tar de 3 KB de 13/08. Perder a máquina
# apagava memória e workspace de 29 agentes.
set -euo pipefail

ENV=/root/.config/backup-openclaw/env
[ -r "$ENV" ] || { echo "Sem $ENV — rode o configurar-backup-gateway.sh primeiro."; exit 3; }
set -a; . "$ENV"; set +a
: "${RESTIC_REPOSITORY:?}" "${RESTIC_PASSWORD:?}"

OC=/root/.openclaw
ESTAGIO=/root/.backup-openclaw-estagio   # cópias seguras dos sqlite em uso

# O que fica de fora, e por quê:
#  - *.trajectory*: 1,1 GB de rastro de depuração por turno; a conversa em si
#    está no .jsonl ao lado, que entra.
#  - sessões apagadas, cache, logs, mídia temporária, node_modules: refazem-se.
#  - openclaw.json.bak*/last-good/pre-update: cópias da config que já entra.
#  - os *.sqlite vivos: entram pela cópia segura do $ESTAGIO (abaixo).
#  - o próprio $ENV: é a credencial do backup.
EXCLUIR=(
  --exclude '*.trajectory.jsonl' --exclude '*.trajectory-path.json'
  --exclude '*.jsonl.deleted.*' --exclude '*.jsonl.reset.*'
  --exclude "$OC/cache" --exclude "$OC/logs" --exclude "$OC/media"
  --exclude "$OC/completions" --exclude "$OC/locks"
  --exclude 'node_modules' --exclude '.venv'
  --exclude "$OC/openclaw.json.bak*" --exclude "$OC/openclaw.json.last-good"
  --exclude "$OC/openclaw.json.pre-update" --exclude "$OC/openclaw.json.antes-*"
  # ⚠️ Com o caminho na frente: `--exclude '*.sqlite'` solto também tirava as
  # cópias seguras do $ESTAGIO, e o backup saía sem nenhum banco dos agentes —
  # pego pelo --testar estrito em 24/11/2026.
  --exclude "$OC/**/*.sqlite" --exclude "$OC/**/*.sqlite-wal" --exclude "$OC/**/*.sqlite-shm"
  --exclude "$OC/**/*.sqlite-import.*.bak"
  --exclude "/root/.config/backup-openclaw"
)

# Fora do /root/.openclaw, o que é preciso para remontar a máquina.
EXTRAS=(
  /root/.config/systemd/user
  /etc/caddy
  /etc/systemd/system/banco-mcp.service
  /etc/sysctl.d/90-pk47-swap.conf
)

copiar_sqlite() {
  # A API de backup do SQLite copia um banco em uso de forma consistente (com
  # o WAL aplicado). Copiar o arquivo cru durante uma escrita dá cópia que pode
  # não abrir.
  rm -rf "$ESTAGIO"; mkdir -p "$ESTAGIO"; chmod 700 "$ESTAGIO"
  python3 - "$OC" "$ESTAGIO" <<'PY'
import os, sqlite3, sys
oc, est = sys.argv[1], sys.argv[2]
n = 0
for raiz, dirs, arqs in os.walk(oc):
    dirs[:] = [d for d in dirs if d != "node_modules"]
    for a in arqs:
        if a.endswith(".sqlite"):
            src = os.path.join(raiz, a)
            dst = os.path.join(est, os.path.relpath(src, oc))
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            with sqlite3.connect(f"file:{src}?mode=ro", uri=True) as s, sqlite3.connect(dst) as d:
                s.backup(d)
            n += 1
print(f"sqlite copiados: {n}")
PY
}

case "${1:-}" in
  --iniciar)
    restic init
    ;;
  --testar)
    # Teste de restauração, no padrão do backup do banco: não vale backup que
    # nunca foi restaurado.
    alvo=$(mktemp -d /root/.restauracao-teste-XXXX); trap 'rm -rf "$alvo"' EXIT
    restic restore latest --target "$alvo" --include "$OC/openclaw.json" \
      --include "$OC/workspace-midas" --include "$ESTAGIO" >/dev/null
    # ⚠️ Cada conferência FALHA o script. A primeira versão fazia `cmd && echo
    # ✅`, e uma conferência que falhasse só deixava de imprimir — teste de
    # restauração que passa em silêncio é pior que não ter teste.
    falhou=0
    confere() { if eval "$2" >/dev/null 2>&1; then echo "✅ $1"; else echo "❌ $1"; falhou=1; fi; }
    confere "openclaw.json restaurado e válido" \
      "python3 -c 'import json,sys; json.load(open(sys.argv[1]))' '$alvo$OC/openclaw.json'"
    confere "workspace do midas restaurado" "[ -s '$alvo$OC/workspace-midas/AGENTS.md' ]"
    n=$(find "$alvo$ESTAGIO" -name '*.sqlite' | wc -l)
    confere "há sqlite no backup ($n)" "[ $n -gt 0 ]"
    for db in $(find "$alvo$ESTAGIO" -name '*.sqlite'); do
      confere "íntegro: ${db#"$alvo$ESTAGIO"/}" \
        "python3 -c \"import sqlite3,sys; assert sqlite3.connect(sys.argv[1]).execute('PRAGMA integrity_check').fetchone()[0]=='ok'\" '$db'"
    done
    restic snapshots --latest 3 --compact
    exit "$falhou"
    ;;
  "")
    copiar_sqlite
    restic backup --tag diario --one-file-system "${EXCLUIR[@]}" "$OC" "$ESTAGIO" "${EXTRAS[@]}"
    rm -rf "$ESTAGIO"
    ;;
  *) echo "uso: $0 [--iniciar|--testar]"; exit 2 ;;
esac
