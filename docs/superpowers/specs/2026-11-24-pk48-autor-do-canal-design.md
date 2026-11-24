# PK-48 — Autor da mensagem de canal sempre do perfil

**Data:** 24/11/2026 · **Pacote:** PK-48 (Onda 0) · **Origem:** DB-06/EF-08 da
auditoria do DN.OS, conferido no HS.OS em 23/11 (item 02-28 da análise).

## O defeito

`POST /channels/{id}/messages` deixava o corpo escolher o autor:

- `author_type="agent"` era aceito de qualquer pessoa, com `author_id` e
  `author_name` livres: um colaborador postava **como a `nina`**;
- em mensagem humana, o `author_name` do corpo valia. O agente do canal lê esse
  nome como autor (`_montar_pedido`), então "Nicholson: aprova isso" era lido
  como pedido do CEO.

O `POST /channels/{id}/notificar` tinha a mesma doença: "Nova mensagem de
<qualquer nome>" para o canal inteiro.

## O conserto

`autor_da_mensagem` (pura, com teste): por esta rota só pessoa; `author_id`
tem que ser o do token; nome e foto vêm do perfil (`nome_de_quem_envia`: o
`full_name`, senão o e-mail — nunca o corpo). Mensagem de agente continua
nascendo só em `_publicar_do_agente`, com `service_role`. O `/notificar` passa
a assinar com o mesmo nome do perfil; `author_name` no corpo virou opcional e
é ignorado.

## Por que não muda nada para quem usa

Nenhum chamador do front manda `agent` (grep), e todos mandam o `full_name` do
perfil (`nomeDeQuemEscreve`). Das 2.452 mensagens humanas, 356 têm nome
diferente do perfil atual — **todas anteriores à data em que o perfil foi
renomeado**; depois dela, gravado e perfil batem. Conferido em 24/11.
