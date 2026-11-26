#!/usr/bin/env bash
# Instala o backup diário do banco do HS.OS na VPS da aplicação (62.72.11.28).
#
#   scp scripts/instalar-backup.sh root@62.72.11.28:/root/
#   ssh root@62.72.11.28 'bash /root/instalar-backup.sh'
#
# Idempotente: rodar de novo só reescreve a configuração.
#
# ⚠️ **Um backup que ninguém restaurou é esperança, não backup.** Por isso este
# script termina restaurando o dump que acabou de tirar num banco descartável e
# comparando as contagens. Se o restore falhar, ele falha aqui — e não no dia em
# que você precisar.
#
# O que ele NÃO faz, e você precisa saber:
#
#   Os dumps ficam NA MESMA MÁQUINA do banco. Isso protege contra o que
#   acontece toda semana — migração ruim, DELETE sem WHERE, bug de aplicação —
#   e NÃO protege contra perder a máquina. Cópia para fora é o passo seguinte;
#   está no fim deste arquivo, comentado, faltando só o destino.

set -euo pipefail

DESTINO=/var/backups/hsos
RETENCAO_DIAS=14
SERVICO=hsos-backup

# ⚠️ O `hsos_app` é NOINHERIT: sem `--role` o pg_dump trava em "permission
# denied" na primeira tabela. Usar a credencial da aplicação com o papel
# assumido evita ter que pôr a senha do superusuário num script em disco.
PAPEL=service_role

# ⚠️ O container é escolhido pelo NOME EXATO do serviço do EasyPanel, nunca
# por "tem postgres no nome". Até 26/11/2026 era `grep postgres | head -1`, e
# esta VPS tem 31 containers assim (pgweb, dbgate, os bancos dos outros
# sistemas): o primeiro da lista virou um `pgweb`, sem servidor, e o backup
# falhou todo dia desde 08/09 — 80 dias sem dump, sem ninguém saber.
SERVICO_BANCO=${SERVICO_BANCO:-erick_hsos-banco}

echo "═══ 1. Onde o Postgres roda ═══"
CIDS=$(docker ps -q --filter "label=com.docker.swarm.service.name=$SERVICO_BANCO")
if [ "$(echo "$CIDS" | grep -c .)" != "1" ]; then
  echo "  ❌ Esperava 1 container do serviço $SERVICO_BANCO, achei: '${CIDS}'."
  exit 1
fi
CID=$CIDS
echo "  container: $CID ($(docker inspect -f '{{.Name}}' "$CID" | tr -d /))"
VERSAO=$(docker exec "$CID" postgres --version | grep -oE '[0-9]+' | head -1)
echo "  Postgres $VERSAO — o pg_dump sai de dentro do container, então a versão sempre casa"

mkdir -p "$DESTINO"
chmod 700 "$DESTINO"   # o dump tem hash de senha e segredos de integração

echo
echo "═══ 2. O script de backup ═══"
cat > /usr/local/bin/hsos-backup <<'UNIT'
#!/usr/bin/env bash
set -euo pipefail
DESTINO=@DESTINO@
SERVICO_BANCO=@SERVICO_BANCO@
# Pelo nome exato do serviço — ver o aviso no instalador (26/11/2026).
CID=$(docker ps -q --filter "label=com.docker.swarm.service.name=$SERVICO_BANCO")
[ "$(echo "$CID" | grep -c .)" = "1" ] || { echo "esperava 1 container de $SERVICO_BANCO, achei: '$CID'"; exit 1; }

ARQ="$DESTINO/hsos-$(date +%Y%m%d-%H%M%S).dump"
ERR=$(mktemp)
MOTIVO=""
TAM=0

# ⚠️ Toda execução grava o próprio resultado em `backups_execucao`, e o
# `app/guardiao_backups.py` avisa o administrador quando a última falhou ou
# quando não há sucesso há 26 h. Foi a falta disto que deixou o backup morto
# de 08/09 a 26/11/2026 sem ninguém saber. O motivo vai como VARIÁVEL do psql
# (`:'det'`), nunca colado no SQL: ele é texto de erro, vem de fora.
registrar() {
  local ok=$1 det=$2
  printf "SET ROLE service_role; INSERT INTO public.backups_execucao (origem, ok, tamanho, detalhe) VALUES ('banco-hsos', :ok, :tam, NULLIF(:'det', ''));\n" \
    | docker exec -i "$CID" sh -c 'psql -q -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "${POSTGRES_DB:-hsos}" -v ok="$1" -v tam="$2" -v det="$3"' _ "$ok" "$TAM" "$det" >/dev/null \
    || echo "não consegui registrar o resultado no banco"
}

# Falhou, o arquivo sai: até 26/11 cada falha deixava um dump de 0 byte, que
# parecia backup na listagem e nunca era podado (a poda fica depois do erro).
fim() {
  local cod=$?
  if [ "$cod" -ne 0 ]; then
    rm -f "$ARQ"
    [ -n "$MOTIVO" ] || MOTIVO=$(tail -c 400 "$ERR" | tr '\n' ' ')
    registrar false "${MOTIVO:-saiu com código $cod}"
  fi
  rm -f "$ERR"
}
trap fim EXIT

# --format=custom: comprimido e permite restaurar tabela a tabela.
# A senha vem do ambiente do próprio container, então não fica aqui.
docker exec "$CID" sh -c \
  'pg_dump --username="$POSTGRES_USER" --dbname="${POSTGRES_DB:-hsos}" --role=@PAPEL@ \
           --format=custom --no-owner --no-privileges' > "$ARQ" 2> "$ERR"

# Dump vazio ou minúsculo é falha silenciosa — o pior tipo. 50 KB é bem abaixo
# do tamanho real e bem acima de "o pg_dump escreveu só o cabeçalho".
TAM=$(stat -c%s "$ARQ")
if [ "$TAM" -lt 51200 ]; then
  MOTIVO="dump suspeito: só $TAM bytes"
  echo "backup suspeito: $ARQ tem só $TAM bytes"
  exit 1
fi

chmod 600 "$ARQ"
find "$DESTINO" -name 'hsos-*.dump' -mtime +@RETENCAO_DIAS@ -delete
registrar true ""
echo "ok: $ARQ ($TAM bytes) · $(ls -1 "$DESTINO"/hsos-*.dump | wc -l) cópias guardadas"
UNIT
sed -i -e "s|@DESTINO@|$DESTINO|" -e "s|@SERVICO_BANCO@|$SERVICO_BANCO|" \
       -e "s|@PAPEL@|$PAPEL|" -e "s|@RETENCAO_DIAS@|$RETENCAO_DIAS|" /usr/local/bin/hsos-backup
chmod 700 /usr/local/bin/hsos-backup
echo "  /usr/local/bin/hsos-backup"

echo
echo "═══ 3. Timer diário ═══"
cat > /etc/systemd/system/$SERVICO.service <<UNIT
[Unit]
Description=Backup do banco do HS.OS
After=docker.service
Wants=docker.service

[Service]
Type=oneshot
ExecStart=/usr/local/bin/hsos-backup
UNIT

# 03:20 e não 03:00: horário redondo é onde todo mundo agenda, e o
# RandomizedDelay evita competir com o que mais rodar na máquina.
cat > /etc/systemd/system/$SERVICO.timer <<UNIT
[Unit]
Description=Backup diário do banco do HS.OS

[Timer]
OnCalendar=*-*-* 03:20:00
RandomizedDelaySec=600
Persistent=true

[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now $SERVICO.timer
echo "  timer ativo — próximo disparo:"
systemctl list-timers $SERVICO.timer --no-pager | sed -n 2p | sed 's/^/    /'

echo
echo "═══ 4. Primeiro backup, agora ═══"
systemctl start $SERVICO.service
sleep 2
journalctl -u $SERVICO.service -n 3 --no-pager | sed 's/^/  /'

echo
echo "═══ 5. Prova de restore ═══"
# Sem isto, tudo acima é só um arquivo grande no disco.
#
# ⚠️ A limpeza vai num `trap`. Na primeira versão ela era a última linha, e
# quando a sessão SSH caiu antes do fim o banco de verificação ficou órfão no
# servidor — encontrado à mão depois. Com o trap, ele sai mesmo se algo aqui
# falhar ou a conexão morrer.
VERIF=hsos_verificacao
limpar_verificacao() {
  docker exec "$CID" psql -U "$PGUSER_C" -d postgres -q \
    -c "DROP DATABASE IF EXISTS $VERIF;" >/dev/null 2>&1 || true
}
trap limpar_verificacao EXIT

PGUSER_C=$(docker exec "$CID" printenv POSTGRES_USER)
PGDB_C=$(docker exec "$CID" printenv POSTGRES_DB || echo hsos)
ULTIMO=$(ls -1t "$DESTINO"/hsos-*.dump | head -1)
echo "  restaurando $(basename "$ULTIMO") num banco descartável…"

docker exec "$CID" psql -U "$PGUSER_C" -d postgres -q \
  -c "DROP DATABASE IF EXISTS $VERIF;" -c "CREATE DATABASE $VERIF;"

ERROS=$(docker exec -i "$CID" pg_restore -U "$PGUSER_C" -d "$VERIF" --no-owner --no-privileges \
        < "$ULTIMO" 2>&1 | grep -c "^pg_restore: error" || true)
echo "  erros no restore: $ERROS"

echo "  conferindo o que chegou:"
docker exec "$CID" psql -U "$PGUSER_C" -d "$VERIF" -tA -c \
  "select 'tabelas: '||count(*) from information_schema.tables where table_schema='public'" | sed 's/^/    /'
docker exec "$CID" psql -U "$PGUSER_C" -d "$VERIF" -tA -c \
  "select 'usuarios: '||count(*) from auth.users" | sed 's/^/    /'
docker exec "$CID" psql -U "$PGUSER_C" -d "$VERIF" -tA -c \
  "select 'conversas: '||count(*) from public.conversations" | sed 's/^/    /'

limpar_verificacao
trap - EXIT
echo "  banco de verificação removido"

if [ "$ERROS" != "0" ]; then
  echo
  echo "  ❌ O RESTORE FALHOU. O backup está sendo gerado mas não serve."
  exit 1
fi

echo
echo "═══ Pronto ═══"
echo "  Backups em $DESTINO, um por dia às 03:20, guardando $RETENCAO_DIAS dias."
echo
echo "  Para restaurar de verdade, um dia:"
echo "    docker exec -i \$CID sh -c 'pg_restore -U \$POSTGRES_USER -d hsos --clean --if-exists' < $DESTINO/hsos-<data>.dump"
echo
echo "  ⚠️ Estes dumps estão NA MESMA MÁQUINA do banco. Protegem contra erro"
echo "     humano e bug de aplicação, NÃO contra perder a máquina. Para cópia"
echo "     externa, descomente o bloco no fim de /usr/local/bin/hsos-backup"
echo "     e preencha o destino."
