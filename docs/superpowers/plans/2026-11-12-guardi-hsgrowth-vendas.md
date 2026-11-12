# Guardi no HSGrowth (vendedor, fase 1) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Guardi do vendedor lê o funil do HSGrowth como o dono e prepara, por cartão, criação de lead, preenchimento de card/cliente/contato, nota, tarefa, movimento, ganho, perda e no-show.

**Architecture:** mesmo molde do GestorHS: cliente HTTP com token de agente (`aud=hsgrowth`), catálogo de leitura puro, regras de escrita puras, ferramentas no `hsos-bot-<bot>` (`routers/mcp_bot.py`) que só LEEM o HSGrowth e gravam `acoes_pendentes`, executores em `app/acoes.py` disparados pelo clique, cartão no front (`lib/acoes.ts`). O lado do HSGrowth (token de agente, allowlist, dono) é outra sessão, a partir da seção "Para o HSGrowth" da spec; aqui tudo é testado contra `httpx.MockTransport`.

**Tech Stack:** FastAPI, httpx, asyncpg, pytest (backend); React + Vitest (front).

**Spec:** `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md`

## Global Constraints

- API: `HSGROWTH_API_URL = "https://growthhsapi.healthsafetytech.com/api/v1"`; front (só links): `HSGROWTH_URL = "https://hsgrowth.healthsafetytech.com"`; link de card = `HSGROWTH_URL + "/cards/<id>"`. Nunca o agente monta link nem caminho.
- O "eu" de lá é **`GET /users/me`** (a spec diz `/auth/me` — corrigir a spec na Task 9): devolve `id` e `role` (`salesperson`, `admin`…).
- Token: `app/agente_token.py`, `aud="hsgrowth"`. Retorno de leitura sempre `como_dado_externo(..., origem="HSGrowth")`; teto 12 mil caracteres (`texto_do_retorno` do DataCore).
- Toda escrita = cartão (`acoes.criar_pendente(conn, dono, bot, "hsgrowth", acao, payload, resumo)`); a confirmação executa o `payload` GRAVADO. Sistema `"hsgrowth"`; **todas as ações com prefixo `hsgrowth_`** (o `cartaoDaAcao` do front despacha só pelo nome).
- Escrita só em card cujo `assigned_to_id` ou `sdr_id` = id do dono (de `/users/me`), **em qualquer função** — inclusive admin.
- `PUT /cards/{id}` nunca leva `assigned_to_id`, `sdr_id`, `is_won`, `is_lost`, `loss_reason`, `shipping_cost`, `payment_info`, `client_id`. Campo personalizado só por `field_definition_id` que existe em `/fields/definitions/board/{board_id}`.
- Fora: excluir, reatribuir (`assign`), transferir, reabrir, `send-email`, anexos, produtos, pagamento, propostas, kanban de Serviços.
- Tudo que vem do HSGrowth e vai para o cartão passa por saneamento de uma linha (sem `\n`, teto 80) — como `gestorhs_escrita`.
- Datas de tarefa: o agente manda horário de Brasília (`AAAA-MM-DDTHH:MM`); o payload leva UTC ISO.
- Código, comentários e mensagens em português; testes com docstring dizendo o que o defeito custaria (padrão do repo).

## Review Focus

1. **Busca ambígua** ("o card da ACME" com dois cards): a ferramenta nunca escolhe — recusa listando os candidatos (id, título, dono, etapa). Teste na Task 5.
2. **Card de outro vendedor pedido para escrita** (leitura é livre): recusa antes do cartão dizendo de quem é. Teste na Task 5.
3. **Lote parcial no pós-ligação** (nota entrou, movimento recusado pela regra de etapa): o resultado diz o que entrou e traduz o que faltou, sem repetir o que já foi. Teste na Task 6.
4. **CNPJ com pontuação ou de parceiro ao criar lead**: busca por dígitos acha o cliente existente (cartão diz "existente"); 409 de parceiro vira a mensagem de lá + "fale com o gerente". Testes nas Tasks 4 e 6.
5. **Timeout numa escrita** (`ErroSistema(0)`): a mensagem diz "não sei se foi feito — confira antes de repetir", e o lote para ali. Teste na Task 6.

---

### Task 1: Cliente HTTP do HSGrowth

**Files:**
- Create: `backend/app/sistemas/hsgrowth.py`
- Modify: `backend/app/config.py` (ao lado de `GESTORHS_*`, linha ~64)
- Test: `backend/tests/test_guardi_hsgrowth.py`

**Interfaces:**
- Produces: `hsgrowth.AUD = "hsgrowth"`, `hsgrowth.ErroSistema` (reexport do TaskHS), `async hsgrowth.chamar(email, bot, caminho, params=None, dono=None, metodo="GET", json=None) -> Any`, `hsgrowth._transporte` (trocável em teste). `settings.HSGROWTH_API_URL`, `settings.HSGROWTH_URL`.

- [ ] **Step 1: testes** — `test_chama_a_api_com_aud_hsgrowth` (MockTransport captura a URL `https://growthhsapi.healthsafetytech.com/api/v1/cards/5/expanded` e o token decodificado tem `aud == "hsgrowth"`, `sub` = e-mail); `test_403_na_leitura_e_na_escrita_dizem_coisas_diferentes` (GET 403 → mensagem com "ver"; POST 403 → "o HSGrowth não deixa a sua função fazer isso"); `test_409_repassa_o_detail` (detail "Este CNPJ está com o parceiro X" aparece na mensagem).
- [ ] **Step 2:** `cd backend && python -m pytest tests/test_guardi_hsgrowth.py -q` → FAIL (módulo não existe).
- [ ] **Step 3:** copiar a forma de `app/sistemas/gestorhs.py` (docstring apontando a spec; `_MSG` 401 "o seu dono não tem conta ativa no HSGrowth (ou o acesso do Guardi ainda não foi ligado lá)", 403 de leitura, 404; `_MSG_ESCRITA` com o 403 de função; 400/409/422 ficam de fora para o `detail` chegar).
- [ ] **Step 4:** pytest do arquivo → PASS.
- [ ] **Step 5:** commit `feat(guardi): cliente do HSGrowth com token de agente`.

### Task 2: Catálogo de leitura

**Files:**
- Create: `backend/app/hsgrowth_consultas.py`
- Test: `backend/tests/test_guardi_hsgrowth.py`

**Interfaces:**
- Consumes: `texto_do_retorno`, `_escalar` de `app.datacore_consultas`.
- Produces: `CONSULTAS: dict[str, tuple[str, str, tuple[str, ...]]]` (chave → caminho, descrição, filtros); `caminho_da_consulta(chave, ident) -> str`; `params_da_consulta(chave, parametros) -> list[tuple[str,str]]`; `filtrar_local(chave, dados, filtros_locais: dict) -> list|dict`; `com_links(chave, dados, base) -> ...`; `pede_id(chave) -> bool`. Mesmos nomes e semântica de `gestorhs_consultas`.

Catálogo (chave → rota; filtros entre parênteses; os marcados *local* nunca vão ao HSGrowth):

| chave | rota |
|---|---|
| `quadros` | `/boards` (`category`, fixado em `vendas`) |
| `etapas` | `/boards/{board_id}/lists` |
| `meus_cards` | `/cards` (`board_id` obrigatório, `is_won`, `is_lost`, `created_at_from/to`, `entered_at_from/to`; *local*: `etapa` (list_id), `tarefa` (`overdue`/`today`/`future`/`none`), `parados_dias`) — sempre com `assigned_to_id=<eu>` **e** `all=true`, filtrados também *localmente* por `assigned_to_id`/`sdr_id` = eu |
| `card` | `/cards/{card_id}/expanded` |
| `buscar` | `/search/global` (`q` obrigatório, `limit`) |
| `notas` | `/card-notes/card/{card_id}` |
| `minhas_tarefas` | `/card-tasks` (`is_completed`, `task_type`, `due_date_start/end`, `page`) — sempre com `assigned_to_id=<eu>` |
| `tarefas_atrasadas` | `/card-tasks/overdue` |
| `campos` | `/fields/definitions/board/{board_id}` |
| `clientes` | `/clients` (`search`) |
| `cliente` | `/clients/{client_id}` |
| `contatos` | `/persons` (`search`, `organization_id`) |
| `receita` | `/clients/cnpj/{cnpj}` (cnpj: 14 dígitos depois de tirar pontuação) |
| `parceiros_do_card` | `/cards/{card_id}/aviso-parcerias` |

"Parado": se `~/projetos/relatorios-hsgrowth/cards_parados.py` define a régua, copiá-la (dias na etapa e/ou sem tarefa pendente) e citar a origem no docstring; senão, `parados_dias` = dias desde a entrada na etapa atual ≥ N. O `<eu>` é injetado pelo router (Task 3), nunca aceito do agente: `assigned_to_id` não é filtro do catálogo.

- [ ] **Step 1: testes** — `test_catalogo_recusa_filtro_desconhecido_e_id_nao_numerico` (`ValueError` para `{"assigned_to_id": 3}`, id `"5/../users"`); `test_cnpj_da_receita_aceita_pontuacao` (`"12.345.678/0001-90"` → `/clients/cnpj/12345678000190`; 13 dígitos → `ValueError`); `test_meus_cards_filtra_etapa_tarefa_e_dono_localmente` (lista com cards de dono 3 e 9, etapas 28/29, `pending_tasks_status` misto → só os do 3 na etapa 29 com `overdue`); `test_link_do_card_e_montado_pelo_servidor` (`com_links("card", {"id": 7}, base)` → `link == base + "/cards/7"`; também em `meus_cards` e `buscar`).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** implementar no molde de `gestorhs_consultas.py` (descrições dizendo o significado dos valores — ex.: `tarefa=today`).
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** commit `feat(guardi): catálogo de leitura do HSGrowth`.

### Task 3: Leitura no `hsos-bot`

**Files:**
- Modify: `backend/app/routers/mcp_bot.py` (ferramentas perto das `gestorhs_*`, ~l.156; despacho em `executar`, ~l.1448; nova `_hsgrowth(conn, bot, nome, args, ctx)`)
- Modify: `backend/app/email/regras.py` (`FERRAMENTAS_BOT`)
- Test: `backend/tests/test_guardi_hsgrowth.py`, `backend/tests/test_mcp_bot.py` (só se já houver teste que conte ferramentas)

**Interfaces:**
- Consumes: Task 1 e Task 2.
- Produces: ferramentas `hsgrowth_consultas`, `hsgrowth_consultar` (`consulta`, `id?`, `parametros?`); `async _eu_no_hsgrowth(ctx, bot) -> dict` (GET `/users/me`, cacheado no `ctx` da chamada) — usado pelas Tasks 5–6; `_hsgrowth` recusa com `_Recusa("O HSGrowth ainda não está ligado para mim.")` sem `"hsgrowth"` em `ctx["sistemas"]`.

- [ ] **Step 1: testes** — `test_sem_hsgrowth_ligado_recusa_sem_rede` (transporte que falha se chamado); `test_meus_cards_injeta_o_eu_de_users_me` (Mock: `/users/me` → `{"id": 3}`; a requisição de `/cards` leva `assigned_to_id=3` e `all=true`; retorno começa com o marcador de dado externo e traz o link).
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** implementar; descrição de `hsgrowth_consultar`: "Lê o CRM (HSGrowth) com o login do seu dono… leitura igual à tela: abre card de colega também; escrever só nos dele". Acrescentar os dois nomes (e os da Task 5, de uma vez, para não editar duas vezes) a `FERRAMENTAS_BOT` — o `assert NOMES == FERRAMENTAS_BOT` do `mcp_bot` tranca.
- [ ] **Step 4:** `python -m pytest tests -q` → PASS (suíte inteira: o assert de nomes e o `test_mcp_bot` passam).
- [ ] **Step 5:** commit `feat(guardi): leitura do HSGrowth no hsos-bot`.

### Task 4: Regras puras de escrita

**Files:**
- Create: `backend/app/hsgrowth_escrita.py`
- Test: `backend/tests/test_guardi_hsgrowth_escrita.py`

**Interfaces:**
- Produces (todas puras, `ValueError` com mensagem para o vendedor):
  - `CAMPOS_CARD = ("title", "description", "value", "due_date", "deal_type", "modality", "acquisition_channel", "acquisition_channel_detail", "has_implementation", "has_personnel")`
  - `CAMPOS_CLIENTE = ("name", "document", "sector", "relationship_type", "employee_count", "commercial_activity")`, `CAMPOS_CONTATO = ("name", "email", "phone", "position", "area")`
  - `campos_do_card(d: dict) -> dict` — só `CAMPOS_CARD`, tipos conferidos, `modality in {"venda","locacao"}`, `value >= 0`; chave fora → `ValueError` nomeando-a.
  - `campos_personalizados(itens: list, definicoes: list[dict]) -> list[dict]` → `[{"field_definition_id": int, "value": ...}]`; definição inexistente → erro com os nomes disponíveis.
  - `nota(texto) -> str` (1..5000, aparada).
  - `tarefas(ops: list) -> list[dict]`, máx. 5, cada uma `{"op": "criar"|"alterar"|"concluir", ...}`: `criar` exige `title` e `task_type in {"call","meeting","task","follow_up","deadline","email","lunch","other"}`, `priority in {"normal","high","urgent"}`, `due_date` BRT→UTC; `concluir` exige `task_id`. **`concluir` de tarefa `meeting` é recusado** ("reunião que não aconteceu é no-show; que aconteceu, diga e eu concluo com `aconteceu: true`") — só passa com `aconteceu: true`.
  - `utc_de_brasilia(s: str) -> str` (`"2026-11-19T10:00"` → `"2026-11-19T13:00:00Z"`).
  - `conferir_dono(card: dict, eu_id: int) -> None` — recusa nomeando o dono do card (`assigned_to_name` ou id).
  - `conferir_movimento(card: dict, etapas: list[dict], para_list_id: int) -> str | None` — devolve aviso ou `None`; recusa: destino fora do quadro do card; destino ou origem com `is_done_stage`/`is_lost_stage` ("ganho/perda é por `hsgrowth_ganhar`/`hsgrowth_perder`"); no quadro 7, salto maior que uma posição entre etapas não terminais. Aviso: destino de nome "Agendado" no quadro 6 → "o HSGrowth leva o card para Reunião Agendada, na Aquisição".
  - `conferir_ganho(card) -> None` (sem `modality` → "falta dizer se é venda ou locação"; card já terminal → recusa); `motivo_da_perda(s) -> str` (1..200).
  - `conferir_noshow(tarefa: dict, card: dict) -> None` (tarefa `meeting`, não concluída, do card).
  - `cliente_alteravel(cliente_id: int, cards_abertos_do_dono: list[dict]) -> None`; `campos_do_cliente(d)`, `campos_do_contato(d)` (allowlists acima; `relationship_type` "Cliente" → outro valor recusado).
  - `digitos(doc) -> str`; `uma_linha(s, teto=80) -> str`.
  - Opções de `deal_type`, `acquisition_channel`, `sector`, `employee_count`, `relationship_type`: **copiar as listas do front do HSGrowth** (`grep -rn "Logística e Transporte\|Nova Venda\|Outbound" ~/github/hsgrowth-sistema/frontend/src`), não do banco (que tem grafias velhas como "Ate 50"); valor fora → `ValueError` listando as opções.

- [ ] **Step 1: testes** (um por regra, com docstring de custo): `test_put_nunca_leva_dono_nem_status` (`campos_do_card({"assigned_to_id": 9})`, `{"is_won": True}`, `{"shipping_cost": 1}` → `ValueError`); `test_campo_personalizado_so_por_definicao_existente`; `test_concluir_reuniao_exige_aconteceu`; `test_brasilia_vira_utc`; `test_card_de_outro_recusa_nomeando` (card `assigned_to_id=9, sdr_id=None, assigned_to_name="Sandra"`, eu=3 → mensagem com "Sandra"; `sdr_id=3` passa); `test_movimento` (terminal, outro quadro, salto de 2 no quadro 7 → erro; quadro 6 salto livre; "Agendado" → aviso); `test_ganho_sem_modalidade`; `test_motivo_da_perda_1_a_200`; `test_cliente_so_ligado_a_card_aberto_do_dono`; `test_cliente_nao_deixa_de_ser_cliente`; `test_opcao_fora_da_lista_lista_as_opcoes`; `test_texto_de_terceiro_em_uma_linha`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** commit `feat(guardi): regras de escrita do HSGrowth`.

### Task 5: Ferramentas de escrita (preparar o cartão)

**Files:**
- Modify: `backend/app/routers/mcp_bot.py` (definições + `_hsgrowth_escrita(conn, bot, nome, args, ctx)`)
- Test: `backend/tests/test_guardi_hsgrowth_escrita.py`

**Interfaces:**
- Consumes: Tasks 1, 3 (`_eu_no_hsgrowth`), 4.
- Produces — ferramenta → ação gravada (sistema `"hsgrowth"`) e `payload`:
  - `hsgrowth_registrar` → `hsgrowth_registrar`: `{card_id, campos?, campos_personalizados?, nota?, tarefas?, mover_para?, _exibir}`. É o pós-ligação: pelo menos um dos cinco. Ordem de execução fixa: campos → campos_personalizados → nota → tarefas → mover.
  - `hsgrowth_cliente` → `hsgrowth_cliente`: `{card_id, cliente?: {id, campos}, contato?: {id, campos}, _exibir: {antes, depois}}`.
  - `hsgrowth_criar_lead` → `hsgrowth_criar_lead`: `{titulo, cliente: {id} | {campos}, contato: {id} | {campos}, campos_do_card, list_id, _exibir}` — `list_id` = lista "Lead Novo" do quadro 6, achada por `/boards/6/lists`, nunca vinda do agente.
  - `hsgrowth_ganhar` → `{card_id}`; `hsgrowth_perder` → `{card_id, motivo}`; `hsgrowth_noshow` → `{card_id, task_id}`.
- Antes do cartão (só GET): `/users/me`; `/cards/{id}/expanded` + `conferir_dono` em toda ação sobre card; `/boards/{board_id}/lists` para mover/ganhar; `/fields/definitions/board/{id}` se houver campo personalizado; `/cards/{id}/aviso-parcerias` e `/clients?search=<dígitos>` no lead (cliente existente por documento → usa o `id`, cartão diz "cliente existente" e quantos cards abertos ele tem e de quem; parceiro → recusa com o nome). `card_id` pode vir por id; "o card da X" o agente resolve antes com `hsgrowth_consultar buscar` — a descrição da ferramenta manda perguntar quando vierem dois ou mais.
- `resumo` (uma linha, `uma_linha`): ex. `"HSGrowth · ACME — nota, 1 tarefa, mover para Qualificação"`. `_exibir` leva nomes (card, etapa de/para, cliente, dono, valores antigos) e o `link` do card.
- Descrições das ferramentas terminam com o `_CONFIRMA` existente e dizem: "o que falta para a etapa quem diz é o HSGrowth: se recusar, pergunte ao seu dono o que falta — nunca preencha com valor provável".

- [ ] **Step 1: testes** (MockTransport respondendo `/users/me`, `/cards/{id}/expanded`, `/boards/7/lists`, e falhando em qualquer método ≠ GET; `conn` falso que captura o `criar_pendente`): `test_registrar_grava_um_cartao_com_as_quatro_partes` (payload com `nota`, `tarefas`, `mover_para`, `campos`, nenhum POST feito); `test_card_de_outro_vendedor_recusa_antes_do_cartao`; `test_lead_com_cnpj_existente_usa_o_cliente` (search por dígitos devolve id 44 → `payload["cliente"] == {"id": 44}`); `test_lead_de_cnpj_de_parceiro_recusa`; `test_lead_vai_para_lead_novo` (`list_id` = o da lista "Lead Novo" de `/boards/6/lists`, mesmo que o agente mande outro); `test_mover_para_ganho_manda_usar_ganhar`; `test_cliente_mostra_antes_e_depois`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** implementar (os executores já existem: a Task 6 roda antes; sem stub).
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** commit `feat(guardi): preparar escritas do HSGrowth por cartão`.

> Nota de ordem: **executar a Task 6 antes da Task 5** (os executores não dependem do router; o router depende de `EXECUTORES` conter as ações).

### Task 6: Executores do clique

**Files:**
- Modify: `backend/app/acoes.py` (novos `_hsgrowth_*` e entradas em `EXECUTORES`)
- Test: `backend/tests/test_guardi_hsgrowth_escrita.py`

**Interfaces:**
- Consumes: Task 1, Task 4 (`utc_de_brasilia` já aplicado no payload; executor não recalcula).
- Produces: `EXECUTORES[("hsgrowth", <ação>)]` para as seis ações da Task 5, assinatura `async (email, bot, p, dono=None) -> str` (a das existentes). Rotas: `PUT /cards/{id}` (`campos`), `POST /cards/{id}/fields` (um por campo personalizado, `{field_definition_id, value}`), `POST /card-notes` `{card_id, content}`, `POST /card-tasks` / `PUT /card-tasks/{id}` / `PATCH /card-tasks/{id}/complete` `{is_completed: true}`, `PUT /cards/{id}/move` `{target_list_id}`, `PUT /clients/{id}`, `PUT /persons/{id}`, `POST /clients` + `POST /persons` + `POST /cards` + `POST /cards/{id}/person?person_id=` (lead), `POST /cards/{id}/win`, `POST /cards/{id}/lose` `{loss_reason}`, `PATCH /card-tasks/{id}/noshow`.
- Corpo enviado = só as chaves das allowlists da Task 4, relidas do payload (nunca `**p`).
- Lote (`registrar`, `criar_lead`): **para no primeiro erro e não desfaz**; o `ErroSistema` levantado diz "Parou em <passo> (<n> de <m>): <mensagem>. Já entrou: <lista>." Recusa do `move` com "proposta" no texto ganha "— anexe a proposta no card pela tela: <link>". Timeout (`status 0`) mantém o "não sei se foi feito".
- Retorno de sucesso: o que entrou + link do card (+ aviso do "Agendado", se veio no `_exibir`).

- [ ] **Step 1: testes** (MockTransport registrando a sequência): `test_registrar_executa_na_ordem` (PUT → POST fields → POST note → POST task → PUT move); `test_corpo_do_put_sai_da_allowlist` (payload adulterado com `assigned_to_id` não chega ao HSGrowth); `test_lote_para_e_diz_o_que_entrou` (move devolve 400 "Necessário anexo de proposta" → erro com "Parou em mover (5 de 5)", "Já entrou: nota, tarefa…" e o link); `test_lead_cria_cliente_contato_card_e_liga` (ordem e ids encadeados); `test_lead_409_de_parceiro_repassa_e_manda_falar_com_o_gerente`; `test_timeout_no_meio_diz_que_nao_sabe`; `test_perder_envia_motivo` e `test_noshow_usa_a_rota_propria`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** pytest → PASS.
- [ ] **Step 5:** commit `feat(guardi): executores das escritas do HSGrowth`.

### Task 7: Cartão no front

**Files:**
- Modify: `frontend/src/lib/acoes.ts` (`SISTEMA` += `hsgrowth: "HSGrowth"`; `cartaoDoHSGrowth(acao, p, ex)` chamada em `cartaoDaAcao` antes do fallback, como `cartaoDoGestorHS`)
- Test: `frontend/src/lib/acoes.test.ts`

**Interfaces:**
- Consumes: payloads e `_exibir` da Task 5.
- Produces: um `CartaoDaAcao` por ação. `hsgrowth_registrar`: verbo "Atualizar card", título = card; linhas por campo (rótulo legível), "Mover para" (com o aviso do Agendado se houver), uma linha por tarefa ("Nova tarefa: Ligação · 19/11 10:00", "Concluir: …"); `texto` = nota. `hsgrowth_cliente`: linhas "Campo: antes → depois". `hsgrowth_criar_lead`: "Novo lead", cliente (novo/existente), contato, campos. Ganhar/perder/no-show: verbo explícito ("Marcar como GANHO", "Marcar como PERDIDO" + motivo, "Cliente não compareceu").
- Valores vêm do `payload` (o que executa); `_exibir` só dá nomes. Datas UTC exibidas em horário de Brasília.

- [ ] **Step 1: testes** — `cartão do registrar mostra as quatro partes`, `perder mostra o motivo`, `cliente mostra antes e depois`, `data da tarefa sai em horário de Brasília` (`"2026-11-19T13:00:00Z"` → `19/11/2026 10:00`).
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/acoes.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** vitest do arquivo → PASS; `npm run lint` sem erro novo.
- [ ] **Step 5:** commit `feat(guardi): cartão das ações do HSGrowth`.

### Task 8: Ligar para os vendedores e ponteiro no `AGENTS.md`

**Files:**
- Modify: `backend/scripts/publicar-bots-mcp.py` (`_ROTULO["hsgrowth"]`; `--ligar-sistema` aceita `hsgrowth` (~l.229); nova `--ligar-hsgrowth-vendedores`)
- Modify: `backend/app/bots_pessoais.py` (bloco de ferramentas do `AGENTS.md`)
- Test: `backend/tests/test_guardi_hsgrowth.py`, teste existente do template (procurar `arquivos_do_bot` em `tests/`)

**Interfaces:**
- Produces: `_ligar_quem_tem_conta(conn, sistema, modulo, caminho_eu, aplicar, aceita=None)` — novo parâmetro `aceita: Callable[[dict], bool] | None` aplicado à resposta do "eu" (o DocsHS/GestorHS seguem passando `None`). `_ligar_hsgrowth_vendedores` chama com `"/users/me"` e `aceita=lambda eu: eu.get("role") == "salesperson"`; quem tem conta mas outra função é listado como "com conta, fora desta fase (<role>)".
- Ponteiro no `AGENTS.md` (≤ 6 linhas): "Funil, leads, cards, tarefas e notas do CRM (HSGrowth): começo por `hsgrowth_consultas`; leio como {primeiro}. Toda alteração vira cartão; o pós-ligação (nota + tarefa + etapa) vai num `hsgrowth_registrar` só. O que a etapa exige quem diz é o HSGrowth — se recusar, pergunto o que falta, nunca chuto. Reunião que não aconteceu é `hsgrowth_noshow`."

- [ ] **Step 1: testes** — `test_ligar_vendedores_so_liga_salesperson` (função `aceita` aplicada sobre três respostas falsas); teste do template: `AGENTS.md` contém `hsgrowth_consultas` e `hsgrowth_noshow` e continua abaixo de `TETO_ARQUIVO_AGENTE` com o bloco `hsos:empresa` de 4.000 caracteres anexado.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** `python -m pytest tests -q` → PASS (suíte inteira).
- [ ] **Step 5:** commit `feat(guardi): ligar HSGrowth para os vendedores`.

### Task 9: Documentação e changelog

**Files:**
- Modify: `CLAUDE.md` (novo item "HSGrowth (12/11/2026, vendedor)" na seção "Bot pessoal nos sistemas internos", no estilo dos do GestorHS: ferramentas, as duas envs, `/users/me`, ligar só `salesperson`, allowlist dos dois lados, pré-requisito do lado de lá, ordem de produção)
- Modify: `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-vendas-design.md` (`/auth/me` → `/users/me`; tabela de escrita com os nomes finais das ferramentas)
- Modify: `frontend/src/data/changelog.ts` (entrada no TOPO, versão minor nova, `novidade`: "O Guardi dos vendedores agora trabalha no CRM: consulta o funil e prepara lead, notas, tarefas e mudança de etapa para você confirmar.")
- Modify: `backend/.env.example` (`HSGROWTH_API_URL`, `HSGROWTH_URL`)

- [ ] **Step 1:** editar os quatro arquivos.
- [ ] **Step 2:** `cd frontend && npx vitest run src/test/novidades.test.ts` → PASS; `cd backend && python -m pytest tests -q` → PASS.
- [ ] **Step 3:** commit `docs: Guardi no HSGrowth (vendedor)`.
- [ ] **Step 4:** montar o prompt para a sessão do `hsgrowth-sistema` = seção "Para o HSGrowth" da spec (com `/users/me` e a lista final de rotas) e copiar com `wl-copy`.

## Fora deste plano (produção, depois do merge)

Deploy do HSGrowth com o token de agente → envs no EasyPanel do HS.OS → deploy do HS.OS (fim do dia) → `publicar-bots-mcp.py` (ensaio, depois `--aplicar`) → `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos` → piloto no `erick-bot` (`--ligar-sistema erick-bot hsgrowth`; leitura + cartões cancelados) → `--ligar-hsgrowth-vendedores` (ensaio, depois `--aplicar`) → primeira escrita real acompanhada com um vendedor.
