# Conversa consigo mesmo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cada pessoa tem, fixa no topo das conversas (desktop e celular), a conversa "`<Nome> (você)`" — só dela, para anotar, com histórico.

**Architecture:** novo valor `pessoal` no enum `channel_type`; uma por pessoa (índice único parcial em `created_by`); nasce sob demanda pela função `public.minha_conversa_pessoal()` (SECURITY DEFINER, só para `auth.uid()`), exposta em `GET /channels/pessoal`. O resto do sistema filtra por `dm`/`public`/`private` e não a vê; o trabalho é fazê-la aparecer na lista e esconder da tela o que não faz sentido sozinho.

**Tech Stack:** Postgres 18 · FastAPI (pytest puro) · React + TanStack Query (Vitest).

**Spec:** `docs/superpowers/specs/2026-11-10-conversa-consigo-mesmo-design.md`

## Global Constraints

- Nome na tela: **`<full_name> (você)`** (sem nome, o começo do e-mail). No banco, `name = 'Anotações'`, nunca exibido como `#Anotações`.
- Fixa no topo; sem botão de criar; existe para todo mundo desde o primeiro acesso.
- Só a dona/o dono lê e escreve. Administrador **não** renomeia, apaga, nem mexe em membros dela.
- O Guardi e os agentes não leem (o `hsos_agente` já não alcança `channel_messages` — 033).
- Sem vistos, "digitando", push, som, "não lida", painel de membros.
- Função SECURITY DEFINER nova: `REVOKE EXECUTE … FROM PUBLIC` + `GRANT` nominal (regra da 034, `CLAUDE.md`).
- **Migração ANTES do deploy** (a tela chama a rota nova no carregamento). Aplicada por `~/aplicar-hsos-035.py` com o venv do `bancos`, que confere o efeito.
- Changelog: entra na v2.2.0 (ainda não publicada).

## Review Focus

1. **Conta desativada e reativada:** `profiles.py:404` apaga a membresia; a conversa continua com `created_by`. A função tem que **repor a membresia** ao achar a existente, senão a pessoa reativada ganha uma conversa que não lê. (Task 1)
2. **Dois carregamentos simultâneos** no primeiro acesso não criam duas (índice + `ON CONFLICT`). (Task 1)
3. **Administrador** com `has_role` tentando `UPDATE`/`DELETE` no canal pessoal de outra pessoa — policies hoje deixam. (Task 1)
4. **Busca global e "abrir pela notificação"** chegando com `?channel=<id>` da pessoal: tem que abrir a conversa com o nome "(você)", não "#Anotações". (Tasks 4–5 usam `ehPessoal` em todo título)
5. **Celular, filtros da lista** ("Pessoas", "Canais", busca): a pessoal não pode sumir em "Tudo" nem virar canal. (Task 5)

---

### Task 1: Migração `035_conversa_pessoal.sql`

**Files:**
- Create: `backend/migrations/035_conversa_pessoal.sql`
- Create: `~/aplicar-hsos-035.py`

**Interfaces:**
- Produces: enum `channel_type` com `pessoal`; índice `channels_pessoal_um_por_pessoa ON public.channels (created_by) WHERE type = 'pessoal'`; função `public.minha_conversa_pessoal() RETURNS uuid` (SECURITY DEFINER, `search_path = public`): exige `auth.uid()`, acha ou cria (`INSERT … ON CONFLICT (created_by) WHERE type = 'pessoal' DO NOTHING`, depois relê) e garante a linha `(canal, auth.uid()::text, 'human')` em `channel_members`; EXECUTE só para `authenticated` e `service_role`.

- [ ] **Step 1:** Escrever a migração. ⚠️ `ALTER TYPE public.channel_type ADD VALUE IF NOT EXISTS 'pessoal'` fica **fora** do `BEGIN … COMMIT` do resto (valor novo não pode ser usado na transação que o cria). No bloco transacional: índice, função, grants, e as policies:
  - `channels` "Channel creator or admin can update" e "… can delete": recriar com `created_by = auth.uid() OR (has_role(auth.uid(), 'administrador') AND type <> 'pessoal')`.
  - `channel_members` "Channel managers remove members": o ramo de criador/admin passa a exigir `c.type <> 'pessoal'`.
  Cabeçalho explica o porquê (spec + "por que tipo próprio e não DM com flag").
- [ ] **Step 2:** `~/aplicar-hsos-035.py` aplica em duas execuções (enum; resto) e confere **dentro de uma transação que termina em ROLLBACK** (nada fica): como `authenticated` com `app.current_user_id = A` (um id real de `profiles`), `minha_conversa_pessoal()` duas vezes → mesmo id; apagar a membresia de A e chamar de novo → membresia reposta, mesmo id; como B → `SELECT … FROM channels/channel_messages WHERE channel_id = <de A>` = 0 linhas; como um administrador (≠ A) → `UPDATE channels SET name='x' WHERE id=<de A>` afeta 0 linhas e `DELETE` idem. E fora da transação: `has_function_privilege('hsos_agente', 'public.minha_conversa_pessoal()', 'EXECUTE')` falso.
- [ ] **Step 3:** Rodar `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-035.py` → `ok`.
- [ ] **Step 4:** Commit da migração.

### Task 2: Backend — rota e guardas

**Files:**
- Modify: `backend/app/routers/channels.py` (rota nova antes de `GET /{channel_id}`; guardas em `adicionar_membros` e na remoção de membro, ~l.1575 e ~l.1647)
- Modify: `backend/app/routers/conversations.py` (~l.2045, abrir DM)
- Modify: `backend/app/routers/broadcast.py` (`publicar_em_canal`, `ler_canal`)
- Test: `backend/tests/test_conversa_pessoal.py`

**Interfaces:**
- Produces: `GET /channels/pessoal` → `{"channel_id": str}` (chama `minha_conversa_pessoal()` como `authenticated`); `TIPOS_SEM_MEMBROS = {"dm", "pessoal"}` em `channels.py`; `conferir_alvo_da_dm(alvo: str, eu: str) -> None` (levanta 400) em `conversations.py`; `SQL_CANAL_POR_NOME` em `broadcast.py`, com `AND type <> 'pessoal'`.

- [ ] **Step 1: testes que falham**
  - `test_pessoal_nao_se_cria_por_post`: `"pessoal" not in channels._TIPOS`.
  - `test_dm_e_pessoal_nao_mexem_em_membros`: `TIPOS_SEM_MEMBROS == {"dm", "pessoal"}`.
  - `test_dm_consigo_mesmo_recusada`: `conferir_alvo_da_dm("u1", "u1")` levanta `HTTPException` 400; com `"u2"` não levanta. Docstring: o `find_or_create_dm` casa `cm1` e `cm2` na mesma linha e devolveria uma DM qualquer de quem chama.
  - `test_broadcast_nao_alcanca_conversa_pessoal`: `"type <> 'pessoal'" in broadcast.SQL_CANAL_POR_NOME` — docstring: toda pessoal se chama "Anotações", e o `name ILIKE` abriria a de qualquer pessoa.
- [ ] **Step 2:** `python -m pytest tests/test_conversa_pessoal.py -q` → FAIL.
- [ ] **Step 3:** Implementar. Nas duas guardas de membro, trocar `tipo == "dm"` por `tipo in TIPOS_SEM_MEMBROS` (mensagem para pessoal: "A sua conversa pessoal é só sua."). Em `ler_canal` e `publicar_em_canal`, usar `SQL_CANAL_POR_NOME`.
- [ ] **Step 4:** `python -m pytest tests -q` → tudo passa.
- [ ] **Step 5:** Commit.

### Task 3: Front — módulo da conversa pessoal

**Files:**
- Create: `frontend/src/lib/conversa-pessoal.ts`, `frontend/src/lib/conversa-pessoal.test.ts`
- Create: `frontend/src/hooks/use-conversa-pessoal.ts`
- Modify: tipo do canal em `frontend/src/hooks/use-channels.ts` (união ganha `"pessoal"`)

**Interfaces:**
- Produces: `ehPessoal(c: { type: string } | null | undefined): boolean`; `nomeDaConversaPessoal(fullName: string | null | undefined, email: string | null | undefined): string`; `PLACEHOLDER_PESSOAL = "Anote algo para você…"`; `useConversaPessoal(): { canalId: string | null }` — `useQuery(["conversa-pessoal", userId], GET /channels/pessoal)`, `staleTime: Infinity`, e ao obter o id **pela primeira vez** chama o `refetch` da lista de canais se o id ainda não estiver nela.

- [ ] **Step 1: testes** — `nomeDaConversaPessoal("Erick Santos", "e@x")` → `"Erick Santos (você)"`; `(null, "erick@hs.com")` → `"erick (você)"`; `("", null)` → `"Você"`; `ehPessoal({type:"pessoal"})` true, `{type:"dm"}` false, `null` false.
- [ ] **Step 2:** `npx vitest run src/lib/conversa-pessoal.test.ts` → FAIL; implementar; → PASS.
- [ ] **Step 3:** Commit.

### Task 4: Desktop — lista e tela

**Files:**
- Modify: `frontend/src/pages/ChatPage.tsx` (aba de DMs ~l.1884–1930; título/seleção ~l.2434)
- Modify: `frontend/src/components/chat/ChannelChat.tsx` (`isDm`/`canEdit`/`displayName` ~l.1222; vistos; "digitando"; cabeçalho; placeholder ~l.2028; envio ~l.1552)
- Test: `frontend/src/components/chat/ChannelChat.pessoal.test.tsx`

**Interfaces:**
- Consumes: `useConversaPessoal`, `ehPessoal`, `nomeDaConversaPessoal`, `PLACEHOLDER_PESSOAL` (Task 3).

- [ ] **Step 1:** Na aba de DMs, um item `kind: "eu"` **antes** de `listaPessoas`, fora do `ordenarConversas` e sem contador; aparece quando `canalId` existe e a busca casa com o nome. Foto do próprio perfil. Clique seleciona o canal (mesmo caminho de uma DM com `canalId`).
- [ ] **Step 2:** `ChannelChat` com `isPessoal = ehPessoal(channel)`: `displayName` = `nomeDaConversaPessoal(profile)`; `canEdit = false`; sem botão de membros/adicionar/sair/apagar; sem `visto` nas bolhas; não chama `notifyTyping` nem mostra "digitando"; placeholder `PLACEHOLDER_PESSOAL`; `onReply` continua.
- [ ] **Step 3:** Teste: renderizar o cabeçalho/bolha com `channel.type = "pessoal"` → título "Erick Santos (você)", nenhum `aria-label`/título de visto, placeholder certo. (Se montar o `ChannelChat` inteiro for caro, testar os pedaços extraídos — `MessageBubble` sem `visto`, e o título por `nomeDaConversaPessoal`.)
- [ ] **Step 4:** `npm run test` e `npm run build` → passam. Commit.

### Task 5: Celular — lista e tela

**Files:**
- Modify: `frontend/src/celular/lista.ts` (`ItemCelular.tipo` ganha `"pessoal"`; `montarLista`), `frontend/src/celular/lista.test.ts` (ou o teste existente de `montarLista`)
- Modify: `frontend/src/celular/use-lista.ts` (~l.176: pular `pessoal` no laço de canais; acrescentar o item)
- Modify: `frontend/src/celular/TelaConversaCanal.tsx` (~l.111–115, 261, 270, 388, 425)

- [ ] **Step 1: teste de `montarLista`:** com um item `tipo: "pessoal"` e outros com não lidas, ele vem **primeiro** em "tudo" e em "pessoas", some em "agentes" e "canais", e respeita a busca pelo nome.
- [ ] **Step 2:** FAIL → implementar → PASS.
- [ ] **Step 3:** `use-lista`: item `{ chave: "pessoal", tipo: "pessoal", id: canalId, canalId, nome: nomeDaConversaPessoal(...), previa: previaDe(canalId), naoLidas: 0, silenciado: false, pensando: false }`; o laço de canais pula `ehPessoal(c)`. `TelaConversaCanal`: título "(você)", avatar próprio, sem "digitando", sem a entrada "Participantes"/"Ver perfil" do ⋮, placeholder.
- [ ] **Step 4:** `npm run test` → passa. Commit.

### Task 6: Fechamento

- [ ] **Step 1:** Changelog, na v2.2.0: novidade "Conversa com você mesmo, fixa no topo das conversas: anote, guarde links e arquivos — só você vê." e correção de segurança dita para o usuário: "Os agentes deixaram de ter acesso às conversas entre pessoas."
- [ ] **Step 2:** `CLAUDE.md`: parágrafo curto (tipo `pessoal`, uma por pessoa, função, o que fica escondido, admin não toca) na seção de canais/celular.
- [ ] **Step 3:** `docs/CONTINUAR-AQUI.md`: deploy pendente com a ordem — migrações 033/034 já aplicadas, **035 aplicada antes do deploy**.
- [ ] **Step 4:** Revisão final do branch, merge na `main`, push.
