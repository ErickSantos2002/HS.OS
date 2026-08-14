# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Idioma: o código, os comentários e a documentação deste repositório são em **português**. Mantenha o padrão.

## O que é este projeto

**HS.OS** — plataforma de gestão de agentes de IA ("Mission Control"). O front conversa com
agentes que rodam num **OpenClaw Gateway** hospedado em VPS.

Origem: é um **remix (fork) do `dn.os`**, produto da dn.ia, adaptado pela Health & Safety — mesma
história do TalentHS, que já percorreu este caminho e serve de referência para as decisões daqui.
Isso explica as referências a `dn.ia` / `dnos` / `OpenClaw` espalhadas: são dívida de rebrand, não
decisão de arquitetura.

**Direção da migração — decisão tomada:** sair do Supabase por completo, para Postgres próprio na
VPS da HS, igual aos outros sistemas. Ao mexer em qualquer coisa, prefira a direção nova: não
acrescente dependência do Supabase que depois vai ter que ser desfeita.

Sair do Supabase é substituir **cinco** subsistemas, não só o banco:

⚠️ **"Substituto pronto" e "a tela usa" são colunas diferentes**, e juntá-las já
escondeu telas quebradas em produção. O placar tem que separar as duas:

| Subsistema | Substituto | Front religado | Destino |
|---|---|---|---|
| Auth | ✅ | ✅ **completo** | JWT próprio (PyJWT + bcrypt) |
| Storage | ✅ | ✅ **completo** | `UPLOADS_DIR` em disco, `app/routers/storage.py` |
| Realtime (`postgres_changes`) | ✅ | ✅ **completo** | WebSocket + LISTEN/NOTIFY, `app/escuta_banco.py` |
| Edge Functions | ✅ **73 de 73** | ✅ sem pendências | routers FastAPI |
| Banco (via RLS, direto do browser) | ✅ ~145 rotas | ✅ **0 chamadas vivas** | endpoints FastAPI |

O **banco saiu inteiro** em 10/08/2026: das 185 chamadas `.from("…")` originais,
**zero** continuam vivas, nenhum arquivo chama `functions.invoke`, e o único
lugar que ainda menciona o Supabase fora de comentário é o próprio
`integrations/supabase/client.ts` — que existe só para lançar quando alguém o
usar. O front está limpo.
O **Realtime saiu inteiro**: a captura é por trigger + `pg_notify`, o backend
roteia por `channel_id`/`user_id`/`agent_id`, e nenhum arquivo abre mais
`supabase.channel(...)`. Ver `docs/PLANO-REALTIME.md`.

O `/ws` também aceita tráfego **de volta**, para o que é efêmero e não deve
tocar o banco: hoje só o "fulano está digitando". O navegador manda
`{tipo: "digitando", topico: "canal:<id>"}` e o servidor republica no tópico —
depois de conferir que a conexão já assina esse tópico, o que só acontece para
membro do canal. O `userId` sai do token, nunca do payload.

O placar atualizado e a forma de medi-lo estão em `docs/ROADMAP.md`.

## Estrutura

Monorepo `frontend/` + `backend/`, mesma convenção dos outros sistemas da HS
(TalentHS, TaskHS, GestorHS):

```
frontend/          React + Vite
backend/
  app/             API FastAPI — auth, branding, profiles, gateway, agents
  app/gateway/     cliente WebSocket do OpenClaw + resolução de config
  migrations/      000 compat · 001 schema · 002 auth própria
  supabase/        as 73 Edge Functions: fonte da portagem, não código que roda
docs/              roadmap, deploy, auditoria herdada
scripts/           túnel SSH para o OpenClaw
docker-compose.yml backend:8002 + frontend:80
```

**`backend/supabase/` era um placar, e ele fechou em 11/08/2026.** Não há mais Edge Function
por portar: 65 viraram endpoints FastAPI e 8 foram arquivadas em `_pausado/` por decisão —
Arena, war room, voz e a `turn-reconciler`. A última tem o porquê escrito em
[`docs/DECISAO-RECONCILIADOR.md`](docs/DECISAO-RECONCILIADOR.md): ela existia para consertar
uma entrega que se perdia, e o nosso desenho **puxa** a resposta do gateway em vez de esperar
que a empurrem — o buraco que ela tapava não existe aqui.

**Retomando o trabalho? Comece por [`docs/CONTINUAR-AQUI.md`](docs/CONTINUAR-AQUI.md)** — estado
atual, próximos passos em ordem de dependência e as armadilhas que custam uma tarde.

**O plano da migração está em [`docs/ROADMAP.md`](docs/ROADMAP.md)** — lotes, ordem,
dependências e decisões em aberto. Consultar antes de escolher o que portar, e atualizar
o placar de lá quando um lote fechar.

## Comandos

Frontend — rodar sempre a partir de `frontend/`:

```bash
cd frontend
npm install          # npm é o gerenciador oficial — ver "Convenções"
npm run dev          # Vite dev server em http://localhost:8080 (host "::")
npm run build        # build de produção
npm run build:dev    # build com mode=development (source maps, tagger)
npm run lint         # ESLint 9 (flat config em eslint.config.js)
npm run test         # Vitest (jsdom), roda uma vez
npm run test:watch   # Vitest em watch

npx vitest run src/test/example.test.ts   # um teste, por arquivo
npx vitest run -t "nome do teste"         # um teste, por nome
```

Backend — a partir de `backend/`:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                      # preencher DATABASE_URL e JWT_SECRET
uvicorn app.main:app --reload --port 8002 # http://localhost:8002/docs
```

⚠️ **Porta 8002, não 8000 nem 8001** — nesta máquina o `taskhs-backend` ocupa a 8000 e o
`gestorhs-backend` a 8001. O proxy `/api` do Vite aponta para a 8002.

**O gateway exige um túnel SSH aberto** para a VPS do OpenClaw, senão tudo que depende dele responde
`Connection refused`:

```bash
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -L 18789:127.0.0.1:18789 root@2.24.85.122
```

Sem o `ServerAliveInterval` o túnel morre em minutos de inatividade e o sintoma é confuso.

Login de desenvolvimento: `ti@healthsafetytech.com` / `admin123`.

Stack completa: `docker compose up -d --build` na raiz. Deploy: ver `docs/DEPLOY.md`.

Testes ficam em `frontend/src/**/*.{test,spec}.{ts,tsx}`, setup em `frontend/src/test/setup.ts`
(Testing Library + jest-dom). Hoje existe **apenas um teste** (`frontend/src/test/example.test.ts`) —
a cobertura real é ~zero.

**Playwright está quebrado:** `frontend/playwright.config.ts` importa `lovable-agent-playwright-config`,
pacote que **não está no `frontend/package.json`**. Era infra do Lovable. Ou adicione a dependência ou
substitua por um config próprio antes de tentar rodar E2E.

## Restrições do ambiente

- **O schema já foi extraído do Supabase e vive em `backend/migrations/`.** São dois arquivos, e a
  ordem importa: `000_compat_supabase.sql` (escrito à mão — recria os roles `authenticated`/`anon`/
  `service_role`/`sandbox_exec`, o schema `auth` com `auth.uid()`, e as extensões) e
  `001_initial_schema.sql` (gerado do dump — 69 tabelas, 3 views, 191 policies, 32 FKs). Sem o `000`,
  o `001` falha com 213 erros. Validado num Postgres 18 limpo com 0 erros. **Não edite o `001`** —
  ele é gerado por `_origem/regerar-001.sh`; mudanças de schema vão na `002+`. Ver
  `backend/migrations/README.md`.
- **O banco de origem está vazio.** As 69 tabelas e o `auth.users` têm 0 linhas — a migração é 100%
  de estrutura. Não existe conta de usuário cadastrada em lugar nenhum.
- **Se mantiver RLS, todo request autenticado precisa emitir `SET LOCAL app.current_user_id`** antes
  de qualquer query, senão `auth.uid()` devolve `NULL` e as policies negam. O setting **não** pode se
  chamar `app.current_role` — `current_role` é palavra reservada e o `SET LOCAL` dá erro de sintaxe.
- **`.env` não é mais versionado** (corrigido na reestruturação). Cada lado tem o seu:
  `frontend/.env` e `backend/.env`, ambos ignorados, com `.env.example` versionado ao lado.
- Os docs citam a tag de restauração `v1.0-pre-consolidacao` (commit `34f4a7e8`). **Ela não existe
  neste repositório** — o remix veio sem histórico (2 commits). Não conte com esse rollback.

## Arquitetura

### O estado híbrido — leia isto antes de mexer em qualquer coisa

O sistema está no meio da travessia e **as duas arquiteturas convivem**:

```
                    ┌─► backend/app/  (FastAPI + Postgres próprio)   ← o alvo
React SPA (Vite) ───┤        └─► OpenClaw Gateway (WebSocket, via túnel SSH)
                    └─► Supabase      (o que ainda não foi portado)  ← em remoção
```

O que **já é nosso**: autenticação (com troca de senha), marca, perfis, gateway, agentes (ciclo
completo — criar, editar, sincronizar, verificar modelo, liderança, acesso, excluir, exportar,
arquivos do workspace), **conversa com agente**, **canais** (com resposta de agente), **automações**,
**tarefas**, **arquivos** (incluindo gerar PDF e DOCX), **arenas**, **integrações** e a infra de
**tempo real**. O resto ainda chama o Supabase.

**Regra ao portar escrita que toca as duas pontas: gateway primeiro, banco depois.** `PATCH
/agents/{id}` escreve nome e modelo no gateway **antes** de tocar no banco e aborta com 502 se ele
recusar — nada muda em lugar nenhum. As edges herdadas faziam o contrário (gravavam no banco e
seguiam com um `openclaw_warning` que a UI ignorava), e com o gateway fora do ar o banco passava a
dizer um modelo enquanto o agente rodava outro. Campos que só existem no banco (persona, skills,
crons, acesso) continuam editáveis com o gateway fora — travá-los seria pior.

Telas não portadas **falham de forma visível e nomeada**, de propósito — some sem explicação é pior
do que aparecer quebrado. Dois mecanismos fazem isso, e ambos devem ser respeitados ao portar:

- `gatewayNaoPortado("<área>")` em `frontend/src/lib/gateway.ts` — marca caminhos que falavam com o
  gateway direto do navegador
- O Proxy em `frontend/src/integrations/supabase/client.ts` — sem as variáveis do Supabase, o client
  não é criado e lança no primeiro uso, em vez de derrubar a aplicação no boot

### Gateway — protocolo e segurança

⚠️ **O OpenClaw fala WebSocket com JSON-RPC, não REST.** O código herdado chama `${url}/api/health`
e `${url}/v1/models`; esses caminhos **não existem mais** e devolvem 404 ou o HTML do painel. Não
copie chamada de edge function antiga sem verificar. O cliente correto está em
`backend/app/gateway/client.py`, e o contrato foi levantado testando ao vivo.

⚠️ **A identidade do cliente concede a permissão.** Só `client.id="gateway-client"` +
`client.mode="backend"` recebe os scopes de operador. Qualquer outra combinação **conecta
com sucesso** e é negada em cada método com `missing scope` — um modo de falhar particularmente
traiçoeiro.

⚠️ **O cliente pede os scopes; o gateway não infere.** `SCOPES` em `client.py` é a lista enviada no
handshake, e o gateway concede exatamente ela. Até 06/08/2026 pedíamos só `operator.read` e
`operator.write`, e como todo o Lote 2a era leitura ninguém notou — a primeira escrita
(`agents.update`) morreu com `missing scope: operator.admin`. Se um método novo negar por scope,
olhe essa lista antes de suspeitar do token.

⚠️ **Só conexões que chegam no loopback do gateway recebem scopes.** Por isso produção usa um túnel
SSH (`scripts/tunel-openclaw.sh`) e não o domínio público. Ver `docs/DEPLOY.md`.

⚠️ **`agents.update` não valida nada e grava.** Mandar `model: "isto-nao-e-um-modelo"` retorna
sucesso e deixa o agente com esse modelo — comprovado em 06/08/2026, no `nina` em produção, num teste
que **esperava uma recusa**. Não sonde a escrita do gateway com valor inválido: ele aceita. Para
descobrir formato, use um `agentId` inexistente, que falha antes de gravar.

⚠️ **O `model` é assimétrico.** `agents.list` devolve `{"primary": "anthropic/claude-sonnet-4-6"}`,
mas `agents.update` exige **string nua** e recusa o objeto com `at /model: must be string`.

⚠️ **A rota HTTP OpenAI-compatível sumiu.** `POST /v1/chat/completions` hoje é 404. **Doze** edge
functions ainda a usam — é a espinha do chat, e portanto do Lote 3: `gateway-chat`, `dm-agent-reply`,
`channel-agent-reply`, `agent-task`, `create-agent`, `update-agent-access`, `update-agent-leadership`,
`resend-agent-briefing`, `chat-image-vision`, `parse-company-context`, `export-agent`, `seed-agents`.
Todas precisam do mesmo substituto.

### `chat.send` — o substituto, levantado ao vivo em 06/08/2026

```
chat.send { sessionKey, message, idempotencyKey, agentId? }  →  { runId, status: "started" }
```

- ⚠️ **Sem `agentId` vai para o agente padrão** (`defaultId` do `agents.list`, hoje `nina`), sem
  aviso nenhum. Foi assim que uma sondagem mandou "ping" para a `nina` por engano. **Sempre mande
  `agentId` explícito**, mesmo quando parecer óbvio qual é o alvo.
- ⚠️ **A chave da sessão tem que ser mandada COMPOSTA**: `agent:<agentId>:<sufixo>`. Mandar só o
  sufixo com `agentId` junto é **recusado** — o gateway extrai o agente da própria chave e confere,
  devolvendo `agentId "X" does not match session key "Y"`. É esse nome composto que aparece no
  `sessions.list` e é o que o `sessions.delete` exige (em `key`, não em `sessionKey`).
  Em 12/08/2026 isto derrubou **todos** os avisos ao agente líder: o `_avisar_agente` mandava
  `system:<assunto>`, o gateway recusava, e como o envio era best-effort o erro morria no log —
  a tela dizia "agente criado" para um agente que nasceu com o template em branco.
- **`idempotencyKey` é obrigatório** e o `runId` volta igual a ele. O gateway passou a deduplicar
  nativamente — vale conferir se isso não resolve sozinho a execução duplicada catalogada em
  A1–A19 da auditoria, antes de reimplementar a fila do `chat-sender.ts`.
- `chat.send` é **assíncrono**: devolve `started`, não a resposta. A resposta chega por outro
  caminho (era o `agent-reply-webhook` no desenho antigo).

Por isso `POST /agents/test-model` verifica por `models.list` + `models.authStatus` em vez de
`chat.send`: mandar mensagem de verdade a cada clique custa tokens e polui o histórico do agente. Em
troca, ele **não** afirma que a LLM respondeu — só que está registrada, disponível e com credencial
válida.

### Leitura de arquivo do workspace — o gateway ganhou isso

```
agents.files.list  { agentId }               → { files: [{name, path, size, missing}] }
agents.files.get   { agentId, name }         → { file: { content, size, encoding, … } }
agents.workspace.list { agentId, path? }     → { entries: [{path, name, kind, size}] }
agents.workspace.get  { agentId, path }      → { file: { content, mimeType, encoding, … } }
```

Os canônicos que o `agents.files.list` devolve: `AGENTS.md`, `SOUL.md`, `TOOLS.md`,
`IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`. Confirmado ao vivo em 06/08/2026 lendo o
`SOUL.md` da `nina`.

⚠️ **Isto contradiz o comentário do `export-agent`**, que afirma (19/07/2026) que "o gateway em
produção não expõe NENHUM endpoint de leitura de arquivo funcional (`/api/files`, `agents.files.get`
RPC, `/api/agents/{id}/{key}` — todos 404 ou method not supported)". Era verdade naquela versão;
deixou de ser. Consequências ao portar:

- `export-agent` pede ao **LLM do orquestrador** para ler os arquivos e devolver JSON, com prompt de
  ~170s de timeout, justamente porque não havia outro jeito. Agora há leitura determinística.
- A ponte `dnos-files-bridge` na VPS (timer de 60s espelhando arquivos para a tabela `agent_files`)
  existia pelo mesmo motivo. **Saiu do caminho em 11/08/2026**: painel, exportação e importação
  falam com o gateway direto, e nenhum arquivo do front toca a `agent_files`. A tabela está com
  zero linhas — a ponte nunca escreveu nada aqui — e pode ser desligada na VPS.

⚠️ **`agents.create` exige `workspace`**, e a convenção dos agentes existentes é
`/root/.openclaw/workspace-<sufixo>`. O gateway ainda cria um `BOOTSTRAP.md` sozinho no workspace
novo (~1.7 KB), que não é um dos sete canônicos e nada do nosso lado escreve. Levantado em
11/08/2026 criando e apagando um agente de teste.
- `agents.files.get` usa **`name`** (nome canônico); `agents.workspace.get` usa **`path`**. Trocar um
  pelo outro dá `unexpected property`.

⚠️ **Regra de operação: não sonde método de escrita do gateway sem combinar antes.** Leitura
(`*.list`, `*.get`, `*.status`) é livre. Qualquer coisa que crie, altere ou envie: mostre o payload
e confirme. Em 06/08/2026 duas sondagens escaparam — uma quebrou o modelo da `nina`, outra mandou
mensagem para ela. Para descobrir formato de parâmetro sem escrever, use um **`agentId` inexistente**
(o gateway valida o schema e devolve o campo que falta antes de resolver o agente) — mas confira que
**toda** chamada do lote leva o alvo inexistente, porque basta uma sem ele.

⚠️ **O handshake WebSocket falha por timeout de vez em quando**, mesmo com o túnel de pé e
`/health` respondendo 200. `chamar()` já reconecta uma vez; em script solto, repita antes de
concluir que o gateway caiu.

⚠️ **Erro de conexão logo depois de um `config.patch` NÃO significa que não gravou.** O patch
dispara o reload, e o reload derruba o WebSocket — a exceção chega **depois** da escrita. Em
13/08/2026 isso produziu dois diagnósticos errados seguidos, um deles custando uma hora. Releia a
config e confira o efeito antes de concluir que falhou; `_aplicar_patch` em `backend/app/routers/llm.py`
faz isso e é o único lugar que deveria chamar `config.patch`.

### Configurar LLM: credencial e catálogo, os dois pela config

Levantado ao vivo em 13/08/2026, depois de **três conclusões erradas minhas** que valem mais que a
resposta:

- **`models.providers.<id>.apiKey` é o caminho suportado para a credencial.** O `config.schema`
  (existe como método RPC, e responde) declara a seção com `apiKey` aceitando string ou SecretRef,
  `additionalProperties: false` e **nenhum campo obrigatório**. Consultá-lo leva trinta segundos e
  teria evitado a tarde inteira.
- **Não confunda "não usado" com "não suportado".** `models` estava ausente do `openclaw.json` porque
  esta instância foi configurada pelo CLI, não porque o gateway rejeitasse a seção. Foi essa
  inferência que me levou a afirmar três vezes que configurar pela tela era impossível.
- **A nota de 01/08 sobre "hot-add crasha o reload" estava errada** e custou uma fila inteira
  (`llm_provider_ops`) que nunca teve executor. O nó era válido; naquele dia havia *também* um modelo
  irresolvível no catálogo, e o crash foi atribuído à escrita que coincidiu.

⚠️ **O cofre do agente ganha da config.** A credencial também pode viver em `auth_profile_store`, no
SQLite de cada agente (`~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`) — é o que o
`openclaw onboard` cria. Quando existe, ela **vence** o `models.providers`, e esvaziar
`auth.profiles` não adianta: o cofre sobrevive à declaração. O que resolve é zerar a ordem:

```json
{"auth": {"order": {"anthropic": []}}}
```

⚠️ **Modelo que o gateway não resolve envenena o catálogo inteiro.** `agents.defaults.models` aceita
qualquer id (são chaves com valor `{}`), mas quem resolve é um registro interno; id desconhecido volta
no `models.list` **sem `api`** e faz **toda** execução de agente falhar em ~200ms com zero token —
inclusive a de quem usa modelo válido. A lista que a tela oferece vem da API do provedor, que tem ids
que este gateway não executa. Não dá para validar antes (o modelo só aparece depois de entrar no
catálogo): escreva, confira com `models.list` e recolha o que não colou.

⚠️ **Remover item de array exige `replacePaths`.** O `config.patch` recusa com "would remove entries
from array path(s): …" em vez de apagar em silêncio, e **nomeia os caminhos na mensagem** — use os
nomes que ele deu. Existe também `config.apply` para troca da config inteira.

⚠️ **Depois de um 401 o perfil entra em cooldown** e as execuções seguintes falham em ~200ms sem
tentar. Isso faz o tempo de falha variar (261ms → 3589ms → 195ms) e convida a atribuir a variação à
última coisa que você mexeu. Não atribua: leia
`journalctl --user -u openclaw-gateway.service`, que traz `profile=sha256:…`, o status HTTP e o
`rawError` do provedor. Foi o log que desfez cada palpite errado deste dia.

**O vazamento do token foi fechado (Lote 1).** `frontend/src/lib/gateway.ts` não conhece mais o
`admin_token` — expõe só `{url, temToken, configurado}`. Toda chamada ao gateway passa por
`/gateway/*` ou `/agents`. **Não reintroduza o token no front** ao portar os pontos que ainda usam
`gatewayNaoPortado()`: crie o endpoint proxy no backend.

### Resolução da config do gateway

`backend/app/gateway/config.py`: **o `.env` vence quando preenchido**, `public.vps_config` é o padrão
para quem não define nada.

A ordem é invertida em relação ao dn.os (que lia o banco primeiro) e isso foi deliberado: existe
**uma** linha em `vps_config` e ela não consegue valer para produção (`172.18.0.1`, bridge do Swarm)
e para a máquina de desenvolvimento (`127.0.0.1`, túnel SSH local) ao mesmo tempo. `/gateway/config`
devolve `fixado_por_env` para a tela não oferecer uma edição sem efeito.

### Caminho crítico do chat

`frontend/src/lib/chat-sender.ts` (~2100 linhas) é o coração e o arquivo mais delicado do projeto. Ele:

- mantém uma **fila em nível de módulo**, não em estado React — envios sobrevivem à navegação entre páginas;
- persiste tudo na tabela `conversations` (não em memória) e emite `CustomEvent` para o `ChatPage`
  montado atualizar em tempo real;
- é acoplado ao React Query por injeção: `setQueryClientForSender(queryClient)` é chamado uma vez em
  `frontend/src/App.tsx`.

O ciclo completo de uma resposta envolve várias Edge Functions: `gateway-chat` (envio),
`dm-agent-reply` (fallback de reenvio em segundo plano), `agent-reply-webhook` (resposta assíncrona
do agente volta por aqui), `turn-reconciler` e `agent-task` (Loop Architecture, tarefas longas com
`checkpoint_data`).

Antes de mexer aqui, leia `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` — os bugs A1–A19 e B1–B10 documentam
exatamente as armadilhas deste caminho (execução duplicada, falso-positivo de context overflow,
heartbeat descartando resposta final).

### Feature flags

Mudanças de risco no caminho do chat entraram atrás de flags **em `localStorage`, desligadas por padrão**.
Não há tabela nem UI — liga-se pelo console do navegador:

```js
localStorage.setItem('hsos_flag_real_stop', 'on')                  // /stop real no gateway
localStorage.setItem('hsos_flag_structured_errors', 'on')          // reconhece erro do gateway (HTTP 200 + JSON)
localStorage.setItem('hsos_flag_fix_overflow_falsepositive', 'on') // só reseta sessão em erro real
localStorage.setItem('hsos_flag_reorder_prompt', 'on')             // reordena prompt p/ cache do modelo
```

Todas definidas em `frontend/src/lib/chat-sender.ts`. Desligar volta ao comportamento antigo na hora, sem deploy.

O prefixo era `dnos_` e virou `hsos_` em 11/08/2026. **Quem já tinha uma flag ligada não a perdeu:**
`frontend/src/lib/chaves-locais.ts` lê o nome novo e, não achando, adota o antigo e o regrava — a
migração acontece na primeira leitura, sem varredura no boot. Vale para todas as chaves `dnos:`/`dnos-`.
Exceção: o IndexedDB continua `dnos-fs`, porque renomear ali órfã a pasta local que a pessoa conectou.

### Estado e persistência

- **`app_settings` (tabela) substituiu o `localStorage` para configuração** — ver `frontend/src/lib/app-settings.ts`,
  com cache em memória. As exceções deliberadas ainda em `localStorage`: as feature flags acima e o cache
  de branding (`dnos-branding-cache`).
- Dados de servidor: **TanStack Query**, um `QueryClient` global em `frontend/src/App.tsx`.
- Contextos React são poucos e específicos: `AuthProvider` (`frontend/src/components/AuthGuard.tsx`),
  `FileSystemProvider`, `ThemeProvider`.

### Autorização

**Dois papéis: `administrador` e `colaborador`**, guardados em `user_roles` e checados no banco por
`has_role` (usada nas policies de RLS). Eram três com os nomes herdados (`super_admin`, `member`,
`user`); a `005_papeis_e_pessoas.sql` renomeou e fundiu — `member` e `user` não se distinguiam na
prática. No back o guard é `exige_papel`; no front, `allowedRoles` do `ProtectedRoute`.

⚠️ **Os papéis são acesso ao sistema, não hierarquia da empresa.** O CEO é `colaborador`. Ler
`colaborador` como "menos importante" leva a decisão errada — inclusive nos arquivos dos agentes,
onde isso está escrito de propósito.

Uma pessoa pode ter mais de uma linha em `user_roles`; vale o papel mais forte, resolvido por
`ORDER BY CASE ... LIMIT 1` em `profiles.py`.

Instalação zerada não tem usuário e não há cadastro público — a tela de login detecta isso e oferece criar
o primeiro admin via `bootstrap-first-admin`, que cai direto no wizard de `/setup`.

#### Senha: quem define é o administrador

⚠️ **Colaborador não troca a própria senha.** `POST /auth/trocar-senha` recusa quem não é
`administrador`, com mensagem própria em vez do "permissão insuficiente" genérico — quem esbarra
nisso está diante de um campo de senha e precisa saber para onde ir. Quem define senha de outra
pessoa é o admin, por `POST /profiles/{user_id}/senha`, que **não pede a senha atual**: quem troca
não a conhece, e exigi-la tornaria a rota inútil. O que autoriza é o papel, e por isso ele é a
defesa inteira.

Não é regra genérica de segurança, é o desenho de acesso desta empresa (decisão do Erick,
14/08/2026): a HS é fechada e as pessoas entram pelo **FortiPAM**, que guarda a credencial. Troca
por fora do cofre o deixa guardando uma senha que não abre mais nada. **Numa instalação sem cofre,
soltar a rota para todo mundo seria o certo** — não copie esta restrição sem o FortiPAM junto.

Na tela: o cartão "Alterar Senha" em Configurações → Perfil só aparece para admin; o colaborador vê
no lugar uma linha dizendo onde a senha mora. Em Usuários há o botão **Senha** por pessoa.

`needsPasswordSetup` em `use-auth.ts` é **sempre `false`** e o redirecionamento para
`/reset-password` no `ProtectedRoute` nunca dispara; `profiles.status` nasce `'active'` por default
da coluna. Ou seja, ninguém fica preso numa tela de definir senha que agora recusaria — mas se
alguém reativar aquele fluxo, precisa reativá-lo **para admin apenas**.

### Roteamento

Todas as rotas ficam em `frontend/src/App.tsx`, em `<Routes>` aninhados. Quatro categorias:

1. **Públicas** — `/login`, `/reset-password`, `/artifact/:id`, `/p/:slug`, `/wiki-html-preview`
2. **Autenticadas sem layout** — `/warroom` (tela cheia para TV), `/setup` (wizard)
3. **Autenticadas com `AppLayout` + `OnboardingGate`** — todo o resto
4. **Redirects legados** — `/dnos`, `/mission-control`, `/users`, `/documentation` caem em abas de `/settings`

`/` redireciona para `/chat`.

⚠️ **A maioria dos arquivos em `frontend/src/pages/` NÃO é tela em uso.** Só onze estão roteadas; o
resto foi absorvido por outras telas e sobrou como arquivo. `ProfilePage` é o caso exemplar: virou
aba da `SettingsPage`, que serve `/settings` **e** `/profile`, e o nome só aparece num comentário do
`App.tsx`. Em 07/08/2026 isso custou um commit inteiro — religuei a `ProfilePage` morta e deixei a
`SettingsPage` viva chamando `supabase.auth.updateUser`, ou seja, com "trocar senha" quebrado.

Grep pelo nome do componente **não serve** (casa com import e comentário). A conferência que funciona:

```bash
grep -oP '<Route[^>]*element=\{<\K[A-Za-z]+' frontend/src/App.tsx | sort -u
```

### Arquivos gerados — não editar à mão

- `frontend/src/integrations/supabase/types.ts` (~2950 linhas) — tipos do banco, regerados pelo Supabase CLI
- `frontend/src/integrations/supabase/client.ts` — tem o header "automatically generated"

`client.ts` tem uma particularidade real: um `fetch` customizado que remove o header `Authorization`
quando a chave é do formato novo e opaco (`sb_publishable_` / `sb_secret_`), mandando só `apikey`.
Não "simplifique" isso.

### PWA

`vite-plugin-pwa` com `registerType: "prompt"` e `strategies: "injectManifest"` (service worker em
`frontend/src/sw.ts`). **Não troque para `autoUpdate`** — o comentário no `frontend/vite.config.ts` documenta o motivo:
no modo autoUpdate a lib recarrega a página sozinha, e como há checagem de update a cada
`visibilitychange`, voltar para a aba depois de um deploy recarregava o app no meio de um clique.

O manifest vem de `frontend/public/manifest.json`, mas o `<link rel="manifest">` é reescrito em runtime pela
Edge Function `manifest` para refletir o branding — ver `applyManifest()` em `frontend/src/hooks/use-branding.ts`.

Versão de build: `frontend/vite.config.ts` injeta `__APP_VERSION__` e `__APP_BUILD_DATE__` a partir do SHA do git
no momento do build. `use-version-check` compara e avisa o usuário quando há versão nova.

### Um agente falar com outro — levantado ao vivo em 14/08/2026

O `agent_to_agent` **não é uma ferramenta**. Ligar `tools.agentToAgent` não faz aparecer nada com
esse nome: quem conversa entre agentes é o **`sessions_send`** (e o `sessions_spawn`), que vêm do
perfil `coding` e já estavam lá. O `agentToAgent` é a **política** que libera esses dois a cruzarem
a fronteira do agente. Com ele desligado, o `sessions_send` existe e é recusado.

⚠️ **`allow` lista quem PARTICIPA, não quem recebe.** Foi lido errado aqui, e o erro só apareceu
porque as duas pontas foram testadas:

| quem inicia | destino | `allow` | resultado |
|---|---|---|---|
| `iris` | `nina` | `[iris, atlas]` | recusado — falta `nina` |
| `nina` | `iris` | `[iris, atlas]` | recusado — falta `nina` |
| `nina` | `iris` | `[nina, iris, atlas]` | ✅ |

Ou seja: **os dois lados têm que estar na lista.** A recusa é explícita e boa —
`{"status":"forbidden","error":"Agent-to-agent messaging denied by tools.agentToAgent.allow."}`.

**Quem *inicia* se controla por agente, com `deny`.** `agents.list[].tools.deny =
["sessions_send","sessions_spawn"]` em `iris` e `atlas` deixa só a `nina` acionando. O `deny`
**remove a ferramenta da lista do agente** em vez de recusá-la em runtime — a `iris` responde
"não tenho essa ferramenta". Não existe `agentToAgent` por agente; o schema por agente tem só
`allow`, `alsoAllow`, `deny`, `byProvider`, `codeMode`, `elevated`, `exec`, `fs`, `loopDetection`,
`message`, `profile`, `sandbox`, `toolsBySender`.

`sessions_send` aceita `timeoutSeconds`: com timeout a resposta volta **inline**, e o agente
que delegou não precisa ficar consultando depois. E o destino recebe a mensagem marcada como
**dado entre sessões**, não como instrução de usuário — o que é uma defesa de graça contra usar
um agente para injetar comando noutro.

⚠️ **`agents.list` é array: merge patch substitui o array inteiro.** Para mudar um agente, mande a
lista completa e confira no `conferir` que o `alsoAllow` dos outros sobreviveu.

⚠️ **Servidor MCP se pausa sozinho depois de erros seguidos** (`bundle-mcp server "X" is paused
after repeated failures`). A `nina` chutou três nomes de coluna e derrubou o `banco-hsos` para ela
mesma. Volta sozinho — mas é motivo de sobra para o arquivo do agente mandar consultar
`information_schema` em vez de adivinhar.

### Escopo de banco por agente: `alsoAllow` concede, só o `deny` exclui

⚠️ **`tools.alsoAllow` é ADITIVO — declarar um servidor em `mcp.servers` já o entrega a todos.**
Com `tools.profile: "coding"` e sem `tools.allow` global, todo servidor MCP fica visível para todo
agente; o `alsoAllow` não restringe nada, só acrescenta. Até 14/08/2026 a `nina` enxergava os nove
bancos da empresa tendo dois publicados, e a tela de Conectores dizia o contrário. O comentário do
`publicar_banco` **afirmava explicitamente** que declarar o servidor não dava acesso a ninguém —
estava errado, e sobreviveu porque ninguém perguntou ao agente.

Quem exclui é o **`deny` por agente**, recalculado a cada publicação em `_deny_de_mcp`
(`backend/app/routers/integracoes.py`): `deny = (tudo em mcp.servers) − (o alsoAllow do agente)`,
preservando os denies que não são de MCP (`sessions_send`, `sessions_spawn`).

⚠️ **O `deny` casa pelo nome SEM o prefixo `mcp__`; o `alsoAllow` usa COM.** Os dois convivem no
mesmo objeto e aceitam formatos diferentes. Aplicar `deny: ["mcp__banco-x__query"]` grava, passa em
qualquer conferência que releia a config, e **não remove nada** — a `iris` seguiu enxergando os dez
bancos com o deny "aplicado". O que vale é `banco-x__query`, que é o nome que o agente vê.

Verificação que serve: **perguntar ao agente** quais ferramentas ele enxerga. Reler o `config.get`
não distingue um deny que funcionou de um que não casou com nada.

⚠️ **`mcp__hsos-alerta__avisar_administrador` só funciona com o backend em produção.** O servidor
aponta para o backend pela rede, e o gateway vive noutra máquina (`2.24.85.122`) — o backend está em
`62.72.11.28`, atrás de `hsosapi.healthsafetytech.com`. Apontar para `172.18.0.1` é o engano fácil:
essa é a bridge do Swarm vista **de dentro do backend**, boa para o backend falar com o túnel, e
sem sentido a partir do gateway. Enquanto a URL esteve errada, `nina` e `iris` confirmaram cada uma
que a ferramenta não aparecia — e o `SOUL.md` das duas mandava usá-la ao detectar tentativa de
subverter os limites. **Servidor MCP fora do ar não publica ferramenta e não dá erro.**

## A regra dos sete arquivos

⚠️ **O OpenClaw carrega exatamente sete nomes no contexto do agente**: `AGENTS.md`, `SOUL.md`,
`TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md` e `MEMORY.md`. Arquivo com qualquer outro
nome no workspace **não entra no contexto** — só é lido se alguém mandar o agente abrir.

Não há como configurar isso: em 27 KB de `config.get` do gateway não aparece um único nome de
arquivo. E `agents.files.set` **recusa** nome fora dos sete (`unsupported file`).

**A consequência prática:** se o agente precisa saber sempre, tem que caber dentro de um dos sete.
Não existe meio-termo. Duas tentativas de contornar isso já falharam aqui:

- Um `COMPANY.md` com o perfil da empresa, escrito no workspace de três agentes. Ninguém nunca o
  leu, porque ninguém mandou.
- A distribuição do contexto da empresa, que mandava a orquestradora escrever esse mesmo
  `COMPANY.md`, com a instrução afirmando que ele "será injetado automaticamente no contexto" —
  o que nunca foi verdade. Corrigido em 13/08/2026: o backend escreve no `AGENTS.md`, entre
  marcadores, sem passar por LLM.

Para instrução que o agente usa **de vez em quando**, o mecanismo certo é uma **skill** — o
OpenClaw as carrega sob demanda (as 53 do gateway são todas `always: false`).

## Rebrand — o que é dado e o que é hardcoded

Boa parte da marca **já é dinâmica**, vinda da tabela `branding` via `frontend/src/hooks/use-branding.ts`:
nome da empresa, cor primária (HSL, aplicada em CSS custom properties), logos claro/escuro, mark,
favicon, ícone do PWA. Trocar isso é dado, não código.

O que é código e precisa de mudança manual:

- `DEFAULT_BRANDING` em `frontend/src/hooks/use-branding.ts` — fallback ainda é `companyName: "dn.ia"`
  apontando para `/dnia-wordmark*.png`
- **~374 ocorrências** de `dn.ia` / `dnos` / `dn.os` / `dnia` em ~30 arquivos de `frontend/src/`
- Assets: `frontend/public/dnia-*.png`, `frontend/src/assets/dnos-*.png`
- `frontend/package.json` ainda com `"name": "vite_react_shadcn_ts"`
- `README.md` com o título do remix
- Prefixo `dnos_` das feature flags e a chave `dnos-branding-cache`

**IDs de projeto Supabase de terceiros:** o do `manifest`
(`zozyfhisrbkqvdcsdbfp`, que apontava para outro projeto) **já saiu** — o manifest
é servido pela própria instalação. Resta `kfhojzdcnpuntynodsff` em
`backend/supabase/functions/marketing-analytics-proxy/index.ts:4`
(`DNMARKETING_URL`, API de analytics da dn.ia), numa function ainda não portada.

Nomes de agentes da instância original (`lia`, `rock`, `milo`, `kira`, `radar`, `sigma`, `rodrigo`)
ainda aparecem nos YAMLs de documentação. **Saíram do `use-agent-avatar.ts` em 10/08** — eram oito
ids fixos que o carregador sondava e que não existem aqui. A resolução do agente **líder/orquestrador** já foi corrigida para ser
dinâmica (via `agent_templates.is_leader_template`) em vez de assumir "lia" — não reintroduza o hardcode.

## Documentação que vale ler antes de mexer

| Arquivo | Conteúdo |
|---|---|
| `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` | 507 linhas, 49 achados de segurança/estabilidade catalogados A1–A19, B1–B10, com sintoma → causa raiz. Referência obrigatória para o caminho do chat. |
| `docs/RESUMO-CONSOLIDACAO-2026-07-18.md` | O que foi corrigido em cada bloco (0 remix-ready, 1 segurança, 2 estabilidade, 3 velocidade — pausado) |
| `docs/RESUMO-TECNICO-PARA-LIA-2026-07-18.md` | Contratos técnicos acordados com o lado do gateway (formato de `sessions_list`, dedup de heartbeat, verificação de `SOUL.md` no onboarding) |
| `docs/REMIX_SECRETS.md` | Lista real das env das Edge Functions, levantada do código. Diz explicitamente que a chave do LLM dos agentes fica no VPS/OpenClaw, não aqui. |
| `docs/PLANO-RECONCILIADOR.md` | A última edge function: o que ela faz, os dois bloqueios (um já resolvido) e por que "portar fiel" não é obviamente certo neste caso |
| `.lovable/plan.md`, `.lovable/remix-audit.md` | Contexto da origem Lovable |

## Convenções

- **Gerenciador de pacotes: `npm`** (decidido em 10/08/2026). Fixado em `packageManager` e
  `engines` no `frontend/package.json`; o lockfile canônico é `package-lock.json`. Os
  `bun.lock` e `bun.lockb` eram resto do Lovable e foram apagados — nada os usava: o
  `Dockerfile`, o `README` e os comandos daqui sempre chamaram `npm`. A imagem usa `npm ci`,
  que falha quando o lockfile diverge, em vez de resolver versão nova em silêncio.
- Alias `@/` → `frontend/src/` (configurado em `frontend/vite.config.ts` e `frontend/vitest.config.ts`; se adicionar outro config,
  replique)
- UI: shadcn/ui em `frontend/src/components/ui/` (~50 componentes, gerados via `frontend/components.json`) — componentes de
  feature ficam nas pastas irmãs por domínio (`agents/`, `chat/`, `wiki/`, `arena/`, `analytics/`,
  `monitoring/`, `dashboard/`, `onboarding/`, `settings/`, `users/`)
- Lógica de domínio sem React vai em `frontend/src/lib/`; lógica com React vai em `frontend/src/hooks/`. A nomenclatura dos
  hooks é inconsistente por herança (`use-agents.ts` kebab-case convive com `useFileSystem.ts` camelCase) —
  prefira **kebab-case**, que é a maioria
- Toasts: `sonner` (`toast` de `sonner`) é o padrão nos arquivos novos; ainda existe o `use-toast`
  do shadcn em uso legado
