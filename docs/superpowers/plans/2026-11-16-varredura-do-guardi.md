# Varredura do Guardi e quadro da equipe — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todo Guardi faz a varredura da manhã (e a conferência da tarde) das
pendências do dono, grava o resultado, e a `nina` lê tudo, pede de novo quando
precisa e entrega o quadro da equipe ao Nicholson às 08:30.

**Architecture:** Tabela `varreduras` (037) + regras puras em
`app/varredura/regras.py` + operações de banco em `app/varredura/dominio.py`.
O disparo entra como segunda etapa da `passada` do disparador de lembretes e
sempre por `disparar_turno` (a porta única). O Guardi registra pelo
`varredura_registrar` (`hsos-bot-<bot>`); a Nina lê e pede pelo
`hsos-anexos-nina` (identidade assinada).

**Tech Stack:** FastAPI, asyncpg, pytest puro (sem banco: conexões falsas como
em `tests/test_disparador_lembretes.py`), Fernet (`app/email/cifra.py`).

**Spec:** `docs/superpowers/specs/2026-11-16-varredura-do-guardi-design.md`

## Global Constraints

- Todo turno autônomo por `disparar_turno(agent_id, user_id, mensagem, prefixo="hsos-varredura-")` (`app/routers/conversations.py:1284`). Nenhum `chat.send` novo.
- Horários padrão: `manha` 07:30, `tarde` 13:30, `quadro` 08:30, fuso America/Sao_Paulo; banco em UTC.
- Dias úteis = seg–sex menos feriados nacionais (fixos + móveis pela Páscoa).
- Manhã não rodada até 12:00 → `pulada`; tarde até 17:00 → `pulada`; quadro até 11:00 → `pulada`.
- Adiamento por run aberto: passos de 2 min até 30 min, depois `pulada` (mesma regra do lembrete).
- Pedidas: no máximo **2 por pessoa por dia**, intervalo mínimo **30 min**.
- `resumo` ≤ 4.000 caracteres, gravado **cifrado** (`cifrar`/`decifrar` de `app/email/cifra.py`); `numeros` em claro.
- `pendencias_da_equipe`: resumo por pessoa cortado em 600 caracteres, retorno total ≤ 12.000; com `pessoa`, resumo inteiro.
- Chave em `app_settings` `varredura` = `{"ligada": bool, "manha": "07:30", "tarde": "13:30", "quadro": "08:30"}`; ausente = desligada.
- Linha "🔎 A Nina pediu um resumo das suas pendências." com `media [{"type":"varredura_pedida"}]`, sem push.
- Textos e comentários em português. Changelog obrigatório (novidade → minor).
- Migração aplicada por `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-037.py` (perfil admin), conferindo o efeito.

## Review Focus

- **Sistema fora do ar na varredura** → o resumo diz "não consegui ler o X", `numeros.falhas` traz o sistema, e a tarde não conta como "novidade" um sistema que só voltou com zero. Teste em Task 2 (`test_novidade_*`) e Task 5 (validação de `falhas`).
- **Dono conversando com o Guardi às 07:30** → adia, não atropela; passados 30 min, `pulada`. Teste em Task 4.
- **Guardi não chama `varredura_registrar`** (ou o modelo falha) → a varredura vira `sem_registro`, e a Nina vê "sem varredura hoje (o Guardi não registrou)" em vez de zero. Teste em Task 4 e Task 6.
- **Dois workers semeando ao mesmo tempo** → índice único + `ON CONFLICT DO NOTHING`, uma varredura por pessoa/dia/tipo. Teste em Task 3.
- **`varredura_registrar` chamado fora de varredura** (conversa normal, ou injeção pedindo para registrar) → recusa sem gravar. Teste em Task 5.

---

### Task 1: Migração 037 — tabela `varreduras`

**Files:**
- Create: `backend/migrations/037_varreduras.sql`
- Create: `~/aplicar-hsos-037.py` (fora do repo, padrão dos anteriores: `~/aplicar-hsos-036.py`)

**Interfaces:**
- Produces: tabela `public.varreduras` com colunas `id uuid pk default gen_random_uuid()`, `user_id uuid not null references auth.users(id) on delete cascade`, `agent_id text not null`, `dia date not null`, `tipo text check in ('manha','tarde','pedida','quadro')`, `pedida_por text check in ('agenda','nina')`, `status text not null default 'agendada' check in ('agendada','rodando','entregue','nada_novo','sem_registro','pulada','erro')`, `run_id text`, `resumo_cifrado text`, `numeros jsonb`, `proximo_em timestamptz not null`, `disparando_em timestamptz`, `turno_pendente_desde timestamptz`, `criado_em timestamptz default now()`, `entregue_em timestamptz`. Índice único parcial `(user_id, dia, tipo) WHERE tipo <> 'pedida'`; índice `(status, proximo_em)`; índice `(run_id)`. RLS ligada, sem policy. `REVOKE ALL … FROM hsos_agente` explícito.

- [ ] **Step 1:** Escrever a migração, no estilo da `036_lembrete_reconhecido.sql` (cabeçalho com o porquê; idempotente com `IF NOT EXISTS`).
- [ ] **Step 2:** Escrever `~/aplicar-hsos-037.py` como o 036: `bancos.conectar("hsos", perfil="admin")`, executa o arquivo, depois **confere** com `SELECT count(*) FROM information_schema.columns WHERE table_name='varreduras'` (esperado 16) e com a existência do índice único.
- [ ] **Step 3:** Rodar `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-037.py`. Esperado: "16 colunas, índice único ok". (Tabela nova, aditiva: seguro antes do deploy.)
- [ ] **Step 4:** Commit `feat(varredura): migração 037 — tabela varreduras`.

### Task 2: Regras puras — `app/varredura/regras.py`

**Files:**
- Create: `backend/app/varredura/__init__.py`, `backend/app/varredura/regras.py`
- Test: `backend/tests/test_varredura_regras.py`

**Interfaces:**
- Produces:
  - `FUSO = ZoneInfo("America/Sao_Paulo")`; constantes `TETO_RESUMO = 4000`, `TETO_PEDIDAS_DIA = 2`, `INTERVALO_PEDIDAS = timedelta(minutes=30)`, `ADIAMENTO = timedelta(minutes=2)`, `ADIAMENTO_MAX = timedelta(minutes=30)`, `LIMITE = {"manha": time(12), "tarde": time(17), "quadro": time(11)}`, `SISTEMAS = {"taskhs", "hsgrowth", "gestorhs", "email"}`.
  - `feriados(ano: int) -> set[date]` — 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11, 25/12 + Carnaval (seg e ter), Sexta-feira Santa e Corpus Christi a partir da Páscoa (algoritmo de Meeus).
  - `dia_util(d: date) -> bool`.
  - `config(valor: dict | None) -> Config` (dataclass `ligada: bool, manha: time, tarde: time, quadro: time`); valor ausente ou inválido → desligada com os padrões.
  - `horario(cfg: Config, tipo: str, dia: date) -> datetime` (UTC).
  - `velha(tipo: str, proximo_em: datetime, agora: datetime) -> bool` — passou do `LIMITE` local daquele dia.
  - `pode_pedir(pedidas_hoje: list[datetime], agora: datetime) -> tuple[bool, str]` — motivo legível na recusa.
  - `validar_numeros(n: dict) -> dict` — mantém só `SISTEMAS` + `falhas`; cada sistema é `dict[str, int>=0]` com chaves `[a-z_]{1,30}`, no máximo 8 chaves; `falhas` ⊂ `SISTEMAS`; levanta `ValueError` com mensagem para o agente.
  - `novidade(manha: dict | None, tarde: dict) -> tuple[bool, list[str]]` — sem manhã → `(True, ["primeira do dia"])`; alguma contagem subiu → novidade com frase "taskhs.atrasadas: 2 → 3"; sistema em `falhas` de manhã e respondendo à tarde **com alguma contagem > 0** → novidade; sistema que falhou à tarde não gera novidade.

- [ ] **Step 1: Testes que falham** — `test_feriados_2026` (contém `date(2026,2,16)`, `date(2026,2,17)`, `date(2026,4,3)`, `date(2026,6,4)`, `date(2026,11,20)`), `test_sabado_e_feriado_nao_sao_uteis`, `test_config_ausente_e_desligada`, `test_horario_0730_vira_1030_utc`, `test_manha_velha_depois_do_meio_dia`, `test_terceira_pedida_recusada`, `test_pedida_com_menos_de_30_min_recusada`, `test_validar_descarta_sistema_desconhecido`, `test_validar_recusa_negativo`, `test_novidade_quando_atrasadas_sobe` (`{"taskhs":{"atrasadas":2}}` → `{"taskhs":{"atrasadas":3}}` dá `(True, ["taskhs.atrasadas: 2 → 3"])`), `test_sem_novidade_quando_igual_ou_menor`, `test_sistema_que_voltou_com_zero_nao_e_novidade`, `test_sistema_que_voltou_com_pendencia_e_novidade`, `test_sem_manha_e_novidade`.
- [ ] **Step 2:** `cd backend && python -m pytest tests/test_varredura_regras.py -q` → FAIL (módulo inexistente).
- [ ] **Step 3:** Implementar as funções acima.
- [ ] **Step 4:** Rodar de novo → PASS.
- [ ] **Step 5:** Commit `feat(varredura): regras puras (dias úteis, tetos, novidade)`.

### Task 3: Banco — `app/varredura/dominio.py`

**Files:**
- Create: `backend/app/varredura/dominio.py`
- Test: `backend/tests/test_varredura_dominio.py` (conexão falsa que registra SQL e argumentos)

**Interfaces:**
- Consumes: Task 2 (`config`, `horario`, `dia_util`, `pode_pedir`, `validar_numeros`, `novidade`, `TETO_RESUMO`); `cifrar`/`decifrar`.
- Produces (todas `async`, recebem `conn`):
  - `ler_config(conn) -> Config` (lê `app_settings` key `varredura`).
  - `semear(conn, cfg, agora) -> int` — em dia útil, `INSERT … SELECT` das `manha`/`tarde` para todo Guardi com dono ativo (`agent_profiles.dono_id` + `auth.users.is_active`) e da `quadro` para cada `allowed_user_ids` da `nina`; `ON CONFLICT DO NOTHING`; devolve inseridas.
  - `reservar(conn) -> list[dict]` — `agendada` com `proximo_em <= now()` e lease livre (> 10 min), até 10, marca `disparando_em = now()`, `status` segue `agendada`.
  - `marcar(conn, id, status, carimbo, run_id=None, proximo_em=None, pendente_desde=None) -> bool` — só com `disparando_em = carimbo`.
  - `registrar(conn, agent_id, user_id, resumo, numeros) -> dict` — acha a varredura `rodando` do par cujo `run_id` é o run aberto mais recente do dono com o bot (`agent_runs.message_id IS NULL`, < 30 min); ausente → `LookupError`. Para `tipo='tarde'` busca a `manha` do dia (status `entregue`/`nada_novo`) e aplica `novidade`; grava `resumo_cifrado = cifrar(resumo[:TETO_RESUMO])`, `numeros`, `status` (`entregue` ou `nada_novo`), `entregue_em`; devolve `{"status", "novidade", "o_que_mudou"}`.
  - `fechar_sem_registro(conn) -> int` — `rodando` cujo run tem `message_id` ou `coleta_encerrada_em`, ou foi criado há > 30 min → `sem_registro`.
  - `do_dia(conn, dia, user_id=None) -> list[dict]` — junta `profiles` (nome, cargo, departamento), decifra `resumo`; uma linha por pessoa (a mais recente entre `manha`/`tarde`/`pedida` com status `entregue`; senão a última com o status que houver); inclui Guardis sem linha nenhuma (status `sem_varredura`).
  - `pedir(conn, user_id, agora, por: str = "nina") -> tuple[bool, str]` — confere `pode_pedir` nas `pedida` do dia (só para `por='nina'`; o ensaio do admin não conta no teto); insere `tipo='pedida', pedida_por=por, proximo_em=now()`.

- [ ] **Step 1: Testes que falham** — `test_semear_fim_de_semana_nao_insere`, `test_semear_usa_on_conflict` (SQL contém `ON CONFLICT DO NOTHING`), `test_registrar_sem_varredura_rodando_levanta`, `test_registrar_cifra_o_resumo` (o argumento gravado ≠ texto e `decifrar` devolve o texto), `test_registrar_corta_em_4000`, `test_registrar_tarde_sem_novidade_vira_nada_novo`, `test_do_dia_lista_quem_nao_tem_varredura`, `test_pedir_terceira_recusa_sem_inserir`.
- [ ] **Step 2:** `python -m pytest tests/test_varredura_dominio.py -q` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(varredura): operações de banco`.

### Task 4: Disparo — `app/varredura/disparo.py` e a `passada`

**Files:**
- Create: `backend/app/varredura/disparo.py`
- Modify: `backend/app/disparador_lembretes.py` (`passada`, ~:391-441)
- Test: `backend/tests/test_varredura_disparo.py`

**Interfaces:**
- Consumes: Task 3; `disparar_turno`; `_no_cabecalho`, `_primeiro_nome`, `SQL_TURNO_ABERTO` do disparador.
- Produces:
  - `PREFIXO_RUN = "hsos-varredura-"`.
  - `mensagem(tipo: str, nome: str, pedida_por: str) -> str` — cabeçalho `[Varredura da manhã — <Nome>]` / `[Conferência da tarde — <Nome>]` / `[Varredura pedida pela Nina — <Nome>]` / `[Quadro da equipe para <Nome>]`, seguido da instrução. Guardi: consultar os sistemas ligados, chamar `varredura_registrar`, escrever o cardápio curto à pessoa com no máximo uma oferta; tarde: "se a ferramenta disser `novidade: false`, responda só `NO_REPLY`". Quadro (nina): chamar `pendencias_da_equipe`, escrever o quadro por pessoa + destaques, sem inventar número, dizendo quem ficou sem varredura.
  - `disparar_varredura(sessao_fn, v: dict, agora, disparar=None) -> None` — `velha` → `pulada`; turno aberto do par → adia (`ADIAMENTO`, até `ADIAMENTO_MAX` contado de `turno_pendente_desde`, depois `pulada`); `pedida` com `pedida_por='nina'` → grava antes a linha `role='agent'` "🔎 A Nina pediu um resumo das suas pendências." com `media [{"type":"varredura_pedida"}]` e **commita**; então `disparar(...)` e `marcar(... 'rodando', run_id)`. Falha do gateway → `erro`. Quadro (`agent_id='nina'`) não grava linha.
  - Em `passada`, depois dos re-avisos: `cfg = ler_config`; se `cfg.ligada`: `semear`; sempre `fechar_sem_registro`; `reservar` + `disparar_varredura` por item, exceção de um item vira `erro` e não derruba os outros.

- [ ] **Step 1: Testes que falham** — `test_desligada_nao_semeia_nem_dispara`, `test_turno_aberto_adia_2_min`, `test_adiada_30_min_vira_pulada`, `test_manha_depois_do_meio_dia_vira_pulada_sem_chat_send`, `test_pedida_grava_linha_antes_do_chat_send` (ordem do log: INSERT conversations → disparar), `test_run_usa_prefixo_varredura`, `test_gateway_fora_vira_erro`, `test_um_item_quebrado_nao_para_os_outros`, `test_mensagem_da_tarde_menciona_NO_REPLY`, `test_nome_sanitizado_no_cabecalho` (nome com `]` e quebra de linha).
- [ ] **Step 2:** `python -m pytest tests/test_varredura_disparo.py tests/test_disparador_lembretes.py -q` → os novos FAIL, os antigos PASS.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** Os dois arquivos → PASS.
- [ ] **Step 5:** Commit `feat(varredura): disparo pela porta única`.

### Task 5: Ferramenta do Guardi — `varredura_registrar`

**Files:**
- Modify: `backend/app/email/regras.py:20-35` (`FERRAMENTAS_BOT` + `"varredura_registrar"`)
- Modify: `backend/app/routers/mcp_bot.py` (declaração `_f(...)` e despacho, perto de `agenda_*` ~:790)
- Modify: `backend/app/capacidade_assuntos.py` (entrada em `INTERNO`)
- Test: `backend/tests/test_varredura_ferramenta.py`

**Interfaces:**
- Consumes: Task 3 `registrar`; `_contexto` do `mcp_bot` (turno do dono).
- Produces: ferramenta `varredura_registrar {resumo: string, numeros: object}`. A `description` diz: só existe dentro de uma varredura; números saem das consultas, nunca estimados; sistema que falhou vai em `numeros.falhas` e é dito no resumo; assunto e remetente de e-mail podem entrar, corpo não. Retorno JSON `{"status", "novidade", "o_que_mudou", "instrucao"}` — `instrucao` = "responda à pessoa com o cardápio" ou "responda só NO_REPLY".

- [ ] **Step 1: Testes que falham** — `test_fora_de_varredura_recusa_sem_gravar` (nenhum `UPDATE`), `test_numeros_invalidos_recusa_com_mensagem`, `test_tarde_sem_novidade_manda_no_reply`, `test_ferramenta_na_lista_do_bot` (`"varredura_registrar" in FERRAMENTAS_BOT` e a asserção de igualdade do `mcp_bot` continua valendo), `test_todo_item_tem_assunto_ou_e_interno` (já existente) passa.
- [ ] **Step 2:** `python -m pytest tests/test_varredura_ferramenta.py tests/test_capacidade.py -q` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS; rodar a suíte inteira `python -m pytest tests -q` → PASS.
- [ ] **Step 5:** Commit `feat(varredura): varredura_registrar no hsos-bot`.

### Task 6: Ferramentas da Nina — `pendencias_da_equipe` e `pedir_varredura`

**Files:**
- Modify: `backend/app/routers/mcp_anexos.py` (`_FERRAMENTAS` :58, `_FERRAMENTAS_RESTRITAS` :129, despacho ~:515)
- Modify: `backend/app/routers/integracoes.py` (`ferramentas_anexos` ~:1835, se o `toolFilter` não derivar sozinho de `_FERRAMENTAS_RESTRITAS`)
- Create: `backend/app/varredura/quadro.py` (formatação pura)
- Test: `backend/tests/test_varredura_nina.py`

**Interfaces:**
- Consumes: Task 3 `do_dia`, `pedir`.
- Produces:
  - `formatar_equipe(linhas: list[dict], pessoa: str | None) -> str` — topo com totais por sistema e lista de quem está sem varredura e por quê (`sem_registro` → "o Guardi não registrou", `pulada`, `erro`, `sem_varredura`); depois uma seção por pessoa (nome — cargo, hora, números, resumo ≤ 600); teto 12.000 com aviso "(lista cortada: peça por pessoa)".
  - `pendencias_da_equipe {dia?: "AAAA-MM-DD", pessoa?: string}` — `pessoa` casa por nome (sem acento, prefixo) ou e-mail; ambígua → lista as opções.
  - `pedir_varredura {pessoa: string}` — devolve "pedido feito; fica pronto em ~2 min — consulte de novo com pendencias_da_equipe(pessoa=…)" ou o motivo da recusa.
  - As duas em `_FERRAMENTAS_RESTRITAS` com `frozenset({"nina"})`. `description` de `pendencias_da_equipe` carrega a regra "não invente número; quem ficou sem varredura, diga".

- [ ] **Step 1: Testes que falham** — `test_so_a_nina_enxerga` (`ferramentas_de("iris")` não contém as duas; `ferramentas_de("nina")` contém), `test_tools_call_de_outro_agente_recusa`, `test_quem_ficou_sem_varredura_aparece_no_topo`, `test_resumo_cortado_em_600_na_lista`, `test_retorno_nunca_passa_12000`, `test_pessoa_ambigua_lista_opcoes`, `test_pedir_terceira_vez_explica_o_teto`.
- [ ] **Step 2:** `python -m pytest tests/test_varredura_nina.py -q` → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** → PASS.
- [ ] **Step 5:** Commit `feat(varredura): ferramentas da Nina no hsos-anexos`.

### Task 7: Push calado, war-room e a linha na tela

**Files:**
- Modify: `backend/app/push_regras.py` (função nova `cala_push(media) -> bool`, `True` para item `varredura_pedida`) e `backend/app/push_envio.py` (~:240, não envia quando `cala_push`)
- Modify: `backend/app/warroom.py` (`montar_eventos` ganha `varreduras: list` com default `[]`) e `backend/app/routers/warroom.py` (SELECT do dia em `varreduras`, só `user_id`, `agent_id`, `tipo`, `status`, `entregue_em`, `criado_em`)
- Modify: front — o componente que desenha `media` de mensagem do agente (achar por `"lembrete"` em `frontend/src/components/chat/`) para mostrar `varredura_pedida` como linha discreta, sem cartão
- Test: `backend/tests/test_push_regras.py`, `backend/tests/test_warroom.py` (ou o arquivo de testes da war-room existente)

**Interfaces:**
- Produces: eventos `("entrega", "<Guardi> entregou o resumo à Nina")` para `entregue`/`nada_novo` dos tipos `manha`/`tarde`/`pedida`, e `("agente", "Nina pediu um resumo a <Guardi>")` para `pedida`, no horário de `entregue_em`/`criado_em`. `quadro` → "Nina entregou o quadro da equipe".

- [ ] **Step 1: Testes que falham** — `test_varredura_pedida_nao_gera_push`, `test_resposta_comum_continua_com_push`, `test_evento_guardi_entregou_a_nina`, `test_evento_nina_pediu`, `test_sem_varreduras_eventos_iguais_a_antes`.
- [ ] **Step 2:** pytest dos dois arquivos → FAIL.
- [ ] **Step 3:** Implementar back e front.
- [ ] **Step 4:** pytest → PASS; `cd frontend && npm run lint && npm run build` → sem erro.
- [ ] **Step 5:** Commit `feat(varredura): war-room, push calado e a linha da Nina na conversa`.

### Task 8: Instruções dos agentes — Guardi e Nina

**Files:**
- Modify: `backend/app/bots_pessoais.py` (bloco no `AGENTS.md`, ~:278-372; a regra "Nunca respondo `NO_REPLY`" (~:374) ganha a exceção da conferência da tarde)
- Create: `backend/scripts/ponteiro-nina-varredura.py` (ensaio por padrão, `--aplicar`)
- Test: `backend/tests/test_bots_pessoais.py` (estender)

**Interfaces:**
- Produces: bloco `## Varredura` (≤ 1.200 caracteres) no template: quando a mensagem começa por `[Varredura…]`/`[Conferência da tarde…]`, o que consultar por sistema ligado (`taskhs_minhas`; `hsgrowth_consultar` `minhas_tarefas`/`tarefas_atrasadas`/`meus_cards`; `gestorhs_consultar` nas consultas da função; `email_listar so_nao_lidos` dos últimos 3 dias úteis), registrar, e o formato do cardápio (curto, o atrasado primeiro, no máximo uma oferta de preparar). O script da Nina insere uma linha no `AGENTS.md` dela — "Pendências de alguém ou da equipe: `pendencias_da_equipe`; resumo velho: `pedir_varredura`." — **só se `excede_o_teto` for falso**; senão para e diz quanto falta.

- [ ] **Step 1: Testes que falham** — `test_agents_md_tem_bloco_de_varredura`, `test_agents_md_com_bloco_empresa_cabe_no_teto` (renderizado + bloco `hsos:empresa` de 4.000 caracteres < 20.000), `test_excecao_no_reply_so_na_tarde`.
- [ ] **Step 2:** pytest → FAIL.
- [ ] **Step 3:** Implementar o bloco e o script.
- [ ] **Step 4:** pytest → PASS; `python scripts/ponteiro-nina-varredura.py` (ensaio, túnel aberto) mostra o tamanho antes/depois.
- [ ] **Step 5:** Commit `feat(varredura): instruções do Guardi e ponteiro da Nina`.

### Task 9: Ensaio, chave, changelog e documentação

**Files:**
- Create: `backend/scripts/varredura-agora.py` — `--so <user_id>` cria uma `pedida` (`pedida_por='agenda'`) e espera até 4 min mostrando o status e o resumo decifrado; `--ligar` / `--desligar` gravam a chave `varredura` em `app_settings` (admin), com ensaio sem `--aplicar`.
- Modify: `frontend/src/data/changelog.ts` (entrada no topo, minor, `novidade`: "Seu Guardi agora te manda de manhã o que você tem pendente…" e "A Nina passou a reunir as pendências da equipe")
- Modify: `CLAUDE.md` — seção "Varredura do Guardi — 16/11/2026" (porta única, chave, cifra do resumo, `NO_REPLY` só na tarde, ordem de produção)

- [ ] **Step 1:** Implementar o script; rodar `--help`.
- [ ] **Step 2:** `cd frontend && npx vitest run src/test/novidades.test.ts` → PASS.
- [ ] **Step 3:** Suíte inteira do backend `python -m pytest tests -q` → PASS.
- [ ] **Step 4:** Commit `feat(varredura): script de ensaio, changelog e CLAUDE.md`.

### Produção (depois do merge; o deploy é do Erick, no fim do dia)

1. Migração 037 já aplicada (Task 1). Conferir de novo antes do deploy.
2. Deploy do backend e do frontend.
3. `publicar-bots-mcp.py` (ensaio, depois `--aplicar`) — leva `varredura_registrar`.
4. `publicar-anexos-mcp.py --aplicar` — leva as ferramentas da Nina.
5. `criar-bots-pessoais.py --reescrever-agents-md --aplicar --todos`; `ponteiro-nina-varredura.py --aplicar`.
6. Conferência perguntando: ao `erick-bot` "você tem varredura_registrar?" e à `nina` "você tem pendencias_da_equipe?".
7. Ensaio: `varredura-agora.py --so <Erick>` → resumo registrado e mensagem no chat dele.
8. `varredura-agora.py --ligar --aplicar` — os 23 rodam a partir das 07:30 do próximo dia útil; o quadro às 08:30.
