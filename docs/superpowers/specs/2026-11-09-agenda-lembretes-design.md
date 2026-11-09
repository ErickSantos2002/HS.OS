# Agenda e lembretes do Guardi — design

Data: 09/11/2026 · Decisões do Erick nesta conversa, salvo onde marcado
**(decisão do Claude)**.

## Por quê

Dois casos reais:

- Um Guardi **sugeriu** a um vendedor "te lembro de mandar o e-mail daqui a 2
  dias" — e, quando o vendedor aceitou, disse que não tinha onde guardar
  lembrete. O agente prometeu o que a plataforma não fazia.
- Outra pessoa quer que o Guardi cuide da agenda do dia a dia: "toda segunda de
  manhã me lembre de X".

Nenhum dos dois é atendido pelo `cron` do gateway: ele é negado aos Guardis de
propósito (`TRAVAS_DO_BOT`, ver "Agente não agenda a si mesmo" no `CLAUDE.md` —
os 560 disparos da `nina`). A agenda é do **HS.OS**, não do gateway.

O Erick também decidiu que o Guardi vai **trabalhar sozinho em outros momentos**
no futuro; o disparo daqui deve servir de base para isso, não ser um caso único.

## Objetivos

1. A pessoa (ou o Guardi dela, em conversa) cria lembretes **únicos** ("daqui a
   2 dias às 9h") e **recorrentes** ("toda segunda às 8h", "todo dia útil às
   18h", "dia 5 de todo mês").
2. Na hora marcada, o lembrete chega como **mensagem do Guardi na conversa com a
   pessoa + push no celular**.
3. No disparo o Guardi **trabalha**: roda um turno com a instrução do lembrete
   (ex.: "traga minhas tarefas da semana do TaskHS") e a resposta dele é
   entregue na conversa.
4. **Página "Agenda"** no HS.OS: lista por período + calendário do mês, onde a
   pessoa vê, cria, edita, pausa e apaga os próprios lembretes — inclusive os
   que o Guardi criou.
5. **Calendário do Outlook (leitura)**: o Guardi enxerga as reuniões da pessoa e
   a página mostra os compromissos do Outlook junto dos lembretes. Motivo do
   Erick: o Guardi **não sugerir data/horário em cima de reunião** já marcada.

## Não-objetivos

- Criar ou alterar evento no Outlook (fica para depois).
- Calendário de caixa compartilhada — só a conta principal da pessoa
  **(decisão do Claude)**.
- Lembrete para outra pessoa ("lembra o André de…"). Cada lembrete é do dono do
  Guardi e chega só a ele.
- Especialistas (`nina`, `iris`…) com agenda. Só Guardis (`agent_profiles.dono_id
  IS NOT NULL`).
- Usar o `cron.*` do gateway.

## Anti-objetivos (o que faria isto falhar mesmo "funcionando")

- **Disparo em laço / custo descontrolado** — a história dos 560 disparos não
  pode se repetir. Tetos no servidor, não só na instrução do agente.
- **Lembrete que some em silêncio**: gateway fora do ar no horário e a pessoa
  não recebe nada. O recado tem que chegar mesmo sem o agente.
- **Escrita sem o dono**: no disparo o Guardi age sozinho, mas o que altera algo
  fora (e-mail para terceiros, TaskHS) **continua virando cartão** de
  confirmação. Trabalhar sozinho é ler e preparar, não executar.
- Horário errado por fuso: tudo que a pessoa vê e diz é **horário de Brasília**.

## Como funciona

### Dados — migração `032_lembretes.sql`

Tabela `public.lembretes` **(desenho do Claude)**:

| coluna | |
|---|---|
| `id` uuid pk | |
| `user_id` uuid → `profiles` | o dono; RLS: só ele lê/escreve |
| `agent_id` text | o Guardi do dono no momento da criação |
| `titulo` text (≤ 200) | o recado ("Mandar o e-mail da proposta para a ACME") |
| `instrucao` text (≤ 2000), nulo | o que o Guardi faz no disparo; nulo = só o recado, sem turno do agente |
| `regra` jsonb | `{"tipo":"unico","em":"2026-11-11T09:00"}` ou `{"tipo":"semanal","dias":[1],"hora":"08:00"}` / `diario` / `dias_uteis` / `mensal` (`"dia":5`) — horários em America/Sao_Paulo |
| `proximo_em` timestamptz | próximo disparo, em UTC; nulo = encerrado |
| `ativo` bool | pausar/retomar |
| `criado_por` text | `pessoa` \| `guardi` |
| `disparando_em` timestamptz | reserva entre os 2 workers |
| `ultimo_disparo_em`, `ultimo_status` | `entregue`, `entregue_sem_agente`, `perdido`, `erro` |
| `criado_em`, `atualizado_em` | |

Índice parcial em `proximo_em WHERE ativo`. Grants iguais às outras tabelas do
domínio do usuário (o `hsos_app` lê/escreve; o usuário de leitura da empresa
enxerga — por isso **nada sensível** além do texto que a pessoa escreveu).

Cálculo do próximo disparo é **função pura** (`app/agenda/regras.py`), testada:
dada a regra e "agora", devolve o próximo instante em UTC. Fuso fixo
America/Sao_Paulo (o Brasil não tem horário de verão desde 2019, mas usar
`zoneinfo` mesmo assim).

### Tetos (no servidor)

**(decisão do Claude — valores ajustáveis)**

- Até **30 lembretes ativos** por pessoa.
- Recorrência mínima: **diária**. Não existe "a cada X minutos/horas".
- Lembrete único: no mínimo **5 min** no futuro, no máximo **1 ano**.
- Até **12 disparos com turno de agente por pessoa por dia**; acima disso o
  lembrete sai **só como recado** (sem rodada de IA) e o status registra.
- Atrasado (backend fora no horário): dispara se o atraso for **≤ 6 h**; acima,
  marca `perdido`, avança o recorrente e **não** dispara velho.

### Disparador — `app/disparador_lembretes.py`

Mesmo molde do `coletor_respostas`/`vigia_sessoes`: laço por worker a cada
`DISPARADOR_LEMBRETES_SEGUNDOS` (padrão 30; 0 desliga — entra na lista de
variáveis para testar local sem mexer em produção).

A cada passada:

1. **Reserva** até 20 lembretes com `ativo AND proximo_em <= now()` e reserva
   livre/velha, via `UPDATE … SET disparando_em = now() … RETURNING` com a guarda
   no WHERE (um worker só fica com cada um).
2. Para cada um, **primeiro o recado, sem agente**: grava em `conversations` uma
   mensagem `role='agent'` do Guardi com `⏰ Lembrete: <titulo>` e
   `media=[{type:"lembrete", id}]`. O push e o tempo real saem dos triggers que
   já existem (`trg_push_pendente`). **Isto acontece mesmo com o gateway fora** —
   é o que garante o anti-objetivo "lembrete que some".
3. Se há `instrucao` e o teto diário permite: **abre um turno do Guardi em nome
   do dono** — o mesmo que o `POST /conversations/{agent_id}/send` faz
   (`_chave_sessao`, `_ultimo_seq`, `chat.send` com `agentId` explícito,
   `_guardar_run` com o `user_id` do dono). Extrair o miolo do `enviar` para uma
   função reutilizável (`disparar_turno(agent_id, user_id, mensagem)`), como foi
   feito com `colher_resposta`. A mensagem ao agente:
   `[Lembrete agendado por <primeiro nome> — "<titulo>"] <instrucao>`.
4. A resposta é colhida pelo **`coletor_respostas`**, que já cuida de run sem
   tela aberta, e o push dela sai pelo trigger. Nada novo aqui.
5. Avança: único → `proximo_em = NULL`; recorrente → próximo pela regra. Grava
   `ultimo_disparo_em/status`, solta a reserva.

⚠️ **Turno já aberto na hora do lembrete (decisão do Claude).** O disparador usa
a MESMA sessão da conversa da pessoa (o Guardi lembra do que vinha sendo
falado). Se houver run aberto com o Guardi — da própria pessoa ou de outra —, o
**recado sai na hora** (passo 2) e o **turno do agente é adiado** em passos de 2
min, até 30 min; passou disso, fica só o recado com `ultimo_status =
entregue_sem_agente`. Isso evita as três colisões: o coletor perder a resposta
da pergunta em curso (ele só colhe o run mais novo), duas respostas coladas numa
bolha (o `seq_antes` lido no meio de outra resposta) e o turno rodar sem
ferramenta por `outro_turno_aberto`. Coluna `turno_pendente_desde timestamptz`
na `lembretes` marca o adiamento.

⚠️ **O turno aberto pelo disparador conta como "o dono está conversando"**
(`turno_em_curso` olha `agent_runs` do dono sem `message_id`). É isso que faz as
ferramentas do Guardi funcionarem no disparo, e é **a regra geral** que o Erick
quer para "o Guardi trabalha sozinho": todo trabalho autônomo entra por
`disparar_turno` em nome do dono, e herda as mesmas guardas (`outro_turno_aberto`,
escrita vira cartão). Não criar caminho paralelo.

### Ferramentas do Guardi

No servidor `hsos-bot-<bot>` (`routers/mcp_bot.py`), **sem cartão** — a agenda
é da própria pessoa, se desfaz na página, e o Guardi criar lembrete que a pessoa
pediu é o comportamento esperado **(decisão do Claude, mesmo raciocínio do
`lembrar`)**:

- `agenda_criar(titulo, quando|repetir, instrucao?)` — `quando`: data/hora local
  `AAAA-MM-DDTHH:MM`; `repetir`: `{tipo, dias?, dia?, hora}`. Valida os tetos
  **antes** de gravar. **Confere o Outlook** (se conectado) no horário do
  lembrete e, havendo reunião sobreposta (±30 min), **grava mesmo assim** e
  devolve o aviso ("às 9h você tem 'Reunião ACME' até 10h") para o Guardi poder
  propor outro horário — o servidor dá o fato, o agente conversa.
- `agenda_listar(de?, ate?)` — os lembretes do dono **e** os eventos do Outlook
  no período (padrão: próximos 7 dias), marcados de onde vem cada um.
- `agenda_editar(id, …)` e `agenda_apagar(id)` — só lembretes do próprio dono.

Ferramentas novas entram em `FERRAMENTAS_BOT` e exigem republicar
(`publicar-bots-mcp.py`) depois do deploy.

⚠️ **A agenda é de todo Guardi, sem flag (decisão do Claude).** Hoje o
`hsos-bot-<bot>` só é declarado para quem tem `sistemas_ligados` (os 23 têm, em
09/11/2026, mas um Guardi novo pode não ter). Passa a ser declarado para **todo**
bot, em `publicar-bots-mcp.py` e em `_proprias`/`bot_esta_fechado`; as
`taskhs_*` continuam recusadas na chamada para quem não tem `taskhs` ligado (como
já é). Assim o ponteiro do `AGENTS.md` nunca promete ferramenta que o Guardi não
tem — exatamente o defeito que motivou esta spec.

`AGENTS.md` do template (ponteiro curto, a regra longa fica na description):
"Prometeu lembrar? grave com `agenda_criar` — nunca diga que não tem onde.
Antes de sugerir data ou horário, olhe `agenda_listar` (inclui o Outlook)."
Reescrever nos 23 com `--reescrever-agents-md`.

### Outlook — leitura do calendário

- Pedir **`Calendars.Read.Shared`** no "Conectar/Reconectar e-mail" — e **só ali**.
  O login (`ESCOPOS` do SSO) **não muda**.
- ⚠️ **O refresh renova com os escopos que a conta TEM, não com a constante.**
  Hoje `renovar` manda `scope: ESCOPOS_EMAIL` em todo refresh; com
  `Calendars.Read.Shared` na constante, quem conectou antes pediria um escopo não
  concedido e **o e-mail de todos quebraria no deploy** ("consent required").
  Guardar os escopos concedidos (vêm na resposta do token) em `email_contas`
  (coluna nova `escopos text[]` na mesma `032`); conta antiga (`escopos` nulo)
  renova com os escopos de e-mail de hoje. Teste tranca isso.
- **Quem libera:** a página mostra o calendário a quem tem a conta conectada com
  o escopo (é a agenda da própria pessoa); as **ferramentas do Guardi** seguem a
  flag `email_ligado`, como o e-mail **(decisão do Claude)**.
- Quem conectou antes não tem o escopo. Sem `Calendars.Read.Shared`: ferramentas e página seguem só com os lembretes e
  dizem "reconecte o e-mail em Perfil para eu ver sua agenda do Outlook"; o Perfil
  mostra o botão "Reconectar".
- Leitura por `GET /me/calendarView?startDateTime&endDateTime` com
  `Prefer: outlook.timezone="E. South America Standard Time"`, campos mínimos
  (assunto, início, fim, local, dia inteiro, `showAs`). Só leitura, só a conta
  principal. Conteúdo de evento é **dado externo** (`como_dado_externo`), como o
  e-mail. ⚠️ Não guardar evento no banco: o usuário de leitura da empresa enxerga
  as tabelas `email_*` — o motivo de a `email_pendentes` não guardar corpo.

### API para a página — `app/routers/agenda.py`

Todas de `usuario_atual`, sempre filtradas pelo próprio `user_id`:

- `GET /agenda/lembretes?de&ate` · `POST /agenda/lembretes` ·
  `PATCH /agenda/lembretes/{id}` (inclui pausar) · `DELETE /agenda/lembretes/{id}`
- `GET /agenda/outlook?de&ate` — eventos, ou `{conectado:false|sem_permissao}`
- Quem não tem Guardi: 404 "Você ainda não tem Guardi." (mesma mensagem de hoje).

Mesmas validações e tetos das ferramentas — **uma função de domínio só**, chamada
pelas duas pontas.

### Página "Agenda" — `/agenda`

- Item no menu para quem tem Guardi.
- **Desktop:** à esquerda a lista agrupada em *Hoje · Amanhã · Esta semana ·
  Depois · Recorrentes · Pausados*; à direita o calendário do mês com os dias
  marcados (ponto de lembrete e de evento do Outlook); clicar num dia filtra a
  lista. Eventos do Outlook aparecem na lista com outra cor e só leitura.
- **Celular (< 768px):** só a lista. A rota fica no `AppLayout` comum; não entra
  no `AppCelular` nesta fase **(decisão do Claude)**.
- Formulário: título · "o que o Guardi faz na hora" (opcional, com exemplo) ·
  quando (data + hora) **ou** repetir (todo dia / dias úteis / dias da semana /
  dia do mês + hora). Selo "criado pelo Guardi" nos que ele criou.
- Mostra o último disparo e o status (`perdido` / `erro` aparecem).

### Na conversa

O recado (`media type: "lembrete"`) renderiza como bolha do Guardi com ícone de
relógio e link "ver na Agenda". A resposta do turno vem logo depois, como
resposta normal do agente.

## O que fica com quem constrói

- Componentes de UI (shadcn), layout fino, cores.
- Nomes internos de funções e módulos além dos citados.
- Formato exato dos textos das ferramentas, desde que digam o aviso de conflito e
  os tetos atingidos.
- Se o disparador e o coletor compartilham laço ou não.

## Entrega e conferência

- **Entra — feito pelo Erick em 09/11/2026:** o app "HS.OS" tem
  `Calendars.Read.Shared` e `Calendars.ReadWrite.Shared` (delegadas), com
  consentimento de administrador. O código pede **só `Calendars.Read.Shared`**
  (lê o calendário da própria pessoa e os compartilhados com ela) — a de escrita
  fica registrada para a fase "criar evento no Outlook", e nada a pede antes
  disso.

- Migração aplicada por mim com o script admin (`~/aplicar-hsos-032.py`), que
  confere a tabela e a coluna nova ao final.
- Deploy, depois `publicar-bots-mcp.py --aplicar` e
  `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`.
- Conferência: no `erick-bot`, pedir "me lembra daqui a 10 minutos de testar a
  agenda e traga minhas tarefas abertas" — o recado chega com push, a resposta do
  Guardi vem com a lista do TaskHS, e o lembrete aparece na página como entregue.
- Reconectar o e-mail do Erick e perguntar ao Guardi "o que tenho amanhã?".
