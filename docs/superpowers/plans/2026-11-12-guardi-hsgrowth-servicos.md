# Guardi no HSGrowth — Serviços (fase 2): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Guardi de quem é `service` no HSGrowth lê os quadros de Serviços e Cobrança e prepara, por cartão, o pós-contato (business_info, cliente/contato, atividades, anotação, etapa), itens do card, ganho, perda e o anexo da proposta do GestorHS.

**Architecture:** reaproveita a fase 1 (cliente `app/sistemas/hsgrowth.py`, token `aud=hsgrowth`, `acoes.criar_pendente`, `_hsg_lote` de `app/acoes.py`). Código NOVO em módulos próprios, para não engordar `routers/mcp_bot.py` (já ~1.900 linhas): catálogo `app/hsgrowth_servicos_consultas.py`, regras puras `app/hsgrowth_servicos_escrita.py`, preparo `app/hsgrowth_servicos_preparo.py` (levanta `ValueError`, que o `executar` do `mcp_bot` já traduz), executores em `app/acoes.py`. O `mcp_bot` só declara as ferramentas e despacha.

**Tech Stack:** FastAPI, httpx, pytest; React + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-guardi-hsgrowth-servicos-design.md`

## Global Constraints

- Sistema em `sistemas_ligados` e em `acoes_pendentes`: **`hsgrowth_servicos`**. Ferramentas e ações com prefixo **`hsgrowth_servicos_`**. Sem `hsgrowth_servicos` ligado, toda ferramenta recusa antes da rede: "O HSGrowth (Serviços) ainda não está ligado para mim."
- Só quadros **1 (Serviços)** e **2 (Serviço - Cobrança)**; outro `board_id` → recusa.
- Link de card: `settings.HSGROWTH_URL + f"/servicos/{board}/cards/{card}"`, sempre do servidor (sobrescreve).
- Sem dono no card: **não** há conferência de dono; qualquer `service` escreve em qualquer card dos quadros 1 e 2 (decisão da spec).
- `PUT /service-boards/{b}/cards/{c}` só leva `business_info`, `client_id`, `person_id`, `title`, `description`, `due_date`, `contact_info` — nunca `list_id`, `position`, `is_deleted`, `assigned_to_id`. Mover só por `PUT …/move` `{list_id}`.
- `business_info`: só as chaves `collection_type`, `service_type`, `acquisition_channel`, `form_answered`, `closing_type`, `proposal_number`, `order_number`, `from_collection`, `shipping_confirmed`, com as opções da tela (`ServiceCardDetails.tsx:300-395` no `~/github/hsgrowth-sistema/frontend`, ler; copiar, citando a origem). **Mesclado no clique**: o executor relê o card, aplica só as chaves do cartão e grava o dicionário inteiro.
- Mover: uma etapa (à frente ou atrás) entre etapas não terminais, conferido do nosso lado para todo mundo (inclusive admin). O payload guarda `de_list_id` e `para_list_id`; o executor relê e **recusa se a etapa atual ≠ `de_list_id`** ("alguém mexeu no card desde o cartão — peça de novo").
- Concluir atividade exige `valida: bool` (envia `is_valid`).
- Toda escrita é cartão; o executor monta o corpo de allowlist (nunca `**p`); lote para e não desfaz (`_hsg_lote`).
- Texto do HSGrowth/GestorHS no cartão passa por `uma_linha` (`app/hsgrowth_escrita.py`).
- Português; testes com docstring de custo; `MockTransport`.

## Review Focus

1. **Card mudou de etapa entre o cartão e o clique** (quadro compartilhado): o executor recusa antes de qualquer escrita. Teste na Task 3.
2. **`business_info` gravado por outra pessoa entre o cartão e o clique**: a chave alheia sobrevive (mescla na hora). Teste na Task 3.
3. **Ganho fora da última etapa ativa / sem requisito**: recusa antes do cartão dizendo o que falta. Teste na Task 2.
4. **Item de produto/serviço de outro card** num alterar/tirar: recusa antes do cartão. Teste na Task 4.
5. **`link_pdf` apontando para host que não é o GestorHS** (payload adulterado ou resposta estranha): o executor não baixa. Teste na Task 3.

---

### Task 1: Leitura de Serviços

**Files:**
- Create: `backend/app/hsgrowth_servicos_consultas.py`
- Modify: `backend/app/routers/mcp_bot.py` (duas ferramentas + despacho `nome.startswith("hsgrowth_servicos_")` ANTES do `hsgrowth_`), `backend/app/email/regras.py` (`FERRAMENTAS_BOT`, mesma ordem de `FERRAMENTAS`)
- Test: `backend/tests/test_guardi_hsgrowth_servicos.py`

**Interfaces:**
- Consumes: `hsgrowth.chamar`, `hsgrowth_consultas.texto_do_retorno`, `_eu_no_hsgrowth` do `mcp_bot`.
- Produces: `CONSULTAS`, `caminho_da_consulta(chave, ident, board_id=None)`, `params_da_consulta(chave, parametros) -> (remotos, locais)`, `filtrar_local(chave, dados, locais, eu_id)`, `com_links(chave, dados, base, board_id)`, `pede_eu(chave)`, `QUADROS = (1, 2)`; ferramentas `hsgrowth_servicos_consultas`, `hsgrowth_servicos_consultar` (`consulta`, `board_id?`, `id?`, `parametros?`).

Catálogo: `quadros` (`/service-boards`, só 1 e 2 no retorno), `etapas` (`/service-boards/{b}/lists`), `cards` (`/service-boards/{b}/cards`, páginas de 500 até no máximo 4; filtros locais `etapa`, `pendencia` ∈ overdue/today/future/none, `parado` ∈ 3d/7d, `cobranca` ∈ a_vencer/atrasados, `colaborador=eu` — `collaborators` contém o eu), `card` (`/service-boards/{b}/cards/{c}` + `/products` + `/services`, montado num objeto só), `atividades` (`…/cards/{c}/activities`), `pendencias` (`/service-activities?status=pending`; local `minhas=true` → `user_id == eu`), `buscar` (`/search/global`, devolve só a parte de serviço), `catalogo_aparelhos` (`/service-products?search=`), `catalogo_servicos` (`/services`), `painel` (`/service-dashboard`, `start`/`end` AAAA-MM-DD, `board`), `clientes`/`contatos` (`/clients?search=`, `/persons?search=`). Ler os formatos em `~/github/hsgrowth-sistema/backend/app/schemas/service_board.py` e `service_dashboard.py`. Filtro local que encontra formato inesperado levanta `ValueError("resposta inesperada do HSGrowth")`.

- [ ] **Step 1: testes** — `test_sem_servicos_ligado_recusa_sem_rede`; `test_quadro_fora_de_1_e_2_recusa`; `test_cards_filtra_etapa_pendencia_parado_cobranca_localmente`; `test_cards_le_ate_quatro_paginas` (Mock com 5 páginas de 500 → 4 pedidas, aviso de corte no texto); `test_pendencias_minhas_corta_pelo_eu`; `test_link_do_card_de_servico_e_do_servidor` (`/servicos/2/cards/7`, sobrescreve `link` de fora); `test_buscar_devolve_so_servico`; `test_card_junta_produtos_e_servicos`.
- [ ] **Step 2:** pytest do arquivo → FAIL.
- [ ] **Step 3:** implementar no molde de `hsgrowth_consultas.py`.
- [ ] **Step 4:** suíte inteira → PASS.
- [ ] **Step 5:** commit `feat(guardi): leitura de Serviços do HSGrowth`.

### Task 2: Regras puras de escrita de Serviços

**Files:**
- Create: `backend/app/hsgrowth_servicos_escrita.py`
- Test: `backend/tests/test_guardi_hsgrowth_servicos_escrita.py`

**Interfaces:**
- Consumes: `uma_linha`, `_texto`, `_inteiro`, `utc_de_brasilia`, `digitos` de `app.hsgrowth_escrita`.
- Produces (puras, `ValueError` legível):
  - `CHAVES_NEGOCIO` + opções (copiadas da tela, com a origem citada); `negocio(d: dict) -> dict` (só chaves conhecidas, valores das opções, `proposal_number`/`order_number` inteiros > 0, `form_answered` bool).
  - `CAMPOS_PUT = ("title", "description", "due_date", "contact_info", "client_id", "person_id")`; `campos_do_card(d) -> dict` (`due_date` BRT→UTC; ids inteiros).
  - `atividades(ops, pendentes: dict[int, dict]) -> list[dict]`, máx. 5: `criar` (`category` ∈ atividade/anotacao; `activity_type` ∈ call/task/follow_up/email/whatsapp/other — conferir a lista real em `ServiceCardDetails.tsx`; `title`; `priority` ∈ normal/high/urgent; `due_date`), `concluir` (`activity_id` pendente do card + `valida: bool`).
  - `conferir_movimento(card, etapas, para_list_id) -> dict` → `{"de": int, "para": int}`; recusa: destino terminal (ganho/perda têm ferramenta), fora do quadro, mesmo lugar, salto > 1 entre não terminais, origem terminal ou desconhecida. Terminal = flag **ou** nome com "ganho"/"perdido" (como lá).
  - `conferir_ganho(card, etapas, negocio_atual) -> dict` (`{"de", "para"}` com a lista de ganho): quadro 1 — origem Aguardando Pedido com `order_number`, ou Proposta com `closing_type = faturamento_direto`; sempre `proposal_number` e `from_collection`; quadro 2 — origem Operações e `shipping_confirmed = sim`. Mensagem nomeia o que falta.
  - `MOTIVOS_PERDA` (de `blueprintOptions.ts:194-214`, sem "Unificado em outro card", que é do sistema); `motivo_da_perda(s) -> str`.
  - `item(op, catalogo_ids: set[int], itens_do_card: dict[int, dict]) -> dict` (`tipo` ∈ aparelho/servico; `acao` ∈ por/alterar/tirar; `por` exige id do catálogo, quantidade/preço conforme o schema de lá; `alterar`/`tirar` exigem item que é do card).
  - `mesmo_cliente(doc_card, doc_proposta) -> bool | None` (dígitos; `None` se faltar um).

- [ ] **Step 1: testes** — um por regra (opção fora da lista lista as opções; `list_id`/`is_deleted` recusados no PUT; concluir sem `valida`; concluir atividade de outro card; movimento terminal/salto/origem desconhecida; terminal por nome; ganho quadro 1 nos dois caminhos e quadro 2; motivo fora da lista; item de outro card; mesmo cliente com/sem documento; texto em uma linha).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(guardi): regras de escrita de Serviços do HSGrowth`.

### Task 3: Executores e envio de arquivo

**Files:**
- Modify: `backend/app/sistemas/hsgrowth.py` (`enviar_arquivo`), `backend/app/acoes.py` (executores + `EXECUTORES`)
- Test: `backend/tests/test_guardi_hsgrowth_servicos_executores.py`

**Interfaces:**
- Produces: `async hsgrowth.enviar_arquivo(email, bot, caminho, nome: str, conteudo: bytes, mime: str, params=None, dono=None) -> Any` (multipart `file`, mesmas mensagens de erro de escrita e auditoria do `chamar_sistema` — reaproveitar o miolo; se precisar mexer em `app/sistemas/taskhs.py`, o mínimo, sem mudar o comportamento atual).
- `EXECUTORES[("hsgrowth_servicos", a)]` para `hsgrowth_servicos_registrar`, `_itens`, `_ganhar`, `_perder`, `_anexar_proposta`. Contrato de payload (comentário em bloco acima dos executores, para a Task 4):
  - `registrar`: `{board_id, card_id, negocio?: dict, campos?: dict, atividades?: [ops], mover?: {de, para}, _exibir}`. Ordem: (reler card; se `mover`, conferir etapa atual == `de` antes de tudo) → `PUT` com `campos` + `business_info` = card relido ∪ `negocio` → atividades (`POST …/activities`, `PATCH …/activities/{a}/complete {is_completed: true, is_valid: valida}`) → `PUT …/move {list_id: para}`.
  - `itens`: `{board_id, card_id, ops: [{tipo, acao, item_id?, catalogo_id?, campos}], _exibir}` → `POST`/`PUT`/`DELETE …/products|services[/{i}]` (corpo pelos schemas de lá).
  - `ganhar`: `{board_id, card_id, de, para, _exibir}`; reler e conferir `de`; `PUT …/move`.
  - `perder`: `{board_id, card_id, de, para, motivo, _exibir}`; reler e conferir `de`; `POST …/activities {category: "anotacao", description: "Motivo da perda: <motivo>"}`; `PUT …/move`.
  - `anexar_proposta`: `{board_id, card_id, numero, link_pdf, nome_arquivo, _exibir}`; baixar `link_pdf` **só se o host for o de `settings.GESTORHS_API_URL` ou `settings.GESTORHS_URL`** (https, sem redirect para outro host), teto 10 MB, `content-type` PDF; `POST …/activities/files?slot=proposta`.
- Passos do lote nomeados: `campos`, `atividade`, `mover`, `aparelho`, `servico`, `anotacao`, `arquivo`. Sucesso cita o link do card (`_exibir.link`).

- [ ] **Step 1: testes** — `test_registrar_recusa_se_a_etapa_mudou` (nada é escrito); `test_negocio_mescla_com_o_que_outro_gravou` (card relido com chave X alheia → PUT leva X e as do cartão); `test_put_sai_da_allowlist` (payload com `list_id`/`is_deleted` não chega); `test_ordem_campos_atividades_mover`; `test_concluir_envia_valida`; `test_perder_anota_motivo_e_move`; `test_ganhar_confere_etapa`; `test_anexar_recusa_host_de_fora` e `test_anexar_recusa_mais_de_10mb`; `test_anexar_envia_multipart_no_slot_proposta`; `test_lote_para_e_diz_o_que_entrou`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** suíte → PASS.
- [ ] **Step 5:** commit `feat(guardi): executores de Serviços do HSGrowth`.

### Task 4: Preparo (ferramentas de escrita)

**Files:**
- Create: `backend/app/hsgrowth_servicos_preparo.py`
- Modify: `backend/app/routers/mcp_bot.py` (cinco ferramentas, despacho), `backend/app/email/regras.py`
- Test: `backend/tests/test_guardi_hsgrowth_servicos_preparar.py`

**Interfaces:**
- Consumes: Tasks 1–3; `gestorhs.chamar` + `gestorhs_consultas` para a proposta (`GET /propostas?q=<numero>` → `numero`, destinatário com documento, `valor`/total, `link_pdf`).
- Produces: `async preparar(ctx, bot, nome, args) -> tuple[dict, str]` (payload, resumo) para as cinco ações; o `mcp_bot` grava com `acoes.criar_pendente(conn, ctx["dono"], bot, "hsgrowth_servicos", nome, payload, resumo)` e responde como o `_hsgrowth_escrita` da fase 1.
- Antes do cartão (só GET): card, etapas, atividades pendentes (para `concluir`), catálogo e itens do card (para `itens`), cliente/contato existentes (para `client_id`/`person_id`: `GET /clients/{id}`, `/persons/{id}`; contato tem de ser do cliente), proposta no GestorHS quando há `proposal_number` novo e `gestorhs` ligado (aviso: não achada, outro cliente — por `mesmo_cliente` — valor), atividades do card com `doc_slot = proposta` (para avisar a substituição no `anexar_proposta`).
- `_exibir` leva nomes e "antes" (`business_info` antes → depois por chave; etapa de → para; cliente/contato nomes; itens com nome do catálogo); valores executados só no payload. Ganho: `_exibir.aviso = "Se este card veio do GestorHS, o ganho avisa o GestorHS e a caixa vai para o Financeiro."`.
- Descrições das ferramentas: português, como as da fase 1; dizem para perguntar ao dono o que falta quando o HSGrowth recusar, perguntar se a atividade foi realizada, e nunca escolher card quando a busca vier com mais de um.

- [ ] **Step 1: testes** (transporte que falha em qualquer método ≠ GET): `test_registrar_grava_um_cartao` (payload com `mover.de/para`, `negocio`, atividades); `test_quadro_fora_recusa`; `test_movimento_salto_recusa_antes`; `test_ganho_fora_da_ultima_etapa_recusa_nomeando`; `test_proposta_de_outro_cliente_vira_aviso` e `test_sem_documento_nao_avisa`; `test_itens_de_outro_card_recusa`; `test_anexar_sem_gestorhs_ligado_recusa`; `test_anexar_avisa_que_substitui`; `test_texto_de_fora_em_uma_linha`; **ida e volta** pelos executores reais da Task 3 para `registrar`, `perder` e `anexar_proposta`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** suíte → PASS.
- [ ] **Step 5:** commit `feat(guardi): preparar escritas de Serviços do HSGrowth`.

### Task 5: Cartão no front

**Files:**
- Modify: `frontend/src/lib/acoes.ts` (`SISTEMA.hsgrowth_servicos = "HSGrowth"`; `cartaoDoHSGrowthServicos(acao, p, ex)` chamado antes do fallback), `frontend/src/lib/acoes.test.ts`

**Interfaces:** consome os payloads e `_exibir` da Task 4 (contrato no comentário dos executores). Valores do payload; nomes do `_exibir`; datas UTC em horário de Brasília (`dataBrasilia`); `business_info` como "Chave: antes → depois" com rótulos em português; atividade com tipo, título, prazo e, no concluir, "realizada"/"tentativa sem resultado"; mover "Etapa: de → para"; ganho com o aviso em destaque ("Atenção"); perder com o motivo; anexo com o número da proposta e "substitui <arquivo>" quando houver.

- [ ] **Step 1: testes** — um por ação, mais "valores do payload, não do `_exibir`" (forjado no `_exibir` não aparece).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** vitest do arquivo + eslint dos dois arquivos → PASS.
- [ ] **Step 5:** commit `feat(guardi): cartão das ações de Serviços do HSGrowth`.

### Task 6: Ligar para Serviços e ponteiro no `AGENTS.md`

**Files:**
- Modify: `backend/scripts/publicar-bots-mcp.py` (`--ligar-sistema` aceita `hsgrowth_servicos`; `_ROTULO`; `--ligar-hsgrowth-servicos` = `_ligar_quem_tem_conta(..., "hsgrowth_servicos", hsgrowth, "/users/me", aplicar, aceita=role == "service")`), `backend/app/bots_pessoais.py` (ponteiro)
- Test: `backend/tests/test_guardi_hsgrowth_servicos.py` e o teste do template

**Interfaces:** ponteiro ≤ 7 linhas: "Quadros de Serviços e Cobrança do CRM (HSGrowth): começo por `hsgrowth_servicos_consultas`. Pós-contato num `hsgrowth_servicos_registrar`; aparelhos e serviços do card em `hsgrowth_servicos_itens`; a proposta do GestorHS entra no card com `hsgrowth_servicos_anexar_proposta`. Toda alteração vira cartão; concluir atividade pede se foi realizada; o que a etapa exige quem diz é o HSGrowth." Medir com `hsos:empresa` de 4.000 contra `TETO_ARQUIVO_AGENTE`.

- [ ] **Step 1: testes** — `test_ligar_servicos_so_liga_service` (com o `aceita` REAL do script, não lambda); template com o ponteiro e dentro do teto.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** suíte → PASS.
- [ ] **Step 5:** commit `feat(guardi): ligar Serviços do HSGrowth`.

### Task 7: Documentação e changelog

**Files:** `CLAUDE.md` (item "HSGrowth — Serviços (12/11/2026)" logo depois do de Vendas: ferramentas, sistema `hsgrowth_servicos`, sem dono/colaborativo, mover com conferência de origem, mescla do `business_info`, ganho avisa o GestorHS, anexo da proposta com allowlist de host, pré-requisito do lado de lá); a spec (nomes finais, se mudaram); `frontend/src/data/changelog.ts` (entrada no TOPO, versão minor seguinte à primeira, `2026-11-12`, `novidade`: "O Guardi de Serviços agora trabalha no CRM: consulta os quadros de Serviços e Cobrança e prepara o registro do contato, a mudança de etapa e o anexo da proposta para você confirmar.").

- [ ] **Step 1:** editar. **Step 2:** `npx vitest run src/test/novidades.test.ts` e a suíte do backend → PASS. **Step 3:** commit `docs: Guardi no HSGrowth (Serviços)`.

## Fora deste plano

O lado do HSGrowth (seção "Para o HSGrowth" da spec, que soma à da fase 1) e a produção, na mesma ordem da fase 1, com `--ligar-hsgrowth-servicos` no fim.
