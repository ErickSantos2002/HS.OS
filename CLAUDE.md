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
VPS da HS, igual aos outros sistemas. Hoje o backend ainda é Supabase; o alvo é a API FastAPI em
`backend/app/`. Ao mexer em qualquer coisa, prefira a direção nova: não acrescente dependência do
Supabase que depois vai ter que ser desfeita.

Sair do Supabase é substituir **cinco** subsistemas, não só o banco — dimensione o trabalho por esta
tabela, medida no código:

| Subsistema | Uso hoje no front | Destino |
|---|---|---|
| Banco (via RLS, direto do browser) | 83 `supabase.from()` | endpoints FastAPI |
| Edge Functions | 55 `functions.invoke()` | routers FastAPI |
| Auth | 38 chamadas (`getSession`, `signInWithPassword`, …) | JWT próprio (PyJWT + bcrypt) |
| Storage | 28 chamadas | `UPLOADS_DIR` na VPS ou S3 |
| Realtime | 39 usos de `postgres_changes` | WebSocket ou polling |

São **113 arquivos** de `frontend/src/` importando o client do Supabase.

## Estrutura

Monorepo `frontend/` + `backend/`, mesma convenção dos outros sistemas da HS
(TalentHS, TaskHS, GestorHS):

```
frontend/          React + Vite (o app inteiro de hoje)
backend/
  app/             API FastAPI — esqueleto, a preencher pela portagem
  migrations/      000 (compat Supabase) + 001 (schema public) — validados
  supabase/        as 73 Edge Functions: backend vivo hoje, fonte da portagem
docs/              auditoria e resumos herdados do dn.os
docker-compose.yml backend:8000 + frontend:80
```

**`backend/supabase/` é um placar.** Cada Edge Function portada para um endpoint FastAPI
sai de lá. Quando a pasta esvaziar, a saída do Supabase acabou.

## Comandos

Frontend — rodar sempre a partir de `frontend/`:

```bash
cd frontend
npm install          # não há lockfile canônico definido — ver "Gerenciador de pacotes" abaixo
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
uvicorn app.main:app --reload --port 8000 # http://localhost:8000/docs
```

Stack completa: `docker compose up -d --build` na raiz.

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
- **Gerenciador de pacotes indefinido:** convivem `bun.lock`, `bun.lockb` e `package-lock.json`, e não
  há `packageManager` nem `engines` no `frontend/package.json`. Escolha um, apague os outros e registre a escolha
  aqui — enquanto isso não for feito, installs podem divergir entre máquinas.
- **`.env` não é mais versionado** (corrigido na reestruturação). Cada lado tem o seu:
  `frontend/.env` e `backend/.env`, ambos ignorados, com `.env.example` versionado ao lado.
- Os docs citam a tag de restauração `v1.0-pre-consolidacao` (commit `34f4a7e8`). **Ela não existe
  neste repositório** — o remix veio sem histórico (2 commits). Não conte com esse rollback.

## Arquitetura

### Três camadas

```
React SPA (Vite)  ──►  Supabase  ──►  OpenClaw Gateway (VPS)
                       Postgres          agentes + LLM (DeepSeek)
                       73 Edge Functions
```

**Regra central de segurança: o navegador nunca fala com o gateway usando o token.** Todas as chamadas
ao gateway passam por Edge Functions que guardam o token do lado servidor. `frontend/src/lib/gateway.ts` só
lê/grava configuração e faz cache — não é um cliente HTTP do gateway.

### Resolução da config do gateway

Duas implementações espelhadas que precisam continuar concordando:

- Front: `frontend/src/lib/gateway.ts`
- Edge: `backend/supabase/functions/_shared/gateway-config.ts`

Ambas seguem a mesma ordem: **tabela `public.vps_config` primeiro** (`gateway_url`, `admin_token`;
configurável em Settings → Gateway, só `super_admin`), com as env `OPENCLAW_GATEWAY_URL` /
`OPENCLAW_ADMIN_TOKEN` como fallback para quando a linha ainda não existe. Não há URL default
hardcoded — instalação nova sem config recebe um 503 padronizado
(`gatewayNotConfiguredResponse`).

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
localStorage.setItem('dnos_flag_real_stop', 'on')                  // /stop real no gateway
localStorage.setItem('dnos_flag_structured_errors', 'on')          // reconhece erro do gateway (HTTP 200 + JSON)
localStorage.setItem('dnos_flag_fix_overflow_falsepositive', 'on') // só reseta sessão em erro real
localStorage.setItem('dnos_flag_reorder_prompt', 'on')             // reordena prompt p/ cache do modelo
```

Todas definidas em `frontend/src/lib/chat-sender.ts`. Desligar volta ao comportamento antigo na hora, sem deploy.
Se o rebrand renomear o prefixo `dnos_`, lembre que isso **desliga silenciosamente** as flags de quem já
estava com elas ativas.

### Estado e persistência

- **`app_settings` (tabela) substituiu o `localStorage` para configuração** — ver `frontend/src/lib/app-settings.ts`,
  com cache em memória. As exceções deliberadas ainda em `localStorage`: as feature flags acima e o cache
  de branding (`dnos-branding-cache`).
- Dados de servidor: **TanStack Query**, um `QueryClient` global em `frontend/src/App.tsx`.
- Contextos React são poucos e específicos: `AuthProvider` (`frontend/src/components/AuthGuard.tsx`),
  `FileSystemProvider`, `ThemeProvider`.

### Autorização

Três papéis: `super_admin`, `member`, `user` (`frontend/src/hooks/use-auth.ts`), guardados na tabela `user_roles`
e checados no banco pela função `has_role` (usada nas políticas de RLS). No front, `ProtectedRoute`
recebe `allowedRoles`. `/monitoring` e `/analytics` são só `super_admin`; `/setup` também.

Instalação zerada não tem usuário e não há cadastro público — a tela de login detecta isso e oferece criar
o primeiro admin via `bootstrap-first-admin`, que cai direto no wizard de `/setup`.

### Roteamento

Todas as rotas ficam em `frontend/src/App.tsx`, em `<Routes>` aninhados. Quatro categorias:

1. **Públicas** — `/login`, `/reset-password`, `/artifact/:id`, `/p/:slug`, `/wiki-html-preview`
2. **Autenticadas sem layout** — `/warroom` (tela cheia para TV), `/setup` (wizard)
3. **Autenticadas com `AppLayout` + `OnboardingGate`** — todo o resto
4. **Redirects legados** — `/dnos`, `/mission-control`, `/users`, `/documentation` caem em abas de `/settings`

`/` redireciona para `/chat`. Existem páginas em `frontend/src/pages/` que **não estão mais roteadas**
(`ChannelsPage`, `ProfilePage`, `UsersPage`, `DocumentationPage`, `Index`, `MissionControlDossierPage`) —
foram absorvidas por outras telas. Não presuma que um arquivo em `pages/` está em uso; confira `App.tsx`.

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

**Dois IDs de projeto Supabase de terceiros continuam hardcoded** — vão quebrar em instalação própria:

| Onde | ID | O que é |
|---|---|---|
| `frontend/src/hooks/use-branding.ts:93` | `zozyfhisrbkqvdcsdbfp` | URL da Edge Function `manifest` — aponta para outro projeto, não para o próprio |
| `backend/supabase/functions/marketing-analytics-proxy/index.ts:4` | `kfhojzdcnpuntynodsff` | `DNMARKETING_URL`, API de analytics da dn.ia |

Nomes de agentes da instância original (`lia`, `rock`, `milo`, `kira`, `radar`, `sigma`, `rodrigo`)
ainda aparecem como default em `frontend/src/hooks/use-agent-avatar.ts`, `channel-agent-reply`, `automations-api`
e nos YAMLs de documentação. A resolução do agente **líder/orquestrador** já foi corrigida para ser
dinâmica (via `agent_templates.is_leader_template`) em vez de assumir "lia" — não reintroduza o hardcode.

## Documentação que vale ler antes de mexer

| Arquivo | Conteúdo |
|---|---|
| `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` | 507 linhas, 49 achados de segurança/estabilidade catalogados A1–A19, B1–B10, com sintoma → causa raiz. Referência obrigatória para o caminho do chat. |
| `docs/RESUMO-CONSOLIDACAO-2026-07-18.md` | O que foi corrigido em cada bloco (0 remix-ready, 1 segurança, 2 estabilidade, 3 velocidade — pausado) |
| `docs/RESUMO-TECNICO-PARA-LIA-2026-07-18.md` | Contratos técnicos acordados com o lado do gateway (formato de `sessions_list`, dedup de heartbeat, verificação de `SOUL.md` no onboarding) |
| `docs/REMIX_SECRETS.md` | Lista real das env das Edge Functions, levantada do código. Diz explicitamente que a chave do LLM dos agentes fica no VPS/OpenClaw, não aqui. |
| `.lovable/plan.md`, `.lovable/remix-audit.md` | Contexto da origem Lovable |

## Convenções

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
