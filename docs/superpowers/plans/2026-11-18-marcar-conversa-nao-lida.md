# Marcar conversa como não lida — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a pessoa marca uma conversa já lida como "voltarei aqui", pela lista (desktop e celular); a conversa mostra uma bolinha sem número até ser aberta de novo.

**Architecture:** tabela própria `conversas_marcadas` (não é notificação), três rotas FastAPI, um store de módulo no front assinando `usuario:<id>`, regra pura do indicador compartilhada pelas duas listas. A marca some no efeito que torna a conversa ativa.

**Tech Stack:** Postgres 18 · FastAPI/asyncpg · React + Vite · Vitest · pytest.

**Spec:** `docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md`

## Global Constraints

- Coluna é `canal_id` (NÃO `channel_id`) e o trigger é próprio, só `{tabela, op, user_id}`.
- `user_id` sempre do token; canal exige `membro_do_canal(conn, canal, user, "human")`; agente exige `public.pode_ver_agente($1::uuid, $2)`.
- Permissões como a `032`: `ENABLE ROW LEVEL SECURITY`, `REVOKE ALL … FROM PUBLIC, anon, authenticated`, `GRANT SELECT, INSERT, UPDATE, DELETE … TO service_role`.
- A marca NÃO soma em número nenhum (aba, sininho, ícone do app).
- Português em código, comentário e texto de tela. Texto do menu: "Marcar como não lida" / "Marcar como lida".
- Changelog: `2.16.0`, `novidade`, no topo de `frontend/src/data/changelog.ts`.

## Review Focus

1. Abrir a conversa marcada no desktop com ela JÁ aberta (marcar a conversa ativa pela lista): a marca fica até a pessoa sair e voltar — não some no re-sweep de 2 s. → teste na Task 4.
2. Marcar DM de pessoa sem canal ainda (pessoa que nunca conversou): o menu não oferece a opção. → teste na Task 3 (`podeMarcar`).
3. Conversa marcada E com não lida nova: mostra o número, não a bolinha; ao abrir, as duas somem. → teste na Task 3.
4. Dois cliques rápidos em "Marcar" (ou marcar em dois aparelhos): sem erro, uma linha só (`ON CONFLICT DO NOTHING`). → teste na Task 2.
5. Pessoa removida do canal com marca ativa: a marca não reaparece com acesso negado nem quebra o GET (o GET filtra por membro). → teste na Task 2.

---

### Task 1: Migração `039_conversas_marcadas.sql`

**Files:**
- Create: `backend/migrations/039_conversas_marcadas.sql`
- Create: `~/aplicar-hsos-039.py` (fora do repo; padrão dos `~/aplicar-hsos-0NN.py`)

**Interfaces:**
- Produces: `public.conversas_marcadas(id uuid pk default gen_random_uuid(), user_id uuid not null → profiles(id) on delete cascade, canal_id uuid → channels(id) on delete cascade, agent_id text, marcada_em timestamptz not null default now())`, `CHECK ((canal_id IS NULL) <> (agent_id IS NULL))`, índices únicos parciais `(user_id, canal_id) WHERE canal_id IS NOT NULL` e `(user_id, agent_id) WHERE agent_id IS NOT NULL`; função `public.notificar_conversa_marcada()` + trigger `AFTER INSERT OR DELETE FOR EACH ROW` → `pg_notify('hsos_mudancas', json_build_object('tabela','conversas_marcadas','op',TG_OP,'id',…,'user_id',…)::text)`. A função: `REVOKE EXECUTE … FROM PUBLIC` (regra da `034`).

- [ ] **Step 1:** escrever a migração com cabeçalho explicando por que não é notificação e por que `canal_id`.
- [ ] **Step 2:** validar num Postgres limpo com `000`–`038` aplicados (`backend/migrations/_testes`, ou container de `~/projetos/postgres-teste/`). Esperado: 0 erros; `INSERT` com os dois alvos nulos falha no CHECK.
- [ ] **Step 3:** escrever `~/aplicar-hsos-039.py` (`bancos.conectar(..., perfil="admin")`), que aplica e CONFERE: tabela existe e `has_table_privilege('service_role','public.conversas_marcadas','INSERT')` = true. Não rodar ainda (Task 7).
- [ ] **Step 4:** commit `feat(conversas): migração 039 conversas_marcadas`.

### Task 2: Rotas `/conversas/marcadas`

**Files:**
- Create: `backend/app/conversas_marcadas.py` (regra pura)
- Create: `backend/app/routers/conversas_marcadas.py`
- Modify: `backend/app/main.py` (`include_router`)
- Test: `backend/tests/test_conversas_marcadas.py`

**Interfaces:**
- Produces (puro): `alvo_da_marca(canal_id: str | None, agent_id: str | None) -> tuple[str, str]` → `("canal", uuid)` ou `("agente", id)`; `ValueError` com nenhum, os dois, ou `canal_id` que não é uuid.
- Produces (HTTP, `usuario_atual`):
  - `GET /conversas/marcadas` → `[{"canal_id": str | None, "agent_id": str | None, "marcada_em": iso}]`, só do usuário, e só canal de que ele ainda é membro.
  - `PUT /conversas/marcadas?canal_id=|agent_id=` → 204; idempotente (`ON CONFLICT DO NOTHING`); 400 de `alvo_da_marca`; 403 sem acesso.
  - `DELETE /conversas/marcadas?canal_id=|agent_id=` → 204, mesmo sem linha.

- [ ] **Step 1: testes que falham** — `test_alvo_exige_exatamente_um` (nenhum/os dois → ValueError), `test_canal_precisa_ser_uuid`, `test_put_recusa_canal_de_quem_nao_e_membro` (conexão falsa com `membro_do_canal` → False ⇒ 403, nenhum INSERT), `test_put_duas_vezes_nao_erra` (SQL usado contém `ON CONFLICT DO NOTHING`; segundo PUT 204), `test_get_so_devolve_canal_de_que_ainda_e_membro` (o SQL junta `channel_members` com `member_type='human'`), `test_user_id_vem_do_token` (query string com `user_id` é ignorada). Padrão de conexão falsa: `tests/test_varredura_ferramenta.py`.
- [ ] **Step 2:** `cd backend && .venv/bin/python -m pytest tests/test_conversas_marcadas.py -q` → FAIL (módulo inexistente).
- [ ] **Step 3:** implementar; `sessao(role="service_role")`; reaproveitar `membro_do_canal` de `app/routers/anexos.py` e `pode_ver_agente`.
- [ ] **Step 4:** pytest do arquivo → PASS; suíte inteira `python -m pytest tests -q` → tudo verde.
- [ ] **Step 5:** commit `feat(conversas): rotas para marcar conversa como não lida`.

### Task 3: Regra pura do indicador e da ordem

**Files:**
- Create: `frontend/src/lib/conversa-marcada.ts`
- Modify: `frontend/src/lib/lista-de-conversas.ts` (`ItemDaLista.marcada?: boolean`; `ordenarConversas` sobe `naoLidas > 0 || marcada`)
- Test: `frontend/src/lib/conversa-marcada.test.ts`, `frontend/src/lib/lista-de-conversas.test.ts`

**Interfaces:**
- Produces:
  - `type Indicador = { tipo: "numero"; texto: string } | { tipo: "marca" } | null`
  - `indicadorDaConversa(naoLidas: number, marcada: boolean): Indicador` — número (via `rotuloDoContador`) vence a marca.
  - `indicadorDaAba(itens: ReadonlyArray<{ naoLidas: number; marcada?: boolean }>): Indicador` — número da soma (`somarNaoLidas`) se > 0; senão marca se alguma marcada; senão null.
  - `podeMarcar(alvo: { canalId: string | null; agentId: string | null }): boolean` — falso sem nenhum dos dois.
  - `chaveDaMarca(alvo): string` — `canal:<id>` ou `agente:<id>`.

- [ ] **Step 1: testes que falham** — `indicadorDaConversa(0,true)` → `{tipo:"marca"}`; `(3,true)` → `{tipo:"numero",texto:"3"}`; `(0,false)` → null; `(120,false)` → texto "99+". `indicadorDaAba([{naoLidas:0,marcada:true}])` → marca; `([{naoLidas:2},{naoLidas:0,marcada:true}])` → número "2". `podeMarcar({canalId:null,agentId:null})` → false. Em `lista-de-conversas.test.ts`: `ordenarConversas` põe a marcada (naoLidas 0) acima de uma mais recente não marcada.
- [ ] **Step 2:** `cd frontend && npx vitest run src/lib/conversa-marcada.test.ts src/lib/lista-de-conversas.test.ts` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS.
- [ ] **Step 5:** commit `feat(conversas): regra do indicador da conversa marcada`.

### Task 4: Store, limpeza ao abrir e saída do "por mensagem"

**Files:**
- Create: `frontend/src/lib/conversas-marcadas-store.ts`, `frontend/src/hooks/use-conversas-marcadas.ts`
- Modify: `frontend/src/hooks/use-conversa-ativa.ts`, `frontend/src/lib/acoes-da-mensagem.ts` (remover as duas entradas "Marcar como não lida", linhas ~28 e ~61, e o que ficar sem uso)
- Test: `frontend/src/lib/conversas-marcadas-store.test.ts`, `frontend/src/hooks/use-conversa-ativa.test.tsx`

**Interfaces:**
- Consumes: `chaveDaMarca`, `podeMarcar` (Task 3); rotas da Task 2; `assinar` de `lib/realtime`.
- Produces:
  - store de módulo (uma carga por aba): `carregar(): Promise<void>`, `estaMarcada(alvo): boolean`, `marcar(alvo): Promise<boolean>`, `desmarcar(alvo): Promise<boolean>`, `assinarMudancas(fn): () => void`. Otimista: muda local antes da rota e desfaz se ela falhar. Recarrega ao receber `usuario:<id>` com `tabela === "conversas_marcadas"` e em `visibilitychange`.
  - `useConversasMarcadas(): { estaMarcada, marcar, desmarcar }` (via `useSyncExternalStore`).
- `useConversaAtivaNasNotificacoes`: ao tornar ativa (`ativa` && alvo mudou), `desmarcar` UMA vez por abertura — fora do `setTimeout` de 2 s.

- [ ] **Step 1: testes que falham** — store: `marcar` deixa `estaMarcada` true antes da rota responder e volta a false se ela rejeitar; evento `usuario:` de outra tabela não recarrega. Hook: abrir a conversa marcada chama `desmarcar` uma vez; avançar 2 s (`vi.advanceTimersByTime(2000)`) não chama de novo; marcar a conversa já ativa (sem mudar alvo) não desmarca. Remoção: `acoesDaMensagem(...)` não devolve item com rótulo "Marcar como não lida".
- [ ] **Step 2:** `npx vitest run src/lib/conversas-marcadas-store.test.ts src/hooks/use-conversa-ativa.test.tsx` → FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** mesmo comando → PASS; `npm run test` inteiro → verde.
- [ ] **Step 5:** commit `feat(conversas): store da marca e limpeza ao abrir; sai o marcar por mensagem`.

### Task 5: Lista do desktop

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx` (itens das listas ~1890–1960 recebem `marcada`; render ~2390–2440; contadores das abas DMs/Agentes/Canais)

**Interfaces:**
- Consumes: `useConversasMarcadas`, `indicadorDaConversa`, `indicadorDaAba`, `podeMarcar` (Tasks 3–4).

- [ ] **Step 1:** cada item ganha `marcada: estaMarcada({canalId, agentId})`; onde hoje desenha `item.naoLidas`, desenhar `indicadorDaConversa` — `marca` = bolinha do mesmo tom do contador, sem texto, `aria-label="Marcada como não lida"`.
- [ ] **Step 2:** ⋮ no hover do item (shadcn `DropdownMenu`) e `onContextMenu` abrindo o mesmo menu: "Marcar como não lida" / "Marcar como lida"; oculto quando `!podeMarcar`. O clique no ⋮ não abre a conversa (`stopPropagation`).
- [ ] **Step 3:** abas usam `indicadorDaAba`.
- [ ] **Step 4:** `npm run lint && npm run test` → verde; conferir no navegador (`npm run dev`, backend local com os coletores em 0 — ver CLAUDE.md): marcar, ver bolinha, abrir, sumir; marcar em uma aba e ver na outra.
- [ ] **Step 5:** commit `feat(chat): marcar conversa como não lida na lista do desktop`.

### Task 6: Lista do celular

**Files:**
- Modify: `frontend/src/celular/lista.ts` (`ItemCelular.marcada: boolean`; `naoLidasPorChip` passa a `indicadorPorChip` com `indicadorDaAba`), `frontend/src/celular/use-lista.ts`, `frontend/src/celular/TelaInicio.tsx`
- Test: `frontend/src/celular/lista.test.ts`

**Interfaces:**
- Consumes: Tasks 3–4; `lib/toque-longo.ts` (450 ms) e `FolhaDeAcoes` (`celular/Folhas.tsx`).
- Produces: `indicadorPorChip(itens: ItemCelular[]): Record<TipoItem, Indicador>`.

- [ ] **Step 1: teste que falha** — `indicadorPorChip` com só uma pessoa marcada → `pessoa: {tipo:"marca"}`; `montarLista` NÃO muda a ordem por causa da marca.
- [ ] **Step 2:** `npx vitest run src/celular/lista.test.ts` → FAIL; implementar; → PASS.
- [ ] **Step 3:** segurar o item abre `FolhaDeAcoes` com a ação (oculta quando `!podeMarcar`); o toque curto continua abrindo a conversa. Badge do item: `indicadorDaConversa`, classe `cel-badge marca` (bolinha sem texto em `celular.css`).
- [ ] **Step 4:** `npm run lint && npm run test` → verde; conferir no navegador em 390px.
- [ ] **Step 5:** commit `feat(celular): marcar conversa como não lida segurando na lista`.

### Task 7: Changelog, documentação e produção

**Files:**
- Modify: `frontend/src/data/changelog.ts`, `CLAUDE.md` (seção curta perto de "Vistos por mensagem")

- [ ] **Step 1:** changelog `2.16.0` (data `2026-11-18`, `novidade`): "Agora dá para marcar uma conversa como não lida pela lista — segure a conversa no celular, ou use o ⋮ / clique direito no computador. Ela fica com uma bolinha sem número até você abrir de novo, para lembrar de voltar nela." `npx vitest run src/test/novidades.test.ts` → PASS.
- [ ] **Step 2:** CLAUDE.md: por que não é notificação (re-sweep de 2 s), `canal_id` e o trigger próprio, a marca não soma número.
- [ ] **Step 3:** commit; merge local na `main`; `git push`.
- [ ] **Step 4:** `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-039.py` — saída com a conferência verdadeira (migração ANTES do deploy). O deploy fica para o fim do dia.
