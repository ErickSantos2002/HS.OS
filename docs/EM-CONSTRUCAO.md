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
| **War room** | 10/08/2026 | `frontend/src/_legado/warroom/`, `functions/_pausado/warroom-feed` |

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

### War room

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

**Como voltar:**

```bash
git mv frontend/src/_legado/warroom/WarRoomPage.tsx frontend/src/pages/
git mv backend/supabase/functions/_pausado/warroom-feed backend/supabase/functions/
```

Depois, em `frontend/src/App.tsx`, trocar `<WarRoomPausada />` por
`<WarRoomPage />` e restaurar o import. E a `warroom-feed` volta para a fila de
portagem — ela ainda chama o Supabase.

---

## Previstos

Conversados mas ainda não executados. Entram aqui pelo mesmo padrão quando a
decisão sair.

| Funcionalidade | Situação |
|---|---|
| **Integração de voz** (ElevenLabs) | tratada como coisa futura |
| **Lovable AI Gateway** | decisão adiada — ver abaixo |

O **Lovable AI Gateway** sustenta `transcribe-audio`, `chat-image-vision` e
`parse-company-context` — transcrição de áudio, leitura de imagem no chat e
leitura automática do contexto da empresa no onboarding. Diferente da voz, estas
são funcionalidades que a equipe usaria de verdade; a decisão é sobre qual
provedor de LLM pagar, não sobre cortar.

⚠️ **A voz é maior que a Arena.** Cortar a Arena não elimina a ElevenLabs: ela
também alimenta o botão "ouvir" das respostas no chat (`pages/ChatPage.tsx`) e a
escolha de voz do agente (`components/VoicePicker.tsx`, usado no
`AgentDetailPanel`). Pausar a voz significa mexer nesses dois pontos também, e
aí `elevenlabs-tts` e `list-elevenlabs-voices` também vão para `_pausado/`.

---

## Notas relacionadas

- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado e próximos passos
- [`ROADMAP.md`](ROADMAP.md) — o placar
- [`TESTAR-SEGUNDA.md`](TESTAR-SEGUNDA.md) — roteiro de teste
