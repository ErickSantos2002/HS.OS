# Agenda e lembretes do Guardi — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lembretes únicos e recorrentes por pessoa, disparados pelo backend como recado do Guardi + turno autônomo dele, com página "Agenda" e leitura do calendário do Outlook.

**Architecture:** Tabela `public.lembretes` (migração `032`), regras puras em `backend/app/agenda/`, um disparador em laço por worker (molde do `coletor_respostas`) que grava o recado e abre o turno pelo miolo extraído do `POST /send`; a resposta é colhida pelo coletor que já existe. Ferramentas `agenda_*` no `hsos-bot-<bot>`; API `/agenda/*` para a página; Graph `calendarView` com escopo pedido só no "Conectar e-mail".

**Tech Stack:** FastAPI + asyncpg + httpx (backend, pytest puro), React + Vite + TanStack Query + shadcn (frontend, Vitest).

**Spec:** `docs/superpowers/specs/2026-11-09-agenda-lembretes-design.md`

## Global Constraints

- Idioma: código, comentários, docstrings, mensagens e testes em **português**; testes com docstring dizendo o que o defeito custaria.
- Fuso de tudo que a pessoa vê/diz: `America/Sao_Paulo` (`zoneinfo`); banco em UTC (`timestamptz`).
- Tetos: **30** lembretes ativos/pessoa · recorrência mínima **diária** · único entre **5 min** e **1 ano** no futuro · **12** turnos de agente/pessoa/dia · atraso **> 6 h** = `perdido` · turno adiado em passos de **2 min** até **30 min**.
- `titulo` ≤ 200 caracteres, `instrucao` ≤ 2000.
- `ultimo_status` ∈ `entregue`, `entregue_sem_agente`, `perdido`, `erro`.
- Escopo de calendário: **só `Calendars.Read.Shared`**, pedido só no authorize/troca de code; **refresh usa os escopos que a conta tem** (conta antiga, `escopos` nulo → escopos de e-mail de hoje).
- Evento do Outlook nunca é gravado no banco; volta ao agente por `como_dado_externo`.
- Escrita em sistema externo no turno autônomo continua virando cartão (nada muda em `acoes`/`email_preparar`).
- Agenda é de **todo** Guardi (`agent_profiles.dono_id IS NOT NULL`), sem flag; calendário nas ferramentas segue `email_ligado`.
- Backend: `cd backend && .venv/bin/python -m pytest tests -q` tem que seguir verde a cada commit. Frontend: `npx vitest run` e `npx tsc --noEmit -p .` em `frontend/`.
- Fim: merge local na `main` + push (sem deploy). Nada roda contra produção neste plano além da migração (Task 1), que tem script próprio.

## Review Focus

1. **Dia 29–31 em recorrência mensal** — "dia 31 de todo mês" em fevereiro/abril dispara no **último dia do mês**, não pula o mês. → teste em Task 2.
2. **Dois workers, um lembrete** — a reserva tem que entregar cada lembrete a um worker só; disparo duplicado = duas bolhas e duas rodadas de IA. → teste do SQL de reserva (guarda no WHERE externo) em Task 7.
3. **Gateway fora no horário** — o recado tem que estar gravado **antes** de qualquer chamada ao gateway; falha no `chat.send` vira `entregue_sem_agente`, não `erro` sem recado. → teste em Task 7.
4. **Conta de e-mail conectada antes do deploy** — `renovar` não pode pedir `Calendars.Read.Shared` para ela. → teste em Task 4.
5. **Lembrete apagado/pausado enquanto estava reservado** — o disparador relê `ativo` na reserva e não dispara o que a pessoa apagou um instante antes. → teste em Task 7.

---

### Task 1: Migração `032_lembretes.sql` e script de aplicação

**Files:**
- Create: `backend/migrations/032_lembretes.sql`
- Create: `~/aplicar-hsos-032.py` (fora do repo; molde: `~/aplicar-hsos-031.py`)

**Interfaces:**
- Produces: tabela `public.lembretes` com as colunas da spec (+ `turno_pendente_desde timestamptz`), índice parcial `lembretes_proximo_idx ON (proximo_em) WHERE ativo AND proximo_em IS NOT NULL`, índice `lembretes_user_idx ON (user_id)`; `ALTER TABLE public.email_contas ADD COLUMN IF NOT EXISTS escopos text[]`.

- [ ] **Step 1:** Escrever a `032` seguindo o padrão da `028_email_bots.sql` (RLS ligada, sem policy, `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`). `user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`; `CHECK (criado_por IN ('pessoa','guardi'))`; `CHECK (ultimo_status IS NULL OR ultimo_status IN (...))`; `CHECK (char_length(titulo) BETWEEN 1 AND 200)`; `CHECK (instrucao IS NULL OR char_length(instrucao) <= 2000)`. Idempotente (`IF NOT EXISTS`).
- [ ] **Step 2:** Validar num Postgres 18 local limpo (`~/projetos/postgres-teste/`) aplicando `000`→`032` em ordem: 0 erros.
- [ ] **Step 3:** Escrever `~/aplicar-hsos-032.py` (usa `bancos.conectar("hsos", perfil="admin")`, aplica o arquivo, e **confere** com `information_schema`: tabela `lembretes` existe e `email_contas.escopos` existe). Rodar: `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-032.py`. Esperado: as duas conferências `True`.
- [ ] **Step 4: Commit** `feat(agenda): migração 032 — lembretes e escopos da conta de e-mail`

### Task 2: Regras puras de recorrência e validação

**Files:**
- Create: `backend/app/agenda/__init__.py`, `backend/app/agenda/regras.py`
- Test: `backend/tests/test_agenda_regras.py`

**Interfaces:**
- Produces:
  - `FUSO = ZoneInfo("America/Sao_Paulo")`; constantes `TETO_ATIVOS = 30`, `TETO_TURNOS_DIA = 12`, `ANTECEDENCIA_MIN = timedelta(minutes=5)`, `HORIZONTE_MAX = timedelta(days=366)`, `ATRASO_MAX = timedelta(hours=6)`, `ADIAMENTO = timedelta(minutes=2)`, `ADIAMENTO_MAX = timedelta(minutes=30)`.
  - `class RegraInvalida(ValueError)` — mensagem pronta para o agente/tela.
  - `validar_regra(regra: dict, agora: datetime) -> dict` — devolve a regra normalizada. Tipos: `unico {em:"AAAA-MM-DDTHH:MM"}`, `diario {hora}`, `dias_uteis {hora}`, `semanal {dias:[0..6] (0=segunda), hora}`, `mensal {dia:1..31, hora}`. Qualquer outro tipo/campo → `RegraInvalida`.
  - `proximo(regra: dict, depois_de: datetime) -> datetime | None` — próximo instante **estritamente depois** de `depois_de`, em UTC; `unico` já passado → `None`.

- [ ] **Step 1: Testes que falham**

```python
def test_semanal_segunda_8h_a_partir_de_domingo():
    agora = datetime(2026, 11, 8, 15, 0, tzinfo=FUSO)          # domingo
    assert proximo({"tipo": "semanal", "dias": [0], "hora": "08:00"}, agora) == \
        datetime(2026, 11, 9, 8, 0, tzinfo=FUSO).astimezone(timezone.utc)

def test_mensal_dia_31_cai_no_ultimo_dia_do_mes():
    agora = datetime(2026, 2, 1, 9, 0, tzinfo=FUSO)
    assert proximo({"tipo": "mensal", "dia": 31, "hora": "09:00"}, agora) == \
        datetime(2026, 2, 28, 9, 0, tzinfo=FUSO).astimezone(timezone.utc)

def test_dias_uteis_pula_fim_de_semana():  # sexta 19h → segunda 18h
    ...

def test_unico_passado_nao_tem_proximo(): ...
def test_unico_a_menos_de_5_min_e_recusado(): ...   # validar_regra levanta RegraInvalida
def test_unico_a_mais_de_um_ano_e_recusado(): ...
def test_tipo_desconhecido_e_recusado(): ...        # {"tipo":"a_cada_minuto"}
def test_hora_mal_formada_e_recusada(): ...         # "8h", "25:00"
```

- [ ] **Step 2:** `cd backend && .venv/bin/python -m pytest tests/test_agenda_regras.py -q` → FAIL (módulo não existe).
- [ ] **Step 3:** Implementar em `regras.py` (aritmética em hora local com `zoneinfo`, conversão para UTC só no retorno; mensal usa `min(dia, último dia do mês)`).
- [ ] **Step 4:** Rodar de novo → PASS.
- [ ] **Step 5: Commit** `feat(agenda): regras de recorrência e validação`

### Task 3: Domínio — CRUD com tetos, uma função para as duas pontas

**Files:**
- Create: `backend/app/agenda/dominio.py`
- Test: `backend/tests/test_agenda_dominio.py`

**Interfaces:**
- Consumes: `validar_regra`, `proximo`, `RegraInvalida`, `TETO_ATIVOS` (Task 2).
- Produces (todas recebem `conn` asyncpg e filtram por `user_id`; `RegraInvalida` para recusa):
  - `async def guardi_de(conn, user_id: str) -> str | None` — `agent_id` com `dono_id = user_id`.
  - `async def criar(conn, user_id: str, agent_id: str, titulo: str, regra: dict, instrucao: str | None, criado_por: str, agora: datetime) -> dict`
  - `async def listar(conn, user_id: str, de: datetime | None = None, ate: datetime | None = None) -> list[dict]` — ativos e pausados; com `de/ate`, só os com `proximo_em` no intervalo **mais** todos os recorrentes.
  - `async def editar(conn, user_id: str, id: str, agora: datetime, **campos) -> dict` — campos: `titulo`, `regra`, `instrucao`, `ativo`; mudar `regra` ou reativar recalcula `proximo_em`.
  - `async def apagar(conn, user_id: str, id: str) -> bool`
  - Linha devolvida como dict com `proximo_em` em ISO local (`FUSO`).

- [ ] **Step 1: Testes que falham** (conexão falsa, molde de `tests/test_mcp_bot.py::Conn`): `test_31o_ativo_e_recusado` (`fetchval` de contagem devolve 30 → `RegraInvalida` com "30"), `test_titulo_vazio_ou_longo_recusado`, `test_editar_regra_recalcula_proximo`, `test_editar_de_outra_pessoa_nao_acha` (SQL sempre com `user_id = $…`; id de outro → `RegraInvalida("Lembrete não encontrado.")`), `test_pausar_mantem_proximo_reativar_recalcula`.
- [ ] **Step 2:** Rodar → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Rodar → PASS.
- [ ] **Step 5: Commit** `feat(agenda): domínio dos lembretes com tetos`

### Task 4: Graph — escopos por conta e leitura do calendário

**Files:**
- Modify: `backend/app/email/graph.py` (`url_autorizacao`, `_token`, `trocar_code`, `renovar`, + `calendario`)
- Modify: `backend/app/email/contas.py` (`guardar_conta`, `access_token`, + `tem_calendario`)
- Modify: `backend/app/routers/email.py` (callback grava escopos; `GET /email/estado` devolve `calendario: bool`)
- Test: `backend/tests/test_email_escopos.py`

**Interfaces:**
- Produces:
  - `ESCOPO_CALENDARIO = "Calendars.Read.Shared"`; `ESCOPOS_CONECTAR = ESCOPOS_EMAIL + " " + ESCOPO_CALENDARIO`. `ESCOPOS_EMAIL` **não muda**.
  - `trocar_code(code) -> {"access","refresh","conta","escopos": list[str]}` — `escopos` do campo `scope` da resposta do token (split por espaço).
  - `renovar(refresh: str, escopos: list[str] | None) -> tuple[str, str]` — `scope` = `" ".join(escopos)` se houver, senão `ESCOPOS_EMAIL`.
  - `calendario(access, conta, de: datetime, ate: datetime) -> list[dict]` — `GET {GRAPH}/me/calendarView`, `startDateTime/endDateTime` ISO, `$select=subject,start,end,location,isAllDay,showAs`, `$orderby=start/dateTime`, `$top=100`, header `Prefer: outlook.timezone="E. South America Standard Time"`.
  - `contas.guardar_conta(conn, user_id, conta, refresh, escopos: list[str] | None = None)`; `contas.access_token` passa os escopos guardados ao `renovar`; `contas.tem_calendario(conn, user_id) -> bool` (escopos contêm `ESCOPO_CALENDARIO`, comparação sem caixa).

- [ ] **Step 1: Testes que falham**
  - `test_renovar_de_conta_antiga_nao_pede_calendario` — `escopos=None` → o `data` do POST tem `scope == ESCOPOS_EMAIL` (monkeypatch em `_pedir`). Docstring: sem isto o deploy quebrava o e-mail de todo mundo.
  - `test_conectar_pede_calendario` — `url_autorizacao(...)` contém `Calendars.Read.Shared`.
  - `test_renovar_com_escopos_da_conta`.
  - `test_tem_calendario_sem_caixa`.
- [ ] **Step 2:** Rodar → FAIL. **Step 3:** Implementar. **Step 4:** Rodar suíte inteira → PASS (inclui os testes de e-mail existentes).
- [ ] **Step 5: Commit** `feat(email): escopos por conta e leitura do calendário`

### Task 5: Outlook na agenda — eventos e conflito

**Files:**
- Create: `backend/app/agenda/outlook.py`
- Test: `backend/tests/test_agenda_outlook.py`

**Interfaces:**
- Consumes: `contas.access_token`, `contas.tem_calendario`, `graph.calendario` (Task 4).
- Produces:
  - `async def eventos(conn, user_id: str, de: datetime, ate: datetime) -> tuple[str, list[dict]]` — estado `ok` | `sem_conta` | `sem_permissao` | `erro`; evento normalizado `{titulo, inicio, fim, dia_inteiro, local, ocupado: bool}` (`ocupado = showAs not in ("free","workingElsewhere")`).
  - `def conflitos(eventos: list[dict], inicio: datetime, margem: timedelta = timedelta(minutes=30)) -> list[dict]` — pura; eventos ocupados que cruzam `[inicio - margem, inicio + margem]`; dia inteiro só conta se `ocupado`.

- [ ] **Step 1: Testes que falham:** `test_reuniao_das_9_as_10_conflita_com_lembrete_as_9h30`, `test_evento_livre_nao_conflita`, `test_sem_permissao_nao_chama_graph`.
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `feat(agenda): eventos do Outlook e conflito de horário`

### Task 6: Extrair `disparar_turno` do `POST /send`

**Files:**
- Modify: `backend/app/routers/conversations.py:1224-1291` (`enviar`)
- Test: `backend/tests/test_disparar_turno.py`

**Interfaces:**
- Produces: `async def disparar_turno(agent_id: str, user_id: str, mensagem: str, pergunta_id: str | None = None, prefixo: str = "hsos-") -> str` — faz exatamente o que `enviar` faz depois de montar a mensagem (`cfg.carregar`, `_chave_sessao`, `_ultimo_seq` com `_piso_do_seq`, `run_id = f"{prefixo}{uuid4()}"` — o disparador passa `"hsos-lembrete-"` para contar os turnos do dia, `chat.send` com `agentId` explícito, `_guardar_run`) e devolve o `run_id`. Levanta `ErroGateway` (não `HTTPException`); `enviar` traduz para 502/503 como hoje.
- Docstring: é **a porta única do trabalho autônomo do Guardi** — o run criado conta como turno do dono (`turno_em_curso`), e por isso as ferramentas funcionam.

- [ ] **Step 1: Teste que falha:** `test_disparar_turno_manda_agent_id_e_grava_run_do_dono` (monkeypatch em `obter_cliente`, `_ultimo_seq`, `_piso_do_seq`, `_guardar_run`; confere `agentId`, `sessionKey == _chave_sessao(agent, user)`, `idempotencyKey == run_id` devolvido, `_guardar_run(..., user_id)`).
- [ ] **Step 2:** FAIL. **Step 3:** Extrair; `enviar` passa a chamar `disparar_turno`. **Step 4:** suíte inteira PASS (os testes de `/send` existentes não podem mudar).
- [ ] **Step 5: Commit** `refactor(conversas): disparar_turno, a porta do trabalho autônomo`

### Task 7: Disparador de lembretes

**Files:**
- Create: `backend/app/disparador_lembretes.py`
- Modify: `backend/app/main.py` (lifespan: mesma forma do `rodar_coletor_respostas`, env `DISPARADOR_LEMBRETES_SEGUNDOS`, padrão 30, 0 desliga)
- Modify: `CLAUDE.md` (a lista de variáveis "backend local fala com produção" ganha `DISPARADOR_LEMBRETES_SEGUNDOS=0`)
- Test: `backend/tests/test_disparador_lembretes.py`

**Interfaces:**
- Consumes: `proximo`, constantes (Task 2); `disparar_turno` (Task 6); `turno_em_curso`-like consulta de run aberto.
- Produces:
  - `SQL_RESERVAR` — `UPDATE public.lembretes l SET disparando_em = now() WHERE l.id IN (SELECT … WHERE ativo AND proximo_em <= now() AND (disparando_em IS NULL OR disparando_em < now() - interval '2 minutes') ORDER BY proximo_em LIMIT 20 FOR UPDATE SKIP LOCKED) AND l.ativo AND (l.disparando_em IS NULL OR l.disparando_em < now() - interval '2 minutes') RETURNING …` (guarda repetida no WHERE externo, como `SQL_RESERVAR_RUNS`).
  - `@dataclass Decisao(recado: bool, turno: bool, adiar_ate: datetime | None, status: str | None)`
  - `def decidir(l: dict, agora: datetime, turno_aberto: bool, turnos_hoje: int) -> Decisao` — **pura**:
    - atraso `agora - proximo_em > ATRASO_MAX` → `Decisao(False, False, None, "perdido")`;
    - `turno_pendente_desde` nulo → recado sai;
    - sem `instrucao` → `status="entregue"`, sem turno;
    - `turnos_hoje >= TETO_TURNOS_DIA` → `status="entregue_sem_agente"`;
    - `turno_aberto` e espera `< ADIAMENTO_MAX` → `adiar_ate = agora + ADIAMENTO` (recado só na primeira vez);
    - `turno_aberto` e espera estourada → `entregue_sem_agente`;
    - senão `turno=True`, `status="entregue"`.
  - `async def disparar_um(conn, l: dict, agora: datetime) -> None` — aplica a `Decisao`: recado (`INSERT INTO public.conversations (agent_id, user_id, role, content, media) VALUES ($1, $2::uuid, 'agent', '⏰ Lembrete: ' || titulo, '[{"type":"lembrete","id":…}]')`) **antes** do turno; turno com mensagem `[Lembrete agendado por <primeiro nome> — "<titulo>"] <instrucao>`; `ErroGateway` no turno → `entregue_sem_agente`; avança `proximo_em` (único → `NULL`; recorrente → `proximo(regra, agora)`), grava `ultimo_*`, solta a reserva, zera `turno_pendente_desde` (ou grava `proximo_em = adiar_ate` mantendo o original em `turno_pendente_desde` quando adiado).
  - `async def rodar(parar: asyncio.Event) -> None`.
  - `turnos_hoje` = runs de `agent_runs` do dono com o Guardi abertos pelo disparador hoje (runs com `run_id LIKE 'hsos-lembrete-%'` criados hoje, fuso de Brasília).

- [ ] **Step 1: Testes que falham** (`decidir` puro + `disparar_um` com conexão falsa):
  - `test_atraso_de_7h_vira_perdido_sem_recado`
  - `test_sem_instrucao_so_recado`
  - `test_teto_diario_vira_so_recado`
  - `test_turno_aberto_adia_2_min_e_recado_sai_na_hora`
  - `test_adiado_ha_30_min_desiste_do_turno`
  - `test_recado_e_gravado_antes_do_chat_send` (ordem das chamadas registrada; `chat.send` levantando `ErroGateway` → `ultimo_status == "entregue_sem_agente"` e o INSERT do recado aconteceu)
  - `test_unico_encerra_recorrente_avanca`
  - `test_reserva_tem_a_guarda_no_where_externo` (o SQL contém a condição de `ativo` e de `disparando_em` fora da subconsulta — Review Focus 2 e 5)
- [ ] **Step 2:** FAIL. **Step 3:** Implementar + lifespan. **Step 4:** PASS (suíte inteira).
- [ ] **Step 5: Commit** `feat(agenda): disparador — recado, turno autônomo e tetos`

### Task 8: Ferramentas `agenda_*` do Guardi e `hsos-bot` para todo bot

**Files:**
- Modify: `backend/app/routers/mcp_bot.py` (ferramentas + roteamento em `executar`)
- Modify: `backend/app/email/regras.py` (`FERRAMENTAS_BOT` += `"agenda_criar", "agenda_listar", "agenda_editar", "agenda_apagar"`, na mesma ordem de `FERRAMENTAS`)
- Modify: `backend/app/bots_pessoais.py` (`_proprias`: `hsos-bot-<id>` libera para todo bot quando a entrada existe, sem depender de `sistemas`; `AGENTS.md` do template ganha o ponteiro)
- Modify: `backend/scripts/publicar-bots-mcp.py` (`hsos-bot-<id>` para **todos** os `bots`, não só `com_sistemas`)
- Test: `backend/tests/test_mcp_bot.py`, `backend/tests/test_bots_pessoais.py`, `backend/tests/test_publicar_email_mcp.py`

**Interfaces:**
- Consumes: `dominio.*` (Task 3), `outlook.eventos/conflitos` (Task 5).
- Produces (inputSchema):
  - `agenda_criar {titulo, quando?: "AAAA-MM-DDTHH:MM", repetir?: {tipo, dias?, dia?, hora}, instrucao?}` — exatamente um de `quando`/`repetir`; `criado_por="guardi"`. Resposta: `"Lembrete criado: <titulo> — <próximo em dd/mm às HH:MM>."` + `" Atenção: nesse horário você tem '<evento>' (<HH:MM>–<HH:MM>)."` por conflito (só se `email_ligado` e `estado == "ok"`).
  - `agenda_listar {de?, ate?}` (padrão hoje → +7 dias): lembretes (`id`, título, próximo, repetição, pausado) e, se `email_ligado`, eventos do Outlook marcados `[Outlook]`, tudo em `como_dado_externo`. Sem permissão: linha "reconecte o e-mail em Perfil para eu ver sua agenda do Outlook".
  - `agenda_editar {id, titulo?, quando?, repetir?, instrucao?, pausado?}` · `agenda_apagar {id}`.
  - `taskhs_*` continuam recusadas quando `"taskhs" not in ctx["sistemas"]`; `lembrar` e `agenda_*` não dependem de sistemas.
  - Descriptions: `agenda_criar` diz "Prometeu lembrar a pessoa de algo? Use isto — nunca diga que não tem onde guardar." e "No disparo você recebe a instrucao e trabalha nela".
  - Ponteiro no `AGENTS.md` (template): "Lembrete ou rotina ("me lembra…", "toda segunda…"): `agenda_criar`. Antes de sugerir data ou horário, `agenda_listar` (inclui o Outlook)."

- [ ] **Step 1: Testes que falham:** `test_agenda_criar_sem_taskhs_funciona` (`sistemas=[]`), `test_agenda_criar_avisa_reuniao_no_horario`, `test_agenda_criar_quando_e_repetir_juntos_recusa`, `test_agenda_listar_sem_permissao_pede_reconexao`, `test_hsos_bot_publicado_para_bot_sem_sistemas` (publicar), `test_bot_sem_sistemas_tem_agenda_no_also_allow` (`tools_do_bot`).
- [ ] **Step 2:** FAIL. **Step 3:** Implementar. **Step 4:** suíte inteira PASS; medir `AGENTS.md` do template (< 20.000).
- [ ] **Step 5: Commit** `feat(guardi-agenda): ferramentas agenda_* e hsos-bot para todo Guardi`

### Task 9: API `/agenda/*`

**Files:**
- Create: `backend/app/routers/agenda.py`
- Modify: `backend/app/main.py` (`include_router`)
- Test: `backend/tests/test_agenda_api.py`

**Interfaces:**
- Consumes: `dominio.*`, `outlook.eventos`.
- Produces (todas `usuario_atual`, `sessao(role="service_role")`, filtradas pelo próprio usuário; `RegraInvalida` → 400 com a mensagem; sem Guardi → 404 `"Você ainda não tem Guardi."`):
  - `GET /agenda/lembretes?de&ate` → `{lembretes: [...]}`
  - `POST /agenda/lembretes {titulo, quando?|repetir?, instrucao?}` → lembrete (`criado_por="pessoa"`)
  - `PATCH /agenda/lembretes/{id} {titulo?, quando?, repetir?, instrucao?, pausado?}`
  - `DELETE /agenda/lembretes/{id}` → 204
  - `GET /agenda/outlook?de&ate` → `{estado, eventos}`

- [ ] **Step 1: Testes que falham:** `test_sem_guardi_404`, `test_regra_invalida_400_com_mensagem`, `test_outlook_sem_conta_devolve_estado` (TestClient com `usuario_atual` sobrescrito e domínio monkeypatched).
- [ ] **Step 2–4:** FAIL → implementar → PASS.
- [ ] **Step 5: Commit** `feat(agenda): API da página`

### Task 10: Frontend — página Agenda, recado na conversa e reconexão

**Files:**
- Create: `frontend/src/lib/agenda.ts`, `frontend/src/lib/agenda.test.ts`, `frontend/src/pages/AgendaPage.tsx`, `frontend/src/components/agenda/FormLembrete.tsx`, `frontend/src/components/chat/RecadoLembrete.tsx`
- Modify: `frontend/src/App.tsx` (rota `/agenda` no `AppLayout`, como `/automacoes`), `frontend/src/components/AppSidebar.tsx` e `BottomNav.tsx` (item "Agenda", ícone `CalendarClock`, só quando `GET /bots/meu` responde 200), `frontend/src/pages/ChatPage.tsx:538` e `frontend/src/celular/Midia.tsx:14` (`att.type === "lembrete"` → `RecadoLembrete`), `frontend/src/components/settings/ConectarEmail.tsx` (com conta e `calendario === false`: botão "Reconectar para ver a agenda do Outlook")

**Interfaces:**
- Consumes: API da Task 9; `GET /email/estado` com `calendario` (Task 4).
- Produces em `lib/agenda.ts`:
  - tipos `Lembrete`, `EventoOutlook`, `RegraLembrete`
  - `agruparPorPeriodo(lembretes: Lembrete[], hoje: Date): {hoje, amanha, semana, depois, recorrentes, pausados}` — pura
  - `descreverRegra(r: RegraLembrete): string` — pura ("Toda segunda às 08:00", "Dia 5 de todo mês às 09:00", "11/11 às 09:00")
  - chamadas `listarLembretes`, `criarLembrete`, `editarLembrete`, `apagarLembrete`, `eventosOutlook`

- [ ] **Step 1: Testes que falham** (`agenda.test.ts`): `agruparPorPeriodo` separa hoje/amanhã/semana/depois, recorrente sempre em `recorrentes`, pausado sempre em `pausados`; `descreverRegra` para os cinco tipos.
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/agenda.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `lib/agenda.ts`; depois a página (desktop: lista à esquerda + calendário do mês à direita com pontos de lembrete e de evento; clique no dia filtra; eventos do Outlook em outra cor e só leitura; selo "criado pelo Guardi"; último disparo e status `perdido`/`erro` visíveis. `< 768px`: só a lista), o formulário (título · "o que o Guardi faz na hora" opcional · quando **ou** repetir), o recado na conversa (ícone de relógio + link "ver na Agenda") e o botão de reconexão. Toasts com `sonner`.
- [ ] **Step 4:** `npx vitest run` PASS · `npx tsc --noEmit -p .` limpo · `npm run lint` sem erro novo.
- [ ] **Step 5:** Conferir no navegador (`npm run dev` + backend local com as variáveis de "backend local fala com produção" **e** `DISPARADOR_LEMBRETES_SEGUNDOS=0`): criar, editar, pausar e apagar um lembrete; a página no celular (DevTools 390px) mostra só a lista.
- [ ] **Step 6: Commit** `feat(agenda): página Agenda, recado na conversa e reconexão do Outlook`

### Task 11: Documentação e fechamento

**Files:**
- Modify: `CLAUDE.md` (seção nova "Agenda e lembretes do Guardi — 09/11/2026": tabela, disparador como porta única do trabalho autônomo, tetos, escopo por conta no refresh, `hsos-bot` para todo bot, passos de produção)

- [ ] **Step 1:** Escrever a seção (curta, com os ⚠️ do Review Focus 2–4).
- [ ] **Step 2:** Suíte backend + frontend verdes.
- [ ] **Step 3: Commit** `docs: agenda e lembretes no CLAUDE.md`, merge local na `main`, `git push`.

**Fora do plano (depois do deploy, combinado com o Erick):** `publicar-bots-mcp.py --aplicar` (ensaio mostrado antes), `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`, reconectar o e-mail do Erick e a conferência da spec no `erick-bot`.
