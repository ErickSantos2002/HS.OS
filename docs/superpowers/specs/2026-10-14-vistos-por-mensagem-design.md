# Vistos por mensagem, igual ao WhatsApp — design

**Data:** 2026-10-14 · **Escopo:** `backend/` (recibos, entrega pelo `/ws`, estado
na listagem), `frontend/` (visto na bolha, "Dados da mensagem").

## Objetivo

Pedido do Erick em 13/10/2026: o indicador de leitura tem que ser **por
mensagem**, com os três estados do WhatsApp — enviada, entregue, lida — em
**todas** as conversas: DM entre pessoas, canal de grupo e conversa com agente.

**Sucesso =** cada mensagem minha mostra, ao lado do horário, ✓ / ✓✓ cinza /
✓✓ azul, e o estado muda sozinho na tela quando o outro lado recebe ou lê. Em DM
e grupo, o menu da mensagem tem "Dados da mensagem" com quem recebeu e quem leu,
cada um com o horário.

## O que existe hoje (e sai)

- `public.dm_reads (channel_id, user_id, last_read_at)` — **um horário por
  pessoa e canal**, não por mensagem.
- `GET/PUT /dm-reads/{channel_id}` em `routers/chat_extras.py`, consumidos por
  `hooks/use-dm-reads.ts`.
- Na tela, só em DM entre duas pessoas: um "Visto às HH:mm" em itálico embaixo
  da última mensagem minha que o outro já viu. Nada em grupo, nada no agente,
  nenhum ✓.

Depois desta mudança nada lê nem grava `dm_reads`; a tabela fica, como as
outras herdadas.

## Decisões (conversa de 14/10/2026)

| decisão | escolha |
|---|---|
| onde | DM, canal de grupo **e** conversa com agente |
| "Dados da mensagem" | sim, em DM e grupo; não no agente |
| agente membro de canal | **não** conta como destinatário — agente não "abre" canal; contá-lo travaria o azul para sempre |
| armazenamento | recibo **por mensagem e destinatário** (não marca d'água): só ele dá a hora exata que o "Dados da mensagem" mostra |
| quem marca "entregue" | o **servidor**, quando a pessoa tem `/ws` aberto — não um "recebi" do navegador |
| "marcar como não lida" | continua local, **não** desfaz o recibo (igual ao WhatsApp) |
| desligar o visto (privacidade) | fora do escopo |

### Os estados

| visto | DM e grupo | agente |
|---|---|---|
| 🕓 pendente | bolha otimista, ainda sem `id` do servidor | idem |
| ✓ enviada | gravada no servidor | gravada no servidor |
| ✓✓ cinza entregue | chegou ao navegador de **todos** os destinatários | o gateway aceitou (run criado) |
| ✓✓ azul lida | **todos** os destinatários abriram a conversa | existe resposta do agente depois desta pergunta |
| ⚠ falhou | — | run sem resposta há mais de 30 min |

No agente, "começou a processar" foi descartado como azul: o gateway começa no
mesmo instante em que aceita, e cinza e azul acenderiam juntos.

⚠️ **O azul do agente NÃO vem de `agent_runs.message_id`.** Foi o primeiro
desenho, e está errado: o `/recuperar` grava a resposta sem preencher o
`message_id` do run — documentado no próprio `conversations.py`, 74 de 140
bolhas de agente da semana de 24/08 vieram assim. Com a regra pelo run, essas
respostas apareceriam com ⚠ para sempre. "Há mensagem `role='agent'` depois da
pergunta" cobre os dois caminhos de gravação (`/reply` e `/recuperar`).

## Backend

### Migração `020_recibos.sql`

```sql
CREATE TABLE public.recibos_mensagem (
  message_id  uuid NOT NULL REFERENCES public.channel_messages(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  entregue_em timestamptz,
  lida_em     timestamptz,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX recibos_pendentes_idx ON public.recibos_mensagem (user_id)
  WHERE lida_em IS NULL;

ALTER TABLE public.agent_runs ADD COLUMN pergunta_id uuid;
```

- **Trigger `AFTER INSERT` em `channel_messages`** cria uma linha por membro
  `member_type = 'human'` do canal, exceto o autor. Vale também para resposta
  de thread (é a mesma tabela). ⚠️ `channel_members.user_id` é **`text`**,
  não `uuid` — o trigger converte, e o filtro do autor compara já convertido.
- **Trigger `AFTER INSERT OR UPDATE ... FOR EACH STATEMENT`** em
  `recibos_mensagem`, com `REFERENCING NEW TABLE`, faz **um** `pg_notify` por
  canal afetado no formato que o `escuta_banco` já roteia por `channel_id`
  (`tabela = 'recibos_mensagem'`). Tem que ser pelo banco: são 2 workers, e
  `hub.publicar` só alcança as conexões do próprio processo. Por statement, para
  que marcar 50 mensagens como lidas vire um aviso, não cinquenta.
- **Grants** para `hsos_app` no padrão das migrações anteriores.
- **Retroativo:** mensagens de canal já existentes ganham linha por membro
  humano atual (exceto autor), com `entregue_em = lida_em = dm_reads.last_read_at`
  quando ele for ≥ `created_at`, e nulo nos dois caso contrário. Conversa com
  agente anterior à migração fica **sem visto** — não há como ligar a pergunta
  ao run com segurança.
- A migração confere o efeito ao final (o script de aplicar roda a consulta que
  a rota nova faz).

### Entregue

- **Ao conectar no `/ws`:** `UPDATE recibos_mensagem SET entregue_em = now()
  WHERE user_id = $1 AND entregue_em IS NULL`.
- **Mensagem nova:** quando o `escuta_banco` de um worker recebe o `INSERT` de
  `channel_messages`, ele confere quais membros do canal têm o tópico
  `usuario:<id>` com assinante **neste worker** e marca `entregue_em` para eles.
  Os dois workers fazem isso; o `WHERE entregue_em IS NULL` torna idempotente.
  Não há registro de presença compartilhado — cada worker cuida de quem está
  ligado nele.
- Falha ao marcar entregue é log, não exceção: recibo é acessório e não pode
  derrubar a conexão nem a entrega da mensagem.

### Lida

`POST /canais/{channel_id}/lido` (substitui o `PUT /dm-reads`): exige membro do
canal; marca `lida_em = now()` e `entregue_em = COALESCE(entregue_em, now())` em
toda linha minha daquele canal com `lida_em IS NULL`. Horário do servidor,
como hoje.

### Expor o estado

- **Listagem de mensagens do canal** ganha `recibo: "enviada" | "entregue" |
  "lida"`, só nas mensagens **minhas** (nulo nas dos outros). O agregado
  considera **só os membros atuais** do canal — quem saiu do grupo não trava o
  azul. Mensagem sem destinatário (canal só comigo, ou só com agentes) é
  `enviada`.
- **`GET /mensagens/{message_id}/recibos`** — "Dados da mensagem":
  `[{user_id, nome, entregue_em, lida_em}]` dos membros atuais. **Só o autor**
  da mensagem pode consultar; outro recebe 404 (não revela que a mensagem
  existe).
- **Conversa com agente:**
  - `EnvioIn` ganha `pergunta_id` (opcional); o `/send` grava em
    `agent_runs.pergunta_id`. A tela já tem o `id` persistido antes de chamar o
    `/send`.
  - `GET /conversations/{agent_id}` devolve `recibo` nas mensagens
    `role = 'user'`: `lida` se existe mensagem `role = 'agent'` posterior;
    senão, pelo run com aquele `pergunta_id` (seguindo `redireciona_para`):
    `entregue` se existe e tem menos de 30 min, `falhou` se tem mais; sem run,
    `enviada`. Mensagem anterior à migração (nenhum run com `pergunta_id` e
    nenhuma resposta depois) volta `recibo = null` — sem visto.

### Regras puras (testadas com pytest)

Em `app/recibos.py`, sem banco:

- `estado_no_canal(linhas_dos_membros_atuais) -> "enviada"|"entregue"|"lida"`
- `estado_no_agente(tem_resposta_depois, run_criado_em, agora) -> ...|None`

Os testes trancam: membro que saiu não trava o azul; agente não entra na conta;
canal sem destinatário é `enviada`; resposta via `/recuperar` (run sem
`message_id`) dá `lida`, não `falhou`; a janela de 30 min.

## Frontend

### `components/chat/VistoDaMensagem.tsx`

Recebe `estado: "pendente" | "enviada" | "entregue" | "lida" | "falhou"` e
desenha relógio / ✓ / ✓✓ cinza / ✓✓ azul / ⚠ com tooltip. Fica ao lado do
`HH:mm`, dentro da bolha, **só nas minhas mensagens**. Usado no `ChannelChat`
(DM e grupo), no `ThreadPanel` e no `ChatPage` do agente. A escolha de ícone é
função pura com teste Vitest.

### Canais

- `hooks/use-recibos.ts` substitui `use-dm-reads.ts`: chama `POST
  /canais/{id}/lido` nos mesmos gatilhos de hoje (abrir o canal, mensagem nova
  com a aba visível, voltar o foco), limitado a uma chamada a cada 2s; escuta
  `tabela = 'recibos_mensagem'` no tópico do canal e rebusca o estado das
  minhas mensagens.
- Sai o "Visto às HH:mm" em itálico (`ChannelChat.tsx`, `lastSeenOwnIndex`).
- **"Dados da mensagem"** entra no menu da seta, só nas minhas mensagens: um
  diálogo com "Lida por" e "Entregue a" (nome + horário) e, no fim,
  "Aguardando" para quem ainda não recebeu.

### Agente

A bolha usa o `recibo` da listagem. No envio o estado avança localmente sem
esperar recarregar: relógio enquanto grava → ✓ quando o `POST` devolve → ✓✓
cinza quando o `/send` volta 201 (o front passa o `pergunta_id`) → ✓✓ azul
quando a resposta chega.

## Fora do escopo

- Opção de desligar o visto (privacidade do WhatsApp) — tarefa separada se
  pedida.
- "Dados da mensagem" na conversa com agente.
- Remover a tabela `dm_reads`.

## Verificação

- `python -m pytest tests -q` com os testes novos de `app/recibos.py`.
- `npx vitest run` com o teste do `VistoDaMensagem`.
- Contra o banco, depois de aplicar a `020`: a tabela existe, o retroativo criou
  as linhas do canal de produção, e a consulta de estado da listagem roda.
- Ao vivo, duas abas com duas pessoas: ✓ ao enviar, ✓✓ cinza com a outra aba
  aberta em qualquer tela, ✓✓ azul ao abrir o canal; "Dados da mensagem" com os
  horários. No agente: cinza logo após enviar, azul quando a resposta chega.
