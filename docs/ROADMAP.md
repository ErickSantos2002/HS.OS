# Roadmap — saída do Supabase

Documento de trabalho. A meta é uma só: **`backend/supabase/functions/` esvaziar.**
Cada função portada para um endpoint FastAPI sai de lá; quando a pasta acabar, o
HS.OS não depende mais de Supabase, Lovable nem do remix.

Atualizar este arquivo conforme os lotes forem fechando.

## Placar

Atualizado em **07/08/2026**; linhas do front reconferidas em **01/09/2026**. Todo número aqui é **medido**, não mantido à mão —
o contador já derivou uma vez, chegando a dizer "72 de 73" com 13 functions
ainda na pasta.

| | Feito | Total | Comando |
|---|---|---|---|
| Edge functions **por portar** | — | **0** |
| Portadas | 65 | 73 | ⚠️ **não meça por `ls _portado`** — dá 2: as portadas foram apagadas, não movidas. O número está em "Nenhuma function resta", abaixo. 8 arquivadas em `_pausado/` |
| Arquivos do front **com Supabase** | **1** | 278 | `grep -rl "integrations/supabase/client" frontend/src \| grep -v _legado \| wc -l` — e o que sobrou é o próprio client |
| Rotas na API própria | **181** | — | `curl -s localhost:8002/openapi.json \| jq '.paths \| length'` |
| Chamadas `.from("…")` restantes | **0** vivas (9 em `_legado/`) | — | `grep -rho '\.from(\s*"' frontend/src \| wc -l` |
| Arquivos ainda em `postgres_changes` | **0** | — | `grep -rl "postgres_changes" frontend/src \| grep -v _legado` |

**Um lote só fecha quando duas linhas andam:** ter o endpoint no backend não é o
mesmo que a tela usar o endpoint. Já aconteceu dez vezes de a edge sair da pasta,
o endpoint entrar, e a tela continuar chamando `supabase.functions.invoke` de
algo que não existe mais — telas quebradas em produção sem ninguém notar. A régua:

```bash
grep -r "functions.invoke" frontend/src --include=*.ts --include=*.tsx | grep -v _legado
```

⚠️ **Armadilhas na medição**, aprendidas na prática:

1. O grep de `functions.invoke(` **não vê chamadas indiretas**. O
   `AgentEditDrawer` passava o nome por variável (`callEdge(fn, …)`), e três
   functions apareciam como "não invocadas" enquanto eram chamadas oito vezes.
2. **`_legado/` conta e não deveria.** Sete arquivos lá dentro ainda importam o
   client, mas nada em `_legado/` está roteado. Sempre filtrar.
3. Arquivo em `pages/` **não é tela em uso** — só onze estão roteadas. Ver a
   seção de roteamento no `CLAUDE.md`.

### Onde estão as 185 chamadas ao banco

```
21 live_artifacts    9 integrations       6 agent_results
17 agent_profiles    9 channel_messages   5 wiki_documents
15 profiles          9 channel_members    5 conversations
                     8 notifications      5 automations
                     8 company_profile    5 arena_agents
```

Portar por **tabela**, não por tela: as três primeiras somam 53 das 185.

### Nenhuma function resta

O placar fechou em 11/08/2026: 65 portadas e 8 arquivadas por decisão. A última
foi a `turn-reconciler` — o porquê está em
[`DECISAO-RECONCILIADOR.md`](DECISAO-RECONCILIADOR.md).

## Princípios

**Fatias verticais, não camadas.** Cada lote leva um domínio de ponta a ponta —
migration, endpoint, hook do front, tela — e termina verificado no navegador. Não
construir o backend inteiro antes de ligar na tela: não existe especificação da API
fora do frontend, e a cobertura de teste é ~zero, então a única verificação real é
executar.

**Verificar rodando, não lendo.** Tudo que quebrou até agora só apareceu ao executar:
o `NOINHERIT` que não pega em associações já criadas no PG 16+, `app.current_role`
ser palavra reservada, `--no-acl` deixando o RLS inerte, superuser bypassando RLS,
a `DATABASE_URL` em formato SQLAlchemy. Nenhum apareceria escrevendo mais código.

**O código herdado é a especificação.** Não estamos inventando um sistema — estamos
reconstruindo, em FastAPI e Postgres, um que já funcionava. Quando algo não bater,
a primeira parada é ver **como o sistema fazia antes**: as 73 edge functions em
`backend/supabase/functions/`, os hooks do front, e o que ficou em
`frontend/src/_legado/`. Foi assim que o Lote 1 saiu — o `test-gateway-connection`
mostrou que o contrato antigo era REST, o que provou que o protocolo tinha mudado e
apontou o caminho.

**Portar fiel; melhorar depois.** ⚠️ Este princípio **limita o de cima** e foi acertado
em 06/08/2026, depois de um dia em que a portagem demorou por causa de erro
introduzido na própria portagem. O comportamento tem que voltar a ser **o que era**,
mesmo quando o código herdado parece errado. Enxergou melhoria? Anota aqui e segue
portando. Mudança de comportamento é decisão do Erick e vai em commit separado.

Motivo: cada melhoria enfiada no meio vira mais uma variável para depurar quando algo
quebra, e some a referência de "como era antes" — que é justamente o que faz a
depuração ser rápida.

As exceções já decididas e fechadas: o vazamento do `admin_token` para o navegador
(Lote 1) e os achados de segurança da auditoria. Fora dessas, reaproveitar o
comportamento, não só o contrato.

✅ **O bloqueio do Lovable AI Gateway saiu em 10/08/2026.** Esta seção descreveu
por três semanas um bloqueio que não existia mais — corrigido em 01/09.

`transcribe-audio`, `chat-image-vision` e `parse-company-context` chamavam
`ai.gateway.lovable.dev` com `LOVABLE_API_KEY`, dependência da plataforma de
origem. Foram portadas para **OpenAI** em `app/routers/ia.py`:
`POST /ia/transcrever`, `POST /ia/descrever-imagem` e `POST /ia/perfil-da-empresa`.

⚠️ **Por que OpenAI e não DeepSeek**, que é o provedor dos agentes: o DeepSeek é
modelo de texto. Serviria o perfil da empresa e nada mais — transcrever precisa
de áudio, descrever precisa de visão. Dois provedores para economizar numa
chamada rara não se paga.

**Conferido pela régua desta página** (endpoint existir não é tela usar), em
01/09: as três estão ligadas em tela viva — `EmpresaTab`, `ChannelChat`,
`ThreadPanel`, `ChannelsPage`, `ChatPage` e `lib/chat-image-vision.ts`. A chave
sai de `OPENAI_API_KEY` pelo `ler_segredo` (banco primeiro, ambiente depois), e
sem ela os três respondem **503 dizendo o que falta**, não 500.

A metade determinística do `extract-file-text` também já foi portada e funciona
sem LLM nenhuma: `POST /storage/extrair-texto/{bucket}/{caminho}` devolve o texto
de txt, md, pdf e docx.

**O que sobrou de externo é só a ElevenLabs**, e só para voz — decisão de
assinatura, não de engenharia. Ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md).

**Removidas sem portar** (07/08/2026) — não é dívida, é código morto:
- `seed-agents` — semeava agentes pelo wizard de `/setup`, que foi aposentado
  para `frontend/src/_legado/`. O caminho vivo é `POST /agents` + `POST /agents/sync`.
- `routine-phrases` — pedia a uma LLM para deixar nome de cron legível, por uma
  rota que hoje é 404. A parte útil virou `_nome_legivel()` em
  `app/routers/automacoes.py`, determinística e sem custo de token.
- `marketing-analytics-proxy` — proxy para a API de analytics **da dn.ia**
  (`kfhojzdcnpuntynodsff`), a empresa de origem. Não é nossa e não há para onde
  apontar.

**Melhorias adiadas** (portadas como estavam, corrigir depois da reconstrução):
- 🟠 **A descoberta de avatar faz 1.022 requisições numa sessão.**
  `discoverAvatarUrl` em `use-agent-avatar.ts` testa 4 extensões (`png`, `jpg`,
  `jpeg`, `webp`) para cada agente conhecido — 52 requisições por carga — e
  repete a cada montagem de componente, sem lembrar que já deu 404. É
  comportamento herdado: fazia o mesmo contra o Supabase. Só ficou **visível**
  agora que o log é nosso. Correção provável: memorizar por sessão quais agentes
  não têm arquivo, reaproveitando o `brokenAvatarUrls` que já existe no módulo.
- ⚙️ **O tempo real vive na memória de um processo.** Com mais de um worker do
  uvicorn, quem está conectado ao worker A não recebe o que foi publicado no B.
  Hoje o backend roda em processo único e está correto. Se escalar, o caminho é
  `LISTEN`/`NOTIFY` do Postgres — já está lá, não precisa de peça nova.
- `POST /agents/leadership/sync` — o botão da UI devolve ao banco os mesmos valores
  que leu; nunca muda nada. Quem faz o trabalho de verdade é o orquestrador na VPS.
- 🔴 **`GET /agents/{id}/export` vaza domínios internos.** A sanitização só troca o
  host do gateway e a URL do Supabase; qualquer outro domínio da empresa passa
  direto. No export real da `nina` saíram `growthhsapi.healthsafetytech.com`,
  `hsgrowth.healthsafetytech.com`, `authapi…`, `tinyapi…` e a conta
  `nina@healthsafetytech.com` — dentro de um arquivo cujo propósito é ser
  compartilhado com outra empresa. **Herdado da edge, não introduzido na portagem.**
  Correção provável: derivar o domínio da empresa dos e-mails em `profiles` (a mesma
  fonte determinística já usada para nomes de pessoas) e trocar por
  `{{COMPANY_DOMAIN}}`. Até lá, tratar o `.dnos` como documento interno.
- O `_sanitizar_uuids` usa janela de 60 caracteres que atravessa quebra de linha, então
  UUIDs vizinhos herdam o rótulo do anterior. Só erra o rótulo — o id é sanitizado de
  todo jeito. Igual ao original.

**Exceção já decidida:** `PATCH /agents/{id}` grava no gateway antes do banco e aborta
com 502 se ele recusar, em vez do `openclaw_warning` ignorado da edge. Foi mudança de
comportamento feita durante a portagem, mas o Erick decidiu manter (06/08/2026) — o
que já está feito e testado fica. Não é pendência.

**Construir ≠ liberar.** O sistema fica híbrido por semanas (parte Supabase, parte
nossa). Isso é estado de obra, não de entrega — a equipe só entra quando estiver
completo.

---

## ✅ Lote 0 — Fundação (concluído em 05/08/2026)

Banco próprio no Postgres da VPS (69 tabelas, 191 policies, migrations `000`–`002`),
auth própria com JWT e bcrypt, RLS funcionando de verdade com o role `hsos_app`
(NOINHERIT, não-superuser), `branding` e `profiles` portados, marca HS.OS aplicada,
wizard de `/setup` aposentado em `frontend/src/_legado/`.

Endpoints: `/health`, `/auth/{status,login,me,bootstrap-admin}`, `/branding`, `/profiles`.

---

## ✅ Lote 1 — Gateway (concluído em 05/08/2026)

**7 functions · ~1.360 linhas** — `get-gateway-status`, `test-gateway-connection`,
`gateway-models`, `gateway-files-proxy`, `list-openclaw-workspaces`,
`configure-instance-vault`, `save-install-block`.

Fundação de tudo que vem depois: agentes, chat e skills passam pelo gateway.

**Corrigir na portagem (não é opcional):** hoje o navegador recebe o `admin_token`
de `vps_config` e faz `fetch` direto no gateway em `use-agents.ts`,
`OrchestratorChat.tsx`, `use-skills.ts` e `arena-sandbox.ts` — o último embute o
token no código que gera. O endpoint de config deve devolver **apenas a URL e um
booleano `tem_token`**; toda chamada ao gateway passa a ser proxy do backend.

**Feito.** O OpenClaw trocou REST por **WebSocket JSON-RPC** entre versões — os caminhos
que o código herdado usava (`/api/health`, `/v1/models`) devolvem 404 e HTML hoje. O
contrato foi levantado testando ao vivo contra o 2026.7.1-2 e está em `app/gateway/client.py`.

⚠️ **A identidade do cliente é o que concede permissão.** Só
`client.id="gateway-client"` + `client.mode="backend"` recebe `operator.read`/`operator.write`.
Qualquer outra combinação conecta e é negada em todo método com "missing scope".

O vazamento do token foi fechado: `/gateway/config` devolve `{url, tem_token, configurado}`,
nunca o valor. Verificado varrendo as respostas dos 5 endpoints.

Endpoints: `/gateway/{config,status,models,agents,sessions}`.

**Frontend migrado.** `lib/gateway.ts` não conhece mais o token: expõe apenas
`{url, temToken, configurado}`. `useGatewayStatus` e `use-gateway-models` passaram
a chamar `/gateway/*`. Verificado no navegador — a aba Gateway mostra "Online",
versão 2026.7.1-2 vinda do OpenClaw, e "Testar conexão" responde com sucesso.

**O vazamento do token está fechado de ponta a ponta.** Os 8 arquivos que faziam
`fetch` direto no gateway (`OrchestratorChat`, `use-agents`, `use-integrations`,
`use-skills`, `arena-sandbox`, `ClawHubPage`, `SessionsPage`, `SettingsPage`)
não têm mais acesso ao segredo. Eles chamavam a REST antiga do OpenClaw, que não
existe mais — ou seja, já estavam quebrados. Agora falham alto via
`gatewayNaoPortado()`, com o nome da área, em vez de devolver lista vazia e
parecer que "não há nada". Cada um volta a funcionar no seu lote.

**Sobraram do grupo, para lotes seguintes:** `list-openclaw-workspaces`
(AddAgentDialog → Lote 2) e `gateway-files-proxy` (arquivos do chat → Lote 3).
`configure-instance-vault` e `save-install-block` morreram com o wizard — só
existem em `_legado`.

## ✅ Lote 2 — Agentes (concluído em 06–07/08/2026)

Era o maior: 18 functions, ~4.973 linhas. Ficou de pé o ciclo completo — criar,
editar todas as abas, sincronizar, verificar modelo, liderança, acesso, excluir,
exportar e ler os arquivos do workspace.

Aprendizados que valem além do lote:

- **`GET /agents` junta duas fontes** — `agent_profiles` do banco e `agents.list`
  do gateway — e a junção é no servidor. Agente no banco e ausente do gateway
  aparece inativo em vez de sumir.
- **`POST /agents/sync` preserva o que foi editado à mão.** O gateway é fonte de
  *existência*, não de curadoria.
- **`agent_profiles_single_leader_idx` é índice único parcial**: só um líder por
  instalação, e a troca limpa o anterior na mesma transação.
- **Gateway primeiro, banco depois** em escrita que toca as duas pontas — ver
  `CLAUDE.md`.

Sobra do lote: `turn-reconciler` (precisa do `worker`) e `collect-agent-stats`.

## ✅ Lote 3 — Chat (concluído em 06–07/08/2026)

O `/v1/chat/completions` do gateway virou 404 e derrubou o desenho inteiro. O
substituto é `chat.send` + `agent.wait` por long-poll, levantado ao vivo — o
contrato está documentado no `CLAUDE.md`.

`chat-sender.ts` encolheu de ~2.100 para ~1.000 linhas: 699 linhas de
`sendMessageInBackground` viraram 103, e mais ~300 de código morto saíram junto
quando o `gateway-chat` fechou.

A fila em nível de módulo foi mantida — envios sobrevivem à navegação entre
páginas, e era isso que o arquivo comprava com a complexidade.

⚠️ As quatro correções de estabilidade continuam atrás de flags `dnos_flag_*`
**desligadas por padrão**. Decidir se viram padrão.

## ✅ Lote 4 — Usuários (concluído em 06/08/2026)

Contas, papéis, ativar/desativar, excluir, push e acesso a agente.

**O convite por e-mail saiu do produto** por decisão do Erick: a conta do
colaborador é criada direto no sistema interno. Com isso, `invite-user`,
`auth-email-hook` e `process-email-queue` foram removidas em vez de portadas —
ninguém mais escreve na `email_queue`, e o hook do Supabase Auth não tem gatilho.

Fica aberto: o fluxo de "esqueci minha senha" sumiu junto com o Supabase Auth.
A `ResetPasswordPage` ainda existe e não funciona.

## ✅ Lote 5 — Automações (concluído em 06/08/2026)

CRUD, gatilho, disparo, importar crons, sincronizar status, resultado por webhook.

⚠️ **`pg_cron` não existe no Postgres da VPS.** Os jobs operacionais precisam de
um serviço `worker` no docker-compose rodando APScheduler — container separado do
web, senão os 4 workers do uvicorn disparam o mesmo job 4 vezes. **Ainda não
existe**, e é o que bloqueia o `turn-reconciler`.

Lembrar do achado de segurança: `trigger-automation` estava aberto na internet.

## ✅ Lote 6 — O que restava das edge functions

Nada. A raiz de `backend/supabase/functions/` tem **0 functions por portar**
(medido em 01/09/2026); as 8 em `_pausado/` são as arquivadas por decisão —
6 presas ao ElevenLabs, a `turn-reconciler` e a `warroom-feed`.

A linha anterior aqui dizia "quatro de trabalho real e nove bloqueadas", que era
o estado antes de 11/08. Ver "Nenhuma function resta", acima.

## ✅ Lote 7 — O banco (concluído)

Era o maior que sobrava: **185 chamadas `.from("…")` em 56 arquivos vivos**. Medido
em 01/09/2026 restam **0 vivas** e **0 arquivos vivos** — as 9 que o grep ainda
acha estão todas em `_legado/`, que não é roteado.

A estratégia que fechou foi a dos primeiros lotes: **portar por tabela, não por
tela.** Uma tabela some do front de uma vez, e o endpoint nasce coerente em vez de
recortado pela necessidade de uma tela só.

⚠️ **Esta seção descreveu por semanas um estado que não existia mais**, enquanto o
Placar, na mesma página, já dizia `0`. Duas linhas do mesmo documento se
contradizendo é pior que número velho sozinho: quem lê a prosa não desconfia. Ver
[`CONFERENCIA-2026-09-01.md`](CONFERENCIA-2026-09-01.md).

O que o grep ainda encontra, e por que nenhum conta:

- `dnos-documentation-yaml.ts:1341` — `supabase.functions.invoke('export-agent')`
  é **string dentro do YAML da Documentação**, o projeto de conteúdo em aberto
- `use-channels.ts`, `use-typing-indicator.ts`, `lib/realtime.ts` — comentários
  explicando o que o `pg_notify` substituiu

## ✅ Lote 8 — Realtime (concluído em 07/08/2026)

Os 21 arquivos que abriam `supabase.channel(...).on("postgres_changes", …)`
foram religados no mesmo dia. O desenho e o porquê estão em
`docs/PLANO-REALTIME.md`; o resumo do que ficou:

- **captura no banco**, por trigger + `pg_notify` em 17 tabelas — não nos
  endpoints, senão a tela ficaria cega para o que os agentes, o coletor da VPS
  e a ponte de arquivos escrevem
- **o evento nunca leva conteúdo**, só `{tabela, op, id}` mais as colunas que
  roteiam. Quem quer conteúdo busca pelo endpoint, onde o RLS decide
- **autorização na assinatura, não por evento** — e aí se descobriu que o `/ws`
  aceitava qualquer id de canal sem conferir se a pessoa era membro
- **uma conexão por aba**, com reconexão em `lib/realtime.ts`. Três hooks
  tinham controle de status e espera crescente próprios, duplicando isso e
  produzindo o laço CLOSED → retry que os comentários deles documentavam

⚠️ **`usage_events` ficou de fora dos gatilhos** e não tem tempo real. Recebe
escrita em lote pela varredura de uso, e um evento por linha faria tempestade.
`use-agents` e `AgentDetailPanel` a observavam; as duas passaram a atualizar o
consumo ao abrir.

## Lote 9 — Limpeza final

- Apagar `frontend/src/integrations/supabase/` — inclusive o `types.ts` de ~2.950
  linhas, que é o maior arquivo do projeto
- Assets órfãos: `public/dnia-*.png`, `src/assets/dnos-*.png`
- Decidir o destino de `_legado/`
- Escolher o gerenciador de pacotes (convivem `bun.lock`, `bun.lockb` e
  `package-lock.json`)
- Renomear o prefixo `dnos_` das feature flags — lembrando que isso **desliga
  silenciosamente** as flags de quem já estava com elas ativas

---

## Decisões em aberto

| Decisão | Contexto |
|---|---|
| ~~Manter as 191 policies de RLS?~~ **Sim.** Decidido em 31/08/2026 — ver abaixo. | Medido: nenhuma query depende delas para escopo. Aposentar é possível e não compensa. |
| As flags `dnos_flag_*` viram padrão? | São 4 correções de estabilidade desligadas por padrão. Ver `RESUMO-CONSOLIDACAO`. |
| ~~Trocar a senha do admin~~ **feito em 01/09/2026** | Era a senha padrão num `super_admin` que guarda o token do gateway, em texto aberto num repositório público. ⚠️ Fica pendente a senha do **superusuário do Postgres**, que é outra e continua a padrão. |
| ~~Lovable AI Gateway~~ **resolvido em 10/08/2026** — portado para OpenAI em `app/routers/ia.py`, ligado em tela. | |
| ElevenLabs — assinar ou tirar do produto | Só a **voz**: o botão "ouvir" no chat, a escolha de voz do agente e o modo voz da Arena. Previsto voltar quando a ElevenLabs entrar por marketing. Ver `EM-CONSTRUCAO.md`. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |
| Gerenciador de pacotes do front | Três lockfiles convivendo. |

## O que não vai ser feito

- **Recuperação de senha por e-mail** — sistema interno, senhas definidas pelo TI.
  Consequência: a `ResetPasswordPage` continua roteada em `/reset-password` e não
  funciona mais. Decidir se sai ou se vira "peça a senha ao TI".
- **O wizard de `/setup`** — aposentado. O que sobrou de útil está catalogado em
  `frontend/src/_legado/README.md`.
- **Multi-tenant / remix** — o HS.OS é instalação única da Health & Safety.


---

## As 191 policies de RLS ficam — decidido em 31/08/2026

A pergunta estava em aberto porque ninguém tinha medido o que elas protegem.
Medido agora, e a resposta muda o enquadramento: **não são load-bearing.**

Varredura do `app/` procurando, dentro de cada bloco que abre
`sessao(role="authenticated")`, as queries que tocam tabela de dado pessoal
(`conversations`, `notifications`, `channel_messages`, `wiki_documents`,
`live_artifacts`, `agent_runs` e outras) sem filtro de dono no SQL:

| | |
|---|---|
| queries sob `authenticated` em tabela pessoal | **64** |
| sem filtro de dono (`user_id`, `author_id`, `created_by`…) | **0** |

⚠️ **A varredura é aproximada e isso importa para a conclusão.** Ela lê o SQL
como texto e aceita o filtro montado antes da query — o caso do
`conversations.py:201`, onde o `user_id` entra numa lista `condicoes` a vinte
linhas de distância. Aceitar isso evita falso positivo e admite falso negativo:
uma query cujo `user_id` pertença a *outra* consulta próxima passaria batido.

**Por que ficam, então.** O resultado diz que dá para aposentá-las sem quebrar
escopo — e é justamente por isso que não compensa. O ganho é tirar duplicação
que não custa nada em runtime; o risco é a varredura ter errado **uma** vez, e o
sintoma de errar é vazamento de dado entre pessoas, que ninguém descobre por
teste. Trocar um risco silencioso por uma economia estética é mau negócio.

O que muda de verdade: elas deixam de ser dúvida. Ficam como segunda camada
declarada, e a autorização de verdade continua sendo a do FastAPI — que é onde
ela deve ser lida, mexida e testada.

⚠️ **Isto reabre se a primeira camada mudar de desenho.** Se algum dia uma query
passar a depender da policy para escopo, a decisão inverte: aí a RLS vira
load-bearing sem ninguém ter decidido que fosse, que é o pior dos dois mundos.
A varredura está em `docs/` como procedimento, não como resultado de uma vez só.
