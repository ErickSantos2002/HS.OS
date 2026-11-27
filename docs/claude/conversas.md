# Conversas — celular, push, conversa consigo mesmo, anteriores, vistos e não lida

> Saiu do `CLAUDE.md` em 23/11/2026 (o arquivo passou do teto de 150 mil caracteres
> de instruções do Claude Code). Texto movido sem edição. Leia antes de mexer na área.

### Celular: push, coletor de respostas e silenciar — 03/11/2026

Spec: `docs/superpowers/specs/2026-11-03-mobile-conversas-design.md`.

⚠️ **A resposta do agente não depende mais da tela aberta.** Até 03/11 só o
`/reply` (chamado em laço pelo navegador) e o `/recuperar` gravavam resposta;
quem fechava o app depois de perguntar não tinha o que receber. Hoje o miolo
do `/reply` é `colher_resposta` (`routers/conversations.py`), e o
`app/coletor_respostas.py` o chama para runs cuja tela não pergunta há 45 s.
**Ao mexer no `/reply`, mexe-se nos dois** — de propósito, para as armadilhas
do `chat.history` morarem num lugar só. O coletor só colhe o **último** run
aberto da pessoa com o agente (pergunta seguinte e "Nova conversa" são
fronteira), desiste em `erro`, `/stop` ou 3 falhas de gateway
(`agent_runs.coleta_encerrada_em`) e nunca grava o texto de compactação que
falhou.

**Push nasce da mensagem, não do sininho:** trigger `trg_push_pendente`
(`023`) → `pg_notify('push_pendente')` → `escuta_banco` → `app/push_envio.py`,
com reserva em `push_enviados` contra os 2 workers. Destinatários, menção
(`@Nome` em texto, `@todos` fura o silenciar) e payload em `app/push_regras.py`,
puro. ⚠️ O `endpoint` da inscrição é **allowlist** de serviços de push
(regex estrita + `urlsplit` e `urllib3` concordando no host) — o servidor faz
POST nele, e sem isso era SSRF para o túnel do gateway. ⚠️ `webpush` com
`ttl=86400` e `Urgency: high`: o padrão `ttl=0` descarta push de celular
dormindo, que é o caso inteiro. Chaves VAPID no EasyPanel; sem elas o backend
sobe e loga `push desligado: VAPID ausente`.

`channel_members.silenciado` (`025`) corta push, som e notificação local; o
sininho e as não lidas continuam.

⚠️ **"Ficou com cara de computador no Android" é o Chrome com "Site para
computador" ligado, não defeito nosso.** Com ele, o Chrome ignora o
`width=device-width` e desenha em 980px — o app instalado herda a opção do
site, cai no layout de desktop e tudo fica minúsculo. Em 03/11/2026 isso fez
a primeira entrega mobile parecer "um desastre no Android" e motivou refazer a
interface inteira; só depois apareceu a causa. Antes de mexer em layout por
causa de queixa no Android: Chrome → ⋮ → desmarcar "Site para computador"
(e conferir em Configurações → Configurações do site → Site para computador).

### Celular: interface própria — `frontend/src/celular/` (03/11/2026)

Spec `docs/superpowers/specs/2026-11-03-app-celular-design.md`; o protótipo
aprovado (`…-app-celular-prototipo.html`) é a fonte da verdade visual. Em tela
< 768px, `/` e `/chat` renderizam o `AppCelular` **fora do `AppLayout`**
(`CascaDoApp`); o resto das rotas segue como está. A Frente C (ramos
`isMobile` dentro de `ChatPage`/`ChannelChat`/`ThreadPanel`) **saiu**.

- ⚠️ **A pilha de telas é a URL** (`celular/pilha.ts`, testado): `aba`,
  `agent`/`channel`, `thread`, `painel`. O voltar do Android desempilha; link
  de push aberto sem histórico volta por `urlDoPai`, não sai do app. Folha e ⋮
  põem uma entrada no histórico com a mesma URL para o voltar fechá-los.
- ⚠️ **Lógica compartilhada, não copiada.** O que o celular precisava e
  morava dentro do desktop foi MOVIDO: `use-conversa-agente.ts` (histórico,
  envio, espera, voz, nova conversa), `use-conversa-ativa.ts` (marcar lido),
  `lib/envio-no-canal.ts` (gravar + avisar + acordar o agente),
  `lib/acoes-da-mensagem.ts` (as ações da seta do desktop e da folha do
  celular), `lib/notificacoes-do-aparelho.ts`. Mexeu numa regra, mexe ali.
- Painéis do ⋮ são o conteúdo do desktop embutido (`PainelEmbutido`), não
  cópia. Prévia da lista: `GET /channels/previas` (`app/previas.py`); as não
  lidas continuam sendo as do sininho.
- Responder citando (deslizar a bolha, ou "Responder" nas ações) vai no texto,
  `> **Autor:** trecho` (`lib/citacao.ts`) — sem coluna nova. Desde 10/11/2026
  é também o "Responder" do desktop (barra acima do campo, cartão na bolha,
  clique leva à citada por `acharCitada`), e **substituiu o "Responder em
  thread"**, que ninguém usava (4 de 1.076 mensagens). Threads antigas seguem
  abrindo pelo "N respostas"; não há mais como criar uma nova.
  Aviso e agente recebem só o texto novo (`textoNovo`), não a citação.
- ⚠️ **Segurança: nada se envia a partir da query string.** `?prefill=` é no
  máximo rascunho; `?autosend=1` não existe mais (um link forjado fazia a
  vítima postar). A resposta rápida do push com o app fechado vai pelo Cache
  Storage: o SW guarda o texto sob `crypto.randomUUID()` e a URL leva só
  `?resposta=<id>`; `consumirResposta` (`lib/resposta-rapida.ts`) confere
  canal/thread, 5 min de validade e uso único antes de enviar.
- `useConversaAtivaNasNotificacoes` recebe `ativa`: tela inativa não mexe no
  estado global, e quem zera é só o dono (duas telas convivem na animação).

### Conversa consigo mesmo — 10/11/2026

O "chat comigo mesmo" do Teams. Spec e plano:
`docs/superpowers/{specs,plans}/2026-11-10-conversa-consigo-mesmo*`.

- Canal do tipo **`pessoal`** (035), não DM com uma pessoa: tudo que filtra
  `dm`/`public`/`private` não o vê, de propósito. Um por pessoa (índice único em
  `created_by`); nasce em `minha_conversa_pessoal()` via `GET /channels/pessoal`,
  que a lista chama ao carregar e que **repõe a membresia** de quem foi
  desativado e voltou.
- ⚠️ O `name` no banco é "Anotações" e nunca vai para a tela: todo título passa
  por `nomeDaConversaPessoal` (`lib/conversa-pessoal.ts`) → "Fulano (você)".
- Só a dona lê; o **administrador não renomeia, não apaga e não mexe nos
  membros** dela (policies da 035). Broadcast não a acha pelo nome.
- Sem vistos, "digitando", membros, silenciar. Fixa no topo das DMs (desktop) e
  de Pessoas (celular).
- `POST /conversations/dm/abrir` recusa alvo = quem chama: o `find_or_create_dm`
  devolveria uma DM qualquer da pessoa.

### Conversas anteriores com o agente — 14/10/2026

Pedido da Lidisay (RH): voltar numa conversa antiga para **pegar informação**,
como no ChatGPT — **não** para continuar a sessão. Spec:
`docs/superpowers/specs/2026-10-14-conversas-anteriores-design.md`.

- Uma conversa anterior é o trecho de `conversations` que um "Nova conversa"
  (`conversation_resets`) encerrou — o recorte é `app/conversas_anteriores.py`,
  puro e testado. Sem migração: o dado sempre esteve lá, só a tela escondia.
- ⚠️ **O identificador é o uuid do reset, não o horário** — a API devolve
  milissegundos e o banco guarda microssegundos.
- Só leitura e só da própria pessoa (RLS de `conversations` e
  `conversation_resets`). Reaproveitar é **Citar**: o trecho entra na conversa
  de hoje como texto, e a sessão antiga no gateway não é tocada.
- A busca global devolve `conversa_anterior` e abre o painel na conversa certa
  (`/chat?agent=…&anterior=<reset>&message=<id>`).
- **Arquivos** (15/10/2026, também pedido da Lidisay): o painel do canal
  (`ChannelFilesPanel`, agora por `endpoint`) serve a conversa com o agente via
  `GET /conversations/{agent_id}/arquivos`. Atravessa o "Nova conversa" de
  propósito e ⚠️ **tira o `type: "audio"`** — é o resumo em áudio, que vem em
  quase toda resposta e afogaria a lista. Recorte em `app/arquivos_da_conversa.py`.


✓ / ✓✓ cinza / ✓✓ azul em cada mensagem, igual ao WhatsApp. Spec:
`docs/superpowers/specs/2026-10-14-vistos-por-mensagem-design.md`.

- **Canal (DM, grupo, thread):** `recibos_mensagem` (migração `020`), uma linha
  por mensagem × membro **humano** destinatário — o autor e os agentes não
  entram (agente não "abre" canal e travaria o azul). Quem cria é o trigger
  `trg_criar_recibos`, que **engole qualquer erro** de propósito: ele roda
  dentro do INSERT de toda mensagem, e recibo é acessório.
- ⚠️ **"Entregue" é marcado pelo servidor, não pelo navegador**
  (`app/recibos_entrega.py`): ao conectar no `/ws` e, a cada mensagem nova, para
  quem tem `usuario:<id>` assinado **naquele worker**. São 2 workers e o hub é
  por processo — cada um cuida dos seus, o `entregue_em IS NULL` torna repetir
  inócuo. Não existe registro de presença compartilhado, e não precisa.
- O aviso de recibo mudou sai do **banco** (trigger por statement no `UPDATE`,
  um `pg_notify` por canal), não de `hub.publicar` — pelo mesmo motivo dos 2
  workers.
- ⚠️ **Agente: azul é "há resposta do agente depois da pergunta", NÃO "o run
  tem `message_id`".** O `/recuperar` grava resposta sem preencher o run (74 de
  140 numa semana de agosto) e a regra pelo run deixaria essas com ⚠ para
  sempre. O run (`agent_runs.pergunta_id`) só decide o cinza e o ⚠ (30 min).
- `dm_reads` está aposentado, sem leitor nem escritor.

### Marcar conversa como não lida — 18/11/2026

Pedido da Leticia: marcar uma conversa já lida como "voltarei aqui", pela
lista (segurar no celular; ⋮ ou clique direito no desktop). Spec:
`docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md`.

- ⚠️ **Não é notificação.** O "Marcar como não lida" por mensagem criava uma
  linha em `notifications`, e o re-sweep de 2 s do
  `useConversaAtivaNasNotificacoes` a lia na hora com a conversa aberta — "já
  some". Saiu dos menus; `/notificacoes/nao-lida` ficou sem chamador. A marca
  nova é a tabela `conversas_marcadas` (`039`), rotas `GET/PUT/DELETE
  /conversas/marcadas?canal_id=|agent_id=` (exatamente um; `user_id` do token;
  canal exige membro humano, agente `pode_ver_agente`).
- ⚠️ **A coluna é `canal_id`, não `channel_id`, e o trigger é próprio**, só com
  `{tabela, op, id, user_id}` → `usuario:<id>`: com `channel_id` o realtime
  diria aos membros do canal que alguém o marcou.
- ⚠️ **A marca não soma em número nenhum** (aba, sininho, ícone do app): é uma
  bolinha sem número, e não lida de verdade vence (`lib/conversa-marcada.ts`,
  regra das duas listas). Some só ao ABRIR a conversa — efeito próprio em
  `use-conversa-ativa.ts`, nunca nos re-sweeps. Store de módulo em
  `lib/conversas-marcadas-store.ts`.

### Encaminhar mensagem — 27/11/2026

Estilo WhatsApp: até 10 destinos (DM, grupo em que escreve, anotações) e o
próprio Guardi. Spec e plano: `docs/superpowers/{specs,plans}/2026-11-27-encaminhar-mensagem*`.

- Tudo no servidor: `POST /encaminhar` (`app/routers/encaminhar.py`, regras
  puras em `app/encaminhamento.py`). ⚠️ **Anexo privado é COPIADO no R2**
  (`armazenamento.copiar`), com linha nova em `anexos` para a conversa de
  destino — `caminho` é UNIQUE e `pessoa_pode_ler` exige ser da conversa.
- `channel_messages.encaminhada` (047). ⚠️ O push ignora `@todos`/`@Nome` de
  encaminhada (`conteudo_para_mencao`) e a rota **não acorda agente**.
- Guardi: não envia; o servidor copia os anexos para `conversa_agente` e o
  front põe texto citado + anexos no campo (`lib/encaminhar.ts`, handoff de
  uso único, com aviso para quem já está na conversa dele). Imagem vai como
  `file` — sem `base64`, a prévia quebrava.
- ⚠️ `usePersistentDraft` lia `loading` da closure: texto escrito no mesmo
  commit da abertura era apagado pelo GET do rascunho. Hoje é `loadingRef`.
  O arquivo tem o efeito de carga e a escuta **duplicados** desde o remix.

### Limpar conversa — 27/11/2026

"Apagar para mim" em lote, em DM e grupo (não em anotações nem agente). Spec:
`docs/superpowers/specs/2026-11-27-limpar-conversa-design.md`.
`POST /channels/{id}/limpar` grava em `mensagens_ocultas` (inclusive respostas
de thread) e marca as notificações do canal como lidas; o "Desfazer" apaga o
lote pelo `criado_em` (o `now()` da transação). ⚠️ A tela precisa do aviso
`ouvirConversaLimpa`: o `reconcileMessages` funde, e só recarregar deixaria
tudo à vista. A prévia da lista do **desktop** só se ajusta ao recarregar.
