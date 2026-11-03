# HS.OS no celular — interface própria (plano)

> **Para quem executa:** superpowers:executing-plans (execução direta, combinada com o Erick). Passos com `- [ ]`.

**Objetivo:** no celular (< 768px), `/` e `/chat` passam a renderizar um app próprio (`frontend/src/celular/`), com a cara do protótipo aprovado, usando os mesmos dados e a mesma lógica do desktop.

**Arquitetura:** `App.tsx` decide entre `AppLayout` (desktop e outras rotas) e `AppCelular` (fora do `AppLayout`, dentro do `NotificationsProvider`). A pilha de telas é derivada da URL (`?agent`, `?channel`, `?thread`, `?painel`, `?aba`), então o voltar do Android desempilha. A lógica que hoje está presa em `ChatPage`/`ChannelChat` é **movida** (não copiada) para hooks/`lib` e usada pelos dois lados.

**Stack:** React + Vite + TanStack Query, `lucide-react`, Vitest; FastAPI + pytest no endpoint de prévia.

**Spec:** `docs/superpowers/specs/2026-11-03-app-celular-design.md` · protótipo `docs/superpowers/specs/2026-11-03-app-celular-prototipo.html` (fonte da verdade visual).

## Restrições globais

- Desktop em 1280 idêntico: screenshots antes/depois (`docs/fotos_doc/app-celular/desktop-antes|depois`), diff de pixels = 0.
- Não reimplementar regra de negócio: envio/fila (`chat-sender`), recibos, reações, threads, anexos (`useChatMedia`), áudio (`useAudioRecorder` + `/ia/transcrever`), silenciar, tempo real (`assinar`).
- Tokens do protótipo copiados literalmente (`--bg`, `--chat`, `--mine`, … claro e escuro), escopados em `.app-celular` para não tocar no tema do desktop.
- Tamanhos em px como no protótipo; campo do composer em 16px; nada cortado com `html{font-size:130%}`; sem scroll horizontal em 360/390/412.
- Backend: sem migração. Endpoint novo com teste pytest.
- Proibido: merge, push, deploy, migração aplicada, produção, gateway.

## Review Focus

1. **Link profundo sem histórico** (push abre `/chat?channel=X&thread=Y` direto): voltar desempilha para o canal e depois para a lista, não sai do app. → teste de `urlDoPai`.
2. **`?channel=` de DM de agente** (canal de DM cujo membro é agente): abre a conversa com o agente, como o desktop. → teste de `pilhaDaUrl` com o mapa DM→agente.
3. **Pessoa sem DM ainda**: aparece em Pessoas, sem prévia, embaixo; tocar cria a DM (`findOrCreateDm`). → teste de `montarLista`.
4. **Fonte 1.3 / nome longo**: hora e contador não saem da tela. → CSS `min-width:0` + screenshot 360 com 130%.
5. **Ação da mensagem igual ao desktop**: a folha do celular recebe o mesmo array do `MenuDaMensagem` (inclusive "Apagar para mim", "Editar" só do autor, canal de avisos sem composer). → testes de `acoesDaMensagemDoCanal`/`acoesDaMensagemDoAgente`.

---

### Task 1: Endpoint de prévia `GET /channels/previas`

**Files:** Create `backend/app/previas.py`, `backend/tests/test_previas.py`; Modify `backend/app/routers/channels.py` (rota antes de `/{channel_id}/…`, junto de `/silenciados`).

**Interfaces — Produces:** `texto_da_previa(content: str|None, attachments: list|None, audio_url: str|None, apagada: bool) -> str` (sem markdown, espaço único, ≤ 120 caracteres com `…`; só anexo → `📎 <nome>`; só áudio → `🎤 Áudio`; apagada → `Mensagem apagada`). Rota devolve `list[{channel_id, texto, autor_id, autor_nome, autor_tipo, created_at}]`, a última mensagem de nível de cima (`thread_id IS NULL`) **visível para mim** (`_VISIVEL_PARA_MIM`) de cada canal de que sou membro (`DISTINCT ON`). Não lidas não vêm daqui: o front usa as do sininho, que são a fonte única hoje.

- [ ] Testes: markdown (`**R$ 1**`, `- item`, `` `x` ``, links `[a](b)`) vira texto; 121+ caracteres corta em 120 com `…`; anexo/áudio/apagada; a rota usa `_VISIVEL_PARA_MIM` e `thread_id IS NULL` (inspect, padrão do `test_apagar_para_mim`); com conexão falsa, a rota mapeia as linhas.
- [ ] `cd backend && python -m pytest tests -q` verde. Commit.

### Task 2: Extrair do desktop o que o celular precisa (sem mudar o desktop)

**Files:** Create `frontend/src/lib/acoes-da-mensagem.ts` (+ test), `frontend/src/lib/envio-no-canal.ts`, `frontend/src/lib/transcrever-audio.ts`, `frontend/src/hooks/use-conversa-agente.ts`, `frontend/src/hooks/use-conversa-ativa.ts`, `frontend/src/lib/nao-lidas-do-agente.ts` (+ test). Modify `ChatPage.tsx`, `ChannelChat.tsx`.

**Interfaces — Produces:**
- `acoesDaMensagemDoCanal(msg, ctx: { souAutor, aoResponderThread, aoMarcarNaoLida, aoEditar, aoApagar, aoDados?, aoApagarParaMim? }): AcaoDaMensagem[]` — o array que hoje o `MessageBubble` monta, igual.
- `acoesDaMensagemDoAgente(msg, agentId): AcaoDaMensagem[]` — movida do `ChatPage`.
- `naoLidasDoAgente(agentId, mapaDm, unreadByChannel, unreadByAgentOnly): number`.
- `transcreverAudio(blob): Promise<string>` (lança em erro; `/ia/transcrever`, campo `arquivo`).
- `envio-no-canal.ts`: `nomeDeQuemEscreve(profile, user)`, `enviarNoCanal(ctx, { texto, anexos?, threadRaiz? })`, `enviarAudioNoCanal(ctx, blob, threadRaiz?)`, `editarNoCanal(canalId, msgId, texto)`, `apagarNoCanal(canalId, msgId)`, `apagarParaMimNoCanal(canalId, msg, { esconder, reexibir, aoApagar })` — o miolo dos handlers do `ChannelChat` (send + `notifyChannelRecipients` + `startChannelAgentReplies`), com os mesmos textos de toast.
- `useConversaAgente(agentId, { aoGravarPergunta?, aoSincronizar? })` → `{ mensagens, temMais, carregandoMais, trabalhando, textoParcial, reconectando, messagesByAgent, setMessagesByAgent, messagesByAgentRef, appendAgentMessage, upsertAgentMessage, updateAgentHistory, despachar, pararResposta, tentarDeNovo, carregarAnteriores(container?), novaConversa, enviarVoz(blob) }` — estado e efeitos movidos do `ChatPage` (histórico com cache, eventos do `chat-sender`, `usuario:<id>` + visibilidade, reconciliação 3,5s/20s).
- `useConversaAtivaNasNotificacoes({ agentId, canalId })` — os três efeitos de "conversa ativa" do `ChatPage` (setActiveAgentId, marcar lidas com varredura de 2s, setActiveChannel/Agent, varredura no foco).

- [ ] TDD dos puros (`acoes-da-mensagem.test.ts`, `nao-lidas-do-agente.test.ts`).
- [ ] Mover o código; `ChatPage`/`ChannelChat` passam a chamar as funções. `npm run test` (testes existentes do `ChannelChat` ficam verdes), `npm run build`. Commit.

### Task 3: Remover o mobile da Frente C de `ChatPage`/`ChannelChat`

**Files:** Modify `ChatPage.tsx`, `ChannelChat.tsx`, `ThreadPanel.tsx`, `AppLayout.tsx`, `ChannelFilesPanel.tsx`, `ChannelMembersPanel.tsx`, `PainelDoChat.tsx`, `ContextWindowIndicator.tsx`; testes da Frente C que testavam só o celular desses componentes.

- [ ] Cada `isMobile ? A : B` dentro do chat fica `B` (o ramo desktop, intacto). Some: tela cheia condicional, ⋮ do celular, folhas de toque, `MobileAgentChips`, layout `if (isMobile)` da lista. Ficam: `toque-longo`, `acoes-do-toque`, `previa-da-mensagem`, `use-mobile-chat-viewport` (usados pelo app novo). `AppLayout` perde `conversaEmTelaCheia` (o celular não passa mais por ele no chat).
- [ ] `npm run test`, `npm run build`, `npm run lint`. Commit.

### Task 4: Pilha ↔ URL e a casca do app

**Files:** Create `frontend/src/celular/pilha.ts` (+ test), `AppCelular.tsx`, `celular.css`, `Icones.tsx` (reexporta lucide), `Avatar.tsx`, `Folha.tsx`, `Menu.tsx`. Modify `App.tsx`, `theme-provider.tsx` (`enableSystem`, para o "Sistema" do Eu; padrão continua `dark`).

**Interfaces — Produces:**
- `type Tela = {tipo:"inicio", aba:"conversas"|"atividade"|"eu"} | {tipo:"agente", id} | {tipo:"canal", id} | {tipo:"thread", canal, raiz} | {tipo:"painel", painel: Painel, dono: {agente?:string; canal?:string}}`, `Painel = "arquivos"|"anteriores"|"contexto"|"participantes"|"busca"|"silenciados"`.
- `pilhaDaUrl(search: string, agenteDoCanal?: (canalId)=>string|null): Tela[]` — sempre começa em `inicio`.
- `urlDaPilha(telas: Tela[]): string`, `urlDoPai(search): string`.
- `usaAppCelular(isMobile: boolean, pathname: string): boolean` → `/` ou `/chat`.
- Abrir tela = `navigate(url)` (push). Voltar = `navigate(-1)` se há histórico dentro do app (`history.state.idx > 0`), senão `navigate(urlDoPai, {replace:true})`.
- [ ] Testes: lista → agente → painel → voltar; canal+thread; `?channel=` de DM de agente vira `agente`; `aba=eu`; `urlDoPai` de thread é o canal, de canal é `/chat`, de painel é a conversa.
- [ ] Commit.

### Task 5: Lista (Conversas)

**Files:** Create `celular/lista.ts` (+ test), `celular/use-lista.ts`, `celular/TelaInicio.tsx`, `celular/ListaDeConversas.tsx`.

**Interfaces:** `montarLista(entrada, filtro: "pessoa"|"agente"|"canal", busca): ItemDaListaCelular[]` com `{chave, tipo, nome, subtitulo, previa, minha, lida, hora(ms), naoLidas, silenciado, pensando, alvo}`; ordem = última mensagem (desc), quem nunca conversou no fim em ordem alfabética; busca casa nome **e** prévia (`casaBusca`). `horaDaLista(ms, agora)`: hoje `HH:MM`, ontem `ontem`, semana `seg`…, senão `dd/mm`.
- [ ] Testes de ordem, filtro, busca na prévia, pessoa sem DM, silenciado, pensando, `horaDaLista`.
- [ ] Topo "HS.OS", busca 44px, chips Pessoas·Agentes·Canais (abre em Pessoas), itens como o protótipo, abas Conversas·Atividade·Eu com contadores. Commit.

### Task 6: Conversa (agente, DM, canal) + thread

**Files:** Create `celular/TelaConversaAgente.tsx`, `TelaConversaCanal.tsx`, `TelaThread.tsx`, `Bolha.tsx`, `Composer.tsx`, `PlayerDeAudio.tsx`, `ondas.ts` (+ test), `use-gestos-da-bolha.ts` (+ test do puro `decidirGesto`).

- Cabeçalho (voltar, avatar, nome, subtítulo "Agente · Papel" / "pensando…" / "N participantes" / "online") e ⋮.
- Bolhas (`--mine`/`--theirs`, cauda na 1ª do grupo, autor colorido + avatar no canal, rodapé com hora e `VistoDaMensagem`, separador de dia, menção, citação, arquivo, áudio com ondas, reações em pílulas, "N respostas · ver thread", pensando com três pontos).
- Composer: emoji · textarea que cresce até 132px (16px) · clipe; botão mic/enviar; segurar grava, deslizar 90px à esquerda cancela, soltar envia (canal: `enviarAudioNoCanal`; agente: `enviarVoz`). Barra da resposta acima.
- Gestos: segurar 450ms abre folha (reações rápidas + ações da Task 2); deslizar à direita > 60px responde (canal: citação `> autor: trecho`; agente: citação no rascunho).
- Thread: tela cheia, mãe no topo, `useThreadMessages`, envio por `enviarNoCanal({threadRaiz})`.
- [ ] Testes: `ondasDe(seed, n)` determinístico e dentro de 20..90; `decidirGesto` (toque curto, segurar, deslizar, rolagem cancela). Commit.

### Task 7: Folhas, ⋮ e painéis em tela cheia

**Files:** Create `celular/FolhaDeAnexo.tsx`, `FolhaDeEmoji.tsx`, `TelaPainel.tsx`.
- Anexar: grade Documento · Câmera · Galeria · Documentos HS → `useChatMedia` (`pickFile`, input `capture`, `accept=image/*`; Documentos HS → `/files`).
- ⋮ agente: Arquivos da conversa, Conversas anteriores, Modelo e contexto, Nova conversa (confirmação do desktop). ⋮ canal/DM: Participantes/Ver perfil, Arquivos, Silenciar/Reativar (`useCanaisSilenciados`), Buscar na conversa.
- Cada item empilha uma tela cheia que reutiliza o conteúdo do desktop (`ChannelFilesPanel` embutido, `ConversasAnteriores`, `ContextWindowIndicator`+`ModelSelector`, membros, busca local na conversa).
- [ ] Commit.

### Task 8: Atividade e Eu

**Files:** Create `celular/atividade.ts` (+ test), `TelaAtividade.tsx`, `TelaEu.tsx`.
- `classificarAtividade(n: Notification, meuNome): "mencao"|"thread"|"agente"|null` — `agent_id` → agente; `author_name` com "(em conversa)" ou prévia com 💬 → thread; `@<meu nome>`/`@todos` → menção; resto `null` (não entra). Tocar abre a conversa certa.
- Eu: perfil, notificações neste celular (o liga/desliga de push que já existe), resumo em áudio (`useResumoEmAudio`), silenciadas, tema Sistema/Claro/Escuro (`next-themes`), Instalar app (`InstalarApp`), Documentos, Sair (`signOut`).
- [ ] Testes de `classificarAtividade`. Commit.

### Task 9: Verificação

- [ ] `npm run build && npm run test && npm run lint` (lint sem erro novo frente à `main`); `python -m pytest tests -q`.
- [ ] Screenshots 360×740, 390×844, 412×915, claro/escuro, e com `html{font-size:130%}`, em `docs/fotos_doc/app-celular/celular/`; conferir sem scroll horizontal (`scrollWidth <= innerWidth`).
- [ ] Desktop 1280 depois, diff por pixel contra `desktop-antes`.
