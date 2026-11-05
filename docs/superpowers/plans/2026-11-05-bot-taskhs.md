# Bot no TaskHS + memória — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (inline). Passos em checkbox.

**Objetivo:** o `erick-bot` lê e age no TaskHS como o Erick (token de agente) e aprende com `lembrar`. A escrita passa por um cartão de confirmação genérico.

**Spec:** `docs/superpowers/specs/2026-11-05-bot-sistemas-internos-design.md`. O GestorHS fica fora deste plano ("um de cada vez", decisão do Erick).

**Contrato do TaskHS** (main `48832b0`, sem deploy):
- JWT EdDSA com `iss=hsos`, `aud=taskhs`, `sub=<e-mail exato>`, `act.sub`; o `exp` pode estar no máximo 600 s à frente. Sem a env `HSOS_AGENTE_CHAVE_PUBLICA` no EasyPanel, tudo dá 401.
- `GET /api/cards/minhas?abertas=true` devolve `[{id,title,board_id,board_title,list_id,list_title,due_date,due_date_completed,priority,done}]`.
- Rotas usadas:
  - `GET /api/auth/me`, `GET /api/boards`, `GET /api/boards/{id}/snapshot`, `GET /api/search?q=`
  - `GET|PATCH /api/lists/{l}/cards/{c}` (`CardUpdate`: `title`, `description`, `priority`, `due_date`, `due_date_completed`, `done`, `list_id`, `position`)
  - `POST /api/lists/{l}/cards` (`CardCreate`: `title`, `description`, `priority`, `due_date`)
  - `POST /api/lists/{l}/cards/{c}/comments` (`{body}`)

## Restrições globais

- Token: `exp = iat + 300`, `jti = uuid4`, `sub` = e-mail do perfil **exatamente como está** (o TaskHS não faz `lower()`). Emitido por chamada, nunca guardado.
- `TASKHS_API_URL` (padrão `https://taskhsapi.healthsafetytech.com/api`).
- Leitura sai direto; **toda escrita vira `acoes_pendentes` + cartão** `media[{type:"acao_aprovacao", id}]`. A aprovação é só do dono (404 para outros), vale 24 h, e a linha é travada com `FOR UPDATE`.
- O MCP `hsos-bot-<bot>` tem HMAC `"bot:" + id` com o `ANEXOS_MCP_SEGREDO`, só no turno do dono e recusa com turno de outra pessoa (reaproveita `_contexto`/`outro_turno_aberto` do e-mail sem a parte de token Microsoft).
- O que volta do TaskHS é entregue com `como_dado_externo`.
- `lembrar`: uma linha saneada (`_linha`), no máximo 300 caracteres, com data; o `MEMORY.md` tem teto de 6.000 caracteres; só no turno do dono.
- Flag `agent_profiles.sistemas_ligados text[]`. A entrada do bot é publicada quando a lista não está vazia.

## Foco de revisão

1. Escrita no TaskHS sem o clique: nenhuma ferramenta faz POST/PATCH direto. Teste na Tarefa 3.
2. Token para outro sistema ou para outra pessoa: `aud` fixo por cliente; `sub` sempre o e-mail do **dono** resolvido pelo `dono_id`, nunca vindo de argumento. Teste na Tarefa 1.
3. Ação aprovada diferente da mostrada: o cartão mostra o `payload` gravado, e quem executa é esse `payload`, nunca o agente. Teste na Tarefa 2.
4. `lembrar` estourando o teto ou injetando seção no `MEMORY.md`. Teste na Tarefa 3.
5. O recálculo de deny dando `hsos-bot-*` a especialista, ou rodar o `criar-bots` de novo e tirar a entrada. Teste na Tarefa 4.

---

### Tarefa 1: emissor do token + cliente TaskHS

**Arquivos:** `backend/app/agente_token.py`, `backend/app/sistemas/__init__.py`, `backend/app/sistemas/taskhs.py`, `backend/app/config.py` (`TASKHS_API_URL`), rota `GET /agente/chave-publica` (em `routers/email.py` ou num router `agente`), teste `backend/tests/test_agente_token.py`.

- `token_de_agente(aud: str, email: str, bot: str) -> str`: EdDSA com a chave do `settings.AGENTE_CHAVE_PRIVADA` (desfaz o `\n`).
- `chave_publica_pem() -> str`.
- `taskhs.chamar(email, bot, metodo, caminho, json=None, params=None) -> Any`: `httpx` com timeout de 15 s e `_transporte` trocável. Erros viram `ErroSistema(status, msg)`: 401 → "você não tem acesso ao TaskHS (ou o TaskHS ainda não aceita o bot)", 403 → "o TaskHS não deixa o agente fazer isso", 404 → "não encontrado".
- [ ] Testes:
  - o token verifica com a pública e tem `aud`, `iss`, `sub`, `act.sub` e `exp - iat == 300`;
  - não verifica com outra chave;
  - o cliente manda `Authorization: Bearer` com `aud=taskhs`;
  - 401 vira a mensagem de acesso.

  → FALHA → implementar → PASSA → commit.

### Tarefa 2: migração 029 + ações pendentes

**Arquivos:** `backend/migrations/029_bots_sistemas.sql`, `~/aplicar-hsos-029.py`, `backend/app/acoes.py`, `backend/app/routers/acoes.py`, teste `backend/tests/test_acoes_pendentes.py`.

- `029`:
  - `agent_profiles.sistemas_ligados text[] NOT NULL DEFAULT '{}'`;
  - `acoes_pendentes(id uuid, user_id, agent_id, sistema, acao, payload jsonb, resumo text, status CHECK pendente|feita|cancelada|vencida|erro, erro, resultado text, conversa_id, criado_em, decidido_em)`;
  - `agente_chamadas(id, user_id, agent_id, sistema, metodo, caminho, status, jti, criado_em)`.

  Tudo `service_role` no padrão da `018`.
- `acoes.py`: registro `EXECUTORES = {("taskhs","comentar"): fn, ("taskhs","mover"): fn, ("taskhs","criar"): fn, ("taskhs","atualizar"): fn}`. Cada `fn(email, bot, payload) -> str` chama o cliente. `criar_pendente(conn, dono, bot, sistema, acao, payload, resumo) -> id` insere a pendência e a mensagem na conversa (cartão).
- Rotas:
  - `GET /acoes/{id}` (dono): `{status, sistema, acao, resumo, payload, resultado, erro}`;
  - `POST /acoes/{id}/confirmar`: `FOR UPDATE`, só `pendente` e com menos de 24 h; executa **o `payload` gravado**; `feita`/`erro` com `AND status='pendente'`;
  - `POST /acoes/{id}/cancelar`.
- [ ] Testes:
  - não-dono → 404;
  - confirmar executa o payload gravado (não um argumento novo);
  - duas confirmações → a segunda dá 409;
  - vencida não executa;
  - erro do sistema → `status='erro'` e mensagem.

  → FALHA → aplicar a `029` → implementar → PASSA → commit.

### Tarefa 3: MCP `hsos-bot-<bot>`

**Arquivos:** `backend/app/routers/mcp_bot.py` (`POST /mcp/bot/{agent_id}/{assinatura}`), `backend/app/email/regras.py` (`FERRAMENTAS_BOT` ao lado de `FERRAMENTAS_EMAIL`), teste `backend/tests/test_mcp_bot.py`.

**Ferramentas:**
- `lembrar(fato)`
- `taskhs_eu`
- `taskhs_minhas(abertas=true)`
- `taskhs_quadros` (só `can_open`)
- `taskhs_quadro(board_id)` (snapshot resumido: listas com id e título, cards com id, título, prazo e prioridade, no máximo 80)
- `taskhs_tarefa(list_id, card_id)`
- `taskhs_buscar(q)`
- **com confirmação:** `taskhs_comentar(list_id, card_id, texto)`, `taskhs_mover(list_id, card_id, para_list_id)`, `taskhs_criar(list_id, titulo, descricao?, prioridade?, prazo?)`, `taskhs_atualizar(list_id, card_id, concluida?, prazo?, prioridade?, titulo?)`. Cada uma monta o `resumo` legível ("Mover 'X' de A para B") lendo o card antes.

`taskhs_*` só com `taskhs ∈ sistemas_ligados`. `lembrar` sempre que a entrada existir.

- [ ] Testes:
  - escrita não chama POST/PATCH no TaskHS, só cria a pendência;
  - `sub` = e-mail do dono mesmo com `email` injetado no argumento;
  - fora do turno → nada chamado;
  - `lembrar` com quebra de linha não cria seção;
  - `lembrar` acima do teto → recusa;
  - flag sem `taskhs` → as `taskhs_*` recusam.

  → FALHA → implementar → PASSA → commit.

### Tarefa 4: escopo e publicação

**Arquivos:** `backend/app/bots_pessoais.py` (`tools_do_bot(servidores, agent_id, email=False, sistemas=False)` com a entrada `hsos-bot-<id>`; `bot_esta_fechado` acompanha), `routers/bots_pessoais.py` (`linha` traz `sistemas_ligados`), `backend/scripts/publicar-email-mcp.py` passa a publicar as duas famílias (`hsos-email-*` e `hsos-bot-*`) num patch (renomeado para `publicar-bots-mcp.py`, com `--ligar-email` e `--ligar-sistema taskhs`), testes.

- [ ] Testes:
  - especialistas e os outros bots negam `hsos-bot-erick-bot__*`;
  - rerodar o `criar-bots` com as duas flags não tira nada;
  - o script publica só para quem tem flag.

  → commit.

### Tarefa 5: telas

**Arquivos:** `frontend/src/components/chat/CartaoAcao.tsx` (registrado nos laços de mídia do ChatPage e do `celular/Midia.tsx`), `frontend/src/components/settings/MemoriaDoBot.tsx` (Perfil: lista as linhas do `MEMORY.md` do próprio bot com apagar e apagar tudo, via `GET/DELETE /bots/memoria` no backend, só do próprio bot), `frontend/src/lib/acoes.ts`, testes vitest das funções puras.

- [ ] O cartão mostra o resumo, o sistema e os campos do `payload` legíveis, com Confirmar/Cancelar e status local.
- [ ] Commit.

### Tarefa 6: ligar no laboratório e conferir

- [ ] Aplicar a `029`. `--ligar-sistema taskhs` no `erick-bot` (só banco).
- [ ] Teste local com o backend local: emitir token e chamar o TaskHS. ⚠️ O TaskHS de produção **ainda não tem o código** (sem deploy): o teste real fica para depois do deploy do TaskHS e do HS.OS.
- [ ] `CLAUDE.md`, revisão final, merge, push.
- [ ] **No deploy (fim do dia, Erick):**
  - env `HSOS_AGENTE_CHAVE_PUBLICA` no TaskHS;
  - env `AGENTE_CHAVE_PRIVADA` e `EMAIL_CHAVE_CIFRA` no `hsos-api`;
  - deploy do TaskHS, depois do HS.OS;
  - `publicar-bots-mcp.py --aplicar` (com OK);
  - perguntar ao `erick-bot` o que ele enxerga;
  - teste pelo chat.
