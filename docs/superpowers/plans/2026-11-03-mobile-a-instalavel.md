# HS.OS no celular — Frente A (app instalável) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o HS.OS instala como app com o ícone da HS no Android e no iPhone, com botão/passo a passo dentro do sistema, e abre sem tela branca quando está sem rede.

**Architecture:** ícones gerados por script Python versionado; manifest e `index.html` corrigidos; uma lib pura `frontend/src/lib/instalacao-app.ts` (detecção de instalado/iOS, captura do `beforeinstallprompt`, regra dos 14 dias) com um hook fino em cima; um componente `InstalarApp` com duas variantes; SW com `NavigationRoute` para o `index.html` precacheado; um único aviso de atualização (o do SW).

**Tech Stack:** React + Vite, `vite-plugin-pwa` (`injectManifest`, `registerType: "prompt"`), `workbox-routing`/`workbox-precaching`, Vitest + Testing Library, Pillow (só no script de ícones).

**Spec:** `docs/superpowers/specs/2026-11-03-mobile-conversas-design.md`, seção "Frente A".

## Global Constraints

- Português no código, comentários e docs.
- **Não trocar o PWA para `autoUpdate`** (CLAUDE.md, seção PWA).
- Fundo dos ícones `#1885c8`; maskable com o símbolo dentro da área segura de 80%; apple-touch 180×180 sem transparência; badge 96 branco sobre transparente.
- Manifest: `id: "/"`, `scope: "/"`, `orientation: "any"`, `lang: "pt-BR"`, `description`.
- Fallback de navegação exclui `/api`, `/ws`, `/storage`, `/artifact`.
- Cartão dispensável volta **14 dias** depois de dispensado.
- Fronteiras com B e C: não editar `browser-notifications.ts`, `push-notifications.ts`, `NotificationsProvider`, `NotificationsPermissionBanner`, backend, `ChatPage.tsx`, `ChannelChat.tsx`, `AppLayout.tsx`, `BottomNav.tsx`, composer. No `sw.ts`, só precache e navegação.
- A3 (`user-scalable=no` sai) só vai para a `main` junto ou depois da Frente C.

## Review Focus

1. **`beforeinstallprompt` disparado antes de o React montar** — o evento chega uma vez, cedo; o botão tem que aparecer mesmo assim. Captura em nível de módulo, iniciada no `main.tsx`; teste: evento disparado antes do `assinar` é visto pelo assinante.
2. **iPad com iPadOS 13+ se apresenta como Mac** (`MacIntel` + toque) — sem tratar, o passo a passo some do iPad. Teste em `ehIos`.
3. **Chrome/Firefox no iPhone (CriOS/FxiOS)** não têm "Adicionar à Tela de Início" no mesmo lugar; o cartão ainda deve aparecer (todos usam WebKit e, desde o iOS 16.4, adicionam pelo menu Compartilhar). Teste: `CriOS` conta como iOS não instalado.
4. **Fallback de navegação servindo `index.html` para `/api/...` ou `/storage/...`** — quebraria download e API offline-first. Teste de unidade da allowlist/denylist (`ehNavegacaoDoApp`).
5. **`localStorage` indisponível** (Safari privado lança) — o cartão não pode quebrar a tela. Leitura/gravação em `try/catch`; teste com `getItem` lançando.

---

### Task 1: Ícones (A1)

**Files:**
- Create: `frontend/scripts/gerar_icones.py`, `frontend/scripts/previa-icones.png`
- Create/replace: `frontend/public/icons/{icon-192,icon-512,icon-maskable-512,apple-touch-icon,badge-96}.png`

- [ ] Script recorta o símbolo de `public/logo-hs-padrao.png` (primeiro bloco de colunas visíveis), redesenha em branco (azul → cheio, cinza → 55% de alfa, porque o azul do símbolo é o próprio fundo) e compõe sobre `#1885c8`.
- [ ] Rodar com Pillow num venv do scratchpad; conferir a prévia visualmente (192, maskable com máscara circular, 180, badge).
- [ ] Commit.

### Task 2: Manifest e `index.html` (A2, A3)

**Files:** Modify `frontend/public/manifest.json`, `frontend/index.html`

- [ ] Manifest: campos da seção Global Constraints; ícones `icon-192` e `icon-512` (`any`), `icon-maskable-512` (`maskable`); `background_color` `#1885c8` (a splash do Android usa ele com o ícone — fundo sólido igual dispensa splash do iOS).
- [ ] `index.html`: viewport `width=device-width, initial-scale=1.0, viewport-fit=cover`; `apple-touch-icon` → `/icons/apple-touch-icon.png`; `<meta name="mobile-web-app-capable" content="yes">`; tirar `author Lovable`, `og:image`, `twitter:image`, `twitter:site`; `twitter:card` vira `summary`.
- [ ] Verificar: `python3 -m json.tool public/manifest.json` e que cada `src` existe em `public/`.
- [ ] Commit.

### Task 3: `applyManifest()` (A4)

**Files:** Modify `frontend/src/hooks/use-branding.ts:118-157`

- [ ] Remover a troca do href do manifest (arquivo é o mesmo).
- [ ] `apple-touch-icon` dinâmico só quando o ícone do branding é quadrado: carregar com `new Image()` e só trocar o href se `naturalWidth === naturalHeight`; senão manter o estático. Função pura `ehQuadrado(largura: number, altura: number): boolean` exportada de `frontend/src/lib/instalacao-app.ts` (Task 4) — ou local, se evitar dependência circular; o teste dela fica no Task 4.
- [ ] Commit.

### Task 4: Lib de instalação (A5, parte pura)

**Files:**
- Create: `frontend/src/lib/instalacao-app.ts`, `frontend/src/lib/instalacao-app.test.ts`
- Create: `frontend/src/hooks/use-instalacao-app.ts`
- Modify: `frontend/src/main.tsx` (chamar `iniciarCapturaDeInstalacao()` antes do `render`)

**Interfaces (Produces — a Frente B usa as duas primeiras):**
- `type AmbienteNavegador = { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean; displayModeStandalone: boolean }`
- `lerAmbiente(): AmbienteNavegador` — lê `navigator`/`matchMedia`.
- `estaInstalado(amb = lerAmbiente()): boolean` — `displayModeStandalone || standalone === true`.
- `ehIos(amb): boolean` — iPhone/iPod/iPad no UA, ou `platform === "MacIntel" && maxTouchPoints > 1`.
- `ehIosNaoInstalado(amb = lerAmbiente()): boolean` — `ehIos && !estaInstalado`.
- `ehQuadrado(largura, altura): boolean`.
- `cartaoDispensadoVale(dispensadoEm: number | null, agora: number): boolean` — `true` enquanto não passaram 14 dias.
- `lerDispensa(): number | null` / `gravarDispensa(agora: number): void` — chave `hsos:instalar-app:dispensado-em`, com `try/catch`.
- `iniciarCapturaDeInstalacao(): void` — idempotente; guarda o `BeforeInstallPromptEvent` (com `preventDefault`) e limpa no `appinstalled`.
- `assinarInstalacao(fn: () => void): () => void`, `temPromptDeInstalacao(): boolean`, `pedirInstalacao(): Promise<"aceito" | "recusado" | "indisponivel">`.
- Hook `useInstalacaoApp(): { instalado: boolean; ios: boolean; podeInstalar: boolean; instalar: () => Promise<...> }` em `frontend/src/hooks/use-instalacao-app.ts` (também para a Frente B).

- [ ] Testes (falham primeiro): standalone por display-mode; por `navigator.standalone`; UA de iPhone Safari → `ehIosNaoInstalado` true; iPad como Mac com toque → iOS; Mac sem toque → não iOS; `CriOS` → iOS; Android Chrome → não iOS; `cartaoDispensadoVale(null, t)` false, `(t-13d, t)` true, `(t-14d, t)` false; `lerDispensa` com `getItem` lançando → `null`; evento `beforeinstallprompt` antes de assinar → `temPromptDeInstalacao()` true e assinante notificado; `appinstalled` → false; `ehQuadrado(512,512)` true, `(1910,823)` false.
- [ ] Implementar; `npx vitest run src/lib/instalacao-app.test.ts` verde.
- [ ] Commit.

### Task 5: Componente `InstalarApp` (A5, tela)

**Files:**
- Create: `frontend/src/components/InstalarApp.tsx`, `frontend/src/components/InstalarApp.test.tsx`
- Modify: `frontend/src/pages/SettingsPage.tsx` (aba Perfil, logo depois de `<PreferenciaResumoEmAudio />`)

**Interfaces:** `export function InstalarApp({ variante }: { variante: "cartao" | "entrada" })`.

- Instalado → `null` nas duas variantes.
- `podeInstalar` → botão "Instalar o app".
- iOS não instalado → passo a passo: ícone Compartilhar → "Adicionar à Tela de Início" → abrir pelo ícone, com a frase de que **é isso que liga as notificações no iPhone**.
- Nem prompt nem iOS: `cartao` → `null`; `entrada` → texto curto dizendo para usar o menu do navegador (Chrome no Android: ⋮ → "Instalar app").
- `cartao` tem botão "Agora não" que grava a dispensa e some; volta depois de 14 dias.

- [ ] Testes: instalado → vazio; iOS → texto "Adicionar à Tela de Início" e "notificações"; cartão dispensado → some e grava a chave; prompt disponível → botão "Instalar o app" chama `prompt()`.
- [ ] Implementar e montar `variante="entrada"` em Configurações → Perfil. **Não** montar na lista do chat (fica para a integração com C).
- [ ] Commit.

### Task 6: SW — fallback de navegação e precache (A6)

**Files:**
- Create: `frontend/src/lib/navegacao-do-app.ts`, `frontend/src/lib/navegacao-do-app.test.ts`
- Modify: `frontend/src/sw.ts` (só o topo: precache + `registerRoute(new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist }))`)
- Modify: `frontend/vite.config.ts` (`injectManifest.globIgnores: ["setup-hostinger-*.png"]`)

**Interfaces:** `PREFIXOS_FORA_DO_APP = ["/api", "/ws", "/storage", "/artifact"]`, `ehNavegacaoDoApp(pathname: string): boolean`, `LISTA_NEGADA: RegExp[]` (para o `denylist` do Workbox).

- [ ] Testes: `/chat` true; `/` true; `/api/x`, `/ws`, `/storage/a/b`, `/artifact/123` false; `/apis` true (prefixo é segmento, não substring); cada `RegExp` da `LISTA_NEGADA` casa os mesmos casos.
- [ ] Implementar; build e conferir que `dist/sw.js` não lista `setup-hostinger` e que contém `index.html` no manifesto.
- [ ] Commit.

### Task 7: Um aviso de atualização só (A7)

**Files:** Modify `frontend/src/hooks/use-version-check.ts`

- [ ] O hook deixa de comparar fingerprint, mostrar toast e recarregar: só chama `registration.update()` (via `navigator.serviceWorker.getRegistration()`) no intervalo e ao voltar para a aba. Quem avisa é o `onNeedRefresh` do `main.tsx`. Comentário no topo explica que eram dois avisos sobrepostos.
- [ ] `npm run build`, `npm run lint` (comparar com a main), `npm run test`.
- [ ] Commit.
