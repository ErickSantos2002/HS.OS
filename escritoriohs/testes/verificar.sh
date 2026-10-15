#!/usr/bin/env bash
# Checagens contra PRODUÇÃO, de fora da VPS. Uso: verificar.sh [midia|wa|admin|tudo]
# Os testes que importam são os que NÃO passam por acaso: duas pessoas na
# mesma rede conversam mesmo com LiveKit e Coturn quebrados.
set -u
alvo="${1:-tudo}"
falhas=0
checagens=0
ok() { echo "ok   $1"; checagens=$((checagens+1)); }
falha() { echo "FALHA $1"; falhas=$((falhas+1)); checagens=$((checagens+1)); }

if [ "$alvo" = midia ] || [ "$alvo" = tudo ]; then
  # LiveKit responde "OK" na raiz, passando pelo Traefik do EasyPanel e pela borda.
  [ "$(curl -s -m 10 https://livekit.healthsafetytech.com/)" = "OK" ] \
    && ok "LiveKit atrás do domínio" || falha "LiveKit atrás do domínio"
  # TURN de verdade, rodado NA VPS com o segredo do midia.env (nada é impresso):
  # alocação autenticada em UDP e em TCP, relay para fora funcionando e relay
  # para dentro (bridge, o próprio host, loopback) recusado. STUN sozinho dava
  # verde com segredo errado e com alocação quebrada.
  turn=$(ssh -o BatchMode=yes root@62.72.11.28 'set -a; . /etc/escritoriohs/midia.env; set +a
    teste() { timeout 25 docker run --rm --network host -e S="$TURN_STATIC_AUTH_SECRET" coturn/coturn:4.17.2-r0 \
      sh -c "turnutils_uclient $1 -W \"\$S\" -u verificar -n 1 -m 1 -l 100 -e $2 -r 53 62.72.11.28" 2>&1; }
    teste "" 1.1.1.1   | grep -q "wrong length" && echo udp-ok
    teste -t 1.1.1.1   | grep -q "wrong length" && echo tcp-ok
    # 508 = faixa de relay esgotada: cada teste prende uma porta por 10 min.
    for alvo in 172.18.0.1 62.72.11.28 127.0.0.1; do r=$(teste "" $alvo)
      echo "$r" | grep -q "error 403" && echo "nega-$alvo"; echo "$r" | grep -q "error 508" && echo esgotado; done
    # Os segredos da mídia têm que ser os mesmos que o WA recebeu do EasyPanel.
    h() { printf %s "$1" | sha256sum | cut -c1-16; }
    [ "$(h "$LIVEKIT_API_SECRET")" = "$(h "$(docker exec escritoriohs_wa-back-1 printenv LIVEKIT_API_SECRET)")" ] && echo lk-igual
    [ "$(h "$LIVEKIT_API_KEY")" = "$(h "$(docker exec escritoriohs_wa-back-1 printenv LIVEKIT_API_KEY)")" ] && echo lkkey-igual
    [ "$(h "$TURN_STATIC_AUTH_SECRET")" = "$(h "$(docker exec escritoriohs_wa-play-1 printenv TURN_STATIC_AUTH_SECRET)")" ] && echo turn-igual' 2>/dev/null)
  for marca in udp-ok tcp-ok; do
    echo "$turn" | grep -qx "$marca" && ok "TURN aloca e faz relay (${marca%-ok})" || falha "TURN aloca e faz relay (${marca%-ok})"
  done
  # ⚠️ Não use `alvo` aqui: é o modo do script, e sobrescrevê-lo fazia o bloco
  # `wa` ser pulado em silêncio no "tudo" (15/10/2026).
  for destino in 172.18.0.1 62.72.11.28 127.0.0.1; do
    echo "$turn" | grep -qx "nega-$destino" && ok "TURN recusa relay para $destino" || falha "TURN recusa relay para $destino"
  done
  echo "$turn" | grep -qx esgotado && falha "faixa de relay do Coturn ESGOTADA (508) — ver README, Mídia"
  echo "$turn" | grep -qx lk-igual && echo "$turn" | grep -qx lkkey-igual \
    && ok "chaves do LiveKit iguais na mídia e no WA" || falha "chaves do LiveKit iguais na mídia e no WA"
  echo "$turn" | grep -qx turn-igual && ok "segredo do TURN igual na mídia e no WA" || falha "segredo do TURN igual na mídia e no WA"
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
  sala=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "$base/~/hs/hs.wam")
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

if [ "$alvo" = admin ] || [ "$alvo" = tudo ]; then
  # Admin API do HS.OS (sub-projeto B), só leitura. `capabilities` tem que
  # responder sem token e sem banco: o play não sobe enquanto ela falhar.
  api=https://hsosapi.healthsafetytech.com/escritorio-wa
  r=$(curl -s -m 10 -w ' %{http_code}' "$api/api/capabilities")
  [ "$r" = "{} 200" ] && ok "Admin API: capabilities 200 {}" || falha "Admin API: capabilities 200 {} (veio: $r)"
  # Sem token, `map` recusa. 200 aqui = Admin API aberta a qualquer um.
  sala=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=''))" "https://escritoriohs.healthsafetytech.com/~/hs/hs.wam")
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 "$api/api/map?playUri=$sala")" = 403 ] \
    && ok "Admin API: map sem token é 403" || falha "Admin API: map sem token é 403"
fi

# Conta o que rodou: um bloco pulado em silêncio também é falso verde.
esperado=$(case "$alvo" in midia) echo 9;; wa) echo 5;; admin) echo 2;; *) echo 16;; esac)
[ "$checagens" -eq "$esperado" ] || falha "rodaram $checagens checagens, esperadas $esperado"
echo; [ "$falhas" -eq 0 ] && echo "tudo certo ($checagens checagens)" || { echo "$falhas falha(s)"; exit 1; }
