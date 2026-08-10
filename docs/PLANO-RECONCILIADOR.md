# A última edge function: `turn-reconciler`

É a única que sobrou das 73. Não ficou por último por acaso — é a mais delicada
do conjunto, e a única cuja portagem **manda mensagem para agente de produção**.

Este arquivo é o que foi levantado em 10/08/2026 para que a portagem não comece
do zero. Não é o plano de implementação: é o mapa do terreno.

---

## O que ela faz

Roda de minuto em minuto, compara os turnos pendentes em `agent_turns` com o
estado real das sessões no gateway, e decide **por tabela** — nenhuma decisão
passa por LLM:

| Situação da sessão | Decisão |
|---|---|
| rodando, dentro do orçamento | espera, sem registrar evento repetido |
| rodando além do orçamento | `watchdog_flag` — só anota |
| concluída, resposta já pousou | `ledger_fix` — marca entregue |
| concluída com texto final | `deliver`, pelo `agent-reply-webhook` |
| concluída **sem** texto final | `nudge` — pede ao agente que componha a resposta |
| não encontrada | tenta de novo; após o teto, abandona |

O `nudge` é o motivo de isto não ser tarefa solitária: ele **manda mensagem
para o agente**. Existe um modo `observe` em `app_settings.reconciler_mode` que
registra o que *teria* feito sem agir — é por ele que a primeira execução tem
que passar.

---

## Os dois bloqueios, e o estado real de cada um

### 1. Não há quem a chame

Na origem era o `pg_cron` do Supabase (`invoke_edge_function`). **A VPS não tem
`pg_cron`**, e é isso que trava: sem gatilho periódico, portar a lógica não
produz nada.

Opções, em ordem de menos infraestrutura nova:

- **Uma tarefa `asyncio` dentro do próprio backend**, acordando de minuto em
  minuto. Custa zero infra. ⚠️ Mas com mais de uma réplica do backend, duas
  rodam ao mesmo tempo — precisa de `pg_advisory_lock` para só uma trabalhar.
- **Um `systemd timer` na VPS** chamando um endpoint protegido por segredo
  compartilhado. Mesma forma da ponte `dnos-files-bridge`, que já existe e
  funciona lá.
- **Instalar `pg_cron`.** Resolve de vez e é o que a origem usava, mas mexe no
  Postgres de produção.

### 2. O protocolo — **este deixou de ser bloqueio**

A edge fala `POST /tools/invoke` com `{tool, args}`. Sondado em 10/08:

- `/tools/invoke` responde **401, não 404** — o caminho HTTP continua de pé,
  só exige credencial. Não é o caso do resto da API REST do OpenClaw.
- E, melhor, **tudo que ela precisa existe em JSON-RPC**, que é como o nosso
  `backend/app/gateway/client.py` já fala:

| Na edge | JSON-RPC | Estado |
|---|---|---|
| `sessions_list` | `sessions.list` | ✅ responde; 13 sessões, 34 campos |
| `sessions_history` | `sessions.get {key}` | ✅ devolve `{messages: [...]}` |
| `sessions_send` | `sessions.send {key, …}` | ✅ existe (**escrita**) |
| — | `tools.invoke {name, …}` | ✅ existe, se precisar do caminho genérico |

`sessions.history` **não** existe — quem faz esse papel é `sessions.get`, e a
confirmação foi ler as 16 mensagens de uma sessão real da `nina`.

⚠️ **A chave da sessão é composta.** O `sessions.list` devolve
`agent:nina:hsos-<uuid-do-usuário>`, e é esse nome inteiro que `sessions.get` e
`sessions.send` exigem, no campo `key` (não `sessionKey`).

Campos úteis do `sessions.list` para as decisões da tabela acima: `status`,
`hasActiveRun`, `abortedLastRun`, `startedAt`, `endedAt`, `runtimeMs`,
`totalTokens`, `contextTokens`, `lastChannel`.

---

## Antes de portar, verificar se ainda é necessária

Duas coisas mudaram desde que a reconciliadora foi escrita, e cada uma pode ter
comido uma parte do trabalho dela:

1. **O gateway passou a deduplicar por `idempotencyKey`.** Boa parte do que ela
   conserta é execução duplicada — os itens A1–A19 da auditoria. Vale medir
   antes de reimplementar a mesma proteção duas vezes.
2. **A entrega da resposta mudou de caminho.** O `deliver` chama o
   `agent-reply-webhook`; do lado de cá a resposta chega por trigger +
   `pg_notify` + WebSocket. O `ledger_fix` (marcar entregue) continua fazendo
   sentido; o `deliver` precisa ser repensado, não traduzido.

Ou seja: **portar fiel aqui não é obviamente certo**, ao contrário do resto da
migração. É o único caso em que a edge não serve como especificação direta.

---

## Como fazer a primeira execução

1. Portar com `reconciler_mode = "observe"` **fixo em código**, não em
   `app_settings` — modo perigoso não deve depender de uma linha de banco
   estar certa.
2. Deixar rodar um dia. Ler o que ela diz que teria feito.
3. Só então ligar o `active`, junto com o Erick, num agente combinado.

---

## Notas relacionadas

- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado e próximos passos
- [`AUDITORIA-ESTABILIDADE-2026-07-16.md`](AUDITORIA-ESTABILIDADE-2026-07-16.md) — A1–A19, os bugs que ela conserta
- [`TESTAR-SEGUNDA.md`](TESTAR-SEGUNDA.md) — o que precisa de verificação conjunta
