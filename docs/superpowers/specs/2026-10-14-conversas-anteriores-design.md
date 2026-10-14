# Conversas anteriores com o agente — design

**Data:** 2026-10-14 · **Escopo:** `backend/` (duas rotas de leitura, campo novo na
busca), `frontend/` (painel "Conversas anteriores" na conversa com agente, citar
trecho, abrir pela busca global).

## Objetivo

Pedido da Lidisay (RH), registrado como melhoria: poder **voltar numa conversa
antiga** com o agente, como no ChatGPT e no Claude, para **pegar informação**
que saiu ali — uma tabela, um número, uma resposta longa.

⚠️ **O objetivo é LER, não continuar a sessão.** A conversa antiga abre só para
leitura; o que a pessoa quiser reaproveitar entra na conversa de hoje como texto
novo (citação).

**Sucesso =** dentro da conversa com um agente, a pessoa abre "Conversas
anteriores", vê a lista com título e data, abre uma, copia ou cita o trecho que
precisa e volta a conversar com o agente com aquele trecho no campo de digitar.

## O que existe hoje

- O botão **"Nova conversa"** (`POST /conversations/{agent_id}/limpar`) **não
  apaga nada**: grava um marco em `public.conversation_resets` e derruba a sessão
  no gateway. A tela mostra só o que veio depois do marco mais recente
  (`_ultimo_reset` em `routers/conversations.py`). `conversations` guarda tudo.
- Logo, **uma conversa anterior é o trecho de `conversations` entre dois
  marcos** do mesmo par pessoa × agente. O dado existe; falta a tela.
- Em produção (14/10/2026): o CEO tem 17 recomeços com a `iris`, 13 com o
  `atlas`, 12 com a `nina`; a Lidisay, 1 com o `bruce`.
- A **busca global** (`GET /busca`) já encontra mensagens de conversas antigas,
  mas o clique leva ao chat atual, que as esconde — a pessoa não chega ao trecho.

## Decisões (conversa de 14/10/2026)

| decisão | escolha |
|---|---|
| como chegar | lista **por agente**, dentro da conversa com ele |
| abrir | **só leitura** |
| pegar a informação | **Copiar** e **Citar na conversa atual** em cada mensagem |
| título | a **primeira pergunta** da pessoa (sem IA) |
| quem vê | **só a própria pessoa**; sem atalho para administrador |
| busca global | clicar em mensagem antiga abre o histórico naquela conversa |

## Backend

Sem migração.

### Recorte — `app/conversas_anteriores.py` (puro, testado)

```python
recortar_conversas(resets: list[Reset], mensagens: list[dict]) -> list[Trecho]
titulo_da_conversa(mensagens: list[dict]) -> str
```

- `Reset = {id, created_at}`, em ordem crescente; cada reset fecha o trecho que veio antes dele. O
  trecho depois do último reset é a **conversa atual** e não entra.
- `Trecho = {id, ate, inicio, titulo, mensagens}`: `id` é o uuid do reset que
  encerrou o trecho (é o identificador); `ate` é o `created_at` dele; `inicio` é
  o `created_at` da primeira mensagem; `mensagens` é a contagem.
- ⚠️ **O identificador é o uuid, não o horário.** O horário sai da API em
  milissegundos e o banco guarda microssegundos — usá-lo para achar o trecho de
  volta não casaria.
- Trecho sem mensagem (dois "Nova conversa" seguidos) é **pulado**.
- Título: a primeira mensagem `role='user'` com **mais de 3 palavras**; se não
  houver, a primeira mensagem `user`; se não houver nenhuma, "Conversa sem
  pergunta". Espaços colapsados, cortada em **80 caracteres** com `…`.

### Rotas — em `routers/conversations.py`, mesmo `agente_visivel`

- **`GET /conversations/{agent_id}/anteriores`** → `[{id, ate, inicio, titulo,
  mensagens}]`, da mais nova para a mais antiga. Lê os resets do par e as
  mensagens anteriores ao último reset (só `id, role, content, created_at` —
  nada de `media`), sessão `authenticated` (o RLS `dono_le` de `conversations`
  e de `conversation_resets` já restringe à pessoa).
- **`GET /conversations/{agent_id}/anteriores/{reset_id}`** → as mensagens do
  trecho que esse reset encerrou (de depois do reset anterior até ele), em ordem
  crescente, com teto de **500**, no mesmo formato `MensagemOut` do histórico
  (sem `recibo`). `reset_id` que não seja uuid, ou que não seja um reset da
  pessoa com aquele agente → **404**.
- Como as rotas novas têm caminho fixo (`/anteriores`), elas precisam ser
  declaradas **antes** de qualquer rota genérica que case com
  `/{agent_id}/{algo}`.

### Busca global

`ResultadoBusca` de `tipo="conversa"` ganha `conversa_anterior: str | None`: o
`id` do reset que encerrou o trecho da mensagem (o primeiro reset do par
**depois** dela); `None` quando não há reset depois — é a conversa atual.

## Frontend

### Painel `components/chat/ConversasAnteriores.tsx`

- Botão **"Conversas anteriores"** (ícone `History`) ao lado de "Nova conversa",
  no cabeçalho desktop e no mobile.
- Abre um `Sheet` lateral com a lista: título, `dd/MM/yyyy`, "N mensagens".
  Lista vazia: "Ainda não há conversas anteriores com este agente."
- Clicar abre a conversa no próprio painel: faixa "Conversa encerrada em
  dd/MM — só leitura", botão voltar à lista, mensagens com o mesmo visual de
  bolha da conversa (Markdown renderizado), cada uma com **Copiar** e **Citar
  na conversa atual**. Não há campo de digitar no painel.

### Citar

`citarTrecho(texto: string): string` em `lib/conversas-anteriores.ts` (pura,
Vitest): prefixa cada linha com `> `, acrescenta uma linha em branco no fim.
O `ChatPage` fecha o painel, **acrescenta** a citação ao que já estiver no campo
(não apaga o rascunho) e foca o campo com o cursor no fim.

### Busca global

`GlobalSearch`: resultado de conversa com `conversa_anterior` navega para
`/chat?agent=<id>&anterior=<reset_id>&msg=<id>`; o `ChatPage` abre o painel já
naquela conversa e rola até a mensagem. Sem `conversa_anterior`, o comportamento de
hoje. A decisão do destino é uma função pura (`destinoDaBusca`) com teste.

## Fora do escopo

- Busca dentro do histórico (a global já cobre).
- Título por IA, renomear, apagar ou fixar conversa.
- Ver o histórico de outra pessoa (inclusive administrador).
- Retomar a sessão antiga no gateway.

## Verificação

- `pytest` com os testes de `recortar_conversas` e `titulo_da_conversa`:
  trecho vazio pulado, conversa atual excluída, título com mensagem genérica
  ("oi"), corte em 80.
- `vitest` com `citarTrecho` e `destinoDaBusca`.
- Contra o banco de rascunho: semear duas conversas encerradas e uma atual,
  conferir lista, abertura, 404 de reset alheio e o `conversa_anterior` da busca.
- Na tela (rascunho): abrir o painel, abrir uma conversa, copiar, citar e ver o
  trecho no campo; clicar num resultado antigo da busca e cair na conversa
  certa.
