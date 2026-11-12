# Guardi no HSGrowth: o vendedor (fase 1), design de 12/11/2026

## Intenção

O HSGrowth é o CRM da HS. Só duas funções trabalham nele de fato, **Vendas** e
**Serviços**, e as duas usam o sistema de jeitos muito diferentes (são dois
kanbans independentes lá dentro). Esta spec cobre **só o vendedor**; Serviços
vem depois, com spec própria.

O vendedor passa o dia entre ligação, reunião e e-mail, e o CRM fica para
depois — card sem nota, tarefa de retorno que não foi criada, etapa que não
andou. A ideia é o Guardi ser o par do vendedor no CRM:

- **ver tudo o que o vendedor vê:** "o que eu tenho pra hoje?", "quais cards
  meus estão parados em Negociação?", "como está o card da empresa X?", "o que
  foi conversado com esse cliente?";
- **ajudar a preencher, alterar e mover:** a partir do que o vendedor conta em
  linguagem solta — "liguei pro fulano da X, pediu retorno quinta às 10, manda
  pra Qualificação" vira nota + tarefa + movimento;
- **criar lead** a partir de uma conversa, de um e-mail ou de um CNPJ.

É o primeiro sistema em que **nem todo colaborador tem acesso**: dos 23 donos de
Guardi, 11 têm conta ativa no HSGrowth, e o foco são **cinco vendedores**.

## Decisões do Erick (12/11/2026)

1. **Uma função por vez: primeiro o vendedor**, Serviços depois.
2. **Foco nos cinco vendedores** com conta `salesperson`: Gislayne, Sandra,
   Adriana, Eduardo e Miguel.
3. **O Guardi faz praticamente tudo o que o vendedor faz no funil:** consultar,
   criar lead, preencher e alterar campos, mover de etapa, anotar e criar
   tarefa.
4. **Excluir card e transferir para outro vendedor ficam fora** — é com o time
   de TI.
5. **Enviar e-mail pelo card fica fora** — o Guardi já envia e-mail pela
   ferramenta própria.
6. **Confirmação em toda escrita**, inclusive nota e tarefa. "Só para ter
   certeza que eles estão fazendo correto; se acharem um problema eles vêm
   falar comigo." Leitura é direta.
7. **Leitura igual à tela** (resposta à revisão): o Guardi lê qualquer card
   que o vendedor abriria no HSGrowth, inclusive o de um colega (histórico,
   notas, valores). Escrita continua só nos próprios cards.

## O que o reconhecimento mostrou (leitura do `~/github/hsgrowth-sistema` e do banco, 12/11/2026)

- **Quem tem conta:** 11 dos 23 donos de Guardi, pelo mesmo e-mail — 5
  `salesperson` (os da decisão 2), 3 `service` (Ellen, Leti, André), a Lidisay
  (`manager`), o Erick e o Welton (`admin`). A Lara Cocri (`comercial05`) não
  aparece — ou não tem conta, ou tem com outro e-mail.
- **Os vendedores trabalham nos dois quadros de Vendas:** Prospecção (board 6:
  Lead Novo → Prospecção → Conectado → Reagendamento → Agendado; Negócio
  Perdido) e Aquisição (board 7: Reunião Agendada → Qualificação → Diagnóstico
  e Proposta → Negociação → Aguardando Pedido; Negócio Perdido, Negócio Ganho).
  O Miguel vive na Prospecção, os outros quatro na Aquisição. Os ids 6, 7 e 8
  (Expansão) são fixos no código de lá.
- **Login:** JWT HS256 próprio, `{sub: user.id, type: "access"}`, usuário
  resolvido **por id**, sem `iss`/`aud`. `get_current_user` em
  `backend/app/api/deps.py`. Não existe token de agente; existe um token de
  integração (`client-credentials`, um cliente por usuário personificado), que
  **não** é o caminho: não serve 23 pessoas e o usuário de integração pula a
  trava de CNPJ de parceiro (`parcerias/vendas.py:41`).
- **API de produção:** `https://growthhsapi.healthsafetytech.com/api/v1`. O
  front: `https://hsgrowth.healthsafetytech.com`, card em `/cards/:cardId`.
  **O `/openapi.json` de produção dá 404** — os filtros do catálogo vão
  declarados à mão, como no DocsHS.
- **Leitura:** `GET /cards?board_id=` já limita o vendedor aos cards em que ele
  é o vendedor ou o SDR. `GET /cards/{id}` e `/expanded` abrem **qualquer**
  card. Não há filtro no servidor por etapa, cliente, CNPJ, texto ou "parado"
  — mas cada card traz `list_id`, `client_document` e `pending_tasks_status`
  (overdue/today/future/none). Busca de verdade é `GET /search/global?q=`
  (título, cliente, CNPJ/CPF, contato).
- **As regras de escrita que importam (o servidor de lá as aplica):**
  - **Vendedor só cria card na Prospecção, lista "Lead Novo"** — fora disso,
    403. Vira dono automaticamente.
  - Só escreve no card quem é o vendedor ou o SDR dele.
  - **Mover anda uma etapa por vez**, com requisitos cumulativos por etapa (na
    Prospecção: pessoa, canal e detalhe, tipo de negócio; depois dados do
    cliente; depois uma ligação, atividade ou nota de 20+ caracteres; depois
    e-mail/cargo/área da pessoa, produto, implantação/pessoal, porte). Na
    Aquisição: sair de Reunião Agendada exige não haver reunião pendente;
    Diagnóstico e Proposta → Negociação exige **anexo de proposta**, follow-up
    pendente e previsão de fechamento. Sair de Aguardando Pedido só por Ganho
    ou Perdido. Tudo em `card_service.py:1250-1615`.
  - **Ganho e Perdido têm rota própria:** `POST /cards/{id}/win` (exige
    `modality`) e `POST /cards/{id}/lose` com `loss_reason`. Um `/move` cru
    para a lista de perdido pula o motivo.
  - **CNPJ protegido por parceiro** dá 409 ("está com o parceiro X… fale com o
    gerente"), na criação e ao trocar o cliente do card.
  - Cliente com documento repetido dá 400; cliente ligado a card precisa de
    `sector` e `relationship_type`; pessoa ligada precisa de e-mail ou
    telefone.
  - Ganhar dispara gamificação e automações; **não** avisa o GestorHS (esse
    aviso é só do kanban de Serviços — o `CLAUDE.md` de lá diz o contrário e
    está errado para Vendas).
- **Buracos de permissão do lado de lá** (achados na leitura, valem para
  qualquer usuário, não só agente): `PUT /cards/{id}/assign` reatribui card
  de qualquer um; `POST /cards/{id}/fields`, `POST /card-notes`,
  `POST /card-tasks`, `PATCH /card-tasks/{id}/complete` e
  `POST /cards/{id}/person` não conferem se o card é de quem escreve;
  `POST /cards/{id}/fields` na forma `{field_name, …}` **cria definição de
  campo** nova; `PUT /cards/{id}` aceita `assigned_to_id`, `sdr_id`, `is_won`
  e `is_lost` soltos. Ver "Para o HSGrowth".
- **Proposta de Vendas não é a proposta do sistema** (aquela é de Serviços,
  `require_service_access`, 403 para vendedor): é um **anexo** do card com
  `attachment_type='proposal'`.

## O que a fase 1 entrega

### Leitura (direta)

Ferramentas `hsgrowth_consultas` / `hsgrowth_consultar` no `hsos-bot-<bot>`,
ativas com `hsgrowth` em `sistemas_ligados`, no padrão do DataCore: o agente
escolhe uma **consulta do catálogo**, nunca um caminho; filtros só como query,
declarados à mão; ids só dígitos; teto de 12 mil caracteres no retorno. O
catálogo cobre:

| consulta | rota no HSGrowth |
|---|---|
| quadros de Vendas e as etapas de cada um | `GET /boards?category=vendas`, `GET /boards/{id}/lists` |
| meus cards (por quadro, etapa, ganho/perdido, tarefa atrasada/hoje, período) | `GET /cards?board_id=` (filtro de etapa e de tarefa feito do nosso lado) |
| um card completo (campos, tarefas, produtos, atividades) | `GET /cards/{id}/expanded` |
| busca (nome, cliente, CNPJ, contato) | `GET /search/global` |
| notas de um card | `GET /card-notes/card/{id}` |
| minhas tarefas (hoje, atrasadas, por período/tipo) | `GET /card-tasks?assigned_to_id=<eu>`, `GET /card-tasks/overdue` |
| campos personalizados do quadro | `GET /fields/definitions/board/{id}` |
| clientes e contatos | `GET /clients?search=`, `GET /clients/{id}`, `GET /persons?search=` |
| CNPJ na Receita | `GET /clients/cnpj/{cnpj}` |
| parceiro protegendo o CNPJ do card | `GET /cards/{id}/aviso-parcerias` |
| eu (id, função) | `GET /auth/me` |

"Parado" é derivado do que já vem no card (dias na etapa, tarefa pendente); a
régua exata fica para o construtor, e se `~/projetos/relatorios-hsgrowth/`
(`cards_parados.py`) já define "parado", **vale a de lá**.

**Link montado pelo servidor:** `HSGROWTH_URL/cards/<id>`. Duas envs, como no
GestorHS: `HSGROWTH_API_URL` (as chamadas) e `HSGROWTH_URL` (só os links).

### Escrita (sempre por cartão)

Padrão do TaskHS e do GestorHS: o servidor **lê** o HSGrowth, recusa antes do
cartão o que lá seria recusado (dizendo por quê e o que falta), grava em
`acoes_pendentes`, o cartão aparece, o vendedor confirma e só então o
`payload` gravado é executado.

| ferramenta | o que faz | rota |
|---|---|---|
| `hsgrowth_criar_lead` | lead novo na Prospecção / Lead Novo, com cliente e contato (achando os existentes, ou criando — CNPJ consultado na Receita) | `POST /clients`, `POST /persons`, `POST /cards`, `POST /cards/{id}/person` |
| `hsgrowth_atualizar` | campos do card (lista fixa) e campos personalizados (só por `field_definition_id` existente) | `PUT /cards/{id}`, `POST /cards/{id}/fields` |
| `hsgrowth_mover` | uma etapa adiante ou atrás no mesmo quadro | `PUT /cards/{id}/move` |
| `hsgrowth_ganhar` / `hsgrowth_perder` | fechar o card; perder exige motivo | `POST /cards/{id}/win`, `POST /cards/{id}/lose` |
| `hsgrowth_cliente` | completar cliente e contato que a etapa pede (setor, relacionamento, porte; e-mail, cargo, área) | `PUT /clients/{id}`, `PUT /persons/{id}` |
| `hsgrowth_anotar` | nota no card | `POST /card-notes` |
| `hsgrowth_tarefa` | criar, alterar e concluir tarefa (ligação, reunião, follow-up…) | `POST /card-tasks`, `PUT /card-tasks/{id}`, `PATCH /card-tasks/{id}/complete` |
| `hsgrowth_noshow` | cliente faltou à reunião | `PATCH /card-tasks/{id}/noshow` |

Regras do nosso lado (antes do cartão):

- **O card tem que ser do dono** (vendedor ou SDR dele) para qualquer escrita
  — conferido no `/expanded`, mesmo nas rotas em que o HSGrowth não confere.
- **Cliente e contato** (chamada do Claude): só se estiverem ligados a um card
  aberto do dono, e só os campos que as etapas pedem (lista fixa). Cliente é
  compartilhado — o cartão mostra o valor antigo e o novo. `relationship_type`
  "Cliente" não volta atrás (regra de lá).
- **Reunião que não aconteceu é no-show, nunca "concluir"** (chamada do
  Claude): concluir reunião na Aquisição paga comissão ao SDR
  (`card_task_service.py:349`). O no-show roda a automação de lá que devolve o
  card para Reagendamento.
- **Mover para Agendado (Prospecção) leva o card para Reunião Agendada, na
  Aquisição**, por uma automação ativa de lá — o cartão e a resposta dizem isso.
- **Corpo por allowlist de chaves.** `assigned_to_id`, `sdr_id`, `is_won`,
  `is_lost` e `loss_reason` **nunca** saem no `PUT`; ganho e perdido só pelas
  rotas próprias; campo personalizado só por definição que já existe.
- **Mover:** o que a etapa exige, quem diz é o HSGrowth. Do nosso lado só o
  barato e estável é conferido antes do cartão (uma etapa por vez, ganho sem
  `modality` → "falta dizer se é venda ou locação", Negociação sem anexo de
  proposta); o resto é a recusa de lá, **traduzida** para o vendedor dizendo o
  que falta, e ele resolve na mesma conversa (o Guardi prepara a nota, a
  tarefa ou o campo que faltava). Duas réguas de etapa é o que não queremos.
- **Uma conversa, vários cartões é aceitável,** mas o caso comum ("liguei, pediu
  retorno quinta, passa pra Qualificação") deve virar **um cartão só** com as
  três coisas, executadas na ordem nota → tarefa → movimento, e "para e não
  desfaz" se uma falhar no meio (dizendo o que entrou), como o lote da
  Expedição.
- **CNPJ:** antes de criar lead, procurar cliente existente pelo documento e
  conferir parceiro; o cartão mostra se o cliente é novo ou existente (e de
  quem são os cards abertos dele, se houver).
- **Datas de tarefa:** o vendedor fala em horário de Brasília; a API guarda
  UTC.
- 403 numa escrita vira "o HSGrowth não deixa a sua função fazer isso"; 409 de
  parceiro é repassado com o nome do parceiro e "fale com o gerente".
- **Nomes de ação com prefixo `hsgrowth_`** em `acoes_pendentes`: o
  `cartaoDaAcao` do front despacha pelo nome, e `criar_proposta`, `mover`,
  `receber` já existem para outros sistemas.

### Ligar

- Piloto no `erick-bot` (admin lá) com `--ligar-sistema <bot> hsgrowth`.
- Depois `--ligar-hsgrowth-vendedores`: liga só quem responde 200 no
  `/auth/me` **com função `salesperson`** (ensaio sem `--aplicar`). Os outros
  donos com conta (Serviços, Lidisay, Welton) **não** são ligados nesta fase —
  ligá-los daria a eles as ferramentas de vendedor antes da fase deles.
- Ferramenta nova exige `publicar-bots-mcp.py --aplicar` (`FERRAMENTAS_BOT`) e,
  com o ponteiro novo no `AGENTS.md`, `criar-bots-pessoais.py
  --reescrever-agents-md --aplicar --todos`.

### `AGENTS.md` do template

Ponteiro curto, como nos outros sistemas: "funil, leads, cards, tarefas e
notas do CRM (HSGrowth) → começo por `hsgrowth_consultas`; toda alteração vira
cartão; o que a etapa exige quem diz é o servidor". ⚠️ Vai para todos os 23,
inclusive quem não tem `hsgrowth` ligado — mesma situação dos outros
sistemas; o servidor recusa a ferramenta sem o sistema ligado.

## Fora da fase 1

- Excluir card, transferir/reatribuir, reabrir ganho (decisões 4 e 5); enviar
  e-mail pelo card.
- **Anexar arquivo ao card** — inclusive a proposta que Diagnóstico e Proposta
  → Negociação exige. O Guardi recusa esse movimento dizendo "anexe a proposta
  no card pela tela" e passa o link. (Chamada do Claude: anexo pede outro
  fluxo — bytes do R2 para o HSGrowth — e cabe numa fase seguinte, se os
  vendedores pedirem.)
- Produtos do card (itens e valores) e condição de pagamento — o requisito de
  "≥1 produto" na Prospecção é recusado com o que falta, como o anexo.
  (Chamada do Claude; entra junto com o anexo se for o gargalo.)
- Reuniões com convite (`meeting_kind`, `invited_emails`) além de criar a
  tarefa de reunião simples; cadências, automações, gamificação, relatórios.
- **Serviços** (kanban de Serviços, propostas do sistema) — fase própria.
- Visão de gestor (Lidisay, admins).

## Anti-objetivos

- Um card mudar de dono, de vendedor ou de status (ganho/perdido) por um
  caminho que não seja a rota própria e o cartão.
- O Guardi criar definição de campo personalizado, ou escrever em card de
  outro vendedor porque a rota de lá não confere.
- O Guardi "contornar" um requisito de etapa preenchendo valor inventado para
  passar (canal, porte, modalidade) — o que falta é perguntado ao vendedor.
- Ligar as ferramentas de vendedor para quem não é vendedor.

## Para o HSGrowth (sessão no repo `~/github/hsgrowth-sistema`)

1. Variável `HSOS_AGENTE_CHAVE_PUBLICA` (PEM Ed25519, de
   `GET /agente/chave-publica` do HS.OS). Sem ela, token de agente é recusado
   e tudo segue como hoje.
2. Em `get_current_user`, para Bearer com `iss == "hsos"`: EdDSA (PyJWT com
   `cryptography`, se o caminho atual não verificar EdDSA), `aud ==
   "hsgrowth"`, `exp` a no máximo 600 s, usuário **por e-mail exato** (`sub`),
   ativo e não deletado. Guardar `act.sub` (o bot) no request. O usuário
   **não** vira `is_integracao` — a trava de CNPJ de parceiro vale.
   Pular a blacklist/sessão do Redis e o `password_changed_at` para esse
   token (não há sessão; o token vive 5 minutos).
3. **Allowlist de rotas para token de agente** (qualquer outra, inclusive GET,
   → 403): as GET do catálogo de leitura acima, `GET /auth/me`, e as escritas
   da tabela de escrita — e só elas. `PUT /clients/{id}` e `PUT /persons/{id}`
   de agente só com cliente/contato ligado a card aberto do dono. Fica de fora, sem precisar lembrar uma por
   uma: `assign`, `DELETE` de card, `reopen`/`reopen-won`, transferências,
   `send-email`, anexos, propostas, campos por nome, admin, usuários, kanban de
   Serviços.
4. **Para token de agente, toda escrita da allowlist exige que o card seja do
   dono** (vendedor ou SDR), inclusive em `fields`, `card-notes`, `card-tasks`
   (criar, alterar, concluir, no-show) e `cards/{id}/person`, que hoje não conferem.
   `PUT /cards/{id}` de agente recusa (403) `assigned_to_id`, `sdr_id`,
   `is_won`, `is_lost`; `POST /cards/{id}/fields` de agente só aceita
   `field_definition_id`.
5. Na atividade/histórico do card (e no `AuditLog`), quando vier de token de
   agente, acrescentar "via <bot>". Assim o vendedor e o Erick veem o que foi
   pelo Guardi.
6. Testes: token válido entra como a pessoa, com a função dela; `aud` errado,
   vencido, chave errada, e-mail inexistente → 401; rota fora da allowlist →
   403; escrita em card de outro vendedor → 403 em cada rota do item 4;
   `assign` → 403; `PUT` com `assigned_to_id` → 403; o histórico traz "via".
7. Changelog e deploy pelo fluxo de lá.
8. ⚠️ Os buracos de permissão listados no reconhecimento valem para **usuário
   humano** também (vendedor reatribuindo card alheio pelo `assign`, nota e
   tarefa em card alheio). Corrigir para todos é decisão do Erick e de outra
   tarefa; esta spec só fecha o caminho do agente. Dois defeitos menores
   achados de passagem: `PATCH /card-tasks/{id}/noshow` usa
   `Depends(require_not_viewer)` sem os parênteses (a trava de viewer nunca
   roda) e a exceção admin/manager em editar/apagar nota compara um objeto
   `Role` com string (`card_note_service.py:141, 182`).
9. O `CLAUDE.md` de lá diz que marcar Ganho avisa o GestorHS — só é verdade no
   kanban de Serviços.

## Restrições

- Chamadas saem do backend do HS.OS com `httpx`, token de agente de 5 minutos
  (`app/agente_token.py`, `aud: "hsgrowth"`), registro em `agente_chamadas` e
  retorno como `como_dado_externo(..., origem="HSGrowth")`.
- Mesmas guardas do `hsos-bot-<bot>`: só no turno do dono, recusa se outra
  pessoa tiver turno aberto com o bot; a confirmação executa o `payload`
  GRAVADO.
- Ordem de produção: deploy do HSGrowth com o token de agente → envs
  `HSGROWTH_API_URL` e `HSGROWTH_URL` no EasyPanel do HS.OS → deploy do HS.OS
  (uma vez no fim do dia) → `publicar-bots-mcp.py --aplicar` → piloto no
  `erick-bot` → ligar os vendedores.
- O HS.OS é construído e testado em paralelo contra um servidor falso
  (`MockTransport`), como no GestorHS. Nada é ligado antes do deploy de lá.

## Conferência

Sem teste artificial em produção (mesma decisão de 12/11 do GestorHS):

- ⚠️ O Erick é `admin` lá: o admin pula toda regra de etapa e o `GET /cards`
  devolve todos os cards. Por isso "meus cards" filtra por
  `assigned_to_id`/`sdr_id` = eu **em qualquer função**, e o piloto no
  `erick-bot` só exercita leitura, montagem e cancelamento de cartão e as
  recusas do nosso lado (card de outro). A tradução das recusas de etapa só se
  exercita com um vendedor de verdade — aceito, sem card de teste em produção.
- No `erick-bot`: leituras conferidas na tela (cards de um vendedor, tarefas de
  hoje, busca por CNPJ); preparar um cartão de nota/tarefa/movimento e
  **cancelar**; pedir para mover um card de outra pessoa (recusa antes do
  cartão); pedir Diagnóstico → Negociação sem anexo (recusa dizendo o que
  falta).
- A primeira escrita real é **com um vendedor, acompanhada** — o pós-ligação
  dele (nota + tarefa + movimento) conferido na tela do HSGrowth, com o "via
  <bot>" no histórico.

## Para o construtor decidir

- Nomes exatos das ferramentas e o desenho dos argumentos; se a tarefa vira uma
  ferramenta com `acao` ou três.
- Como o cartão mostra o combinado nota + tarefa + movimento (se precisar
  mexer no front do cartão, mínimo).
- O formato de saída das leituras (texto enxuto, nome da etapa em vez do id).
- Como resolver "o card da X" quando a busca devolve mais de um — perguntar ao
  vendedor, nunca escolher.
- Se a conferência de requisitos de etapa do nosso lado espelha a regra de lá
  ou só traduz a recusa do servidor (com a recusa de lá sendo sempre a última
  palavra). Preferência: traduzir a recusa e espelhar só o que é barato e
  estável (ganho sem modalidade, anexo de proposta), para não ter duas réguas.
