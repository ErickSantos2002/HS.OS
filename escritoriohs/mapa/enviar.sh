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
if curl -sf "$BASE/hs/hs.wam" -o "$tmp/no-ar.wam"; then
  $PY mesclar.py saida/hs.wam "$tmp/no-ar.wam" publicados.json
else
  $PY mesclar.py saida/hs.wam - publicados.json
fi

(cd saida && zip -qr "$tmp/hs.zip" hs.tmj hs.wam placas.png logo-hs.png tilesets)
TOKEN=$(grep -oP '^MAP_STORAGE_AUTHENTICATION_TOKEN=\K.+' ~/escritoriohs.env)
# O cabeçalho com o token vai pela entrada padrão (--config -), não pelo argv:
# argumento de processo aparece no `ps` de qualquer usuário da máquina.
codigo=$(printf 'header = "Authorization: Bearer %s"\n' "$TOKEN" | curl --config - -s -o "$tmp/resposta" -w '%{http_code}' -X POST \
  -H "X-Map-Storage-Host: escritoriohs.healthsafetytech.com" \
  -F "file=@$tmp/hs.zip" -F "directory=hs" \
  "$BASE/upload")
unset TOKEN
echo "envio: HTTP $codigo"
[ "$codigo" = 200 ] || { head -c 600 "$tmp/resposta"; echo; exit 1; }
mv publicados.json.novo publicados.json
curl -s -o /dev/null -w 'hs.wam no ar: HTTP %{http_code}\n' "$BASE/hs/hs.wam"
