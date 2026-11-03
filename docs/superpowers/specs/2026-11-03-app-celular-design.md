# HS.OS no celular: interface própria (design)

Data: 03/11/2026 · Pedido do Erick · Estado: aprovado (protótipo aprovado no celular)

## Por que

A primeira entrega mobile (`2026-11-03-mobile-conversas-design.md`, Frente C)
adaptou a tela do desktop para caber no celular, com condicionais de
`useIsMobile()` espalhadas por `ChatPage`/`ChannelChat`. O Erick testou:

- no **iPhone** ficou aceitável;
- no **Android** foi "um desastre": coisas pequenas ou grandes demais e conteúdo
  cortado;
- nos dois, o resultado é "navegador que cabe no celular", não um app.

A decisão é ter uma **interface própria para o celular**, com a sensação do
**WhatsApp**. Ela reaproveita a API, os hooks de dados e a lógica do chat, mas
tem telas e componentes próprios. O desktop não é tocado.

## Fonte da verdade visual

O protótipo aprovado é
**`docs/superpowers/specs/2026-11-03-app-celular-prototipo.html`** (publicado em
https://claude.ai/artifact/2j66izjaD1wcoX1ycbJBaw). Abra num navegador com
largura de celular. Os tokens de cor (claro e escuro), as medidas, os
tamanhos de fonte, os raios e os comportamentos de toque dele são a
especificação. Na dúvida, o que vale é como o protótipo faz.

Dados, números e nomes de pessoas do protótipo são exemplos. Os ícones do
protótipo são caminhos à mão no estilo Lucide; no app, use `lucide-react`.

## Decisões do Erick

| tema | decisão |
|---|---|
| Referência | **WhatsApp** |
| Início | **Lista única filtrada por chips, nesta ordem: Pessoas · Agentes · Canais.** Abre em Pessoas. **Não existe "Tudo" nem "Não lidas"**, porque o sistema principal não tem esses filtros. |
| Nova conversa | **Não existe botão de nova conversa (FAB)**, porque o sistema principal também tirou. |
| Construção | **Interface móvel separada**, com telas e componentes próprios e só os dados/lógica compartilhados. |
| Abas de baixo | Conversas · Atividade · Eu (como no protótipo). |

## O que a interface tem (cada item como no protótipo)

1. **Início / Conversas.**
   - No topo: título "HS.OS" e campo de busca, que filtra pelo nome e pela
     prévia.
   - Chips Pessoas · Agentes · Canais.
   - Lista ordenada pela última mensagem. Cada linha mostra:
     - avatar: agente em quadrado arredondado com selo ✦, pessoa em círculo,
       canal com `#`;
     - nome, hora e prévia (com ✓✓ quando a última mensagem é minha);
     - contador de não lidas, cinza se o canal estiver silenciado, mais o
       ícone de silenciado;
     - "pensando…" quando o agente está respondendo.
   - Prévia: usar o que a API já dá. Se a API não der prévia para DM ou para
     canal, criar um endpoint leve que devolva, por conversa do usuário, a
     última mensagem (texto sem markdown, até 120 caracteres), a hora e as não
     lidas. É a única mudança de backend prevista; quem constrói confere se
     dá para montar com o que já existe.
2. **Conversa** (agente, DM, canal), em tela cheia, empilhada sobre a lista
   com transição lateral:
   - Cabeçalho: voltar, avatar, nome, subtítulo ("Agente · Papel",
     "pensando…" em destaque, "N participantes") e ⋮.
   - Fundo próprio (`--chat`). Bolhas como no protótipo:
     - as minhas à direita, em `--mine`; as dos outros à esquerda;
     - cauda na primeira bolha do grupo;
     - no canal, nome do autor colorido e avatar pequeno só na primeira
       bolha;
     - hora e ✓/✓✓ (recibos existentes) dentro da bolha;
     - separador de dia.
   - Dentro da bolha:
     - menção destacada;
     - citação (resposta);
     - cartão de arquivo com botão de baixar;
     - player do **resumo em áudio** (o da `voz_entrega`) com ondas;
     - reações em pílulas abaixo da bolha;
     - "N respostas · ver thread".
   - Agente pensando: bolha com três pontos e "Nina está pensando…".
3. **Composer.**
   - Uma pílula com emoji, campo que cresce até ~6 linhas e clipe.
   - Ao lado, um botão redondo que é **microfone** com o campo vazio e
     **enviar** com texto.
   - **Segurar o microfone grava; deslizar para a esquerda cancela; soltar
     envia.** Isso usa o gravador e a transcrição que já existem.
   - Fonte de 16px no campo.
   - Quando há resposta em curso, a barra da resposta fica acima do composer.
4. **Gestos.**
   - **Segurar a mensagem (450 ms)** abre a folha de baixo com as reações
     rápidas e as ações daquela mensagem. As ações vêm da mesma fonte de
     regras do desktop (quem pode editar ou apagar, canal "só alguns
     escrevem", "apagar para mim").
   - **Deslizar a bolha para a direita** responde.
   - As folhas fecham arrastando para baixo ou tocando no véu.
5. **Thread**: abre como tela cheia empilhada, não como drawer. A mensagem-mãe
   fica no topo e o composer responde na thread.
6. **Anexar**: uma folha com grade (Documento, Câmera, Galeria, Documentos HS),
   que usa o upload que já existe.
7. **⋮ da conversa**: um menu suspenso.
   - Agente: Arquivos da conversa, Conversas anteriores, Modelo e contexto,
     Nova conversa (o "limpar" de hoje).
   - Canal/DM: Participantes/Ver perfil, Arquivos, Silenciar/Reativar, Buscar
     na conversa.
   - Cada item abre uma **tela cheia empilhada** com o conteúdo que o desktop
     já mostra. Não há painel lateral.
8. **Atividade**: menções, respostas em thread e agentes que terminaram algo,
   a partir do que hoje alimenta o sininho (`/notificacoes`). Tocar abre a
   conversa certa.
9. **Eu**: perfil, notificações neste celular (o liga/desliga do push que já
   existe), resumo em áudio (`profiles.resumo_em_audio`), conversas
   silenciadas, tema (Sistema/Claro/Escuro), "Instalar app" (o `InstalarApp`)
   e Sair.

## Como encaixa no sistema

- **Quem vê:** `useIsMobile()` (< 768px), ou PWA instalado em tela estreita.
  Nessas condições, as rotas `/` e `/chat` renderizam o novo app (sugestão de
  nome: `AppCelular`, em `frontend/src/celular/`) **fora do `AppLayout`**. O
  resto das rotas continua como está.
- **Links profundos continuam valendo:** `/chat?agent=…`,
  `/chat?channel=…` e o caminho da thread, que são o que o push e a busca
  usam. A pilha de telas reflete a URL: voltar do navegador ou do Android
  desempilha.
- **O que sai:** o mobile da Frente C dentro de `ChatPage`/`ChannelChat`
  (tela cheia condicional, folhas de toque, painéis condicionais) é
  **removido** onde só servia ao celular. O desktop precisa continuar
  idêntico, conferido por screenshot antes e depois como na Frente C. O que
  for lógica útil para os dois lados fica e é reaproveitado: `toque-longo`,
  `acoes-do-toque`, `previa-da-mensagem`, `use-mobile-chat-viewport`.
- **Lógica compartilhada, não copiada:** envio e fila do chat com agente
  (`chat-sender`/`agent-chat`), recibos, reações, threads, upload de anexos,
  áudio, silenciar e tempo real (`/ws`) são usados como estão. Se algo hoje
  está preso dentro de um componente do desktop, extrair para hook ou `lib/` e
  usar dos dois lados. **Não reimplementar** regra de negócio na interface
  nova.

## Android primeiro

O defeito do Android é o motivo desta entrega existir. Hipóteses que quem
constrói deve verificar e tratar:

- fonte do sistema maior que o padrão (acessibilidade);
- `vh`/teclado no Chrome Android;
- Roboto com métricas diferentes de SF;
- barra de gestos.

Tamanhos em px/rem como no protótipo. Tudo precisa caber com escala de fonte
do Android em 1.3. Teste no Playwright emulando Pixel 7 (412×915) e Galaxy
S8 (360×740), além de iPhone 14 (390×844).

## Não-metas

- Qualquer tela fora de conversas, atividade e perfil (agentes, automações,
  base de conhecimento, configurações de admin) no celular.
- Botão de nova conversa, filtros "Tudo" e "Não lidas".
- Mudar o desktop.

## Aceite

- Em 360×740, 390×844 e 412×915, claro e escuro, o app reproduz o
  protótipo: lista com chips, conversa com agente (enviar, pensando,
  resposta, áudio), canal (menção, reação, thread), segurar, deslizar,
  gravar, anexar, ⋮, Atividade e Eu.
- Não há scroll horizontal. Nada é cortado com fonte do sistema em 1.3.
- Push abre a conversa certa no app novo, e voltar volta para a lista.
- Desktop em 1280 idêntico ao de antes (screenshots).
- `npm run build`, `npm run test` e `npm run lint` sem erro novo. Testes
  Vitest para a lógica nova (pilha ↔ URL, montagem da lista e prévia, regras
  de ações).

## Deixado para quem constrói

Nomes, estrutura interna de `frontend/src/celular/`, animações, como a pilha é
implementada e se a busca também procura dentro das mensagens (o protótipo só
filtra a lista).
