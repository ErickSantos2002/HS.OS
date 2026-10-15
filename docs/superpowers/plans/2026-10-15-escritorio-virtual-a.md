# Escritório virtual — sub-projeto A (no ar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** WorkAdventure no ar em `escritorio.healthsafetytech.com`, com login Microsoft, vídeo por LiveKit e Coturn na VPS do EasyPanel, e o mapa de escritório da HS.

**Architecture:** O WorkAdventure (`play`, `back`, `map-storage`, `uploader`, `icon`, `redis`) roda como serviço **Compose no EasyPanel**, com um nginx próprio (`borda`) na frente fazendo o roteamento por caminho que o Traefik oficial fazia — assim o EasyPanel só precisa de **um** alvo por domínio, sem regra de caminho nem strip. LiveKit e Coturn rodam em `network_mode: host`, num Compose à parte gerenciado por `systemd`. O mesmo `borda` encaminha `livekit.healthsafetytech.com` para o LiveKit no host por `172.18.0.1:7880`.

**Tech Stack:** WorkAdventure `v1.33.11`, LiveKit server `v1.13.8`, Coturn `4.17.2-r0`, nginx `1.27-alpine`, livekit-cli `v2.18.8` (só para teste), Docker Compose, systemd, EasyPanel, Microsoft Entra (OIDC), Cloudflare R2 (backup).

**Spec:** `docs/superpowers/specs/2026-10-15-escritorio-virtual-design.md`

## Global Constraints

- VPS: `62.72.11.28` (Hostinger, Ubuntu 24.04, `srv815732`), Swarm ativo, EasyPanel com Traefik nas portas 80/443. SSH `root@62.72.11.28` funciona sem senha a partir da máquina do Erick.
- Domínios: `escritorio.healthsafetytech.com` e `livekit.healthsafetytech.com` — **já resolvem para `62.72.11.28`** (conferido em 15/10/2026).
- Bridge do host vista de dentro dos containers do EasyPanel: `172.18.0.1` (`docker_gwbridge`).
- Portas no host: LiveKit `7880/tcp` (só via `borda`), `7881/tcp`, `50000–50100/udp`; Coturn `3478/udp+tcp`, relay `49160–49200/udp`.
- Versões fixas, **nunca `latest`**: WA `v1.33.11`, LiveKit `v1.13.8`, Coturn `4.17.2-r0`, nginx `1.27-alpine`.
- `MAX_USERS_FOR_WEBRTC=4`, `DISABLE_ANONYMOUS=true`, `OPENID_WOKA_NAME_POLICY=force_opid`, `OPENID_SCOPE=openid email profile`, `FALLBACK_LOCALE=pt-BR`, `ENABLE_TUTORIAL=true`, `MAP_EDITOR_ALLOW_ALL_USERS=false`, `MAP_EDITOR_ALLOWED_USERS=<e-mail do Erick>`.
- **Sem** `MATRIX_*`, sem `LIVEKIT_RECORDING_*`, sem `ADMIN_API_*`, sem `JITSI_*`/`BBB_*`.
- Limites: LiveKit 2 CPU / 2 GB; Coturn 0,5 CPU / 256 MB.
- **O repositório é público.** Segredo nenhum entra no git; no repo só `.env.example`. Segredo gerado não é impresso no terminal da sessão — vai para arquivo `600` no host ou para o clipboard (`wl-copy`).
- **Ação em produção (SSH root, EasyPanel, Entra) é confirmada com o Erick antes de cada task que a executa.** Mostrar o que vai rodar, esperar o "pode".
- Idioma: comentários, README e mensagens em português, padrão do repo.
- Fim de branch: merge local na `main` + `git push` (sem PR).

## Review Focus

1. **Relay do Coturn para dentro da VPS.** A VPS hospeda os bancos da empresa; um TURN sem `denied-peer-ip` vira túnel para `172.16.0.0/12` e `127.0.0.1` a partir de qualquer pessoa com credencial. Esperado: relay para faixa privada recusado. Teste na Task 3 (`testar-config.sh` exige as faixas) e na Task 4 (conferência no host).
2. **Pessoa fora do grupo do Entra.** Esperado: recusada pela Microsoft antes de ver o mapa. Teste manual no aceite (Task 8, critério 1) — e a Task 5 confere que `DISABLE_ANONYMOUS=true` chegou ao container.
3. **WebSocket atrás de dois proxies** (Traefik do EasyPanel → `borda` → `play:3001`). Sem os cabeçalhos `Upgrade`/`Connection` o mapa abre e ninguém se vê. Teste na Task 2 (`testar-config.sh` exige os cabeçalhos) e na Task 5 (`verificar.sh` faz o handshake em `/ws/`).
4. **Reunião com mais de 4 sem LiveKit.** Bolha de 2 funciona mesmo com o LiveKit morto, então ninguém percebe até a primeira reunião. Teste na Task 4 com `lk load-test` de 6 publicadores vindo de fora da VPS.
5. **Editor de mapa aberto a todos.** Esperado: só o Erick vê o editor. Teste no aceite (Task 8, critério 5), com uma segunda conta.

---

## Estrutura de arquivos

```
escritorio/
  README.md                    operação: o que roda onde, falhas, comandos, validações
  .env.example                 variáveis do serviço Compose no EasyPanel (sem valor secreto)
  docker-compose.yml           WA sem Traefik + borda (vai para o EasyPanel)
  borda/nginx.conf             roteamento por caminho + livekit.* → 172.18.0.1:7880
  midia/docker-compose.yml     LiveKit + Coturn, network_mode: host
  midia/livekit.yaml           config do LiveKit (chaves vêm por env)
  midia/turnserver.conf        config do Coturn (segredo vem por argumento)
  midia/escritorio-midia.service  unit do systemd
  midia/instalar.sh            instala/atualiza a mídia no host (roda como root na VPS)
  backup/backup-mapas.sh       tar do volume do map-storage → R2
  backup/escritorio-backup.service / .timer
  testes/testar-config.sh      checagens estáticas dos arquivos acima (roda local)
  testes/verificar.sh          checagens contra produção (HTTP, WS, LiveKit, STUN)
```

---

### Task 1: Validar a VPS antes de construir (sondagem, sem efeito permanente)

Responde aos três riscos da spec. **Se o UDP não chegar, PARAR e voltar ao Erick** — é o gatilho do plano B (LiveKit Cloud).

**Files:**
- Create: `escritorio/README.md` (só a seção "Validações de 15/10/2026" por enquanto)

**Interfaces:**
- Produces: decisão registrada no README — "UDP abre: sim/não", "EasyPanel Compose alcança 172.18.0.1: sim/não", "domínio → serviço Compose: sim/não".

- [ ] **Step 1: Branch**

```bash
cd ~/github/HS.OS && git checkout main && git pull -q && git checkout -b escritorio-a
```

- [ ] **Step 2: UDP e TCP de fora chegam no host? (firewall do painel da Hostinger)**

Confirmar com o Erick antes. Abre ouvintes temporários na VPS (somem com o `timeout`) e manda pacotes da máquina do Erick:

```bash
ssh root@62.72.11.28 'for p in 50000 50100 3478 49160; do timeout 25 socat -u UDP-RECV:$p STDOUT > /tmp/udp-$p.txt & done; timeout 25 socat -u TCP-LISTEN:7881,reuseaddr STDOUT > /tmp/tcp-7881.txt & sleep 1; echo ouvindo' \
  || ssh root@62.72.11.28 'apt-get install -y socat >/dev/null && echo socat-instalado'
sleep 2
for p in 50000 50100 3478 49160; do echo "udp-$p" | socat -u - UDP-SENDTO:62.72.11.28:$p; done
echo tcp-7881 | socat -u - TCP:62.72.11.28:7881
sleep 3
ssh root@62.72.11.28 'cat /tmp/udp-*.txt /tmp/tcp-7881.txt; rm -f /tmp/udp-*.txt /tmp/tcp-7881.txt'
```

Expected: as cinco linhas (`udp-50000`, `udp-50100`, `udp-3478`, `udp-49160`, `tcp-7881`). Linha faltando = porta bloqueada por fora (o `ufw` está inativo e `INPUT` é `ACCEPT`, conferido em 15/10). Se faltar UDP: **parar**, avisar o Erick e oferecer abrir no painel da Hostinger (hPanel → VPS → Firewall) ou ir de LiveKit Cloud.

- [ ] **Step 3: Serviço Compose de teste no EasyPanel**

Confirmar com o Erick. Criar o projeto `escritorio` e, nele, um serviço Compose `teste-borda` (pelo painel ou pelo MCP do EasyPanel — `search_procedures` "create compose service"), com este conteúdo:

```yaml
services:
  borda:
    image: nginx:1.27-alpine
    command: ["/bin/sh", "-c", "printf 'server { listen 80; location / { return 200 \"borda-ok\\n\"; } location /host/ { proxy_pass http://172.18.0.1:18080/; } }' > /etc/nginx/conf.d/default.conf && nginx -g 'daemon off;'"]
```

No host, um alvo temporário em `18080`:

```bash
ssh root@62.72.11.28 'timeout 120 sh -c "while true; do printf \"HTTP/1.1 200 OK\r\nContent-Length: 8\r\n\r\nhost-ok\n\" | socat - TCP-LISTEN:18080,reuseaddr; done" >/dev/null 2>&1 &'
```

Domínio no EasyPanel: `escritorio.healthsafetytech.com` → serviço `borda`, porta `80`, HTTPS.

```bash
curl -s https://escritorio.healthsafetytech.com/        # Expected: borda-ok
curl -s https://escritorio.healthsafetytech.com/host/   # Expected: host-ok
```

`borda-ok` prova domínio → Compose. `host-ok` prova Compose → host pela bridge (é o caminho que o LiveKit vai usar). Se `/host/` falhar com 502, testar `extra_hosts: ["host.docker.internal:host-gateway"]` e `proxy_pass http://host.docker.internal:18080/` antes de concluir que não dá; registrar qual funcionou.

- [ ] **Step 4: Apagar o serviço de teste** (o projeto `escritorio` fica).

- [ ] **Step 5: Registrar no README e commitar**

`escritorio/README.md`:

```markdown
# Escritório virtual (WorkAdventure)

Spec: `docs/superpowers/specs/2026-10-15-escritorio-virtual-design.md`.

## Validações de 15/10/2026

| pergunta | resposta | como foi medido |
|---|---|---|
| UDP 50000–50100, 3478, 49160–49200 chegam de fora? | <sim/não> | socat na VPS, pacote da rede da HS |
| TCP 7881 chega de fora? | <sim/não> | idem |
| Domínio do EasyPanel → serviço Compose? | <sim/não> | `curl` em `/` devolveu `borda-ok` |
| Container do Compose → host? | <por 172.18.0.1 / por host-gateway> | `curl` em `/host/` devolveu `host-ok` |
```

Preencher os `<…>` com o que foi medido (não deixar marcador no commit).

```bash
git add escritorio/README.md && git commit -m "docs(escritorio): validações da VPS antes de montar"
```

---

### Task 2: O Compose do WorkAdventure e a `borda`

**Files:**
- Create: `escritorio/docker-compose.yml`, `escritorio/borda/nginx.conf`, `escritorio/.env.example`, `escritorio/testes/testar-config.sh`

**Interfaces:**
- Consumes: da Task 1, se o host é alcançado por `172.18.0.1` ou por `host.docker.internal` (ajustar o `upstream livekit` abaixo).
- Produces: serviço `borda` na porta `80` (alvo dos dois domínios); variáveis listadas no `.env.example`, que a Task 5 preenche.

- [ ] **Step 1: Escrever o teste estático (falha: arquivos não existem)**

`escritorio/testes/testar-config.sh`:

```bash
#!/usr/bin/env bash
# Checagens estáticas do escritório — rodam na máquina de quem mexe, sem VPS.
# Cada uma tranca um defeito que só apareceria em produção, com gente na tela.
set -u
cd "$(dirname "$0")/.."
falhas=0
exige() { if grep -qE -- "$2" "$1" 2>/dev/null; then echo "ok   $3"; else echo "FALHA $3"; falhas=$((falhas+1)); fi; }
proibe() { if grep -qE -- "$2" "$1" 2>/dev/null; then echo "FALHA $3"; falhas=$((falhas+1)); else echo "ok   $3"; fi; }

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
  exige midia/turnserver.conf '^use-auth-secret$' "coturn por static secret"
  proibe midia/turnserver.conf '^static-auth-secret=' "segredo do coturn fora do arquivo"
  exige midia/docker-compose.yml 'livekit/livekit-server:v1\.13\.8' "LiveKit fixo"
  exige midia/docker-compose.yml 'coturn/coturn:4\.17\.2-r0' "Coturn fixo"
  exige midia/livekit.yaml 'port_range_start: 50000' "faixa UDP começa em 50000"
  exige midia/livekit.yaml 'port_range_end: 50100' "faixa UDP termina em 50100"
fi

echo; [ "$falhas" -eq 0 ] && echo "tudo certo" || { echo "$falhas falha(s)"; exit 1; }
```

```bash
chmod +x escritorio/testes/testar-config.sh && escritorio/testes/testar-config.sh
```

Expected: FALHA em quase tudo (arquivos ausentes), exit 1.

- [ ] **Step 2: `escritorio/borda/nginx.conf`**

```nginx
# Faz o roteamento por caminho que o Traefik do Compose oficial fazia por
# labels. O EasyPanel só aponta os dois domínios para cá (porta 80); TLS fica
# com o Traefik dele, que manda X-Forwarded-Proto.

map $http_upgrade $connection_upgrade {
    default upgrade;
    ''      close;
}

# Ajustar para host.docker.internal se a Task 1 mostrou que é esse o caminho.
upstream livekit { server 172.18.0.1:7880; }

server {
    listen 80;
    server_name escritorio.healthsafetytech.com;
    client_max_body_size 50m;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;

    # A barra final no proxy_pass tira o prefixo, como o stripprefix do Traefik.
    location /api/         { proxy_pass http://back:8080/; }
    location /uploader/    { proxy_pass http://uploader:8080/; }
    location /icon/        { proxy_pass http://icon:8080/; }
    location /lettericons  { proxy_pass http://icon:8080; }
    location /map-storage/ { proxy_pass http://map-storage:3000/; }
    location /ws/          { proxy_pass http://play:3001; }
    location /             { proxy_pass http://play:3000; }
}

server {
    listen 80;
    server_name livekit.healthsafetytech.com;

    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $http_x_forwarded_proto;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_read_timeout 3600s;

    location / { proxy_pass http://livekit; }
}
```

- [ ] **Step 3: `escritorio/docker-compose.yml`**

Adaptado de `contrib/docker/docker-compose.prod.yaml` do WA `v1.33.11`: sem `reverse-proxy`, sem labels, sem Matrix/gravação/Jitsi/BBB, com `borda`.

```yaml
# WorkAdventure no EasyPanel (serviço Compose do projeto `escritorio`).
# Origem: contrib/docker/docker-compose.prod.yaml do WA, sem o Traefik deles —
# o roteamento por caminho está em borda/nginx.conf. Ver escritorio/README.md.
services:
  borda:
    image: nginx:1.27-alpine
    volumes:
      - ./borda/nginx.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on: [play, back, map-storage, uploader, icon]
    restart: unless-stopped

  play:
    image: thecodingmachine/workadventure-play:${VERSION}
    environment:
      - ENABLE_MAP_EDITOR=true
      - MAP_EDITOR_ALLOWED_USERS
      - MAP_EDITOR_ALLOW_ALL_USERS
      - PUSHER_URL=https://${DOMAIN}/
      - ICON_URL=/icon
      - TURN_SERVER
      - TURN_STATIC_AUTH_SECRET
      - STUN_SERVER
      - DISABLE_ANONYMOUS
      - SECRET_KEY
      - API_URL=back:50051
      - FRONT_URL=/
      - INTERNAL_MAP_STORAGE_URL=http://map-storage:3000
      - PUBLIC_MAP_STORAGE_URL=https://${DOMAIN}/map-storage
      - START_ROOM_URL
      - OPENID_PROMPT=login
      - OPENID_WOKA_NAME_POLICY
      - OPENID_CLIENT_ID
      - OPENID_CLIENT_SECRET
      - OPENID_CLIENT_ISSUER
      - OPENID_SCOPE
      - OPENID_USERNAME_CLAIM
      - OPENID_LOGOUT_REDIRECT_URL
      - FALLBACK_LOCALE
      - ENABLE_CHAT
      - ENABLE_CHAT_UPLOAD=false
      - REDIS_HOST=redis
      - ENABLE_TUTORIAL
      - UPLOADER_URL=/uploader
      - ENABLE_OPENAPI_ENDPOINT=false
      - ROOM_API_PORT=50051
      - ROOM_API_SECRET_KEY
      - MAP_STORAGE_API_TOKEN
      - LIVEKIT_API_KEY
      - LIVEKIT_API_SECRET
      - SECURITY_EMAIL
    restart: unless-stopped

  back:
    image: thecodingmachine/workadventure-back:${VERSION}
    environment:
      - PLAY_URL=https://${DOMAIN}
      - ENABLE_MAP_EDITOR=true
      - SECRET_KEY
      - TURN_SERVER
      - STUN_SERVER
      - REDIS_HOST=redis
      - MAP_STORAGE_URL=map-storage:50053
      - INTERNAL_MAP_STORAGE_URL=http://map-storage:3000
      - PUBLIC_MAP_STORAGE_URL=https://${DOMAIN}/map-storage
      - ENABLE_CHAT
      - ENABLE_CHAT_UPLOAD=false
      - MAX_USERS_FOR_WEBRTC
      - LIVEKIT_HOST
      - LIVEKIT_API_KEY
      - LIVEKIT_API_SECRET
    restart: unless-stopped

  uploader:
    image: thecodingmachine/workadventure-uploader:${VERSION}
    environment:
      - UPLOADER_URL=https://${DOMAIN}/uploader
      - REDIS_HOST=redis
      - REDIS_PORT=6379
      - ENABLE_CHAT_UPLOAD=false
    restart: unless-stopped

  icon:
    image: matthiasluedtke/iconserver:v3.21.0
    restart: unless-stopped

  redis:
    image: redis:6
    volumes:
      - redisdata:/data
    restart: unless-stopped

  map-storage:
    image: thecodingmachine/workadventure-map-storage:${VERSION}
    environment:
      API_URL: back:50051
      SECRET_KEY: ${SECRET_KEY}
      PATH_PREFIX: "/map-storage"
      ENABLE_BEARER_AUTHENTICATION: "true"
      AUTHENTICATION_TOKEN: ${MAP_STORAGE_AUTHENTICATION_TOKEN}
      ENTITY_COLLECTION_URLS: "https://${DOMAIN}/collections/FurnitureCollection.json,https://${DOMAIN}/collections/OfficeCollection.json"
      MAP_STORAGE_API_TOKEN: ${MAP_STORAGE_API_TOKEN}
      PUSHER_URL: "https://${DOMAIN}/"
    volumes:
      - map-storage-data:/maps
    restart: unless-stopped

volumes:
  redisdata:
  map-storage-data:
```

- [ ] **Step 4: `escritorio/.env.example`**

```bash
# Variáveis do serviço Compose `escritorio` no EasyPanel.
# ⚠️ Repo público: segredo NUNCA aqui. Os valores vão para a aba Environment
# do EasyPanel, gerados por `openssl rand -hex 32` (ver README, "Segredos").

VERSION=v1.33.11
DOMAIN=escritorio.healthsafetytech.com

# Login — app "HS Escritório" no Entra (ver README, "Entra")
DISABLE_ANONYMOUS=true
OPENID_CLIENT_ID=
OPENID_CLIENT_SECRET=
OPENID_CLIENT_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0
OPENID_SCOPE=openid email profile
OPENID_USERNAME_CLAIM=name
OPENID_WOKA_NAME_POLICY=force_opid
OPENID_LOGOUT_REDIRECT_URL=https://escritorio.healthsafetytech.com/
FALLBACK_LOCALE=pt-BR
ENABLE_TUTORIAL=true

# Editor de mapa — só a lista. ⚠️ Ignorada quando houver ADMIN_API (sub-projeto B).
MAP_EDITOR_ALLOW_ALL_USERS=false
MAP_EDITOR_ALLOWED_USERS=

# Chat: sem Matrix. O chat da bolha depende disto (conferir na Task 5).
ENABLE_CHAT=true

# Sala de entrada (preenchida na Task 6)
START_ROOM_URL=/~/office.wam

# Segredos internos do WA
SECRET_KEY=
MAP_STORAGE_API_TOKEN=
MAP_STORAGE_AUTHENTICATION_TOKEN=
ROOM_API_SECRET_KEY=

# Vídeo
MAX_USERS_FOR_WEBRTC=4
LIVEKIT_HOST=wss://livekit.healthsafetytech.com
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=
STUN_SERVER=stun:62.72.11.28:3478
TURN_SERVER=turn:62.72.11.28:3478
TURN_STATIC_AUTH_SECRET=

SECURITY_EMAIL=
```

- [ ] **Step 5: Validar a sintaxe**

```bash
cd escritorio && cp .env.example .env.teste && docker compose --env-file .env.teste config -q && echo compose-ok; rm .env.teste
docker run --rm -v "$PWD/borda/nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
  --add-host play:127.0.0.1 --add-host back:127.0.0.1 --add-host uploader:127.0.0.1 \
  --add-host icon:127.0.0.1 --add-host map-storage:127.0.0.1 nginx:1.27-alpine nginx -t
cd .. && escritorio/testes/testar-config.sh
```

Expected: `compose-ok`, `syntax is ok`, e todas as checagens fora de `midia/` com `ok` (as de `midia/` ainda não rodam porque a pasta não existe). Exit 0.

- [ ] **Step 6: Commit**

```bash
git add escritorio/ && git commit -m "feat(escritorio): compose do WorkAdventure sem Traefik, com a borda"
```

---

### Task 3: A mídia no host — LiveKit + Coturn

**Files:**
- Create: `escritorio/midia/docker-compose.yml`, `escritorio/midia/livekit.yaml`, `escritorio/midia/turnserver.conf`, `escritorio/midia/escritorio-midia.service`, `escritorio/midia/instalar.sh`

**Interfaces:**
- Produces: no host, `/etc/escritorio/midia.env` (root, `600`) com `LIVEKIT_KEYS`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_STATIC_AUTH_SECRET`; unit `escritorio-midia.service`. A Task 5 lê dali os três segredos para o EasyPanel.

- [ ] **Step 1: Rodar o teste estático (falha nas checagens de `midia/`)**

```bash
mkdir -p escritorio/midia && escritorio/testes/testar-config.sh
```

Expected: FALHA em `coturn nega relay…`, `LiveKit fixo`, etc. Exit 1.

- [ ] **Step 2: `escritorio/midia/livekit.yaml`**

```yaml
# LiveKit — só entra em bolha/sala com mais de 4 (MAX_USERS_FOR_WEBRTC).
# As chaves chegam por LIVEKIT_KEYS (formato "chave: segredo"), de
# /etc/escritorio/midia.env — não ficam neste arquivo, que é público.
port: 7880
bind_addresses: ["0.0.0.0"]
rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: true
logging:
  level: info
```

- [ ] **Step 3: `escritorio/midia/turnserver.conf`**

```conf
# Coturn — relay para quem está em rede que bloqueia conexão direta (4G, hotel).
# O segredo chega por --static-auth-secret na linha de comando (midia.env).
listening-port=3478
external-ip=62.72.11.28
realm=escritorio.healthsafetytech.com
use-auth-secret
fingerprint
min-port=49160
max-port=49200
no-tls
no-dtls
no-cli
no-multicast-peers

# ⚠️ Esta VPS hospeda os bancos da empresa. Sem estas linhas, qualquer pessoa
# com credencial de TURN usa o relay para alcançar 172.18.0.1, os containers
# e o loopback. testes/testar-config.sh exige cada uma.
denied-peer-ip=0.0.0.0-0.255.255.255
denied-peer-ip=10.0.0.0-10.255.255.255
denied-peer-ip=127.0.0.0-127.255.255.255
denied-peer-ip=169.254.0.0-169.254.255.255
denied-peer-ip=172.16.0.0-172.31.255.255
denied-peer-ip=192.168.0.0-192.168.255.255
```

- [ ] **Step 4: `escritorio/midia/docker-compose.yml`**

```yaml
# Mídia do escritório, fora do Swarm: o LiveKit precisa de UDP direto no host.
# Sobe por escritorio-midia.service. Segredos em /etc/escritorio/midia.env.
services:
  livekit:
    image: livekit/livekit-server:v1.13.8
    network_mode: host
    command: ["--config", "/etc/livekit.yaml"]
    env_file: /etc/escritorio/midia.env
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    restart: unless-stopped
    deploy:
      resources:
        limits: { cpus: "2", memory: 2g }

  coturn:
    image: coturn/coturn:4.17.2-r0
    network_mode: host
    env_file: /etc/escritorio/midia.env
    entrypoint: ["/bin/sh", "-c", "exec turnserver -c /etc/coturn/turnserver.conf --static-auth-secret=\"$$TURN_STATIC_AUTH_SECRET\""]
    volumes:
      - ./turnserver.conf:/etc/coturn/turnserver.conf:ro
    restart: unless-stopped
    deploy:
      resources:
        limits: { cpus: "0.5", memory: 256m }
```

- [ ] **Step 5: `escritorio/midia/escritorio-midia.service`**

```ini
[Unit]
Description=Escritório virtual — LiveKit e Coturn
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/escritorio/midia
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
```

- [ ] **Step 6: `escritorio/midia/instalar.sh`**

```bash
#!/usr/bin/env bash
# Instala ou atualiza a mídia do escritório. Roda como root NA VPS:
#   scp -r escritorio/midia root@62.72.11.28:/opt/escritorio/ && ssh root@62.72.11.28 bash /opt/escritorio/midia/instalar.sh
# Gera os segredos só na primeira vez e NUNCA os imprime.
set -euo pipefail
install -d -m 700 /etc/escritorio
if [ ! -f /etc/escritorio/midia.env ]; then
  umask 077
  chave="hs$(openssl rand -hex 6)"
  segredo="$(openssl rand -hex 32)"
  {
    echo "LIVEKIT_KEYS=$chave: $segredo"
    echo "LIVEKIT_API_KEY=$chave"
    echo "LIVEKIT_API_SECRET=$segredo"
    echo "TURN_STATIC_AUTH_SECRET=$(openssl rand -hex 32)"
  } > /etc/escritorio/midia.env
  echo "segredos gerados em /etc/escritorio/midia.env"
fi
install -m 644 /opt/escritorio/midia/escritorio-midia.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now escritorio-midia.service
cd /opt/escritorio/midia && docker compose pull -q && docker compose up -d
sleep 3
docker compose ps --format '{{.Service}} {{.State}}'
```

- [ ] **Step 7: Teste estático passa**

```bash
chmod +x escritorio/midia/instalar.sh && escritorio/testes/testar-config.sh
docker compose -f escritorio/midia/docker-compose.yml config -q 2>&1 | grep -v "env file" ; echo midia-compose-checado
```

Expected: `tudo certo`, exit 0. (O `config` reclama do `env_file` ausente na máquina local — é esperado.)

- [ ] **Step 8: Commit**

```bash
git add escritorio/midia && git commit -m "feat(escritorio): LiveKit e Coturn na rede do host, com systemd"
```

---

### Task 4: Instalar a mídia na VPS e provar de fora

Confirmar com o Erick antes do Step 1 (escreve em `/opt`, `/etc` e no systemd da VPS de produção).

**Files:**
- Create: `escritorio/testes/verificar.sh` (as checagens de mídia; a Task 5 acrescenta as do WA)

**Interfaces:**
- Consumes: `/etc/escritorio/midia.env` (Task 3).
- Produces: `verificar.sh midia` (exit 0 = mídia sã).

- [ ] **Step 1: Instalar**

```bash
ssh root@62.72.11.28 'mkdir -p /opt/escritorio' && scp -rq escritorio/midia root@62.72.11.28:/opt/escritorio/ \
  && ssh root@62.72.11.28 bash /opt/escritorio/midia/instalar.sh
```

Expected: `livekit running` e `coturn running`.

- [ ] **Step 2: Conferir a negação de relay no Coturn ativo**

```bash
ssh root@62.72.11.28 'docker logs midia-coturn-1 2>&1 | grep -ciE "denied|peer" ; ss -lunp | grep -E ":(3478|50000) "'
```

Expected: contagem > 0 (o Coturn loga as faixas negadas ao subir) e as portas `3478` e a faixa do LiveKit escutando.

- [ ] **Step 3: Escrever `escritorio/testes/verificar.sh` (parte da mídia)**

```bash
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
```

```bash
chmod +x escritorio/testes/verificar.sh && escritorio/testes/verificar.sh midia
```

Expected: `ok` nas duas, **se** a `borda` já estiver no ar. Como a `borda` só sobe na Task 5, a primeira linha falha agora — conferir o LiveKit direto no host em vez disso:

```bash
ssh root@62.72.11.28 'curl -s localhost:7880/'   # Expected: OK
```

- [ ] **Step 4: Carga de 6 publicadores vindo de fora (critério 4 sem gente)**

```bash
ssh root@62.72.11.28 'set -a; . /etc/escritorio/midia.env; set +a; \
  docker run --rm --network host livekit/livekit-cli:v2.18.8 load-test \
    --url ws://127.0.0.1:7880 --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
    --room teste-carga --video-publishers 6 --subscribers 6 --duration 60s' 2>&1 | tail -15
```

Esse roda **no host** e prova o servidor. A prova de fora (UDP atravessando o firewall) vem depois que a `borda` subir, na Task 5 Step 6, com a mesma carga pelo `wss://livekit.healthsafetytech.com` da máquina do Erick. Expected aqui: tabela de resultados com 6 publicadores, perda de pacote ~0%. Anotar CPU do monitor do EasyPanel durante o teste.

- [ ] **Step 5: Registrar e commitar**

Acrescentar ao README uma seção "Mídia" com: onde mora (`/opt/escritorio/midia`, `/etc/escritorio/midia.env`), `systemctl status escritorio-midia`, `docker compose -f /opt/escritorio/midia/docker-compose.yml logs -f livekit`, e o resultado do load-test (CPU de pico).

```bash
git add escritorio/ && git commit -m "feat(escritorio): mídia instalada na VPS e verificar.sh"
```

---

### Task 5: Entra + WorkAdventure no EasyPanel

**Files:**
- Modify: `escritorio/testes/verificar.sh` (bloco `wa`), `escritorio/README.md` (seções "Entra", "Segredos")

**Interfaces:**
- Consumes: `borda/nginx.conf`, `docker-compose.yml`, `.env.example` (Task 2); `/etc/escritorio/midia.env` (Task 3).
- Produces: `https://escritorio.healthsafetytech.com` respondendo; `verificar.sh wa` exit 0.

- [ ] **Step 1: App "HS Escritório" no Entra (o Erick faz, no portal)**

Checklist para o Erick (portal.azure.com → Microsoft Entra ID):
1. App registrations → New registration → nome **HS Escritório**, contas só deste diretório, redirect URI Web `https://escritorio.healthsafetytech.com/openid-callback`.
2. Certificates & secrets → New client secret (24 meses). Copiar o **Value**.
3. Enterprise applications → HS Escritório → Properties → **Assignment required = Yes**.
4. Groups → novo grupo de segurança **HS – Escritório**, com o Erick e as 2–3 pessoas do piloto. Users and groups do app → adicionar o grupo.
5. Me mandar: Application (client) ID. O Directory (tenant) ID é o mesmo do `MS_TENANT_ID` do HS.OS. O secret o Erick cola direto no EasyPanel.

Registrar no README a seção "Entra" com esses passos e a data de vencimento do secret.

- [ ] **Step 2: Montar o bloco de variáveis no clipboard**

Gera os segredos internos do WA, lê os de mídia no host, e põe o bloco inteiro no clipboard sem imprimir:

```bash
ssh root@62.72.11.28 'grep -E "^(LIVEKIT_API_KEY|LIVEKIT_API_SECRET|TURN_STATIC_AUTH_SECRET)=" /etc/escritorio/midia.env' > /tmp/midia.$$ \
&& { grep -vE '^(SECRET_KEY|MAP_STORAGE_API_TOKEN|MAP_STORAGE_AUTHENTICATION_TOKEN|ROOM_API_SECRET_KEY|LIVEKIT_API_KEY|LIVEKIT_API_SECRET|TURN_STATIC_AUTH_SECRET|OPENID_CLIENT_ID|MAP_EDITOR_ALLOWED_USERS|OPENID_CLIENT_ISSUER)=' escritorio/.env.example | grep -vE '^\s*(#|$)'
     echo "OPENID_CLIENT_ID=<client id do Step 1>"
     echo "OPENID_CLIENT_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0"
     echo "MAP_EDITOR_ALLOWED_USERS=<e-mail do Erick>"
     for v in SECRET_KEY MAP_STORAGE_API_TOKEN MAP_STORAGE_AUTHENTICATION_TOKEN ROOM_API_SECRET_KEY; do echo "$v=$(openssl rand -hex 32)"; done
     cat /tmp/midia.$$; } | wl-copy; rm -f /tmp/midia.$$; wl-paste | sed -E 's/=(.{4}).{8,}/=\1…/'
```

Antes de rodar, trocar os três `<…>` pelos valores reais (client id, tenant do `MS_TENANT_ID`, e-mail). O `sed` final mostra só o começo de cada valor. `OPENID_CLIENT_SECRET` fica vazio no bloco: o Erick cola o Value do Entra direto no EasyPanel.

- [ ] **Step 3: Criar o serviço Compose `wa` no projeto `escritorio`** (o Erick, no EasyPanel, ou pelo MCP com confirmação)

- Fonte: GitHub `ErickSantos2002/HS.OS`, branch `main` (ou `escritorio-a` durante o piloto), caminho do compose `escritorio/docker-compose.yml`.
- Environment: colar o bloco do clipboard + `OPENID_CLIENT_SECRET`.
- Domínios: `escritorio.healthsafetytech.com` → serviço `borda`, porta `80`; `livekit.healthsafetytech.com` → serviço `borda`, porta `80`. HTTPS nos dois.
- Deploy.

- [ ] **Step 4: Escrever o bloco `wa` do `verificar.sh` (falha antes do deploy)**

Substituir o `:  # preenchido na Task 5` por:

```bash
  base=https://escritorio.healthsafetytech.com
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 15 $base/)" = 200 ] && ok "play abre" || falha "play abre"
  # Sem anônimo: entrar numa sala sem login tem que mandar para a Microsoft.
  curl -s -m 15 -o /dev/null -w '%{redirect_url}' "$base/login" | grep -q "login.microsoftonline.com" \
    && ok "login redireciona para o Entra" || falha "login redireciona para o Entra"
  # WebSocket através do Traefik do EasyPanel e da borda: 101, ou 400/401 do
  # próprio play (que exige token) — o que NÃO pode é 502/504 de proxy.
  ws=$(curl -s -m 10 -o /dev/null -w '%{http_code}' --http1.1 -H "Connection: Upgrade" -H "Upgrade: websocket" \
       -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" "$base/ws/room")
  case "$ws" in 101|400|401|403) ok "WebSocket chega no play ($ws)";; *) falha "WebSocket chega no play ($ws)";; esac
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 $base/map-storage/)" != 502 ] && ok "map-storage roteado" || falha "map-storage roteado"
  [ "$(curl -s -o /dev/null -w '%{http_code}' -m 10 $base/api/)" != 502 ] && ok "back roteado" || falha "back roteado"
```

Rodar antes do deploy terminar: `escritorio/testes/verificar.sh wa` → FALHA.

- [ ] **Step 5: Depois do deploy, verificar tudo**

```bash
escritorio/testes/verificar.sh tudo
```

Expected: `tudo certo`. Se o redirecionamento do login não bater (o caminho de entrada do WA pode ser outro na `v1.33.11`), abrir `https://escritorio.healthsafetytech.com` no navegador, seguir até a tela da Microsoft, e ajustar a URL do teste para a que de fato redireciona — sem afrouxar o critério (tem que terminar em `login.microsoftonline.com`).

Conferir que as variáveis chegaram:

```bash
ssh root@62.72.11.28 'docker ps --format "{{.Names}}" | grep -E "play" | head -1 | xargs -I{} docker exec {} printenv DISABLE_ANONYMOUS MAP_EDITOR_ALLOW_ALL_USERS MAX_USERS_FOR_WEBRTC 2>/dev/null || docker exec $(docker ps -qf name=play | head -1) printenv DISABLE_ANONYMOUS MAP_EDITOR_ALLOW_ALL_USERS'
```

Expected: `true`, `false`, `4` (o último vem do `back`; se não aparecer no `play`, conferir no container do `back`).

- [ ] **Step 6: Carga de 6 publicadores DE FORA, pelo domínio**

Da máquina do Erick (UDP atravessando a internet e o firewall do provedor):

```bash
ssh root@62.72.11.28 'grep -E "^LIVEKIT_API_(KEY|SECRET)=" /etc/escritorio/midia.env' > /tmp/lk.$$ \
&& set -a && . /tmp/lk.$$ && set +a && rm -f /tmp/lk.$$ \
&& docker run --rm livekit/livekit-cli:v2.18.8 load-test --url wss://livekit.healthsafetytech.com \
     --api-key "$LIVEKIT_API_KEY" --api-secret "$LIVEKIT_API_SECRET" \
     --room teste-carga-fora --video-publishers 6 --subscribers 6 --duration 60s 2>&1 | tail -15
unset LIVEKIT_API_KEY LIVEKIT_API_SECRET
```

Expected: 6 publicadores conectados, perda baixa. Falha de conexão aqui com sucesso no Step 4 da Task 4 = UDP bloqueado no caminho → voltar ao Erick.

- [ ] **Step 7: Chat da bolha sem Matrix**

Entrar com a conta do Erick em duas abas (uma anônima com outra conta do piloto), aproximar os avatares e abrir o chat da bolha. Se o chat da bolha funciona: manter `ENABLE_CHAT=true`. Se o painel de chat aparece vazio/quebrado sem Matrix: `ENABLE_CHAT=false` no EasyPanel, redeploy, e registrar no README qual foi.

- [ ] **Step 8: Commit**

```bash
git add escritorio/ && git commit -m "feat(escritorio): WorkAdventure no EasyPanel com login do Entra"
```

---

### Task 6: O mapa de escritório

**Files:**
- Modify: `escritorio/README.md` (seção "Mapa")

**Interfaces:**
- Consumes: `MAP_STORAGE_AUTHENTICATION_TOKEN` (no EasyPanel, Task 5).
- Produces: `office.wam` no `map-storage`, `START_ROOM_URL` apontando para ele.

- [ ] **Step 1: Baixar o starter kit fora do repo e subir o `office` sem modificar**

```bash
d=/tmp/claude-1000/escritorio-mapa && rm -rf $d && mkdir -p $d && cd $d \
  && git clone -q --depth 1 https://github.com/workadventure/map-starter-kit.git . && npm ci --silent
```

`npm run upload` abre a configuração de upload: URL `https://escritorio.healthsafetytech.com/map-storage/`, chave = `MAP_STORAGE_AUTHENTICATION_TOKEN` (o Erick cola, não passa pela sessão), diretório `/`. Subir só o `office.tmj`.

- [ ] **Step 2: Conferir e apontar a entrada**

```bash
curl -s -m 10 https://escritorio.healthsafetytech.com/map-storage/ -o /dev/null -w '%{http_code}\n'
```

No EasyPanel, `START_ROOM_URL` = o caminho que o map-storage listou para o office (o padrão é `/~/office.wam`; usar o que aparecer). Redeploy. Abrir `https://escritorio.healthsafetytech.com` → depois do login da Microsoft, o avatar nasce no escritório.

- [ ] **Step 3: Ajustes no editor (o Erick, no navegador)**

Com a conta do Erick (a única no `MAP_EDITOR_ALLOWED_USERS`): salas de reunião como **área de reunião**, uma área com nome por setor (RH, Operações, Vendas…), o logo da HS onde o mapa permitir. Registrar no README, seção "Mapa": quais salas existem e que os ajustes ficam no volume (não no git).

- [ ] **Step 4: Commit**

```bash
git add escritorio/README.md && git commit -m "docs(escritorio): mapa de escritório no ar"
```

---

### Task 7: Backup diário do mapa para o R2

**Files:**
- Create: `escritorio/backup/backup-mapas.sh`, `escritorio/backup/escritorio-backup.service`, `escritorio/backup/escritorio-backup.timer`

**Interfaces:**
- Consumes: nome do volume do `map-storage` criado pelo EasyPanel (descobrir no Step 1); credenciais R2 — as mesmas `R2_*` do backend do HS.OS, que o Erick cola em `/etc/escritorio/backup.env` no host.
- Produces: `s3://hsos-arquivos/escritorio/backups/mapas-AAAA-MM-DD.tar.gz` diário, 30 últimos mantidos.

- [ ] **Step 1: Descobrir o volume**

```bash
ssh root@62.72.11.28 'docker volume ls --format "{{.Name}}" | grep -i map-storage'
```

Anotar o nome exato (ex.: `escritorio_wa_map-storage-data`).

- [ ] **Step 2: `escritorio/backup/backup-mapas.sh`**

```bash
#!/usr/bin/env bash
# Cópia diária dos mapas (volume do map-storage) para o R2. Roda como root na
# VPS, pelo escritorio-backup.timer. Credenciais em /etc/escritorio/backup.env:
#   VOLUME=<nome do volume>  R2_ACCOUNT_ID=  R2_ACCESS_KEY_ID=  R2_SECRET_ACCESS_KEY=  R2_BUCKET=hsos-arquivos
set -euo pipefail
set -a; . /etc/escritorio/backup.env; set +a
dia=$(date +%F)
arq="/tmp/mapas-$dia.tar.gz"
trap 'rm -f "$arq"' EXIT
docker run --rm -v "$VOLUME":/maps:ro -v /tmp:/out alpine:3.20 tar czf "/out/mapas-$dia.tar.gz" -C /maps .
aws() {
  docker run --rm -v /tmp:/tmp -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
    -e AWS_DEFAULT_REGION=auto amazon/aws-cli:2.17.0 --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" "$@"
}
aws s3 cp "$arq" "s3://$R2_BUCKET/escritorio/backups/mapas-$dia.tar.gz" --only-show-errors
# Mantém os 30 mais recentes.
aws s3 ls "s3://$R2_BUCKET/escritorio/backups/" | awk '{print $4}' | sort | head -n -30 \
  | while read -r velho; do [ -n "$velho" ] && aws s3 rm "s3://$R2_BUCKET/escritorio/backups/$velho" --only-show-errors; done
echo "backup ok: mapas-$dia.tar.gz ($(stat -c %s "$arq") bytes)"
```

- [ ] **Step 3: Timer e service**

`escritorio/backup/escritorio-backup.service`:

```ini
[Unit]
Description=Backup dos mapas do escritório para o R2
After=docker.service

[Service]
Type=oneshot
ExecStart=/opt/escritorio/backup/backup-mapas.sh
```

`escritorio/backup/escritorio-backup.timer`:

```ini
[Unit]
Description=Backup diário dos mapas do escritório

[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true

[Install]
WantedBy=timers.target
```

- [ ] **Step 4: Instalar e rodar uma vez (confirmar com o Erick)**

O Erick cria `/etc/escritorio/backup.env` (modo `600`) com `VOLUME` do Step 1 e as `R2_*` do backend — colando no Konsole por `ssh root@62.72.11.28`, sem passar pela sessão. Depois:

```bash
ssh root@62.72.11.28 'mkdir -p /opt/escritorio' && scp -rq escritorio/backup root@62.72.11.28:/opt/escritorio/ \
&& ssh root@62.72.11.28 'chmod +x /opt/escritorio/backup/backup-mapas.sh \
  && install -m 644 /opt/escritorio/backup/escritorio-backup.{service,timer} /etc/systemd/system/ \
  && systemctl daemon-reload && systemctl enable --now escritorio-backup.timer \
  && systemctl start escritorio-backup.service && journalctl -u escritorio-backup.service -n 3 --no-pager'
```

Expected: `backup ok: mapas-<hoje>.tar.gz (<N> bytes)` com N > 0.

- [ ] **Step 5: Teste de restauração (o backup só vale se volta)**

```bash
ssh root@62.72.11.28 'set -a; . /etc/escritorio/backup.env; set +a; d=$(mktemp -d); \
  docker run --rm -v $d:/tmp -e AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" -e AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" -e AWS_DEFAULT_REGION=auto \
    amazon/aws-cli:2.17.0 --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" \
    s3 cp "s3://$R2_BUCKET/escritorio/backups/mapas-$(date +%F).tar.gz" /tmp/r.tgz --only-show-errors \
  && tar tzf $d/r.tgz | grep -c "\.wam$"; rm -rf $d'
```

Expected: ≥ 1 (o `office.wam` está dentro). Registrar no README, seção "Backup", como restaurar (o comando acima + `tar xzf` no volume com o serviço parado).

- [ ] **Step 6: Commit**

```bash
git add escritorio/backup escritorio/README.md && git commit -m "feat(escritorio): backup diário dos mapas no R2"
```

---

### Task 8: Aceite com gente, documentação e merge

**Files:**
- Modify: `escritorio/README.md` (seções "Quando algo falhar", "Aceite"), `CLAUDE.md` (seção curta "Escritório virtual"), `docs/CONTINUAR-AQUI.md`

- [ ] **Step 1: Os cinco critérios, com pessoas** (o Erick conduz; eu registro)

| # | teste | como | passou? |
|---|---|---|---|
| 1 | Erick entra; conta fora do grupo é recusada | uma conta `@healthsafetytech.com` que não está em "HS – Escritório" | |
| 2 | duas pessoas no prédio conversam com vídeo | aproximar avatares | |
| 3 | uma pessoa no **4G do celular** conversa com alguém de dentro | Wi-Fi do celular desligado | |
| 4 | **seis pessoas** numa sala de reunião, com vídeo; HS.OS respondendo durante | monitor do EasyPanel aberto; abrir o HS.OS e mandar uma mensagem durante a chamada | |
| 5 | só o Erick vê o editor de mapa | segunda conta procura o botão do editor | |

Os critérios 3 e 4 **não podem ser trocados por variação do 2**: são os únicos que exercitam Coturn e LiveKit.

- [ ] **Step 2: README final**

Seções que têm que existir em `escritorio/README.md`: "O que roda onde" (tabela da spec), "Validações", "Entra" (com vencimento do secret), "Segredos" (onde mora cada um — EasyPanel, `/etc/escritorio/midia.env`, `/etc/escritorio/backup.env` — sem valores), "Mídia", "Mapa", "Backup", "Quando algo falhar" (tabela da spec), "Atualizar versão" (ler `UPGRADE.md` do WA, trocar `VERSION`, redeploy; LiveKit/Coturn: trocar a tag em `midia/docker-compose.yml`, `scp` + `instalar.sh`), "Aceite" (a tabela do Step 1 preenchida).

- [ ] **Step 3: `CLAUDE.md` e `CONTINUAR-AQUI.md`**

Em `CLAUDE.md`, na lista de estrutura do monorepo, acrescentar `escritorio/` e uma seção curta:

```markdown
### Escritório virtual — WorkAdventure (sub-projeto A, 10/2026)

`escritorio/` não é código do HS.OS: é a config do WorkAdventure em
`escritorio.healthsafetytech.com` (EasyPanel, projeto `escritorio`) e da mídia
(LiveKit + Coturn em rede do host, `escritorio-midia.service`). Operação em
`escritorio/README.md`; spec em `docs/superpowers/specs/2026-10-15-escritorio-virtual-design.md`.

⚠️ **`MAP_EDITOR_ALLOWED_USERS` é ignorada quando existe Admin API.** O
sub-projeto B, ao ligar a Admin API, tem que levar a permissão do editor junto
— senão o editor abre para todos, sem erro.

⚠️ **O Coturn mora na VPS dos bancos.** As linhas `denied-peer-ip` do
`turnserver.conf` são o que impede o relay de virar túnel para dentro; o
`testes/testar-config.sh` exige cada uma.
```

Em `docs/CONTINUAR-AQUI.md`, uma linha no estado atual: sub-projeto A no ar; próximos são B (ligação com o HS.OS) e C (agentes no escritório, começando por sondagem).

- [ ] **Step 4: Testes finais e merge**

```bash
escritorio/testes/testar-config.sh && escritorio/testes/verificar.sh tudo
git add -A && git commit -m "docs(escritorio): aceite do sub-projeto A, README de operação"
git checkout main && git merge --no-ff escritorio-a -m "Merge: escritório virtual — sub-projeto A" && git push && git branch -d escritorio-a
```

Se o serviço do EasyPanel estava apontando para a branch `escritorio-a` durante o piloto, trocar para `main` e redeploy.
