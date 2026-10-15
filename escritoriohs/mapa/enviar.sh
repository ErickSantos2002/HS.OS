#!/usr/bin/env bash
# Envia saida/ ao map-storage do EscritorioHS, no diretório hs/ (o office fica
# intacto). Antes de zipar, mescla com o hs.wam que está no ar para preservar
# os objetos que o Erick pôs pelo editor do navegador (mesclar.py).
# O token é o MAP_STORAGE_AUTHENTICATION_TOKEN, lido de ~/escritoriohs.env —
# nunca impresso.
set -euo pipefail
cd "$(dirname "$0")"
PY=.venv/bin/python
BASE=https://escritoriohs.healthsafetytech.com/map-storage

$PY -m pytest testes -q
$PY gerar.py
rm -rf saida/tilesets && cp -r tilesets saida/

tmp=$(mktemp -d); trap 'rm -rf "$tmp"' EXIT
# Objetos: o que já foi publicado é do Erick (fica onde ele pôs; apagado não
# volta). publicados.json registra os ids — só é atualizado se o envio der 200.
# ⚠️ Mapa ausente só com 404. Qualquer outra falha ao ler o mapa do ar
# interrompe: subir sem os objetos do ar apagaria todos.
ar=$(curl -s -o "$tmp/no-ar.wam" -w '%{http_code}' --max-time 30 "$BASE/hs/hs.wam" || echo 000)
case "$ar" in
  200) $PY mesclar.py saida/hs.wam "$tmp/no-ar.wam" publicados.json saida/ids-antigos.json ;;
  404) $PY mesclar.py saida/hs.wam - publicados.json saida/ids-antigos.json ;;
  *)   echo "ERRO: não deu para ler o mapa do ar (HTTP $ar) — nada foi enviado"; exit 1 ;;
esac

(cd saida && zip -qr "$tmp/hs.zip" hs.tmj hs.wam placas.png logo-hs.png tilesets)
TOKEN=$(grep -oP '^MAP_STORAGE_AUTHENTICATION_TOKEN=\K.+' ~/escritoriohs.env | tr -d "\"' \r")  # sem aspas nem \r
# O cabeçalho com o token vai pela entrada padrão (--config -), não pelo argv:
# argumento de processo aparece no `ps` de qualquer usuário da máquina.
codigo=$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl --config - -s --max-time 120 -o "$tmp/resposta" -w '%{http_code}' -X POST \
  -H "X-Map-Storage-Host: escritoriohs.healthsafetytech.com" \
  -F "file=@$tmp/hs.zip" -F "directory=hs" \
  "$BASE/upload")
unset TOKEN
echo "envio: HTTP $codigo"
[ "$codigo" = 200 ] || { head -c 600 "$tmp/resposta"; echo; exit 1; }
mv publicados.json.novo publicados.json
curl -s -o /dev/null -w 'hs.wam no ar: HTTP %{http_code}\n' "$BASE/hs/hs.wam"
