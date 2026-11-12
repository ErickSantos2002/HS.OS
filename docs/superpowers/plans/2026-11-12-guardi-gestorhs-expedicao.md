# Guardi no GestorHS, fase 2a (Expedição): plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o Guardi prepara, por cartão, quatro escritas no GestorHS como o dono: receber aparelhos (OS em lote), avançar caixa, fechar caixa com rastreio e cadastrar aparelho.

**Architecture:** mesmo trilho das escritas do TaskHS. A ferramenta no `hsos-bot-<bot>` valida e lê o GestorHS (GET), monta `payload` + `_exibir` e chama `acoes.criar_pendente`. O clique do dono roda o executor em `app/acoes.py`, que chama o GestorHS com o token de agente. A regra pura (validar argumentos, conferir o que foi lido, montar payload, texto do lote parcial) mora num módulo novo e testável: `app/gestorhs_escrita.py`. O front ganha os quatro formatos de cartão em `lib/acoes.ts`.

**Tech Stack:** FastAPI, httpx (MockTransport), pytest; React + Vitest no cartão.

**Spec:** `docs/superpowers/specs/2026-11-12-guardi-gestorhs-expedicao-design.md` (e a fase 1: `2026-11-11-guardi-gestorhs-design.md`)

## Global Constraints

- Nada escreve sem cartão. O executor usa **só** o `payload` gravado.
- Nomes de ação (sistema `gestorhs`): `receber`, `avancar_caixa`, `fechar_caixa`, `cadastrar_aparelho`. Não podem colidir com os do TaskHS, porque `cartaoDaAcao` despacha pelo nome da ação.
- Ferramentas: `gestorhs_receber`, `gestorhs_avancar_caixa`, `gestorhs_fechar_caixa`, `gestorhs_cadastrar_aparelho`. Recusam sem `gestorhs` em `sistemas_ligados`, sem tocar a rede.
- Tetos: lote de 1 a 30 aparelhos, sem id repetido; `observacao`/`obs` até 500 caracteres; `cod_retorno` de 1 a 60; `serie`/`patrimonio` até 60.
- `tipo_servico` ∈ `C` (calibração), `M` (manutenção), `A` (as duas). `condicao` ∈ `Bom estado`, `Com avarias`, `Oxidado`, `Lacrado`, `Sem acessórios`. `acessorios` ∈ {1 Bobinas, 2 Bocal, 3 Cabos USB, 4 Capa, 5 Carregador veicular, 6 Carregadores AC/DC, 7 Impressora, 8 Maleta, 9 Nf de Remessa}.
- Fases: 4 Recebido (Expedição), 5 Laboratório, 6 Pós-Vendas (Comercial Pós-Vendas), 10 Financeiro, 7 Preparando Retorno (Expedição), 8 Finalizada, 9 Cancelada. Ativas: 4, 5, 6, 10, 7.
- `sem_nota_fiscal` nunca vai no payload.
- Texto vindo do GestorHS (nome de cliente, modelo, série) entra no `_exibir` em uma linha, cortado em 80, como o TaskHS faz com o título (`_linha`).
- Testes com docstring dizendo o que o defeito custaria. Baseline: `cd backend && .venv/bin/python -m pytest tests -q` → 1232 passed.
- Changelog `2.6.0` (novidade), data `2026-11-12`, no topo.

## Review Focus

1. Série que a pessoa fala bate com aparelho de **outro** cliente: o cartão tem que mostrar o cliente em cada linha (Task 4 e Task 6).
2. Lote em que um aparelho já tem OS ativa: recusa antes do cartão, nomeando o aparelho (Task 1).
3. Lote que falha no 3º de 5 no clique: o `erro` diz "Parou no aparelho 3 de 5", quais OS abriram e em qual caixa, e não é cortado em 300 (Task 3).
4. Caixa em Preparando Retorno pedida em "avançar": recusa mandando usar "fechar" (Task 1).
5. Colaborador sem a função (Consulta) confirma o cartão: o 403 vira "a sua função no GestorHS não permite isso", e no avanço diz qual função avança aquela fase (Task 3).

---

### Task 1: Regras puras da escrita

**Files:**
- Create: `backend/app/gestorhs_escrita.py`
- Test: `backend/tests/test_guardi_gestorhs_escrita.py`

**Interfaces:**
- Produces (todas puras, levantam `ValueError` com mensagem para o agente):
  - `FASES: dict[int, tuple[str, str | None]]` → id → (nome, função dona); `ATIVAS = (4, 5, 6, 10, 7)`
  - `aparelhos_do_lote(args: dict) -> list[dict]`. Valida e normaliza cada item para `{"equipamento_cliente": int, "tipo_servico": str, "condicao_chegada": str | None, "checklist": list[int], "pilhas": int, "bocais": int, "observacoes": str | None}`.
  - `conferir_aparelho(item: dict, aparelho: dict, ordens: list[dict]) -> dict`. Recebe o GET do aparelho e o das OS dele, recusa OS ativa e devolve a linha de exibição `{"cliente": str, "modelo": str, "serie": str}`.
  - `conferir_caixa_para_receber(caixa: dict) -> str | None`. Recusa caixa fora das ativas e devolve o aviso "a OS já entra em <fase>" quando a fase não é 4, senão `None`.
  - `conferir_caixa_para_avancar(caixa: dict, cliente_principal: int | None) -> dict`. Recusa fase 7 ("use gestorhs_fechar_caixa"), recusa inativa, e em fase 4 com `len(caixa["clientes"]) > 1`, sem `cliente_principal` na caixa nem no argumento, recusa pedindo o id. Devolve `_exibir` com `{"fase": nome, "funcao": dona, "total_os": n, "clientes": [...]}`.
  - `conferir_caixa_para_fechar(caixa: dict, cod_retorno: str) -> dict`. Exige fase 7 e `cod_retorno` de 1 a 60.
  - `conferir_cadastro(args: dict, achados: list[dict]) -> dict`. Valida os campos e recusa quando algum item de `achados` (o GET `aparelhos?q=serie`) tem a mesma série, sem diferenciar maiúscula e espaço, dizendo de qual cliente é. Devolve o payload.
  - `texto_lote_parcial(n_ok: int, total: int, serie_falhou: str, motivo: str, os_abertas: list[int], caixa: int | None) -> str`

- [ ] **Step 1: Escrever os testes**

```python
def test_lote_valida_e_normaliza():
    """Lote com tipo ou acessório inválido daria 400/422 no clique, depois de a
    pessoa já ter confirmado. Recusar antes do cartão evita confirmação inútil."""
    itens = ge.aparelhos_do_lote({"aparelhos": [{"id": 5, "tipo_servico": "C", "acessorios": [2, 8]}]})
    assert itens == [{"equipamento_cliente": 5, "tipo_servico": "C", "condicao_chegada": None,
                      "checklist": [2, 8], "pilhas": 0, "bocais": 0, "observacoes": None}]
    for ruim in ({"aparelhos": []}, {"aparelhos": [{"id": 5, "tipo_servico": "X"}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "acessorios": [10]}]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C"}, {"id": 5, "tipo_servico": "C"}]},
                 {"aparelhos": [{"id": i, "tipo_servico": "C"} for i in range(1, 32)]},
                 {"aparelhos": [{"id": 5, "tipo_servico": "C", "condicao": "Ótimo"}]}):
        with pytest.raises(ValueError):
            ge.aparelhos_do_lote(ruim)

def test_aparelho_com_os_ativa_recusa_nomeando():
    ap = {"id": 5, "cliente_nome": "ACME", "equipamento_descricao": "Phoebus", "serie": "F1"}
    with pytest.raises(ValueError, match="F1"):
        ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [{"id": 9, "fase": 5}])
    assert ge.conferir_aparelho({"equipamento_cliente": 5}, ap, [{"id": 9, "fase": 8}]) == \
        {"cliente": "ACME", "modelo": "Phoebus", "serie": "F1"}

def test_caixa_existente_em_qualquer_fase_ativa_com_aviso():
    """Decisão do Erick (12/11): pode, mas o cartão avisa onde a OS entra."""
    assert ge.conferir_caixa_para_receber({"id": 7, "fase": 4, "fase_descricao": "Recebido"}) is None
    assert "Laboratório" in ge.conferir_caixa_para_receber({"id": 7, "fase": 5, "fase_descricao": "Laboratório"})
    for fase in (8, 9, None):
        with pytest.raises(ValueError):
            ge.conferir_caixa_para_receber({"id": 7, "fase": fase})

def test_avancar_recusa_preparando_e_pede_cliente_principal():
    with pytest.raises(ValueError, match="gestorhs_fechar_caixa"):
        ge.conferir_caixa_para_avancar({"id": 7, "fase": 7, "clientes": ["A"], "total_os": 1}, None)
    multi = {"id": 7, "fase": 4, "clientes": ["A", "B"], "cliente_principal": None, "total_os": 2}
    with pytest.raises(ValueError, match="cliente_principal"):
        ge.conferir_caixa_para_avancar(multi, None)
    ex = ge.conferir_caixa_para_avancar(multi, 33)
    assert ex["fase"] == "Recebido" and ex["funcao"] == "Expedição" and ex["total_os"] == 2

def test_fechar_exige_preparando_e_rastreio():
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 4}, "BR1")
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 7}, "  ")
    with pytest.raises(ValueError):
        ge.conferir_caixa_para_fechar({"id": 7, "fase": 7}, "X" * 61)

def test_cadastro_recusa_serie_que_ja_existe():
    """'Cadastra o bafômetro série X' com X já na frota daria um aparelho
    duplicado, e as OS futuras cairiam ora num, ora noutro."""
    with pytest.raises(ValueError, match="ACME"):
        ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "f 123"},
                             [{"serie": "F123", "cliente_nome": "ACME"}])
    p = ge.conferir_cadastro({"cliente": 1, "equipamento": 2, "serie": "F9"}, [])
    assert p == {"cliente": 1, "equipamento": 2, "serie": "F9"}

def test_texto_do_lote_parcial():
    t = ge.texto_lote_parcial(2, 5, "F3", "aparelho já possui OS ativa", [100, 101], 40)
    assert t.startswith("Parou no aparelho 3 de 5") and "OS 100, 101" in t and "caixa 40" in t
```

- [ ] **Step 2: Rodar e ver falhar.** Comando: `cd backend && .venv/bin/python -m pytest tests/test_guardi_gestorhs_escrita.py -q`. Esperado: `ModuleNotFoundError`.
- [ ] **Step 3: Implementar `app/gestorhs_escrita.py`.** Constantes copiadas das Global Constraints. Série comparada com `re.sub(r"\s+", "", s).upper()`. Datas do cadastro (`datacompra`, `ult_calibragem`, `prox_calibragem`) em `AAAA-MM-DD`, validadas com `date.fromisoformat`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(guardi): regras da escrita da Expedição no GestorHS`.

---

### Task 2: Cliente do GestorHS com escrita

**Files:**
- Modify: `backend/app/sistemas/gestorhs.py`
- Test: `backend/tests/test_guardi_gestorhs.py`

**Interfaces:**
- Produces: `async chamar(email, bot, caminho, params=None, dono=None, metodo: str = "GET", json: dict | None = None) -> Any`. A assinatura antiga continua valendo; `metodo`/`json` são keyword.
- 403 numa escrita (`metodo != "GET"`): `ErroSistema(403, "a sua função no GestorHS não permite isso")`. Em GET mantém a mensagem da fase 1.

- [ ] **Step 1: Teste** `test_escrita_vai_com_metodo_e_corpo_e_403_fala_da_funcao`. MockTransport: um POST em `/ordens` com `{"equipamento_cliente": 5}` chega com o método e o corpo; com 403, a mensagem contém "sua função no GestorHS".
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Segundo dicionário de mensagens para escrita, passado a `chamar_sistema`.
- [ ] **Step 4: Rodar e ver passar.**
- [ ] **Step 5: Commit** `feat(guardi): cliente do GestorHS escreve como o dono`.

---

### Task 3: Executores no clique

**Files:**
- Modify: `backend/app/acoes.py` (quatro executores em `EXECUTORES`)
- Modify: `backend/app/routers/acoes.py` (`falha[:300]` → `falha[:2000]`)
- Test: `backend/tests/test_guardi_gestorhs_escrita.py`

**Interfaces:**
- Consumes: `gestorhs.chamar(..., metodo=, json=)` (Task 2), `texto_lote_parcial`, `FASES` (Task 1).
- Produces, todos com assinatura `async (email, bot, p, dono=None) -> str`:
  - `("gestorhs", "receber")`. `p = {"caixa": int | None, "aparelhos": [item normalizado...], "data_chegada": str | None, "_exibir": {...}}`. Em ordem: o 1º POST `/ordens` com `caixa` = `p["caixa"]` (ou sem a chave), os demais com o `caixa` devolvido pelo 1º. Falha no item k > 0: `ErroSistema(e.status, texto_lote_parcial(...))`. Falha no item 0: relança. Retorno: `"3 OS abertas na caixa 1247: OS 11700, 11701, 11702."`.
  - `("gestorhs", "avancar_caixa")`. POST `/caixas/{id}/avancar` com `{"obs", "cliente_principal"}` (só as presentes). 403 → `ErroSistema(403, f"quem avança caixa em {fase} é {funcao} (ou Administrador)")`, a partir do `_exibir`. Retorno: `"Caixa 1247 avançada para Laboratório."` (o `fase_descricao` da resposta).
  - `("gestorhs", "fechar_caixa")`. POST `/caixas/{id}/avancar` com `{"cod_retorno", "obs"}`. Retorno: `"Caixa 1247 finalizada, rastreio BR123."`.
  - `("gestorhs", "cadastrar_aparelho")`. POST `/equipamentos-cliente` com o payload sem `_exibir`. Retorno: `"Aparelho cadastrado (id 9001)."`.

- [ ] **Step 1: Testes**

```python
def test_receber_abre_a_primeira_sem_caixa_e_as_demais_na_dela(chave, monkeypatch):
    """Decisão 2 do Erick: a 1ª OS cria a caixa; mandar caixa nas outras é o que
    as junta. Mandar a caixa na 1ª (inexistente) ou omiti-la nas outras daria
    uma caixa por aparelho."""
    # MockTransport: POST /ordens → {"id": 100+n, "caixa": 40}
    # corpos: [0] sem "caixa"; [1] e [2] com "caixa": 40; retorno contém "caixa 40" e "OS 100, 101, 102"

def test_receber_para_no_meio_e_diz_o_que_abriu(chave, monkeypatch):
    # 3ª chamada → 409 {"detail": "aparelho já possui OS ativa"}
    # ErroSistema; str começa por "Parou no aparelho 3 de 3"; contém "OS 100, 101" e "caixa 40"
    # nenhuma 4ª chamada; nenhum DELETE

def test_erro_longo_nao_e_cortado_em_300():
    """O texto do lote parcial é o que a pessoa usa para decidir o resto: cortado,
    ela não saberia quais OS já existem."""
    # inspeciona routers/acoes.py: o slice do erro é >= 2000

def test_avancar_403_diz_quem_avanca(chave, monkeypatch):
    # 403 → mensagem contém "Laboratório" quando _exibir.fase == "Laboratório"

def test_payload_nunca_leva_sem_nota_fiscal(chave, monkeypatch):
    # corpo do POST /caixas/7/avancar não tem a chave sem_nota_fiscal, mesmo se o payload tiver
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** No avanço, montar o corpo por allowlist de chaves (`obs`, `cliente_principal`, `cod_retorno`), nunca `**p`.
- [ ] **Step 4: Rodar a suíte inteira.**
- [ ] **Step 5: Commit** `feat(guardi): executores da Expedição no GestorHS`.

---

### Task 4: As quatro ferramentas no `hsos-bot-<bot>`

**Files:**
- Modify: `backend/app/routers/mcp_bot.py` (`FERRAMENTAS`, `_gestorhs` despacha as quatro novas)
- Modify: `backend/app/email/regras.py` (`FERRAMENTAS_BOT`)
- Test: `backend/tests/test_guardi_gestorhs_escrita.py`

**Interfaces:**
- Consumes: Task 1 inteira, `gestorhs.chamar` (GET), `acoes.criar_pendente(conn, dono, bot, "gestorhs", acao, payload, resumo)`.
- `_gestorhs` passa a receber `conn` (para `criar_pendente`): `async _gestorhs(conn, bot, nome, args, ctx)`. Atualizar o despacho em `executar` e os testes da fase 1 que chamam `_gestorhs`.
- Argumentos:
  - `gestorhs_receber`: `{caixa?: int, data_chegada?: "AAAA-MM-DD", aparelhos: [{id, tipo_servico, condicao?, acessorios?, pilhas?, bocais?, observacao?}]}`
  - `gestorhs_avancar_caixa`: `{caixa: int, cliente_principal?: int, obs?: str}`
  - `gestorhs_fechar_caixa`: `{caixa: int, cod_retorno: str, obs?: str}`
  - `gestorhs_cadastrar_aparelho`: `{cliente: int, equipamento: int, serie: str, patrimonio?, datacompra?, ult_calibragem?, prox_calibragem?}`
- Leituras antes do cartão: receber → para cada aparelho, `GET /equipamentos-cliente/{id}` e `GET /equipamentos-cliente/{id}/ordens`, mais `GET /caixas/{caixa}` se informada. Avançar/fechar → `GET /caixas/{id}`. Cadastrar → `GET /equipamentos-cliente?q=<serie>`, `GET /clientes/{cliente}`, `GET /equipamentos`.
- `_exibir` do receber: `{"linhas": [{"cliente", "modelo", "serie"}...], "caixa": "nova" | "caixa N", "aviso": str | None, "clientes": int}`. Resumo: `"Receber 3 aparelhos (caixa nova)"`.
- Descrição de `gestorhs_receber` (é onde o agente lê a regra): com mais de um aparelho, **pergunte antes** se veio tudo igual (tipo de serviço, condição, acessórios, pilhas, bocais) e qual veio diferente; ache o id pela série com `gestorhs_consultar aparelhos q=`; NÃO executa, prepara um cartão para o dono confirmar.

- [ ] **Step 1: Testes**

```python
def test_ferramentas_de_escrita_no_guardi():
    assert {"gestorhs_receber", "gestorhs_avancar_caixa", "gestorhs_fechar_caixa",
            "gestorhs_cadastrar_aparelho"} <= set(FERRAMENTAS_BOT)

def test_escrita_sem_gestorhs_ligado_recusa_sem_rede(chave, monkeypatch): ...

def test_receber_grava_cartao_com_cliente_em_cada_linha(chave, monkeypatch):
    """A série falada pode bater com aparelho de outro cliente; o cartão é a
    última chance de a pessoa ver isso."""
    # MockTransport responde aos GETs; conn falsa captura criar_pendente
    # payload["aparelhos"][0]["equipamento_cliente"] == 5; _exibir.linhas[0]["cliente"] == "ACME"
    # nenhuma chamada não-GET ao GestorHS

def test_receber_com_os_ativa_nao_grava_cartao(chave, monkeypatch): ...

def test_descricao_do_receber_manda_perguntar_se_veio_tudo_igual():
    d = next(f for f in FERRAMENTAS if f["name"] == "gestorhs_receber")["description"]
    assert "tudo igual" in d and "NÃO executa" in d
```

- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Texto do GestorHS no `_exibir` passa pelo `_linha` existente e é cortado em 80.
- [ ] **Step 4: Rodar a suíte inteira.**
- [ ] **Step 5: Commit** `feat(guardi): receber, avançar, fechar caixa e cadastrar aparelho por cartão`.

---

### Task 5: O cartão no front

**Files:**
- Modify: `frontend/src/lib/acoes.ts` (`cartaoDaAcao`: quatro ramos novos)
- Modify: `frontend/src/components/chat/CartaoAcao.tsx` (rótulo do sistema: `gestorhs` → "GestorHS")
- Test: `frontend/src/lib/acoes.test.ts`

**Interfaces:**
- Consumes: formatos de `payload`/`_exibir` das Tasks 3 e 4.
- `receber`: verbo "Receber aparelhos", título "Caixa nova" ou "Caixa N". Linhas `["Aparelhos", "3"]` e, se `_exibir.clientes > 1`, `["Clientes", "2 — confira"]`. Uma lista (`checklists`) com um item por aparelho: `"<modelo> · série <serie> · <cliente> · <C|M|A legível>"` mais o que diferir (condição, acessórios, pilhas, bocais). O `aviso` aparece em `texto`, com rótulo "Atenção".
- `avancar_caixa`: verbo "Avançar caixa", título "Caixa N". Linhas "Fase atual", "OS" e, se houver, "Cliente principal".
- `fechar_caixa`: verbo "Fechar caixa", título "Caixa N", linha "Rastreio".
- `cadastrar_aparelho`: verbo "Cadastrar aparelho", título da série. Linhas "Cliente", "Modelo" e, se houver, "Patrimônio".

- [ ] **Step 1: Testes** em `acoes.test.ts`: um por ação. O de `receber` confere que o cliente aparece em cada item e que o aviso "a OS já entra em Laboratório" vira `texto`.
- [ ] **Step 2: Rodar e ver falhar.** Comando: `cd frontend && npx vitest run src/lib/acoes.test.ts`.
- [ ] **Step 3: Implementar.**
- [ ] **Step 4: Rodar e ver passar**, mais `npm run lint` sem erro novo.
- [ ] **Step 5: Commit** `feat(guardi): cartões da Expedição do GestorHS`.

---

### Task 6: Template, changelog e documentação

**Files:**
- Modify: `backend/app/bots_pessoais.py` (bloco do GestorHS no AGENTS.md)
- Modify: `frontend/src/data/changelog.ts` (`2.6.0`)
- Modify: `CLAUDE.md` (parágrafo do GestorHS)
- Test: `backend/tests/test_guardi_gestorhs_escrita.py`

Texto a acrescentar ao bloco do GestorHS no AGENTS.md (exato):

```
  Receber aparelhos, avançar e fechar caixa, cadastrar aparelho: preparo e
  {primeiro} confirma no cartão. Mais de um aparelho? Pergunto antes se veio
  tudo igual e qual veio diferente. Quem pode é a função dele no GestorHS.
```

- [ ] **Step 1: Teste** `test_agents_md_fala_da_escrita_e_cabe_no_teto`. Confere `"tudo igual"` e `"gestorhs_receber"` no AGENTS.md (acrescentar o nome da ferramenta ao texto se faltar) e `not excede_o_teto`.
- [ ] **Step 2: Rodar e ver falhar.**
- [ ] **Step 3: Implementar.** Changelog para quem usa: "O Guardi agora ajuda a Expedição no GestorHS: recebe os aparelhos de uma caixa (abrindo as OS de uma vez), avança e fecha caixa com o rastreio, e cadastra aparelho novo — sempre com a sua confirmação." No CLAUDE.md: as quatro ações, o cartão por lote, "parou no N de M" sem desfazer e o pré-requisito do GestorHS.
- [ ] **Step 4: Suíte inteira do backend e `npx vitest run src/test/novidades.test.ts`.**
- [ ] **Step 5: Commit** `feat(guardi): Expedição no template e na documentação`.

---

## Depois do plano (não é código)

1. Prompt "Para o GestorHS" da spec no clipboard → sessão `cl GestorHS`. Deploy **do `gestorhs-api`**.
2. Deploy do HS.OS → `publicar-bots-mcp.py --aplicar` → `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`.
3. Conferência sem escrita no `erick-bot` (cartão preparado e cancelado; recusa no fechar fora de Preparando; recusa num Guardi de Consulta). Primeira escrita real com o Rafael ou o Lucas.
