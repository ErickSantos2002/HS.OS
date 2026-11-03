# HS.OS no celular: conversas, app instalável e notificações (design)

Data: 03/11/2026 · Pedido do Erick · Estado: aguardando aprovação

## Por que

As conversas são o centro do HS.OS hoje: conversa com agente, canais, DMs e
threads. As pessoas querem usar isso pelo celular como usam o WhatsApp. Isso
significa três coisas: o chat precisa caber e responder ao toque, o sistema tem
que se instalar como um app, e o celular precisa avisar quando chega mensagem ou
quando o agente responde, mesmo com o app fechado.

Hoje nenhuma das três funciona direito. O levantamento de 03/11/2026 está na
seção "Estado atual", e o pior achado é este: **o servidor nunca envia push.**

## Decisões do Erick (03/11/2026)

| tema | decisão |
|---|---|
| Instalação | **PWA instalável** pelo navegador, com botão/tutorial dentro do sistema. Sem loja, sem APK. |
| Aparelhos | **iPhone e Android**, notificações incluídas nos dois. |
| Alcance | **Só a parte de conversas** (`/chat`: agente, canais, DMs, threads). O resto do sistema fica como está; o que mais precisar volta depois que o chat estiver pronto. |
| O que notifica | **Mensagens e respostas**: resposta de agente, DM, menção em canal e mensagem em canal não silenciado. |
| Conversa aberta | **Só a conversa na tela**, estilo WhatsApp: some o cabeçalho do HS.OS e a barra de baixo, e volta-se pela seta. |
| Ações da mensagem | **Segurar a mensagem** abre uma folha de baixo com reações rápidas e a lista de ações. |
| Ícone | **Eu gero a partir do logo HS** e mostro antes de fechar. |
| Chaves VAPID | **Eu gero e o Erick cola no EasyPanel.** A privada não passa pelo chat. |

## Metas

1. No iPhone e no Android, de 360 a 430px de largura, dá para usar o chat
   inteiro só com o dedo: abrir conversa, ler, responder, anexar, gravar áudio,
   reagir, abrir thread, ver arquivos e membros. Nada fica escondido atrás de
   hover, nada vaza da largura da tela, e nada é coberto pelo teclado ou pela
   barra inferior.
2. O app instala com o ícone da HS. No Android aparece um botão "Instalar"; no
   iPhone, um passo a passo de "Adicionar à Tela de Início". Aberto pelo ícone,
   ele roda em tela cheia e respeita notch e barra de gestos.
3. Com o app **fechado** (instalado, no iPhone), o celular recebe notificação de
   resposta de agente, DM, menção e mensagem de canal não silenciado. Tocar na
   notificação abre a conversa certa.
4. Nada disso piora o desktop.

## Não-metas

- Outras telas fora do `/chat` (agentes, automações, configurações, conhecimento
  etc.). Elas ficam como estão, mesmo quebradas no celular.
- App de loja (Play/App Store), APK, Capacitor.
- Funcionar offline (ler conversa sem rede). Só um fallback para que abrir o app
  sem rede não dê tela branca.
- Preferências de notificação por tipo de evento. Na v1 há só ligar/desligar
  geral (já existe) e silenciar por canal.
- Deslizar a bolha para responder.

## Anti-metas: falharia mesmo "funcionando"

- **Push que chega e a resposta não está lá.** A notificação diz "Nina
  respondeu" e, ao abrir, a conversa ainda mostra "pensando". Notificação só sai
  depois que a mensagem está gravada.
- **Notificação em dobro.** Por exemplo, o push e a notificação local juntos, ou
  os dois workers do uvicorn enviando cada um a sua.
- **Notificar quem está olhando.** A pessoa com a conversa aberta e visível não
  recebe push dela.
- **Push que vaza conteúdo para outra pessoa.** Isso acontece com aparelho
  compartilhado depois do logout, ou com `user_id` arbitrário no `/push/enviar`.
- **Desktop regredindo** por causa de condicional de mobile.
- **Push silencioso no iOS.** Push sem notificação visível faz o Safari revogar a
  inscrição.

## Estado atual (levantado em 03/11/2026)

### Notificações

- `backend/app/routers/push.py` tem inscrição (`public.push_subscriptions`, que
  veio no dump), envio por `pywebpush` e limpeza de inscrição em 404/410. **Não
  há chamador no servidor.** Só o front chama `/push/enviar`: o lembrete de
  status em `use-user-status.ts:125` e o botão de teste nas Configurações.
- O elo antigo entre o sininho e o push era o trigger
  `trigger_send_push_on_notification` (`001:849-905`), que chamava a edge
  `send-push` do Supabase da dn.ia. Hoje está morto em silêncio.
- **VAPID não está configurado** em lugar nenhum (`config.py:62-66` vazio) nem
  documentado no `DEPLOY.md`. Sem chave, o front nem se inscreve.
- `browser-notifications.ts:73` deixa de mostrar a notificação local quando há
  inscrição de push ("o SW cuida"). Como o servidor nunca envia, **quem se
  inscreve perde as duas**.
- `POST /push/enviar` aceita qualquer `user_id` vindo de qualquer usuário
  logado. `webpush()` é síncrono dentro de rota `async`. O logout não remove a
  inscrição.
- `sw.ts:206` fecha a notificação depois de 6s; no celular ela some da bandeja.
  `setAppBadge(1)` é fixo.
- O payload não leva `channel_id`/`notification_id`, e por isso as ações
  Responder e Marcar como lida do SW não funcionam.
- Nada detecta iPhone fora da PWA instalada. O banner de permissão simplesmente
  some, porque `Notification` não existe no Safari comum.
- **Resposta de agente só é gravada com a tela aberta.** Quem busca a resposta
  no gateway é o `GET /conversations/{id}/reply`, chamado em laço pelo
  navegador, e o `/recuperar`, chamado ao abrir a tela. Não existe coletor no
  servidor. Se a pessoa fechar o app depois de perguntar, ninguém busca a
  resposta, e portanto não há o que notificar.
- Não existe "silenciar canal": nem coluna, nem tela.

### Instalação

- `manifest.json` declara `/HS-OS-logo.png` como `512x512`, mas o arquivo é um
  wordmark de 1910×823. Os `icons/icon-192/512.png` são do azul da dn.ia
  (`#3D61FF`), têm cantos transparentes e são "maskable" só no nome. Faltam
  `id` e `scope`. A orientação está travada em `portrait-primary`.
- O `apple-touch-icon` aponta para o wordmark. Não há splash do iOS.
- Não há `beforeinstallprompt` nem instrução para iOS (ela aparece só na
  documentação).
- O SW não tem fallback de navegação. Há dois avisos de atualização que se
  sobrepõem: `main.tsx` (toast do SW) e `use-version-check.ts` (reload próprio).
- A rota de manifest no backend não existe. `applyManifest()` só troca a query
  string do mesmo arquivo estático, e o branding não chega ao manifest.
- `index.html` tem `maximum-scale=1, user-scalable=no`.

### Chat no celular

- A lista e a conversa já se alternam, e o breakpoint é 768px. Isso é bom.
- Dentro da conversa aparecem o cabeçalho global (48px), o cabeçalho da
  conversa, a faixa do indicador de contexto, o composer com reserva de 3.5rem
  para a BottomNav, e a própria BottomNav. Sobra pouco para as mensagens.
- **Ações por hover:** a seta do `MenuDaMensagem`, o "reagir"
  (`ChannelChat:347`), o horário agrupado (`:460`), o remover anexo, os botões
  da imagem, o download no painel de arquivos e o remover membro. O long-press
  existente (`ChannelChat:279`) só mostra "reagir" e dispara durante a rolagem.
- Os painéis de **Arquivos** e **Membros** são `absolute w-80/w-72` e ficam
  atrás da BottomNav (`z-50`). Os **Artefatos** aparecem como `div h-[50vh]`
  empilhada. A **Thread** já é Drawer (vaul) e as **Conversas anteriores** já
  são Sheet.
- O `GifPicker` (380px) é mais largo que a tela; o `EmojiPicker` (320px) fica no
  limite.
- O teclado é compensado em dobro nos canais e DMs: `ChatPage:2858` e
  `ChannelChat:1721` aplicam o mesmo `bottomOffset`. `use-mobile-chat-viewport`
  não escuta o `scroll` do `visualViewport`.
- Há `vh` em vez de `dvh` no drawer da thread, nos artefatos, no lightbox e nos
  previews de PDF/arquivo.
- Bolha do agente com `max-w-[70%]` também no celular. Alvos menores que 44px:
  as abas DMs/Agentes/Canais, a seta do menu, reagir, editar canal.
- O composer de canal é `contentEditable` em `text-sm`. Hoje quem segura o zoom
  do iOS é o `user-scalable=no`.
- O Tooltip do indicador de contexto não abre no toque.

## O desenho

Três frentes independentes. Cada uma pode ir para um agente em branch própria
(convenção do Erick). A ordem de merge sugerida é A → B → C, mas nenhuma
depende do código das outras. O único ponto de contato é B usar o fluxo de
instalação de A para explicar o iPhone; se B chegar antes, o texto aponta para
o lugar onde A vai pôr o botão.

### Frente A: app instalável

1. **Ícones.** Gerar a partir do símbolo da HS (`public/logo-hs-padrao.png`;
   se ele não tiver um símbolo isolável, recortar do `HS-OS-logo.png`) sobre
   fundo sólido `#1885c8`:
   - `icon-192.png` e `icon-512.png` com `purpose: any`;
   - `icon-maskable-512.png` com o símbolo dentro da área segura de 80%;
   - `apple-touch-icon.png` em 180×180, sem transparência;
   - `badge-96.png` monocromático (branco sobre transparente), para a barra de
     status do Android.

   O script de geração fica versionado em `frontend/scripts/`. **Mostrar ao
   Erick antes do merge.**
2. **Manifest** (`public/manifest.json`): adicionar `id: "/"` e `scope: "/"`,
   trocar os ícones pelos do item 1, `orientation: "any"` (destravar tablets),
   `description` e `lang: "pt-BR"`. Screenshots ficam a critério de quem
   constrói.
3. **`index.html`:** `apple-touch-icon` para o 180 novo, `mobile-web-app-capable`,
   e remover `maximum-scale=1, user-scalable=no`. O zoom do iOS ao focar campo
   passa a ser resolvido por fonte de 16px no composer (frente C). **A e C
   precisam chegar juntos na main, ou C antes**, porque sem C o
   `contentEditable` em `text-sm` volta a dar zoom no iPhone. Tirar os restos
   do Lovable (author, og:image).
4. **`applyManifest()`** em `use-branding.ts`: deixar de trocar o href do
   manifest, porque o arquivo é o mesmo e a troca só gera ruído. O
   `apple-touch-icon` dinâmico só vale se o ícone do branding for quadrado;
   senão fica o estático.
5. **Fluxo de instalação**, componente novo `InstalarApp`:
   - Android/desktop Chrome: captura `beforeinstallprompt` e mostra um botão
     "Instalar o app".
   - iPhone/iPad no Safari, fora do standalone: um cartão com o passo a passo
     (ícone Compartilhar → "Adicionar à Tela de Início"), dizendo **que é isso
     que liga as notificações no iPhone**.
   - Já instalado (`display-mode: standalone` ou `navigator.standalone`): não
     aparece.
   - Onde aparece: um cartão dispensável no topo da lista de conversas no
     celular, que volta depois de 14 dias se for dispensado, e uma entrada fixa
     em Configurações → Perfil.
6. **SW:** fallback de navegação para o `index.html` precacheado
   (`NavigationRoute`), excluindo `/api`, `/ws`, `/storage` e `/artifact`. Tirar
   do precache o que não é app (`setup-hostinger-*.png`, scripts `.sh`).
7. **Um aviso de atualização só.** Fica o toast do SW (`main.tsx`). O
   `use-version-check` deixa de recarregar sozinho e passa só a chamar
   `registration.update()`. Não trocar para `autoUpdate` (ver CLAUDE.md).

**Aceite A:** Lighthouse/Chrome DevTools sem erro de manifest. Instala no
Android pelo botão. No iPhone, adicionar à tela mostra o ícone HS e abre em tela
cheia. Abrir sem rede mostra o app, não a tela do navegador.

### Frente B: notificações

**B1. O backend envia push** (módulo novo `app/push_envio.py`, puro onde der e
testado):

- `enviar_para(user_id, payload)`: lê as inscrições e envia com `pywebpush` em
  thread (`asyncio.to_thread`). Em 404/410 remove a inscrição. Em erro, loga e
  segue; push é acessório e nunca derruba a rota que o chamou.
- **Disparo pelo banco, igual ao recibo de mensagem:** um `pg_notify` num canal
  próprio (`push_pendente`), a partir de trigger em `channel_messages` e em
  `conversations` (só no papel de agente), e o `escuta_banco` encaminha. Motivo:
  são 2 workers, e enviar de dentro da rota obriga a lembrar de cada caminho que
  grava mensagem (`channels.py:793`, `:1115`, `broadcast.py`, `/reply`,
  `/recuperar`, o coletor de B2). **O banco vê todos.**
- **Deduplicação entre workers:** os dois workers recebem o `NOTIFY`. Quem envia
  é quem reservar primeiro, com `INSERT … ON CONFLICT DO NOTHING` numa tabela
  `push_enviados(mensagem_id, user_id)` (migração nova). É o mesmo padrão do
  guardião de crons, com a vantagem de deixar rastro.
- **Quem recebe:**

  | evento | destinatário |
  |---|---|
  | resposta de agente na conversa direta | a pessoa da conversa |
  | mensagem em DM | o outro membro humano |
  | mensagem em canal/grupo | membros humanos, menos o autor e quem silenciou o canal |
  | menção em canal | o mencionado, **mesmo com o canal silenciado** |
  | resposta em thread | autor da mensagem-mãe e quem já respondeu na thread, menos o autor |

  Agente nunca recebe. Desligar notificações é por aparelho e apaga a
  inscrição (esclarecimento 4), então não há filtro de preferência aqui.
- **Não notificar quem está olhando:** o servidor não sabe o que está visível,
  então quem decide é o SW. Ao receber o push, ele consulta `clients.matchAll`.
  Se algum cliente **visível e com foco** estiver naquela conversa (o app avisa
  o SW por `postMessage` qual conversa está aberta), ele não mostra notificação
  e só repassa ao cliente. ⚠️ No iOS, push sem notificação visível revoga a
  inscrição. **No iOS o SW sempre mostra**, e o app em primeiro plano fecha a
  notificação logo em seguida (`getNotifications({tag}) → close`).
- **Payload:** `title` (nome do agente/pessoa, ou "Pessoa em #canal"), `body`
  (prévia de até 140 caracteres, sem markdown; anexo vira "📎 arquivo", áudio
  vira "🎤 áudio"), `url` profunda (`/chat?agent=…`, `/chat?channel=…`,
  thread), `tag` por conversa (uma notificação por conversa, que se substitui
  com `renotify: true`), `channel_id` quando houver (sem `notification_id`, ver esclarecimento 1).
- **Fechar o `POST /push/enviar`:** fica só para o próprio usuário (teste e
  lembrete de status). `user_id` diferente do token responde 403.
- **Logout remove a inscrição deste aparelho** (`unsubscribeFromPushNotifications`
  no fluxo de sair, antes de limpar o token).
- **VAPID:** eu gero o par. A pública e as três variáveis vão para o clipboard
  do Erick; a privada ele cola no EasyPanel direto de um arquivo local que eu
  aponto. O `DEPLOY.md` ganha a seção. Sem as variáveis, o backend sobe e loga
  uma vez "push desligado: VAPID ausente".
- **Remover o trigger morto** `trigger_send_push_on_notification` numa migração
  (ele chama URL de terceiro se um dia existir o schema `net`).

**B2. Coletor de respostas no servidor** (`app/coletor_respostas.py`, tarefa no
`lifespan` como o vigia):

- A cada ~5s procura em `agent_runs` os runs sem `message_id`, com menos de 30
  min, cujo `/reply` não foi chamado nos últimos ~20s, ou seja, sem tela
  esperando. Busca a resposta no gateway pelo **mesmo caminho** do `/reply`
  (`chat.history` com `maxChars`, `limit=40`, piso por `seq_depois`) e grava por
  `_gravar_resposta`, que já tem trava contra bolha dobrada. A gravação dispara
  o trigger de B1.
- **Extrair, não duplicar:** a lógica de "ler o histórico e decidir se há
  resposta" que hoje mora dentro da rota `/reply` vira função reaproveitada
  pelos dois. Os defeitos do `chat.history` catalogados no CLAUDE.md (corte de
  8.000, fatia velha, piso que vira teto, sessão limpa) moram nela, e duas
  cópias divergiriam.
- Reserva por run entre os 2 workers (`UPDATE … SET coletando_em = now() WHERE
  … AND (coletando_em IS NULL OR coletando_em < now() - interval '30 s')
  RETURNING`).
- Precisa de coluna de "última vez que a tela perguntou" em `agent_runs`
  (migração). Quem constrói decide o nome.

**B3. Front:**

- `browser-notifications.ts`: a notificação local só é suprimida quando o push
  está de fato ativo **e** o servidor o confirmou (`/push/inscricoes/contagem`
  > 0 para este endpoint). Sem isso, volta a mostrar a local.
- Tirar o auto-fechamento de 6s no SW e no local.
- Badge do ícone: o SW soma por `tag`; o app zera ao abrir a conversa. Se não
  der para contar com precisão, `setAppBadge()` sem número (ponto) em vez de
  "1" fixo.
- Ícone `badge` monocromático (de A; enquanto não chegar, fica o atual).
- **Fluxo de permissão por aparelho:**
  - iPhone no Safari, não instalado: o banner diz "Para receber notificações no
    iPhone, instale o app" e abre o passo a passo de A.
  - iPhone instalado ou Android: botão "Ativar notificações", pedindo
    permissão no clique, sem `await` antes do `requestPermission`.
  - Negado: explica como reativar nos ajustes do aparelho. Não reaparece a cada
    7 dias.
- O app informa ao SW a conversa aberta e visível (`postMessage` em
  `visibilitychange` e na troca de conversa).
- Tocar na notificação foca o cliente existente e navega; sem cliente, abre a
  `url`. Conferir que `?focus=composer` é tratado, ou remover.
- **Silenciar canal:** coluna `channel_members.silenciado boolean default
  false` (migração), opção "Silenciar" no menu do canal (desktop e celular) e
  ícone de sino cortado na lista. Silenciar também corta o som e a notificação
  local daquele canal. **Decisão minha**: o Erick escolheu "mensagem em canal
  não silenciado" e o silenciar ainda não existia.
- O som (`notification-sound.ts`) passa a reusar um `AudioContext` só.

**Aceite B** (no aparelho de verdade, não só no DevTools):

- Android Chrome instalado e iPhone instalado (iOS ≥ 16.4), com o app fechado,
  recebem push de: resposta de agente pedida antes de fechar o app, DM, menção
  e mensagem de canal. Canal silenciado não notifica, menção nele sim.
- Com a conversa aberta na tela, não aparece notificação dela no Android; no
  iPhone ela some sozinha.
- Tocar abre a conversa certa. Dois workers não geram duas notificações.
  Depois do logout, o aparelho não recebe mais.
- Testes de backend: destinatários por evento, dedup, 403 do `/enviar`, montagem
  do payload, e seleção de runs do coletor (com conexão falsa, padrão do repo).

### Frente C: visual do chat no celular

Tudo atrás de `useIsMobile()` (< 768px). **No desktop nada muda.**

1. **Conversa em tela cheia.** Com uma conversa (agente, canal, DM) aberta no
   celular, o `AppLayout` esconde o cabeçalho global e a `BottomNav`. O
   cabeçalho da conversa assume o topo, com `safe-area-inset-top`. O composer
   encosta embaixo com `safe-area-inset-bottom` e perde a reserva de 3.5rem. A
   lista de conversas continua com cabeçalho e BottomNav.
2. **Cabeçalho da conversa enxuto.** Seta, avatar e nome (que abre detalhes) e
   um menu `⋮` que reúne o que hoje são 4 ou 5 ícones (arquivos, conversas
   anteriores, artefatos, limpar/nova conversa, membros, silenciar). A faixa do
   indicador de contexto e o seletor de modelo vão para dentro desse menu ou de
   uma linha fina recolhível; o detalhe vira Popover por toque, não Tooltip.
3. **Ações por toque.** Segurar a mensagem (~450ms, cancela com `touchmove` >
   10px ou rolagem) abre um **Drawer** de baixo: reações rápidas no topo
   (👍 ❤️ 😂 😮 🙏 e "+") e a lista com o que o `MenuDaMensagem` já oferece
   para aquela mensagem (responder, thread, copiar, editar, apagar para mim,
   marcar como não lida etc.). A **mesma fonte de ações** do menu do desktop,
   sem uma segunda lista para manter. Vibração curta (`navigator.vibrate`) onde
   existir. A seleção nativa de texto é desligada na bolha durante o gesto; o
   "Copiar" cobre a necessidade. Vale para conversa com agente, canal, DM e
   thread.
4. **Hover → toque.** No celular, o horário agrupado aparece ao tocar a
   mensagem, e os botões de anexo/imagem e o remover anexo do composer ficam
   sempre visíveis. Download e remover membro nos painéis também.
5. **Painéis viram Sheet/Drawer.** Arquivos e Membros: `Sheet` de tela cheia no
   celular, acima de tudo. Artefatos: Drawer de baixo em vez da `div` de 50vh.
   A Thread já é Drawer; trocar `88vh` por `dvh` e conferir com o teclado.
6. **Pickers.** GIF e Emoji no celular abrem em Drawer de largura total, em vez
   de popover de 380/320px.
7. **Teclado.** Uma só compensação de `bottomOffset`, no contêiner da
   conversa (tirar a do `ChannelChat:1721` quando renderizado dentro do
   `ChatPage`). `use-mobile-chat-viewport` escuta também `visualViewport`
   `scroll`. Ao abrir o teclado, a lista de mensagens mantém a última visível.
   Trocar `vh` por `dvh` nos pontos listados em "Estado atual".
8. **Composer.** Fonte de 16px no celular, inclusive no `contentEditable` do
   `RichComposer` (pré-requisito para A3). Enter quebra linha no celular e o
   botão envia (já é assim no do agente; igualar no de canal). Botões com
   alvo ≥ 44px.
9. **Bolhas e lista.** Bolha até 85% no celular, avatar menor ou oculto em
   mensagens agrupadas, `gap` menor. Abas DMs/Agentes/Canais com alvo ≥ 44px.
   Itens da lista com prévia da última mensagem e horário, se já vierem da API;
   **se não vierem, não criar endpoint para isso nesta entrega.**
10. **BottomNav (só o que toca o chat):** a aba "Arenas" do colaborador aponta
    para uma tela pausada; trocar por "Documentos" ou tirar. **Decisão minha**,
    por ser a navegação que sai do chat.

**Aceite C:** em 360×740 (Android) e 390×844 (iPhone), no aparelho:

- Abrir conversa com agente, canal, DM e thread, mandar texto, anexo, áudio e
  GIF, reagir, responder, apagar e editar, tudo sem hover e sem nada cortado.
- Teclado aberto sem faixa vazia e sem o composer coberto.
- Nenhum scroll horizontal.
- O desktop (1280px) visualmente idêntico ao de antes, conferido por screenshot
  antes e depois.

### Esclarecimentos da revisão (03/11/2026): decisões minhas

Pontos que a revisão do documento levantou. Nenhum muda o que o Erick escolheu;
estes são as minhas decisões técnicas.

1. **O push nasce da mensagem, não do sininho.** A `public.notifications`
   continua como está, só para o sininho. Ela não é a fonte certa: parte das
   linhas vem de uma rota que o próprio cliente chama (`/notificar`), e "marcar
   como não lida" não deve virar push. A regra de destinatários de B1 vale só
   para o push. Por isso o payload **não leva `notification_id`**. O "Marcar
   como lida" do SW marca a conversa como lida pelo `channel_id`, e para
   conversa com agente a ação nem aparece. O `notificacao_ler` existente
   continua para o sininho.
2. **Menção** é texto, como já é na tela: `@Nome` dentro de `content`. O
   servidor casa `@` seguido do nome de exibição de um membro humano do canal,
   sem diferenciar maiúscula de minúscula, e escolhe o nome mais longo que
   casar. Nome repetido notifica todos os homônimos. `@todos` (o "Aviso para
   todos" que a tela já tem, `EVERYONE_MENTION_REGEX`) **fura o silenciar de
   todo mundo**, porque é para isso que ele existe. Não entra coluna de menção
   estruturada nesta entrega. A regex mora num módulo puro, testada com os
   casos do `channel-notifications.ts`.
3. **O coletor de B2 faz tudo o que o `/reply` faria com a tela aberta**:
   grava, dispara o áudio de resumo (`voz_entrega.disparar`) e, se o contexto
   estourar, compacta e reenvia (`_compactar_e_reenviar`). Sem isso, quem fecha
   o app numa sessão cheia nunca recebe a resposta. O custo em token é o mesmo
   de quando a tela está aberta, e o `vigia_sessoes` já compacta antes na
   maioria dos casos. A função a extrair é, portanto, o miolo inteiro do
   `/reply` depois da validação do run, e a rota passa a ser uma casca em volta
   dela.
4. **Não existe preferência no servidor para "notificações desligadas"**, nem
   vai existir. Desligar é por aparelho, e desligar apaga a inscrição daquele
   aparelho (`DELETE /push/inscricao`, que passa a exigir login e conferir o
   dono). A linha correspondente de B1 foi ajustada.
5. **Silenciar corta push, som e notificação local**, e só isso. O canal
   silenciado continua gerando item no sininho e contador de não lidas na
   lista, como no WhatsApp. O filtro fica no envio do push (B1) e no
   `use-notifications` do front. As consultas de `notifications` e de não
   lidas não mudam.

## Restrições

- Português no código e nos docs. Testes de backend no padrão do repo:
  docstring dizendo o que o defeito custaria. Rodar `python -m pytest tests -q`
  antes de cada merge.
- **Migração não se aplica sozinha.** Cada migração nova (`push_enviados`,
  coluna em `agent_runs`, `channel_members.silenciado`, remoção do trigger
  morto) é aplicada por mim com `~/aplicar-hsos-NNN.py` e conferida contra o
  banco antes do deploy do código que a usa (lição de 18/09).
- O `chat.history` tem armadilhas catalogadas. O coletor de B2 reaproveita a
  função do `/reply`, não reimplementa.
- Não reintroduzir o token do gateway no front. Não trocar o PWA para
  `autoUpdate`.
- Fim de cada frente: merge local na `main` e push. O deploy é manual no
  EasyPanel.

## Deixado para quem constrói

- Nomes de componentes, colunas e funções novas (fora os citados).
- Se o coletor de B2 roda em laço próprio ou dentro do vigia.
- Screenshots no manifest. Splash screens do iOS (se o fundo sólido ficar bom,
  dispensar).
- Animações do Drawer e do long-press.
- Ordem interna dos itens do menu `⋮`.

## Riscos

- **Push no iOS** só existe com o app instalado e iOS ≥ 16.4, e a Apple derruba
  inscrição por push silencioso. Testar num iPhone real é obrigatório; o
  simulador não basta.
- O coletor de B2 entra no caminho mais delicado do sistema (o chat). Ele grava
  pelo mesmo `_gravar_resposta` com trava, mas uma corrida nova com `/reply`
  ou `/recuperar` é o risco a vigiar. Assinatura de bolha dobrada: ver CLAUDE.md.
- Esconder cabeçalho e BottomNav dentro da conversa muda a navegação. No iPhone
  instalado não há botão voltar do sistema, então a seta precisa estar sempre
  visível.
