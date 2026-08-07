# Continuar aqui

Ponto de retomada da portagem. Atualizado em **07/08/2026**, ao fim de uma sessão
longa. Leia isto, depois `CLAUDE.md` e `docs/ROADMAP.md`.

---

## Placar — medido, não mantido à mão

O contador deste arquivo já mentiu uma vez: eu vinha incrementando a cada port
sem conferir, e ele chegou a dizer "72 de 73 resolvidas" com 13 functions ainda
na pasta. **Todo número aqui vem de um comando**, e o comando está ao lado.

| | Hoje | Total | Como medir |
|---|---|---|---|
| Edge functions fora da pasta | **60** | 73 | `73 - $(ls backend/supabase/functions \| grep -v _shared \| wc -l)` |
| Arquivos do front sem Supabase | **50** | 113 | `113 - $(grep -rl "integrations/supabase/client" frontend/src \| wc -l)` |
| Rotas na API própria | **120** | — | `curl -s localhost:8002/openapi.json \| jq '.paths \| length'` |

**Duas linhas têm que andar juntas.** "Tem substituto no backend" e "a tela usa o
substituto" são coisas diferentes, e confundi-las já deixou telas quebradas em
produção — ver *Armadilhas*, abaixo.

---

## Estado por subsistema

Sair do Supabase é substituir cinco coisas. Elas estão em estados muito
diferentes, e o resumo antigo ("Realtime ✅ portado") escondia isso:

| Subsistema | Substituto | Front religado | O que falta |
|---|---|---|---|
| **Auth** | ✅ JWT próprio (PyJWT + bcrypt) | 🟡 quase | 12 chamadas soltas; o fluxo de *reset por e-mail* não existe mais |
| **Storage** | ✅ `UPLOADS_DIR` em disco | ✅ **completo** | nada |
| **Realtime** | ✅ WebSocket + LISTEN/NOTIFY (`app/escuta_banco.py`) | 🟡 **9 de 22** | 13 arquivos ainda em `postgres_changes` |
| **Edge Functions** | 🟡 60 de 73 | ✅ sem pendências | 4 de trabalho real, 9 bloqueadas |
| **Banco** (RLS direto do browser) | 🟡 120 rotas | 🔴 **50 de 113** | 185 chamadas `.from("…")`, em 56 arquivos vivos |

O **banco é o subsistema que sobrou quase inteiro** e é o maior dos cinco. O
Realtime é o segundo: o hub existe e funciona, mas só o `use-channels.ts` o usa.

### Onde estão as 185 chamadas ao banco

```
21 live_artifacts    9 integrations       6 agent_results
17 agent_profiles    9 channel_messages   5 wiki_documents
15 profiles          9 channel_members    5 conversations
                     8 notifications      5 automations
                     8 company_profile    5 arena_agents
```

E os arquivos mais pesados, que é por onde não começar:

```
19 components/agents/AgentDetailPanel.tsx     12 components/LiveArtifactViewer.tsx
14 pages/ChatPage.tsx                         10 pages/AutomacoesPage.tsx
14 components/users/AddAgentDialog.tsx         8 hooks/use-arena-sessions.ts
13 hooks/use-notifications.ts                  8 components/settings/ConnectorsTab.tsx
```

---

## O que já funciona, verificado no navegador

- **Banco próprio** no Postgres da VPS — 69 tabelas, 191 policies de RLS ativas
  de verdade (o backend conecta como `hsos_app`, não como superusuário)
- **Autenticação própria** — JWT + bcrypt, com troca de senha exigindo a atual
- **Agentes** — criar, editar todas as abas, sincronizar, verificar modelo,
  liderança, acesso, excluir, exportar, arquivos do workspace
- **Chat com agente** — envio e resposta por long-poll do `agent.wait`
- **Canais** — criar, editar, mensagens, membros, anexos, resposta de agente
- **Automações** — CRUD, gatilho, disparo, importar crons, sincronizar status
- **Tarefas** (Loop Architecture) — checkpoint, pausar, retomar, concluir
- **Arquivos** — storage próprio em disco, cinco buckets, gerar PDF e DOCX
- **Arenas** — persistência completa (a voz ainda não)
- **Integrações** — a ponte `window.dnos.invoke()` dos live artifacts
- **Deploy** — `hsos.healthsafetytech.com` e `hsosapi.healthsafetytech.com`

---

## As duas coisas que travam o resto

Não são técnicas. São decisões suas.

### 🔴 Lovable AI Gateway

`transcribe-audio`, `chat-image-vision` e `parse-company-context` usam a LLM
hospedada pelo Lovable. Sair de lá significa escolher um provedor e pagar por
ele — ou aceitar que transcrição de áudio, visão de imagem e leitura automática
do contexto da empresa deixem de existir.

### 🟠 ElevenLabs

`list-elevenlabs-voices`, `elevenlabs-tts`, `arena-convai-create/update/signed-url`
e `arena-generate` — a voz da Arena. Mesma natureza: chave própria ou o recurso
sai do produto.

**Estratégia acordada:** portar tudo menos a chamada ao provedor, deixando-a
parametrizada. Assim a decisão vira configuração, não código.

---

## Próximo passo, em ordem de valor

### 1. Realtime — em andamento, 13 arquivos restantes

A infraestrutura está **pronta e verificada ao vivo**: trigger → `pg_notify` →
listener → hub → WebSocket. Oito telas já foram religadas.

Os 13 que faltam se dividem em dois grupos:

- **6 mecânicos** (`use-managed-skills`, `use-channels`, `use-notifications`,
  `use-agents`, `AgentDetailPanel`, `lib/realtime.ts`) — só refazem a busca
- **7 que leem `payload.new`/`payload.old`** (`use-agent-activities`,
  `use-dm-reads`, `use-persistent-draft`, `use-channel-threads`,
  `AgentActivityFeed`, `chat-sender.ts`, `ChatPage`) — estes precisam **buscar
  por id**, porque o evento não carrega conteúdo (ver o plano)

⚠️ **`usage_events` ficou de fora dos triggers** — recebe escrita em lote e um
evento por linha faria tempestade. `use-agents` e `AgentDetailPanel` a observam;
essas duas perdem o tempo real de consumo e recarregam por outro caminho.

**O plano está em [`docs/PLANO-REALTIME.md`](PLANO-REALTIME.md)** — levantado em
07/08. Resumo: LISTEN/NOTIFY do Postgres, não publicação nos endpoints, porque
`postgres_changes` captura mudança no **banco** e hoje escrevem nele também os
agentes, o coletor da VPS e a ponte de arquivos. E o `pg_notify` carrega só o
id: quem monta o payload completo é o backend, porque 7 dos 21 arquivos leem
`payload.new` e o limite de 8000 bytes do NOTIFY não comporta uma mensagem de
chat.

### 2. As 4 edge functions de trabalho real

| Function | Linhas | Observação |
|---|---|---|
| `turn-reconciler` | 864 | precisa do serviço `worker` — não há `pg_cron` na VPS |
| `skill-manage` | 647 | tela de Skills, viva |
| `warroom-feed` | 582 | a parede de TV |
| `collect-agent-stats` | 552 | webhook do coletor da VPS; **duas formas de payload**, e o payload real não está documentado — conferir antes |

### 3. O banco, tabela a tabela

Portar por **tabela**, não por tela: `live_artifacts` (21), `agent_profiles` (17)
e `profiles` (15) somam 53 das 185 chamadas, e boa parte dos endpoints já existe.

---

## ⚠️ Armadilhas que já custaram tempo

### Do projeto

- **`npx tsc --noEmit` não checa nada.** O `tsconfig.json` da raiz tem
  `"files": []`. O comando correto é `npx tsc --noEmit -p tsconfig.app.json`,
  rodado de dentro de `frontend/`.
- **Arquivo em `pages/` não quer dizer tela em uso.** Só **onze** páginas estão
  roteadas. Em 07/08 religuei a `ProfilePage`, que está morta, e deixei a
  `SettingsPage` — a viva, que serve `/settings` **e** `/profile` — quebrada.
  A conferência que funciona:
  ```bash
  grep -oP '<Route[^>]*element=\{<\K[A-Za-z]+' frontend/src/App.tsx | sort -u
  ```
- **Portar o backend não religa a tela.** Já aconteceu dez vezes: a edge sai da
  pasta, o endpoint entra, e a tela continua chamando `supabase.functions.invoke`
  de algo que não existe mais. A régua é
  `grep -r "functions.invoke" frontend/src | grep -v _legado`.
- **`$N::jsonb` com uma string do Python guarda um jsonb *string*, não objeto.**
  O asyncpg deduz o tipo do cast. Use `$N::text::jsonb`. Vale igual para
  `$N::timestamptz` → `$N::text::timestamptz`.
- **Ordem de rotas no FastAPI.** Prefixo fixo tem que ser declarado **antes** do
  parametrizado, senão o genérico engole. Já mordeu seis vezes: `/documentos/gerar`
  virava bucket, `/minhas/respostas` virava agente, `/produtividade` virava id.
- **`channels` não tem `updated_at`.** Um `SET updated_at = now()` ali dá 500.
- A coluna da senha é **`password_hash`**, não `encrypted_password` (esse era o
  nome no Supabase).

### Do gateway

- Ele **conecta com sucesso** e nega tudo com `missing scope` quando a identidade
  do cliente está errada — ou quando o scope não foi **pedido** no handshake
  (`SCOPES` em `client.py`).
- O **handshake dá timeout de vez em quando** com o túnel de pé e `/health` em
  200. Repita antes de concluir que caiu.
- O `model` é **assimétrico**: `agents.list` devolve `{"primary": "…"}`,
  `agents.update` exige string nua.
- As rotas REST de monitoramento (`monitoring/gateway/status`, `processes`,
  `events`, `cleanup-chrome`, `gateway/restart`) **respondem 404** nesta versão.
  Conferido ao vivo em 07/08.

### Do banco e do deploy

- **Superusuário bypassa RLS** — as policies ficam no catálogo sem proteger nada.
- No **PG 16+** a herança de role é gravada por associação: `ALTER ROLE NOINHERIT`
  posterior não altera GRANTs já feitos.
- `VITE_*` é embutido em **build**, não em runtime — no EasyPanel tem que ser
  *build arg*.
- `pg_cron` **não existe** na VPS; jobs agendados vão para um serviço `worker`.
- O Postgres da VPS **não suporta TLS**.
- **`integrations.integration_type` só aceita** `api_key`, `multi_key`, `mcp` —
  nunca `meta`. A Meta é reconhecida pelo nome ou pelo `key_name`.

---

## ⚠️ Erro de operação — não repita

Em 06/08/2026, uma sondagem mandou `agents.update` com um modelo inválido de
propósito, **esperando que o gateway recusasse**. Ele aceitou e gravou: a `nina`,
que é o `defaultId`, ficou com `model: "isto-nao-e-um-modelo"` em produção até
ser restaurada à mão. Na mesma sessão, outra sondagem sem `agentId` mandou uma
mensagem de verdade para ela.

**Regra:** leitura no gateway (`*.list`, `*.get`, `*.status`) é livre. Escrita,
combinar antes. Para descobrir formato de parâmetro, use um **`agentId`
inexistente** — a chamada falha na busca do agente, antes de gravar. E confira
que **toda** chamada do lote leva o alvo inexistente: basta uma sem ele.

---

## Ainda por verificar junto com o Erick

Escrito e testado só nas guardas, porque o caminho feliz tem efeito real:

- **`PUT /agents/{id}/acesso`** — manda mensagem ao agente líder
- **Resposta de agente em canal** — dispara o agente de verdade
- **`DELETE /agents/{id}`** — apaga no gateway e em três tabelas
- **Disparo de automação** — executa no gateway

---

## Antes de escrever qualquer linha

1. **Suba o túnel SSH.** Sem ele, tudo que toca o gateway falha com
   `Connection refused` e o sintoma parece bug de código.
2. **Confira `CLAUDE.md`** — as armadilhas do gateway e do banco estão lá, e
   cada uma custou horas.
3. **Leia a edge function correspondente antes de portar.** As que restam em
   `backend/supabase/functions/` são a especificação: descrevem um sistema que
   funcionava. Foi assim que descobrimos que o protocolo do gateway tinha mudado.

---

## Pendências de infraestrutura que a portagem criou

- **`UPLOADS_DIR` precisa ser volume persistente** no EasyPanel. Sem isso, todo
  deploy apaga avatares, anexos e documentos gerados.
- **O WebSocket exige `wss://`** em produção: o token vai na query (a API do
  navegador não permite cabeçalho), então em `ws://` viajaria em claro.
- **O tempo real vive na memória de um processo.** Com mais de um worker do
  uvicorn, quem está no worker A não recebe o que foi publicado no B. Hoje roda
  em processo único e está correto — **mas isso vira problema ao escalar.**

---

## Decisões pendentes

| Decisão | Por quê importa |
|---|---|
| **Trocar a senha `admin123`** | Conta `super_admin` que guarda o token do gateway. O endpoint existe (`POST /auth/trocar-senha`) e a tela está pronta. Fazer **antes** de liberar para a equipe. |
| Lovable AI Gateway e ElevenLabs | Ver acima — travam 9 das 13 functions restantes. |
| Flags `dnos_flag_*` viram padrão? | São 4 correções de estabilidade hoje **desligadas**: o sistema roda com os bugs antigos ativos. |
| Manter as 191 policies de RLS? | Funcionam, mas duplicam a autorização do FastAPI. Se aposentar, vira a `003`. |
| Gerenciador de pacotes do front | Convivem `bun.lock`, `bun.lockb` e `package-lock.json`. |
| Fluxo de "esqueci minha senha" | Sumiu com o Supabase Auth. A `ResetPasswordPage` ainda existe e não funciona. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |

### Resolvidas

- ~~Credencial da Anthropic expirada~~ — **alarme falso.** O `models.authStatus`
  diz `expired` no perfil `anthropic:claude-cli`, mas a `nina` responde. Existe
  credencial que o `authStatus` não enxerga; `POST /agents/test-model` avisa,
  não condena.
- ~~Convite por e-mail~~ — **removido do produto** por decisão sua: a conta do
  colaborador é criada direto no sistema.

---

## Onde está o resto

- `CLAUDE.md` — arquitetura, convenções, o estado híbrido
- `docs/ROADMAP.md` — os lotes, princípios e o histórico
- `docs/DEPLOY.md` — EasyPanel, variáveis, o túnel, diagnóstico
- `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` — os 49 achados herdados (A1–A19,
  B1–B10); leitura obrigatória antes de mexer no caminho do chat
- `frontend/src/_legado/README.md` — o que sobrou do wizard
