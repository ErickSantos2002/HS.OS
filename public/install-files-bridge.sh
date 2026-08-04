#!/usr/bin/env bash
# Instalador avulso da ponte de arquivos (dnos-files-bridge) — para VPS que JÁ
# está instalada (produção). Remix novo ganha a ponte pelo setup.sh.
#
# Uso: curl -sL https://SUA-DNOS/install-files-bridge.sh | bash -s -- https://SEU-REF.supabase.co
#
# O que faz: instala /usr/local/bin/dnos-files-bridge + systemd timer (60s).
#   push: workspaces (/root/.openclaw/workspace-*/*.md) -> tabela agent_files
#   pull: arquivos pending_write (importação) -> disco, com confirmação
# Autentica com o GUARDRAILS_API_TOKEN já presente em /root/.openclaw/.env.
set -euo pipefail

SUPABASE_URL="${1:-}"
SUPABASE_URL="${SUPABASE_URL%/}"
ENV_FILE="/root/.openclaw/.env"

if [[ -z "$SUPABASE_URL" ]]; then
    echo "[ERRO] Passe a URL do Supabase: ... | bash -s -- https://SEU-REF.supabase.co"
    exit 1
fi
if ! grep -q '^GUARDRAILS_API_TOKEN=' "$ENV_FILE" 2>/dev/null; then
    echo "[ERRO] GUARDRAILS_API_TOKEN não encontrado em $ENV_FILE."
    echo "       Adicione a linha (o valor está nos secrets do projeto no Lovable):"
    echo "       GUARDRAILS_API_TOKEN=<valor>"
    exit 1
fi

# Grava/atualiza a URL do Supabase no .env
if grep -q '^DNOS_SUPABASE_URL=' "$ENV_FILE"; then
    sed -i "s|^DNOS_SUPABASE_URL=.*|DNOS_SUPABASE_URL=${SUPABASE_URL}|" "$ENV_FILE"
else
    echo "DNOS_SUPABASE_URL=${SUPABASE_URL}" >> "$ENV_FILE"
fi

cat > /usr/local/bin/dnos-files-bridge << 'BRIDGEEOF'
#!/usr/bin/env bash
# dnos-files-bridge — espelho determinístico workspace ↔ dn.os. Sem LLM.
set -u
ENV_FILE="/root/.openclaw/.env"
STATE="/root/.openclaw/.files-bridge-state"
BASE="/root/.openclaw"
TOKEN="$(grep '^GUARDRAILS_API_TOKEN=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
SUPABASE_URL="$(grep '^DNOS_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2-)"
[[ -z "$TOKEN" || -z "$SUPABASE_URL" ]] && exit 0
SYNC="$SUPABASE_URL/functions/v1/sync-agent-files"
mkdir -p "$STATE"

# 1) push: workspaces -> tabela (só arquivos .md alterados desde o último push)
for ws in "$BASE"/workspace-*; do
    [[ -d "$ws" ]] || continue
    agent="${ws##*/workspace-}"
    for f in "$ws"/*.md; do
        [[ -f "$f" ]] || continue
        name="${f##*/}"
        stamp="$STATE/${agent}__${name}.pushed"
        [[ -f "$stamp" && ! "$f" -nt "$stamp" ]] && continue
        python3 - "$agent" "$name" "$f" "$SYNC" "$TOKEN" <<'PYEOF'
import json, sys, urllib.request
agent, name, path, sync, token = sys.argv[1:6]
content = open(path, encoding="utf-8", errors="replace").read()[:490000]
body = json.dumps({"agent_id": agent, "files": [{"file_name": name, "content": content}], "origin": "vps"}).encode()
req = urllib.request.Request(sync, data=body, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
urllib.request.urlopen(req, timeout=20).read()
PYEOF
        [[ $? -eq 0 ]] && touch -r "$f" "$stamp"
    done
done

# 2) pull: pendências de escrita (importação) -> disco, com confirmação 1 a 1
python3 - "$SYNC" "$TOKEN" "$BASE" <<'PYEOF'
import json, os, re, sys, urllib.request
sync, token, base = sys.argv[1:4]
def call(payload):
    req = urllib.request.Request(sync, data=json.dumps(payload).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return json.loads(urllib.request.urlopen(req, timeout=20).read())
pending = call({"action": "pull_pending"}).get("files", [])
acked = []
for f in pending:
    agent, name = f.get("agent_id", ""), f.get("file_name", "")
    if not re.fullmatch(r"[a-z0-9-]{2,32}", agent): continue
    if not re.fullmatch(r"[A-Za-z0-9._-]{1,100}", name) or ".." in name: continue
    ws = os.path.join(base, f"workspace-{agent}")
    os.makedirs(ws, exist_ok=True)
    with open(os.path.join(ws, name), "w", encoding="utf-8") as out:
        out.write(f.get("content") or "")
    acked.append({"agent_id": agent, "file_name": name})
if acked:
    call({"action": "ack_written", "files": acked})
PYEOF
BRIDGEEOF
chmod +x /usr/local/bin/dnos-files-bridge

cat > /etc/systemd/system/dnos-files-bridge.service << 'SVCEOF'
[Unit]
Description=dnOS files bridge (workspace <-> dn.os)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/dnos-files-bridge
SVCEOF

cat > /etc/systemd/system/dnos-files-bridge.timer << 'TMREOF'
[Unit]
Description=Run dnos-files-bridge every minute
[Timer]
OnBootSec=90s
OnUnitActiveSec=60s
[Install]
WantedBy=timers.target
TMREOF

systemctl daemon-reload
systemctl enable --now dnos-files-bridge.timer

echo "[OK] Ponte instalada. Primeira sincronização:"
/usr/local/bin/dnos-files-bridge && echo "[OK] Push inicial concluído — confira a tabela agent_files."
