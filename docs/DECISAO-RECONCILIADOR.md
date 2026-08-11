# Por que a `turn-reconciler` não foi portada

Decidido em 11/08/2026. Ela foi para `backend/supabase/functions/_pausado/`,
como a Arena — arquivada com o motivo escrito, não apagada.

Este arquivo substitui o [`PLANO-RECONCILIADOR.md`](PLANO-RECONCILIADOR.md),
que continua valendo como levantamento técnico caso a decisão mude.

---

## O que ela fazia

Rodava de minuto em minuto, comparava os turnos pendentes em `agent_turns` com
o estado real das sessões no gateway, e decidia por tabela: esperar, marcar
como entregue, entregar a resposta, cutucar o agente que terminou sem texto,
ou desistir depois de 24h.

## Por que não precisa mais

**Não é que o gateway melhorou. É que a arquitetura da resposta é outra.**

O desenho original **empurrava**: o agente terminava e o `agent-reply-webhook`
entregava a resposta. Se o webhook se perdesse, a resposta se perdia para
sempre — e só uma varredura periódica descobriria. A reconciliadora existia
para isso.

O nosso **puxa**. `POST /conversations/{agente}/send` manda `chat.send` e
guarda o `runId`; a tela então chama a espera, que faz `agent.wait` no gateway
e, ao terminar, lê a resposta do `chat.history` e grava em `conversations`.

Não existe o buraco de "a resposta existe e ninguém vai buscá-la": ela fica no
gateway, e quem quiser pergunta de novo.

Trabalho por trabalho:

| O que ela fazia | Hoje |
|---|---|
| Sessão rodando, dentro do orçamento → esperar | `agent.wait`, por run, em tempo real |
| Concluída **com** texto → entregar | Coberto — menos o caso descrito abaixo |
| Concluída **sem** texto → cutucar o agente | Detectamos e dizemos ao usuário. Cutucar é decisão de produto, não conserto |
| Marcar entregue no livro-caixa | Era escrita em `agent_turns` |
| Não encontrada → repetir, desistir | A tela repete e desiste; a espera devolve erro pedindo reenvio |
| Passou do orçamento → anotar | Não coberto. Mas ela **só anotava** — nenhum efeito visível |

## O argumento que decide sozinho

**Nada no HS.OS escreve ou lê `agent_turns`.** O único lugar que menciona a
tabela é o arquivo de tipos gerado.

Portá-la exigiria antes portar o registro de turnos que a alimentava. Não é uma
edge function: são duas, mais um agendador que a VPS não tem (o original usava
`pg_cron` do Supabase).

Isso também significa que **a reconciliadora, como está escrita, não
consertaria o buraco que ainda existe** — ela opera sobre uma tabela vazia.

---

## O buraco que sobra, e o conserto certo

Se a pessoa fecha a aba — ou o backend reinicia — **enquanto o agente ainda
trabalha**, ninguém chama a espera, e a resposta nunca chega a `conversations`.
Ela não se perde: está no `chat.history` do gateway. Mas a tela lê do nosso
banco, então não aparece.

⚠️ O `_SEQ_DO_RUN` é memória de processo, então um reinício do backend tem o
mesmo efeito. Está documentado no próprio código, com o custo assumido.

**O conserto é menor que a reconciliadora inteira:** ao abrir a conversa,
comparar o `chat.history` do gateway com o que há em `conversations` e importar
o que faltar. Uma rota, sem agendador e sem tabela nova.

**Não foi feito agora, de propósito.** Com o sistema ainda sem uso, isso tem
incidência zero, e o caso se projeta melhor depois de vê-lo acontecer uma vez.

### O sinal que reabre esta decisão

Resposta que some depois de fechar a aba, com uso real. Se aparecer, o conserto
é a recuperação ao abrir a conversa — **não** portar a reconciliadora.

---

## Notas relacionadas

- [`PLANO-RECONCILIADOR.md`](PLANO-RECONCILIADOR.md) — o levantamento técnico, incluindo os métodos do gateway que ela usaria
- [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md) — o padrão de arquivar sem apagar
- [`AUDITORIA-ESTABILIDADE-2026-07-16.md`](AUDITORIA-ESTABILIDADE-2026-07-16.md) — A1–A19, os bugs de execução duplicada que ela também cobria e que o gateway passou a deduplicar por `idempotencyKey`
