# Marcar conversa como não lida — 18/11/2026

Pedido da Leticia, aprovado pelo Erick. Marcar uma conversa já lida como "voltarei
aqui depois", como no WhatsApp: pela **lista**, sem abrir a conversa.

## Por que o que existe não serve

Hoje "Marcar como não lida" é **por mensagem** (seta da mensagem no desktop,
folha de ações da bolha no celular — `lib/acoes-da-mensagem.ts`), via
`POST /notificacoes/nao-lida`. Ela cria uma notificação, que conta como não lida
**de verdade**, e com a conversa aberta o `useConversaAtivaNasNotificacoes`
a varre de novo em 2 s (o "re-sweep") — a marca some na hora. É o "já some,
notifica na hora" que a Leticia relatou.

## O que muda

- **Na lista de conversas**, desktop e celular, em todos os tipos (pessoa,
  grupo, canal, agente, Guardi, a conversa pessoal): "Marcar como não lida".
  Celular: segurar a conversa. Desktop: ⋮ no item e clique direito.
  Conversa já marcada mostra "Marcar como lida" no mesmo lugar.
- **O indicador é uma bolinha SEM número** (decisão do Erick): diz que foi a
  pessoa que marcou, não que há algo novo. Se a conversa também tem não lida de
  verdade, vale o número, como hoje.
- **A marca some ao ABRIR a conversa** (a transição para ativa), nunca por
  varredura enquanto ela está aberta.

## Desenho

- **Não é notificação.** Tabela nova `conversas_marcadas` (`user_id`,
  `canal_id` ou `agent_id` — exatamente um —, `marcada_em`), única por pessoa
  e conversa. Assim a marca não entra no sininho, no push nem em
  `notifications`, e varredura de lido não a toca. Como a `032`: RLS ligada,
  `REVOKE` de `authenticated`, `GRANT` ao `service_role`; quem filtra pela
  pessoa é a rota. A coluna é `canal_id`, não `channel_id`, de propósito: o
  trigger genérico publicaria no tópico do canal que alguém marcou a conversa.
- **Rotas:** `PUT` e `DELETE /conversas/marcadas?canal_id=…` (ou
  `?agent_id=…`, exatamente um), `GET` devolve a lista da pessoa. `user_id` sai do token. Canal
  exige ser membro; agente, que a pessoa possa ver o agente.
- **Outro aparelho acompanha:** trigger próprio + `pg_notify('hsos_mudancas')`
  só com `{tabela, op, user_id}` → tópico `usuario:<id>` (são 2 workers,
  `hub.publicar` não serve).
- **Ao abrir:** o efeito que torna a conversa ativa chama o `DELETE` uma vez por
  abertura. Os re-sweeps de 2 s não chamam.

## Chamadas minhas (para o Erick conferir)

- **Ordem na lista:** no desktop a marcada sobe junto com as não lidas (`ordenarConversas`). No celular a lista é só por recência — nem a não lida sobe —, e a marcada segue a mesma regra.
- **Contador da aba e badge do app:** a marca NÃO soma número. Aba sem nenhuma
  não lida numérica, mas com conversa marcada, mostra a bolinha sem número.
  Sininho e ícone do app não mudam.
- **Silenciada:** a marca aparece igual (foi a pessoa que pediu).
- **O "Marcar como não lida" por mensagem sai dos menus**: é substituído pelo
  da conversa e é o que se comportava mal. A rota `/notificacoes/nao-lida`
  fica, sem chamador na tela (apagar é outra decisão).

## Fora

Marcar para outra pessoa; marca com prazo ("me lembra amanhã" é a Agenda).

## Para quem constrói

Testes: regra pura do indicador (número × bolinha × nada) e da ordenação nas
duas listas (`lista-de-conversas.ts`, `celular/lista.ts`); rota recusando canal
de que a pessoa não é membro; o re-sweep não apaga a marca. Changelog: entrada
de novidade (minor).
