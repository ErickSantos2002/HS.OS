#!/usr/bin/env bash
# Instala o coletor de uso (dnos-usage-push) na VPS.
#
# Uso: curl -sL https://SUA-DNOS/install-usage-push.sh | bash
#
# O que faz: lê os arquivos de trajetória do OpenClaw
# (/root/.openclaw/agents/<agente>/sessions/*.trajectory.jsonl), extrai APENAS
# os eventos de medição (`model.completed`) e envia para a dn.os.
#
# NENHUM conteúdo de conversa sai do servidor — só modelo, data, sessão e
# contagem de tokens. Na primeira execução importa todo o histórico existente;
# depois só o que é novo (guarda a posição lida de cada arquivo).
set -euo pipefail

ENV_FILE="/root/.openclaw/.env"

if ! grep -q '^GUARDRAILS_API_TOKEN=' "$ENV_FILE" 2>/dev/null; then
    echo "[ERRO] GUARDRAILS_API_TOKEN não encontrado em $ENV_FILE."
    exit 1
fi
if ! grep -q '^DNOS_SUPABASE_URL=' "$ENV_FILE" 2>/dev/null; then
    echo "[ERRO] DNOS_SUPABASE_URL não encontrado em $ENV_FILE."
    echo "       Instale antes a ponte de arquivos (install-files-bridge.sh)."
    exit 1
fi

cat > /usr/local/bin/dnos-usage-push << 'PUSHEOF'
#!/usr/bin/env bash
# dnos-usage-push — envia medição de uso dos trajectory para a dn.os.
set -u
ENV_FILE="/root/.openclaw/.env"
TOKEN="$(grep '^GUARDRAILS_API_TOKEN=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
SUPABASE_URL="$(grep '^DNOS_SUPABASE_URL=' "$ENV_FILE" | head -1 | cut -d= -f2-)"
[[ -z "$TOKEN" || -z "$SUPABASE_URL" ]] && exit 0

python3 - "$SUPABASE_URL/functions/v1/usage-import" "$TOKEN" <<'PYEOF'
import json, os, glob, sys, urllib.request

endpoint, token = sys.argv[1], sys.argv[2]
BASE = "/root/.openclaw/agents"
STATE = "/root/.openclaw/.usage-push-state.json"
LOTE = 500

try:
    with open(STATE, encoding="utf-8") as fh:
        estado = json.load(fh)
except Exception:
    estado = {}

def enviar(eventos):
    """Envia um lote. Erro da função vira mensagem legível, não traceback —
    o motivo mais comum é a migration ainda não aplicada (a coluna
    external_id / o tipo 'trajectory' não existem no banco)."""
    if not eventos:
        return 0
    req = urllib.request.Request(
        endpoint,
        data=json.dumps({"events": eventos}).encode(),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read()).get("inseridos", 0)
    except urllib.error.HTTPError as e:
        corpo = ""
        try:
            corpo = e.read().decode(errors="replace")[:400]
        except Exception:
            pass
        print(f"[usage-push] ERRO HTTP {e.code} ao enviar {len(eventos)} eventos")
        if corpo:
            print(f"[usage-push] resposta: {corpo}")
        if e.code == 500 and ("external_id" in corpo or "column" in corpo or not corpo):
            print("[usage-push] provável causa: a migration de uso ainda não foi")
            print("             aplicada no banco. Aplique e rode de novo:")
            print("             /usr/local/bin/dnos-usage-push")
        elif e.code == 401:
            print("[usage-push] token recusado — confira GUARDRAILS_API_TOKEN no .env")
        raise SystemExit(1)
    except urllib.error.URLError as e:
        print(f"[usage-push] rede indisponível: {e.reason}")
        raise SystemExit(1)

def salvar_estado():
    """Grava o progresso em disco. Chamado a cada arquivo: se a conexão cair
    no meio de uma importação longa, retomar continua de onde parou em vez de
    recomeçar do zero."""
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(estado, fh)
    os.replace(tmp, STATE)

lote, enviados, novos, arquivos = [], 0, 0, 0
todos = sorted(glob.glob(f"{BASE}/*/sessions/*.trajectory.jsonl"))
pendentes = [c for c in todos if estado.get(c, 0) < os.path.getsize(c)]
print(f"[usage-push] {len(todos)} arquivos no total, {len(pendentes)} com novidade")

for caminho in pendentes:
    agente = caminho.split("/agents/")[1].split("/")[0]
    tamanho = os.path.getsize(caminho)
    lido = estado.get(caminho, 0)
    if lido > tamanho:       # arquivo rotacionado/reescrito
        lido = 0
    arquivos += 1
    if arquivos % 25 == 0:
        print(f"[usage-push] {arquivos}/{len(pendentes)} arquivos · {novos} eventos importados")

    with open(caminho, encoding="utf-8", errors="replace") as fh:
        fh.seek(lido)
        for linha in fh:
            try:
                d = json.loads(linha)
            except Exception:
                continue
            # Só o evento de conclusão de chamada. O trace.artifacts repete o
            # MESMO usage — contabilizar os dois dobraria a conta.
            if d.get("type") != "model.completed":
                continue
            u = (d.get("data") or {}).get("usage") or {}
            total = int(u.get("total") or 0)
            if total <= 0:
                continue
            sess = d.get("sessionKey") or ""
            lote.append({
                "external_id": f"{d.get('sessionId') or sess}:{d.get('seq')}",
                "ts": d.get("ts"),
                "agent_id": agente,
                "session_key": sess or None,
                "model": d.get("modelId"),
                "provider": d.get("provider"),
                "input": int(u.get("input") or 0),
                "output": int(u.get("output") or 0),
                "cache_read": int(u.get("cacheRead") or 0),
                "reasoning": int(u.get("reasoningTokens") or 0),
                "total": total,
            })
            enviados += 1
            if len(lote) >= LOTE:
                novos += enviar(lote)
                lote = []
        # Só marca a posição depois de mandar o que leu deste arquivo.
        if lote:
            novos += enviar(lote)
            lote = []
        estado[caminho] = tamanho
        salvar_estado()

if lote:
    novos += enviar(lote)
salvar_estado()

print(f"[usage-push] concluído: arquivos={arquivos} eventos_lidos={enviados} importados={novos}")
PYEOF
PUSHEOF
chmod +x /usr/local/bin/dnos-usage-push

cat > /etc/systemd/system/dnos-usage-push.service << 'SVCEOF'
[Unit]
Description=dnOS usage push (trajectory -> dn.os)
[Service]
Type=oneshot
ExecStart=/usr/local/bin/dnos-usage-push
SVCEOF

cat > /etc/systemd/system/dnos-usage-push.timer << 'TMREOF'
[Unit]
Description=Run dnos-usage-push every 5 minutes
[Timer]
OnBootSec=120s
OnUnitActiveSec=5min
[Install]
WantedBy=timers.target
TMREOF

systemctl daemon-reload
systemctl enable --now dnos-usage-push.timer

echo "[OK] Coletor instalado."
echo ""
echo "A importação do histórico roda em segundo plano (pode levar alguns minutos)."
echo "Acompanhe com:  tail -f /var/log/dnos-usage-push.log"
echo ""
nohup /usr/local/bin/dnos-usage-push > /var/log/dnos-usage-push.log 2>&1 &
sleep 4
tail -5 /var/log/dnos-usage-push.log 2>/dev/null || true
