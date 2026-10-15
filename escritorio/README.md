# Escritório virtual (WorkAdventure)

Spec: `docs/superpowers/specs/2026-10-15-escritorio-virtual-design.md`.
Plano: `docs/superpowers/plans/2026-10-15-escritorio-virtual-a.md`.

## Validações de 15/10/2026

| pergunta | resposta | como foi medido |
|---|---|---|
| UDP 50000–50100, 3478, 49160–49200 chegam de fora? | **sim, depois de abrir no firewall da Hostinger** | `tcpdump -ni eth0` na VPS, pacotes da rede da HS e da VPS do OpenClaw |
| TCP 7881 e 3478 chegam de fora? | sim (regras `Any` no firewall da Hostinger) | idem |
| Domínio do EasyPanel → serviço Compose? | sim | `curl https://escritorio.healthsafetytech.com/` devolveu `borda-ok` |
| Container do Compose → host? | sim, por `172.18.0.1` **e** por `host-gateway` | `curl` em `/host/` e `/gw/` devolveram `host-ok` |

⚠️ **O firewall que importa é o do painel da Hostinger, não o da máquina.** Na
VPS o `ufw` está inativo e o `INPUT` é `ACCEPT`; quem bloqueava o UDP era o
firewall do hPanel (VPS → Segurança → Firewall), que termina em `Drop Any`.
O `tcpdump` não via o pacote chegar na `eth0` — é assim que se distingue.

⚠️ **Testar porta a partir do escritório engana.** O firewall da Hostinger
libera **todo o TCP** para quatro IPs, e o do escritório (`187.21.12.34`) é um
deles: o TCP 7881 "passou" no primeiro teste só por isso. Para quem está em
casa ou no 4G ele estava fechado. Conferir porta sempre de um IP fora dessa
lista, ou pela regra no painel.

Regras de entrada abertas para o escritório (fonte `Any`), acima do `Drop`:

| protocolo | porta | para quê |
|---|---|---|
| UDP | 50000:50100 | mídia do LiveKit |
| UDP | 3478 | Coturn |
| TCP | 3478 | Coturn, recuo |
| UDP | 49160:49200 | relay do Coturn |
| TCP | 7881 | LiveKit, recuo |

⚠️ **`createComposeService` do MCP do EasyPanel com `source` e `domains` na
mesma chamada falha** (`ENOENT … docker-compose.override.yml`) e deixa o serviço
criado pela metade, com o domínio já reservado. O que funciona: criar, depois
`updateComposeSourceInline` (ou `updateComposeSourceGit`) e
`deployComposeService` — os dois exigem `execute_destructive`.

## Mídia — LiveKit e Coturn (rede do host)

| o quê | onde |
|---|---|
| arquivos | `/opt/escritorio/midia/` (cópia de `escritorio/midia/`) |
| segredos | `/etc/escritorio/midia.env` (root, `600`) — `LIVEKIT_KEYS`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `TURN_STATIC_AUTH_SECRET` |
| serviço | `systemctl status escritorio-midia` |
| logs | `docker logs -f midia-livekit-1` · `docker logs -f midia-coturn-1` |

Atualizar config: editar em `escritorio/midia/`, `scp` para `/opt/escritorio/midia/`
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
número que vale é o da carga vinda de fora, pelo domínio.
