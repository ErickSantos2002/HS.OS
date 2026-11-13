# Guardi no TalentHS — design (13/11/2026)

## Intenção

O TalentHS é o sistema de RH da HS: férias e ausências, ponto, metas, PDI,
avaliações, feedbacks, a Universidade (cursos e trilhas), onboarding,
benefícios, comunicados e, para o RH, salário e relatórios. Hoje, para saber
"quantos dias de férias pedi este ano?", "que curso ainda falta na minha
trilha?" ou "quem está de férias semana que vem?", a pessoa abre o TalentHS e
procura.

A ideia é o Guardi responder isso **lendo o TalentHS como o dono**, no molde
do DocsHS e do DataCore (`2026-11-11-guardi-docshs-design.md`):

- **colaborador:** "tenho pedido de férias pendente?", "quantas horas trabalhei
  ontem?", "como está a minha meta deste mês?", "o que falta no meu PDI?",
  "tenho feedback para responder?", "quem faz aniversário este mês?";
- **RH (`manager`):** "quem pediu férias e ainda não foi aprovado?", "quem não
  concluiu a trilha de integração?", "como está o status das avaliações do
  ciclo?", "qual o salário de referência do cargo X?".

Quem decide o que cada um vê é o **TalentHS**, com as regras que já tem. O
HS.OS não reimplementa permissão.

## Decisões do Erick (13/11/2026)

1. **O Guardi vê tudo o que o login do dono vê** — mesmo princípio do
   DataCore.
2. **Salário, avaliações e 9-box entram**, para quem o TalentHS deixa ver (hoje
   o RH e o master_admin). Risco LGPD do DeepSeek aceito, como no piloto dos
   outros sistemas.
3. **As duas rotas que vazam são corrigidas no TalentHS ANTES do Guardi** (ver
   "Pré-requisito"): o Guardi nasce com a regra certa, e o vazamento pelo
   navegador fecha junto.

## O que o reconhecimento mostrou (`~/github/talenths`, 13/11/2026)

- **Login:** JWT HS256 (`JWT_SECRET`, 24 h), claims só `{sub: auth.users.id,
  iat, exp}` (`backend/app/auth/service.py:18`). Senha ou Microsoft. Sem
  revogação: o corte é `ensure_active_user` (`profiles.deactivated_at`) em toda
  requisição (`dependencies.py:33`). **Não existe token de serviço nem de
  agente.**
- **E-mail é único** em `auth.users` (`001_initial_schema.sql:13`). Os 23 donos
  de Guardi têm conta, todos casando por e-mail (conferido no banco).
- **Permissão é o SQL de cada rota**, não RLS: `get_db` faz o
  `set_config('app.current_user_id')`, mas o pool não troca de role e as
  tabelas da 008 em diante nem têm RLS. Os checks são `require_manager`
  (`manager` ou `master_admin`) e cópias locais `_require_manager`.
- **Papéis:** `user` (24), `manager` (3 — entre os donos de Guardi, só a
  Lidisay), `master_admin` (1). ⚠️ **`manager` é o RH com visão da empresa
  inteira, não "gestor do time"**: toda rota `/team` filtra só por
  `company_id`, e `user_managers` não é usada. Não existe "o meu time".
- **API sem prefixo** (`/absences`, `/goals`…), em
  `https://talenthsapi.healthsafetytech.com`; o front é
  `https://talenths.healthsafetytech.com`. **O `/openapi.json` é público** (215
  caminhos): os filtros do catálogo saem dele, como no DataCore.
- ⚠️ **Exposições achadas** (todas conferidas no código):
  - `GET /profiles` e `GET /profiles/{user_id}` aceitam qualquer logado e fazem
    `SELECT *` — **salário (`current_salary`), CPF, telefone e data de
    nascimento de todo mundo** (`routers/profiles.py:61-82`);
  - `GET /evaluations/scores` não confere papel: qualquer um vê as notas e
    quem avaliou qualquer colega (`evaluations.py:378`);
  - `PATCH /profiles/me` deixa a pessoa trocar o próprio `company_id` e
    `department_id` (`profiles.py:10-58`);
  - ⚠️ **a senha da conta `bruce` (master_admin) está em texto puro no
    `bruce_agent.py:29`, e o repositório é PÚBLICO** — trocar a senha
    (tirar do código não basta: está no histórico).
  As duas primeiras são pré-requisito deste trabalho; as outras duas foram
  levadas ao Erick e vão para a sessão do TalentHS como itens próprios.

## Objetivos

1. **Token de agente no TalentHS** (`aud = "talenths"`), só GET, só nas rotas
   do allowlist, entrando como o usuário do e-mail do `sub`.
2. **`talenths_consultas` e `talenths_consultar`** no `hsos-bot-<bot>`, por
   **catálogo** (o agente escolhe uma chave, nunca um caminho), teto de retorno
   e paginação local, igual ao DataCore e ao DocsHS.
3. **Flag `talenths` em `sistemas_ligados`**, no `erick-bot` primeiro, depois
   todos por `publicar-bots-mcp.py --ligar-talenths-todos`.
4. **Ponteiro no `AGENTS.md`** do template: pergunta sobre férias, ausência,
   ponto, metas, PDI, avaliação, feedback, cursos, benefícios ou comunicados da
   empresa começa pelo `talenths_consultas`.

## Pré-requisito no TalentHS: fechar o que vaza

Sem isto, "o que o login vê" inclui o salário e o CPF de todo mundo.

- `GET /profiles` e `GET /profiles/{user_id}`: para quem não é `manager`/
  `master_admin` e não é o próprio, devolver só o que a tela de colega usa
  (nome, e-mail, departamento, cargo, empresa, `user_id`, data de admissão).
  `current_salary`, `cpf`, `phone` e `birth_date` só para o próprio e o RH. O
  construtor confere no front (`/profiles${companyId…}`, `/profiles/${userId}`)
  o que cada tela de fato usa antes de cortar.
- `GET /evaluations/scores`: só `manager`/`master_admin`, ou o próprio
  avaliado se a regra de produto permitir (conferir com a tela "Minha
  avaliação", que usa `/evaluations/my`).
- Testes de lá: `user` não recebe salário/CPF de outro; recebe os próprios; RH
  recebe de todos; `user` em `/evaluations/scores` de outro → 403.

## O catálogo (`backend/app/talenths_consultas.py`)

Filtros **lidos do `/openapi.json` público** e escritos no catálogo, com teste
(como o DataCore). Cada entrada: chave → (caminho, o que é, filtros).

| chave | caminho | quem o TalentHS deixa | filtros |
|---|---|---|---|
| `eu` | `/auth/me` | todos | — |
| `meu_perfil` | `/profiles/me` | todos | — |
| `pessoas` | `/profiles` | todos (já recortado — pré-requisito) | `company_id` |
| `pessoa` | `/profiles/{id}` | idem | — |
| `colaboradores` | `/collaborators` | RH | `status` |
| `departamentos` | `/departments` | todos | — |
| `empresa`, `regras_internas`, `cultura` | `/companies/presentation`, `/companies/internal-rules`, `/culture` | todos | — |
| `aniversarios`, `tempo_de_casa`, `comunicados` | `/communications/birthdays`, `/milestones`, `/announcements` | todos | — |
| `notificacoes` | `/notifications` | próprio | — |
| `tipos_de_ausencia` | `/absences/types` | todos | — |
| `minhas_ausencias` | `/absences/my` | próprio | — |
| `ausencias_do_time` | `/absences/team` | RH | — |
| `calendario_de_ausencias` | `/absences/calendar` | todos | — |
| `calendario` | `/calendar/feed` | todos | — |
| `meu_ponto_hoje` | `/timeclock/my/today` | próprio | — |
| `meu_ponto` | `/timeclock/my` | próprio | `start_date`, `end_date` |
| `ponto_do_time` | `/timeclock/team` | RH | `date`, `user_id`, `start_date`, `end_date`, `include_inactive` |
| `ajustes_de_ponto` | `/timeclock/requests` | RH | — |
| `ciclos_de_metas` | `/goals/cycles` | todos | — |
| `metas` | `/goals/overview` | todos | `cycle_id`*, `month` |
| `meta` | `/goals/{id}` | todos | — |
| `comentarios_da_meta` | `/goals/{id}/comments` | todos | — |
| `meu_pdi` | `/pdi/my` | próprio | — |
| `pdi_do_time` | `/pdi/team` | RH | `include_inactive` |
| `ciclos_de_avaliacao`, `comportamentos` | `/evaluations/cycles`, `/behaviors` | todos | — |
| `minha_avaliacao` | `/evaluations/my` | próprio | `cycle_id`* |
| `notas_da_avaliacao` | `/evaluations/scores` | RH (pré-requisito) | `cycle_id`*, `evaluated_user_id`* |
| `status_das_avaliacoes` | `/evaluations/team-status` | RH | `cycle_id`*, `include_inactive` |
| `nove_box` | `/evaluations/9box` | RH | `cycle_id`*, `include_inactive` |
| `meus_feedbacks` | `/feedbacks/my` | próprio | — |
| `feedbacks`, `respostas_do_feedback` | `/feedbacks`, `/feedbacks/{id}/responses` | RH | — |
| `cursos`, `meus_cursos`, `minhas_trilhas` | `/learning/catalog`, `/my`, `/my-tracks` | todos / próprio | — |
| `cursos_do_time`, `trilhas_do_time` | `/learning/team`, `/team-tracks` | RH | `include_inactive` |
| `workshops`, `meus_videos` | `/workshops`, `/videos/mine` | todos / próprio | — |
| `meu_onboarding` | `/onboarding/my` | próprio | — |
| `onboarding_do_time` | `/onboarding/team` | RH | `include_inactive` |
| `beneficios`, `meus_beneficios` | `/benefits/catalog`, `/my` | todos / próprio | — |
| `beneficios_do_time`, `beneficios_de_uma_pessoa`, `resumo_de_beneficios` | `/benefits/team`, `/employee/{id}`, `/summary` | RH | — |
| `trilhas_de_carreira`, `minha_carreira`, `carreira_do_time` | `/career/tracks`, `/my`, `/team` | todos / próprio / RH | `include_inactive` (time) |
| `referencias_salariais`, `tabela_salarial`, `posicionamento_salarial` | `/salary/references`, `/table`, `/positioning` | RH | `reference_id`* (tabela, posicionamento) |
| `pesquisas`, `resultado_da_pesquisa` | `/surveys`, `/surveys/{id}/results` | todos / RH | — |
| `meus_documentos` | `/documents/my` | próprio | — |
| `testes_disponiveis`, `minhas_tentativas` | `/tests/available`, `/tests/my-attempts` | próprio | — |
| `relatorio_*` | `/reports/collaborators`, `/absences`, `/benefits`, `/pdi`, `/learning` | RH | os da rota |

(`*` = obrigatório.) Ids na URL (`{id}`) só como uuid/inteiro, validados aqui.

- O retorno passa por `como_dado_externo(..., origem="TalentHS")`, teto de 12
  mil caracteres; lista crua pagina do nosso lado.
- Horários passam pelo `app/fuso.py` (já é o funil do `mcp_bot.executar`).
  ⚠️ O construtor confere se o TalentHS devolve carimbo **sem fuso** em alguma
  rota (ponto, sobretudo): se sim, decidir se é UTC ou Brasília olhando o
  código de lá antes de ligar `sem_fuso_e_utc` para `talenths_`.
- A `description` do `talenths_consultar` diz: o que volta é a visão do dono
  (403 é a permissão dele lá — diga isso, não contorne); "do time" no TalentHS
  é a **empresa inteira** e só o RH vê; não recalcule saldo, horas ou
  progresso que a rota já traz.

## Para o repositório TalentHS (na sessão dele)

O Erick abre `cl talenths` e entrega esta seção.

0. **Pré-requisito** acima (perfis e notas), com testes — antes de tudo.
1. Env `HSOS_AGENTE_CHAVE_PUBLICA` (PEM Ed25519; o EasyPanel guarda com `\n`
   literal). Sem ela, todo token de agente dá 401 e o resto segue como hoje.
2. Em `get_current_user_id`, para Bearer com `iss == "hsos"` (decidido olhando
   o payload sem verificar, como em `DataCore/backend/app/core/agente.py`):
   EdDSA, `aud == "talenths"`, `exp` exigido e a no máximo 600 s, `sub` e
   `act.sub` presentes; usuário por `lower(auth.users.email) == sub`, e o
   `ensure_active_user` de sempre. Devolve o **`user_id`** dele — o resto do
   sistema não muda. Cópia do `agente.py` do DataCore com
   `AUDIENCIA = "talenths"`. ⚠️ `get_current_user_id` hoje não tem conexão:
   resolver o e-mail exige uma (o construtor escolhe entre dar a ele o pool ou
   resolver no `get_db`).
3. **Só GET e só allowlist** (as rotas do catálogo, por **template** de rota —
   `request.scope["route"].path` —, não por prefixo). Qualquer outra rota ou
   método ≠ GET com token de agente → **403**. Fora de propósito:
   - downloads de arquivo (`/documents/{id}/download`, anexos de meta,
     `/videos/{id}`): nenhum arquivo vai ao modelo;
   - **prova/teste** (`/tests/{id}`, `/tests/{id}/take`, tentativas de
     outros): o Guardi não vê nem ajuda a fazer prova;
   - `/invitations*`, `/auth/*` exceto `/auth/me`, `/logs`, `/videos/admin*`,
     bingo e tour.
4. Auditoria: o middleware de auditoria grava `via=<act.sub>` quando a
   requisição veio por token de agente.
5. Testes: token válido entra como a pessoa e vê o que ela vê (`user` em
   `/absences/team` → 403); `aud` errado, vencido, `exp` longo, chave errada →
   401; e-mail sem conta ou desativado → 401; rota fora do allowlist e método ≠
   GET → 403; prova → 403 mesmo para master_admin.
6. Fora deste trabalho, mas na mesma sessão: **trocar a senha do `bruce`** e
   tirá-la do código (env); `PATCH /profiles/me` não aceitar `company_id`/
   `department_id`.
7. Changelog do TalentHS (`ChangelogModal.tsx`) e deploy do backend.

## Do lado do HS.OS

- `app/sistemas/talenths.py`: `chamar(...)` por `chamar_sistema` com
  `AUD = "talenths"`, base `settings.TALENTHS_API_URL`, mensagens próprias
  (401: "o TalentHS não reconheceu o seu dono…"; 403: "o login do seu dono no
  TalentHS não vê isso"; 404).
- `app/talenths_consultas.py`: catálogo puro, testado
  (`tests/test_guardi_talenths.py`): chave desconhecida, `id` obrigatório e
  proibido, filtro fora da lista, obrigatório ausente.
- `routers/mcp_bot.py`: `talenths_*` exige `talenths` em `sistemas_ligados`;
  `FERRAMENTAS_BOT` ganha as duas.
- `config.py`/`.env.example`: `TALENTHS_API_URL`.
- `publicar-bots-mcp.py`: `--ligar-talenths-todos`, que liga só quem responde
  200 no `/auth/me` (ensaio por padrão).
- Template do Guardi: ponteiro curto no `AGENTS.md`; medir o teto de 20.000.
- Changelog do HS.OS.

## Não-objetivos

- Escrever no TalentHS (pedir férias, bater ponto, responder feedback, lançar
  realizado de meta) — fase 2, por cartão, se pedirem.
- Arquivo de documento, vídeo, prova.
- Recorte de "meu time" para gestor: o TalentHS não tem; inventar aqui seria
  regra de permissão do lado errado.
- A `nina` e o `bruce`: o `bruce` continua no caminho dele.

## Anti-objetivos

- **O Guardi entregar salário ou CPF de colega a quem não é RH.** Fecha no
  TalentHS (pré-requisito), não em instrução.
- **O HS.OS decidir quem vê o quê.**
- **O Guardi chamar a empresa inteira de "o seu time"** — a `description`
  explica o que `/team` significa lá.

## Restrições

- Território: a mudança do TalentHS é feita na sessão daquele repo.
- Ordem: TalentHS (pré-requisito + token) no ar → deploy do HS.OS com
  `TALENTHS_API_URL` → `publicar-bots-mcp.py --aplicar` →
  `--ligar-sistema erick-bot talenths` → conferência → todos.

## Conferência (piloto)

O Erick é `user` no TalentHS. Visão de colaborador no `erick-bot`; a do RH, no
Guardi da Lidisay, ligado só para o teste com o acordo dela. Perguntar sem citar
a resposta:
1. `erick-bot`: "tenho férias pendentes?", "quantas horas bati ontem?", "qual o
   salário do Paulo?" → recusa (403 do TalentHS, não do Guardi);
2. Lidisay: "quem tem férias pendentes de aprovação?", "como está o status das
   avaliações?";
3. "me mostra a prova do curso X" → recusa.

## Decisões minhas (Claude), revisáveis

- Catálogo amplo desde o início (todas as leituras de RH), já que o TalentHS
  recorta por papel.
- Filtros do `/openapi.json` público.
- Prova, arquivo e convite fora do allowlist.
- `--ligar-talenths-todos` confere conta por `/auth/me`.

## Para o construtor decidir

- Onde resolver o e-mail do token no TalentHS (dependência com pool ou
  `get_db`).
- O recorte exato de colunas em `/profiles` para não-RH, conferido nas telas.
- Se `/goals/overview` (a empresa inteira para todos) pede corte — hoje é a
  regra de lá e fica como está.
