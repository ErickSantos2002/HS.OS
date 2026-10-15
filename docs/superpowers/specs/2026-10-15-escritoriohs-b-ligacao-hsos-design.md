# EscritorioHS B — ligação com o HS.OS

**Data:** 15/10/2026 · **Status:** decidido pelo recomendado (o Erick pediu para
não perguntar: "pode seguir o recomendado na parte de spec e plano").
**Depende de:** sub-projeto A e o mapa próprio, os dois no ar.

## O que o Erick pediu: os cinco

1. Entrar no escritório a partir do HS.OS.
2. Ver no HS.OS quem está no escritório agora.
3. Integrar o status do perfil do HS.OS (`use-user-status`).
4. **Admin API**: o WorkAdventure pergunta ao HS.OS quem entra e quem edita.
5. Dono de cada sala: o nome na placa e o `ownerId` da área pessoal.

## Fatos do WA v1.33.11 que moldam o desenho

Levantados no código-fonte da tag `v1.33.11`, com caminho e linha no
levantamento desta sessão. Só o que muda decisão:

- **Com `ADMIN_API_URL` no `play`, três variáveis deixam de valer:**
  `START_ROOM_URL`, `MAP_EDITOR_ALLOWED_USERS` e as tags do OpenID. O
  redirecionamento da raiz e a permissão do editor passam a ser nossos.
- **`GET /api/capabilities` não pode falhar.** O play repete a chamada a cada
  500 ms até ter sucesso e só depois sobe. O HS.OS fora do ar no boot = escritório
  fora do ar. Mitigação: a rota não toca o banco e devolve `{}`.
- **O `Authorization` vem cru**, sem `Bearer`. `/api/capabilities` vem sem cabeçalho.
- **São três obrigatórias:** `capabilities`, `map` e `room/access`. As outras são
  sob demanda e um 404 só quebra o recurso delas.
- **`userIdentifier` = claim `email` do Entra** (o `sub`, se não houver e-mail).
  O `userUuid` que nós devolvemos vira o id da pessoa no WA inteiro: no
  `ownerId` da área pessoal, no `WA.player.uuid` e nos eventos de presença.
- **Editar o mapa = `canEdit` da `room/access`.** Tag nenhuma dá edição.
- **Devolver `username: null` apaga o nome do Entra.** A chave tem que ser omitida.
- **Presença:** o play tem um WebSocket de administração, `/ws/admin/rooms`
  (JWT HS256 com `ADMIN_SOCKETS_TOKEN`, payload `{authorizedRoomIds}`). Ele manda
  quem está na sala ao assinar e depois `MemberJoin`/`MemberLeave`. Não existe
  webhook, e a admin API não é avisada da saída.
- **Status:** o mapa pode escrever o status pela Scripting API
  (`WA.player.setStatus("ONLINE"|"BUSY"|"DO_NOT_DISTURB"|"BACK_IN_A_MOMENT")`),
  mas não consegue ler. O `MemberJoin` também não traz status.
- O script do mapa roda num iframe com origem `null`: a chamada ao HS.OS tem que
  ser GET simples (sem cabeçalho próprio) e a resposta tem que vir com
  `Access-Control-Allow-Origin: *`.
- `ADMIN_API_URL` só no `play`. O `back` sem ela calcula o `wamUrl` sozinho, e
  o `uploader` com ela passaria a exigir `/api/limit/fileSize`. Nos dois
  serviços, menos acoplamento é melhor.

## Decisões

### Identidade

`userUuid = email.lower()`. O HS.OS já casa a conta Microsoft por
`lower(email)` (`auth/sso.py`). É também o que o `LocalAdmin` usava, então nada
do que já existe no ar muda de dono.

### 4. Admin API: quem entra e quem edita

Novo router `backend/app/routers/escritorio_wa.py`, prefixo `/escritorio-wa`.
No WA: `ADMIN_API_URL=https://hsosapi.healthsafetytech.com/escritorio-wa`.

| rota | resposta |
|---|---|
| `GET /api/capabilities` | `{}`, sem autenticação e sem banco |
| `GET /api/map?playUri=` | cópia do `LocalAdmin.fetchMapDetails`: o path `/` redireciona para `ESCRITORIO_SALA_INICIAL` (padrão `/~/hs/hs.wam`); `.tmj` redireciona para `.wam`; `/~/x` monta `wamUrl = ESCRITORIO_MAP_STORAGE_URL/x`; `/_/…/x` monta `mapUrl`; o resto devolve erro `UNSUPPORTED_URL_FORMAT`. Mais `group: null`, `authenticationMandatory: true`, `opidWokaNamePolicy: "force_opid"` |
| `GET /api/room/access` | a regra abaixo |
| `GET /api/members?searchText=` | contas ativas do HS.OS do domínio permitido: `{id: email, name, email}` (máx. 20) |
| `GET /api/members/{id}` | a mesma pessoa, ou 404 |
| `GET /api/room/tags`, `/api/world/tags` | `[]` |
| `GET /api/room/sameWorld` | `[]` |
| `POST /api/report`, `/api/ban`, `/api/room/message/{id}/read` | 204, com log |
| `GET /api/room-api/authorization` | `{success: false, error: "PERMISSION_DENIED"}`, porque não usamos a Room API |

Toda rota, menos `capabilities`, confere
`Authorization == ESCRITORIO_ADMIN_API_TOKEN` com `hmac.compare_digest`. Também
aceita o valor com `Bearer `. Sem o token configurado, responde 503.

**Regra de entrada (`room/access`):**

1. Sem e-mail, ou com domínio fora de `ESCRITORIO_DOMINIOS` (padrão
   `healthsafetytech.com`) → `unauthorized`, "Este escritório é só da Health &
   Safety". **Isso fecha a pendência dos convidados B2B**: hoje eles entram;
   pelo recomendado, deixam de entrar. Para soltar alguém, basta acrescentar o
   domínio na variável.
2. A pessoa tem conta no HS.OS e ela está desativada (`auth.users.is_active =
   false`) → `unauthorized`, "Conta desativada".
3. Senão, entra. **Não exige conta no HS.OS**: a empresa inteira entra no
   escritório e nem todo mundo tem login aqui.
4. `canEdit = email ∈ ESCRITORIO_EDITORES` (lista por vírgula, a mesma pessoa de
   hoje no `MAP_EDITOR_ALLOWED_USERS`). Editor também recebe as tags
   `["admin", "editor"]`. O resto recebe `[]`.
5. O banco caiu → `retry` com `timeToRetry: 10000`. Fecha, mas sem tela de
   "acesso negado" para quem tem direito de entrar.
6. Texturas: cópia de `play/src/pusher/data/woka.json`, e a mesma regra do
   `LocalWokaService.fetchWokaDetails`: algum id desconhecido →
   `isCharacterTexturesValid: false`; lista vazia → `true` e `[]`.
7. Campos fixos: `world: "localWorld"`, `visitCardUrl: null`, `messages: []`,
   `isCompanionTextureValid: true`, `activatedInviteUser: true`,
   `canRecord: false`. **Sem `username`.**
8. `userRoomToken` = JWT HS256 com o `JWT_SECRET`, `aud: "escritorio-sala"`,
   `sub: email`, 12 h. É o passe do script do mapa (item 3), e não serve para mais nada.

### 2. Quem está no escritório agora

`backend/app/escritorio/presenca.py`: uma tarefa no `lifespan`, igual ao
`escuta_banco`, que liga em `wss://escritoriohs.healthsafetytech.com/ws/admin/rooms`.

- O estado em memória é `uuid → {nome, conexões, desde}`, contando conexões
  porque duas abas são dois `MemberJoin`. O snapshot da reconexão zera e refaz o estado.
- **Cada worker do uvicorn tem a própria conexão e o próprio estado.** São dois
  workers e duas conexões, e as duas veem a mesma coisa. Não precisa de tabela
  nem de eleição.
- A cada mudança, `hub.publicar("tabela:escritorio_presenca", …)` no hub local,
  que alcança quem está conectado naquele worker, e esse worker tem o estado
  inteiro. O front assina com `assinarTabela` e, por segurança, também
  consulta de novo a cada 60 s.
- A reconexão usa backoff (2 s → 60 s). Sem `ESCRITORIO_ADMIN_SOCKETS_TOKEN` a
  tarefa não sobe e a rota responde `conectado: false`.
- `GET /escritorio/presenca` (qualquer pessoa logada) →
  `{conectado: bool, pessoas: [{email, nome, user_id, avatar_url, desde}]}`.
  O `user_id` e o `avatar_url` vêm de `profiles` por `lower(email)`, e são `null`
  para quem não tem conta. A lista sai ordenada por nome.

### 1. Entrar a partir do HS.OS

- **`AppSidebar`:** item **"Escritório"** (`Building2`) logo depois de "Chat",
  para os dois papéis. `NavItem` ganha `external?: boolean`, e o item vira
  `<a target="_blank" rel="noopener noreferrer">`.
- **`ChatPage`:** o bloco **"No escritório agora (N)"** no topo da lista de
  DMs, no desktop e no celular, com avatares e nomes e o botão "Entrar".
  Quando `conectado: false`, o bloco mostra só o botão "Entrar".
- A URL é a constante `ESCRITORIO_URL = "https://escritoriohs.healthsafetytech.com"`
  em `frontend/src/lib/escritorio.ts`. Não é segredo.

### 3. Status integrado

- **HS.OS → escritório:** o mapa ganha um script, `escritorio.js`, na
  propriedade `script` do `hs.tmj`. Ao abrir e a cada 60 s, ele chama
  `GET https://hsosapi.healthsafetytech.com/escritorio/meu-status?t=<userRoomToken>`.
  A resposta é `{wa_status, emoji, label}`, com
  `Access-Control-Allow-Origin: *`, e o script aplica
  `WA.player.setStatus(wa_status)`. Ele só aplica **quando o valor muda** em
  relação ao último aplicado, e no primeiro carregamento não aplica `ONLINE`.
  Assim não desfaz o status que a pessoa escolheu dentro do WA.
- O mapeamento fica no backend, em `escritorio/status_wa.py`, puro e testado.
  Ele trabalha pelo `label` dos presets de `frontend/src/lib/user-status.ts`:

  | status do HS.OS | WA |
  |---|---|
  | Em reunião | `BUSY` |
  | Foco / DND | `DO_NOT_DISTURB` |
  | Almoço, Ausente | `BACK_IN_A_MOMENT` |
  | qualquer outro, ou nenhum | `ONLINE` |

  Token inválido ou vencido → 401 com corpo, e o script desiste até a página
  ser recarregada.
- **Escritório → HS.OS:** quem está no escritório aparece com 🏢 ao lado do nome
  na lista de DMs. O dado é o mesmo do item 2. O WA não deixa ler o status
  dele, e por isso a volta é só presença.

### 5. Dono de cada sala

- `planta.json`: cada cômodo de `tipo: "sala"` aceita `"dono": "<e-mail>"`. A
  `"placa"` continua manual (é bloco, gerado em `placas.png`); para pôr o nome
  da pessoa, troca-se a placa.
- O `gerar.py` grava `ownerId = dono.lower()` na `personalAreaPropertyData`, que
  já é `static`.
- **Precedência no `mesclar.py`:** quando a planta tem `dono`, vale a planta.
  Quando não tem (`ownerId` gerado `null`), vale o que está no ar, ou seja, a
  atribuição feita no navegador continua lá. Isso muda a regra atual (hoje o
  ar sempre vence) e o teste tem que provar os dois casos.
- No editor do navegador, o campo "dono" passa a ter autocomplete pela
  `/api/members` do item 4, que hoje responde com erro.
- **Quem é dono de qual sala é dado do Erick:** o código fica pronto e a lista
  vem dele. Nenhuma sala ganha dono inventado.

## Fora do escopo

- Agentes no escritório (sub-projeto C).
- Ler, no HS.OS, o status escolhido dentro do WA: a API pública não permite.
- Convite por link (`/api/login-url`), woka por admin (`api/woka/list`) e
  LiveKit por admin: ficam nas implementações locais do WA.

## Implantação: sem push automático, cada passo de produção confirmado

1. Mesclar as três frentes e fazer push. O deploy do backend e do front é manual.
2. Gerar `ESCRITORIO_ADMIN_API_TOKEN` e `ESCRITORIO_ADMIN_SOCKETS_TOKEN` (para
   arquivo `600`). Montar os dois blocos de env no clipboard: o do **backend do
   HS.OS** e o do **serviço `wa`** (`ADMIN_API_URL`, `ADMIN_API_TOKEN`,
   `ADMIN_SOCKETS_TOKEN`, só no `play`). O Erick cola.
3. Primeiro o backend no ar e conferido por `curl`: `capabilities` 200; `map` e
   `room/access` com o token e sem ele (403).
4. Depois o `wa` com `ADMIN_API_URL`. Conferir que o Erick entra e vê o editor, e
   que outra conta entra sem editor. Rodar `verificar.sh tudo`.
5. Enviar o mapa (script e donos), com ninguém no editor.
6. **Volta atrás:** apagar `ADMIN_API_URL` do `wa` e reimplantar. Tudo volta ao
   `LocalAdmin`, com `MAP_EDITOR_ALLOWED_USERS` e `START_ROOM_URL`, que **não
   são apagadas**.

## Riscos aceitos

- **O HS.OS passa a ser dependência do escritório.** Com o backend fora do
  ar, ninguém entra, e o play nem sobe. Volta atrás: passo 6.
- O token do script vai na query string, então aparece em log de acesso. É
  aceito porque ele só lê o próprio status e vence em 12 h.
