# Encaminhar mensagem — design (27/11/2026)

Pedido do Erick: "encaminhar mensagem, no estilo de WhatsApp, podendo escolher
mais de um colega ou até o próprio Guardi".

## Intenção

Levar uma mensagem — com os anexos — de uma conversa para outra sem copiar e
colar, para várias pessoas de uma vez. O caso que mais deve aparecer é mandar a
um colega o que o Guardi ou um especialista respondeu (o relatório, o número),
e o inverso: jogar no próprio Guardi algo que chegou de um colega para ele
agir em cima.

## Decisões (tomadas com o Erick)

| ponto | decisão |
|---|---|
| Para o Guardi | vira **rascunho** no campo da conversa com ele — nada é enviado; a pessoa escreve o que quer e envia |
| Destinos | pessoas (DM), o próprio Guardi e os **grupos** em que a pessoa escreve |
| Origem | mensagens de canal, DM, thread **e** da conversa com agente (pergunta ou resposta) |
| Caminho | **rota nova no backend** (abordagem A) — uma chamada, o servidor faz o resto |

### Abordagens consideradas

- **A. Rota `POST /encaminhar` (escolhida).** O servidor confere a leitura da
  origem, abre/cria as DMs, copia os anexos para cada destino e insere com a
  marca `encaminhada`. Custa migração e deploy; resolve anexo, marca e falha
  parcial.
- **B. Só no navegador**, um `sendMessage` por destino e o selo no texto.
  Rejeitada: o anexo dá 404 para quem recebe (`pessoa_pode_ler` exige ser da
  conversa), o selo vira texto que a busca e os agentes leem, e cinco envios
  podem falhar pela metade sem ninguém ver.
- **C. Misto** (texto no navegador, rota só para copiar anexo). Rejeitada:
  mantém selo-em-texto e falha parcial.

## Não-objetivos / anti-objetivos

- **Encaminhar não acorda agente.** Mensagem encaminhada a um grupo com agente
  não dispara resposta (a rota não chama `startChannelAgentReplies`), e uma
  `@menção` ou `@todos` dentro do texto encaminhado **não fura o silenciar** nem
  manda push a mencionado. Anti-objetivo: encaminhar virar jeito de gastar token
  ou de acordar o grupo inteiro sem querer.
- Não encaminha para outros agentes (só o próprio Guardi), nem para canal em que
  a pessoa não escreve (canal de avisos).
- Não guarda a origem (de qual canal veio): quem recebe vê só "Encaminhada",
  como no WhatsApp — a origem pode ser uma conversa que ele não vê.
- Sem "encaminhada com frequência", sem encaminhar várias mensagens de uma vez.

## Como funciona

### Backend

**Migração `047_mensagem_encaminhada.sql`:**
`ALTER TABLE public.channel_messages ADD COLUMN IF NOT EXISTS encaminhada boolean NOT NULL DEFAULT false;`
⚠️ O código passa a selecionar a coluna em `_COLUNAS_MSG` — **aplicar antes do
deploy** (lição do `seq_depois`).

**Armazenamento:** `copiar(origem, destino)` em `app/armazenamento.py`
(`copy_object` do S3 — cópia dentro do R2, a VPS não vê os bytes; também no
backend `Memoria`). Precisa de cópia física porque `anexos.caminho` é `UNIQUE` e
o caminho leva o id da conversa (`caminho_do_anexo`): uma linha nova apontando
para o mesmo objeto não cabe no schema, e cada cópia fica independente.

**Lógica pura em `app/encaminhamento.py`** (testada sem banco):
- `itens_para_copiar(attachments, audio_url | media)` — quais anexos têm `id`
  (privados, precisam de cópia) e quais são URL pública (vão como estão: GIF do
  Giphy, `/storage/...` antigo). Da conversa com agente, só `type` `file`,
  `image` e `audio` **com `id`**; os cartões (`email_aprovacao`,
  `acao_aprovacao`, `lembrete`) não viajam. O resumo em áudio da resposta do
  agente (`type: "audio"` vindo do agente) também não — é leitura do próprio
  texto.
- `conferir_destinos(...)` — teto de **10** destinos por envio (contando o
  Guardi), sem duplicados, sem a própria pessoa como "pessoa" (a conversa
  pessoal entra como grupo, ver abaixo).
- `audio_url` de canal é `anexo:<id>` → copiado e reescrito com o id novo.

**Rota `POST /encaminhar`** (`app/routers/encaminhar.py`):

```
entrada { origem: {tipo: "canal" | "agente", id}, pessoas: [user_id], canais: [channel_id], guardi: bool }
saída   { enviados: [{destino, channel_id, message_id}],
          falhas:   [{destino, motivo}],
          guardi:   {agent_id, texto, anexos: [MediaAttachment]} | null }
```

1. Lê a origem com `role=authenticated` (a RLS já garante que a pessoa a vê:
   `channel_messages` pela membresia + `_VISIVEL_PARA_MIM`; `conversations` só
   da própria pessoa). Mensagem apagada ou invisível → 404.
2. Para cada anexo privado, `buscar_anexo` + `pessoa_pode_ler` (defesa em
   profundidade: o anexo citado no JSON tem que ser legível por quem encaminha).
3. Para cada destino, **independente** (falhar num não derruba os outros):
   - pessoa → `find_or_create_dm` (mesmas traduções de erro da `/dm/abrir`);
   - `_recusar_quem_nao_escreve`;
   - copia os anexos (objeto no R2 + linha em `anexos` com `contexto='canal'`,
     `enviado_por_user` = quem encaminha);
   - insere a mensagem com `encaminhada = true`, autor = quem encaminha (nome e
     foto do perfil, como em `enviar`);
   - insere as `notifications` (mesmo SQL do `/notificar`) e publica no tópico
     do canal (`hub.publicar(topico_canal(...), "mensagem", ...)`, depois da
     transação).
4. `guardi: true` → acha o Guardi da pessoa (`agent_profiles.dono_id`), copia
   os anexos para `contexto='conversa_agente'` (agent = Guardi, dono = pessoa) e
   devolve texto + anexos **sem gravar mensagem**. Sem Guardi → falha nomeada.

**Push:** `app/push_envio.py` passa conteúdo vazio para a detecção de menção
quando `encaminhada` — o push sai para os destinatários normais, mas
`@todos`/`@Nome` do texto encaminhado não furam o silenciar.

**Rota `GET /encaminhar/destinos`:** a lista do seletor, decidida no servidor —
pessoas ativas (menos quem chama), grupos `public`/`private` em que a pessoa é
membro e **pode escrever**, a conversa pessoal ("Você (anotações)") e o Guardi
(se houver).

### Frontend

- **Ação "Encaminhar"** (ícone `Forward`) em `lib/acoes-da-mensagem.ts`, nas
  duas funções — desktop e celular herdam juntos. Não aparece em mensagem
  otimista, apagada ou com erro. Abre o seletor por um store de módulo
  (`lib/encaminhar.ts`: `abrirEncaminhar(origem)`), sem mexer na assinatura dos
  chamadores.
- **Seletor `components/chat/EncaminharDialog.tsx`**, montado **uma vez** no
  `App.tsx` (serve o desktop e o `AppCelular`, que fica fora do `AppLayout`):
  busca no topo, Guardi fixo primeiro, depois "Você (anotações)", grupos e
  pessoas, caixas de marcar, contador "N de 10", botão Enviar. Em tela pequena
  ocupa a tela toda.

  ```
  ┌ Encaminhar para… ─────────────── ✕ ┐
  │ 🔍 Buscar                          │
  │ ☐ 🛡 Meu Guardi    (vira rascunho) │
  │ ☐ 📝 Você (anotações)              │
  │ GRUPOS                             │
  │ ☐ # comercial                      │
  │ PESSOAS                            │
  │ ☑ Ana Paula                        │
  │ ☑ Hyago                            │
  │ ───────────────────────────────── │
  │ 2 de 10           [ Encaminhar ➤ ] │
  └────────────────────────────────────┘
  ```
- **Depois de enviar:** toast "Encaminhada para N" (ou lista de quem falhou).
  Com o Guardi marcado: o rascunho é acrescentado com `acrescentarCitacao` (o
  texto **inteiro** citado, não o trecho de 140 da resposta) via um handoff de
  módulo (`lib/encaminhar.ts`: `guardarParaOGuardi` / `consumirParaOGuardi`),
  que o `ChatPage` e a `TelaConversaAgente` consomem ao abrir a conversa do
  Guardi — texto no rascunho e anexos em `media.addStaged` — e a tela navega
  para `/chat?agent=<guardi>`.
- `finalizeStaged` (`hooks/use-chat-media.ts`): anexo que **já tem `id` e não
  tem `base64`** passa direto (já está no servidor). Sem isso, a imagem copiada
  cairia no ramo que faz `fetch(att.base64)` com string vazia.
- **Selo "↪ Encaminhada"** (itálico pequeno, acima do conteúdo) nas bolhas do
  `ChannelChat`, do `ThreadPanel` e da `Bolha` do celular. `encaminhada?:
  boolean` em `ChannelMessage` e `MensagemCanalOut`.
- Changelog: entrada `novidade` (minor) no topo de `frontend/src/data/changelog.ts`.

## Critérios de aceite

1. Encaminhar uma mensagem com PDF e imagem para duas pessoas e um grupo: as
   três recebem, com selo, e o PDF e a imagem **abrem** para quem recebe.
2. Encaminhar uma resposta do Guardi para um colega funciona igual.
3. Marcar o Guardi: abre a conversa com ele, texto citado no campo, anexos
   prontos; nada enviado até a pessoa apertar Enviar; ao enviar, o Guardi
   consegue ler o anexo (`ler_anexo`).
4. Mensagem com `@todos` encaminhada a um grupo silenciado não fura o
   silenciar; agente do grupo não responde.
5. Um destino que recusa (canal de avisos) não impede os outros, e a tela diz
   qual falhou.
6. Os três limites do Erick: nada do envio normal muda; sem custo novo além de
   cópia no R2 (operação classe A, centavos); sem chamada a mais no carregamento.

## Deixado para quem constrói

Ordem dos grupos e pessoas no seletor (sugestão: conversas recentes primeiro,
pelo `/channels/previas`; v1 pode ser alfabética), texto exato dos toasts, e o
ícone do Guardi no seletor.
