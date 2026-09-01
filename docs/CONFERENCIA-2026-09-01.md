# Conferência de 01/09/2026

O `ROADMAP-AGENTES-2026-08-31.md` fechou com uma tabela de "o que conferir
amanhã". Amanhã é hoje. Este documento é o resultado — quatro linhas conferidas,
mais a publicação da skill que ficou pendente e um número de referência para a
conferência de amanhã.

Tudo aqui é **medido no banco `hsos` e no `taskhs`**, não lido em tela.

## O placar da manhã

| conferência | resultado |
|---|---|
| os cinco briefings | ✅ passaram de primeira |
| `conversation_resets` | ⚠️ zero desde 28/08, mas sem tráfego que prove |
| `/monitoring` | ✅ com dado pela primeira vez |
| o guardião | ✅ nada para avisar |

### 1. Os cinco briefings passaram ✅

```
07:32  flow   Operação · 01/09
07:36  iris   Faturamento · 01/09
07:41  atlas  Vendedores · 01/09
07:46  atlas  SDR · 01/09
07:50  atlas  Serviços · 01/09
```

Cinco documentos em `wiki_documents`, cinco linhas em `cron_jobs` com
`status = ok`. É a confirmação que faltava para o item 1b: o defeito era o
gateway declarar 65.536 de janela onde há 1M, e com a janela real os cinco
rodam sem estourar.

⚠️ **Não confirma o item 3 (delegação em cascata).** Briefing é sessão de cron
que não delega. A cascata continua sem evidência de um lado nem do outro, e o
roadmap já mandava reavaliar depois de uma semana de uso — segue valendo.

### 2. `conversation_resets` caiu, e a evidência é fraca ⚠️

| semana | resets |
|---|---|
| 18–24/08 | **31** |
| 25–31/08 | **11** |
| desde 28/08 | **0** |

A queda é real na série, mas **não é prova de conserto**, e vale escrever por quê
antes que vire fato: o tráfego de conversa despencou junto. Em 31/08 foram 14
mensagens; em 01/09, nenhuma. Zero reset sem uso não separa "a janela consertou"
de "ninguém conversou".

**O sinal que decide** é a primeira semana em que o Nicholson usar de verdade —
comparar resets contra mensagens em `conversations`, não resets contra o
calendário.

### 3. `/monitoring` deixou de estar vazia ✅

As quatro tabelas, todas escritas às 09:25 de hoje pelo `app/coletor_metricas.py`:

| tabela | linhas |
|---|---|
| `gateway_health` | 425 |
| `cron_jobs` | 10 |
| `agent_stats` | 5 |
| `usage_daily` | 2 |

🟠 **Um furo no adaptador:** `usage_daily` de hoje traz `tokens_total = 170.909`
e `messages_total = 0`. Conta token e não conta mensagem — o campo existe, a
tela vai mostrar zero, e quem olhar vai concluir que ninguém usou o sistema.
É o mesmo formato de erro que o item 8 acabou de consertar em `usage_events`:
tabela viva com uma coluna morta dentro parece pior do que tabela vazia, porque
não pede conferência.

### 4. O guardião não tinha o que avisar ✅

Os cinco crons vieram `ok`. O caminho de aviso continua sem ter sido exercitado
em produção — o que se sabe é que ele não dispara falso positivo.

## A skill `gargalos-taskhs` foi publicada ✅

O `scripts/publicar-skills.sh --enviar` rodou. Conferido por `md5sum` contra
`/root/.openclaw/skills` na VPS do gateway: **os sete `SKILL.md` batem byte a
byte** com `backend/skills/`.

⚠️ **Publicada não é usada** — é exatamente o que o `CLAUDE.md` documenta como
tendo custado o número 48% errado em 14/08. O arquivo está no
`managedSkillsDir`; que o agente o carregue e siga a régua só se vê no briefing.

**Dá para conferir daqui.** A nota de que o gateway só seria alcançável por
túnel a partir da VPS estava errada quanto ao SSH: o shell da máquina do gateway
responde direto desta estação (host em `scripts/publicar-skills.sh`). O túnel é
para o **RPC** do OpenClaw, que exige loopback para conceder escopo de operador
— o shell não.

### O número de referência para amanhã

O briefing de hoje (07:32) saiu **antes** da publicação, então ainda carrega o
erro. Medido agora, com a régua da skill:

| | com a régua (certo) | sem a régua |
|---|---|---|
| etapa 📮Despachado (Correios) | **47** | 166 |
| board Serviço inteiro | 115 | 265 |
| **TaskHS inteiro** | **290** | **449** |

A inflação de hoje é **54,8%** — a mesma forma de 31/08 (295 contra 454). E o
Correios deu **47**, o mesmo número de 31/08: a fila é estável, o que torna a
comparação de amanhã limpa.

**O teste de amanhã, em uma linha:** se o briefing de Operação de 02/09 reportar
Correios perto de **47** em vez de perto de **166**, a skill está sendo lida.

⚠️ **Armadilha de leitura na auditoria de 31/08.** A tabela daquele documento
rotula como "board Serviço" números que são da **etapa Correios** — conferido:
os `378 cards no total, 59 ativos` que ela cita são da lista Correios, não do
board, que tem 554 e 195. O board inteiro nunca foi 47. Quem comparar board com
board vai achar que a fila triplicou em um dia.

## Correções de placar no `ROADMAP.md`

Duas seções descreviam um estado que não existe mais. Medido hoje:

| | dizia | é |
|---|---|---|
| Lote 7 — o banco | 185 chamadas `.from()` em 56 arquivos vivos | **0 vivas**, 0 arquivos |
| Lote 6 — edge functions | 4 de trabalho real, 9 bloqueadas | **0 na raiz**, 8 em `_pausado/` |

O Lote 7 estava concluído e a prosa não acompanhou — o Placar, logo acima na
mesma página, já dizia `0`. As duas linhas se contradiziam há semanas.

Os `functions.invoke` e `postgres_changes` que o grep ainda acha são comentário
e documentação, nenhum vivo:

- `dnos-documentation-yaml.ts:1341` — string dentro do YAML da Documentação,
  que é justamente o projeto de conteúdo em aberto
- `use-channels.ts`, `use-typing-indicator.ts`, `realtime.ts` — comentários
  explicando o que o `pg_notify` substituiu

🟠 **A linha `_portado` do Placar mede errado.** O comando
`ls backend/supabase/functions/_portado | wc -l` devolve **2**, não 68 — as
portadas foram apagadas, não movidas, e só `collect-agent-stats` e
`skill-manage` ficaram na pasta. O número honesto está duas linhas abaixo, em
"Nenhuma function resta": 65 portadas e 8 arquivadas, fechado em 11/08.

## Notas relacionadas

- [`ROADMAP-AGENTES-2026-08-31.md`](ROADMAP-AGENTES-2026-08-31.md) — o roadmap
  que pediu esta conferência
- [`AUDITORIA-RESPOSTAS-2026-08-31.md`](AUDITORIA-RESPOSTAS-2026-08-31.md) — de
  onde vem o erro de 54%, e a tabela com a armadilha de rótulo
- [`VARREDURAS-2026-08-31.md`](VARREDURAS-2026-08-31.md) — as decisões que
  seguem com o Erick
- [`ROADMAP.md`](ROADMAP.md) — o placar corrigido por este documento
