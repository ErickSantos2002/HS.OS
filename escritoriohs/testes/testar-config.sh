#!/usr/bin/env bash
# Checagens estáticas do escritório — rodam na máquina de quem mexe, sem VPS.
# Cada uma tranca um defeito que só apareceria em produção, com gente na tela.
set -u
cd "$(dirname "$0")/.."
falhas=0
exige() { if grep -qE -- "$2" "$1" 2>/dev/null; then echo "ok   $3"; else echo "FALHA $3"; falhas=$((falhas+1)); fi; }
# Arquivo ausente é falha, não "ok": sem isto toda proibição passava antes de o arquivo existir.
proibe() { if [ ! -f "$1" ] || grep -qE -- "$2" "$1"; then echo "FALHA $3"; falhas=$((falhas+1)); else echo "ok   $3"; fi; }

# WebSocket atrás de dois proxies: sem Upgrade/Connection o mapa abre e ninguém se vê.
exige borda/nginx.conf 'proxy_set_header Upgrade \$http_upgrade' "borda repassa Upgrade"
exige borda/nginx.conf 'proxy_set_header Connection \$connection_upgrade' "borda repassa Connection"
exige borda/nginx.conf 'location /ws/' "borda roteia /ws/ para o play:3001"
# O /openid-callback do play responde com cabeçalho grande (tokens do Entra):
# com o buffer padrão (4–8k) o nginx devolvia 502 em metade dos logins.
exige borda/nginx.conf 'proxy_buffer_size +64k;' "borda aceita cabeçalho grande do login"
exige borda/nginx.conf 'server_name livekit\.healthsafetytech\.com' "borda atende livekit.*"
# Versão fixa: atualização sozinha num serviço de vídeo quebra reunião sem aviso.
proibe docker-compose.yml ':latest' "nenhuma imagem latest no WA"
proibe .env.example '^VERSION=(latest)?$' "VERSION fixa no .env.example"
# O Traefik oficial disputaria 80/443 com o do EasyPanel.
proibe docker-compose.yml 'traefik' "sem Traefik próprio"
proibe docker-compose.yml '^\s+ports:' "nenhuma porta publicada no host pelo WA"
# Decisões da spec.
exige .env.example '^DISABLE_ANONYMOUS=true$' "sem anônimo"
exige .env.example '^OPENID_WOKA_NAME_POLICY=force_opid$' "nome vem do Entra"
exige .env.example '^MAP_EDITOR_ALLOW_ALL_USERS=false$' "editor fechado"
exige .env.example '^MAX_USERS_FOR_WEBRTC=4$' "LiveKit acima de 4"
proibe .env.example '^MATRIX_' "sem Matrix"
# Repo público: o exemplo não pode carregar segredo.
proibe .env.example '^(SECRET_KEY|OPENID_CLIENT_SECRET|LIVEKIT_API_SECRET|TURN_STATIC_AUTH_SECRET|MAP_STORAGE_AUTHENTICATION_TOKEN|ROOM_API_SECRET_KEY)=.+' "nenhum segredo preenchido no .env.example"

# TURN sem ?transport= faz o navegador alocar só por UDP: o recuo TCP 3478 nunca
# era usado, e quem está em rede sem UDP ficava sem vídeo em bolha de até 4.
exige .env.example '^TURN_SERVER=.*transport=udp.*transport=tcp' "TURN oferece UDP e TCP"
# A ligação WA → LiveKit: sem estas no `back`, sala com mais de 4 fica sem vídeo
# e o load-test do LiveKit continua verde (ele não passa pelo WA).
for v in LIVEKIT_HOST LIVEKIT_API_KEY LIVEKIT_API_SECRET MAX_USERS_FOR_WEBRTC; do
  awk '/^  back:/{f=1;next} /^  [a-z-]+:$/{f=0} f' docker-compose.yml | grep -q -- "- $v\$" \
    && echo "ok   back recebe $v" || { echo "FALHA back recebe $v"; falhas=$((falhas+1)); }
done
# Admin API do HS.OS (sub-projeto B): só no play. No `back` ela o faria pedir o
# mapa ao HS.OS em vez de calcular o wamUrl sozinho; no `uploader`, passaria a
# exigir /api/limit/fileSize, que não implementamos.
bloco() { awk -v s="  $1:" '$0==s{f=1;next} /^  [a-z-]+:$/{f=0} f' docker-compose.yml; }
for v in ADMIN_API_URL ADMIN_API_TOKEN ADMIN_SOCKETS_TOKEN; do
  bloco play | grep -q -- "- $v\$" \
    && echo "ok   play recebe $v" || { echo "FALHA play recebe $v"; falhas=$((falhas+1)); }
  for svc in back uploader map-storage; do
    bloco "$svc" | grep -q -- "$v" \
      && { echo "FALHA $v fora do play ($svc)"; falhas=$((falhas+1)); } || echo "ok   $v fora do $svc"
  done
done
# São a volta atrás: apagar ADMIN_API_URL devolve o WA a elas.
for v in MAP_EDITOR_ALLOWED_USERS START_ROOM_URL; do
  bloco play | grep -q -- "- $v\$" \
    && echo "ok   play mantém $v (volta atrás)" || { echo "FALHA play mantém $v (volta atrás)"; falhas=$((falhas+1)); }
done
# Vazia no exemplo: preenchida, o escritório passa a depender do HS.OS no boot.
exige .env.example '^ADMIN_API_URL=$' "ADMIN_API_URL vazia no .env.example"
proibe .env.example '^(ADMIN_API_TOKEN|ADMIN_SOCKETS_TOKEN)=.+' "tokens da Admin API fora do .env.example"

# VPS dos bancos: nenhum serviço do WA sem teto de memória.
for svc in borda play back uploader icon redis map-storage; do
  awk -v s="  $svc:" '$0==s{f=1;next} /^  [a-z-]+:$/{f=0} f' docker-compose.yml | grep -q 'memory:' \
    && echo "ok   $svc com teto de memória" || { echo "FALHA $svc com teto de memória"; falhas=$((falhas+1)); }
done
exige docker-compose.yml 'maxmemory' "redis com maxmemory"
# Upload de áudio do uploader não exige autenticação no WA v1.33.11.
exige borda/nginx.conf 'location /uploader/upload-audio-message \{ return 403; \}' "upload anônimo de áudio fechado"
# Nome literal no proxy_pass é resolvido uma vez no boot: play recriado com IP
# novo deixaria a borda dando 502.
exige borda/nginx.conf '^\s*resolver 127\.0\.0\.11' "borda resolve nomes a cada request (DNS do Docker)"
proibe borda/nginx.conf 'proxy_pass http://(play|back|uploader|icon|map-storage):' "borda sem upstream com nome fixo"

if [ -d midia ]; then
  # allowed-peer-ip tem precedência sobre denied-peer-ip: reabriria uma faixa.
  proibe midia/turnserver.conf '^allowed-peer-ip' "coturn sem allowed-peer-ip"
  # Coturn sem denied-peer-ip vira túnel para os bancos da VPS.
  for faixa in '0.0.0.0-0.255.255.255' '10.0.0.0-10.255.255.255' '127.0.0.0-127.255.255.255' \
               '169.254.0.0-169.254.255.255' '172.16.0.0-172.31.255.255' '192.168.0.0-192.168.255.255'; do
    exige midia/turnserver.conf "^denied-peer-ip=$faixa\$" "coturn nega relay para $faixa"
  done
  # O IP público do próprio host também é "dentro": o relay chegaria em tudo que
  # escuta em 0.0.0.0 na VPS. E as faixas de CGNAT, benchmark e IPv6 local.
  for faixa in '62\.72\.11\.28' '100\.64\.0\.0-100\.127\.255\.255' '198\.18\.0\.0-198\.19\.255\.255' \
               '::1' '::ffff:0\.0\.0\.0-::ffff:255\.255\.255\.255' 'fc00::-fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff' \
               'fe80::-febf:ffff:ffff:ffff:ffff:ffff:ffff:ffff'; do
    exige midia/turnserver.conf "^denied-peer-ip=$faixa\$" "coturn nega relay para $faixa"
  done
  # WebRTC só precisa de relay UDP; relay TCP abre mais superfície para nada.
  exige midia/turnserver.conf '^no-tcp-relay$' "coturn sem relay TCP"
  # Segredo na linha de comando aparece no `ps` de qualquer usuário do host.
  proibe midia/docker-compose.yml '--static-auth-secret' "segredo do coturn fora da linha de comando"
  # Sem estas, o coturn escuta e escolhe relay em toda interface, inclusive as
  # bridges do Docker ("NO EXPLICIT RELAY ADDRESS" no log de 15/10/2026).
  exige midia/turnserver.conf '^listening-ip=62\.72\.11\.28$' "coturn escuta só no IP público"
  exige midia/turnserver.conf '^relay-ip=62\.72\.11\.28$' "coturn faz relay só pelo IP público"
  # A API do LiveKit só precisa atender a borda (pela bridge) e o loopback.
  proibe midia/livekit.yaml '0\.0\.0\.0' "LiveKit não escuta em todas as interfaces"
  exige midia/livekit.yaml '172\.18\.0\.1' "LiveKit escuta na bridge, para a borda"
  # "chave: segredo" tem espaço: sem aspas, quem faz `. midia.env` executa o
  # segredo como comando e o imprime no erro (aconteceu em 15/10/2026).
  exige midia/instalar.sh 'echo "LIVEKIT_KEYS=\\"\$chave: \$segredo\\""' "LIVEKIT_KEYS entre aspas no midia.env"
  # O navegador reserva relay para CADA conexão da bolha (e em UDP e TCP), mesmo
  # sem precisar dele: 41 portas esgotaram com 3 testes (508, 15/10/2026).
  minp=$(grep -oP '^min-port=\K[0-9]+' midia/turnserver.conf); maxp=$(grep -oP '^max-port=\K[0-9]+' midia/turnserver.conf)
  [ -n "$minp" ] && [ -n "$maxp" ] && [ $((maxp - minp + 1)) -ge 500 ] \
    && echo "ok   faixa de relay do coturn com 500+ portas" || { echo "FALHA faixa de relay do coturn com 500+ portas"; falhas=$((falhas+1)); }
  exige midia/turnserver.conf '^use-auth-secret$' "coturn por static secret"
  proibe midia/turnserver.conf '^static-auth-secret=' "segredo do coturn fora do arquivo"
  exige midia/docker-compose.yml 'livekit/livekit-server:v1\.13\.8' "LiveKit fixo"
  exige midia/docker-compose.yml 'coturn/coturn:4\.17\.2-r0' "Coturn fixo"
  exige midia/livekit.yaml 'port_range_start: 50000' "faixa UDP começa em 50000"
  exige midia/livekit.yaml 'port_range_end: 50100' "faixa UDP termina em 50100"
fi

if [ -d backup ]; then
  # O backup lê o volume dos mapas; montado sem :ro, um defeito no tar mexeria nele.
  exige backup/backup-mapas.sh '"\$VOLUME":/maps:ro' "backup lê o volume só para leitura"
  proibe backup/backup-mapas.sh ':latest' "backup sem imagem latest"
  exige backup/backup-mapas.sh 'head -n -30' "backup mantém os 30 mais recentes"
  exige backup/escritoriohs-backup.timer '^Persistent=true$' "backup perdido (VPS desligada) roda ao voltar"
  # Credencial no argv do `docker run` aparece no `ps` de qualquer usuário.
  proibe backup/backup-mapas.sh '-e AWS_(SECRET_ACCESS_KEY|ACCESS_KEY_ID)=' "segredo do R2 fora da linha de comando"
  # /tmp é compartilhado: o tar vai para um diretório privado (mktemp -d).
  exige backup/backup-mapas.sh 'mktemp -d' "backup usa diretório temporário privado"
  proibe backup/backup-mapas.sh '-v /tmp:' "backup não monta o /tmp inteiro"
fi

echo; [ "$falhas" -eq 0 ] && echo "tudo certo" || { echo "$falhas falha(s)"; exit 1; }
