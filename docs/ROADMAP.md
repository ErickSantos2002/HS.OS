# Roadmap — saída do Supabase

Documento de trabalho. A meta é uma só: **`backend/supabase/functions/` esvaziar.**
Cada função portada para um endpoint FastAPI sai de lá; quando a pasta acabar, o
HS.OS não depende mais de Supabase, Lovable nem do remix.

Atualizar este arquivo conforme os lotes forem fechando.

## Placar

Duas medidas diferentes, e a distância entre elas importa: ter o endpoint no
backend não é o mesmo que a tela usar o endpoint.

| | Feito | Total |
|---|---|---|
| Edge functions **com substituto no backend** | 15 | 73 |
| Edge functions **que o front já parou de chamar** | 11 | 73 |
| Arquivos do front sem Supabase | 13 | 113 |
| Functions distintas ainda referenciadas pelo front | 34 | — |

Um lote só fecha quando as duas linhas andam.

Medir com:

```bash
ls backend/supabase/functions | grep -v _shared | wc -l
grep -rl 'integrations/supabase/client' frontend/src --include=*.ts --include=*.tsx | grep -v _legado | wc -l
```

⚠️ **Duas armadilhas na medição**, descobertas em 06/08/2026:

1. `ls backend/supabase/functions | wc -l` dá **70**, não 58. As 12 functions dos
   lotes 0 e 1 ganharam substituto mas **não foram removidas da pasta**, ao
   contrário do que o `CLAUDE.md` manda. Enquanto isso não for acertado, o `ls`
   subestima o progresso. As 3 do lote 2b saíram.
2. O grep de `functions.invoke(` **não vê chamadas indiretas**. O
   `AgentEditDrawer` passava o nome por variável (`callEdge(fn, …)`), então três
   functions apareciam como "não invocadas" enquanto eram chamadas oito vezes.
   O número real de functions ainda referenciadas era **34**, não 26. Medir
   cruzando com os nomes de pasta:

   ```bash
   for d in $(ls backend/supabase/functions | grep -v _shared); do
     grep -rq "\"$d\"" frontend/src --include=*.ts --include=*.tsx --exclude-dir=_legado && echo "$d"
   done | wc -l
   ```

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

**Melhorias adiadas** (portadas como estavam, corrigir depois da reconstrução):
- `POST /agents/leadership/sync` — o botão da UI devolve ao banco os mesmos valores
  que leu; nunca muda nada. Quem faz o trabalho de verdade é o orquestrador na VPS.
- `PATCH /agents/{id}` grava no gateway antes do banco e aborta com 502 se ele
  recusar. **Isto é uma mudança de comportamento feita durante a portagem** — a edge
  gravava no banco primeiro e seguia com um `openclaw_warning` que a UI ignorava.
  Decidir se fica ou se volta ao original.

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

## Lote 2 — Agentes

**18 functions · ~4.973 linhas** — o maior lote. Inclui `agent-task` (706) e
`turn-reconciler` (864), que são a Loop Architecture de tarefas longas.

Tabelas: `agent_profiles` (25 usos no front), `agent_avatars`, `agent_skills`,
`agent_tasks`, `agent_results`, `agent_stats`, `agent_templates`, `team_agents`.

Atenção: `fetchAgents` combina **duas fontes** — `agent_profiles` do banco e
`/v1/models` do gateway. O endpoint novo precisa fazer essa junção no servidor.

Sugestão de subdivisão, porque 18 de uma vez é grande demais:
- **2a** — ✅ leitura: `GET /agents` junta `agent_profiles` com `agents.list` do
  gateway no servidor, aplica o controle de acesso por `access_type`, e devolve
  no formato que `use-agents.ts` consome. Agente no banco e ausente do gateway
  aparece inativo em vez de sumir. Verificado: a tela de agentes mostra os 5
  agentes reais, sem erro de dado. Falta: avatar e perfil individual.
- **2b** — ✅ escrita: `POST /agents/sync` (portado de `sync-agents`) cria os
  perfis a partir do gateway **preservando o que foi editado à mão** — o gateway
  é fonte de existência, não de curadoria. `PATCH /agents/{id}` edita nome,
  emoji, departamento, especialidade, cor, modelo, avatar, acesso, liderança,
  persona, skills, crons e status. `POST /agents/test-model` verifica um modelo e
  `POST /agents/leadership/sync` regrava a liderança em lote.
  Atenção: `agent_profiles_single_leader_idx` é índice único parcial e só admite
  **um líder** por instalação; a troca limpa o anterior na mesma transação.
  Saíram: `update-agent-profile`, `test-llm-model`, `sync-agent-leadership`.
  Falta: criar e excluir agente (mexem no gateway, não só no banco), e as três
  edges que o drawer ainda chama — `update-agent-access`,
  `update-agent-leadership`, `delete-agent`.
- **2c** — Loop Architecture: `agent-task`, `turn-reconciler`, `collect-agent-stats`

**Entregável (2a):** a tela de agentes deixa de ser vazia.

## Lote 3 — Chat

**8 functions · ~2.305 linhas** — `gateway-chat`, `dm-agent-reply`,
`agent-reply-webhook`, `channel-agent-reply`, `channel-broadcast`,
`chat-image-vision`, `transcribe-audio`, `extract-file-text`.

Tabelas: `channels`, `channel_members` (17), `channel_messages` (16),
`conversations` (14), `dm_reads`, `message_reactions`, `drafts`.

⚠️ **É o caminho crítico.** Ler `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` antes de
tocar: A1–A19 e B1–B10 documentam execução duplicada, falso-positivo de context
overflow, heartbeat descartando resposta final. As quatro correções estão atrás de
flags `dnos_flag_*` **desligadas por padrão** — decidir se viram comportamento
padrão na portagem.

`frontend/src/lib/chat-sender.ts` (~2.100 linhas) é o arquivo mais delicado do
projeto. Vale portar em etapas e verificar cada uma.

**Entregável:** conversar com um agente de verdade. É onde vira produto.

## Lote 4 — Usuários e e-mail

**6 functions · ~1.279 linhas** — `invite-user`, `delete-user`, `auth-email-hook`,
`process-email-queue`, `send-push`, `update-agent-access`.

Destrava o TI criar contas para a equipe. Exige escolher o serviço de envio de
e-mail. A tela `/reset-password` (definir senha em convite) já existe e é reaproveitável.

**Entregável:** a equipe consegue entrar.

## Lote 5 — Automações

**8 functions · ~1.188 linhas** — `automations-api`, `automation-scheduler`,
`automation-result`, `trigger-automation`, `sync-automation-status`,
`import-cron-jobs`, `cleanup-expired-files`, `usage-sweep`.

⚠️ **`pg_cron` não existe no Postgres da VPS** (só `pgcrypto`, `moddatetime`,
`plpgsql`). Os 5 jobs operacionais viram um serviço `worker` no docker-compose
rodando APScheduler — container separado do web, senão os 4 workers do uvicorn
disparam o mesmo job 4 vezes.

Lembrar do achado de segurança: `trigger-automation` estava aberto na internet.

## Lote 6 — O resto

**~26 functions** — wiki, artefatos (`live_artifacts`, 23 usos), arenas e voz
(ElevenLabs, 6 functions), integrações/conectores, skills, analytics, monitoring,
war room, documentos gerados, `configure-llm-provider` (717 linhas).

Ordenar por uso real depois que os lotes 1–4 estiverem de pé.

## Lote 7 — Infraestrutura final

- **Storage** — 6 buckets a recriar: `agent-files`, `audio-messages`, `wiki-uploads`
  (públicos), `company-docs`, `generated-documents` (privados). Decidir entre volume
  na VPS (`UPLOADS_DIR`) e S3.
- **Realtime** — 39 usos de `postgres_changes` no front. Substituir por WebSocket ou
  polling. Hoje removido em `use-people` sem prejuízo funcional.
- **Deploy** — subir na VPS via EasyPanel, com `docker-compose` (backend 8002,
  frontend 80, worker).
- **Limpeza** — apagar `frontend/src/integrations/supabase/`, os assets órfãos
  (`public/dnia-*.png`, `src/assets/dnos-*.png`), decidir o destino de `_legado/`,
  e escolher o gerenciador de pacotes do front (hoje convivem `bun.lock`,
  `bun.lockb` e `package-lock.json`).

---

## Decisões em aberto

| Decisão | Contexto |
|---|---|
| Manter as 191 policies de RLS? | Funcionam e são defesa em profundidade, mas duplicam a autorização do FastAPI. Se aposentar, vira a `003`. |
| As flags `dnos_flag_*` viram padrão? | São 4 correções de estabilidade desligadas por padrão. Ver `RESUMO-CONSOLIDACAO`. |
| Trocar a senha do admin | `admin123` num `super_admin` que vai guardar o token do gateway. Precisa de `POST /auth/change-password`. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |
| Gerenciador de pacotes do front | Três lockfiles convivendo. |

## O que não vai ser feito

- **Recuperação de senha por e-mail** — sistema interno, senhas definidas pelo TI.
- **O wizard de `/setup`** — aposentado. O que sobrou de útil está catalogado em
  `frontend/src/_legado/README.md`.
- **Multi-tenant / remix** — o HS.OS é instalação única da Health & Safety.
