#!/usr/bin/env bash
# Liga o crachá do turno (PK-11). Roda NO KONSOLE do Erick, DEPOIS do deploy do
# backend que sabe ler o crachá (`app/cracha.py`):
#
#   bash ~/github/HS.OS/vps-gateway/plugin-cracha/configurar.sh
#
# Ordem, e por quê:
#   1. segredo em integration_secrets ANTES de o plugin carimbar — crachá
#      presente sem segredo no backend é recusado, e o Guardi pararia;
#   2. segredo em arquivo 0600 na VPS (fora do openclaw.json) e o plugin em
#      /opt/hsos-cracha, instalado com `openclaw plugins install --link`;
#   3. reinício do gateway SÓ sem resposta em andamento (reinício mata o que
#      estiver em voo), esperando o /health voltar;
#   4. confere: o plugin aparece carregado no `plugins inspect`.
# Rodar de novo troca o segredo nas duas pontas.
set -euo pipefail
VPS="${VPS:-root@2.24.85.122}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
PY=~/projetos/bancos/.venv/bin/python

curl -sf https://hsosapi.healthsafetytech.com/health | grep -q '"status":"ok"' || { echo "API fora?"; exit 1; }
grep -q "CRACHA_TURNO_SEGREDO" "$AQUI/../../backend/app/cracha.py"

SEGREDO=$(openssl rand -hex 32)
echo "→ 1. segredo em integration_secrets"
printf '%s' "$SEGREDO" | $PY -c '
import sys; sys.path.insert(0, "/home/ericks/projetos/bancos"); import bancos
v = sys.stdin.read()
with bancos.conectar("hsos", perfil="admin") as conn:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.integration_secrets WHERE name = %s", ("CRACHA_TURNO_SEGREDO",))
        cur.execute("INSERT INTO public.integration_secrets (name, value) VALUES (%s, %s)", ("CRACHA_TURNO_SEGREDO", v))
    conn.commit()
print("   gravado")'

echo "→ 2. segredo e plugin na VPS"
printf '%s\n' "$SEGREDO" | ssh -o ConnectTimeout=10 "$VPS" 'umask 077; mkdir -p /root/.config/hsos-cracha && cat > /root/.config/hsos-cracha/segredo'
ssh "$VPS" 'mkdir -p /opt/hsos-cracha'
scp -q "$AQUI/index.js" "$AQUI/openclaw.plugin.json" "$AQUI/package.json" "$VPS:/opt/hsos-cracha/"
echo "→ 3. espera não haver resposta em andamento"
# ⚠️ ANTES do install: o `plugins install` pode reiniciar o gateway sozinho
# (docs/plugins/manage-plugins.md), e reinício mata o que estiver em voo.
for i in $(seq 1 20); do
  n=$($PY -c '
import sys; sys.path.insert(0, "/home/ericks/projetos/bancos"); import bancos
print(bancos.uma_linha("hsos", "select count(*) from agent_runs where message_id is null and coleta_encerrada_em is null and criado_em > now() - interval '"'"'15 minutes'"'"'")[0])')
  [ "$n" = 0 ] && break
  echo "   $n resposta(s) em andamento; espero 30 s"; sleep 30
done
[ "$n" = 0 ] || { echo "❌ sempre havia resposta em andamento — rode de novo mais tarde"; exit 1; }

saude() { for i in $(seq 1 60); do ssh "$VPS" 'curl -sf -m 3 http://127.0.0.1:18789/health >/dev/null' && return 0; sleep 10; done; return 1; }

echo "→ 3b. instala e reinicia o gateway"
ssh "$VPS" 'cd /root && (openclaw plugins inspect hsos-cracha --json >/dev/null 2>&1 || openclaw plugins install --link /opt/hsos-cracha)'
saude
# Sempre reinicia: o `inspect --runtime` carrega o plugin no processo da CLI e
# diria "carregado" com o gateway ainda sem ele. Sem resposta em voo, um
# reinício a mais não custa nada.
ssh "$VPS" 'XDG_RUNTIME_DIR=/run/user/0 systemctl --user restart openclaw-gateway'
saude || { echo "❌ o gateway não voltou em 10 min — olhe journalctl --user -u openclaw-gateway na VPS"; exit 1; }

echo "→ 4. conferência"
ssh "$VPS" 'cd /root && openclaw plugins inspect hsos-cracha --runtime --json' | python3 -c '
import json, sys
d = json.load(sys.stdin); s = json.dumps(d)
print("   carregado:", d.get("status") or d.get("state") or "?", "| before_tool_call" if "before_tool_call" in s else "| ⚠️ gancho não listado")'
echo "✅ crachá ligado. Confira numa conversa com o Guardi: o log da API diz 'crachá ok, pessoa=…'."
