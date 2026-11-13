# Guardi no TalentHS, fase 2 — escrita por cartão (13/11/2026)

Continua `2026-11-13-guardi-talenths-design.md` (leitura, no ar desde 13/11 no
`erick-bot`). Mesmo princípio: o Guardi age **como o dono**, e quem decide se
pode é o TalentHS, pelo papel dele lá.

## Intenção

Na primeira conversa com a leitura ligada, o Erick pediu ao Guardi para
"colocar lá a solicitação" de ausência da próxima terça — e ele só podia ler.
Para o colaborador a escrita é pouca (pedir ausência, ajustar ponto, responder
feedback); para o **RH** é onde o Guardi rende: aprovar a fila de ausências e
de ponto, publicar comunicado, montar PDI, lançar realizado de meta.

## Decisões do Erick (13/11/2026)

1. **Os quatro grupos entram**: colaborador (o próprio), RH aprovações, RH
   comunicação, RH desenvolvimento.
2. **Tudo por cartão**: o Guardi prepara, o dono confirma no HS.OS, e só então
   a chamada vai ao TalentHS — o padrão do TaskHS/GestorHS/HSGrowth
   (`acoes_pendentes`, `app/acoes.py`, `CartaoAcao`).
3. **Fora, de propósito:** cadastro, desligamento, senha e papel de
   colaborador; salário; enviar e calibrar avaliação (julgamento da pessoa);
   bater ponto (registro legal — `POST /timeclock/punch`); exclusões e
   configurações (tipos, modelos, trilhas, tabelas, catálogos); anexos.

## O que o reconhecimento mostrou (código do TalentHS, 13/11/2026)

- Todo handler roda numa transação (`get_db`); nenhuma destas escritas notifica
  ninguém (sem push, e-mail ou notificação interna) — o efeito é só o registro.
- A auditoria de lá **já** grava `via=<bot>` em escrita de agente
  (`middleware/audit.py:188`), mas os rótulos de várias rotas saem errados
  (`_resolve_action` sem âncora: inscrição em workshop vira "Workshop criado").
- Vários handlers recebem `body: dict`: chave obrigatória ausente vira 500, não
  422. **Por isso o corpo é montado e validado aqui**, com os tipos de lá.
- Armadilhas que o servidor daqui precisa contornar (todas conferidas):
  - `PUT /onboarding/checklist-tasks/{id}/complete` **é toggle**;
  - `PUT /communications/announcements/{id}` sem `status` **despublica**;
  - `PUT /pdi/plans/{id}` sem `status` **reabre** plano fechado;
  - `POST /pdi/plans` com `actions[].due_date` provavelmente dá 500 (string
    crua no asyncpg) — criar o plano sem ações e acrescentá-las depois;
  - `DELETE /absences/{id}` e `DELETE /workshops/{id}/register` devolvem 204
    mesmo sem efeito;
  - `PUT /goals/{id}/actuals/{m}` com `comment` omitido apaga o comentário;
  - `POST /goals/{id}/comments` é **multipart** (`body` em Form, `files`).
- ⚠️ **Falhas de lá que viram pré-requisito** (ver seção do TalentHS).

## O desenho: catálogo de ações e duas ferramentas

São ~25 ações. Em vez de uma ferramenta por ação (que exigiria republicar
`FERRAMENTAS_BOT` a cada uma), o mesmo formato da leitura:

- **`talenths_acoes`** — lista as ações, os campos de cada uma (obrigatórios
  marcados) e quem pode (todos / RH).
- **`talenths_preparar(acao, id?, campos)`** — valida, **lê o estado atual no
  TalentHS**, recusa o que lá seria recusado, e cria o cartão
  (`acoes_pendentes`, `sistema = "talenths"`, `acao = "talenths_<acao>"`).
  Devolve ao agente o resumo do cartão.

Catálogo puro em `app/talenths_escrita.py` (testado): para cada ação, método,
template de rota, campos aceitos com tipo, obrigatórios, a leitura de
conferência e a função que monta corpo e `_exibir`. **O agente nunca manda
caminho nem corpo cru.**

No clique, o executor (`app/acoes.py`, um genérico para o sistema) **relê o
estado** e só então chama — o cartão pode ter ficado horas parado (o RH aprovou
pela tela, o mês da meta fechou). Divergiu do que o cartão mostrou → recusa sem
gravar, dizendo o que mudou. Pedido com vários passos (plano de PDI + ações)
**para e não desfaz**, dizendo o que entrou — a regra do GestorHS.

### As ações

Legenda: **eu** = só do próprio dono; **RH** = `manager`/`master_admin` lá.
"Confere" = leitura feita no preparo **e** no clique.

**Colaborador**

| ação | rota | campos | confere / regra daqui |
|---|---|---|---|
| `pedir_ausencia` | `POST /absences/request` | `type_id`*, `start_date`*, `end_date`, `start_time`+`end_time` (parcial), `reason` | tipo existe (`/absences/types`); fim ≥ início; parcial exige os dois horários; avisa no cartão se o tipo **não** pede aprovação (já nasce aprovado) e se a data já passou |
| `cancelar_ausencia` | `DELETE /absences/{id}` | — | o pedido é do dono e está `pending` (`/absences/my`) — lá devolve 204 até sem efeito |
| `ajustar_ponto` | `POST /timeclock/{punch_id}/adjust` | `requested_punched_at`*, `reason`* | batida é do dono, `valid` e sem ajuste pendente (`/timeclock/my`); horário não no futuro; vai para aprovação do RH |
| `lancar_batida` | `POST /timeclock/manual-self` | `kind`* (`in`/`out`), `punched_at`*, `reason`* | `timeclock_enabled` (`/timeclock/my/today`); não no futuro; nasce pendente para o RH |
| `responder_feedback` | `POST /feedbacks/{id}/respond` | `rating`* (1–5), `comment` | o pedido está em `/feedbacks/my`; se já respondeu, o cartão diz "substitui a resposta de <data>" |
| `inscrever_workshop` / `sair_do_workshop` | `POST` / `DELETE /workshops/{id}/register` | — | `/workshops`: aberto, com vaga, ainda não inscrito / inscrito e não `attended` |
| `concluir_tarefa_onboarding` | `PUT /onboarding/checklist-tasks/{id}/complete` | `concluir`* (bool) | ⚠️ toggle: só chama se o estado atual for o oposto do pedido; tarefa `responsible_role='user'` para quem não é RH |

**RH — aprovações**

| ação | rota | campos | confere |
|---|---|---|---|
| `aprovar_ausencia` / `recusar_ausencia` | `PUT /absences/{id}/approve` / `reject` | `note` (corpo sempre `{}` no mínimo) | em `/absences/team` e `pending` — lá não confere |
| `aprovar_ajuste_ponto` / `recusar_ajuste_ponto` | `POST /timeclock/adjustments/{id}/approve` / `reject` | `note` (só recusa) | em `/timeclock/requests.adjustments` |
| `confirmar_batida` / `recusar_batida` | `POST /timeclock/punches/{id}/confirm` / `reject` | — (lá o motivo é ignorado; não pedir) | em `/timeclock/requests.pending_punches` |

Aprovação em lote: `ids` (até 20) num cartão só, executados em ordem, para e
não desfaz. É o caso de uso do RH ("aprova as férias pendentes do Laboratório").

**RH — comunicação**

| ação | rota | campos | regra daqui |
|---|---|---|---|
| `criar_comunicado` | `POST /communications/announcements` | `title`*, `content`*, `category` (Geral, RH, Benefícios, Evento, Urgente, Reconhecimento), `publicar` (bool, padrão **false** = rascunho) | publicar = visível a toda a empresa: o cartão diz isso em destaque |
| `editar_comunicado` | `PUT /communications/announcements/{id}` | `title`, `content`, `category`, `publicar` | ⚠️ substituição total: relê e manda o corpo INTEIRO, com o `status` atual se não pedido — senão despublica |
| `criar_evento` / `editar_evento` | `POST` / `PUT /calendar/events[/{id}]` | `title`*, `start_date`*, `end_date`, `event_type` (event, holiday, deadline, meeting, training), `description`, `all_day` | fim ≥ início também no editar (lá não confere) |
| `pedir_feedback` | `POST /feedbacks` | `title`*, `question`*, `alvo`* (`todos`/`departamento`/`pessoa`) + o id correspondente | o id do alvo é exigido aqui (lá não) e conferido em `/departments` ou `/profiles` |

**RH — desenvolvimento**

| ação | rota | campos | regra daqui |
|---|---|---|---|
| `criar_pdi` | `POST /pdi/plans` + `POST /pdi/plans/{id}/actions` | `user_id`*, `title`*, `description`, `eval_cycle_id`, `acoes[]` ({`title`*, `description`, `how`, `due_date`}, até 15) | plano **sem** `actions` no POST; ações uma a uma depois; para e não desfaz |
| `editar_pdi` | `PUT /pdi/plans/{id}` | `title`, `description`, `fechar` (bool) | relê e manda corpo inteiro com o `status` atual se não pedido |
| `acrescentar_acao_pdi` | `POST /pdi/plans/{id}/actions` | `title`*, `description`, `how`, `due_date` | plano em `/pdi/team` |
| `atualizar_acao_pdi` | `PUT /pdi/actions/{id}` | `title`, `description`, `how`, `due_date`, `status` (pending, in_progress, done) | **também do colaborador** para as ações do próprio PDI (`/pdi/my`) |
| `lancar_realizado_meta` | `PUT /goals/{id}/actuals/{mes}` | `mes`* (1–12), `actual_value`*, `comment` | mês não fechado (`/goals/{id}`); cartão mostra o valor anterior; `comment` omitido → manda o atual (lá apagaria) |
| `comentar_meta` | `POST /goals/{id}/comments` | `texto`* | multipart só com `body`; sem arquivo |
| `registrar_curso` | `POST /learning/employee/{user_id}` | `course_title`*, `area`*, `catalog_id`, `hours`, `completed_at` | pessoa ativa |
| `atribuir_onboarding` | `POST /onboarding/assign` | `user_id`*, `template_id`, `started_at` | `template_id` conferido em `/onboarding/templates` (lá, inexistente vira checklist vazio sem erro); pessoa ainda sem checklist |

Pessoa citada pelo nome: o agente resolve o `user_id` por `talenths_consultar
pessoas`; o cartão sempre mostra **nome** (do `_exibir`), nunca só o id.

## O cartão (front)

`cartaoDaAcao` ganha `cartaoDoTalentHS(acao, p, ex)` em `frontend/src/lib/acoes.ts`,
no padrão dos outros: verbo ("Aprovar ausência", "Novo comunicado"…), título
(pessoa ou título) e linhas com os valores **do payload** (datas em Brasília,
`dataBrasilia`), `_exibir` só dando nome a ids. Lote mostra a lista inteira.
Comunicado publicado e evento mostram "visível para toda a empresa". Testes em
`acoes.test.ts`.

## Para o repositório TalentHS (na sessão dele)

0. **Pré-requisitos (falhas que existem hoje pela tela):**
   - `PUT /absences/{id}/approve|reject`: só pedido **da empresa** do
     aprovador e só `pending` (409 se não);
   - `POST /feedbacks/{id}/respond`: o pedido é da empresa e dirigido à pessoa
     (`all`, o departamento dela ou ela);
   - `POST /pdi/plans`, `POST /pdi/plans/{id}/actions`, `POST
     /learning/employee/{uid}`, `POST /onboarding/assign`: alvo/plano **da
     empresa** do gestor;
   - `POST /onboarding/assign` com `template_id` inexistente → 404;
   - `POST /pdi/plans` com `actions[].due_date`: converter a data (hoje 500).
1. **Allowlist de escrita para o token de agente** em `auth/agente.py`: um
   conjunto `ESCRITAS_DO_AGENTE` de pares (método, template) com exatamente as
   rotas da tabela acima; `rota_liberada_ao_agente` passa a ser
   `(GET e template em ROTAS_DO_AGENTE) ou (método, template) em
   ESCRITAS_DO_AGENTE`. Templates com o nome literal dos parâmetros
   (`{request_id}`, `{punch_id}`, `{req_id}`, `{feedback_id}`,
   `{workshop_id}`, `{task_id}`, `{announcement_id}`, `{event_id}`,
   `{plan_id}`, `{action_id}`, `{goal_id}/actuals/{month}`,
   `{target_user_id}`). Fora: `POST /timeclock/punch` e tudo da seção
   "Fora, de propósito".
2. **Leituras novas no allowlist** (conferência do cartão):
   `GET /calendar/events`, `GET /onboarding/templates`.
3. Rótulos da auditoria: `_resolve_action` com âncora, para inscrição em
   workshop, ação de PDI, realizado e comentário de meta não saírem como
   "criado/removido" de outra coisa.
4. Testes: cada escrita do allowlist entra com token de agente e respeita o
   papel (`user` em aprovação → 403); `POST /timeclock/punch` → 403 para agente;
   rota de escrita fora da lista → 403; os pré-requisitos com teste próprio.
5. Changelog do TalentHS e deploy do backend.

## Do lado do HS.OS

- `app/talenths_escrita.py` — o catálogo de ações, puro e testado
  (`tests/test_guardi_talenths_escrita.py`): campos, tipos, obrigatórios,
  datas (AAAA-MM-DD; horários ISO em Brasília, como lá), tetos (lote 20, ações
  de PDI 15, textos 4.000), ids validados, montagem do corpo.
- `routers/mcp_bot.py` — `talenths_acoes` e `talenths_preparar` (exige
  `talenths` em `sistemas_ligados`); a conferência lê pelo
  `talenths.chamar` (GET). `FERRAMENTAS_BOT` ganha as duas.
- `app/sistemas/talenths.py` — `chamar` passa a aceitar método e corpo (e
  `files`/form para o comentário de meta), como o HSGrowth; 403 de escrita diz
  "o papel do seu dono no TalentHS não permite isso".
- `app/acoes.py` — um executor por ação (ou um genérico com a tabela), relendo
  o estado antes de chamar; entradas em `EXECUTORES` com `("talenths",
  "talenths_<acao>")` — nomes que não colidem com os do TaskHS/GestorHS.
- `talenths_consultas.py` — `eventos` (`/calendar/events`) e
  `modelos_de_onboarding` (`/onboarding/templates`).
- `frontend/src/lib/acoes.ts` — `cartaoDoTalentHS` + testes.
- `app/bots_pessoais.py` — o ponteiro do RH no `AGENTS.md` ganha uma linha:
  "pedir, aprovar, publicar ou lançar no TalentHS: `talenths_acoes` →
  `talenths_preparar`; vira cartão". Medir o teto.
- Changelog do HS.OS.

## Não-objetivos

- Tudo da seção "Fora, de propósito" (decisão 3).
- Notificar o colaborador quando o RH aprova: o TalentHS não notifica nem pela
  tela; se for desejado, é pedido para lá.
- Anexo em comentário de meta.

## Anti-objetivos

- **Aprovar o que não estava pendente** ou o que o cartão não mostrou: a
  releitura no clique fecha os dois.
- **Comunicado publicado por engano para a empresa inteira**: padrão é
  rascunho; publicar é campo explícito e o cartão o destaca.
- **Despublicar ou reabrir sem pedir** (`PUT` de comunicado e de PDI sem
  `status`): o corpo é sempre o inteiro, relido.
- **O HS.OS decidir quem pode**: os papéis são os de lá; a conferência daqui é
  de estado (pendente, dono da batida, mês aberto), não de permissão.

## Restrições

- Território: a mudança do TalentHS é feita na sessão daquele repo.
- Ordem: TalentHS (pré-requisitos + allowlist) no ar → deploy do HS.OS →
  `publicar-bots-mcp.py --aplicar` → `criar-bots-pessoais.py
  --reescrever-agents-md --aplicar --todos` → piloto no `erick-bot` (colaborador)
  e no Guardi da Lidisay (RH), com ela → todos.

## Conferência (piloto)

1. `erick-bot`: "pede folga na terça à tarde pra visita da obra" → cartão de
   ausência parcial; confirmar; aparece em "minhas ausências" como pendente;
   "cancela esse pedido" → cartão; confirmar.
2. Lidisay: "quais ausências estão pendentes?" → "aprova a do Erick" → cartão
   com nome e datas; confirmar; aprovar de novo → recusa ("já não está
   pendente").
3. Lidisay: "cria um comunicado sobre o feriado" → cartão de **rascunho**.
4. `erick-bot` (`user`): "aprova as férias do Paulo" → recusa do TalentHS
   (papel), dita como tal.

## Decisões minhas (Claude), revisáveis

- Catálogo de ações + duas ferramentas, em vez de uma ferramenta por ação.
- Comunicado nasce rascunho por padrão.
- Lote só nas aprovações, até 20.
- `concluir_tarefa_onboarding` explícito (`concluir` true/false) contra o toggle.
- Releitura de estado no clique em toda ação, não só nas de RH.

## Para o construtor decidir

- Executor genérico com tabela ou um por ação.
- Texto exato de cada verbo do cartão.
- Se `pedir_ausencia` com data passada recusa ou só avisa (recomendo avisar:
  lançar ausência retroativa é caso real do RH).
