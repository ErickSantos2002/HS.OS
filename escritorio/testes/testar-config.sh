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

if [ -d midia ]; then
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
  exige midia/turnserver.conf '^use-auth-secret$' "coturn por static secret"
  proibe midia/turnserver.conf '^static-auth-secret=' "segredo do coturn fora do arquivo"
  exige midia/docker-compose.yml 'livekit/livekit-server:v1\.13\.8' "LiveKit fixo"
  exige midia/docker-compose.yml 'coturn/coturn:4\.17\.2-r0' "Coturn fixo"
  exige midia/livekit.yaml 'port_range_start: 50000' "faixa UDP começa em 50000"
  exige midia/livekit.yaml 'port_range_end: 50100' "faixa UDP termina em 50100"
fi

echo; [ "$falhas" -eq 0 ] && echo "tudo certo" || { echo "$falhas falha(s)"; exit 1; }
