# HS.OS no celular — Frente C (visual do chat) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o `/chat` (agente, canal, DM, thread) usável só com o dedo de 360 a 430px, sem mudar um pixel do desktop.

**Architecture:** toda mudança visual fica atrás de `useIsMobile()` (< 768px) ou de CSS em `@media (max-width: 767px)`. A lógica nova que dá para testar sem DOM vai para `lib/` com Vitest: o detector de toque longo, a montagem das ações do toque e a regra de "conversa em tela cheia". As ações do toque longo são **o mesmo array** que alimenta o `MenuDaMensagem` do desktop — cada bolha monta a lista uma vez e entrega aos dois.

**Tech Stack:** React + Vite, Tailwind, shadcn/ui (`Drawer` do vaul, `Sheet` do Radix), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-11-03-mobile-conversas-design.md` (Frente C, itens 1–10).

## Global Constraints

- "Tudo atrás de `useIsMobile()` (< 768px). **No desktop nada muda.**" Conferido por screenshot 1280×800 antes/depois (`docs/fotos_doc/mobile-c/`), com diff de pixels.
- Não tocar `chat-sender.ts`, `agent-chat.ts`, `sw.ts`, notificações, backend, `index.html`, manifest.
- Long-press: "~450ms, cancela com `touchmove` > 10px ou rolagem"; reações rápidas "👍 ❤️ 😂 😮 🙏 e +"; `navigator.vibrate` onde existir.
- Composer: "Fonte de 16px no celular, inclusive no `contentEditable` do `RichComposer`". Alvos ≥ 44px. Bolha até 85%.
- Frente A: só o comentário `{/* integração: <InstalarApp variante="cartao" /> da Frente A entra aqui */}` no topo da lista mobile. Frente B: comentário marcando onde entra "Silenciar" no `⋮` do canal.
- Código, comentários e textos em português; hooks em kebab-case; toasts com `sonner`.

## Review Focus

1. **Rolar a lista com o dedo parado em cima de uma bolha** não pode abrir a folha de ações (o defeito do long-press atual). Teste: `toque-longo.test.ts › cancela quando a página rola`.
2. **Toque curto** (tap) não abre nada e não engole o clique em link/imagem dentro da bolha. Teste: `toque-longo.test.ts › soltar antes do prazo não dispara`.
3. **Mensagem otimista ou apagada** não abre folha (lista de ações vazia ⇒ nada). Teste: `acoes-do-toque.test.ts › sem ações nem reação, não há o que abrir`.
4. **Thread** não tem "Copiar" no menu do desktop; no toque ele precisa existir porque a seleção nativa some. Teste: `acoes-do-toque.test.ts › acrescenta Copiar quando falta e há texto`.
5. **Abrir uma conversa pelo link profundo** (`/chat?channel=…`) já no celular esconde cabeçalho e BottomNav; voltar para `/chat` os traz de volta. Teste: `tela-cheia.test.ts`.

---

### Task 1: Detector de toque longo (lógica pura + hook)

**Files:**
- Create: `frontend/src/lib/toque-longo.ts`, `frontend/src/lib/toque-longo.test.ts`, `frontend/src/hooks/use-toque-longo.ts`

**Interfaces:**
- Produces: `criarDetectorDeToqueLongo(opcoes: { aoDisparar: () => void; atrasoMs?: number /* 450 */; toleranciaPx?: number /* 10 */ }): { inicio(x: number, y: number): void; mover(x: number, y: number): void; fim(): void; rolou(): void; disparou(): boolean }` — usa `setTimeout`.
- Produces: `useToqueLongo(aoDisparar: () => void, ativo: boolean): { handlers: { onTouchStart; onTouchMove; onTouchEnd; onTouchCancel; onContextMenu }; pressionando: boolean }` — com `ativo=false` devolve handlers vazios. Enquanto pressiona, escuta `scroll` (captura) no `document` e chama `rolou()`. Ao disparar: `navigator.vibrate?.(10)`. `onContextMenu` faz `preventDefault` quando ativo (menu nativo do Android). `onTouchEnd` faz `preventDefault` se disparou (não vira clique).

- [ ] Testes (fake timers): `dispara depois de 450ms parado`; `soltar antes do prazo não dispara`; `mover mais de 10px cancela`; `mover até 10px não cancela`; `cancela quando a página rola`; `disparou() fica true só depois do disparo`.
- [ ] Rodar `npx vitest run src/lib/toque-longo.test.ts` → FAIL; implementar; → PASS.
- [ ] Commit `feat(chat-mobile): detector de toque longo que cancela com movimento e rolagem`.

### Task 2: Ações do toque + folha de baixo

**Files:**
- Create: `frontend/src/lib/acoes-do-toque.ts`, `frontend/src/lib/acoes-do-toque.test.ts`, `frontend/src/components/chat/AcoesDaMensagemNoToque.tsx`, `frontend/src/components/chat/AcoesDaMensagemNoToque.test.tsx`

**Interfaces:**
- Consumes: `AcaoDaMensagem` de `MenuDaMensagem.tsx`.
- Produces: `REACOES_RAPIDAS = ["👍", "❤️", "😂", "😮", "🙏"] as const`; `acoesDoToque(acoes: AcaoDaMensagem[], copia?: { texto: string; copiar: () => void }): AcaoDaMensagem[]` — acrescenta `{rotulo: "Copiar", icone: Copy}` no início se não houver ação "Copiar" e o texto não for vazio; senão devolve `acoes` intacto. `temOQueAbrir(acoes, podeReagir: boolean): boolean`.
- Produces: `<AcoesDaMensagemNoToque aberto aoMudar={(v: boolean) => void} acoes={AcaoDaMensagem[]} aoReagir?={(emoji: string) => void} />` — `Drawer`; com `aoReagir`, linha de reações rápidas + botão "+" que mostra o `EmojiPicker` (emoji-picker-react, largura 100%) dentro da folha; abaixo, cada ação como botão de 48px (perigo em `text-destructive`). Escolher ação ou reação fecha a folha e depois chama o callback.

- [ ] Testes: `acrescenta Copiar quando falta e há texto`; `não duplica Copiar`; `sem texto não acrescenta`; `sem ações nem reação, não há o que abrir`; componente: `mostra as ações e chama o callback`, `reação rápida chama aoReagir com o emoji`.
- [ ] FAIL → implementar → PASS. Commit `feat(chat-mobile): folha de ações da mensagem com reações rápidas`.

### Task 3: Toque longo nas bolhas (agente, canal/DM, thread) + horário por toque

**Files:**
- Modify: `frontend/src/components/chat/ChannelChat.tsx` (`MessageBubble`), `frontend/src/components/chat/ThreadPanel.tsx` (`ThreadMessageCard`), `frontend/src/pages/ChatPage.tsx` (`AgentMessageList`), `frontend/src/index.css`

**Interfaces:**
- Consumes: Task 1 e 2.
- `MessageBubble` ganha prop `toque?: boolean` (o `ChannelChat` passa `isMobile`). Com `toque`: os handlers do `useToqueLongo` substituem o long-press antigo de 500ms; a seta e o "reagir" de hover não são desenhados; a folha recebe **o mesmo `acoesDoMenu`** e `aoReagir = onToggleReaction`; tocar numa mensagem `continuacao` alterna a hora ao lado. Sem `toque`, o JSX é o de hoje.
- `ThreadMessageCard` monta `acoesDaResposta` (Editar/Apagar, as mesmas da barra do desktop) e a barra do desktop passa a ser desenhada a partir dela, com as mesmas classes; no toque, `acoesDoToque(acoesDaResposta, {texto, copiar})`.
- `AgentMessageList`: as ações da bolha saem de `acoesDaMensagemDoAgente(msg, isAgent, agentId)` (função do módulo, usada pelo `MenuDaMensagem` e pela folha); a lista tem **uma** folha, com o estado `{acoes} | null`.
- CSS: `[data-pressionando="true"]` desliga `user-select` e `-webkit-touch-callout` dentro da bolha (inclusive `.chat-message-content-selectable`), só em `max-width: 767px`.

- [ ] Rodar `npx vitest run src/components/chat` (testes existentes de `ChannelChat.*` e `MenuDaMensagem`) → PASS.
- [ ] Commit `feat(chat-mobile): segurar a mensagem abre as ações do menu`.

### Task 4: Conversa em tela cheia + cabeçalho enxuto com ⋮

**Files:**
- Create: `frontend/src/lib/tela-cheia.ts`, `frontend/src/lib/tela-cheia.test.ts`
- Modify: `frontend/src/components/AppLayout.tsx`, `frontend/src/pages/ChatPage.tsx` (cabeçalho mobile do agente, composer), `frontend/src/components/chat/ChannelChat.tsx` (cabeçalho e composer mobile), `frontend/src/components/chat/ContextWindowIndicator.tsx`

**Interfaces:**
- Produces: `conversaEmTelaCheia(pathname: string, search: string, isMobile: boolean): boolean` — `true` só com `isMobile`, `pathname === "/chat"` e `agent` ou `channel` na query.
- `AppLayout`: com tela cheia, não desenha o `<header>` nem a `BottomNav`.
- Cabeçalho do agente (mobile): seta, avatar+nome (toque alterna a linha de contexto), indicador "reconectando", artefatos (o `ArtifactsList` já é um botão compacto) e `⋮` (DropdownMenu) com: Copiar conversa, Conversas anteriores, Arquivos, Contexto e modelo, Nova conversa. A linha `ContextWindowIndicator` só aparece no celular quando ligada pelo menu/nome.
- Cabeçalho do canal (mobile): seta, ícone+nome (toque abre Membros) e `⋮` com Arquivos, Membros, Editar canal (se `canEdit`) e o comentário de integração da Frente B. Topo com `padding-top: env(safe-area-inset-top)`.
- Composer mobile (agente e canal): `paddingBottom` sem os 3.5rem — `calc(max(env(safe-area-inset-bottom, 0px), 8px) + 8px)`.
- `ContextWindowIndicator`: no celular, `Popover` em vez de `Tooltip`.

- [ ] Testes `tela-cheia.test.ts`: `lista do chat mantém cabeçalho`; `agente aberto no celular é tela cheia`; `canal aberto no celular é tela cheia`; `desktop nunca`; `outras rotas nunca`. FAIL → implementar → PASS.
- [ ] Commit `feat(chat-mobile): conversa em tela cheia com cabeçalho enxuto e menu ⋮`.

### Task 5: Painéis, pickers, teclado, `dvh`

**Files:**
- Create: `frontend/src/components/chat/PainelDoChat.tsx`
- Modify: `ChannelFilesPanel.tsx`, `ChannelMembersPanel.tsx`, `ChannelChat.tsx` (picker GIF/Emoji, `EmojiPicker` com `largura`), `ThreadPanel.tsx` (emoji do composer, `88vh`→`dvh`, Enter quebra linha no celular, remover anexo visível), `GifPicker.tsx` (`className` opcional), `ChatPage.tsx` (artefatos em Drawer, lightbox `dvh`), `ImageLightbox.tsx`, `PdfAttachmentPreview.tsx`, `FileAttachmentPreviewDialog.tsx`, `frontend/src/hooks/use-mobile-chat-viewport.ts`

**Interfaces:**
- Produces: `<PainelDoChat aberto aoFechar titulo largura="w-80" | "w-72">{conteúdo}</PainelDoChat>` — desktop: exatamente o backdrop + `div absolute … {largura}` de hoje; celular: `Sheet side="right"` de largura total, sem o X próprio do Sheet (o painel tem o seu), com safe-area em cima e embaixo.
- Download (arquivos), remover membro e remover anexo do composer: `opacity-100` no celular.
- `GifPicker({ onSelect, className? })`: `className` substitui a largura/altura fixas.
- Celular: Emoji e GIF do "+" do canal abrem `Drawer` de largura total; o emoji do composer da thread idem.
- Teclado: o `ChannelChat` deixa de aplicar `paddingBottom: bottomOffset` (o contêiner do `ChatPage` já aplica — `ChannelChat` só é renderizado lá); `use-mobile-chat-viewport` passa a escutar `visualViewport` `scroll`.
- `vh` → `dvh` nos pontos do "Estado atual" (no desktop `dvh` = `vh`).

- [ ] `npx vitest run src/components/chat` → PASS (inclui `ChannelFilesPanel.test.tsx`).
- [ ] Commit `feat(chat-mobile): painéis em Sheet, pickers em Drawer e uma só compensação do teclado`.

### Task 6: Composer, bolhas, lista, abas, BottomNav

**Files:**
- Modify: `frontend/src/index.css`, `ChatPage.tsx`, `ChannelChat.tsx`, `frontend/src/components/BottomNav.tsx`

- CSS (só `max-width: 767px`): `[contenteditable="true"]` com `font-size: 16px !important` (mesma regra que já vale para `input, textarea`).
- Botões do composer mobile (anexar, pasta, mic, enviar, "+"): `h-11 w-11`.
- Bolhas no celular: `max-w-[85%]`, `gap-2`, avatar `h-8 w-8` e espaçador de continuação `w-8`.
- Abas DMs/Agentes/Canais no celular: `min-h-[44px]`.
- Lista mobile de agentes: prévia da última mensagem (`lastMessages[agent.id].content`, que já vem de `/conversations/ultimas/por-agente`). DMs não têm prévia na API: fica só o horário (sem endpoint novo).
- Topo da lista mobile: comentário de integração da Frente A.
- `BottomNav` do colaborador: sai "Arenas" (tela pausada). Não há rota "Documentos" no app (Documentos é aba da Base de Conhecimento, que já está na barra), então a aba é tirada, não trocada.

- [ ] `npx vitest run` → PASS. Commit `feat(chat-mobile): composer de 16px, alvos de 44px, bolhas de 85% e prévia na lista`.

### Task 7: Verificação final

- [ ] `cd frontend && npm run build && npm run lint && npm run test` — lint sem erro novo em relação à `main`.
- [ ] Screenshots `depois-*` (360×740, 390×844, 1280×800 + painéis e menu) com a API simulada pelo Playwright; diff de pixels dos 1280 contra os `antes-*` = 0.
- [ ] Commit dos screenshots.
