# EscritorioHS B — ligação com o HS.OS: plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** os cinco itens do B: entrar pelo HS.OS, ver quem está no escritório, status integrado, Admin API e dono de cada sala.

**Architecture:** o backend do HS.OS ganha a Admin API do WorkAdventure (`/escritorio-wa/api/*`) e um vigia de presença ligado ao WebSocket de administração do play. O front consome `GET /escritorio/presenca`. O mapa ganha um script que puxa o status do HS.OS e donos de sala vindos da planta.

**Tech Stack:** FastAPI, asyncpg, PyJWT, `websockets` (já no `requirements.txt`), React + React Query, Python do gerador do mapa, Scripting API do WA.

**Spec:** `docs/superpowers/specs/2026-10-15-escritoriohs-b-ligacao-hsos-design.md` (é a autoridade; leia inteira antes de começar).

**Código-fonte do WA v1.33.11 para consulta (só leitura):**
`/tmp/claude-1000/-home-ericks-github-HS-OS/5ecd6acd-7ad3-4ce3-ab89-35542f04fb2b/scratchpad/wa-src`.
Arquivos citados abaixo são relativos a essa pasta (`<WA>`).

## Três frentes, três agentes, três branches

Os arquivos não se cruzam. As frentes rodam em paralelo, cada uma em worktree própria:

| frente | branch | mexe em |
|---|---|---|
| **B — backend** | `escritorio-b-backend` | `backend/app/escritorio/`, `backend/app/routers/escritorio_wa.py`, `backend/app/routers/escritorio.py`, `backend/app/main.py`, `backend/app/config.py`, `backend/.env.example`, `backend/tests/test_escritorio_*.py`, `escritoriohs/docker-compose.yml`, `escritoriohs/testes/`, `escritoriohs/README.md` |
| **F — front** | `escritorio-b-front` | `frontend/src/lib/escritorio.ts`, `frontend/src/hooks/use-escritorio-presenca.ts`, `frontend/src/components/escritorio/`, `frontend/src/components/AppSidebar.tsx`, `frontend/src/pages/ChatPage.tsx` |
| **M — mapa** | `escritorio-b-mapa` | `escritoriohs/mapa/` (exceto `publicados.json` e `saida/`) |

**Contratos entre as frentes** (não mude sem mudar nas duas pontas):

```
GET /escritorio/presenca   (Bearer do HS.OS, qualquer papel)
→ 200 {"conectado": bool,
       "pessoas": [{"email": str, "nome": str, "user_id": str|null,
                    "avatar_url": str|null, "desde": "ISO-8601"}]}

GET /escritorio/meu-status?t=<userRoomToken>   (público, sem cabeçalho próprio)
→ 200 {"wa_status": "ONLINE"|"BUSY"|"DO_NOT_DISTURB"|"BACK_IN_A_MOMENT",
       "emoji": str|null, "label": str|null}
   com cabeçalho Access-Control-Allow-Origin: *
→ 401 {"detail": "..."} (token ausente, inválido ou vencido), também com ACAO *

Evento de tempo real: hub.publicar("tabela:escritorio_presenca", <tipo>, <dados>)
no formato que `assinarTabela("escritorio_presenca", cb)` do front já entende
(confira o formato em backend/app/escuta_banco.py e frontend/src/lib/realtime.ts).
```

## Global Constraints

- Código, comentários, testes e mensagens em **português**. Testes com docstring dizendo o que o teste tranca (padrão do repo).
- Repo público: **nenhum segredo no git**, só nomes em `.env.example`.
- Toda variável nova do backend **declarada em `Settings`** (`config.py`), senão o boot cai; segredo lido por `ler_segredo("NOME")`.
- Nunca `git add -f`; nunca commitar `.venv`, `saida/`, `publicados.json`.
- Fim de cada frente: todos os testes da suíte da frente verdes, commit na branch. **Não fazer merge nem push**: quem mescla é a sessão principal.
- Nada de ação em produção (EasyPanel, VPS, envio do mapa): fica para a sessão principal.
- Backend: `cd backend && ./.venv/bin/python -m pytest tests -q` (se não houver `.venv` no worktree, crie: `python3 -m venv .venv && .venv/bin/pip install -r requirements.txt -r requirements-dev.txt`).
- Front: `cd frontend && npm test` e `npx tsc --noEmit -p tsconfig.app.json` (se não houver `node_modules` no worktree: `npm ci`).
- Mapa: `cd escritoriohs/mapa && <python com pytest e pillow> -m pytest testes -q`. A `.venv` do mapa não vai para o worktree; crie uma ali (`python3 -m venv .venv && .venv/bin/pip install pytest==8.3.3 pillow==12.3.0`). Ela é ignorada pelo git.

## Review Focus

- `username: null` na `room/access` apaga o nome do Entra: a chave **não** pode aparecer.
- Domínio comparado sem diferenciar maiúsculas (`Fulano@HealthSafetyTech.com` entra) e e-mail sem `@` recusado sem exceção.
- Token do script com `aud` errado (o JWT de login do HS.OS) recusado; e o de login do HS.OS não pode aceitar o do script (`ler_token` sem `aud` recusa quem tem `aud`? confira e teste).
- Duas abas = dois `MemberJoin`; fechar uma não tira a pessoa da lista.
- `mesclar.py`: planta com `dono` vence o ar; planta sem `dono` preserva o ar.

---

## FRENTE B — backend

### Task B1: regras puras da Admin API

**Files:**
- Create: `backend/app/escritorio/__init__.py` (vazio), `backend/app/escritorio/wa.py`, `backend/app/escritorio/wokas.json`
- Test: `backend/tests/test_escritorio_wa.py`

**Interfaces — Produces:**
```python
def normalizar_email(valor: str | None) -> str | None   # strip+lower; None se sem "@"
def dominio_permitido(email: str, dominios: list[str]) -> bool
def lista_de_config(valor: str | None) -> list[str]     # "a, B ,," → ["a","b"]
def detalhes_do_mapa(play_uri: str, map_storage_url: str, sala_inicial: str) -> dict
def resolver_texturas(ids: list[str]) -> tuple[bool, list[dict]]
def recusa(code: str, titulo: str, subtitulo: str, detalhes: str) -> dict   # type "unauthorized"
def espera(code: str, titulo: str, subtitulo: str, detalhes: str, ms: int = 10000) -> dict  # type "retry"
def resposta_de_acesso(email: str, *, editor: bool, texturas: tuple[bool, list[dict]],
                       token_sala: str) -> dict
```

- [ ] **Step 1:** Copie `<WA>/play/src/pusher/data/woka.json` para `backend/app/escritorio/wokas.json` e leia `<WA>/play/src/pusher/services/LocalWokaService.ts:36-73` para a regra.
- [ ] **Step 2: testes que falham.** Em `test_escritorio_wa.py`, um teste por linha:
  - `normalizar_email(" Fulano@HS.com ")` → `"fulano@hs.com"`; `None`, `""`, `"semarroba"` → `None`.
  - `dominio_permitido("a@healthsafetytech.com", ["healthsafetytech.com"])` True; `"a@gmail.com"` False; `"a@x.healthsafetytech.com"` False (subdomínio não conta); `"a@HealthSafetyTech.com"` True.
  - `detalhes_do_mapa("https://e.com/", MS, "/~/hs/hs.wam")` → `{"redirectUrl": "https://e.com/~/hs/hs.wam"}`.
  - `detalhes_do_mapa("https://e.com/~/hs/hs.tmj", …)` → redirect para `.wam`.
  - `detalhes_do_mapa("https://e.com/~/hs/hs.wam", "https://e.com/map-storage", …)` contém `wamUrl == "https://e.com/map-storage/hs/hs.wam"`, `group is None` (chave presente), `authenticationMandatory is True`, `opidWokaNamePolicy == "force_opid"`.
  - `/_/global/exemplo.com/mapa.tmj` → `mapUrl == "https://exemplo.com/mapa.tmj"` (confira em `<WA>/play/src/pusher/services/LocalAdmin.ts:255-300`).
  - `/qualquer` → `status "error"`, `code "UNSUPPORTED_URL_FORMAT"`.
  - `resolver_texturas([])` → `(True, [])`; um id real do `wokas.json` → `(True, [{"id","url"}])`; id inventado → `(False, …)`.
  - `resposta_de_acesso("a@hs.com", editor=False, …)`: `"username" not in r`; `userUuid == email == "a@hs.com"`; `tags == []`; `canEdit is False`; `world == "localWorld"`; `visitCardUrl is None` (presente); `messages == []`; `userRoomToken == token_sala`.
  - Editor: `canEdit is True` e `tags == ["admin", "editor"]`.
  - `recusa(...)` tem `status "error"`, `type "unauthorized"` e os campos de `<WA>/libs/messages/src/JsonMessages/ErrorApiData.ts:120+`; `espera(...)` tem `type "retry"`, `timeToRetry`, `canRetryManual True`.
- [ ] **Step 3:** rode e veja falhar (`ModuleNotFoundError`).
- [ ] **Step 4:** implemente `wa.py` (funções puras, sem banco nem settings). Comentário de cabeçalho com os fatos da spec que justificam cada regra (cru sem Bearer, `username` omitido, `group` obrigatório).
- [ ] **Step 5:** rode verde, commit `feat(escritorio): regras puras da Admin API do WA`.

### Task B2: token da sala e status para o WA

**Files:**
- Create: `backend/app/escritorio/token_sala.py`, `backend/app/escritorio/status_wa.py`
- Test: `backend/tests/test_escritorio_token_status.py`

**Interfaces — Produces:**
```python
# token_sala.py — JWT HS256 com settings.JWT_SECRET, aud "escritorio-sala", 12 h
def emitir_token_sala(email: str, agora: int | None = None) -> str
def ler_token_sala(token: str) -> str     # devolve o e-mail; levanta jwt.PyJWTError
# status_wa.py
def status_wa(label: str | None) -> str   # "ONLINE"|"BUSY"|"DO_NOT_DISTURB"|"BACK_IN_A_MOMENT"
```

- [ ] **Step 1: testes que falham:**
  - ida e volta: `ler_token_sala(emitir_token_sala("a@hs.com")) == "a@hs.com"`.
  - vencido (emitido com `agora` 13 h atrás) → `jwt.ExpiredSignatureError`.
  - **token de login do HS.OS (`app.auth.security.emitir_token`) recusado por `ler_token_sala`** (falta `aud`).
  - **token da sala recusado por `app.auth.security.ler_token`**: confira o comportamento do PyJWT com `aud` presente e `audience` não informada (ele levanta `InvalidAudienceError`). Se o `ler_token` aceitar, corrija-o para recusar e documente; é o mesmo cuidado do ticket de upload (`aud: "hsos-upload"`, ver CLAUDE.md).
  - `status_wa("Em reunião") == "BUSY"`, `"Foco / DND"` → `DO_NOT_DISTURB`, `"Almoço"` e `"Ausente"` → `BACK_IN_A_MOMENT`, `"Home office"`, `None`, `""` → `ONLINE`. Os labels vêm de `frontend/src/lib/user-status.ts`. Copie-os literalmente e diga isso no comentário.
- [ ] **Step 2:** rode e veja falhar. **Step 3:** implemente. **Step 4:** verde. **Step 5:** commit `feat(escritorio): token da sala e status para o WA`.

### Task B3: router da Admin API

**Files:**
- Create: `backend/app/routers/escritorio_wa.py`
- Modify: `backend/app/main.py` (import + `include_router`), `backend/app/config.py`, `backend/.env.example`
- Test: `backend/tests/test_escritorio_wa_rotas.py`

**Config nova** (em `Settings`, com comentário; segredos lidos por `ler_segredo`):
```
ESCRITORIO_ADMIN_API_TOKEN: str = ""      # segredo; o ADMIN_API_TOKEN do serviço wa
ESCRITORIO_ADMIN_SOCKETS_TOKEN: str = ""  # segredo; o ADMIN_SOCKETS_TOKEN do play (usado na B4)
ESCRITORIO_EDITORES: str = ""             # e-mails por vírgula: quem edita o mapa
ESCRITORIO_DOMINIOS: str = "healthsafetytech.com"
ESCRITORIO_URL: str = "https://escritoriohs.healthsafetytech.com"
ESCRITORIO_MAP_STORAGE_URL: str = "https://escritoriohs.healthsafetytech.com/map-storage"
ESCRITORIO_SALA_INICIAL: str = "/~/hs/hs.wam"
```

**Rotas** (prefixo `/escritorio-wa`, `include_in_schema=False`). Detalhes de cada uma na tabela da spec:
- `GET /api/capabilities` → `{}`. Sem token, sem banco, sem `ler_segredo` (precisa responder até com o banco fora).
- Todas as outras usam a dependência `_exige_token_wa`: lê `Authorization`, tira um `Bearer ` opcional, compara com `hmac.compare_digest` contra `await ler_segredo("ESCRITORIO_ADMIN_API_TOKEN")`; sem segredo → 503; diferente → 403.
- `GET /api/map`: `detalhes_do_mapa(playUri, settings.ESCRITORIO_MAP_STORAGE_URL, settings.ESCRITORIO_SALA_INICIAL)`.
- `GET /api/room/access` (query `userIdentifier`, `playUri`, `characterTextureIds` — aceite `characterTextureIds` **e** `characterTextureIds[]`, porque o axios manda com colchetes; leia de `request.query_params.getlist` nos dois nomes):
  1. `normalizar_email` + `dominio_permitido` → senão `recusa("FORA_DA_EMPRESA", "Acesso negado", "Este escritório é só da Health & Safety", "Entre com a conta Microsoft da empresa.")`.
  2. Consulta, com `sessao(role="service_role")`: `SELECT u.is_active FROM auth.users u WHERE lower(u.email) = $1`. Linha com `is_active = false` → `recusa("CONTA_DESATIVADA", …)`. Exceção de banco → `espera(...)` e `logger.exception`.
  3. `resposta_de_acesso(email, editor=email in lista_de_config(settings.ESCRITORIO_EDITORES), texturas=resolver_texturas(ids), token_sala=emitir_token_sala(email))`.
  - Isole a consulta numa função `_conta(email) -> bool | None` (None = sem conta) que o teste troca por `monkeypatch`.
- `GET /api/members?searchText=`: até 20 contas ativas, filtradas por `full_name ILIKE` ou `email ILIKE`, só de domínio permitido. Formato `{"id": email, "name": full_name or email, "email": email}`. Isole em `_membros(texto)`.
- `GET /api/members/{member_id}`: o mesmo formato + `visitCardUrl: None, chatID: None`; 404 se não achar.
- `GET /api/room/tags`, `/api/world/tags`, `/api/room/sameWorld` → `[]`.
- `POST /api/report`, `POST /api/ban`, `POST /api/room/message/{mid}/read` → 204, com `logger.info` do que veio.
- `GET /api/room-api/authorization` → `{"success": false, "error": "PERMISSION_DENIED", "message": "Room API desligada no HS.OS"}`.

- [ ] **Step 1: testes que falham** (`TestClient` sobre um app mínimo só com este router, como em `test_erro_interno.py`; `monkeypatch` em `ler_segredo`, `_conta`, `_membros`, `settings`):
  - `capabilities` responde 200 `{}` **sem** cabeçalho e com `ler_segredo` levantando exceção (prova que não toca segredo nem banco).
  - `map` sem `Authorization` → 403; com o token cru → 200; com `Bearer <token>` → 200; segredo ausente → 503.
  - `room/access` de `x@gmail.com` → 200 com `type == "unauthorized"`.
  - `room/access` com `_conta` → `False` (desativada) → `unauthorized`.
  - `room/access` sem conta (`None`) → `status "ok"` (a empresa inteira entra).
  - `room/access` com `_conta` levantando → `type "retry"`.
  - editor por `ESCRITORIO_EDITORES="Erick@HS.com"` e userIdentifier `erick@hs.com` → `canEdit True`.
  - `characterTextureIds[]=<id real>` → textura resolvida (prova os colchetes).
  - JSON da `room/access` **sem a chave `username`**.
  - `members/{id}` inexistente → 404.
  - `room-api/authorization` → `success False`.
- [ ] **Step 2:** veja falhar. **Step 3:** implemente; registre no `main.py`; declare as variáveis em `config.py` e `.env.example` (comentário curto em cada uma, sem valor de segredo). **Step 4:** suíte inteira verde. **Step 5:** commit `feat(escritorio): Admin API do WorkAdventure no HS.OS`.

### Task B4: vigia de presença + rotas `/escritorio`

**Files:**
- Create: `backend/app/escritorio/presenca.py`, `backend/app/routers/escritorio.py`
- Modify: `backend/app/main.py` (lifespan + router)
- Test: `backend/tests/test_escritorio_presenca.py`

**Antes de codar, confirme no WA** (e cite no comentário de cabeçalho):
- `<WA>/play/src/pusher/controllers/IoSocketController.ts:84-258`: rota `/ws/admin/rooms`, mensagem `{"event":"listen","roomIds":[...],"jwt":...}`.
- `<WA>/play/src/pusher/services/JWTTokenManager.ts:42-60`: como o JWT é verificado (algoritmo e campos; precisa de `exp`?).
- `<WA>/play/src/pusher/services/SocketManager.ts:128-191` e `<WA>/back/src/Model/GameRoom.ts:943-950`: formato de `MemberJoin`/`MemberLeave` e do snapshot inicial.
- **O formato exato do `roomId`** (URL completa `https://escritoriohs.healthsafetytech.com/~/hs/hs.wam`? Confira como o back nomeia a sala). Salas a ouvir: `ESCRITORIO_SALA_INICIAL` e `/~/office.wam`, montadas sobre `ESCRITORIO_URL`.
- O caminho público passa pela `borda` (nginx): `/ws/` vai ao `play:3001` (`escritoriohs/borda/nginx.conf`).

**Interfaces — Produces:**
```python
class Presenca:                       # estado puro, testável sem rede
    def zerar(self) -> None
    def entrou(self, uuid: str, nome: str, agora: datetime) -> bool   # True se mudou a lista
    def saiu(self, uuid: str) -> bool
    def pessoas(self) -> list[dict]   # [{"email","nome","desde"}] ordenado por nome
    conectado: bool
presenca = Presenca()                 # um por worker
def jwt_de_admin(segredo: str, salas: list[str]) -> str
async def vigiar(parar: asyncio.Event) -> None   # loop com backoff 2s→60s
```
`vigiar` é análogo a `escutar` (`app/escuta_banco.py`): sem `ESCRITORIO_ADMIN_SOCKETS_TOKEN`, registra uma linha de log e retorna; a cada mudança chama `hub.publicar("tabela:escritorio_presenca", …)`; ao cair, `presenca.conectado = False` e `zerar()`, e publica.

`GET /escritorio/presenca` (`usuario_atual`): junta `presenca.pessoas()` com `profiles` por `lower(email)` (`user_id`, `avatar_url`, nome do perfil se houver), via `_perfis(emails)` isolado.

`GET /escritorio/meu-status?t=` (**sem** `usuario_atual`): `ler_token_sala(t)` → e-mail → `SELECT custom_status, custom_status_emoji FROM profiles WHERE lower(email)=$1` (isolado em `_status(email)`) → `{"wa_status": status_wa(label), "emoji", "label"}`. Resposta com `Access-Control-Allow-Origin: *` **também no 401** (use `JSONResponse` com o cabeçalho; não levante `HTTPException`, que sairia sem ele). Sem conta: `ONLINE` com `null`s.

- [ ] **Step 1: testes que falham:**
  - `Presenca`: duas entradas do mesmo uuid + uma saída → continua na lista; segunda saída → some; `entrou` repetido devolve `False` na segunda; `zerar` limpa; ordem por nome.
  - `jwt_de_admin`: decodifica com o segredo e tem `authorizedRoomIds == salas` (e `exp`, se o WA exigir).
  - Um tratador puro `aplicar_mensagem(presenca, msg: dict, agora) -> bool` para `MemberJoin`/`MemberLeave`/snapshot, com mensagens copiadas do formato real do WA.
  - `meu-status` com token válido e `_status` → `("Em reunião","🗓️")` → `wa_status "BUSY"` e cabeçalho `access-control-allow-origin: *`.
  - `meu-status` com token inválido → 401 **com** `access-control-allow-origin: *`.
  - `meu-status` com `Origin: null` no `TestClient` sobre o **app inteiro** (`app.main.app`, como `test_sso_microsoft.py`) → o cabeçalho continua `*` (prova que o `CORSMiddleware` global não o tira).
  - `presenca` sem token → 401; com token e estado → lista com `user_id`/`avatar_url` do `_perfis` falso.
- [ ] **Step 2:** veja falhar. **Step 3:** implemente; ligue no `lifespan` com o mesmo padrão de `parar_*`/`create_task`/cancelamento das outras tarefas. **Step 4:** suíte verde. **Step 5:** commit `feat(escritorio): quem está no escritório agora e status para o mapa`.

### Task B5: EasyPanel, testes de config e README do escritório

**Files:**
- Modify: `escritoriohs/docker-compose.yml`, `escritoriohs/testes/testar-config.sh`, `escritoriohs/testes/verificar.sh`, `escritoriohs/README.md`, `escritoriohs/.env.example` (se existir)

- [ ] **Step 1:** confirme em `<WA>/play/src/pusher/enums/EnvironmentVariableValidator.ts` como `ADMIN_API_URL=""` (variável repassada vazia pelo compose) é tratada. **Se vazio contar como definido, o play quebra** antes de o Erick colar a env; nesse caso **não** a repasse por nome: documente que ela entra no compose só na implantação.
- [ ] **Step 2:** no serviço `play` **apenas**, acrescente `ADMIN_API_URL`, `ADMIN_API_TOKEN` e `ADMIN_SOCKETS_TOKEN` (repassadas por nome, como as outras). **Não** no `back` nem no `uploader` (a spec diz por quê). Mantenha `MAP_EDITOR_ALLOWED_USERS` e `START_ROOM_URL`: são a volta atrás.
- [ ] **Step 3:** `testar-config.sh`: novas checagens. `ADMIN_API_URL` só aparece no bloco do `play`; não aparece em `back`/`uploader`; `MAP_EDITOR_ALLOWED_USERS` e `START_ROOM_URL` continuam no `play`. Rode e veja passar (e falhar ao pôr `ADMIN_API_URL` no `back` de propósito; desfaça).
- [ ] **Step 4:** `verificar.sh`: nova checagem `admin` (só leitura): `curl https://hsosapi.healthsafetytech.com/escritorio-wa/api/capabilities` → 200 `{}`; e, **sem token**, `…/api/map?playUri=…` → 403. Ela entra em `tudo`. Ajuste a contagem de checagens.
- [ ] **Step 5:** `README.md` do escritório: seção "Admin API (sub-projeto B)" com as variáveis (nomes, nunca valores), a regra de entrada, a volta atrás (apagar `ADMIN_API_URL`) e o aviso de que `MAP_EDITOR_ALLOWED_USERS`/`START_ROOM_URL` ficam sem efeito enquanto ela existir.
- [ ] **Step 6:** commit `feat(escritoriohs): env da Admin API no play e checagens`.

---

## FRENTE F — front

**Antes de começar:** leia `frontend/src/components/AppSidebar.tsx`, `frontend/src/pages/ChatPage.tsx:3020-3430` (listas mobile e desktop), `frontend/src/hooks/use-people.ts`, `frontend/src/lib/realtime.ts` (`assinarTabela`) e `frontend/src/hooks/use-resumo-em-audio.ts` (padrão React Query). O backend ainda não existe na sua branch: mocke `api` nos testes, conforme o contrato do topo.

### Task F1: lib + hook de presença

**Files:**
- Create: `frontend/src/lib/escritorio.ts`, `frontend/src/hooks/use-escritorio-presenca.ts`
- Test: `frontend/src/lib/escritorio.test.ts`, `frontend/src/hooks/use-escritorio-presenca.test.ts`

**Interfaces — Produces:**
```ts
export const ESCRITORIO_URL = "https://escritoriohs.healthsafetytech.com";
export interface PessoaNoEscritorio { email: string; nome: string; user_id: string | null; avatar_url: string | null; desde: string }
export interface PresencaEscritorio { conectado: boolean; pessoas: PessoaNoEscritorio[] }
export function emailsNoEscritorio(p: PresencaEscritorio | undefined): Set<string>   // lower-case
export function useEscritorioPresenca(): { presenca: PresencaEscritorio | undefined; carregando: boolean; estaNoEscritorio: (email?: string | null) => boolean }
```
O hook usa `useQuery(["escritorio","presenca"], () => api("/escritorio/presenca"), { refetchInterval: 60_000, staleTime: 30_000 })` e `assinarTabela("escritorio_presenca", () => qc.invalidateQueries(...))` num `useEffect`. Erro da API resulta em `presenca` indefinida, sem toast: o bloco some em silêncio.

- [ ] Testes que falham: `emailsNoEscritorio` normaliza maiúsculas; `estaNoEscritorio("Fulano@X.com")` true quando a API devolve `fulano@x.com`; `estaNoEscritorio(null)` false; o hook assina `escritorio_presenca` (mock de `@/lib/realtime`) e cancela ao desmontar. Implementar, verde, commit `feat(escritorio): presença do escritório no front`.

### Task F2: item "Escritório" no `AppSidebar`

**Files:** Modify `frontend/src/components/AppSidebar.tsx`; Test `frontend/src/components/AppSidebar.escritorio.test.tsx`

- `NavItem` ganha `external?: boolean`. Em `renderNavItem`, `external` renderiza `<a href={item.url} target="_blank" rel="noopener noreferrer">` com as mesmas classes e ícone do `NavLink`, inclusive no modo recolhido (tooltip igual aos outros).
- Item `{ title: "Escritório", url: ESCRITORIO_URL, icon: Building2, external: true }` logo depois de "Chat", em `memberGroups` e no grupo "Principal" de `adminGroups`.
- [ ] Teste que falha: renderiza o sidebar (com os providers/mocks que ele precisar; veja `ChatPage.menu.test.tsx` para o padrão) e acha o link "Escritório" com `href` = `ESCRITORIO_URL`, `target="_blank"` e `rel` contendo `noopener`, para os dois papéis. Implementar, verde, commit `feat(escritorio): atalho para o escritório no menu`.

### Task F3: bloco "No escritório agora" e 🏢 na lista de DMs

**Files:**
- Create: `frontend/src/components/escritorio/NoEscritorioAgora.tsx`
- Modify: `frontend/src/pages/ChatPage.tsx` (desktop, perto da `:3313`; mobile, perto da `:3049+`; item de pessoa, perto da `:3388`)
- Test: `frontend/src/components/escritorio/NoEscritorioAgora.test.tsx`

`NoEscritorioAgora({ presenca })`: componente **puro de apresentação**, sem hook dentro, para testar sem rede.
- `presenca` indefinida → não renderiza nada.
- `conectado: false` → mostra só uma linha compacta "Escritório" com o botão "Entrar".
- `conectado: true` → cabeçalho recolhível "No escritório agora (N)" + botão "Entrar" (link externo, nova aba) + até 8 avatares/nomes (avatar do perfil ou iniciais) e "+K" quando passar de 8. Com N = 0, mostra "Ninguém agora".
- Visual no padrão da sidebar de 260 px (classes do item de DM vizinho; nada de cor nova). Recolhido/aberto lembrado em `localStorage` com try/catch, chave `hsos:escritorio-aberto`.

Na `ChatPage`: chame `useEscritorioPresenca()` **uma vez** no componente, passe `presenca` ao bloco nas duas listas (mobile e desktop) e, no item de pessoa, mostre `🏢` (com `title="No escritório"`) ao lado do status quando `estaNoEscritorio(person.email)`. Confirme o campo de e-mail que o item de pessoa tem (`use-people.ts`).

- [ ] Testes que falham: os quatro estados acima; "+K"; o link "Entrar" com `target="_blank"`. Implementar, verde, `npx tsc --noEmit -p tsconfig.app.json` limpo, `npm run lint` sem erro novo nos arquivos tocados. Commit `feat(escritorio): quem está no escritório na tela do chat`.

**Prévia visual:** ao terminar, suba `npm run dev` e tire um screenshot da sidebar com dados mockados, se der (ex.: Playwright com rota interceptada). Senão, descreva no relatório o que precisa ser olhado. A sessão principal mostra ao Erick antes do merge.

---

## FRENTE M — mapa

**Antes de começar:** leia `escritoriohs/mapa/README.md`, `modelo.py`, `gerar.py` (procure `personalAreaPropertyData` e a montagem das `properties` do mapa), `mesclar.py`, `enviar.sh` e os testes em `testes/`. Leia também na doc do WA: `<WA>/docs/developer/map-scripting/` (propriedade `script` do mapa e `WA.player.setStatus`, `WA.player.userRoomToken`, `WA.onInit`). Confirme em `<WA>/play/src/front/Api/Iframe/player.ts:232,327-332`.

### Task M1: dono da sala na planta

**Files:** Modify `modelo.py`, `gerar.py`, `mesclar.py`, `README.md`; Test `testes/test_dono.py` (ou nos arquivos de teste existentes do mesmo assunto)

- `Comodo` ganha `dono: str | None = None`. `planta.json` **não** recebe nenhum dono (dado do Erick). Só o README explica como pôr.
- `gerar.py`: na `personalAreaPropertyData` da sala, `ownerId = dono.strip().lower()` se houver `dono`; senão `None` (como hoje).
- Validação no carregamento da planta: `dono` sem `@` → erro claro (`ValueError` com o nome do cômodo); `dono` em cômodo que não é `sala` → erro.
- `mesclar.py`: **precedência nova**. Se a propriedade gerada tem `ownerId` não nulo, ela vence o ar; se é `None`, preserva do ar `ownerId` e `allowedTags` (o comportamento de hoje). Atualize a docstring do módulo.
- [ ] Testes que falham: gerar com `dono` → `ownerId` em minúsculas; `dono` inválido → `ValueError`; `mesclar` com planta-dono `a@x` e ar `b@x` → `a@x`; planta sem dono e ar `b@x` → `b@x`; ar sem a área → gerado. Implementar, suíte verde, commit `feat(escritoriohs/mapa): dono da sala vindo da planta`.

### Task M2: script de status no mapa

**Files:** Create `escritoriohs/mapa/script/escritorio.js`; Modify `gerar.py` (propriedade `script` no `hs.tmj` + copiar o script para `saida/`), `enviar.sh` (incluir `escritorio.js` no zip), `README.md`; Test `testes/test_script.py`

`escritorio.js` (JavaScript puro, sem build; a API `WA` é injetada pelo WA no iframe do script; confirme na doc):
```js
// Puxa o status do perfil do HS.OS e aplica no WA (spec 2026-10-15-escritoriohs-b).
const API = "https://hsosapi.healthsafetytech.com/escritorio/meu-status";
const INTERVALO = 60_000;
let ultimo = null, desistiu = false;
async function sincronizar() {
  if (desistiu) return;
  const t = WA.player.userRoomToken;
  if (!t) { desistiu = true; return; }
  try {
    const r = await fetch(`${API}?t=${encodeURIComponent(t)}`);
    if (r.status === 401) { desistiu = true; return; }
    if (!r.ok) return;
    const { wa_status } = await r.json();
    if (ultimo === null && wa_status === "ONLINE") { ultimo = wa_status; return; }
    if (wa_status !== ultimo) { WA.player.setStatus(wa_status); ultimo = wa_status; }
  } catch (_) { /* rede: tenta no próximo ciclo */ }
}
WA.onInit().then(() => { sincronizar(); setInterval(sincronizar, INTERVALO); });
```
Confira que `setStatus` aceita exatamente essas strings e que `userRoomToken` existe no `WA.player` dessa versão. Ajuste se a doc disser outra coisa e registre como `Ruling:`.

- [ ] Testes que falham (pytest): o `hs.tmj` gerado tem a propriedade de mapa `script` = `"escritorio.js"`; `saida/escritorio.js` existe depois de `gerar.py` e é igual a `script/escritorio.js`; o `enviar.sh` zipa `escritorio.js` (teste por leitura do texto do script, como os outros testes que leem arquivo). Se houver `node` na máquina, um teste extra que roda `node --check script/escritorio.js`; pule com `pytest.skip` se não houver. Implementar, suíte verde, commit `feat(escritoriohs/mapa): script que leva o status do HS.OS ao escritório`.

**Não rode `enviar.sh`.** O envio é da sessão principal, com o Erick.

---

## Depois das três frentes: sessão principal

1. Revisar cada branch (revisor novo no modelo mais capaz, com o Review Focus acima). Mostrar a prévia visual da F ao Erick. Mesclar na `main` na ordem B → M → F e fazer push.
2. Seguir "Implantação" da spec, passo a passo, confirmando cada ação de produção com o Erick.
3. Atualizar `docs/ESCRITORIOHS-CONTINUAR.md`, `CLAUDE.md` (seção EscritorioHS) e `escritoriohs/README.md`.
