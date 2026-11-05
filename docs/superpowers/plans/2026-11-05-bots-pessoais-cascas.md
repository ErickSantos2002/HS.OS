# Bots pessoais (cascas) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (execução inline, escolhida pelo Erick). Passos em checkbox.

**Objetivo:** criar 23 agentes `<primeironome>-bot`, cada um ligado ao dono, isolados e só com o alerta, e mostrá-los na war-room como satélite da pessoa.

**Arquitetura:** um módulo puro (`app/bots_pessoais.py`) decide id, elegibilidade, `tools` e os sete arquivos. Uma função assíncrona usa esse módulo para criar um bot, com gateway primeiro e desfazer em caso de falha. Quem a chama são uma rota de admin e um script local (ensaio/`--aplicar`), igual ao `publicar-anexos-mcp.py`. A coluna `agent_profiles.dono_id` é o que define "bot pessoal" no sistema inteiro.

**Stack:** FastAPI + asyncpg + gateway OpenClaw (JSON-RPC por WS); React/Vite + Vitest.

**Spec:** `docs/superpowers/specs/2026-11-05-bots-pessoais-cascas-design.md`

## Restrições globais

- id do bot: `<primeironome>-bot`, minúsculo, sem acento, `^[a-z0-9-]{2,32}$`. Nome exibido: `<Primeiro>-bot` (com acento).
- Perfil: emoji `🤖`, `model` igual ao dos especialistas (`deepseek/deepseek-chat`), `access_type='admins_only'`, `allowed_user_ids='{}'`, `status='active'`, `specialty='Assistente pessoal de <Nome completo>'`, `is_official=false`, `dono_id=<user_id>`.
- `tools` do bot no gateway: `profile: "minimal"`, `alsoAllow: ["mcp__hsos-alerta__avisar_administrador"]`, `deny` = deny de MCP (tudo menos `hsos-alerta`) + `gateway`, `sessions_send`, `sessions_spawn`, `skill_workshop`, `cron`.
- Bot nunca entra em `tools.agentToAgent.allow` nem no roster da `nina`.
- Cada arquivo dos sete tem que passar em `excede_o_teto(...) is False`.
- Escrita no gateway só depois de o Erick ver o ensaio. Primeiro uma casca, depois o lote.
- Migração aplicada por mim: `~/projetos/bancos/.venv/bin/python ~/aplicar-hsos-027.py`, que confere o efeito.
- Português em código, comentários e docs. Testes com docstring dizendo o que o defeito custaria.

## Foco de revisão

1. **Recálculo de deny apagando a trava do bot.** `_deny_de_mcp` só preserva o que está em `_DENY_NAO_MCP`, e cada publicação de banco o reaplica. Se `gateway` não for preservado, ele some da trava do bot. Teste na Tarefa 2.
2. **`publicar-anexos-mcp.py` dando entrada `hsos-anexos-<bot>`.** O script pega todo o `agents.list`. Teste na Tarefa 4.
3. **Teste do admin aparecendo na TV como conversa do dono.** Teste na Tarefa 5.
4. **Rodar o script duas vezes, ou retomar depois de uma falha no meio.** Precisa adotar em vez de duplicar. Teste na Tarefa 3.
5. **Admin pôr um bot num canal.** O bot passaria a responder a outras pessoas. Teste na Tarefa 4.

---

### Tarefa 1: migração `027` — `agent_profiles.dono_id`

**Arquivos:**
- Criar: `backend/migrations/027_bots_pessoais.sql`
- Criar (fora do repo): `~/aplicar-hsos-027.py`

- [ ] **Passo 1:** escrever a `027`, no estilo da `026` (cabeçalho com o porquê, `BEGIN/COMMIT`, conferência no fim):
  `ALTER TABLE public.agent_profiles ADD COLUMN IF NOT EXISTS dono_id uuid NULL REFERENCES public.profiles(id) ON DELETE SET NULL;`
  e `CREATE UNIQUE INDEX IF NOT EXISTS agent_profiles_um_bot_por_dono ON public.agent_profiles (dono_id) WHERE dono_id IS NOT NULL;`
- [ ] **Passo 2:** escrever `~/aplicar-hsos-027.py` com `bancos.conectar("hsos", perfil="admin")`, executar o arquivo e conferir com `information_schema.columns` (coluna existe) e `pg_indexes` (índice existe), imprimindo o resultado.
- [ ] **Passo 3:** rodar e conferir que imprime as duas existências como `True`.
- [ ] **Passo 4:** commit `feat(migracao): 027 — dono do bot pessoal`.

### Tarefa 2: módulo puro `app/bots_pessoais.py`

**Arquivos:**
- Criar: `backend/app/bots_pessoais.py`
- Modificar: `backend/app/routers/integracoes.py` (`_DENY_NAO_MCP` / preservação em `_deny_de_mcp`)
- Teste: `backend/tests/test_bots_pessoais.py`

**Interfaces (produz):**
- `id_do_bot(nome_completo: str) -> str` (`"André Luiz Neri" → "andre-bot"`)
- `nome_do_bot(nome_completo: str) -> str` (`"André-bot"`)
- `motivo_inelegivel(perfil: dict) -> str | None`, com `perfil = {id, full_name, email, ativo}`. Devolve `None` se elegível; senão, `"inativo"`, `"e-mail fora do time"` ou `"sem nome"`. Reusa `warroom.e_do_time`.
- `ALERTA = "mcp__hsos-alerta__avisar_administrador"`
- `TRAVAS_DO_BOT = ("gateway", "sessions_send", "sessions_spawn", "skill_workshop", "cron")`
- `tools_do_bot(servidores: dict) -> dict`, que devolve `{"profile": "minimal", "alsoAllow": [ALERTA], "deny": ...}`, com deny calculado por `_deny_de_mcp([ALERTA], list(TRAVAS_DO_BOT), servidores)`.
- `bot_esta_fechado(tools: dict, servidores: dict) -> bool`: o `tools` relido bate com `tools_do_bot` (comparação de conjunto no deny).
- `arquivos_do_bot(dono: dict) -> dict[str, str]`, com `dono = {full_name, email, departamento}`. Chaves: os sete nomes canônicos.

- [ ] **Passo 1: testes que falham:**
  - `test_id_sem_acento_e_minusculo`: `"André Luiz" → "andre-bot"`, `"Letícia Nunes" → "leticia-bot"`, `"Hyago Matheus" → "hyago-bot"`; o resultado casa `^[a-z0-9-]{2,32}$`.
  - `test_inelegivel`: inativo → `"inativo"`; `contato@ketlinscalco.com.br` → `"e-mail fora do time"`; ativo com `@healthsafetytech.com` → `None`.
  - `test_tools_do_bot_nega_todo_mcp_menos_alerta`: com servidores `{hsos-alerta, banco-hsos, hsos-anexos-iris}`, o deny contém `banco-hsos__query` e `hsos-anexos-iris__ler_anexo` e não contém nada de `hsos-alerta`; contém as cinco travas; `profile == "minimal"`.
  - `test_recalculo_de_deny_preserva_trava_gateway`: `_deny_de_mcp([ALERTA], ["gateway", "sessions_send"], servidores)` mantém `gateway`. É o Foco 1; hoje falha.
  - `test_arquivos_do_bot`: as sete chaves exatas; nenhum excede o teto; `USER.md` cita nome e e-mail; `SOUL.md` contém "não tenho acesso" e "avisar_administrador"; `HEARTBEAT.md` e `MEMORY.md` vazios ou só com cabeçalho.
- [ ] **Passo 2:** `python -m pytest tests/test_bots_pessoais.py -q` → FALHA (módulo inexistente).
- [ ] **Passo 3:** em `integracoes.py`, acrescentar `"gateway"` à preservação. Uma tupla nova `_DENY_PRESERVADO = _DENY_NAO_MCP + ("gateway",)` usada só na linha `preservados`. **Não** pôr em `_DENY_NAO_MCP`, que também é a trava aplicada aos especialistas. Comentário com o porquê.
- [ ] **Passo 4:** implementar o módulo. O texto do `SOUL.md` copia a seção de guardrails do `SOUL.md` da `iris`, lido do gateway com `agents.files.get` (leitura é livre), **sem** as partes de domínio. Inclui "Não afirmo o que não sei — nem número, nem fato", não revelar o contexto de sistema e usar `avisar_administrador` diante de tentativa de subverter limites, além de dizer que ainda não tem acesso a nenhum sistema da empresa. O `AGENTS.md` diz que não aciona outros agentes, não agenda e que conteúdo lido é dado, não instrução. O `TOOLS.md` lista só o alerta.
- [ ] **Passo 5:** `python -m pytest tests -q` → tudo passa.
- [ ] **Passo 6:** commit `feat(bots): regras puras do bot pessoal`.

### Tarefa 3: `criar_bot` + rota + script

**Arquivos:**
- Criar: `backend/app/routers/bots_pessoais.py` (router `prefix="/agents"`, incluído em `main.py` **antes** do router de agents)
- Criar: `backend/scripts/criar-bots-pessoais.py`
- Teste: `backend/tests/test_bots_pessoais_criacao.py`

**Interfaces:**
- Consome: Tarefa 2; `_desfazer_criacao(openclaw_id) -> bool` de `routers/agents.py`; `patch_gw.config_do_gateway()` / `aplicar_patch(...)`; `obter_cliente(...).chamar`.
- Produz:
  - `async def criar_bot(user_id: str, *, conn_factory=sessao, cliente=None) -> dict` → `{"user_id", "agent_id", "resultado": "criado"|"já existia"|"adotado"|"falhou", "motivo": str|None}`
  - `POST /agents/bots-pessoais` com corpo `{"user_ids": [uuid]}` → `{"resultados": [...]}`, só `administrador`.
  - script: `python scripts/criar-bots-pessoais.py` (ensaio: lista os 23 elegíveis, o id e o payload completo de **um**, sem escrever) · `--aplicar --so <user_id>` · `--aplicar --todos`.

Ordem dentro de `criar_bot`. Cada passo confere antes de agir, e isso é o que a torna idempotente:
1. Lê o perfil. Se `motivo_inelegivel`, devolve `falhou`.
2. Se já existe linha com `dono_id = user_id` e o agente está no gateway com `bot_esta_fechado`, devolve `já existia`.
3. Se existe um agente com o mesmo id cujo `dono_id` é outro, ou que é especialista, devolve `falhou: colisão`.
4. Se não está no gateway, faz `agents.create {name, workspace: /root/.openclaw/workspace-<id>, model, emoji}`.
5. Faz `INSERT ... ON CONFLICT (agent_id) DO UPDATE SET dono_id = EXCLUDED.dono_id` com os campos das Restrições globais.
6. Para cada arquivo, `agents.files.set`.
7. Aplica um patch com o `agents.list` inteiro, em que o `tools` do bot é `tools_do_bot(servidores)`, e confere com `bot_esta_fechado` na config relida.
8. Se 4, 6 ou 7 falharem, chama `_desfazer_criacao` e devolve `falhou` com o motivo. Se o bot vinha de uma execução anterior pela metade (passo 4 pulado), devolve `adotado`.

- [ ] **Passo 1: testes que falham**, com cliente de gateway e conexão falsos, no padrão de `test_criacao_escopo.py`:
  - `test_cria_na_ordem_gateway_primeiro`: sequência de chamadas `agents.create` → INSERT → `agents.files.set`×7 → `config.patch`.
  - `test_rodar_de_novo_nao_duplica`: segunda chamada → `já existia`, sem `agents.create`.
  - `test_adota_agente_que_ficou_sem_linha`: agente no gateway sem linha no banco → não chama `agents.create`, grava a linha → `adotado` (Foco 4).
  - `test_falha_no_escopo_desfaz`: o patch levanta → `_desfazer_criacao` chamada → `falhou`.
  - `test_nunca_mexe_em_agent_to_agent`: nenhum patch enviado contém `tools.agentToAgent`.
  - `test_colisao_com_especialista`: id `nina-bot` com linha `dono_id IS NULL` → `falhou: colisão`.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar `criar_bot`, a rota e o script. O script lê `backend/.env` com `load_dotenv` e imprime o resultado por pessoa.
- [ ] **Passo 4:** `python -m pytest tests -q` → tudo passa.
- [ ] **Passo 5:** commit `feat(bots): criar bot pessoal — rota e script`.

### Tarefa 4: o resto do sistema não tropeça nos bots

**Arquivos:**
- Modificar: `backend/app/routers/agents.py` (`_atualizar_roster_do_lider`: `AND dono_id IS NULL`; `AgenteOut.donoId: str | None`; quem monta `AgenteOut` lê `dono_id`)
- Modificar: o endpoint que adiciona agente a canal (`routers/channels.py`): recusa com 400 se o agente tiver `dono_id`
- Modificar: `backend/scripts/publicar-anexos-mcp.py` (`montar_patch` pula os agentes com `tools.profile == "minimal"` ao montar as entradas)
- Modificar (front): `frontend/src/hooks/use-agents.ts` (`donoId` no tipo); criar `frontend/src/lib/bots-pessoais.ts` com `ehBotPessoal(a): boolean` e `soEspecialistas<T>(lista: T[]): T[]`; aplicar no mapa da `AgentsPage`, na `TeamsPage`, no `CreateChannelDialog` e no `ChannelMembersPanel`. Na lista de agentes do chat (`ChatPage`/onde o admin escolhe agente), os bots ficam num grupo "Bots pessoais", recolhido por padrão.
- Teste: `backend/tests/test_bots_pessoais_vizinhos.py`, `frontend/src/lib/bots-pessoais.test.ts`

Escolha minha: o script de anexos reconhece o bot pelo `profile: "minimal"`, porque ele não tem acesso ao banco. O motivo é funcional (um agente sem ferramenta de arquivo não tem por que ter entrada de anexo), não o sufixo do nome.

- [ ] **Passo 1: testes que falham:**
  - `test_roster_exclui_bot`: a SQL do roster contém `dono_id IS NULL` (ou, com conexão falsa, a lista gerada não traz `andre-bot`).
  - `test_canal_recusa_bot_pessoal`: adicionar `andre-bot` → 400 (Foco 5).
  - `test_anexos_pula_minimal`: `montar_patch` com `andre-bot` de `profile: "minimal"` não cria `hsos-anexos-andre-bot`, e o deny do bot continua negando as entradas dos outros (Foco 2).
  - Vitest `soEspecialistas` filtra quem tem `donoId`.
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar. Varrer `grep -rn agent_profiles backend/app` e anotar no commit o que foi decidido sobre cada consumidor. Os que não precisam mudar ficam listados como "conferido".
- [ ] **Passo 4:** `python -m pytest tests -q`, `cd frontend && npx vitest run && npm run lint` → passa (lint sem erro novo).
- [ ] **Passo 5:** commit `feat(bots): roster, canais, anexos e telas ignoram bot pessoal`.

### Tarefa 5: war-room — satélite da pessoa

**Arquivos:**
- Modificar: `backend/app/routers/warroom.py` (consultas), `backend/app/warroom.py` (`montar_bots`)
- Modificar: `frontend/src/lib/warroom-feed.ts`, `frontend/src/lib/warroom-layout.ts`, `frontend/src/pages/WarRoomPage.tsx`
- Teste: `backend/tests/test_warroom.py` (existente; acrescentar), `frontend/src/lib/warroom-layout.test.ts`, `frontend/src/lib/warroom-feed.test.ts`

**Interfaces:**
- Backend: as consultas `ultimas` e `msgs_agente` passam a juntar `agent_profiles` e filtrar `ap.dono_id IS NULL OR c.user_id = ap.dono_id::text`. Assim, conversa de admin com o bot de outro some da TV inteira: estado, Fluxo e números (Foco 3). `perfis` traz `dono_id`. `montar_agentes` recebe só os sem dono. Um novo `montar_bots(perfis_bot, ultimas, agora, do_time) -> list[{id, donoId, estado}]` usa `estado_do_agente`, e o bot de dono fora de `do_time` não sai. O feed ganha `"bots": [...]`.
- Front: `interface Bot { id: string; donoId: string; estado: Estado }`, `Feed.bots: Bot[]`. `normalizar` filtra os `donoId` que não estão nas pessoas. Backend antigo sem `bots` → `[]`.
- Layout: `EntradaLayout.comBot?: string[]` (ids de pessoa); `caixasPessoa(p, nome, status, escala, temBot = false)` alarga a caixa `no` para incluir o satélite. Escolha minha: o satélite fica no **canto superior esquerdo** do nó (o ponto de status ocupa o direito, e o rótulo fica embaixo), não na direção radial da spec, porque nas pessoas de baixo a direção radial cairia sobre o próprio rótulo. Exportar `SATELITE = { r: 7, dx: -(R_PESSOA + 3), dy: -(R_PESSOA - 4) }` (a escala 1), que a página e o teste leem.
- Página: dentro do `<g>` da pessoa, um círculo em `SATELITE`, apagado (`opacity` baixa) quando ocioso e com a classe viva/halo quando ativo. Linha curta pessoa↔bot só quando ativo. Nada de partícula pelo núcleo.

- [ ] **Passo 1: testes que falham:**
  - backend `test_conversa_de_admin_com_bot_alheio_nao_acende`: `ultimas` sem a linha do admin (teste da função de filtro, ou a SQL contém o predicado); `montar_bots` com a última conversa do dono → `pensando`; sem conversa → `ocioso`.
  - backend `test_bot_fora_do_anel`: `montar_agentes` não recebe bot e `bots` traz `donoId`.
  - front feed: `normalizar({bots: [{id:"andre-bot", donoId:"x", estado:"pensando"}]})` com `x` fora das pessoas → `bots == []`; sem campo → `[]`.
  - front layout: com as 23 pessoas de hoje todas em `comBot`, o teste "nenhum rótulo encosta em outro nem em outro nó" continua passando com `caixasPessoa(..., true)`, e um caso novo "satélite não encosta no rótulo nem no nó do vizinho".
- [ ] **Passo 2:** rodar → FALHA.
- [ ] **Passo 3:** implementar.
- [ ] **Passo 4:** `python -m pytest tests -q`; `cd frontend && npx vitest run` → passa.
- [ ] **Passo 5:** conferir na tela. `npm run dev` com o backend local (que aponta para o banco de produção) e o Playwright em `/warroom` a 1920×1080, tema escuro e claro. Print, olhar e conferir que não há nada sobreposto. Para ver um satélite aceso sem gerar conversa falsa, injetar um feed de teste só no navegador.
- [ ] **Passo 6:** commit `feat(warroom): bot pessoal como satélite da pessoa`.

### Tarefa 6: ensaio, uma casca, conferência, lote

Escrita no gateway, com o Erick no circuito.

- [ ] **Passo 1:** túnel de pé (`ssh -N -o ServerAliveInterval=30 ... -L 18789:127.0.0.1:18789 root@2.24.85.122`). Rodar o ensaio do script e **mostrar ao Erick** a lista dos 23 e o payload completo do `erick-bot`, que é o primeiro, porque o dono é ele mesmo. Esperar o OK.
- [ ] **Passo 2:** `--aplicar --so <id do Erick>`.
- [ ] **Passo 3: conferir de verdade**:
  - `config.get`: o `erick-bot` tem `profile: "minimal"`, o deny esperado e está fora do `agentToAgent.allow`;
  - linha em `agent_profiles` com `dono_id`;
  - os sete arquivos com `agents.files.get`;
  - **perguntar ao bot**, com `chat.send` e `agentId: "erick-bot"` explícito (combinado no passo 1), quais ferramentas ele enxerga. O esperado é só `avisar_administrador`, e talvez `session_status`.
  - Se o alerta **não** aparecer (o `minimal` não libera `bundle-mcp` implicitamente), acrescentar `"bundle-mcp"` ao `alsoAllow` em `tools_do_bot`, com teste, e repetir. O deny de MCP continua excluindo o resto.
  - Se aparecer qualquer ferramenta de arquivo, shell, web ou `message`, parar e reavaliar antes do lote.
- [ ] **Passo 4:** `--aplicar --todos` → 22 `criado` + 1 `já existia`. Conferir com `config.get` os 23 fechados e o `agentToAgent.allow` igual ao de antes.
- [ ] **Passo 5:** `journalctl` do gateway ou `models.list` para confirmar que o gateway segue sadio. Uma pergunta curta à `nina` para conferir que nada mudou nela. Pela regra, enviar mensagem a ela é escrita: combinar antes.

### Tarefa 7: documentação e fechamento

- [ ] **Passo 1:** no `CLAUDE.md`, uma seção curta "Bots pessoais" (o que são, `dono_id`, `profile: "minimal"`, por que ficam fora do roster e do `agentToAgent`, a preservação de `gateway` no deny, o script). Atualizar a spec, trocando "satélite radial" pelo canto superior esquerdo, com o motivo, e "não é o Nicholson" (a exclusão é da lista, não da rota).
- [ ] **Passo 2:** revisão final do branch por um revisor novo (superpowers:requesting-code-review).
- [ ] **Passo 3:** merge local na `main` e `git push`. Avisar o Erick de que a war-room depende do deploy manual no EasyPanel e de que a `027` já está aplicada.
