# Escritório virtual (WorkAdventure)

Spec: `docs/superpowers/specs/2026-10-15-escritorio-virtual-design.md`.
Plano: `docs/superpowers/plans/2026-10-15-escritorio-virtual-a.md`.

**EscritorioHS** é o escritório virtual da HS: WorkAdventure em
`https://escritoriohs.healthsafetytech.com`, login com a conta Microsoft da
empresa. Esta pasta não é código do HS.OS — é a config do que roda na VPS.

## O que roda onde

| peça | onde | como sobe |
|---|---|---|
| `borda` (nginx), `play`, `back`, `map-storage`, `uploader`, `icon`, `redis` | EasyPanel, projeto `escritoriohs`, serviço Compose `wa` (fonte: este repo, pasta `/escritoriohs`) | deploy no EasyPanel |
| LiveKit (vídeo acima de 4 pessoas) | VPS, rede do host, `/opt/escritoriohs/midia` | `escritoriohs-midia.service` |
| Coturn (relay para rede restrita) | idem | idem |
| backup dos mapas | VPS, `/opt/escritoriohs/backup` → R2 | `escritoriohs-backup.timer` |

Domínios (os dois para a `borda`, porta 80): `escritoriohs.healthsafetytech.com`
e `livekit.healthsafetytech.com`. VPS: `62.72.11.28` (Hostinger, `srv815732`).

## Segredos — onde mora cada um (nenhum no git)

| segredo | onde |
|---|---|
| `OPENID_CLIENT_SECRET` (+ client id) | EasyPanel → `escritoriohs/wa` → Environment |
| `SECRET_KEY`, `MAP_STORAGE_API_TOKEN`, `MAP_STORAGE_AUTHENTICATION_TOKEN`, `ROOM_API_SECRET_KEY` | idem (gerados uma vez) |
| `LIVEKIT_API_KEY/SECRET`, `TURN_STATIC_AUTH_SECRET` | `/etc/escritoriohs/midia.env` na VPS **e** copiados no EasyPanel — trocar num lugar exige trocar no outro |
| credenciais do R2 do backup | `/etc/escritoriohs/backup.env` na VPS |
| `ADMIN_API_TOKEN`, `ADMIN_SOCKETS_TOKEN` (sub-projeto B) | EasyPanel → `escritoriohs/wa` (só o `play`) **e** no backend do HS.OS como `ESCRITORIO_ADMIN_API_TOKEN` / `ESCRITORIO_ADMIN_SOCKETS_TOKEN` — mesmo valor nos dois |

## Quando algo falhar

| falha | o que a pessoa vê | onde olhar |
|---|---|---|
| LiveKit fora | sala com mais de 4 sem vídeo; bolhas de até 4 seguem | `systemctl status escritoriohs-midia`, `docker logs midia-livekit-1` |
| Coturn fora | só quem está em rede restrita (4G, hotel) perde vídeo | `docker logs midia-coturn-1` |
| UDP bloqueado | ninguém de fora tem vídeo | firewall do **hPanel** (não o da máquina) — ver Validações |
| Microsoft recusa | não entra; erro `AADSTS…` | secret vencido (≈ 15/10/2028); app no Entra |
| `play` fora | o escritório não abre; o HS.OS segue normal | logs do serviço `wa` no EasyPanel |
| backend do HS.OS fora (com `ADMIN_API_URL`) | **ninguém entra**; o `play` nem sobe | `verificar.sh admin`; volta atrás em "Admin API" |

Conferência geral, de qualquer máquina: `escritoriohs/testes/verificar.sh tudo`.
Antes de commitar mudança de config: `escritoriohs/testes/testar-config.sh`.

## Atualizar versão

- **WorkAdventure:** ler o `UPGRADE.md` deles entre a versão atual e a nova,
  trocar `VERSION` no Environment do EasyPanel (e no `.env.example`), deploy,
  `verificar.sh tudo`. Nunca `latest`.
- **LiveKit/Coturn:** trocar a tag em `midia/docker-compose.yml` (e no
  `testar-config.sh`, que exige a versão), `scp` para `/opt/escritoriohs/midia/`,
  `docker compose pull && docker compose up -d` lá.

## Aceite (sub-projeto A)

| # | teste | estado |
|---|---|---|
| 1 | Erick entra; conta de fora do diretório da HS é recusada (e decidir sobre convidados B2B) | ✅ entrada (15/10) · ⏳ recusa a testar |
| 2 | duas pessoas no prédio conversam com vídeo | ✅ 15/10 — Erick, Welton e Rickelme numa bolha |
| 3 | alguém no **4G** conversa com alguém de dentro (exercita o Coturn) | ⏳ |
| 4 | **seis pessoas** numa sala com vídeo; HS.OS respondendo durante | ✅ servidor (carga 6×6 de fora: 36/36 trilhas, 0,29% perda) · ⏳ com pessoas |
| 5 | só o Erick vê o editor de mapa | ⏳ perguntar a outra conta se vê o botão "Mapa" |
| — | chat da bolha sem Matrix | ⏳ |

## Validações de 15/10/2026

| pergunta | resposta | como foi medido |
|---|---|---|
| UDP 50000–50100, 3478, 49160–49200 chegam de fora? | **sim, depois de abrir no firewall da Hostinger** | `tcpdump -ni eth0` na VPS, pacotes da rede da HS e da VPS do OpenClaw |
| TCP 7881 e 3478 chegam de fora? | sim (regras `Any` no firewall da Hostinger) | idem |
| Domínio do EasyPanel → serviço Compose? | sim | `curl https://escritoriohs.healthsafetytech.com/` devolveu `borda-ok` |
| Container do Compose → host? | sim, por `172.18.0.1` **e** por `host-gateway` | `curl` em `/host/` e `/gw/` devolveram `host-ok` |

⚠️ **O firewall que importa é o do painel da Hostinger, não o da máquina.** Na
VPS o `ufw` está inativo e o `INPUT` é `ACCEPT`; quem bloqueava o UDP era o
firewall do hPanel (VPS → Segurança → Firewall), que termina em `Drop Any`.
O `tcpdump` não via o pacote chegar na `eth0` — é assim que se distingue.

⚠️ **Testar porta a partir do escritório engana.** O firewall da Hostinger
tem regras próprias para alguns IPs da empresa, e um teste que sai de um deles
passa onde quem está em casa ou no 4G seria bloqueado. Conferir porta sempre de
um IP de fora, ou pela regra no painel.

Regras de entrada abertas para o escritório (fonte `Any`), acima do `Drop`:

| protocolo | porta | para quê |
|---|---|---|
| UDP | 50000:50100 | mídia do LiveKit |
| UDP | 3478 | Coturn |
| TCP | 3478 | Coturn, recuo |
| UDP | 49160:49999 | relay do Coturn (840 portas — ver abaixo) |
| TCP | 7881 | LiveKit, recuo |

⚠️ **`createComposeService` do MCP do EasyPanel com `source` e `domains` na
mesma chamada falha** (`ENOENT … docker-compose.override.yml`) e deixa o serviço
criado pela metade, com o domínio já reservado. O que funciona: criar, depois
`updateComposeSourceInline` (ou `updateComposeSourceGit`) e
`deployComposeService` — os dois exigem `execute_destructive`.

## Mídia — LiveKit e Coturn (rede do host)

| o quê | onde |
|---|---|
| arquivos | `/opt/escritoriohs/midia/` (cópia de `escritoriohs/midia/`) |
| segredos | `/etc/escritoriohs/midia.env` (root, `600`) — `LIVEKIT_KEYS`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_STATIC_AUTH_SECRET` |
| serviço | `systemctl status escritoriohs-midia` |
| logs | `docker logs -f midia-livekit-1` · `docker logs -f midia-coturn-1` |

Atualizar config: editar em `escritoriohs/midia/`, `scp` para `/opt/escritoriohs/midia/`
e `docker compose up -d --force-recreate` lá. **Trocar os segredos:** apagar o
`midia.env` e rodar `instalar.sh` — e repor `LIVEKIT_API_*` e
`TURN_STATIC_AUTH_SECRET` no EasyPanel, senão o WA para de falar com os dois.

Onde cada porta escuta (conferido com `ss` em 15/10/2026):

| porta | escuta em | por quê |
|---|---|---|
| 7880/tcp (API LiveKit) | `127.0.0.1`, `172.18.0.1` | só a `borda` (pela bridge) e o loopback |
| 7881/tcp, 50000–50100/udp | todas | mídia de quem está fora |
| 3478 (Coturn) | `62.72.11.28` | `listening-ip`/`relay-ip`: sem eles o relay saía pelas bridges do Docker |

⚠️ **O `instalar.sh` gravou `LIVEKIT_KEYS` sem aspas na primeira versão.** O
Docker lê certo, mas `. midia.env` executava o segredo como comando e o
imprimia no erro. Corrigido (aspas) e os segredos foram regerados.

⚠️ **Carga de 6×6 rodada DENTRO da VPS é inconclusiva.** O `lk load-test`
gerando 6 câmeras e 6 espectadores no mesmo host disputa CPU com o LiveKit:
deu 150–196% de CPU no LiveKit (teto de 2), 5,8% de perda e 26/36 trilhas. O
número que vale é o da carga vinda de fora, pelo domínio:

| carga 6×6 por 60 s (15/10/2026) | dentro da VPS | **de fora, por `wss://livekit…`** |
|---|---|---|
| trilhas recebidas | 26/36 | **36/36** |
| perda de pacotes | 5,8% | **0,29%** |
| CPU do LiveKit | 150–196% | **pico de 123% ao conectar; 20–37% em regime** |

⚠️ **Reunião de 28 com 20 câmeras NÃO cabe nesta VPS** (medido em 16/10/2026,
de fora, `lk load-test --layout 5x5 --video-resolution medium`, 60 s):

| carga | trilhas | perda | CPU do LiveKit (teto 200%) |
|---|---|---|---|
| 20 câmeras + 8 áudio, 8 assistindo | 224/224 | 0,13% | média 154% · pico 174% |
| 20 câmeras + 8 áudio, 28 assistindo | 756/784 | 0,05% | **média 185% · pico 257%** |

A qualidade segurou, mas no teto, e **depois da carga o LiveKit ficou preso em
~150% de CPU sem sala nenhuma** e com a memória subindo — 2 dos 4 núcleos da
VPS dos bancos. O teste só de áudio rodado em seguida não vale (pegou o
servidor ocupado). Banda não é o gargalo: ~3,3 Mbps por pessoa, ~90 Mbps de
saída. **Decisão do Erick:** LiveKit em VPS própria só se o escritório for
adiante; até lá, reunião grande é com câmera desligada.

⚠️ **Faixa de relay do Coturn: 840 portas, não 41.** Com TURN configurado, o
navegador reserva relay para **cada conexão da bolha**, em UDP e em TCP, mesmo
quando não vai precisar — e cada reserva prende uma porta por até 10 min. A
faixa inicial (49160–49200) esgotou com três testes (`error 508`, 15/10/2026).
O `verificar.sh` acusa "ESGOTADA" se voltar a acontecer.

## WorkAdventure no EasyPanel

Projeto `escritoriohs`, serviço Compose `wa`, fonte Git (pasta `/escritoriohs`).
As variáveis vão pela aba Environment com **"Create .env file"** — o Compose lê
dali `VERSION`, `DOMAIN` e os segredos. Domínios: `escritoriohs.healthsafetytech.com`
e `livekit.healthsafetytech.com`, os dois para o serviço `borda`, porta 80.

Conferência: `escritoriohs/testes/verificar.sh tudo`.

⚠️ **A tela é SPA: `/login` responde 200 e não redireciona.** Quem manda para o
Entra é o `/login-screen?playUri=<sala>`. É o que o `verificar.sh` testa, junto
com a `redirect_uri` exata registrada no app.

⚠️ **O Traefik do EasyPanel responde `101 Switching Protocols` mesmo sem serviço
atrás.** Teste de WebSocket que só olha o 101 passa com tudo desligado.

O `play` loga `MatrixProvider … Invalid URL` sem Matrix configurado — é ruído
do WA, não erro nosso.

⚠️ **Deploy do `wa` NÃO recarrega o `borda/nginx.conf`.** O Compose só recria
o container cujo serviço mudou; a `borda` fica de pé com o arquivo montado
antigo (o git troca o arquivo, e o bind mount continua no inode velho). Depois
de mexer no nginx: `docker restart escritoriohs_wa-borda-1` na VPS e conferir
com `docker exec escritoriohs_wa-borda-1 grep <linha nova> /etc/nginx/conf.d/default.conf`.

⚠️ **"Service is not reachable" logo depois do login Microsoft** (URL
`/openid-callback?code=…`) era o nginx recusando o cabeçalho grande da resposta
do play (`upstream sent too big header` no log da `borda`) → 502, que o Traefik
troca por essa tela. Metade dos logins falhava. Corrigido em 15/10/2026 com
`proxy_buffer_size 64k` (o `testar-config.sh` exige).

## Entra — app EscritorioHS

- App registration **EscritorioHS**, contas só deste diretório, redirect URI
  `https://escritoriohs.healthsafetytech.com/openid-callback`.
- **Sem grupo, por decisão (15/10/2026): a empresa inteira acessa.** Quem barra
  é o app ser single-tenant: só entra quem existe no diretório da HS. ⚠️ Isso
  inclui **convidados (B2B)** — gente de fora convidada para um Teams ou
  SharePoint da HS — e contas de serviço/caixas compartilhadas habilitadas. Se
  o diretório tiver convidados e eles não devem entrar, o caminho é
  "Assignment required = Yes" com um grupo dinâmico só de membros. Por isso **"Assignment required" fica em No**: em Yes, sem
  ninguém atribuído, a Microsoft recusaria todo mundo.
- Client secret com a validade máxima do portal (24 meses → **vence por volta de
  15/10/2028**). Quando vencer, ninguém entra e o erro é da Microsoft: gerar outro
  secret no portal e trocar `OPENID_CLIENT_SECRET` no EasyPanel.

## Admin API (sub-projeto B)

Spec: `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md`.
Com `ADMIN_API_URL` no `play`, o WA pergunta ao backend do HS.OS
(`backend/app/routers/escritorio_wa.py`) quem entra, quem edita e para onde a
raiz redireciona.

**Variáveis** (nomes; valores só no EasyPanel):

| onde | variável | valor |
|---|---|---|
| `wa` → só o `play` | `ADMIN_API_URL` | `https://hsosapi.healthsafetytech.com/escritorio-wa` |
| `wa` → só o `play` | `ADMIN_API_TOKEN`, `ADMIN_SOCKETS_TOKEN` | `openssl rand -hex 32`, um para cada |
| backend do HS.OS | `ESCRITORIO_ADMIN_API_TOKEN`, `ESCRITORIO_ADMIN_SOCKETS_TOKEN` | os mesmos dois valores |
| backend do HS.OS | `ESCRITORIO_EDITORES` | e-mails por vírgula (o que hoje está em `MAP_EDITOR_ALLOWED_USERS`) |
| backend do HS.OS | `ESCRITORIO_DOMINIOS`, `ESCRITORIO_SALA_INICIAL` | padrões: `healthsafetytech.com`, `/~/hs/hs.wam` |

Só no `play`: no `back` ela o faria pedir o mapa ao HS.OS em vez de calcular
sozinho, e no `uploader` passaria a exigir `/api/limit/fileSize`, que não
implementamos. O `testar-config.sh` confere. Vazia, o WA usa as implementações
locais (o validador dele aceita `""`).

**Regra de entrada:** e-mail de domínio fora de `ESCRITORIO_DOMINIOS` (inclusive
convidado B2B) é recusado; conta do HS.OS desativada é recusada; o resto entra,
**mesmo sem conta no HS.OS**. Edita o mapa quem está em `ESCRITORIO_EDITORES`.
HS.OS sem banco → tela de "tente de novo", não de acesso negado.

⚠️ **Com `ADMIN_API_URL` preenchida, `MAP_EDITOR_ALLOWED_USERS` e
`START_ROOM_URL` ficam sem efeito** — continuam no compose de propósito.

⚠️ **O escritório passa a depender do HS.OS.** O `play` repete
`/api/capabilities` a cada 500 ms e só sobe quando ela responde. Ela não toca
banco, mas com o backend fora ninguém entra.

**Volta atrás:** esvaziar `ADMIN_API_URL` no EasyPanel e reimplantar o `wa`.
Tudo volta ao comportamento local, com `MAP_EDITOR_ALLOWED_USERS` e `START_ROOM_URL`.

**Presença:** o backend do HS.OS assina `wss://escritoriohs.healthsafetytech.com/ws/admin/rooms`
(JWT com `ADMIN_SOCKETS_TOKEN`) e expõe `GET /escritorio/presenca`. Sem o token,
a presença fica desligada e o resto funciona.

Conferência: `escritoriohs/testes/verificar.sh admin` (`capabilities` 200 `{}`
sem token; `map` sem token 403).

## Mapa

**Entrada: o mapa `hs`, gerado por código** (`escritoriohs/mapa/`, ver o README
de lá): planta desenhada pelo Erick, 28 salas individuais trancáveis, 2 salas
de reunião LiveKit, recepção com o logo, café, silenciosa e Diretoria.
`START_ROOM_URL=/~/hs/hs.wam` desde 15/10/2026. O `office` do starter kit
continua em `/~/office.wam` como plano de volta.

Link para mandar às pessoas: **https://escritoriohs.healthsafetytech.com**.

Aceite do mapa (15/10/2026): paredes e móveis colidem ✅ · editor grava
(`saving map hs/hs.wam` no log do map-storage) ✅ · tranca com 2 pessoas ⏳ ·
3 na Reunião 01 na mesma chamada ⏳ · silenciosa ⏳.

## Backup dos mapas

`escritoriohs-backup.timer` roda `/opt/escritoriohs/backup/backup-mapas.sh` todo dia
às 03:30 UTC (00:30 de Brasília): tar do volume `escritoriohs_wa_map-storage-data`
para `s3://hsos-arquivos/escritoriohs/backups/mapas-AAAA-MM-DD.tar.gz` no R2,
mantendo os 30 mais recentes. Credenciais em `/etc/escritoriohs/backup.env` (600),
gravadas por um script que lê as `R2_*` do backend do HS.OS sem imprimir.

```bash
systemctl list-timers escritoriohs-backup.timer      # próxima execução
journalctl -u escritoriohs-backup.service -n 5       # "backup ok: … (N bytes)"
```

**Restaurar** (conferido em 15/10/2026: o `office.wam` baixado do R2 é idêntico
ao do volume): baixar o `.tar.gz` com o `aws-cli` (mesmo `docker run` do
script), parar o serviço `wa` no EasyPanel, extrair no volume
(`docker run --rm -v escritoriohs_wa_map-storage-data:/maps -v <dir>:/r alpine tar xzf /r/<arquivo> -C /maps`)
e subir o serviço de novo.

⚠️ **O backup usa o mesmo token do R2 do backend do HS.OS**, que alcança o
bucket `hsos-arquivos` inteiro. A exposição não aumenta — o backend roda nesta
mesma VPS com o mesmo token —, mas o certo é um token próprio, limitado ao
prefixo `escritoriohs/backups/` ou a um bucket separado. Pendente: criar no
painel da Cloudflare e trocar em `/etc/escritoriohs/backup.env`.
