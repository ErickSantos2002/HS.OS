# Guardi no GestorHS, fase 2c (propostas): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Guardi prepara, por cartão, criar e alterar proposta no GestorHS pelo padrão da casa, com lembretes do que fugiu do padrão.

**Architecture:** mesmo trilho da 2a e da 2b. Regras puras (padrão, total, lembretes, diff de alteração) num módulo novo, `app/gestorhs_propostas.py`, para não inchar o `gestorhs_escrita.py`. Ferramentas em `routers/mcp_bot.py`, executores em `app/acoes.py`, cartão em `frontend/src/lib/acoes.ts`. O padrão vem do GestorHS, por `GET /propostas/padrao`, e nunca é copiado para cá.

**Tech Stack:** FastAPI, httpx MockTransport, pytest, `Decimal`; Vitest.

**Spec:** `docs/superpowers/specs/2026-11-12-guardi-gestorhs-propostas-design.md`

## Global Constraints

- **Contrato de `GET /propostas/padrao?modelos=<a, b>&series=<x, y>`** (pedido ao GestorHS no mesmo prompt; os testes usam um falso com este formato):
  `{"observacoes": str, "validade_dias": 30, "frete_por_regiao": {"Norte": 200, "Nordeste": 150, "Sul": 250, "Sudeste": 200, "Centro-Oeste": 200}, "regiao_por_uf": {"PE": "Nordeste", ...}, "outros_itens": {"padrao": html, "phoebus": html}}`
- Ações `("gestorhs", "criar_proposta")` e `("gestorhs", "alterar_proposta")`; ferramentas `gestorhs_criar_proposta` e `gestorhs_alterar_proposta`. Cartão sempre; o executor usa só o `payload`; o corpo é montado por lista fixa de chaves.
- `destinatario` no POST: **só** `{"tipo": "cliente"|"empresa", "id": int}`. No PUT: nunca.
- Total = soma(quantidade × preço) + frete − desconto, em `Decimal`, 2 casas (igual ao `montar_saida` do GestorHS).
- Modelo Phoebus quando algum item tiver "PHOEBUS" na descrição do catálogo (sem diferenciar maiúscula). Nesse modelo o frete é 0; no padrão, o frete vem de `frete_por_regiao[regiao_por_uf[UF do cliente]]`.
- `outros_itens` só do padrão (`padrao` ou `phoebus`). O agente nunca manda texto livre nesse campo.
- Tetos: itens de 1 a 30; quantidade > 0 e ≤ 999; preço ≥ 0; desconto e frete ≥ 0; `condicao_pagamento` ≤ 100; `contato`, `intro`, `descricao_entrega` ≤ 500; `observacoes` ≤ 2000.
- Baseline: backend 1285 (com `EMAIL_CHAVE_CIFRA` de teste). Changelog `2.8.0` (novidade), `2026-11-12`, no topo.

## Review Focus

1. Alterar removendo um aparelho manda a lista **inteira** restante, e nunca só o removido (Task 3).
2. Item falado ("calibração") que casa com dois itens do catálogo: o agente pergunta, e a ferramenta recusa um `sku` inexistente em vez de chutar (Task 2).
3. Cliente sem UF no cadastro: o frete vira lembrete "estado desconhecido", sem chutar a região (Task 1).
4. Proposta faturada ou desabilitada: a alteração é recusada antes do cartão (Task 3).
5. Texto `outros_itens` editado à mão na tela: a alteração não sobrescreve e põe o lembrete (Task 1 e Task 3).

---

### Task 1: Regras puras da proposta

**Files:** Create `backend/app/gestorhs_propostas.py`; Test `backend/tests/test_guardi_gestorhs_propostas.py`

**Interfaces (Produces):**
- `itens_do_pedido(args_itens: list[dict], catalogo: list[dict]) -> list[dict]`. Cada item do agente é `{sku, quantidade, preco?}`; o `sku` precisa existir no catálogo (serviços + produtos, `{sku, nome, preco, unidade}`). Devolve `{"descricao": nome, "sku", "quantidade", "unidade", "preco_un", "preco_catalogo"}`.
- `eh_phoebus(itens) -> bool`
- `frete_padrao(padrao: dict, uf: str | None, phoebus: bool) -> Decimal | None` (`None` = estado desconhecido)
- `total(itens, frete, desconto) -> Decimal`
- `outros_itens_padrao(padrao: dict, phoebus: bool) -> str`
- `texto_ainda_e_do_modelo(atual: str, padrao_antigo: dict) -> bool`. Compara depois de normalizar `&nbsp;`, espaços e tags vazias; aceita qualquer um dos dois modelos.
- `lembretes(*, itens, frete, frete_tabela, uf, desconto, pagamento, pagamento_ultima, aparelhos_na_proposta, frota_vencendo, phoebus, outros_itens, entrega_diferente) -> list[str]`

- [ ] **Step 1: Testes**

```python
PADRAO = {"observacoes": "Caso…", "validade_dias": 30,
          "frete_por_regiao": {"Norte": 200, "Nordeste": 150, "Sul": 250, "Sudeste": 200, "Centro-Oeste": 200},
          "regiao_por_uf": {"PE": "Nordeste", "SP": "Sudeste"},
          "outros_itens": {"padrao": "<p>Serviços&nbsp;de Calibração</p>", "phoebus": "<p>PHOEBUS</p>"}}
CAT = [{"sku": "312", "nome": "CALIBRAÇÃO COM GÁS RASTREADO 2025", "preco": 395, "unidade": "UN"},
       {"sku": "306", "nome": "CALIBRAÇÃO COM GÁS RASTREADO - MÓDULO PHOEBUS 2025 (1)", "preco": 625.4, "unidade": "UN"}]

def test_item_so_do_catalogo_e_preco_do_catalogo():
    """Item inventado pelo modelo iria ao PDF do cliente com nome e preço de ninguém."""
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 3}], CAT)
    assert it[0]["preco_un"] == 395 and it[0]["descricao"].startswith("CALIBRAÇÃO")
    with pytest.raises(ValueError):
        gp.itens_do_pedido([{"sku": "999", "quantidade": 1}], CAT)
    with pytest.raises(ValueError):
        gp.itens_do_pedido([{"sku": "312", "quantidade": 0}], CAT)

def test_frete_pela_regiao_e_zero_no_phoebus():
    assert gp.frete_padrao(PADRAO, "PE", False) == Decimal("150")
    assert gp.frete_padrao(PADRAO, "SP", True) == Decimal("0")
    assert gp.frete_padrao(PADRAO, None, False) is None

def test_total_igual_ao_do_gestorhs():
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 3}], CAT)
    assert gp.total(it, Decimal("150"), Decimal("0")) == Decimal("1335.00")

def test_lembretes_do_que_fugiu_do_padrao():
    it = gp.itens_do_pedido([{"sku": "312", "quantidade": 1, "preco": 350}], CAT)
    l = gp.lembretes(itens=it, frete=Decimal("0"), frete_tabela=Decimal("150"), uf="PE",
                     desconto=Decimal("10"), pagamento="60 dias", pagamento_ultima="30 dias",
                     aparelhos_na_proposta=[1], frota_vencendo=[{"id": 2, "serie": "F2"}],
                     phoebus=False, outros_itens="", entrega_diferente=True)
    t = " | ".join(l)
    for trecho in ("catálogo", "retira", "desconto", "30 dias", "F2", "entrega"):
        assert trecho in t

def test_texto_editado_na_tela_nao_e_do_modelo():
    assert gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p>", PADRAO)
    assert not gp.texto_ainda_e_do_modelo("<p>Serviços de Calibração</p><p>combinado com o João</p>", PADRAO)
```

- [ ] **Step 2: Ver falhar.** `cd backend && .venv/bin/python -m pytest tests/test_guardi_gestorhs_propostas.py -q`
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Ver passar.**
- [ ] **Step 5: Commit** `feat(guardi): regras da proposta do GestorHS`.

---

### Task 2: Criar proposta (ferramenta, executor, cartão)

**Files:** Modify `backend/app/routers/mcp_bot.py`, `backend/app/acoes.py`, `backend/app/email/regras.py`, `frontend/src/lib/acoes.ts`, `frontend/src/lib/acoes.test.ts`; Test `backend/tests/test_guardi_gestorhs_propostas.py`

**Interfaces:**
- Argumentos de `gestorhs_criar_proposta`: `{destinatario: {tipo: "cliente"|"empresa", id}, itens: [{sku, quantidade, preco?}], aparelhos?: [id da frota], desconto?, frete?, condicao_pagamento?, contato?, intro?, data_entrega?, descricao_entrega?, endereco_entrega?: {cep, endereco, numero, complemento, bairro, municipio, estado}}`. O `sku` vem do catálogo, que o agente consulta por `gestorhs_consultar` (acrescentar ao catálogo da fase 1 as consultas `servicos` → `/servicos` e `produtos` → `/produtos`, com o filtro `q`).
- Leituras antes do cartão: `/clientes/{id}` (UF), `/servicos` + `/produtos`, os aparelhos (`/equipamentos-cliente/{id}`, conferindo que são do mesmo cliente), `/equipamentos-cliente?cliente=&status=vencendo` e `status=vencido` (para o lembrete), `/propostas?q=<nome do cliente>&page_size=5` (a última do mesmo destinatário) e `/propostas/padrao?modelos=&series=`.
- `payload`: o corpo do POST já montado (padrão + pedido) mais `_exibir {cliente, uf, itens:[{descricao, quantidade, preco_un, total, fora_do_catalogo}], aparelhos:[{modelo, serie}], frete, desconto, total, validade, pagamento, lembretes:[...], modelo: "padrão"|"Phoebus"}`. Resumo: `"Nova proposta para <cliente>: <n> itens, R$ <total>"`.
- Executor: POST `/propostas`, corpo por lista fixa (`itens`, `aparelhos` como `[{"equipamento_cliente": id}]`, `destinatario`, `desconto`, `frete`, `condicao_pagamento`, `contato`, `intro`, `outros_itens`, `observacoes`, `validade_dias`, `data_entrega`, `descricao_entrega`, `endereco_entrega_diferente`, `endereco_entrega`). Retorno: `"Proposta <numero> criada. PDF: <link_pdf>"`.
- Descrição para o agente: conte o pedido; ache o cliente (`clientes q=`) e pergunte se vier mais de um; case cada serviço com o catálogo e pergunte se ficar ambíguo; **não calcule total nem frete**, o servidor faz; leia os lembretes do retorno à pessoa antes de ela confirmar; NÃO executa sozinho.
- Cartão (`cartaoDaAcao("criar_proposta", p)`): verbo "Nova proposta", título = cliente. Linhas: Total, Frete, Desconto (se houver), Pagamento, Validade, Modelo. Lista "Itens" (`3 × CALIBRAÇÃO… — R$ 395,00 = R$ 1.185,00`, com "≠ catálogo" quando for o caso). Lista "Aparelhos". Em `texto` (rótulo "Lembretes"), um por linha.

- [ ] **Step 1: Testes**: ferramentas no `FERRAMENTAS_BOT`; recusa sem `gestorhs` ligado e sem rede; `test_cartao_tem_padrao_total_e_lembretes` (só GETs; `payload["frete"] == 150` para PE; `payload["observacoes"] == PADRAO["observacoes"]`; `payload["destinatario"] == {"tipo": "cliente", "id": 7}`); `test_aparelho_de_outro_cliente_recusa`; `test_executor_cria_e_devolve_link` (o corpo não tem `_exibir` e o destinatário só tem `tipo` e `id`); a descrição contém "não calcule". Front: `cartaoDaAcao("criar_proposta", …)` com os lembretes no `texto`.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Suítes** (backend inteiro; `npx vitest run src/lib/acoes.test.ts`).
- [ ] **Step 5: Commit** `feat(guardi): criar proposta pelo padrão, com lembretes`.

---

### Task 3: Alterar proposta

**Files:** os mesmos da Task 2; Test `backend/tests/test_guardi_gestorhs_propostas.py`

**Interfaces:**
- Argumentos de `gestorhs_alterar_proposta`: `{proposta: id, itens?: [{sku, quantidade, preco?}] (a lista NOVA inteira), adicionar_aparelhos?: [id], remover_aparelhos?: [id], desconto?, frete?, condicao_pagamento?, contato?, intro?, validade_dias?, data_entrega?, descricao_entrega?, endereco_entrega?}`.
- Antes do cartão: `GET /propostas/{id}`. Recusa `is_deleted` e `faturada`. Monta só os campos que mudam. Itens e aparelhos vão como lista inteira resultante, se mudarem. `outros_itens` é refeito pelo modelo só se os aparelhos mudaram **e** `texto_ainda_e_do_modelo(atual, padrão dos aparelhos antigos)`; senão vai o lembrete. Recalcula o total e os lembretes sobre o resultado. Sem mudança nenhuma → recusa "nada a alterar".
- `payload`: `{"proposta": id, "corpo": {...só o que muda...}, "_exibir": {"numero", "cliente", "mudancas": [[campo, antes, depois]...], "itens_entram", "itens_saem", "aparelhos_entram", "aparelhos_saem", "total_antes", "total_depois", "lembretes"}}`.
- Executor: PUT `/propostas/{id}` com o `corpo` filtrado por lista fixa (sem `destinatario`). Retorno: `"Proposta <numero> alterada (versão anterior guardada). PDF: <link>"`.
- Cartão (`alterar_proposta`): verbo "Alterar proposta", título "Proposta <numero> · <cliente>". Linhas "Total" (`antes → depois`) e uma por mudança. Listas "Entram" e "Saem". Lembretes em `texto`.

- [ ] **Step 1: Testes**: `test_remover_aparelho_manda_a_lista_inteira_restante`; `test_faturada_e_desabilitada_recusam`; `test_texto_editado_nao_e_sobrescrito_e_vira_lembrete`; `test_alteracao_nunca_leva_destinatario`; `test_nada_a_alterar`. Front: o cartão de alteração mostra "antes → depois" do total.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Suítes.**
- [ ] **Step 5: Commit** `feat(guardi): alterar proposta com antes e depois`.

---

### Task 4: Template, changelog e documentação

**Files:** `backend/app/bots_pessoais.py`, `frontend/src/data/changelog.ts` (2.8.0), `CLAUDE.md`; Test no mesmo arquivo.

Acrescentar ao bloco do GestorHS no AGENTS.md (exato):

```
  Propostas (`gestorhs_criar_proposta`, `gestorhs_alterar_proposta`): monto
  pelo padrão da casa, leio os lembretes para {primeiro} antes do cartão, e
  nunca mexo no cadastro do cliente.
```

- [ ] **Step 1: Teste** do AGENTS.md: os dois nomes de ferramenta e `not excede_o_teto`.
- [ ] **Step 2: Ver falhar.**
- [ ] **Step 3: Implementar.** Changelog: "O Guardi agora monta e altera propostas no GestorHS: você conta o que o cliente pediu, ele preenche pelo padrão da casa e avisa o que ficou diferente ou faltando — sempre com a sua confirmação." No CLAUDE.md: o padrão vem do GestorHS, os lembretes não travam, nunca toca no cadastro (por causa do Tiny), o PUT manda listas inteiras.
- [ ] **Step 4: Suítes** (backend e `npx vitest run src/test/novidades.test.ts src/lib/acoes.test.ts`).
- [ ] **Step 5: Commit** `feat(guardi): propostas no template e na documentação`.

---

## Depois do plano (não é código)

1. Prompt "Para o GestorHS" (com o contrato do `/propostas/padrao` acima) → `cl GestorHS` → deploy do `gestorhs-api` (e do `gestorhs-sistema`, se a tela passar a usar a rota).
2. Deploy do HS.OS → `publicar-bots-mcp.py --aplicar` → `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`.
3. Conferência sem escrita no `erick-bot`; primeira proposta real com a Ellen, a Leticia ou o André.
