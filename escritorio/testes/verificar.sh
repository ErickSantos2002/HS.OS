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
  :  # preenchido na Task 5
fi

echo; [ "$falhas" -eq 0 ] && echo "tudo certo" || { echo "$falhas falha(s)"; exit 1; }
