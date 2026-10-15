#!/usr/bin/env bash
# Checagens contra PRODUÇÃO, de fora da VPS. Uso: verificar.sh [midia|wa|tudo]
# Os testes que importam são os que NÃO passam por acaso: duas pessoas na
# mesma rede conversam mesmo com LiveKit e Coturn quebrados.
set -u
alvo="${1:-tudo}"
falhas=0
ok() { echo "ok   $1"; }
falha() { echo "FALHA $1"; falhas=$((falhas+1)); }

if [ "$alvo" = midia ] || [ "$alvo" = tudo ]; then
  # LiveKit responde "OK" na raiz, passando pelo Traefik do EasyPanel e pela borda.
  [ "$(curl -s -m 10 https://livekit.healthsafetytech.com/)" = "OK" ] \
    && ok "LiveKit atrás do domínio" || falha "LiveKit atrás do domínio"
  # STUN: o Coturn responde a um binding request vindo de fora.
  docker run --rm --network host coturn/coturn:4.17.2-r0 turnutils_stunclient -p 3478 62.72.11.28 2>&1 \
    | grep -q "UDP reflexive addr" && ok "Coturn responde STUN" || falha "Coturn responde STUN"
fi

if [ "$alvo" = wa ] || [ "$alvo" = tudo ]; then
  base=https://escritoriohs.healthsafetytech.com
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 15 $base/)" = 200 ] && ok "play abre" || falha "play abre"
  # Sem anônimo: entrar numa sala sem login tem que mandar para a Microsoft.
  # A tela do WA é SPA: quem redireciona é o /login-screen, com o playUri da sala.
  # A redirect_uri tem que ser a registrada no app EscritorioHS do Entra.
  sala=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$base/~/office.wam")
  curl -s -m 15 -o /dev/null -w '%{redirect_url}' "$base/login-screen?playUri=$sala" \
    | grep -q "^https://login.microsoftonline.com/.*redirect_uri=https%3A%2F%2Fescritoriohs.healthsafetytech.com%2Fopenid-callback" \
    && ok "login redireciona para o Entra" || falha "login redireciona para o Entra"
  # "Roteado" = respondeu algo que não seja falta de resposta (000) nem erro de
  # proxy (502–504).
  roteado() { case "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$base$1")" in 000|502|503|504) return 1;; esac; }
  # WebSocket através do Traefik do EasyPanel e da borda. ⚠️ O Traefik do
  # EasyPanel responde 101 mesmo SEM serviço atrás (visto em 15/10/2026), então
  # o 101 só vale junto com a prova de que /ws/ alcança o play de verdade.
  ws=$(curl -s -m 10 -o /dev/null -w '%{http_code}' --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
       -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$base/ws/room")
  case "$ws" in 101|400|401|403) roteado /ws/room && ok "WebSocket chega no play ($ws)" || falha "WebSocket: proxy aceitou ($ws) mas /ws/ não alcança o play";;
                *) falha "WebSocket chega no play ($ws)";; esac
  roteado /map-storage/ && ok "map-storage roteado" || falha "map-storage roteado"
  roteado /api/ && ok "back roteado" || falha "back roteado"
fi

echo; [ "$falhas" -eq 0 ] && echo "tudo certo" || { echo "$falhas falha(s)"; exit 1; }
