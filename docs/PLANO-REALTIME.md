# Plano — substituir o `postgres_changes`

Levantamento de **07/08/2026**. Este é o maior bloco isolado que resta: 21
arquivos do front ainda abrem `supabase.channel(...).on("postgres_changes", …)`,
e é o que separa "o Realtime tem substituto" de "o Realtime foi substituído".

## O que existe hoje

`backend/app/realtime.py` é um hub de publicação/assinatura em memória, e
`backend/app/routers/ws.py` o expõe em `/ws`. Ele funciona, mas só conhece dois
tópicos — `topico_canal(id)` e `topico_usuario(id)` — e só o `use-channels.ts`
o consome. Os outros 21 arquivos continuam no Supabase.

## O levantamento

19 tabelas distintas são observadas pelo front:

```
4 channel_messages   2 agent_results        1 message_reactions
3 usage_events       2 agent_profiles       1 drafts
2 notifications      2 agent_activity_log   1 dm_reads
2 conversations      2 agent_activity       1 channel_agent_activity
2 agent_tasks        1 team_agents          1 automations
                     1 skills               1 agent_skills
                                            1 agent_crons
```

**A descoberta que decide o desenho:** dos 21 arquivos, **14 apenas refazem a
busca** quando algo muda — o payload é ignorado. Mas **7 leem `payload.new` ou
`payload.old`** e reagem ao conteúdo:

```
hooks/use-agent-activities.ts     components/agents/AgentActivityFeed.tsx
hooks/use-channel-threads.ts      hooks/use-dm-reads.ts
hooks/use-persistent-draft.ts     lib/chat-sender.ts
                                  pages/ChatPage.tsx
```

Um substituto que só avisasse "a tabela X mudou" quebraria esses sete.

## Por que LISTEN/NOTIFY, e não publicar nos endpoints

A alternativa óbvia era cada endpoint de escrita chamar `hub.publicar()` depois
de commitar. **Seria uma regressão de comportamento.**

O `postgres_changes` captura mudança no **banco**, não na API. Hoje escrevem no
banco: os endpoints FastAPI, os agentes pelo `/broadcast`, o coletor da VPS, a
ponte de arquivos, e qualquer `psql` de manutenção. Publicar só nos endpoints
deixaria a tela cega para todo o resto — e a mensagem que um agente publica num
canal é exatamente um dos casos que precisa aparecer sem recarregar.

Além disso seriam ~40 pontos de escrita para instrumentar, cada um com a chance
de alguém esquecer no próximo endpoint novo.

## O desenho

```
UPDATE na tabela
   └─► trigger  →  pg_notify('hsos_mudancas', {tabela, op, id})
                        └─► listener no backend (conexão dedicada)
                                └─► busca a linha completa
                                        └─► hub.publicar(tópico da tabela, linha)
                                                └─► WebSocket → navegador
```

**O evento carrega `{tabela, op, id}` e nada mais** — nem no NOTIFY, nem no
WebSocket. Dois motivos, e o segundo é o que manda:

1. O `pg_notify` limita a 8000 bytes, e o `content` de `channel_messages` passa
   disso sem esforço. A notificação seria descartada em silêncio.
2. **Segurança.** Um tópico de tabela é assinado por todo mundo que observa
   aquela tabela. Mandar a linha junto entregaria conteúdo a quem o RLS negaria.
   Mandando só o id, quem quer o conteúdo busca pelo endpoint normal — e lá o
   RLS decide.

⚠️ **Isto corrige o desenho de 07/08 pela manhã**, que dizia "o backend busca a
linha e publica o payload completo". Estava errado: teria criado uma segunda
cópia da autorização, fora do RLS, para manter em dia. O custo da correção é uma
ida a mais para as poucas telas que usavam `payload.new`.

## Ordem de execução

1. **`migrations/003_realtime.sql`** — a função de trigger genérica e os
   gatilhos nas 19 tabelas. A função é uma só; o `TG_TABLE_NAME` diz de onde
   veio.
2. **Listener no backend** — conexão asyncpg dedicada com `add_listener`,
   erguida no `lifespan`. Precisa reconectar sozinha: `LISTEN` morre com a
   conexão, e sem reconexão o tempo real morre em silêncio.
3. **Tópico de tabela no hub** — `topico_tabela(nome)`, e o `/ws` aceitando
   `?tabelas=a,b,c`.
4. **`frontend/src/lib/realtime.ts`** — assinar tabela, com o mesmo formato de
   evento que os hooks já esperam.
5. **Religar os 21**, começando pelos 14 que só refazem a busca (mecânicos) e
   deixando os 7 do payload por último.

## Armadilhas previstas

- **`LISTEN` não sobrevive à reconexão.** Se o Postgres reiniciar ou a conexão
  cair, o listener volta mudo. Reconectar e re-`LISTEN` é obrigatório, e a falha
  é silenciosa — nada quebra, o tempo real só para de chegar.
- **O hub vive na memória de um processo.** Com mais de um worker do uvicorn,
  quem está no worker A não recebe o que foi publicado no B. Hoje roda em
  processo único e está correto; ao escalar, isso vira Redis ou um processo
  dedicado.
- **Trigger em tabela quente custa.** `channel_messages` e `conversations` são
  as mais escritas. Vale medir antes de assumir que é de graça.
- **Não instrumentar `usage_events` cegamente:** três telas a observam, mas ela
  recebe escrita em lote pela varredura de uso. Um evento por linha inserida
  faria uma tempestade. Ou o trigger é `FOR EACH STATEMENT`, ou essa tabela fica
  de fora e a tela recarrega por outro caminho.
