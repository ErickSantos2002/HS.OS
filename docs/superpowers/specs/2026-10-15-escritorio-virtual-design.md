# Escritório virtual (WorkAdventure) — sub-projeto A: no ar — design

**Data:** 2026-10-15 · **Escopo:** pasta nova `escritoriohs/` (Compose, config do
LiveKit e do Coturn, `.env.example`, README de operação), projeto novo
`escritorio` no EasyPanel, LiveKit e Coturn na rede do host da VPS do
EasyPanel (`62.72.11.28`), app novo no Entra. **Nenhuma mudança em
`backend/` ou `frontend/`.**

## Objetivo

Hoje a reunião na HS é só presencial: quem não está na sala fica de fora. A
maioria trabalha no escritório físico, mas falar com alguém do outro lado do
prédio sem levantar já vale a pena. O escritório virtual é o lugar onde dá para
**estar junto** e **entrar numa reunião de onde estiver**.

Não substitui ferramenta nenhuma — não existe canal remoto hoje. Também não
substitui o chat: o HS.OS continua sendo o chat da empresa.

**Sucesso =** numa reunião presencial, quem está fora ou em outra sala entra
pelo escritório e participa com áudio e vídeo; no dia a dia, dá para ver quem
está "no escritório" e chegar perto para conversar.

## Os três sub-projetos — este é o A

| # | Sub-projeto | Entrega |
|---|---|---|
| **A** | **Escritório no ar** (esta spec) | WorkAdventure + LiveKit + Coturn na VPS, login Microsoft, mapa da HS |
| B | Ligação com o HS.OS | entrar a partir do HS.OS, ver quem está no escritório, status, Admin API |
| C | Agentes no escritório | Nina, Bruce e os outros como personagens; começa por uma sondagem |

O B depende do A. O C é o mais incerto e começa por uma sondagem antes da spec.

## Decisões tomadas (15/10/2026)

| decisão | escolha | por quê |
|---|---|---|
| onde hospedar | VPS do EasyPanel (`62.72.11.28`) | 4 CPU, 16 GB (6,6 GB livres), 129 GB de disco livre, CPU quase ociosa |
| login | Microsoft Entra direto (OIDC) | todo mundo que vai usar tem conta `@healthsafetytech.com`; quase sem código |
| mapa | mapa pronto de escritório, ajustado no editor do navegador | no ar rápido; a planta real fica para depois, se fizer falta |
| chat persistente (Matrix) | **não** | o HS.OS é o chat; dois chats dividem a conversa e somam um serviço e um banco |
| montagem | WA no EasyPanel + LiveKit/Coturn na rede do host | tudo dentro da HS; o LiveKit Cloud é o plano B |

**Licença:** AGPL-3 com Commons Clause. Uso interno pode; vender como serviço
não. Modificação no código do WorkAdventure teria que ficar disponível para
quem usa — este sub-projeto não modifica nada, só configura.

## Arquitetura

**Um domínio, roteado por caminho:** `escritoriohs.healthsafetytech.com`. É o
desenho do `contrib/docker/docker-compose.prod.yaml` oficial.

| caminho | serviço | função |
|---|---|---|
| `/` e `/ws/` | `play` | a tela do escritório e o WebSocket de presença |
| `/api` | `back` | salas, bolhas, quem está perto de quem |
| `/map-storage` | `map-storage` | os mapas e o editor no navegador |
| `/uploader` | `uploader` | arquivo solto no mapa |
| (interno) | `redis`, `icon` | estado efêmero e ícone de iframe |

**No EasyPanel**, projeto `escritoriohs`, um serviço **Compose**: `play`, `back`,
`map-storage`, `uploader`, `redis` e `icon`. Domínio e certificado ficam com o
Traefik do EasyPanel — o Traefik do Compose oficial **sai**, senão disputa 80/443
com o do EasyPanel.

**Na rede do host**, fora do Swarm, com `docker compose` gerenciado por
`systemd` (sobe sozinho quando a máquina reinicia): **LiveKit** e **Coturn**.
O LiveKit pede UDP direto no host, e o roteamento do Swarm não entrega isso.

**O que é nosso mora no HS.OS, em `escritoriohs/`**, ao lado de `frontend/` e
`backend/`: o Compose adaptado, `livekit.yaml`, `turnserver.conf`, as units do
`systemd`, o `.env.example` e o `README.md` de operação. Fica no mesmo repo
porque B e C mexem no backend do HS.OS e no escritório ao mesmo tempo. **Os
mapas não ficam no repo** — moram no volume do `map-storage`.

**Fora do A, de propósito:** Matrix/Synapse, gravação (LiveKit Egress), Admin
API (é o B), mapa com a planta real do prédio.

## Login e permissões

**App novo no Entra: "EscritorioHS"** — não o registro do HS.OS. Cada secret
vence numa data e um não derruba o outro; a "atribuição obrigatória" fica só
neste app; dá para revogar o escritório sem tocar no login do HS.OS.

- Redirect URI: `https://escritoriohs.healthsafetytech.com/openid-callback`
- `OPENID_CLIENT_ISSUER=https://login.microsoftonline.com/<tenant>/v2.0` (o
  mesmo tenant do `MS_TENANT_ID` do HS.OS)
- `OPENID_SCOPE=openid email profile`
- `DISABLE_ANONYMOUS=true` — sem login, não entra
- ~~Atribuição obrigatória por grupo~~ — **revisto em 15/10/2026: a empresa
  inteira acessa**, sem grupo; "Assignment required" = No. Quem barra é o app
  ser single-tenant (só contas `@healthsafetytech.com`).

**Nome do avatar: `OPENID_WOKA_NAME_POLICY=force_opid`.** O nome vem da conta
Microsoft e a pessoa não muda. Num escritório de trabalho, saber quem é quem
importa mais que apelido, e é esse nome que o B casa com o HS.OS. O visual do
avatar continua livre.

**Editor de mapa:** `MAP_EDITOR_ALLOW_ALL_USERS=false` e
`MAP_EDITOR_ALLOWED_USERS` só com o e-mail do Erick. Sem isso qualquer pessoa
apaga uma sala.

⚠️ **Aviso para o B:** o WorkAdventure **ignora `MAP_EDITOR_ALLOWED_USERS`
quando existe Admin API** (está no `.env.prod.template` deles). Ao ligar a
Admin API, a permissão de editar mapa tem que ir para lá na mesma entrega —
senão o editor volta aberto para todo mundo, sem erro nenhum.

**Sem Admin API, quem passa pelo Entra entra em qualquer sala.** No A, a porta
é o grupo do Entra; controle por sala é assunto do B.

**Idioma:** `FALLBACK_LOCALE=pt-BR`; `ENABLE_TUTORIAL=true` na primeira entrada.

**Chat:** sem `MATRIX_*`. Sobra o chat efêmero da bolha de proximidade. Na
implementação, conferir se `ENABLE_CHAT` precisa ficar ligado para esse chat de
bolha continuar existindo sem Matrix — e, se o painel de chat aparecer vazio e
inútil, desligá-lo.

## Áudio e vídeo

| situação | caminho da mídia | toca a VPS? |
|---|---|---|
| bolha de até 4 (`MAX_USERS_FOR_WEBRTC=4`) | direto entre navegadores (no prédio, pela rede local) | não |
| bolha ou sala com mais de 4 | **LiveKit** recebe e redistribui | sim |
| alguém em rede restrita (4G, hotel) | relay pelo **Coturn** | sim, só essa pessoa |

**LiveKit** (rede do host):

- `7880` — sinalização (WebSocket), atrás do Traefik do EasyPanel em
  `livekit.healthsafetytech.com` com HTTPS, encaminhado ao host por
  `172.18.0.1:7880` — a mesma bridge que o backend do HS.OS já usa para falar
  com o túnel do OpenClaw.
- `7881/tcp` — recuo para quem tem UDP bloqueado.
- `50000–50100/udp` — mídia. O padrão tem 10 mil portas; 100 sobram para
  dezenas de pessoas.
- `LIVEKIT_API_KEY`/`LIVEKIT_API_SECRET` gerados na instalação; só `back` e
  `play` os conhecem.

**Coturn** (rede do host): `3478` (UDP e TCP), relay em `49160–49200/udp`,
autenticação por **static secret** (`TURN_STATIC_AUTH_SECRET`, credencial com
validade), não usuário e senha fixos. Sem TLS na 5349 no começo — a mídia já
vai cifrada pelo WebRTC; TLS no TURN só ajuda quem está atrás de firewall que
só deixa passar 443, o que não é o caso de quem está em casa.

**Limites de recurso no Compose**, para reunião nunca derrubar o HS.OS:
LiveKit até 2 CPU e 2 GB; Coturn até 0,5 CPU e 256 MB.

**Firewall:** `~/escritoriohs-firewall.sh`, que o Erick roda uma vez no Konsole
com `sudo`, abre só as portas acima.

## Riscos que viram tarefa de validação — antes de qualquer outra coisa

1. **Qual firewall a VPS tem.** ufw, iptables direto, ou um firewall no painel
   do provedor, por fora da máquina. Se o do provedor bloquear UDP e não houver
   como abrir, **cai para o plano B**: LiveKit Cloud (`LIVEKIT_HOST`,
   `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` — três variáveis), e o Coturn fica
   avaliado à parte.
2. **O Traefik do EasyPanel encaminhando para um serviço na rede do host.** Se o
   EasyPanel não aceitar esse alvo, o LiveKit termina o próprio TLS numa porta
   dedicada, com certificado emitido por ele.
3. **O Compose oficial sem o Traefik deles, dentro do EasyPanel.** As rotas por
   caminho (`/api`, `/ws/`, `/map-storage`, `/uploader`) e o gRPC do `room-api`
   têm que ser reproduzidos nos domínios do EasyPanel. O `room-api` só é
   necessário com integração externa — se não for, fica sem rota no A.

## Mapa

- Um dos mapas de escritório que o WorkAdventure oferece, importado no
  `map-storage` e definido em `START_ROOM_URL`.
- No editor do navegador: salas de reunião como **área de reunião** (quem entra
  fica na mesma chamada, sem depender de chegar perto), uma área por setor com
  nome, o logo e as cores da HS onde o mapa permitir.
- O mapa evolui pela tela, sem deploy.

## Dados, backup e versão

- Mapas no volume do `map-storage`, uploads no do `uploader`. Não há banco; o
  `redis` é estado efêmero.
- **Cópia diária do volume do `map-storage` para o R2** (o mesmo do HS.OS), no
  prefixo `escritoriohs/backups/` — o trabalho de editar o mapa não se perde.
- `VERSION` fixa numa tag estável do WorkAdventure, **nunca `latest`**:
  atualização sozinha num serviço de vídeo quebra reunião sem aviso. Atualizar
  é decisão manual: ler o `UPGRADE.md` deles, trocar a tag, fazer o deploy.
- Os segredos (`SECRET_KEY`, `MAP_STORAGE_API_TOKEN`, `ROOM_API_SECRET_KEY`,
  LiveKit, Coturn, OIDC) vão para o EasyPanel e para o `.env` do host; no repo
  só o `.env.example`. **O repo é público.**

## Quando algo falhar

| falha | o que a pessoa vê | onde olhar |
|---|---|---|
| LiveKit fora | sala com mais de 4 sem vídeo; bolhas de até 4 seguem | `systemctl status livekit` |
| Coturn fora | só quem está em rede restrita perde vídeo | `systemctl status coturn` |
| Entra recusa | não entra; erro da Microsoft | grupo do app; secret vencido |
| `play` fora | o escritório não abre; o HS.OS segue normal | logs do serviço no EasyPanel |

Essa tabela, os comandos e onde ficam os logs vão para `escritoriohs/README.md`.

## Critérios de aceite

1. O Erick entra com a conta Microsoft; uma conta **de fora do
   `healthsafetytech.com`** é recusada (revisto em 15/10/2026: sem grupo).
2. Duas pessoas no prédio se aproximam e conversam com áudio e vídeo.
3. Uma pessoa **fora da rede da HS** (4G do celular) conversa com alguém de
   dentro — exercita o Coturn.
4. **Seis pessoas** numa sala de reunião, com vídeo — exercita o LiveKit.
   Durante a chamada, o monitor do EasyPanel mostra CPU e memória, e o HS.OS
   responde normalmente.
5. Só o Erick vê o editor de mapa.

⚠️ Os critérios 3 e 4 são os que **não passam por acaso**: duas pessoas na
mesma rede conversam mesmo com LiveKit e Coturn quebrados. Aceitar o A só
pelo critério 2 seria a âncora que exercita a coisa errada.

## Implantação

Primeiro o Erick e duas ou três pessoas por alguns dias; depois a empresa
toda, com uma mensagem curta sobre como entrar.
