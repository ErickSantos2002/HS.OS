# Auditoria de Estabilidade — dn.os (missioncontroldnia)

> Data: 2026-07-16 · Escopo: caminho chat/gateway + Loop Architecture + automações + observabilidade + provisionamento + velocidade
> Todos os achados foram confirmados por leitura direta do código, com arquivo:linha.
> Motivação: agentes travando em tarefas longas com UI mostrando "em execução", crash de DM com ~1M tokens, rabbit hole pós-compactação, agente ignorando intervenção na DM, respostas lentas (7-20s).
> Cada achado tem: **Sintoma** (qual dor relatada ele causa — ou "latente" se ainda não estourou), descrição técnica e **Na prática** (o que significa na experiência real).

## Legenda de sintomas

| Código | Sintoma relatado |
|---|---|
| 🔴 S1 | Trava, mas a UI mostra "executando" |
| 🟠 S2 | DM abortou com ~1M tokens |
| 🟡 S3 | Rabbit hole pós-compactação (refez trabalho, abandonou solução pronta) |
| 🔵 S4 | Ignorou intervenção na DM / só respondeu por outro canal |
| ⚡ S5 | Demora de 7-20s pra responder, pior com tool calls |
| 💣 Latente | Ainda não manifestado — vai estourar em outra situação |

## Mapa sintoma → causa raiz

| Sintoma | Causas confirmadas no código |
|---|---|
| 🔴 S1 | A3, A8, A9, A10, A11, B1, B2, B11, B12, B25, B26 |
| 🟠 S2 | A2, A4, A13, B27 |
| 🟡 S3 | A1, A7, A14, B4, B5 |
| 🔵 S4 | A5, A6, A15, A16, B3 |
| ⚡ S5 | V1, V2, V3, V4, V5, A2, A12 |

---

# PARTE A — Caminho Chat/Gateway

> Sintomas desta parte: 🔴 S1 (travamento aparente), 🟠 S2 (1M tokens), 🟡 S3 (rabbit hole), 🔵 S4 (surdez à intervenção).

## Críticos

### A1. Detecção de context overflow por string na RESPOSTA do agente — falso positivo destrói sessões funcionais
**Sintoma:** 🟡 S3 — é o gatilho mais provável do rabbit hole do seu incidente.
`src/lib/chat-sender.ts:662-679` e `:1553-1568`
`isContextOverflowError(reply.text)` roda sobre a resposta NORMAL do agente. Se o agente estiver debugando um problema de tokens e mencionar "context window" ou "token limit", o cliente descarta a resposta, **reseta a sessão no gateway** e reenvia com apenas 6 mensagens de histórico. O guard `contextResetInFlight` expira em 2s — pode resetar em loop. O mesmo vale para `isGatewayOverloadError(reply.text)` (`:1570`): "rate limit" numa resposta legítima dispara 3 retries duplicados.
**Na prática:** o agente menciona "context window" numa resposta normal e a plataforma entende que a memória dele estourou: apaga a sessão no meio do trabalho. Foi o mecanismo que fez seu agente "esquecer" a Edge Function pronta e entrar no rabbit hole.
**Correção:** detectar overflow apenas em erros estruturados (HTTP status / error.code do gateway), nunca no texto de resposta bem-sucedida.

### A2. Nenhuma compactação proativa — sessão `dm:<user>:<agent>:v2` cresce até estourar 1M
**Sintoma:** 🟠 S2 — causa direta do crash de 1M de tokens. Também alimenta ⚡ S5 (sessão inchada = resposta mais lenta a cada dia).
`chat-sender.ts:62,1445`; `gateway-chat/index.ts:11,84`; `dm-agent-reply/index.ts:339-341`; `channel-agent-reply/index.ts:283`
Session key fixa e eterna, sem contagem de tokens, sem `/compact` automático, sem rotação. O único mecanismo é reativo (string de erro do A1). Agravante: cada turno envia 30 mensagens de histórico do cliente PARA DENTRO de uma sessão que já tem todo o histórico no gateway — contexto duplicado a cada turno.
**Na prática:** a memória do agente só cresce, nunca é resumida — até estourar. Foi por isso que a DM chegou a ~1M de tokens e morreu. Bônus ruim: o agente fica mais lento (e mais caro) a cada dia de uso.
**Correção:** compactar proativamente a ~60-70% da janela; com sessionUser ativo, enviar só a última mensagem do usuário.

### A3. Erro HTTP do gateway vira "extended polling" de 15 min — UI mostra "trabalhando" com o agente morto
**Sintoma:** 🔴 S1 — a mecânica exata do "travado mas mostrando em execução".
`gateway-chat/index.ts:233-239, 284-291` + `chat-sender.ts:844-848, 962-970, 1609-1612, 1723-1755`
Gateway falha → `gateway-chat` devolve **status 200** com `{error, detail}` → cliente vê res.ok, tenta SSE, não acha `data:` → STREAM_EMPTY → fallback sync parseia o JSON de erro → texto vazio → STREAM_EMPTY de novo → poll estendido de 15 minutos. Qualquer erro real do gateway é engolido.
**Na prática:** quando o gateway dá erro de verdade, a tela mostra "trabalhando…" por 15 minutos em vez de avisar que falhou. Você espera por nada.
**Correção:** checar Content-Type application/json antes de tratar como stream; propagar `detail` aos classificadores; devolver status ≠ 200.

### A4. Execução DUPLICADA em todo turno longo — stream + dm-agent-reply em paralelo na mesma sessão
**Sintoma:** 🟠 S2 — principal acelerador do crescimento até 1M. Contribui pra comportamento errático em tarefas (duas execuções da mesma coisa).
`chat-sender.ts:1455-1478, 1493` + `dm-agent-reply/index.ts:104,126-130`
Cliente dispara os dois caminhos; o dedup do edge é esperar 12s e checar resposta persistida. Turno > 12s = duas completions da mesma mensagem na mesma sessão. O dedup pós-fato só evita persistir a bolha duplicada, não evita a execução.
**Na prática:** toda mensagem que demora mais de 12s pra responder é executada DUAS vezes pelo agente. Dobra custo, dobra tokens, e pode fazer o agente executar a mesma tarefa duas vezes em paralelo — comportamento errático.
**Correção:** um caminho por turno, ou idempotency key por turno deduplicada no gateway.

### A5. Não existe cancelamento server-side
**Sintoma:** 🔵 S4 — por isso sua intervenção na DM não parou nada.
`chat-sender.ts:82-92`; `ChatPage.tsx:1991-1995`
`stopAgentResponse` só aborta o fetch do browser. Nada cancela o run no OpenClaw nem o processInBackground do edge. Mensagem nova do usuário durante turno ativo entra numa completion paralela na mesma sessão — o run antigo continua.
**Na prática:** o botão de "parar" não para nada — só esconde a resposta da sua tela. O agente continua rodando (e gastando) no servidor. Quando você interveio na DM, o run antigo seguiu em frente.
**Correção:** endpoint de abort no gateway + chamada em stopAgentResponse e handleSend.

### A6. Webhook descarta a resposta final se heartbeats foram persistidos
**Sintoma:** 🔵 S4 — explica o "só respondeu pela MC": a resposta final na DM foi descartada.
`agent-reply-webhook/index.ts:99-118` + `chat-sender.ts:225-238,1071-1093`
O dedup trata qualquer linha do agente após `in_reply_to_ts` como "reply real" — mas pings de progresso ("🔍 Analisando…") são persistidos em conversations. Tarefa longa com 3 heartbeats → resultado final via webhook → `skipped: "duplicate"` → resposta final nunca chega à DM.
**Na prática:** em tarefas longas, a resposta final do agente pode ser jogada fora porque os avisos de progresso são confundidos com ela. Você nunca recebe o resultado na DM — foi o que aconteceu quando ele "só respondeu pela MC".
**Correção:** heartbeats marcados com flag/coluna, excluídos do dedup.

## Altos

### A7. Amputação de contexto: cap 2KB + slice(-30) + slice(-6) pós-reset
**Sintoma:** 🟡 S3 — o mecanismo que apaga a "solução que já funcionava" da memória.
`chat-sender.ts:352-357, 409, 455-459, 1563/1702`
Após auto-reset sobram 6 mensagens de ≤2KB (~12KB) para retomar um debug longo. `slice(0, 2048)` corta bytes vs code units (UTF-8 inválido em pt-BR). A "solução que funcionava" estava numa resposta longa — amputada.
**Na prática:** quando a memória do agente é resetada, ele volta lembrando só das últimas 6 mensagens, cada uma cortada em ~2 mil caracteres. Tudo que ele descobriu/construiu nas horas anteriores some — por isso ele refaz trabalho e insiste nos mesmos caminhos errados.
**Correção:** resumo estruturado no reset (o que funcionou / o que não tentar de novo); cap maior para respostas do assistente; truncar por code points.

### A8. `agent_activity` "running" nunca expira — card gira para sempre
**Sintoma:** 🔴 S1 — um dos motivos da UI mostrar "executando" com o agente morto.
`AgentActivityCard.tsx:26,35-39,134-137` + `use-agent-activities.ts`
Qualquer linha running no banco mantém "Processando" na AAC. Sem watchdog, sem comparação com updated_at.
**Na prática:** o cartãozinho "Processando…" no chat pode girar pra sempre — nada o marca como falhou se o agente morrer no meio.
**Correção:** stale após N min sem update; cron marcando activities órfãs como failed.

### A9. Status "ativo" do agente é eco do banco, não execução real — e o SSE de status está DESLIGADO
**Sintoma:** 🔴 S1 — a bolinha verde mente; o monitor real está desligado.
`agent-status.ts:10-16`; `use-agents.ts:270-277, 293-386, 414-416`; `chat-sender.ts:45-55`
`stopSSE()` roda no mount — todo o aparato SSE é código morto. "Active" = houve mensagem nos últimos 5 min.
**Na prática:** a bolinha verde de "agente ativo" não verifica se o agente está vivo — só olha se houve mensagem recente. O monitor em tempo real que faria isso de verdade existe no código e está desligado.
**Correção:** heartbeat real do gateway ou remover código morto e rebaixar a semântica do indicador.

### A10. `processInBackground` sem `EdgeRuntime.waitUntil` — morre silenciosamente sem failure marker
**Sintoma:** 🔴 S1 — tarefa some sem rastro e a tela segue esperando.
`dm-agent-reply/index.ts:350-360`; `channel-agent-reply/index.ts:331-341`
Pior caso soma ~385s, colado no wall-clock de 400s. Isolate morto = nem resposta nem marker; cliente fica no poll de 15 min.
**Na prática:** em tarefas longas, o processo do servidor pode ser morto no meio sem deixar rastro: nem resposta, nem mensagem de erro. Pra você, o agente simplesmente "sumiu".

### A11. Falha em canal é 100% silenciosa
**Sintoma:** 🔴 S1 (variante em canais) — você menciona o agente e nada acontece, sem erro.
`channel-agent-reply/index.ts:147-150`
Sem replyText → só console.error, nada persistido, sem failure marker no canal. Webhook não cobre canais (só escreve em conversations).
**Na prática:** se o agente falha ao responder num CANAL (não DM), ninguém fica sabendo — você menciona o agente e nada acontece, sem erro nenhum na tela.

## Médios

### A12. Timeouts mágicos e inconsistentes
**Sintoma:** ⚡ S5 e 🔴 S1 — respostas longas sempre caem no caminho lento; esperas desalinhadas entre camadas.
Cliente 180s; gateway-chat 180s; dm/channel-reply 140s; slash 30s; modelos 4s; poll 3min/15min; webhook 90s; **Cloudflare corta em ~100s** — o stream morre no proxy antes do timeout do cliente, sempre caindo no fallback. Sem constantes compartilhadas.
**Na prática:** cada camada tem um relógio diferente e desalinhado — o Cloudflare desliga a ligação aos ~100s enquanto o app ainda espera até 180s. Resultado: respostas longas SEMPRE caem no caminho lento de recuperação.

### A13. Retries sem backoff repetem requisição não-idempotente
**Sintoma:** 🟠 S2 — multiplicador do consumo de tokens (junto com A4).
`chat-sender.ts:1533-1544, 1815-1858`; `dm-agent-reply:132-180`
**Na prática:** quando algo falha, o sistema re-tenta reenviando a mensagem inteira — um clique seu pode virar 6+ execuções da mesma tarefa pelo agente.

### A14. Catches vazios em `toChatMessages` — blocos de sistema somem em silêncio
**Sintoma:** 🟡 S3 — o agente pode "esquecer" a tarefa pendente sem nenhum log explicar por quê.
`chat-sender.ts:368-403`
**Na prática:** se falhar a montagem de algum aviso interno (ex.: "você tem uma tarefa pendente, retome"), ele é simplesmente omitido — o agente esquece a tarefa e ninguém sabe por quê, porque nenhum erro é registrado.

### A15. Promotion de heartbeat stale (45s) fabrica resposta final falsa
**Sintoma:** 🔵 S4 e 🔴 S1 — a tela diz "terminou" quando não terminou; respostas legítimas ficam presas.
`chat-sender.ts:235-238, 1071-1093`
Heurística de heartbeat por emoji inicial: resposta legítima começando com "✅" e <180 chars é classificada como heartbeat.
**Na prática:** um aviso de progresso parado há 45s é promovido a "resposta final" — a tela diz que terminou, mas o agente ainda está trabalhando. E respostas curtas começando com ✅ podem ficar presas, nunca exibidas como resposta.

### A16. Dois turnos simultâneos do mesmo agente se sobrescrevem em `activeAgentRequests`
**Sintoma:** 🔵 S4 — quando você intervém, o controle do turno anterior se perde e ele roda solto.
`chat-sender.ts:69, 1288` — segundo turno sobrescreve o registro sem abortar o primeiro; stop só enxerga o mais novo.
**Na prática:** se você manda duas mensagens seguidas pro mesmo agente, o controle da primeira se perde — o "parar" só afeta a segunda; a primeira roda solta até o fim.

## Baixos

### A17. Código morto: aparato SSE inteiro, `navigateToAgent`, `NormalizedImagePayload`/`buildImageContentPart`/`urlToDataUri`.
**Sintoma:** 💣 Latente — peso e confusão; funcionalidades que parecem existir (monitor em tempo real) mas estão desligadas.

### A18. `capMessage` corta bytes com String.slice (code units) — pode partir caractere multibyte.
**Sintoma:** 💣 Latente — texto corrompido (acento quebrado) enviado ao agente em mensagens longas em português.

### A19. `resetAgentSession` reseta por agentId GLOBAL e qualquer erro vira soft-ack ok:true.
**Sintoma:** 💣 Latente — hoje inofensivo se o endpoint não existir; se o gateway passar a suportar, um reset "da sua conversa" apagaria a memória do agente PARA TODOS os usuários. E o reset que falha finge sucesso.

---

# PARTE B — Loop Architecture, Automações, Observabilidade, Provisionamento

> Sintomas desta parte: 🔴 S1 (tarefas/automações/agentes presos em "rodando"), 🟡 S3 (retomada refaz trabalho), 🔵 S4 (pausar não funciona), 💣 latentes (automações, white-label, segurança).

## Loop Architecture (agent_tasks)

### B1. [CRÍTICO] Zero watchdog — task zumbi fica running para sempre
**Sintoma:** 🔴 S1 — o seu sintoma nº 1 ao pé da letra.
`agent-task/index.ts` inteiro + migrations. Único caminho para failed é o próprio agente chamar `action:fail`. A migration `20260703171716` criou o índice parcial perfeito (`WHERE status IN ('running','checkpoint')`) e NADA o usa.
**Na prática:** tarefa longa cujo agente morreu fica "Rodando" pra sempre no painel, com a bolinha pulsando. Não existe vigia.
**Correção:** edge function `task-watchdog` via pg_cron (5 min): failed/stalled para tasks running com updated_at antigo.

### B2. [CRÍTICO] `scheduleAgentTurn` sem delivery webhook e timeout fixo 300s — resultado nunca volta
**Sintoma:** 🔴 S1 — export de agente que passa de 5 min vira task eterna.
`agent-task/index.ts:41-76` — diferente do automation-scheduler, o cron.add do export_agent não tem `delivery`.
**Na prática:** o gateway mata tarefas de export com mais de 5 minutos e a plataforma nunca fica sabendo — a task fica eterna na tela.

### B3. [CRÍTICO] Pause e resume se anulam — interromper é impossível por construção
**Sintoma:** 🔵 S4 — a razão estrutural de você não conseguir interromper.
`agent-task/index.ts:512-531`; `use-pending-agent-task.ts:52`; `pending-agent-task.ts:44-53`
`pause` só seta status='checkpoint' no banco (zero cron.remove/abort no repo — o turno continua no OpenClaw e o próximo checkpoint reverte). E o front injeta em TODA mensagem de chat a instrução de dar resume em tasks running/checkpoint.
**Na prática:** pausar uma tarefa é IMPOSSÍVEL hoje: o pause só muda uma etiqueta no banco, o agente continua rodando, e qualquer mensagem sua no chat — até um "oi" — instrui o agente a retomar. Você pausa, cumprimenta, e a plataforma manda ele voltar ao trabalho.
**Correção:** pause remove o job no gateway + status `paused` distinto excluído da injeção.

### B4. [ALTO] Loop de retomada infinita sem dedup/circuit breaker
**Sintoma:** 🟡 S3 — o agente pode repetir o mesmo erro por dias, retomando infinitamente.
`chat-sender.ts:368-376`; `agent-task/index.ts:428-439`
Injeção de resume em todo turno, sem contador/backoff. `resume` seta running incondicionalmente, inclusive sobre done/failed.
**Na prática:** uma tarefa que falha em loop é retomada infinitamente, sem limite de tentativas. E uma task já concluída pode ser "ressuscitada" por engano.

### B5. [ALTO] `checkpoint_data` raso — retomada refaz trabalho
**Sintoma:** 🟡 S3 — por isso a retomada refaz o que já estava pronto.
`agent-task/index.ts:355`; `pending-agent-task.ts:44-53`
Checkpoint = `{lastChunkDone, currentChunk, notes:""}`; prompt de retomada entrega só título, status, chunk e notes. Artefatos/decisões vivem só na sessão morta. Quem escreve é o agente (não confiável).
**Na prática:** o "salvamento" que deveria permitir retomar uma tarefa guarda quase nada — número do passo e uma nota de texto. Na retomada, o agente não sabe o que já produziu nem onde salvou: refaz tudo ou abandona o que existia.
**Correção:** schema mínimo obrigatório validado server-side (artifacts com paths, decisions, next_action).

### B6. [ALTO] Race read-merge-write no checkpoint
**Sintoma:** 💣 Latente — perda silenciosa de progresso quando dois salvamentos coincidem (ex.: onboarding em paralelo).
`agent-task/index.ts:381-424` — SELECT + merge em JS + UPDATE sem lock/CAS.
**Na prática:** dois salvamentos simultâneos se sobrescrevem — progresso registrado pode ser silenciosamente perdido.
**Correção:** merge no banco (`checkpoint_data || $1::jsonb`) ou RPC atômica.

### B7. [MÉDIO] checkpoint/complete/fail em task inexistente retorna ok:true
**Sintoma:** 💣 Latente — agente trabalhando em tarefa que já foi deletada, achando que está tudo certo.
Update sem verificação de linhas afetadas.
**Na prática:** o agente "salva progresso" numa tarefa que você já deletou e recebe "ok, sucesso" — continua trabalhando numa tarefa que não existe mais.

### B8. [MÉDIO] Auth fraca do agent-task
**Sintoma:** 💣 Latente — risco de segurança/integridade, não manifestado ainda.
`config.toml:18-19` + `agent-task/index.ts:87-106` — secret único compartilhado por todos os agentes + qualquer JWT autenticado pode delete/fail/pause (escritas com service role ignoram RLS).
**Na prática:** qualquer usuário logado (não só admin) consegue deletar/falhar/pausar tarefa de qualquer pessoa; e todos os agentes compartilham a mesma senha interna — um agente pode mexer na task de outro.

### B9. [BAIXO] `action:fail` sobrescreve notes com "" quando reason não vem (`:477`).
**Sintoma:** 🟡 S3 (agravante) — na falha, o histórico do que já foi feito é apagado, dificultando retomada.
**Na prática:** no momento em que a tarefa falha — quando o histórico é mais necessário — as anotações do que já foi feito são apagadas.

### B10. [BAIXO] Listagem limit(20) global sem paginação (`:492`).
**Sintoma:** 💣 Latente — vai aparecer quando houver >20 tasks: elas "somem" da tela mas seguem rodando.
**Na prática:** com mais de 20 tarefas, as antigas "desaparecem" do painel — mas continuam rodando no banco.

## Automações

### B11. [CRÍTICO] `automation_runs` sem callback ficam running para sempre
**Sintoma:** 🔴 S1 (versão automações) — "Rodando" eterno no histórico.
`automation-scheduler/index.ts:77-83, 132-135` — só automation-result finaliza.
**Na prática:** automação disparada cujo retorno nunca chega fica "Rodando" pra sempre no histórico — mesma doença das tasks zumbis.

### B12. [CRÍTICO] `automation-result`/`scheduler`/`trigger-automation` NÃO estão no config.toml
**Sintoma:** 🔴 S1 hoje (se o 401 estiver ativo, nenhum resultado volta) e 💣 bomba-relógio pra qualquer redeploy/remix.
Com verify_jwt default ligado, o callback do gateway é rejeitado com 401 antes do código rodar. Se hoje funciona, é por toggle manual no dashboard.
**Na prática:** três funções vitais de automação dependem de uma configuração manual invisível. Num redeploy ou remix, TODAS as automações param de reportar resultado — silenciosamente.
**Correção:** declarar explicitamente no config.toml (a auth interna via secret já existe).

### B13. [ALTO] Matching de horário por igualdade exata de minuto
**Sintoma:** 💣 Latente — automações puladas ou dobradas de forma aleatória; você ainda não percebeu, mas provavelmente já aconteceu.
`automation-scheduler/index.ts:20,38`. Sem marca d'água nem unique constraint.
**Na prática:** se o relógio interno atrasar 1 segundo, a automação das 09:00 é PULADA sem aviso nenhum; se rodar duas vezes no mesmo minuto, dispara EM DOBRO.

### B14. [ALTO] Secret do webhook validado por substring + secret na query string
**Sintoma:** 💣 Latente — segurança: a senha vaza em logs e a validação é frouxa.
`automation-result/index.ts:33`; `automation-scheduler/index.ts:88`.
**Na prática:** a "senha" do retorno das automações é conferida de forma frouxa e viaja na URL — vaza em qualquer log de acesso ou proxy no caminho.

### B15. [ALTO] Callback sem idempotência/ordem
**Sintoma:** 💣 Latente — histórico de automações mentindo (resultado real sobrescrito por duplicado/atrasado).
`automation-result/index.ts:63-79` — atualiza incondicionalmente.
**Na prática:** um retorno duplicado ou atrasado sobrescreve o resultado real da automação — o histórico mente.

### B16. [MÉDIO] Bloco de debug esquecido no scheduler
**Sintoma:** 💣 Latente — custo, ruído e vazamento de conteúdo nos logs, a cada minuto.
`automation-scheduler/index.ts:22-52` — 3 SELECTs (2 idênticos) e log da tabela inteira a cada minuto.
**Na prática:** a cada minuto, o sistema despeja TODAS as suas automações (com as instruções) nos logs.

### B17. [MÉDIO] pg_cron do scheduler NÃO versionado em migration
**Sintoma:** 💣 Bomba-relógio — num remix/restore, as automações simplesmente não disparam e ninguém percebe.
Só process-email-queue está em migration.
**Na prática:** o "relógio" que dispara as automações foi criado à mão no banco. Num remix ou restore, as automações não disparam — e não dá erro nenhum.

### B18. [MÉDIO] `GET /automations-api/pending` público sem auth; `trigger-automation` sem secret
**Sintoma:** 💣 Latente — exposição pública de dados e superfície de disparo sem senha.
`config.toml:15-16` + `automations-api/index.ts:112-139`; `trigger-automation/index.ts:20-39`.
**Na prática:** qualquer pessoa na internet consegue listar suas automações (nomes, agentes, horários, IDs de usuário) e potencialmente disparar automações — sem senha nenhuma.

### B19. [BAIXO] UUID do Rodrigo hardcoded
**Sintoma:** 💣 Latente — quebra o white-label na primeira instância de cliente.
`automations-api/index.ts:16`.
**Na prática:** as confirmações de automação vão sempre pra um usuário fixo (o Rodrigo). Em instância de cliente, iriam pra alguém que não existe lá.

### B20. [BAIXO] `import-cron-jobs` sem auth + ignora timezone
**Sintoma:** 💣 Latente — crons importados em horário errado (3h de diferença BRT/UTC) e endpoint sem senha.
**Na prática:** a importação de agendamentos não pede senha e ignora fuso horário — um cron criado em horário de Brasília vira horário UTC errado.

## Provisionamento via Lia

### B21. [ALTO] `agent_profiles.status='configuring'` sem transição automática nem rollback
**Sintoma:** 🔴 S1 (versão criação de agentes) — "Configurando" pulsando pra sempre.
`create-agent/index.ts:179, 259, 277-294`; `sync-agents/index.ts:79`
Lia falha → agent_creation_log registra failed/timeout mas o profile fica configuring. Sem retry, sem reconciliação, sem rollback do agente órfão criado no gateway.
**Na prática:** agente cuja criação falhou fica "Configurando" pulsando pra sempre na tela — sem erro visível, sem retry. E pode sobrar um agente fantasma no VPS que a plataforma não conhece.

### B22. [MÉDIO] `create-agent` responde `lia_notified: true` incondicionalmente
**Sintoma:** 💣 Latente — a UI afirma sucesso antes de saber; você descobre a falha bem depois.
`create-agent/index.ts:366-374` — resposta enviada antes do resultado do notifyLia().
**Na prática:** a tela diz "Lia notificada ✓" antes de saber se a notificação foi de fato — a UI mente pra você.

### B23. [MÉDIO] "Lia respondeu" ≠ "Lia executou"
**Sintoma:** 💣 Latente — agentes "criados" que na verdade não existem direito no VPS (sem SOUL.md etc.).
`create-agent/index.ts:275-284` — status responded se liaRes.ok, sem verificar se SOUL.md etc. existem no VPS. O próprio prompt implora "não responda apenas com texto — EXECUTE".
**Na prática:** se a Lia responder "ok, vou fazer!" e não fizer, o sistema considera o agente criado. Ninguém confere se os arquivos existem de verdade.
**Correção:** passo de verificação lendo os arquivos do workspace (o export-agent já sabe fazer isso).

### B24. [MÉDIO] `notify-orchestrator-onboarding` sem auth + fire-and-forget sem confirmação
**Sintoma:** 💣 Latente — contexto da empresa "propagado" sem confirmação de escrita; endpoint aberto.
**Na prática:** a propagação do contexto da empresa pros agentes é "avisei = feito" — marca como concluído sem confirmar que o COMPANY.md foi escrito. E o endpoint é aberto, sem autenticação.

### B25. [BAIXO] Branch onboarding do agent-task: dispatch síncrono dentro de waitUntil
**Sintoma:** 🔴 S1 (versão onboarding) — Lia trava depois de aceitar e a task fica "rodando" eterna.
`agent-task/index.ts:286-310`.
**Na prática:** se a Lia travar depois de aceitar a tarefa de onboarding, a task fica "rodando" eterna — mesma doença do B1.

## Observabilidade

### B26. [ALTO] `agent_stats.status` default 'online' — agente morto continua online
**Sintoma:** 🔴 S1 — a plataforma é estruturalmente incapaz de perceber agente caído.
`collect-agent-stats/index.ts:149, 382, 270` — nunca rebaixa para offline.
**Na prática:** agente morto continua aparecendo "online" pra sempre no monitoramento.
**Correção:** derivar status de last_active; marcar offline agentes ausentes do snapshot.

### B27. [ALTO] `context_tokens`/`context_window` gravados e NUNCA lidos
**Sintoma:** 🟠 S2 — o estouro de 1M era detectável com dado que JÁ existe no banco.
`ingest-token-snapshot/index.ts:40-41`; get-gateway-status usa só total/input/output.
**Na prática:** o gateway JÁ INFORMA quanto de memória cada agente está usando, a cada snapshot — mas nenhum código lê esse dado. Ponta solta diretamente ligada ao seu incidente.
**Correção:** alertar (e checkpointar preventivamente) quando context_tokens/context_window > 0.85.

### B28. [MÉDIO] `cron_jobs` com id aleatório fallback + upsert = duplicatas a cada snapshot
**Sintoma:** 💣 Latente — tela de Cron poluída com lixo crescente.
`collect-agent-stats:180, 410`.
**Na prática:** a tabela de agendamentos acumula duplicatas a cada coleta, poluindo a tela de Cron indefinidamente.

### B29. [MÉDIO] `gateway_health` sem retention; "offline" indistinguível de "coletor morto"
**Sintoma:** 💣 Latente — alarme falso de "gateway offline" quando quem morreu foi o coletor; tabela cresce sem limpeza.
**Na prática:** se o COLETOR morrer (não o gateway), o painel acusa "gateway offline" — alarme falso indistinguível do real.

### B30. [BAIXO] `agent_activity` paralela e desconectada de `agent_tasks`
**Sintoma:** 🔴 S1 (agravante) — dois registros de "executando" que divergem na tela; atividade órfã nunca fecha.
**Na prática:** existem DOIS registros separados de "o que está executando" que podem divergir — task morta com atividade viva, ou vice-versa.

---

# PARTE C — Velocidade de resposta

> Sintoma desta parte: ⚡ S5 — agentes demoram 7-20s pra responder, principalmente com tool calls. LLM em uso: DeepSeek V4 Pro (não Claude — REMIX_SECRETS.md desatualizado nesse ponto).

### V1. [ALTO] Pré-voo no navegador repetido a cada turno (~0,5-1,5s)
**Sintoma:** ⚡ S5 — soma ~1s antes de toda mensagem.
`chat-sender.ts:360-403, 1401-1447` — antes de enviar, todo turno roda: getSession, consulta de artefatos vivos, catálogo de integrações com endpoints, URLs assinadas — sequencial e sem cache.
**Na prática:** antes de cada mensagem sua sequer sair do navegador, o app gasta ~1 segundo consultando coisas que raramente mudam.
**Correção:** cachear os blocos por alguns minutos e paralelizar.

### V2. [MÉDIO] Cold start da edge function + consulta vps_config por request
**Sintoma:** ⚡ S5 — 1-3s extras na primeira mensagem após silêncio.
`gateway-chat` + `_shared/gateway-config.ts:20` — isolate frio custa 1-3s; a URL do gateway é lida do banco a cada chamada.
**Na prática:** a primeira mensagem após alguns minutos de silêncio paga 1-3 segundos de "aquecimento" do servidor intermediário — toda vez.
**Correção:** cache em escopo de módulo (sobrevive a invocações quentes); avaliar keep-warm.

### V3. [CRÍTICO] Prefixo instável quebra o cache automático da DeepSeek
**Sintoma:** ⚡ S5 — o principal suspeito dos 7-20s; explica a piora com tool calls.
`chat-sender.ts:360-409` — a DeepSeek cacheia por PREFIXO idêntico, automaticamente. O dn.os injeta blocos dinâmicos no topo (pending task, status do usuário, pasta, lista de artefatos) e usa janela deslizante slice(-30) — o prefixo muda em toda requisição → cache hit ~zero → prefill completo por rodada.
**Na prática:** o cache automático da DeepSeek — que faria tool calls voarem — é desperdiçado porque o começo do prompt muda a cada mensagem. Cada resposta e CADA FERRAMENTA re-processam todo o contexto do zero (3 ferramentas = 4 re-processamentos completos).
**Correção:** blocos estáticos primeiro, informação dinâmica no FIM (anexada à mensagem do usuário); com sessionUser ativo, enviar só a mensagem nova (converge com A2). Validar com prompt_cache_hit_tokens/prompt_cache_miss_tokens do usage da DeepSeek.

### V4. [MÉDIO] Reasoning do DeepSeek sem feedback visual
**Sintoma:** ⚡ S5 — silêncio de vários segundos que parece travamento.
Se o V4 Pro roda com thinking habilitado, há segundos de silêncio antes do primeiro token visível.
**Na prática:** enquanto o modelo "pensa", você vê silêncio total — sem indicador de progresso. Parece travado, mas está raciocinando.
**Correção:** verificar config por agente; exibir progresso via AAC durante o reasoning ou desligar em turnos triviais.

### V5. [MÉDIO] Fallback para polling de 5-10s quando o stream falha
**Sintoma:** ⚡ S5 — os atrasos "aleatórios": resposta pronta esperando o próximo tick do poll.
`chat-sender.ts:978-984` + achado A3.
**Na prática:** quando o streaming falha, sua resposta já pronta pode ficar até 10 segundos parada no banco, esperando o app conferir de novo.
**Correção:** corrigir A3 reduz drasticamente a frequência; encurtar o primeiro tick do poll.

### V6. [BAIXO] REMIX_SECRETS.md desatualizado — lista ANTHROPIC_API_KEY como "LLM dos super agentes"
**Sintoma:** 💣 Latente — instância nova (remix) começaria configurada errada.
**Na prática:** quem montar uma instância nova vai configurar a chave da Anthropic como pré-requisito, sendo que o LLM real é DeepSeek.

### Instrumentação (pré-requisito de tudo)
Adicionar marcas de tempo por turno: t_prévoo → t_edge → t_gateway → t_primeiro_token → t_completo, logadas de forma consultável.
**Na prática:** hoje ninguém sabe ONDE os 7-20s são gastos — sem medir, otimização é chute.

---

# Reconstrução do incidente relatado

1. **Cloudflare cacheou 404 no proxy `/api/marketing/`** → agente começou a debugar.
2. **Turno longo (>12s)** → A4 duplicou a execução (stream + dm-agent-reply na mesma sessão). Retries A13 multiplicaram. Histórico duplicado a cada turno (A2). Sessão cresceu sem compactação proativa (A2) e sem ninguém olhar context_tokens (B27) → **crash a ~1M tokens** = 🟠 S2.
3. Agente debugando tokens/contexto mencionou termos como "context window" na resposta → **A1 resetou a sessão dele no meio do trabalho**, reenviando só 6 mensagens de ≤2KB (A7). A Edge Function pronta estava numa resposta amputada/fora da janela → agente "esqueceu" a solução → **rabbit hole nginx com 7+ tentativas** = 🟡 S3.
4. Você interveio na DM → A5 (sem abort server-side) + A16 (turno novo sobrescreve o registro sem abortar o antigo) + B3 (pause impotente): o run antigo continuou. A6 pode ter descartado respostas finais na DM → **só respondeu pela MC** = 🔵 S4.
5. Durante tudo isso a UI mostrou "executando": A3 (erro vira poll de 15 min), A8/A9 (running sem expiração, status = eco do banco), B1 (task zumbi), B26 (online default) = 🔴 S1.

---

# Plano de correção priorizado

## Fase 1 — Estancar o sangramento (maior alavancagem, menor risco)
1. **Watchdog único** (edge function + pg_cron 5 min): varre `agent_tasks` (B1), `automation_runs` (B11), `agent_profiles` configuring (B21), `agent_activity` running (A8/B30) → marca stalled/failed por updated_at antigo. Usa índices que já existem. Adicionar alerta de contexto >85% lendo agent_token_snapshots (B27).
2. **Matar a execução duplicada por turno** (A4/A13/A16): um caminho por turno + idempotency key.
3. **Erro estruturado fim-a-fim** (A1/A3): overflow/erros por código HTTP/error.code, nunca string matching em resposta; gateway-chat devolve status real.
4. **Consertar pause/resume** (B3/B4): cron.remove no gateway + status paused + circuit breaker de resume.
5. **Declarar verify_jwt no config.toml** para automation-result/scheduler/trigger (B12) e versionar o pg_cron do scheduler (B17).
6. **Velocidade — V3:** estabilizar o prefixo do prompt (reordenar blocos, dinâmico no fim) + enviar só a mensagem nova em sessões com sessionUser (mesma correção do A2).
7. **Instrumentação de tempos fim-a-fim** (pré-voo → edge → gateway → primeiro token).
8. **Velocidade — V1/V2:** cache do pré-voo e do vps_config.

## Fase 2 — Confiabilidade dos agentes
9. Compactação proativa de sessão (~60-70% da janela) (A2).
10. Reset com resumo estruturado em vez de cauda truncada de 6×2KB (A7).
11. checkpoint_data com schema mínimo validado server-side + merge atômico no banco (B5/B6).
12. Heartbeats com flag explícita (A6/A15); failure marker em canais (A11); EdgeRuntime.waitUntil (A10).
13. Verificação real pós-Lia (ler arquivos do workspace) em vez de "respondeu = fez" (B22/B23/B24).

## Fase 3 — Higiene e hardening
14. Timeouts centralizados com hierarquia (A12, respeitando os ~100s do Cloudflare).
15. Auth: secret por agente, ownership em agent-task (B8); fechar automations-api/pending e trigger-automation (B18); secret fora da query string + comparação estrita (B14); idempotência no callback (B15).
16. Remover código morto (SSE desligado A17/A9, debug do scheduler B16), UUID hardcoded (B19), retention de gateway_health (B29), status offline derivado de last_active (B26), atualizar REMIX_SECRETS (V6).

## Dependências do lado VPS/OpenClaw (fora deste repo)

**Velocidade:**
- Usage da DeepSeek de respostas recentes: `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` (hit ~zero confirma V3).
- Config de reasoning/thinking do DeepSeek V4 Pro por agente (V4).
- Tamanho atual das sessões dos agentes principais (context_tokens por resposta).

**Estabilidade:**
- Endpoint de **abort/cancel de sessão ou job** (pré-requisito de A5/B3). `cron.remove` interrompe um agentTurn em execução ou só remove agendamento?
- Confirmar se `/v1/sessions/reset` existe e qual o escopo real (A19 — hoje resetaria o agente inteiro, todos os usuários).
- Endpoint/config de **compactação proativa** e exposição de tokens por sessão (A2).
- **Idempotency key** por turno no gateway (A4).
- Config atual de `timeoutSeconds` de agentTurn e comportamento no estouro (B2).

**Lovable/Supabase (dashboard):**
- Estado do toggle "Verify JWT" em automation-result / automation-scheduler / trigger-automation (B12).
- `SELECT jobname, schedule, command FROM cron.job;` — confirmar como o job do scheduler foi criado (B17).

---

# ATUALIZAÇÃO 2026-07-17 — Respostas da VPS (Lia) e do Lovable

## Correções ao diagnóstico original

1. **B12 INVERTIDO:** o default do Lovable Cloud é `verify_jwt = FALSE` (não true). Não há bomba de 401 — os callbacks funcionam. O problema real é o oposto: `automation-scheduler` e `trigger-automation` estão **públicos sem NENHUMA auth** (confirma e agrava B18). Correção: adicionar validação de secret nas duas + declarar explicitamente no config.toml.
2. **B17 REVISADO:** os 5 crons (automation-scheduler, sync-agents, sync-automation-status, cleanup-expired-files, cleanup-agent-activity-log) **ESTÃO versionados em migrations** — porém com **project ref e anon key da instância dn.ia hardcoded no SQL**. Num remix, os crons do cliente chamam as edge functions DO PROJETO DA dn.ia, não do dele. Pior que "não dispara": dispara no lugar errado. Mesma classe do remix-audit #6 (push/email com `zozyfhisrbkqvdcsdbfp.supabase.co` fixo em funções DB).
3. **B11 PARCIALMENTE MITIGADO:** existe `sync-automation-status` (5/5min) que espelha lastRunStatus do gateway pra `automations`. Mas: match por nome (frágil), não fecha `automation_runs` órfãos, e não cobre runs que nunca chegaram ao gateway.
4. **A19/A1 CONFIRMADOS COMO NO-OP:** `/v1/sessions/reset` NÃO EXISTE no gateway (404 testado). O "reset de sessão" do auto-recovery nunca resetou nada — soft-ack silencioso. O reset real é o slash command `/new` (que o gateway-chat JÁ suporta). O rabbit hole foi: resposta descartada + reenvio com 6 msgs truncadas, com a sessão do gateway intacta por baixo.

## Fatos novos do gateway (Lia)

- **Sessões:** limite 1M (contextTokens é o teto, não o uso). Uso real via totalTokens cumulativo. A sessão do incidente ainda existe: DM Rock (Rodrigo) = 497.133 tokens, **abortedLastRun**. Demais sessões: 37K-372K.
- **Reset automático JÁ configurado:** `session.reset mode=daily atHour=4 idleMinutes=120` — sessões resetam diariamente às 4h e após 120min idle.
- **Compactação EXISTE, modo `safeguard`** (reativa, age só perto do teto de 1M): reserve 50K, keepRecentTokens 30K, memory flush (deepseek-chat, soft 8K), pre-check mid-turn ativo. **Correção barata:** baixar o teto (ex.: 250-300K) no openclaw.json → compactação age muito antes, sessões enxutas, prefill menor. Config, não código.
- **NÃO existe endpoint REST de abort.** O que existe: slash command **`/stop`** (interrompe o agentTurn atual), timeout 300s, desconexão. **Implicação enorme: dá pra implementar o botão "parar" DE VERDADE hoje**, enviando `/stop` via gateway-chat (caminho de commandText já existe) — sem esperar desenvolvimento no VPS. Idem pause de task (B3): `/stop` + status paused.
- **Timeout agentTurn: 300s** (default). Ao estourar: abort do turno, evento lifecycle error, sessão sobrevive. Watchdog de idle do modelo: 120s sem chunks.
- **Cache DeepSeek (5 turnos da sessão da Lia):** cacheRead 11K-23,5K/turno, **cacheWrite sempre 0** → o input dos turnos dela está sendo quase todo servido do cache. Nuance importante pro V3: o cache do lado gateway parece saudável NESSA sessão; a hipótese do prefixo instável vale pro caminho dn.os-web (blocos dinâmicos injetados pelo chat-sender), não pro caminho nativo. Rebaixar V3 de "principal suspeito" para "suspeito a confirmar com instrumentação". Latência provável = prefill de sessão grande + reasoning + rodadas de tool + execução duplicada (A4) + pré-voo (V1/V2).
- **Reasoning:** thinking NOT SET no openclaw.json, mas o modelo gera reasoningTokens (20-198/turno) por padrão do provider. Contribuição pequena à latência.

## Fatos novos do Lovable

- **Backup:** política PITR/retenção não exposta via tools — verificar manualmente em Cloud → Overview → Advanced settings. Export manual disponível (Advanced settings → Export data). **Ação pré-mudanças: Rodrigo confirma a política e roda um Export manual como snapshot.**
- **Remix:** migrations rodam TODAS automaticamente no projeto novo (incluindo seeds dn.ia); secrets NÃO são copiados (cliente cadastra do zero — lista no header do REMIX_SECRETS); pg_cron habilitado por migration; crons recriados MAS apontando pra URL da dn.ia (item 2 acima).

## O repo JÁ TEM um dossiê de remix: `.lovable/remix-audit.md`

Auditoria interna (só-leitura) listando ~30 arquivos + 12 migrations de hardcodes dn.ia, com prioridade:
- 🔴 Bloqueantes: gateway URL `agentes.dnia.ai` default (7 arquivos, incl. `file-upload.ts` que nem lê vps_config); `'lia'` hardcoded em 10 arquivos de código vivo; UUID de canal `da171c99-...` no trigger `handle_new_user` (usuário novo não entra em canal nenhum no remix); 10 migrations com dados dn.ia (canais, integrações com credenciais, agentes); SOULs dos agentes hardcoded em `seed-agents/index.ts`.
- 🟡 Degradação: project ref fixo em push/email (`net.http_post`); domínios de e-mail dn.ia no auth-email-hook; integrações fake dn.ia visíveis pro cliente.
- Ordem sugerida pelo próprio dossiê: SOULs → 'lia' → gateway URL → migrations/UUID → resto.

## Plano revisado pré-lançamento (5 dias)

**Leva 0 — Ponto de restauração (antes de tudo):** tag git + pin Lovable + Export manual do banco + snapshot VPS + Rodrigo confirma política de backup no Cloud.

**Leva 1 — Remix-ready (o produto em si; maior prioridade):**
1. Crons por migration SEM project ref hardcoded (usar current_setting/vault) — B17 revisado.
2. Project ref fixo em push/email (remix-audit #6).
3. UUID de canal no handle_new_user → buscar canal público por query (remix-audit #3).
4. Gateway URL default vazio + validação no wizard; refatorar file-upload.ts e skill-manage pra lerem vps_config (remix-audit #1).
5. `'lia'` → `is_leader=true` nos 10 arquivos (remix-audit #2).
6. UUID do Rodrigo no automations-api (B19).
7. Auth nos endpoints públicos: automation-scheduler, trigger-automation, automations-api/pending, notify-orchestrator-onboarding, import-cron-jobs (B18/B20/B24 + achado Lovable).
8. REMIX_SECRETS.md atualizado (V6 + lista real de secrets que o Lovable confirmou).
9. Estratégia remix_mode validada (migrations com dados dn.ia — remix-audit #4; a migration remix_cleanup já existe, validar cobertura).

**Leva 2 — Estabilidade de alto impacto e baixo risco:**
10. Watchdog único (B1/B11/B21/A8/B30) + alerta de contexto via totalTokens dos snapshots (B27).
11. **Botão parar REAL via `/stop`** (A5/B3) — viabilizado pela resposta da Lia, sem dependência de VPS dev.
12. Trocar o reset fantasma por `/new` no auto-recovery + resumo estruturado no reenvio (A1/A7/A19).
13. VPS config (com a equipe): baixar contextTokens do safeguard pra ~250-300K + avaliar `session.reset idleMinutes` menor.
14. Instrumentação de tempos.

**Ensaio geral:** remix de teste "cliente fantasma" do zero (Lovable + VPS limpa + REMIX_SECRETS na mão) após Leva 1; segundo ensaio limpo no code freeze.

**Adiado pro pós-lançamento:** A4 (execução duplicada), A2/V3 (payload e prefixo), A6/A15 (heartbeats), B5/B6 (checkpoint), Fase 3 completa.

---

# POST-MORTEM — Sessão Rock que abortou (17/07/2026, ~16:20)

**Evidência de produção (logs fornecidos pelo Rodrigo).** CORRIGE o rótulo original: NÃO foi overflow de 1M (S2). Foi TIMEOUT de turno.

## Fatos dos logs
- Sessão DM Rock×Rodrigo abortou em **497K tokens — metade da janela de 1M**. A compactação safeguard (age perto de 1M) nunca disparou → sem overflow de contexto.
- ~10 análises pesadas acumuladas na sessão (contatos, pipeline, leads, agendamentos, faturamento, mensagem WhatsApp, 4 pilares, premium), cada uma com queries grandes na Nexus.
- Endpoints da Nexus retornaram `NOT_FOUND` 2x (retries, tokens desperdiçados).
- Correção de critério no fim (entrada no stage → closed_at) forçou **refazer todas as queries do zero**.
- **A resposta final estava COMPLETA no thinking block** (8 vendas, R$246k, breakdown por vendedor) — abortou "exatamente na frase final", cortada no meio da emissão.

## Diagnóstico corrigido
Assinatura de **timeout**, não de overflow: turno cortado no meio da emissão com resposta pronta atrás. Gateway tem turno=300s e idle watchdog=120s sem chunks (confirmado pela Lia). Cadeia causal:
1. Multiplicadores (A4 execução duplicada + A2 replay de 30 msgs) incharam a sessão a 497K vs 37-67K dos outros agentes.
2. Sessão inchada → prefill lento em todo turno.
3. Turno final = 497K prefill + retries NOT_FOUND da Nexus + rework completo após correção de critério.
4. Turno passou de 300s → morto no meio da emissão. Resposta pronta perdida.

**Conclusão:** o Rodrigo estava certo ("não deveria ter estourado") — não foi falta de janela, foi relógio de 300s batendo num turno lento por desperdício acumulado. A raiz são os multiplicadores (mantêm a sessão leve → prefill rápido → turno não chega a 300s).

## Implicações no plano
- **5.1 (matar multiplicadores) é a raiz — subir prioridade;** avaliar puxar A4 pra janela pré-lançamento se risco de regressão for baixo.
- **timeoutSeconds 300s é curto pra agente analítico com CRM externo** — candidato a ~600s na VPS (paliativo, config; a cura é sessão leve).
- **NOVO 5.11:** capturar/persistir saída parcial (ou thinking block) ao abortar turno — nunca mais perder trabalho concluído.
- **5.4 (checkpoint rico) evitaria o rework** da correção de critério.
- Reforça 2.6 (instrumentação): distinguir abort-por-timeout de abort-por-overflow no log, coisa que hoje não existe.
