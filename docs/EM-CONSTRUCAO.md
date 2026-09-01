# Em construção — o que saiu desta entrega sem ser apagado

Há um meio-termo real entre "está no ar" e "foi apagado": ideias que não entram
nesta entrega mas que a empresa não quer perder. Apagar seria decisão de produto
que não é da engenharia; deixar meio funcionando seria pior — a pessoa clica,
nada acontece, e ninguém sabe se é bug ou se é assim mesmo.

Este arquivo registra o que está nesse meio-termo, por quê, e **exatamente como
voltar**.

---

## O padrão

Sempre o mesmo, para não haver dúvida sobre o estado de nada:

1. **A rota continua existindo** e cai no componente `EmConstrucao`
   (`frontend/src/components/EmConstrucao.tsx`), que diz o que a funcionalidade
   *era* e que o trabalho está guardado.
2. **O código do front vai para `frontend/src/_legado/`** — fora da compilação
   (o `tsconfig.app.json` exclui essa pasta), dentro do repositório.
3. **O backend fica de pé.** Router e tabelas continuam. Não custam nada e são o
   que faz voltar ser mover arquivos em vez de reescrever a API.
4. **As edge functions vão para `backend/supabase/functions/_pausado/`**, para o
   placar da migração não contar como pendência o que foi adiado por decisão.
5. **O item entra na tabela abaixo.**

⚠️ **O que NÃO fazer: comentar o código no lugar.** Código comentado apodrece
sem ninguém notar — não compila, não é testado, e ninguém percebe quando o resto
do sistema o deixa para trás. Parqueado num diretório excluído tem o mesmo efeito
prático e continua sendo um arquivo de verdade, com histórico no git.

---

## Pausados

| Funcionalidade | Desde | Onde está o código |
|---|---|---|
| **Arena** | 10/08/2026 | `frontend/src/_legado/arena/`, `functions/_pausado/arena-*` |
| **Voz** (ElevenLabs) | 10/08/2026 | `frontend/src/_legado/voz/`, `functions/_pausado/*elevenlabs*` |
| **`turn-reconciler`** | 11/08/2026 | `functions/_pausado/turn-reconciler` — ver [`DECISAO-RECONCILIADOR.md`](DECISAO-RECONCILIADOR.md) |

### Arena

**O que era.** Uma sala de debate entre agentes: você monta uma arena, escolhe
vários agentes, dá um papel a cada um ("defensor", "crítico"), faz uma pergunta —
e eles respondem em rodadas, cada um lendo o que os anteriores disseram e
concordando, discordando ou complementando. Tinha também um modo voz, em que a
arena virava um agente conversacional da ElevenLabs.

**Por que veio.** É feature de demonstração da dn.ia. Faz sentido para quem vende
"IAficação": uma sala onde cinco agentes debatem entre si, com voz, é o que
impressiona numa reunião comercial — vende a ideia de um *time* de IA, não de um
chatbot. O ícone da tela é uma espada cruzada; não é utilitário, é espetáculo.

**Por que saiu.** Três coisas, todas verificáveis:

- **Nunca foi usada.** Zero arenas, zero sessões, zero mensagens e zero modelos
  no banco desde o remix.
- **A Health & Safety não vende IA, usa IA.** O debate entre agentes não produz
  nada que entre num processo daqui.
- **Era o que restava de mais caro.** Quatro edge functions só dela, todas
  dependentes da ElevenLabs — que precisaria ser contratada para uma tela que
  ninguém abriu.

**O que ficou de pé.** `app/routers/arenas.py` (listar, gravar, excluir, elenco,
sessões, mensagens, arenas por agente), as tabelas `arenas`, `arena_agents`,
`arena_sessions`, `arena_messages` e `arena_templates`, e o endpoint
`GET /arenas/por-agente/{id}`.

**Como voltar:**

```bash
git mv frontend/src/_legado/arena/componentes frontend/src/components/arena
git mv frontend/src/_legado/arena/Arena*.tsx      frontend/src/pages/
git mv frontend/src/_legado/arena/use-arena-*.ts  frontend/src/hooks/
git mv frontend/src/_legado/arena/arena-*.ts      frontend/src/lib/
git mv backend/supabase/functions/_pausado/arena-* backend/supabase/functions/
```

Depois, em `frontend/src/App.tsx`, trocar os três `<ArenaPausada />` pelas
páginas originais e restaurar os imports. E em
`components/agents/AgentDetailPanel.tsx`, restaurar o corpo de `useAgentArenas`
(está no histórico do git) para o card de voz voltar a oferecer "aplicar em
todas as arenas".

### ✅ War room — de volta em 01/09/2026, re-fonteada

**Não foi restaurada; foi refeita**, e a diferença é o que importa registrar.
Medido antes de começar: a `warroom-feed` lê 12 tabelas e **seis estavam
vazias**, entre elas as duas do conteúdo principal — `agent_results` (entregas) e
`agent_activity` (ações autônomas), zeradas nos 14 dias anteriores. As automações
reais moram no gateway (`cron_jobs`), não na tabela `automations`;
`subagent_watch` não tem escritor nenhum. **Portar fiel teria subido uma TV em
branco.**

As fontes passaram a ser o que este sistema de fato produz: briefings publicados
(`wiki_documents`), conversas, consumo (`usage_events`) e o estado dos agentes
(`agent_stats` + `agent_context_state`).

⚠️ **`online` não sai de `agent_stats.status`.** Ele vale `"ok"` em toda linha —
resultado da última execução, não sinal de vida. O sinal é `last_active`, com
janela de 30 min, e três estados: ligado, parado e **desconhecido** (agente que
nunca rodou não é agente parado).

⚠️ **Polling de 15s, não realtime.** O `/ws` exige JWT de usuário e a TV não faz
login — ela nunca conectaria. Para display sem operador, o polling ainda falha
melhor: a tela mantém o último feed e marca "sem atualizar desde HH:MM" em vez de
congelar mostrando ontem.

**A tela é a original.** Eu tinha escrito uma de 177 linhas com quatro blocos
empilhados, e estava errado: o valor da War room não é a informação, é o
desenho. A constelação — pessoas em hexágono, agentes em círculo, o núcleo
pulsando no meio, curvas que nascem quando alguém conversa com um agente e
partículas viajando por elas — já existia, versionada, com 378 linhas de
`src/styles/warroom.css` que nunca saíram do lugar. Só a fonte dos dados mudou.

**Onde está:** `backend/app/warroom.py` (lógica pura, 26 testes),
`backend/app/routers/warroom.py` (`GET /warroom/feed`, devolvendo a interface
`Feed` que a tela já esperava), `frontend/src/pages/WarRoomPage.tsx` (a
original, de volta de `_legado/`).

⚠️ **O rótulo do nó precisa de corte, e não é estética.** Conferido no navegador
em 01/09: uma mensagem de agente trazia o CSS de um artefato publicado e o nome
do Atlas saiu cuspindo `{ color:#E41A11; } .green {…` de ponta a ponta da
parede. `tarefa` corta em 46 caracteres, `papel` em 40 — e nenhum teste pegaria
isso, porque só aparece renderizado.

⚠️ **O arranjo dos nós ficou no `localStorage` da TV**, não em `app_settings`.
Some o único endpoint de escrita que este painel precisaria, e é mais certo: a
TV da sala e o notebook de quem espelha têm formatos diferentes e não deveriam
disputar o mesmo mapa.

**A TV entra por token.** `/warroom?t=<token>`, conferido contra o segredo
`WARROOM_TOKEN` (`ler_segredo`: `integration_secrets` primeiro, ambiente depois).
Quem já está logado entra sem token. **O link é a credencial** — rotacionar o
segredo é o que revoga. Sem o segredo configurado a TV não entra, e quem tem
sessão continua entrando: esquecer a config não abre porta nem derruba o painel.

Fora do `AppLayout` e **sem `ProtectedRoute`** — ele redirecionaria a TV para
`/login` antes de o token na URL ser lido.

**O que ficou de fora** (YAGNI, entra se fizer falta): layout arrastável,
watchdog de sessão longa, humanização de nome de cron e o modo voz.

---

### War room — como era antes da volta

**O que era.** Uma tela cheia para espelhar numa TV do escritório, mostrando os
agentes trabalhando ao vivo: entregas concluídas, ações autônomas e conversas
conforme aconteciam. Rodava fora do `AppLayout`, sem menu — feita para ficar
ligada num monitor, não para navegar.

**Por que veio.** Mesma origem da Arena: é vitrine. Um painel de parede com
agentes trabalhando é o que se mostra a visita, e faz sentido num produto vendido
como "seu time de IA".

**Por que saiu.** A `warroom-feed` (582 linhas) nunca foi portada, e portá-la
seria trabalho considerável para uma tela que depende de haver gente olhando uma
TV. Não é um processo da Health & Safety hoje.

**O que ficou de pé.** Nada específico no backend — a tela lia tudo pela
`warroom-feed`, que está em `_pausado/`. As tabelas que ela consultava
(`agent_activity_log`, `agent_results`, `conversations`) continuam vivas e
servindo outras telas.

**A `warroom-feed` continua em `_pausado/`** e não volta para a fila de
portagem: o endpoint novo a substitui. Fica como referência do que o painel mostrava
quando havia dado para mostrar.

### Voz (ElevenLabs)

**O que era.** Dois usos: o botão "ouvir" ao lado de cada resposta do agente no
chat, que lia o texto em voz alta, e a escolha da voz de cada agente no painel
dele — com um botão de testar.

**Por que saiu.** Decisão do Erick: *"ninguém aqui é cego para precisar disso no
momento"*. É acessibilidade que ninguém desta equipe usa hoje, e sustentá-la
custa uma assinatura da ElevenLabs.

⚠️ **Voltará.** A ElevenLabs deve entrar de qualquer forma para marketing, e
quando entrar o botão de ouvir e a escolha de voz voltam junto — a chave já vai
estar paga. Não trate isto como ideia descartada.

**O que ficou de pé.** As colunas `tts_voice_id` e `tts_voice_name` em
`agent_profiles`, e o `PATCH /agents/{id}` continua aceitando as duas. As vozes
já escolhidas não se perdem.

**Como voltar:**

```bash
git mv frontend/src/_legado/voz/elevenlabs.ts   frontend/src/lib/
git mv frontend/src/_legado/voz/VoicePicker.tsx frontend/src/components/
git mv backend/supabase/functions/_pausado/elevenlabs-tts \
       backend/supabase/functions/_pausado/list-elevenlabs-voices \
       backend/supabase/functions/
```

Depois, em `pages/ChatPage.tsx`, restaurar o import e o corpo de
`handleTtsToggle` (estão no histórico do git) e devolver os dois botões de
ouvir. Em `components/agents/AgentDetailPanel.tsx`, descomentar o bloco
`── Voz — PAUSADA ──` e a linha `<VoiceSection agentId={shortId} />`.

⚠️ Este é o único caso em que **comentei código no lugar** em vez de mover: a
`VoiceSection` vive no meio do `AgentDetailPanel`, e arrancá-la deixaria um
buraco mais difícil de entender do que o bloco comentado. As duas edge functions
e os dois arquivos de front, esses foram parqueados normalmente.

---

## Previstos

Conversados mas ainda não executados. Entram aqui pelo mesmo padrão quando a
decisão sair.

Nenhuma no momento.

### Resolvido: Lovable AI Gateway → OpenAI (10/08/2026)

`transcribe-audio`, `chat-image-vision` e `parse-company-context` foram portadas
para `app/routers/ia.py`, usando a OpenAI. Não estão pausadas — funcionam.

⚠️ **Por que OpenAI e não DeepSeek**, que é o provedor escolhido para os agentes:
o DeepSeek é modelo de texto. Serviria o `parse-company-context` e nada mais —
`transcribe-audio` precisa de áudio e `chat-image-vision` precisa de visão.
Manter dois provedores para economizar numa chamada rara não se paga.

A chave sai de `OPENAI_API_KEY` pelo `ler_segredo` — banco primeiro, ambiente
depois. Sem ela os três respondem **503 dizendo o que falta**, não 500.

---

## Notas relacionadas

- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado e próximos passos
- [`ROADMAP.md`](ROADMAP.md) — o placar
- [`TESTAR-SEGUNDA.md`](TESTAR-SEGUNDA.md) — roteiro de teste
