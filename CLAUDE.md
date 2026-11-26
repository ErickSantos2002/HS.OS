# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Idioma: o código, os comentários e a documentação deste repositório são em **português**. Mantenha o padrão.

## O que é este projeto

**HS.OS** — plataforma de gestão de agentes de IA ("Mission Control"). O front conversa com
agentes que rodam num **OpenClaw Gateway** hospedado em VPS.

Origem: é um **remix (fork) do `dn.os`**, produto da dn.ia, adaptado pela Health & Safety — mesma
história do TalentHS, que já percorreu este caminho e serve de referência para as decisões daqui.
Isso explica as referências a `dn.ia` / `dnos` / `OpenClaw` espalhadas: são dívida de rebrand, não
decisão de arquitetura.

**Direção da migração — decisão tomada:** sair do Supabase por completo, para Postgres próprio na
VPS da HS, igual aos outros sistemas. Ao mexer em qualquer coisa, prefira a direção nova: não
acrescente dependência do Supabase que depois vai ter que ser desfeita.

Sair do Supabase é substituir **cinco** subsistemas, não só o banco:

⚠️ **"Substituto pronto" e "a tela usa" são colunas diferentes**, e juntá-las já
escondeu telas quebradas em produção. O placar tem que separar as duas:

| Subsistema | Substituto | Front religado | Destino |
|---|---|---|---|
| Auth | ✅ | ✅ **completo** | JWT próprio (PyJWT + bcrypt) |
| Storage | ✅ | ✅ **completo** | Cloudflare R2 (`app/armazenamento.py`); `UPLOADS_DIR` aposentado em 13/10/2026 |
| Realtime (`postgres_changes`) | ✅ | ✅ **completo** | WebSocket + LISTEN/NOTIFY, `app/escuta_banco.py` |
| Edge Functions | ✅ **73 de 73** | ✅ sem pendências | routers FastAPI |
| Banco (via RLS, direto do browser) | ✅ ~145 rotas | ✅ **0 chamadas vivas** | endpoints FastAPI |

O **banco saiu inteiro** em 10/08/2026: das 185 chamadas `.from("…")` originais,
**zero** continuam vivas, nenhum arquivo chama `functions.invoke`, e o único
lugar que ainda menciona o Supabase fora de comentário é o próprio
`integrations/supabase/client.ts` — que existe só para lançar quando alguém o
usar. O front está limpo.
O **Realtime saiu inteiro**: a captura é por trigger + `pg_notify`, o backend
roteia por `channel_id`/`user_id`/`agent_id`, e nenhum arquivo abre mais
`supabase.channel(...)`. Ver `docs/PLANO-REALTIME.md`.

⚠️ **`Hub.publicar` é SÍNCRONO e tem três argumentos: `(topico, tipo, dados)`.**
Chamar com dois — empacotando o `tipo` dentro do dicionário — levanta
`TypeError`, e dar `await` numa função que não é corrotina levanta outro. O
`mcp_alerta` fazia as duas coisas, dentro de um `try/except` que virava
`logger.warning`: **o push do alerta ao administrador nunca funcionou**, e o
sininho só acendia quando a pessoa recarregava a tela. Ficou assim por semanas
porque o registro no banco funcionava e ninguém conferia o efeito ao vivo.
Corrigido em 26/08/2026, encontrado ao testar o guardião de agendamentos, que usa
o mesmo caminho. Os outros doze chamadores sempre passaram os três.

O `/ws` também aceita tráfego **de volta**, para o que é efêmero e não deve
tocar o banco: hoje só o "fulano está digitando". O navegador manda
`{tipo: "digitando", topico: "canal:<id>"}` e o servidor republica no tópico —
depois de conferir que a conexão já assina esse tópico, o que só acontece para
membro do canal. O `userId` sai do token, nunca do payload.

O placar atualizado e a forma de medi-lo estão em `docs/ROADMAP.md`.

## Estrutura

Monorepo `frontend/` + `backend/`, mesma convenção dos outros sistemas da HS
(TalentHS, TaskHS, GestorHS):

```
frontend/          React + Vite
backend/
  app/             API FastAPI — auth, branding, profiles, gateway, agents
  app/gateway/     cliente WebSocket do OpenClaw + resolução de config
  migrations/      000 compat · 001 schema · 002 auth própria
  supabase/        as 73 Edge Functions: fonte da portagem, não código que roda
docs/              roadmap, deploy, auditoria herdada
escritoriohs/      EscritorioHS (WorkAdventure): config do EasyPanel e da mídia na VPS
scripts/           túnel SSH para o OpenClaw
docker-compose.yml backend:8002 + frontend:80
```

**`backend/supabase/` era um placar, e ele fechou em 11/08/2026.** Não há mais Edge Function
por portar: 65 viraram endpoints FastAPI e 8 foram arquivadas em `_pausado/` por decisão —
Arena, war room, voz e a `turn-reconciler`. A última tem o porquê escrito em
[`docs/DECISAO-RECONCILIADOR.md`](docs/DECISAO-RECONCILIADOR.md): ela existia para consertar
uma entrega que se perdia, e o nosso desenho **puxa** a resposta do gateway em vez de esperar
que a empurrem — o buraco que ela tapava não existe aqui.

**Retomando o trabalho? Comece por [`docs/CONTINUAR-AQUI.md`](docs/CONTINUAR-AQUI.md)** — estado
atual, próximos passos em ordem de dependência e as armadilhas que custam uma tarde.

**O plano da migração está em [`docs/ROADMAP.md`](docs/ROADMAP.md)** — lotes, ordem,
dependências e decisões em aberto. Consultar antes de escolher o que portar, e atualizar
o placar de lá quando um lote fechar.

## Comandos

Frontend — rodar sempre a partir de `frontend/`:

```bash
cd frontend
npm install          # npm é o gerenciador oficial — ver "Convenções"
npm run dev          # Vite dev server em http://localhost:8080 (host "::")
npm run build        # build de produção
npm run build:dev    # build com mode=development (source maps, tagger)
npm run lint         # ESLint 9 (flat config em eslint.config.js)
npm run test         # Vitest (jsdom), roda uma vez
npm run test:watch   # Vitest em watch

npx vitest run src/test/example.test.ts   # um teste, por arquivo
npx vitest run -t "nome do teste"         # um teste, por nome
```

Backend — a partir de `backend/`:

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env                      # preencher DATABASE_URL e JWT_SECRET
uvicorn app.main:app --reload --port 8002 # http://localhost:8002/docs

pip install -r requirements-dev.txt        # só o pytest; NÃO entra na imagem
python -m pytest tests -q                  # 156 testes, ~0,6s, sem banco nem gateway
python -m pytest tests/test_erro_interno.py -q
```

⚠️ **O backend TEM suíte e ela é rápida** — 16 arquivos em `backend/tests/`, pytest puro, sem
fixture nem banco. Não confunda com o frontend, onde a cobertura é de fato ~zero. Rodá-la leva
menos de um segundo e não há desculpa para mexer no backend sem ela.

⚠️ **O `pytest` vive no `requirements-dev.txt`, não no `requirements.txt`** — o `Dockerfile` copia
só o segundo, de propósito. Quem instalar apenas o `requirements.txt` não terá como rodar teste
nenhum, e o sintoma é `No module named pytest`, não uma mensagem que aponte para cá.

Os testes daqui têm docstring longa explicando **o que custou** o defeito que cada um tranca —
é o padrão do repo, e vale mantê-lo: o teste é o lugar onde a lição sobrevive ao commit.

⚠️ **Porta 8002, não 8000 nem 8001** — nesta máquina o `taskhs-backend` ocupa a 8000 e o
`gestorhs-backend` a 8001. O proxy `/api` do Vite aponta para a 8002.

**O gateway exige um túnel SSH aberto** para a VPS do OpenClaw, senão tudo que depende dele responde
`Connection refused`:

```bash
ssh -N -o ServerAliveInterval=30 -o ServerAliveCountMax=3 \
    -L 18789:127.0.0.1:18789 root@2.24.85.122
```

Sem o `ServerAliveInterval` o túnel morre em minutos de inatividade e o sintoma é confuso.

Login de desenvolvimento: `ti@healthsafetytech.com`. **A senha não fica aqui** — foi
rotacionada em 01/09/2026 e este repositório é público. Peça ao Erick.

Stack completa: `docker compose up -d --build` na raiz. Deploy: ver `docs/DEPLOY.md`.

Testes ficam em `frontend/src/**/*.{test,spec}.{ts,tsx}`, setup em `frontend/src/test/setup.ts`
(Testing Library + jest-dom). Hoje existe **apenas um teste** (`frontend/src/test/example.test.ts`) —
a cobertura real é ~zero.

**Playwright está quebrado:** `frontend/playwright.config.ts` importa `lovable-agent-playwright-config`,
pacote que **não está no `frontend/package.json`**. Era infra do Lovable. Ou adicione a dependência ou
substitua por um config próprio antes de tentar rodar E2E.

## Restrições do ambiente

- **O schema já foi extraído do Supabase e vive em `backend/migrations/`.** São dois arquivos, e a
  ordem importa: `000_compat_supabase.sql` (escrito à mão — recria os roles `authenticated`/`anon`/
  `service_role`/`sandbox_exec`, o schema `auth` com `auth.uid()`, e as extensões) e
  `001_initial_schema.sql` (gerado do dump — 69 tabelas, 3 views, 191 policies, 32 FKs). Sem o `000`,
  o `001` falha com 213 erros. Validado num Postgres 18 limpo com 0 erros. **Não edite o `001`** —
  ele é gerado por `_origem/regerar-001.sh`; mudanças de schema vão na `002+`. Ver
  `backend/migrations/README.md`.
- **O banco de origem está vazio.** As 69 tabelas e o `auth.users` têm 0 linhas — a migração é 100%
  de estrutura. Não existe conta de usuário cadastrada em lugar nenhum.
- **Se mantiver RLS, todo request autenticado precisa emitir `SET LOCAL app.current_user_id`** antes
  de qualquer query, senão `auth.uid()` devolve `NULL` e as policies negam. O setting **não** pode se
  chamar `app.current_role` — `current_role` é palavra reservada e o `SET LOCAL` dá erro de sintaxe.
- **`.env` não é mais versionado** (corrigido na reestruturação). Cada lado tem o seu:
  `frontend/.env` e `backend/.env`, ambos ignorados, com `.env.example` versionado ao lado.
- Os docs citam a tag de restauração `v1.0-pre-consolidacao` (commit `34f4a7e8`). **Ela não existe
  neste repositório** — o remix veio sem histórico (2 commits). Não conte com esse rollback.

⚠️ **Nada aplica migração sozinho. Deploy sobe código, não schema** — e a diferença fica
invisível até alguém usar a rota. Em 18/09/2026 o chat estava quebrado **havia duas semanas**:
a `016_seq_depois.sql` é de 09/09, o código que consulta a coluna subiu no deploy de 11/09, e a
coluna nunca foi criada em produção. Todo `POST /conversations/{id}/send` estourava com
`column "seq_depois" does not exist` antes mesmo de falar com o gateway. Ninguém viu porque
**entre 04/09 e 18/09 nenhuma pessoa usou o chat** — quem exercitou a rota foi o CEO.

É a mesma doença já catalogada aqui para os crons (*"rota que não tinha UM chamador"*) e para a
`agent_context_state`, um andar acima: **rota que só o usuário final exercita é bomba-relógio**,
porque a verificação que existe não passa por ela.

Ao mexer em migração, a conferência é contra o banco, não contra a pasta:

```bash
# o que o código espera × o que o banco tem — roda da máquina do Erick
cd ~/projetos/bancos && ./.venv/bin/python -c "
import bancos
print(bancos.uma_linha('hsos', \"SELECT EXISTS(SELECT 1 FROM information_schema.columns \"
      \"WHERE table_name='agent_runs' AND column_name='seq_depois')\"))"
```

⚠️ **E aplicar exige superusuário** — o `hsos_app` não tem `CREATE` em `public`. O Claude
continua **sem ler** o `admin.toml`, mas desde 13/10/2026 **ele mesmo roda** a migração (decisão
do Erick): um script `~/aplicar-hsos-NNN.py` que usa `bancos.conectar(..., perfil="admin")`
sozinho, executado com o Python do venv do cadastro —
`~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-NNN.py`. Com o `python3` do sistema
falha em `No module named 'psycopg'`. O script deve **conferir o efeito** ao final
(rodar a consulta que estava falhando), não só dizer que executou.

## Arquitetura

### Onde mora o detalhe — `docs/claude/`

⚠️ **Este arquivo tem teto**: o Claude Code avisa acima de 150 mil caracteres somando
este e o `~/CLAUDE.md`. Armadilha nova de uma área vai no arquivo da área, não aqui;
aqui fica só o que vale para qualquer mexida. **Antes de mexer na área, leia o arquivo:**

| arquivo | ler antes de mexer em |
|---|---|
| [`docs/claude/gateway-operacao.md`](docs/claude/gateway-operacao.md) | `llm.py`/provedores e catálogo, `sessions_send`/`agentToAgent`, `deny`/`alsoAllow` de MCP, vigia e compactação de sessão, reset diário, `cron.*`, guardião de crons e briefings, janela útil, `models.json` |
| [`docs/claude/guardi.md`](docs/claude/guardi.md) | bots pessoais (Guardi): criação, ferramentas, e-mail, token de agente e os sistemas (TaskHS, DataCore, DocsHS, GestorHS, HSGrowth), internet, Capacidade, agenda/lembretes, varredura |
| [`docs/claude/midas-e-relatorios.md`](docs/claude/midas-e-relatorios.md) | `midas`, `hsos-relatorios`, `publicar_pagina`, `compradores_produto`, régua de venda |
| [`docs/claude/conversas.md`](docs/claude/conversas.md) | celular (`frontend/src/celular/`), push, coletor de respostas, conversa pessoal, conversas anteriores, vistos, marcar não lida |
| [`docs/claude/anexos-e-voz.md`](docs/claude/anexos-e-voz.md) | R2, `anexos`, `ler_anexo`/`enviar_arquivo`, `relatorio_ponto`, resumo em áudio |

### O estado híbrido — leia isto antes de mexer em qualquer coisa

O sistema está no meio da travessia e **as duas arquiteturas convivem**:

```
                    ┌─► backend/app/  (FastAPI + Postgres próprio)   ← o alvo
React SPA (Vite) ───┤        └─► OpenClaw Gateway (WebSocket, via túnel SSH)
                    └─► Supabase      (o que ainda não foi portado)  ← em remoção
```

O que **já é nosso**: autenticação (com troca de senha), marca, perfis, gateway, agentes (ciclo
completo — criar, editar, sincronizar, verificar modelo, liderança, acesso, excluir, exportar,
arquivos do workspace), **conversa com agente**, **canais** (com resposta de agente), **automações**,
**tarefas**, **arquivos** (incluindo gerar PDF e DOCX), **arenas**, **integrações** e a infra de
**tempo real**. O resto ainda chama o Supabase.

**Regra ao portar escrita que toca as duas pontas: gateway primeiro, banco depois.** `PATCH
/agents/{id}` escreve nome e modelo no gateway **antes** de tocar no banco e aborta com 502 se ele
recusar — nada muda em lugar nenhum. As edges herdadas faziam o contrário (gravavam no banco e
seguiam com um `openclaw_warning` que a UI ignorava), e com o gateway fora do ar o banco passava a
dizer um modelo enquanto o agente rodava outro. Campos que só existem no banco (persona, skills,
crons, acesso) continuam editáveis com o gateway fora — travá-los seria pior.

Telas não portadas **falham de forma visível e nomeada**, de propósito — some sem explicação é pior
do que aparecer quebrado. Dois mecanismos fazem isso, e ambos devem ser respeitados ao portar:

- `gatewayNaoPortado("<área>")` em `frontend/src/lib/gateway.ts` — marca caminhos que falavam com o
  gateway direto do navegador
- O Proxy em `frontend/src/integrations/supabase/client.ts` — sem as variáveis do Supabase, o client
  não é criado e lança no primeiro uso, em vez de derrubar a aplicação no boot

### "Não foi possível falar com o servidor" NÃO quer dizer problema de rede

⚠️ **Essa frase é a mentira mais cara do sistema.** Ela sai de `api.ts:118` e cobre `status === 0`
**ou** `status >= 502` (`ErroApi.indisponivel`) — ou seja, três causas muito diferentes com a mesma
cara. Em 18/09/2026 mandou uma manhã inteira investigar firewall, túnel SSH e saturação do gateway
enquanto o defeito era **uma coluna faltando no banco**.

O que a tornava pior era um 500 que chegava disfarçado. A resposta de erro do FastAPI saía **sem
`Access-Control-Allow-Origin`**, o navegador a bloqueava, o `fetch` rejeitava, e o front classificava
como `status === 0`. **O DevTools mostrava o 500; a aplicação, não.**

⚠️ **Corrigido em 18/09/2026, e o conserto óbvio não era o certo.** `@app.exception_handler(Exception)`
**não** resolve: no Starlette ele é atendido pelo `ServerErrorMiddleware`, que a pilha monta **acima**
do `CORSMiddleware` — a resposta continua saindo sem cabeçalho. Quem resolve é capturar **por dentro**
do CORS, e é isso que `instalar_tratamento_de_erros` em `backend/app/erros.py` garante ao registrar os
dois na ordem certa (`add_middleware` faz `insert(0, …)`: **o último registrado fica por fora**).
Inverter as duas linhas devolve o defeito e **só** quebra `test_o_500_sai_com_cabecalho_de_cors` —
conferido invertendo de propósito.

Todo 500 agora sai como JSON com `detail` e uma **referência de 8 caracteres** que aparece na tela e
no log junto do traceback. O detalhe interno não desce para o navegador: numa rota de conector ele
carregaria nome de tabela e às vezes o valor recebido.

**Ao diagnosticar essa frase, o primeiro passo é o código de status real** — F12 → Network, não o
texto da bolha. O texto não distingue backend fora, gateway fora e exceção na rota.

### Gateway — protocolo e segurança

⚠️ **O OpenClaw fala WebSocket com JSON-RPC, não REST.** O código herdado chama `${url}/api/health`
e `${url}/v1/models`; esses caminhos **não existem mais** e devolvem 404 ou o HTML do painel. Não
copie chamada de edge function antiga sem verificar. O cliente correto está em
`backend/app/gateway/client.py`, e o contrato foi levantado testando ao vivo.

⚠️ **A identidade do cliente concede a permissão.** Só `client.id="gateway-client"` +
`client.mode="backend"` recebe os scopes de operador. Qualquer outra combinação **conecta
com sucesso** e é negada em cada método com `missing scope` — um modo de falhar particularmente
traiçoeiro.

⚠️ **O cliente pede os scopes; o gateway não infere.** `SCOPES` em `client.py` é a lista enviada no
handshake, e o gateway concede exatamente ela. Até 06/08/2026 pedíamos só `operator.read` e
`operator.write`, e como todo o Lote 2a era leitura ninguém notou — a primeira escrita
(`agents.update`) morreu com `missing scope: operator.admin`. Se um método novo negar por scope,
olhe essa lista antes de suspeitar do token.

⚠️ **Só conexões que chegam no loopback do gateway recebem scopes.** Por isso produção usa um túnel
SSH (`scripts/tunel-openclaw.sh`) e não o domínio público. Ver `docs/DEPLOY.md`.

⚠️ **`agents.update` não valida nada e grava.** Mandar `model: "isto-nao-e-um-modelo"` retorna
sucesso e deixa o agente com esse modelo — comprovado em 06/08/2026, no `nina` em produção, num teste
que **esperava uma recusa**. Não sonde a escrita do gateway com valor inválido: ele aceita. Para
descobrir formato, use um `agentId` inexistente, que falha antes de gravar.

⚠️ **O `model` é assimétrico.** `agents.list` devolve `{"primary": "anthropic/claude-sonnet-4-6"}`,
mas `agents.update` exige **string nua** e recusa o objeto com `at /model: must be string`.

⚠️ **A rota HTTP OpenAI-compatível sumiu.** `POST /v1/chat/completions` hoje é 404. **Doze** edge
functions ainda a usam — é a espinha do chat, e portanto do Lote 3: `gateway-chat`, `dm-agent-reply`,
`channel-agent-reply`, `agent-task`, `create-agent`, `update-agent-access`, `update-agent-leadership`,
`resend-agent-briefing`, `chat-image-vision`, `parse-company-context`, `export-agent`, `seed-agents`.
Todas precisam do mesmo substituto.

### `chat.send` — o substituto, levantado ao vivo em 06/08/2026

```
chat.send { sessionKey, message, idempotencyKey, agentId? }  →  { runId, status: "started" }
```

- ⚠️ **Sem `agentId` vai para o agente padrão** (`defaultId` do `agents.list`, hoje `nina`), sem
  aviso nenhum. Foi assim que uma sondagem mandou "ping" para a `nina` por engano. **Sempre mande
  `agentId` explícito**, mesmo quando parecer óbvio qual é o alvo.
- ⚠️ **A chave da sessão tem que ser mandada COMPOSTA**: `agent:<agentId>:<sufixo>`. Mandar só o
  sufixo com `agentId` junto é **recusado** — o gateway extrai o agente da própria chave e confere,
  devolvendo `agentId "X" does not match session key "Y"`. É esse nome composto que aparece no
  `sessions.list` e é o que o `sessions.delete` exige (em `key`, não em `sessionKey`).
  Em 12/08/2026 isto derrubou **todos** os avisos ao agente líder: o `_avisar_agente` mandava
  `system:<assunto>`, o gateway recusava, e como o envio era best-effort o erro morria no log —
  a tela dizia "agente criado" para um agente que nasceu com o template em branco.
- **`idempotencyKey` é obrigatório** e o `runId` volta igual a ele. O gateway passou a deduplicar
  nativamente — vale conferir se isso não resolve sozinho a execução duplicada catalogada em
  A1–A19 da auditoria, antes de reimplementar a fila do `chat-sender.ts`.
- `chat.send` é **assíncrono**: devolve `started`, não a resposta. A resposta chega por outro
  caminho (era o `agent-reply-webhook` no desenho antigo).

Por isso `POST /agents/test-model` verifica por `models.list` + `models.authStatus` em vez de
`chat.send`: mandar mensagem de verdade a cada clique custa tokens e polui o histórico do agente. Em
troca, ele **não** afirma que a LLM respondeu — só que está registrada, disponível e com credencial
válida.

### Leitura de arquivo do workspace — o gateway ganhou isso

```
agents.files.list  { agentId }               → { files: [{name, path, size, missing}] }
agents.files.get   { agentId, name }         → { file: { content, size, encoding, … } }
agents.workspace.list { agentId, path? }     → { entries: [{path, name, kind, size}] }
agents.workspace.get  { agentId, path }      → { file: { content, mimeType, encoding, … } }
```

Os canônicos que o `agents.files.list` devolve: `AGENTS.md`, `SOUL.md`, `TOOLS.md`,
`IDENTITY.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`. Confirmado ao vivo em 06/08/2026 lendo o
`SOUL.md` da `nina`.

⚠️ **Isto contradiz o comentário do `export-agent`**, que afirma (19/07/2026) que "o gateway em
produção não expõe NENHUM endpoint de leitura de arquivo funcional (`/api/files`, `agents.files.get`
RPC, `/api/agents/{id}/{key}` — todos 404 ou method not supported)". Era verdade naquela versão;
deixou de ser. Consequências ao portar:

- `export-agent` pede ao **LLM do orquestrador** para ler os arquivos e devolver JSON, com prompt de
  ~170s de timeout, justamente porque não havia outro jeito. Agora há leitura determinística.
- A ponte `dnos-files-bridge` na VPS (timer de 60s espelhando arquivos para a tabela `agent_files`)
  existia pelo mesmo motivo. **Saiu do caminho em 11/08/2026**: painel, exportação e importação
  falam com o gateway direto, e nenhum arquivo do front toca a `agent_files`. A tabela está com
  zero linhas — a ponte nunca escreveu nada aqui — e pode ser desligada na VPS.

⚠️ **`agents.create` exige `workspace`**, e a convenção dos agentes existentes é
`/root/.openclaw/workspace-<sufixo>`. O gateway ainda cria um `BOOTSTRAP.md` sozinho no workspace
novo (~1.7 KB), que não é um dos sete canônicos e nada do nosso lado escreve. Levantado em
11/08/2026 criando e apagando um agente de teste.
- `agents.files.get` usa **`name`** (nome canônico); `agents.workspace.get` usa **`path`**. Trocar um
  pelo outro dá `unexpected property`.

⚠️ **Regra de operação: não sonde método de escrita do gateway sem combinar antes.** Leitura
(`*.list`, `*.get`, `*.status`) é livre. Qualquer coisa que crie, altere ou envie: mostre o payload
e confirme. Em 06/08/2026 duas sondagens escaparam — uma quebrou o modelo da `nina`, outra mandou
mensagem para ela. Para descobrir formato de parâmetro sem escrever, use um **`agentId` inexistente**
(o gateway valida o schema e devolve o campo que falta antes de resolver o agente) — mas confira que
**toda** chamada do lote leva o alvo inexistente, porque basta uma sem ele.

⚠️ **O handshake WebSocket falha por timeout de vez em quando**, mesmo com o túnel de pé e
`/health` respondendo 200. `chamar()` já reconecta uma vez; em script solto, repita antes de
concluir que o gateway caiu.

⚠️ **Erro de conexão logo depois de um `config.patch` NÃO significa que não gravou.** O patch
dispara o reload, e o reload derruba o WebSocket — a exceção chega **depois** da escrita. Em
13/08/2026 isso produziu dois diagnósticos errados seguidos, um deles custando uma hora. Releia a
config e confira o efeito antes de concluir que falhou; `_aplicar_patch` em `backend/app/routers/llm.py`
faz isso e é o único lugar que deveria chamar `config.patch`.

### Resolução da config do gateway

`backend/app/gateway/config.py`: **o `.env` vence quando preenchido**, `public.vps_config` é o padrão
para quem não define nada.

A ordem é invertida em relação ao dn.os (que lia o banco primeiro) e isso foi deliberado: existe
**uma** linha em `vps_config` e ela não consegue valer para produção (`172.18.0.1`, bridge do Swarm)
e para a máquina de desenvolvimento (`127.0.0.1`, túnel SSH local) ao mesmo tempo. `/gateway/config`
devolve `fixado_por_env` para a tela não oferecer uma edição sem efeito.

### Caminho crítico do chat

`frontend/src/lib/chat-sender.ts` (~2100 linhas) é o coração e o arquivo mais delicado do projeto. Ele:

- mantém uma **fila em nível de módulo**, não em estado React — envios sobrevivem à navegação entre páginas;
- persiste tudo na tabela `conversations` (não em memória) e emite `CustomEvent` para o `ChatPage`
  montado atualizar em tempo real;
- é acoplado ao React Query por injeção: `setQueryClientForSender(queryClient)` é chamado uma vez em
  `frontend/src/App.tsx`.

O ciclo completo de uma resposta envolve várias Edge Functions: `gateway-chat` (envio),
`dm-agent-reply` (fallback de reenvio em segundo plano), `agent-reply-webhook` (resposta assíncrona
do agente volta por aqui), `turn-reconciler` e `agent-task` (Loop Architecture, tarefas longas com
`checkpoint_data`).

Antes de mexer aqui, leia `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` — os bugs A1–A19 e B1–B10 documentam
exatamente as armadilhas deste caminho (execução duplicada, falso-positivo de context overflow,
heartbeat descartando resposta final).

#### O `chat.history` mente por omissão em duas frentes — as duas custaram uma entrega ao CEO

Levantadas em 09/09/2026 conferindo a conversa de 08/09
(`docs/CONFERENCIA-CONVERSA-2026-09-08.md`). São defeitos do mesmo método: **ler
o `chat.history` como se ele fosse a conversa, quando ele é uma projeção para
exibição.**

⚠️ **1. Ele corta o texto em 8.000 caracteres e o corte vem como conteúdo.** O
`truncateChatHistoryText` do OpenClaw devolve `` `…\n...(truncated)...` `` com
`DEFAULT_CHAT_HISTORY_TEXT_MAX_CHARS = 8e3`. Os dois panoramas que a `nina`
entregou ao CEO em 08/09 saíram com 8.018 caracteres, cortados no meio do HTML —
e **o link ia depois do corte**, por isso ele perguntou "qual o link?".

**Passe `maxChars`**: `chat.history` aceita o parâmetro e 8.000 é só o padrão
(`resolveEffectiveChatHistoryMaxChars`). É o que `_MAX_CHARS_HISTORICO` faz nos
quatro pontos que montam texto de resposta. ⚠️ **O corte é por BLOCO de texto,
não por mensagem** — resposta longa em vários parágrafos escapa, painel HTML num
bloco só não escapa. É por isso que passou meses despercebido.

⚠️ **2. `limit` pequeno devolve fatia velha, e o `piso` que conserta isso vira
teto.** Três encarnações do mesmo defeito: `limit=1` errando aos 52 (17/08),
`limit=5` errando aos 177 (24–30/08), e em 08/09 o `piso` — que era
`max(seq_antes)`, ou seja **o último valor que o gateway acertou** — congelado em
119 por três turnos, com o CEO recebendo a resposta anterior colada na frente
duas vezes.

O conserto é `agent_runs.seq_depois` (migração `016`): o `/reply` lê o histórico
com `limit=40` e **sabe** qual `seq` consumiu; guardar esse número faz o piso
andar com a conversa. **Ao mexer no corte, desconfie de qualquer piso que só
olhe o que foi ENVIADO** — ele não sobe sozinho.

⚠️ **O piso sobrevivia ao "Limpar".** O `/limpar` arquiva a sessão e ela volta
**vazia**; a proteção contra sessão renumerada (09/09) só reconhecia o recomeço ao
ver `seq=1`, que sessão vazia não tem. O primeiro envio saía com o corte da
conversa velha (44), a resposta vinha com `seq` 1..4 e a tela dizia "O agente
terminou sem produzir texto". Desde 30/09/2026, histórico vazio = corte 0
(`_ultimo_seq`, com teste).

⚠️ **`/reply` e `/recuperar` gravam a mesma resposta por caminhos diferentes, e
cada um já a duplicou numa ordem.** Em 29/09/2026 o `/recuperar` (ao abrir a
tela) pegou no gateway a resposta de um run ainda em curso e o `/reply` gravou de
novo 13s depois. Os dois agora passam por `_gravar_resposta`: trava por pessoa e
agente, procura a mensagem igual e só então insere. Assinatura para diagnosticar
bolha dobrada: o `created_at` do `/recuperar` tem milissegundos, o do `/reply`
tem microssegundos.

### Feature flags — sobrou uma, e ela vem ligada

⚠️ **Revisadas em 31/08/2026, e o que estava escrito aqui não batia com o
código.** Esta seção listava quatro flags desligadas por padrão, como decisão em
aberto. Eram três no código, e duas delas já não faziam nada.

| flag | estado |
|---|---|
| `hsos_flag_real_stop` | **ligada por padrão** desde 31/08; grava `off` para voltar ao antigo |
| `hsos_flag_reorder_prompt` | **removida** — nunca era chamada |
| `hsos_flag_structured_errors` | **removida** — nunca era chamada |
| `hsos_flag_fix_overflow_falsepositive` | **nunca existiu no código**; só estava documentada aqui |

As duas removidas morreram quando o `agent-chat.ts` substituiu o miolo de rede
do `chat-sender.ts`: o front não monta mais o prompt (quem guarda a conversa é a
sessão no gateway) nem lê o stream do gateway (a resposta vem pronta pela nossa
API). Ligar qualquer uma delas não faria nada.

A `real_stop` é a que importava, e estar desligada era o desperdício: com ela
`off`, "parar" só aborta o poll do navegador — a resposta some da tela e **o
agente segue rodando e gastando no gateway até terminar**. Ninguém nunca a
ligou, então esse foi o comportamento desde sempre. A decisão mora agora em
`cancelamentoRealLigado()`, em `frontend/src/lib/chaves-locais.ts`, onde dá para
testá-la sem levantar a camada de rede e onde a migração do nome antigo já é
assunto do arquivo — quem desligou como `dnos_flag_real_stop` continua desligado.

⚠️ **A lição vale mais que as flags: "decisão em aberto" documentada envelhece
igual a código.** Três das quatro linhas desta seção descreviam um sistema que já
não existia, e a decisão ficou "pendente" semanas esperando alguém escolher entre
opções que tinham deixado de ser opções.

### Estado e persistência

- **`app_settings` (tabela) substituiu o `localStorage` para configuração** — ver `frontend/src/lib/app-settings.ts`,
  com cache em memória. As exceções deliberadas ainda em `localStorage`: as feature flags acima e o cache
  de branding (`dnos-branding-cache`).
- Dados de servidor: **TanStack Query**, um `QueryClient` global em `frontend/src/App.tsx`.
- Contextos React são poucos e específicos: `AuthProvider` (`frontend/src/components/AuthGuard.tsx`),
  `FileSystemProvider`, `ThemeProvider`.

### Autorização

**Dois papéis: `administrador` e `colaborador`**, guardados em `user_roles` e checados no banco por
`has_role` (usada nas policies de RLS). Eram três com os nomes herdados (`super_admin`, `member`,
`user`); a `005_papeis_e_pessoas.sql` renomeou e fundiu — `member` e `user` não se distinguiam na
prática. No back o guard é `exige_papel`; no front, `allowedRoles` do `ProtectedRoute`.

⚠️ **Os papéis são acesso ao sistema, não hierarquia da empresa.** O CEO é `colaborador`. Ler
`colaborador` como "menos importante" leva a decisão errada — inclusive nos arquivos dos agentes,
onde isso está escrito de propósito.

Uma pessoa pode ter mais de uma linha em `user_roles`; vale o papel mais forte, resolvido por
`ORDER BY CASE ... LIMIT 1` em `profiles.py`.

Instalação zerada não tem usuário e não há cadastro público — a tela de login detecta isso e oferece criar
o primeiro admin via `bootstrap-first-admin`, que cai direto no wizard de `/setup`.

#### `/agents` é administração, e é só do administrador

⚠️ **A página "Super agentes" ficou aberta ao `colaborador` até 14/08/2026, e com ela a leitura dos
sete arquivos** — ou seja, o prompt de sistema do agente, que o próprio agente recusa mostrar quando
alguém pede. O `SOUL.md` manda não revelar o contexto de sistema e a tela entregava em dois cliques.

Pior que a leitura: **`POST/PATCH/DELETE /agents/{id}/crons` estavam em "só logado"** — qualquer
pessoa autenticada criava, editava e apagava agendamento de qualquer agente. Escrita, não leitura.

Hoje são `exige_papel("administrador")`: `arquivos`, `arquivos/{nome}`, `arquivos-espelhados`,
`consumo`, `estatisticas`, `guardrails`, `log-criacao`, `agendamentos-do-gateway`, `integracoes`,
`atividade-recente` e os quatro verbos de `crons` — além das escritas que já eram.

**Continuam abertas ao colaborador, e não devem ser fechadas sem quebrar o chat:**

| rota | quem usa |
|---|---|
| `GET /agents` | a lista, **já filtrada por `_pode_ver`** — ele só enxerga os agentes dele |
| `GET /agents/{id}` | idem |
| `GET /agents/{id}/contexto` | `ContextWindowIndicator`, dentro do `ChatPage` |
| `GET /agents/{id}/atividades` | `AgentActivityCard`, dentro do `ChatPage` |

**No front a divisão é entre a página e o painel, não entre as duas rotas.** `/agents` fica aberta
ao colaborador — o mapa da frota é visão do time (quem existe, quem lidera, quem fala com quem) e
foi pedido assim. `/agents/:agentId` é `allowedRoles={["administrador"]}`.

O que separa é o **overlay**: clicar num agente abre o `AgentDetailPanel` para o admin e o
`AgentResumoPanel` para o colaborador.

⚠️ **O `AgentResumoPanel` existe para NÃO reusar o `AgentDetailPanel` com condicionais.** Aquele
tem ~1700 linhas e ~15 seções soltas (custo, crons, integrações, guardrails, sessões, usuários
recentes) — esconder seção por seção é onde se esquece uma. O painel novo só mostra o que já veio
no `GET /agents`. Se um dia precisar de mais um dado, o dado tem que vir de endpoint aberto ao
colaborador, não de um `exige_papel` afrouxado.

No roster, o clique navega para `/agents/:id` só para o admin; para o colaborador ele seleciona no
mapa. A busca global manda o colaborador para `/chat?agent=<id>` em vez de `/agents/<id>`, senão ele
clicaria num agente e seria devolvido ao chat pelo `ProtectedRoute`, o que parece defeito.

⚠️ `GET /agents` devolve `workspace`, `model` e `allowedUserIds` a quem pode ver o agente.
`systemPrompt` volta **vazio** e `tokensUsed` zerado — conferido com token de colaborador. Se algum
dia o `systemPrompt` passar a vir preenchido ali, o mapa vira vazamento.

#### Configuração em `app_settings` é global

⚠️ **`PUT`/`DELETE /configuracoes/{chave}` estavam em "só logado".** A tabela guarda **uma linha por
chave para a instalação inteira**, não por pessoa: hoje a posição do mapa neural e do mapa de times,
amanhã o que mais migrar do `localStorage`. Qualquer colaborador reescrevia qualquer chave, e o que
ele arrastasse e salvasse mudaria a tela de todo mundo.

Hoje são `administrador`; o `GET` continua aberto, porque todo mundo precisa carregar o layout. Na
tela, os botões "Salvar layout" do `NeuralMap` e do `TeamsPage` só aparecem para admin — **arrastar
continua livre**, porque é local e some ao recarregar.

⚠️ **Esconder no menu não é fechar.** Cada uma dessas rotas foi conferida com um token de
`colaborador` emitido na mão (`emitir_token(...)`), batendo na API direto — a tela some para quem
não deve ver, mas quem fecha é o `exige_papel`.

#### Senha: quem define é o administrador

⚠️ **Colaborador não troca a própria senha.** `POST /auth/trocar-senha` recusa quem não é
`administrador`, com mensagem própria em vez do "permissão insuficiente" genérico — quem esbarra
nisso está diante de um campo de senha e precisa saber para onde ir. Quem define senha de outra
pessoa é o admin, por `POST /profiles/{user_id}/senha`, que **não pede a senha atual**: quem troca
não a conhece, e exigi-la tornaria a rota inútil. O que autoriza é o papel, e por isso ele é a
defesa inteira.

Não é regra genérica de segurança, é o desenho de acesso desta empresa (decisão do Erick,
14/08/2026): a HS é fechada e as pessoas entram pelo **FortiPAM**, que guarda a credencial. Troca
por fora do cofre o deixa guardando uma senha que não abre mais nada. **Numa instalação sem cofre,
soltar a rota para todo mundo seria o certo** — não copie esta restrição sem o FortiPAM junto.

Na tela: o cartão "Alterar Senha" em Configurações → Perfil só aparece para admin; o colaborador vê
no lugar uma linha dizendo onde a senha mora. Em Usuários há o botão **Senha** por pessoa.

`needsPasswordSetup` em `use-auth.ts` é **sempre `false`** e o redirecionamento para
`/reset-password` no `ProtectedRoute` nunca dispara; `profiles.status` nasce `'active'` por default
da coluna. Ou seja, ninguém fica preso numa tela de definir senha que agora recusaria — mas se
alguém reativar aquele fluxo, precisa reativá-lo **para admin apenas**.

### Roteamento

Todas as rotas ficam em `frontend/src/App.tsx`, em `<Routes>` aninhados. Quatro categorias:

1. **Públicas** — `/login`, `/reset-password`, `/artifact/:id`, `/p/:slug`, `/wiki-html-preview`
2. **Autenticadas sem layout** — `/warroom` (tela cheia para TV), `/setup` (wizard)
3. **Autenticadas com `AppLayout` + `OnboardingGate`** — todo o resto
4. **Redirects legados** — `/dnos`, `/mission-control`, `/users`, `/documentation` caem em abas de `/settings`

`/` redireciona para `/chat`.

⚠️ **A maioria dos arquivos em `frontend/src/pages/` NÃO é tela em uso.** Só onze estão roteadas; o
resto foi absorvido por outras telas e sobrou como arquivo. `ProfilePage` é o caso exemplar: virou
aba da `SettingsPage`, que serve `/settings` **e** `/profile`, e o nome só aparece num comentário do
`App.tsx`. Em 07/08/2026 isso custou um commit inteiro — religuei a `ProfilePage` morta e deixei a
`SettingsPage` viva chamando `supabase.auth.updateUser`, ou seja, com "trocar senha" quebrado.

Grep pelo nome do componente **não serve** (casa com import e comentário).

⚠️ **E a conferência que este arquivo recomendava também não servia.** Ela era:

```bash
grep -oP '<Route[^>]*element=\{<\K[A-Za-z]+' frontend/src/App.tsx | sort -u   # ERRADO
```

Só casa `element={<X />}` numa linha. As rotas de verdade são multilinha, com o
componente aninhado dentro de `<ProtectedRoute>` e `<AppLayout>` — o comando
devolvia **11** de 21 páginas vivas. Usado para decidir se uma página está morta,
ele erra para o lado pior: faz página em uso parecer órfã, que é o inverso do
acidente da `ProfilePage` que ele foi escrito para evitar.

A que funciona olha o JSX renderizado, não a linha do `<Route>`:

```bash
# páginas vivas: renderizadas em App.tsx e existentes em pages/
grep -oP '<\K[A-Z][A-Za-z]*(?=\s*/>)' frontend/src/App.tsx | sort -u \
  | while read n; do [ -f "frontend/src/pages/$n.tsx" ] && echo "$n"; done
```

**Hoje: 28 arquivos em `pages/`, 21 vivos.** Das sete restantes, três são abas da
`SettingsPage` (`DocumentationPage`, `MissionControlDossierPage`, `UsersPage`) e
quatro não são renderizadas por ninguém: `ChannelsPage` (fundida na `ChatPage`,
ver o comentário no `App.tsx`), `DashboardPage`, `Index` e a `ProfilePage` do
acidente. Arquivo morto por decisão — mas confira antes de reviver qualquer uma.

### Arquivos gerados — não editar à mão

- `frontend/src/integrations/supabase/types.ts` (~2950 linhas) — tipos do banco, regerados pelo Supabase CLI
- `frontend/src/integrations/supabase/client.ts` — tem o header "automatically generated"

`client.ts` tem uma particularidade real: um `fetch` customizado que remove o header `Authorization`
quando a chave é do formato novo e opaco (`sb_publishable_` / `sb_secret_`), mandando só `apikey`.
Não "simplifique" isso.

### PWA

`vite-plugin-pwa` com `registerType: "prompt"` e `strategies: "injectManifest"` (service worker em
`frontend/src/sw.ts`). **Não troque para `autoUpdate`** — o comentário no `frontend/vite.config.ts` documenta o motivo:
no modo autoUpdate a lib recarrega a página sozinha, e como há checagem de update a cada
`visibilitychange`, voltar para a aba depois de um deploy recarregava o app no meio de um clique.

O manifest vem de `frontend/public/manifest.json`, mas o `<link rel="manifest">` é reescrito em runtime pela
Edge Function `manifest` para refletir o branding — ver `applyManifest()` em `frontend/src/hooks/use-branding.ts`.

Versão de build: `frontend/vite.config.ts` injeta `__APP_VERSION__` e `__APP_BUILD_DATE__` a partir do SHA do git
no momento do build. `use-version-check` compara e avisa o usuário quando há versão nova.

### EscritorioHS — escritório virtual (WorkAdventure), 15/10/2026

`escritoriohs/` **não é código do HS.OS**: é a config do WorkAdventure em
`escritoriohs.healthsafetytech.com` (EasyPanel, projeto `escritoriohs`, serviço
Compose `wa`) e da mídia — LiveKit + Coturn em rede do host,
`escritoriohs-midia.service`. Operação, segredos e aceite em
`escritoriohs/README.md`; spec e plano em `docs/superpowers/` (2026-10-15).
Sub-projeto A no ar. **B (ligação com o HS.OS) com código na `main` e backend no ar;
falta ligar `ADMIN_API_URL` no `wa`** — estado e próximos passos em
[`docs/ESCRITORIOHS-CONTINUAR.md`](docs/ESCRITORIOHS-CONTINUAR.md). C (agentes no escritório) a seguir.
O mapa (`hs`) é **gerado** por `escritoriohs/mapa/gerar.py` a partir de
`planta.json`; móveis são objetos do editor e, depois de publicados, são do
Erick (`publicados.json` impede o gerador de recriar o que ele apagou).

⚠️ **O firewall que vale é o do hPanel da Hostinger, não o da máquina.** O
`ufw` está inativo; quem bloqueava todo UDP era o painel. E testar porta de
dentro da empresa engana: alguns IPs dela têm regra própria no painel.

⚠️ **`MAP_EDITOR_ALLOWED_USERS` é ignorada quando existe Admin API.** O
sub-projeto B, ao ligar a Admin API, tem que levar a permissão do editor junto
— senão o editor abre para todos, sem erro.

⚠️ **O Coturn mora na VPS dos bancos.** `denied-peer-ip` (inclusive o IP
público do próprio host), `listening-ip`/`relay-ip` e `no-tcp-relay` são o que
impede o relay de virar túnel para dentro; `testes/testar-config.sh` exige cada um.

## A regra dos sete arquivos

⚠️ **O OpenClaw carrega exatamente sete nomes no contexto do agente**: `AGENTS.md`, `SOUL.md`,
`TOOLS.md`, `IDENTITY.md`, `USER.md`, `HEARTBEAT.md` e `MEMORY.md`. Arquivo com qualquer outro
nome no workspace **não entra no contexto** — só é lido se alguém mandar o agente abrir.

Não há como configurar isso: em 27 KB de `config.get` do gateway não aparece um único nome de
arquivo. E `agents.files.set` **recusa** nome fora dos sete (`unsupported file`).

⚠️ **Editar um dos sete vale no turno SEGUINTE, em toda sessão — inclusive nas
que já estavam abertas.** O prompt de sistema é remontado a cada turno, não
congelado quando a sessão nasce. Medido em 09/09/2026 logo depois de escrever no
`AGENTS.md` do `flow`: a `agent:flow:main`, com 69 mil tokens e viva desde antes
da edição, respondeu já com o texto novo.

Eu tinha previsto o contrário e chegue a registrar que seria preciso arquivar a
sessão do cron para o briefing da manhã pegar a mudança. **Não é** — e a
consequência boa é que a correção de um arquivo não exige reciclar sessão nem
esperar o dia virar. A desagradável é a mesma moeda: **um erro escrito num dos
sete atinge todas as sessões na hora**, sem janela para perceber antes.

⚠️ **Cada um dos sete tem um teto de 20.000 caracteres, e passar dele não dá
erro — o gateway trunca em silêncio.** O aviso existe, mas só no log do serviço:

```
[agent/embedded] workspace bootstrap file AGENTS.md is 21813 chars (limit 20000);
truncating in injected context (sessionKey=agent:nina:hsos-…)
```

Descoberto em 09/09/2026 do jeito ruim: acrescentei 2.314 caracteres ao
`AGENTS.md` da `nina`, que tinha 19.500, e **o arquivo passou a ser cortado**.
Como o corte é no fim, o que se perde é justamente o que foi escrito por último.
O `agents.files.set` aceita, o `agents.files.get` devolve inteiro, e a tela não
diz nada.

⚠️ **Desde 25/11/2026 (PK-12) a `nina` tem teto próprio: 30.000 por arquivo e
80.000 no total** (`agents.list[].bootstrapMaxChars`/`bootstrapTotalMaxChars`); os
outros seguem em 20.000/60.000. O backend lê o teto vivo por agente
(`teto_do_agente` em `app/gateway/client.py`) — nunca a constante direto. Antes do
PK-12 o `AGENTS.md` dela estava a 87 caracteres do teto e qualquer parágrafo
novo estourava. Antes de escrever num dos sete, **meça** — e se não couber, o
caminho é enxugar o arquivo ou mandar o conteúdo para uma skill, não empurrar.

⚠️ **E 21% daquele arquivo é gerado, então ele pode estourar sem ninguém
editá-lo.** O bloco `hsos:empresa` tem ~4.000 caracteres e é reescrito inteiro a
cada `POST /onboarding-empresa`; o `hsos:roster` cresce quando entra agente
novo. Um parágrafo a mais no perfil da empresa, digitado na tela por quem não
sabe do teto, bastaria. Desde 09/09/2026 os **três** lugares que escrevem nesses
arquivos conferem antes: a distribuição do contexto e o roster **não gravam** e
registram o motivo, e o `PUT /agents/{id}/arquivos/{nome}` recusa com 400 e
explica. `TETO_ARQUIVO_AGENTE` e `excede_o_teto` vivem em
`backend/app/gateway/client.py`, que é onde mora o que se sabe do protocolo.

⚠️ **A conferência de uma edição nos sete é perguntar ao agente, não reler o
arquivo.** O `agents.files.get` devolve o que você acabou de gravar e não
distingue "gravou" de "está em uso" — mesma armadilha do `deny` que casa pelo
nome errado e do `skills.status` que lista skill que ninguém abre. Pergunte algo
que só o texto novo responde, **sem citar o texto na pergunta**.

⚠️ **"Não invente dado" não cobria fato sobre a empresa.** Até 13/10/2026 a regra dos
agentes era sobre NÚMERO ("fato é o que eu medi"). O `bruce`, lendo uma planilha de
ponto, afirmou que "ponto é do Flow (Operações)" — dedução dele, escrita em lugar
nenhum; o ponto vive no **Flash**, sistema externo, e é do próprio `bruce` com a RH.
Os cinco `SOUL.md` ganharam a seção "Não afirmo o que não sei — nem número, nem
fato", e o `AGENTS.md` do `bruce` a seção "Ponto eletrônico é meu". Conferido
perguntando: o `flow` passou a responder "não sei" e o `bruce`, "Flash, é meu".
**Fato organizacional que um agente precisa saber tem que estar escrito** — senão
ele deduz, e a dedução sai com a mesma confiança de um dado.

**A consequência prática:** se o agente precisa saber sempre, tem que caber dentro de um dos sete.
Não existe meio-termo. Duas tentativas de contornar isso já falharam aqui:

- Um `COMPANY.md` com o perfil da empresa, escrito no workspace de três agentes. Ninguém nunca o
  leu, porque ninguém mandou.
- A distribuição do contexto da empresa, que mandava a orquestradora escrever esse mesmo
  `COMPANY.md`, com a instrução afirmando que ele "será injetado automaticamente no contexto" —
  o que nunca foi verdade. Corrigido em 13/08/2026: o backend escreve no `AGENTS.md`, entre
  marcadores, sem passar por LLM.

Para instrução que o agente usa **de vez em quando**, o mecanismo certo é uma **skill** — o
OpenClaw as carrega sob demanda (as 53 do gateway são todas `always: false`). Publicar é
`skills/<slug>/SKILL.md` no repositório + `bash scripts/publicar-skills.sh --enviar`.

⚠️ **Skill publicada não é skill usada, e essa distinção custa o número errado.** Em 14/08/2026 a
skill `faturamento` foi publicada, o gateway a listou, a `iris` confirmou que a enxerga **e leu o
título dela quando perguntei** — e, na pergunta real sobre faturamento, respondeu do jeito antigo
sem abri-la: R$ 654.645,95 em vez de R$ 441.712,80, 48% a mais.

Carregar sob demanda depende de o agente **lembrar** que a skill existe, e isso varia com o modelo
(a troca para DeepSeek aconteceu no mesmo dia). O que resolve é um **ponteiro curto num dos sete**:
"pergunta sobre X começa abrindo a skill Y". O procedimento longo continua na skill, que só custa
contexto quando é aberta; nos sete entra só o gatilho. Com o ponteiro no `AGENTS.md`, a mesma
pergunta passou a devolver o número certo.

**A conferência de uma skill é a resposta do agente, não a listagem do gateway.** `skills.status`
mostrando o nome só diz que o arquivo chegou.

## Config compartilhada entre dois sistemas: quem lê define o significado

⚠️ **`MESES_ANALISE` em `tiny.configuracoes` valia `6,7,8` e significava coisas
diferentes nos dois lados.** O painel do DataCoreHS jogava o valor direto no
`new Date(ano, mes, 1)` do JavaScript, que conta mês **a partir de zero**, e
apurava jul/ago/set. A skill `faturamento` usava `extract(month)` do Postgres, que
é **1-based**, e apurava jun/jul/ago. Mesma chave, mesmo valor, **um mês de
diferença** — e ninguém percebeu porque cada lado, sozinho, parecia coerente.

O custo: o briefing da manhã saiu dois dias seguidos com **R$ 787 mil a mais** no
realizado do trimestre e dizendo que faltava **metade** do que faltava de verdade,
na véspera do fechamento. Corrigido em 21/08/2026 — o valor virou `7,8,9` e o
`DashboardContext.tsx` passou a fazer `mes - 1`, com filtro `1..12` para
`10,11,12` não virar janeiro de 2027 em silêncio.

✅ **Em 01/10/2026 a chave foi aposentada.** No lugar dela entrou
`TRIMESTRE_APURACAO`: `auto` (o trimestre do calendário em que hoje está) ou
`AAAA-TN` (fixado, e pode ser de outro ano). Com ano e número de trimestre no
valor não sobra mês para uma ponta contar a partir de zero e a outra de um — o
defeito some por construção, não por disciplina. A skill `faturamento` lê a
chave nova e trata a ausência como `auto`, igual ao painel. Spec do lado de lá:
`~/github/DataCore/docs/superpowers/specs/2026-10-01-configuracoes-design.md`.

**A lição de método, que é maior que o bug:** a skill mandava conferir a régua
contra janeiro de 2026, e a conferência **passava** — porque valida a soma de
vendas e serviços num mês fechado, e passa igual com o trimestre recortado errado.
Um número errado sobreviveu a **três** conferências com ✅ por isso. Âncora de
verificação só serve se exercitar exatamente o que pode estar errado; conferir
outra coisa e dar certo é pior que não conferir, porque dá confiança.

⚠️ **Régua de negócio da HS mora em `~/projetos`, e o sistema de origem é a
autoridade.** Ao divergir, o número do painel manda — foi ele que apontou o erro
aqui. Não invente régua: `~/projetos/relatorios-hsgrowth/`,
`~/projetos/extracao-consultoria/DESIGN.md` e o repo do sistema em questão.

## Rebrand — o que é dado e o que é hardcoded

Boa parte da marca **já é dinâmica**, vinda da tabela `branding` via `frontend/src/hooks/use-branding.ts`:
nome da empresa, cor primária (HSL, aplicada em CSS custom properties), logos claro/escuro, mark,
favicon, ícone do PWA. Trocar isso é dado, não código.

O que é código e precisa de mudança manual:

- `DEFAULT_BRANDING` em `frontend/src/hooks/use-branding.ts` — fallback ainda é `companyName: "dn.ia"`
  apontando para `/dnia-wordmark*.png`
- **~374 ocorrências** de `dn.ia` / `dnos` / `dn.os` / `dnia` em ~30 arquivos de `frontend/src/`
- Assets: `frontend/public/dnia-*.png`, `frontend/src/assets/dnos-*.png`
- `frontend/package.json` ainda com `"name": "vite_react_shadcn_ts"`
- `README.md` com o título do remix
- Prefixo `dnos_` das feature flags e a chave `dnos-branding-cache`

**IDs de projeto Supabase de terceiros:** o do `manifest`
(`zozyfhisrbkqvdcsdbfp`, que apontava para outro projeto) **já saiu** — o manifest
é servido pela própria instalação. Resta `kfhojzdcnpuntynodsff` em
`backend/supabase/functions/marketing-analytics-proxy/index.ts:4`
(`DNMARKETING_URL`, API de analytics da dn.ia), numa function ainda não portada.

Nomes de agentes da instância original (`lia`, `rock`, `milo`, `kira`, `radar`, `sigma`, `rodrigo`)
ainda aparecem nos YAMLs de documentação. **Saíram do `use-agent-avatar.ts` em 10/08** — eram oito
ids fixos que o carregador sondava e que não existem aqui. A resolução do agente **líder/orquestrador** já foi corrigida para ser
dinâmica em vez de assumir "lia" — não reintroduza o hardcode.

⚠️ **Mas não é pela `agent_templates`, como este arquivo dizia até 31/08/2026.**
Quem responde é `agent_profiles.is_leader`, com índice único parcial garantindo
um líder por instalação (ver `agent_profiles_single_leader_idx` no `ROADMAP.md`).
A `agent_templates` tem **zero linhas e zero referências** — nem no backend nem
no front. É tabela herdada do remix, como a `agent_turns`; ler a documentação
antiga levaria alguém a procurar a resolução no lugar errado.

## Documentação que vale ler antes de mexer

| Arquivo | Conteúdo |
|---|---|
| `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` | 507 linhas, 49 achados de segurança/estabilidade catalogados A1–A19, B1–B10, com sintoma → causa raiz. Referência obrigatória para o caminho do chat. |
| `docs/RESUMO-CONSOLIDACAO-2026-07-18.md` | O que foi corrigido em cada bloco (0 remix-ready, 1 segurança, 2 estabilidade, 3 velocidade — pausado) |
| `docs/RESUMO-TECNICO-PARA-LIA-2026-07-18.md` | Contratos técnicos acordados com o lado do gateway (formato de `sessions_list`, dedup de heartbeat, verificação de `SOUL.md` no onboarding) |
| `docs/riscos-e-plano-de-emergencia.md` | Mapa "se X cair", riscos em ordem e roteiro por queda (agentes mudos, deploy/migração ruim, VPS perdida, SSO, saldo). Ler antes de mexer em backup, túnel ou VPS. |
| `docs/REMIX_SECRETS.md` | Lista real das env das Edge Functions, levantada do código. Diz explicitamente que a chave do LLM dos agentes fica no VPS/OpenClaw, não aqui. |
| `docs/PLANO-RECONCILIADOR.md` | A última edge function: o que ela faz, os dois bloqueios (um já resolvido) e por que "portar fiel" não é obviamente certo neste caso |
| `.lovable/plan.md`, `.lovable/remix-audit.md` | Contexto da origem Lovable |

## Convenções

- **Changelog é OBRIGATÓRIO (desde 10/11/2026):** toda mudança que alguém
  perceba no sistema termina com uma entrada em `frontend/src/data/changelog.ts`,
  **no topo** do array (mais recente primeiro), com `version`, `date` ISO e os
  `changes` (`novidade` | `melhoria` | `correcao`), escritos para quem USA o
  sistema, não para quem o programa. Semver: correção → patch, novidade ou
  melhoria → minor. A versão do rodapé da sidebar e das Configurações sai de
  `CHANGELOG[0]` — não há outra string de versão para mexer; o build
  (data + commit, `lib/app-version.ts`) fica no `title`. Clicar na versão abre o
  "O que há de novo?" (`components/novidades/`), que também **abre sozinho uma
  vez por versão nova**, por navegador (`lib/novidades.ts`). ⚠️ Entrada no fim
  da lista não aparece para ninguém — teste em `src/test/novidades.test.ts`.
  Mesmo padrão do HSGrowth e do TaskHS. Várias mudanças do mesmo dia podem
  dividir uma versão.
- **Fim de branch: merge local na `main` e depois `git push`.** É o fluxo padrão — nem PR,
  nem branch parado. **O push não dispara deploy**: o deploy no EasyPanel é manual, então não
  há o que conferir antes de empurrar. Passos de produção (migração, R2, gateway) são separados.
- **Gerenciador de pacotes: `npm`** (decidido em 10/08/2026). Fixado em `packageManager` e
  `engines` no `frontend/package.json`; o lockfile canônico é `package-lock.json`. Os
  `bun.lock` e `bun.lockb` eram resto do Lovable e foram apagados — nada os usava: o
  `Dockerfile`, o `README` e os comandos daqui sempre chamaram `npm`. A imagem usa `npm ci`,
  que falha quando o lockfile diverge, em vez de resolver versão nova em silêncio.
- Alias `@/` → `frontend/src/` (configurado em `frontend/vite.config.ts` e `frontend/vitest.config.ts`; se adicionar outro config,
  replique)
- UI: shadcn/ui em `frontend/src/components/ui/` (~50 componentes, gerados via `frontend/components.json`) — componentes de
  feature ficam nas pastas irmãs por domínio (`agents/`, `chat/`, `wiki/`, `arena/`, `analytics/`,
  `monitoring/`, `dashboard/`, `onboarding/`, `settings/`, `users/`)
- Lógica de domínio sem React vai em `frontend/src/lib/`; lógica com React vai em `frontend/src/hooks/`. A nomenclatura dos
  hooks é inconsistente por herança (`use-agents.ts` kebab-case convive com `useFileSystem.ts` camelCase) —
  prefira **kebab-case**, que é a maioria
- Toasts: `sonner` (`toast` de `sonner`) é o padrão nos arquivos novos; ainda existe o `use-toast`
  do shadcn em uso legado

