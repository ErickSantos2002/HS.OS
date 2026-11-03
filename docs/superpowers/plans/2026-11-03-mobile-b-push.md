# HS.OS no celular — Frente B (notificações) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o servidor passa a enviar Web Push (resposta de agente, DM, menção, canal não silenciado), coleta a resposta do agente mesmo com a tela fechada, e o front trata permissão, badge, conversa aberta e silenciar canal.

**Architecture:** um trigger novo emite `pg_notify('push_pendente', {tabela, id})` no INSERT de `channel_messages` e de `conversations` (`role='agent'`); o `escuta_banco` encaminha para `app/push_envio.py`, que calcula destinatários com regras puras (`app/push_regras.py`), reserva em `push_enviados` (`ON CONFLICT DO NOTHING`, dedup entre os 2 workers) e envia com `pywebpush` em thread. O miolo do `GET /reply` vira `colher_resposta()`, reaproveitada pela rota e por `app/coletor_respostas.py` (laço no `lifespan`, reserva por run com `coletando_em`). No front, o SW pergunta à aba visível se ela está na conversa (pull por `MessageChannel`) antes de mostrar; no iOS/Safari sempre mostra.

**Tech Stack:** FastAPI, asyncpg, pywebpush, pytest; React + Vite, TanStack Query, workbox/injectManifest.

**Spec:** `docs/superpowers/specs/2026-11-03-mobile-conversas-design.md` (Frente B + "Esclarecimentos da revisão", que prevalecem).

## Global Constraints

- Português em código, comentários e docs; teste com docstring dizendo o que o defeito custaria.
- Migrações novas a partir da `023`; **não aplicar** em banco nenhum; não editar a `001`.
- Sem chaves VAPID: o backend sobe e loga **uma vez** `push desligado: VAPID ausente`.
- Push é acessório: nunca derruba a rota/trigger que o originou (erro → log e segue).
- Payload sem `notification_id`; `body` até 140 caracteres sem markdown; anexo → `📎 arquivo`, áudio → `🎤 áudio`; `tag` por conversa com `renotify: true`.
- `POST /push/enviar` com `user_id` ≠ token → 403. `DELETE /push/inscricao` exige login e confere o dono.
- `@todos` (`(^|\s)@todos\b`, sem caixa) fura o silenciar de todos; menção = `@` + nome de exibição de membro humano, sem caixa nem acento, nome mais longo vence, homônimos todos.
- Silenciar corta push, som e notificação local; sininho e não lidas continuam.
- Não trocar o PWA para `autoUpdate`; `sw.ts`: só `push`/`notificationclick`/badge (precache é da Frente A).
- Desktop não muda de comportamento fora do botão Silenciar e do ícone na lista.

## Review Focus

- Migração não aplicada e código no ar: `/reply` não pode quebrar se `agent_runs.tela_perguntou_em` não existir (lição de 18/09) → teste `test_reply_sobrevive_sem_a_coluna_da_tela`.
- `/recuperar` grava dezenas de respostas antigas de uma vez → só notifica resposta com `created_at` de até 30 min (`test_resposta_antiga_nao_notifica`).
- Corrida coletor × tela no mesmo run → a seleção exige 20 s sem a tela perguntar **e** run com mais de 20 s (`test_selecao_ignora_run_com_tela_esperando`).
- Run que terminou sem texto: o coletor não pode martelar o gateway a cada 5 s → em `erro` a reserva fica (30 s), em `executando` é solta (`test_coletor_solta_reserva_so_quando_executando`).
- Mensagem só com anexo/áudio, ou com markdown/HTML → prévia legível (`test_previa_*`).

---

### Task 1: Migrações 023–026

**Files:** Create `backend/migrations/023_push_enviados.sql`, `024_coletor_respostas.sql`, `025_silenciar_canal.sql`, `026_remover_push_morto.sql`.

- [ ] 023: tabela `push_enviados(mensagem_id uuid, user_id uuid, enviado_em timestamptz default now(), PK(mensagem_id,user_id))`, RLS ligado, `GRANT ALL TO service_role`; função `avisar_push()` (SECURITY DEFINER, engole erro) + triggers `trg_push_pendente` AFTER INSERT em `channel_messages` e em `conversations` `WHEN (NEW.role = 'agent')`, emitindo `pg_notify('push_pendente', json {tabela, id})`.
- [ ] 024: `agent_runs.tela_perguntou_em timestamptz`, `agent_runs.coletando_em timestamptz`, índice parcial `(criado_em) WHERE message_id IS NULL`.
- [ ] 025: `channel_members.silenciado boolean NOT NULL DEFAULT false`.
- [ ] 026: `DROP TRIGGER IF EXISTS` de quem usar `trigger_send_push_on_notification` em `notifications` e `DROP FUNCTION IF EXISTS public.trigger_send_push_on_notification()`.
- [ ] Cada arquivo termina com a consulta de conferência em comentário. Commit.

### Task 2: Regras puras do push (`app/push_regras.py`)

**Interfaces — Produces:**
- `previa(conteudo: str | None, anexos: list | None = None, audio: bool = False) -> str`
- `menciona_todos(conteudo: str) -> bool`
- `mencionados(conteudo: str, membros: list[tuple[str, str]]) -> set[str]` (user_id, nome)
- `@dataclass Membro(user_id: str, nome: str, silenciado: bool)`
- `destinatarios_canal(autor_id: str, membros: list[Membro], conteudo: str, participantes_thread: set[str] | None) -> set[str]`
- `payload_canal(...) -> dict`, `payload_agente(...) -> dict` com `title, body, url, tag, conversa, channel_id?`

- [ ] Testes em `backend/tests/test_push_regras.py`: canal sem silenciado → todos menos autor; silenciado fora; menção fura silenciar; `@todos` fura todos; homônimos; nome mais longo (`@Ana Paula` não notifica `Ana` sozinha); acento/caixa; thread → só participantes + mencionados; prévia (markdown, 140, 📎, 🎤); DM payload title = autor, canal = "Autor em #canal"; agente url `/chat?agent=`.
- [ ] Implementar; rodar; commit.

### Task 3: Envio (`app/push_envio.py`) e escuta

**Interfaces — Produces:** `chaves() -> tuple[str,str,str]`, `ligado() -> bool` (loga uma vez), `async enviar_para(user_id, payload) -> dict`, `async processar(tabela: str, ident: str) -> None`, `SQL_RESERVAR`.
- [ ] Testes `tests/test_push_envio.py`: `enviar_para` usa `asyncio.to_thread`, remove 404/410, segue em outro erro; `processar` só envia para quem a reserva devolveu (conexão falsa); resposta antiga não notifica; sem VAPID não toca banco.
- [ ] `escuta_banco`: `add_listener("push_pendente", ...)` → `disparar(push_envio.processar(...))`. `main.lifespan`: `push_envio.ligado()` uma vez no boot.

### Task 4: Rotas de push e silenciar

- [ ] Testes `tests/test_push_rotas.py`: `/push/enviar` com outro `user_id` → 403; `DELETE /push/inscricao` sem login → 401 e com login filtra por dono; contagem com `endpoint`.
- [ ] `push.py` usa `push_envio`; `GET /push/inscricoes/contagem?endpoint=`.
- [ ] `channels.py`: `GET /channels/silenciados -> list[str]`, `PUT /channels/{id}/silenciar {silenciado: bool}` (404 se não membro). Teste em `tests/test_silenciar_canal.py`.

### Task 5: Extrair `colher_resposta` do `/reply`

**Interfaces — Produces:** `async colher_resposta(agent_id: str, run_id: str, user_id: str, *, espera_ms: int = _ESPERA_MS) -> RespostaOut` — tudo o que o `/reply` faz depois de validar o run (trava, reconferência, `agent.wait`, `chat.history` com `maxChars`/`limit=40`, corte, compactação, gravação com reserva do `message_id`, áudio, `hub.publicar`).
- [ ] Testes `tests/test_colher_resposta.py` com falsos: timeout → `executando`; texto → grava e reserva `message_id`/`seq_depois`; perdeu a corrida → devolve a da outra; rota marca `tela_perguntou_em` e sobrevive sem a coluna.
- [ ] Rota vira casca. Rodar `tests/test_conversations.py` sem mudança.

### Task 6: Coletor (`app/coletor_respostas.py`)

**Interfaces — Produces:** `SQL_RESERVAR_RUNS`, `async passada(conn_factory, colher) -> int`, `async rodar(parar)`; `COLETOR_RESPOSTAS_SEGUNDOS` (padrão 5, 0 desliga).
- [ ] Testes: SQL tem as guardas (sem `message_id`, sem `redireciona_para`, 30 min, 20 s de tela e de criação, `coletando_em` na guarda externa, `SKIP LOCKED`); sem runs não chama `colher`; `executando` solta, `erro` mantém; exceção num run não para os outros.
- [ ] Ligar no `lifespan`.

### Task 7: Front — inscrição, notificação local, SW

- [ ] `push-notifications.ts`: `inscricaoConfirmada()` (contagem por endpoint, cache curto), `unsubscribe` autenticado; `use-auth.signOut` desinscreve antes de limpar o token (com teto de 3 s).
- [ ] `browser-notifications.ts`: só suprime com push confirmado pelo servidor; sem auto-fechamento.
- [ ] `lib/conversa-aberta.ts`: estado da conversa visível; responde ao SW (`esta-na-conversa`), fecha notificações da conversa ao abrir e recalcula badge; `use-notifications.setActiveChannel/Agent` alimentam.
- [ ] `sw.ts`: `push` pergunta às abas visíveis com foco (timeout 400 ms); suprime fora do iOS/Safari; sem 6 s; badge = nº de tags abertas, ou ponto; ações só com `channel_id`; clique foca e navega.
- [ ] `notification-sound.ts`: um `AudioContext`.
- [ ] Teste vitest de `conversa-aberta`.

### Task 8: Front — permissão, silenciar

- [ ] `lib/ios-instalacao.ts` (TODO integração Frente A); banner: iOS fora do app → instrução de instalar; padrão → "Ativar notificações" com `requestPermission` síncrono no clique; negado → como reativar, dispensa permanente.
- [ ] Configurações: desligar apaga a inscrição deste aparelho.
- [ ] `hooks/use-canais-silenciados.ts` + `lib/canais-silenciados.ts`; `BotaoSilenciarCanal` (desktop, no cabeçalho do `ChannelChat`), `IconeSilenciado` no `ChannelSidebarItem`; `use-notifications` corta som/local/toast de canal silenciado salvo `@todos`.
- [ ] `docs/DEPLOY.md`: seção VAPID e coletor.

### Task 9: Verificação

- [ ] `python -m pytest tests -q`; `npm run build && npm run lint && npm run test` (lint sem erro novo frente à main).
