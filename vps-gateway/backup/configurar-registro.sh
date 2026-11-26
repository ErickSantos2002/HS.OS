#!/usr/bin/env bash
# Liga o REGISTRO do backup do gateway no HS.OS (26/11/2026). Roda NO KONSOLE
# do Erick, uma vez, DEPOIS do deploy que traz `POST /backups/registro`:
#
#   bash ~/github/HS.OS/vps-gateway/backup/configurar-registro.sh
#
# Faz três coisas, nesta ordem:
#   1. gera um token novo e grava em `integration_secrets` (BACKUP_REGISTRO_TOKEN),
#      pelo perfil admin do cadastro de bancos;
#   2. grava o cabeçalho com o token em /root/.config/backup-openclaw/registro
#      (0600) na VPS e instala a versão nova do backup-openclaw.sh;
#   3. confere: um registro de teste tem que voltar 201.
#
# O token não passa por argv nem histórico: vai pelo stdin do python e do ssh.
# Rodar de novo troca o token nas duas pontas (é assim que se revoga).
set -euo pipefail
VPS="${VPS:-root@2.24.85.122}"
AQUI="$(cd "$(dirname "$0")" && pwd)"
API="${API_HSOS:-https://hsosapi.healthsafetytech.com}"

codigo=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/backups/registro" -H 'Content-Type: application/json' -d '{}')
[ "$codigo" = 401 ] || [ "$codigo" = 403 ] || [ "$codigo" = 503 ] || {
  echo "A API respondeu $codigo em /backups/registro — o deploy com a rota já foi feito?"; exit 1; }

TOKEN=$(openssl rand -hex 32)

echo "→ 1. token em integration_secrets"
printf '%s' "$TOKEN" | ~/projetos/bancos/.venv/bin/python -c '
import sys
sys.path.insert(0, "/home/ericks/projetos/bancos")
import bancos
token = sys.stdin.read()
with bancos.conectar("hsos", perfil="admin") as conn:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.integration_secrets WHERE name = %s", ("BACKUP_REGISTRO_TOKEN",))
        cur.execute("INSERT INTO public.integration_secrets (name, value) VALUES (%s, %s)",
                    ("BACKUP_REGISTRO_TOKEN", token))
    conn.commit()
print("   gravado")'

echo "→ 2. cabeçalho e script na VPS"
printf 'Authorization: Bearer %s\n' "$TOKEN" |
  ssh -o ConnectTimeout=10 "$VPS" 'umask 077; mkdir -p /root/.config/backup-openclaw && cat > /root/.config/backup-openclaw/registro'
scp -q "$AQUI/backup-openclaw.sh" "$VPS:/opt/backup-openclaw/backup-openclaw.sh.novo"
ssh "$VPS" 'install -m 700 /opt/backup-openclaw/backup-openclaw.sh.novo /opt/backup-openclaw/backup-openclaw.sh && rm /opt/backup-openclaw/backup-openclaw.sh.novo'

echo "→ 3. conferência"
# O segredo é cacheado por 60 s no backend (`ler_segredo`); com token trocado,
# a primeira tentativa pode cair no valor velho.
for i in 1 2 3 4; do
  codigo=$(ssh "$VPS" "curl -s -o /dev/null -w '%{http_code}' -X POST -H @/root/.config/backup-openclaw/registro \
    -H 'Content-Type: application/json' --data-binary '{\"origem\":\"gateway\",\"ok\":true,\"detalhe\":\"teste do configurar-registro.sh\"}' \
    $API/backups/registro")
  [ "$codigo" = 201 ] && break
  echo "   respondeu $codigo; tento de novo em 30 s"; sleep 30
done
[ "$codigo" = 201 ] || { echo "❌ o registro não passou ($codigo)."; exit 1; }
# A linha de teste sai: ela é um "ok" sem backup nenhum, e esconderia por 26 h
# um backup que falhasse em seguida.
~/projetos/bancos/.venv/bin/python -c '
import sys
sys.path.insert(0, "/home/ericks/projetos/bancos")
import bancos
with bancos.conectar("hsos", perfil="admin") as conn:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM public.backups_execucao WHERE origem = %s AND detalhe = %s",
                    ("gateway", "teste do configurar-registro.sh"))
        print(f"   linha de teste apagada ({cur.rowcount})")
    conn.commit()'
echo "✅ registro ligado — o próximo backup das 03:30 já avisa o HS.OS"
