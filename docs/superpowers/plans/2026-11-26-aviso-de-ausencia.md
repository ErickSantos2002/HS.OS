# Aviso de pedido de ausência — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** pedido de ausência pendente no TalentHS vira, em até ~2 min, recado + cartões Aprovar/Recusar na conversa do Guardi de quem está em `avisos_ausencia.destinatarios`.

**Architecture:** etapa nova no fim da `passada` do `disparador_lembretes` (igual à varredura), que lê `/absences/team/pending` como o destinatário, deduplica por tabela com índice único e grava recado + dois cartões (`talenths_preparo.preparar` + `acoes.criar_pendente`) numa transação. Lógica de decisão pura em `app/avisos_ausencia.py`.

**Tech Stack:** FastAPI, asyncpg, pytest (puro, conexões falsas).

**Spec:** `docs/superpowers/specs/2026-11-26-aviso-de-ausencia-design.md`

## Global Constraints

- Migração `044_avisos_ausencia.sql`, idempotente, RLS ligado sem policy, GRANT para `service_role`; aplicada por `~/aplicar-hsos-044.py` com `~/projetos/bancos/.venv/bin/python`, conferindo o efeito.
- Chave `app_settings` `avisos_ausencia` = `{"ligado": bool, "destinatarios": [user_id]}`; ausente/malformada = desligado.
- Ritmo: no máximo uma leitura por destinatário a cada **120 s** por worker.
- Reaviso: pedido ainda pendente **24 h** depois do último aviso recebe aviso novo (cartões vencem em 24 h — `VALIDADE` de `routers/acoes.py`).
- Pedido cujo `user_email` (case-insensitive) é o do destinatário: não avisa.
- Destinatário sem Guardi (`agent_profiles.dono_id`) ou sem `talenths` em `sistemas_ligados`: pula, `logger.warning` uma vez por processo.
- Nenhuma exceção da etapa sobe para a `passada`; `UndefinedTableError` loga uma vez ("aplicar a migração 044").
- Testes com docstring dizendo o que o defeito custaria (padrão do repo). Suíte: `cd backend && .venv/bin/python -m pytest tests -q`.
- Changelog: entrada nova no topo, `2.24.0`, `novidade`.

## Review Focus

1. **Dois workers na mesma passada** → um aviso só. Trancado no Task 3 (`test_dois_workers_um_aviso`).
2. **TalentHS fora (ErroSistema/timeout)** → nada gravado, nenhuma linha de dedupe (senão o pedido nunca é avisado). Task 3 (`test_talenths_fora_nao_marca_avisado`).
3. **`preparar` recusa (pedido saiu de pending entre a leitura e o preparo)** → transação desfeita, nenhuma linha de dedupe nem recado órfão. Task 3 (`test_preparo_recusa_desfaz_tudo`).
4. **Ordem na conversa** → recado antes dos dois cartões (mesmo `now()` na transação embaralharia). Task 2 + Task 3 (`test_recado_vem_antes_dos_cartoes`).
5. **Motivo com texto longo/quebras/markdown** → recado saneado e com teto. Task 1 (`test_recado_saneia_motivo`).

---

### Task 1: decisão pura e texto do recado

**Files:**
- Create: `backend/app/avisos_ausencia.py`
- Test: `backend/tests/test_avisos_ausencia.py`

**Interfaces:**
- Produces:
  - `@dataclass(frozen=True) class Config: ligado: bool; destinatarios: tuple[str, ...]`
  - `config(valor) -> Config` — aceita dict ou None/lixo (→ desligado; ids não-str descartados).
  - `decidir(pendentes: list[dict], avisados: dict[str, datetime], email_destinatario: str, agora: datetime) -> list[tuple[dict, bool]]` — devolve `(pedido, de_novo)`; `de_novo=False` para pedido sem linha, `True` para `avisados[id] <= agora - 24h`; pula `status != "pending"` e pedido do próprio destinatário.
  - `texto_recado(pedido: dict, de_novo: bool) -> str`
  - `REAVISO = timedelta(hours=24)`, `RITMO_SEGUNDOS = 120`

- [ ] **Step 1: testes que falham** — `test_config_ausente_e_desligado` (`config(None)`, `config("x")`, `config({"ligado": True, "destinatarios": [1, "u-1"]})` → `destinatarios == ("u-1",)`); `test_decidir_novo_e_reaviso` (sem linha → `False`; linha de 25 h → `True`; linha de 2 h → fora); `test_decidir_pula_o_proprio_pedido` (`"ADM01@x"` vs `"adm01@x"`); `test_decidir_pula_nao_pendente`; `test_recado_formato` — para `{user_name:"Ana Souza", department:"Comercial", type_name:"Férias", start_date:"2026-12-02", end_date:"2026-12-06", days:5, reason:"Viagem"}` o texto é `"📅 Pedido de ausência — Ana Souza (Comercial): Férias, 02/12 a 06/12 (5 dias). Motivo: Viagem"`; um dia só → `"03/12 (1 dia)"`; com `start_time`/`end_time` → `"03/12, 08:00–12:00"`; `de_novo=True` prefixa `"📅 Ainda pendente — "` no lugar de `"📅 Pedido de ausência — "`; sem motivo → sem a parte `Motivo:`. `test_recado_saneia_motivo`: quebras viram espaço, motivo cortado em 300 com `…`.
- [ ] **Step 2:** `cd backend && .venv/bin/python -m pytest tests/test_avisos_ausencia.py -q` → FAIL (módulo inexistente).
- [ ] **Step 3:** implementar em `app/avisos_ausencia.py` (sem I/O; docstring do módulo aponta a spec).
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(ausencia): decisão e recado do aviso de pedido de ausência`.

### Task 2: migração 044 e `criado_em` no `criar_pendente`

**Files:**
- Create: `backend/migrations/044_avisos_ausencia.sql`, `~/aplicar-hsos-044.py` (fora do repo, molde do `~/aplicar-hsos-043.py`)
- Modify: `backend/app/acoes.py` (`criar_pendente`)
- Test: `backend/tests/test_acoes_pendentes.py`

**Interfaces:**
- Produces: tabela `public.avisos_ausencia (destinatario_id uuid NOT NULL, pedido_id text NOT NULL, avisado_em timestamptz NOT NULL, ultimo_aviso_em timestamptz NOT NULL, PRIMARY KEY (destinatario_id, pedido_id))`, RLS ligado, `GRANT SELECT, INSERT, UPDATE ON … TO service_role`.
- Produces: `criar_pendente(conn, dono, bot, sistema, acao, payload, resumo, criado_em: datetime | None = None) -> str` — com `criado_em`, a mensagem do cartão grava esse `created_at`; sem, segue `now()` (chamadores atuais intactos).

- [ ] **Step 1:** teste `test_criar_pendente_com_criado_em` (conexão falsa captura o SQL/args do INSERT em `conversations` e confere o timestamp passado) e `test_criar_pendente_sem_criado_em_nao_muda` (SQL atual sem `created_at`).
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar o parâmetro; escrever a `044` (cabeçalho no molde da `043`, explicando por que o PK é a trava contra dois workers).
- [ ] **Step 4:** testes PASS; suíte inteira PASS.
- [ ] **Step 5:** escrever `~/aplicar-hsos-044.py` (perfil admin, executa o SQL, confere `to_regclass('public.avisos_ausencia')` e o `has_table_privilege('service_role', …, 'INSERT')`), rodar com o venv do cadastro, conferir saída.
- [ ] **Step 6:** commit `feat(ausencia): migração 044 e criado_em no cartão`.

### Task 3: a etapa no disparador

**Files:**
- Modify: `backend/app/avisos_ausencia.py` (parte com I/O no fim do arquivo)
- Modify: `backend/app/disparador_lembretes.py` (`passada` soma `await _avisos_ausencia(sessao_fn, agora)`)
- Test: `backend/tests/test_avisos_ausencia.py`, `backend/tests/test_disparador_lembretes.py` (fixture autouse neutraliza a etapa nova, igual `_sem_varredura`)

**Interfaces:**
- Consumes: Task 1 (`config`, `decidir`, `texto_recado`, `RITMO_SEGUNDOS`), Task 2 (`criar_pendente(..., criado_em=)`), `talenths.chamar(email, bot, "/absences/team/pending", dono=)`, `talenths_preparo.preparar(ctx, bot, args)` com `ctx={"email","dono"}` e `args={"acao": "aprovar_ausencia"|"recusar_ausencia", "ids": [id]}`.
- Produces: `async def etapa_avisos(sessao_fn, agora: datetime, ler=None, preparar=None) -> int` (injeções para teste; devolve avisos gravados) e `_ultima_leitura: dict[str, float]` (ritmo por destinatário, `time.monotonic`).

Fluxo por destinatário (cada um isolado em `try/except` com `logger.exception`):
1. lê config (`SELECT value FROM app_settings WHERE key='avisos_ausencia'`); desligado → 0.
2. resolve `agent_id`, `email`, `sistemas_ligados` pelo `dono_id`; sem Guardi/sem `talenths` → warning único, segue.
3. ritmo: menos de 120 s desde a última leitura → segue.
4. `ler(...)` → lista; `SELECT pedido_id, ultimo_aviso_em FROM avisos_ausencia WHERE destinatario_id=$1 AND pedido_id = ANY($2)`; `decidir`.
5. para cada `(pedido, de_novo)`, **uma transação**: novo → `INSERT … ON CONFLICT DO NOTHING RETURNING pedido_id`; de novo → `UPDATE … SET ultimo_aviso_em=$agora WHERE … AND ultimo_aviso_em=$visto RETURNING` (compare-and-set). Sem retorno → outro worker levou, segue. Com retorno: `preparar` aprovar e recusar (ValueError → raise para desfazer a transação, log info), INSERT do recado em `conversations` (`role='agent'`, `created_at = agora`), `criar_pendente` aprovar com `agora + 1 ms`, recusar com `agora + 2 ms`.

- [ ] **Step 1:** testes que falham, com sessão falsa em memória (molde de `test_disparador_lembretes.py`): `test_aviso_grava_recado_e_dois_cartoes`; `test_recado_vem_antes_dos_cartoes` (timestamps crescentes recado < aprovar < recusar); `test_dois_workers_um_aviso` (segundo `INSERT` sem retorno → nada gravado); `test_talenths_fora_nao_marca_avisado` (`ler` levanta `ErroSistema` → zero INSERT); `test_preparo_recusa_desfaz_tudo` (`preparar` levanta `ValueError` → transação com rollback, sem recado); `test_desligado_nao_le`; `test_ritmo_120s` (duas chamadas com `monotonic` falso a 60 s → uma leitura; a 121 s → duas); `test_destinatario_sem_talenths_pula`; `test_reaviso_24h_usa_compare_and_set`.
- [ ] **Step 2:** rodar → FAIL.
- [ ] **Step 3:** implementar `etapa_avisos` e `_avisos_ausencia` no disparador (import interno, `UndefinedTableError` loga uma vez, qualquer outra exceção `logger.exception`, devolve 0).
- [ ] **Step 4:** teste da ligação: `test_passada_chama_avisos_ausencia` em `test_avisos_ausencia.py` (monkeypatch das etapas, confere que roda e que exceção nela não sobe).
- [ ] **Step 5:** suíte inteira PASS.
- [ ] **Step 6:** commit `feat(ausencia): etapa do aviso de pedido de ausência no disparador`.

### Task 4: ligar, changelog e documentação

**Files:**
- Create: `backend/scripts/avisos-ausencia.py` (molde do `varredura-agora.py`: `--ligar <email>`, `--desligar`, `--mostrar`; sem `--aplicar` é ensaio; perfil admin do cadastro; resolve o `user_id` pelo e-mail em `profiles` e acrescenta sem duplicar)
- Modify: `frontend/src/data/changelog.ts` (topo: `2.24.0`, data `2026-11-26`, `novidade`: "Pedido de ausência no TalentHS agora chega para o RH na conversa com o Guardi, com os botões Aprovar e Recusar ali mesmo.")
- Modify: `docs/claude/guardi.md` (seção curta "Aviso de pedido de ausência — 26/11/2026": spec, porta única, chave, tabela, ritmo/reaviso, como ligar), `docs/CONTINUAR-AQUI.md` (estado e conferência pendente)

- [ ] **Step 1:** script em ensaio: `~/projetos/bancos/.venv/bin/python backend/scripts/avisos-ausencia.py --mostrar` → "desligado".
- [ ] **Step 2:** `cd frontend && npx vitest run src/test/novidades.test.ts` → PASS.
- [ ] **Step 3:** commit `feat(ausencia): script de ligar, changelog e docs`.
- [ ] **Step 4:** merge na `main` + push. **Produção:** deploy (fim do dia, junto dos outros) → `--ligar adm01@healthsafetytech.com --aplicar` → conferir na conversa da Lidisay o aviso do pedido pendente de 26/11 e a linha em `avisos_ausencia`.
