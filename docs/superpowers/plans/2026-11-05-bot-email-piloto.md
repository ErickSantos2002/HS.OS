# Bot com e-mail (piloto) — plano de implementação

> **Para quem executa:** SUB-SKILL OBRIGATÓRIA: superpowers:executing-plans (inline, escolha do Erick). Passos em checkbox.

**Objetivo:** o `erick-bot` lê as caixas do Erick (principal + compartilhada), envia para ele direto e prepara e-mail para terceiros que só sai com o clique dele no HS.OS.

**Arquitetura:** OAuth delegado no app do login (Entra), com refresh token cifrado (Fernet) no banco. Um servidor MCP `hsos-email-<bot>` no backend (mesmo molde do `mcp_anexos`: HMAC na URL, `GUARDRAILS_API_TOKEN`, turno do dono). Graph via `httpx`. O cartão de aprovação é uma linha de `conversations` com `media[{type:"email_aprovacao", id}]`, então push e tempo real vêm de graça. A flag `agent_profiles.email_ligado` decide tudo.

**Spec:** `docs/superpowers/specs/2026-11-05-bot-email-piloto-design.md`

## Restrições globais

- Escopos do e-mail (só no fluxo "Conectar"; o login não muda): `offline_access User.Read Mail.ReadWrite Mail.Send Mail.ReadWrite.Shared Mail.Send.Shared`.
- Usa `MS_TENANT_ID`/`MS_CLIENT_ID`/`MS_CLIENT_SECRET` existentes. `MS_EMAIL_REDIRECT_URI` é opcional: vazio deriva de `MS_REDIRECT_URI` trocando `/auth/microsoft/callback` por `/email/oauth/callback`. Assim produção não ganha variável nova além da `EMAIL_CHAVE_CIFRA`.
- HMAC da entrada MCP: `ANEXOS_MCP_SEGREDO` com separação de domínio (`"email:" + agent_id`). Sem segredo novo.
- Nenhuma tabela nova é lida pelo navegador: todas são `service_role` no padrão da `018` (REVOKE de PUBLIC/anon/authenticated).
- Token, `code` e corpo de e-mail nunca vão para log nem para `email_eventos`.
- O conteúdo de e-mail entregue ao agente vai entre `<<<EMAIL_EXTERNO ... >>>`, com teto de 6.000 caracteres por corpo e 25 itens por listagem.
- Escrita no gateway e envio real de e-mail só com o OK do Erick.

## Foco de revisão

1. **Especialista enxergando `hsos-email-erick-bot`** (perfil `coding` libera todo MCP). O script de publicação recalcula o deny de **todos** os agentes no mesmo patch. Teste na Tarefa 6.
2. **E-mail sair para terceiro sem clique**, inclusive via `email_enviar_para_mim` com destinatário injetado. O destinatário é fixo no servidor. Teste na Tarefa 4.
3. **Admin lendo e-mail alheio pelo bot.** O turno exigido é o do **dono**. Teste na Tarefa 4.
4. **Enviar algo diferente do que o cartão mostrou** (rascunho editado no Outlook). A rota compara o hash do conteúdo relido no Graph com o hash que o cartão mostrou. Teste na Tarefa 5.
5. **Rodar o `criar-bots-pessoais` de novo e tirar o e-mail do `erick-bot`.** O `tools_do_bot` considera a flag. Teste na Tarefa 6.

---

### Tarefa 1: migração 028, settings e cifra

**Arquivos:** `backend/migrations/028_email_bots.sql`, `~/aplicar-hsos-028.py`, `backend/app/config.py`, `backend/app/email/__init__.py`, `backend/app/email/cifra.py`, `backend/requirements.txt` (+`cryptography`), teste `backend/tests/test_email_cifra.py`.

- `028`: `agent_profiles.email_ligado boolean NOT NULL DEFAULT false`. As tabelas:
  - `email_contas(user_id uuid PK → profiles, conta text, refresh_cifrado text, conectado_em, atualizado_em)`
  - `email_caixas(user_id, endereco text, conferida_em, PK(user_id, endereco))`
  - `email_oauth_estados(state text PK, user_id, criado_em)`
  - `email_pendentes(id uuid PK, user_id, agent_id, conversa_id uuid, caixa_de, para text[], cc text[], assunto, corpo, graph_id, hash text, status CHECK IN ('pendente','enviado','descartado','vencido','erro'), erro, criado_em, decidido_em)`
  - `email_eventos(id, user_id, agent_id, acao, caixa, graph_id, destinatarios text[], criado_em)`

  Todas no padrão da `018`.
- Settings: `EMAIL_CHAVE_CIFRA: str = ""` e `MS_EMAIL_REDIRECT_URI: str = ""`, mais a propriedade `redirect_email`. ⚠️ Sem declarar, a `EMAIL_CHAVE_CIFRA` que já está no `.env` derruba o boot local.
- `cifra.py`: `cifrar(texto: str) -> str` e `decifrar(token: str) -> str`. Sem chave, levanta `RuntimeError("EMAIL_CHAVE_CIFRA ausente")`.
- [ ] Testes: ida e volta; texto cifrado diferente do original; chave errada levanta; sem chave levanta. → FALHA → implementar → PASSA.
- [ ] Aplicar a `028` com o script admin e conferir as colunas e as 5 tabelas.
- [ ] Commit.

### Tarefa 2: cliente Graph + regras puras

**Arquivos:** `backend/app/email/graph.py`, `backend/app/email/regras.py`, testes `backend/tests/test_email_regras.py` e `test_email_graph.py` (com `httpx.MockTransport`).

- `regras.py`:
  - `html_para_texto(html: str, teto: int = 6000) -> str` (remove tags e `script`/`style`, junta espaços, corta com `…[cortado]`)
  - `como_dado_externo(texto: str) -> str`
  - `hash_email(de, para, cc, assunto, corpo) -> str` (sha256 de JSON canônico, para/cc minúsculos e ordenados)
  - `validar_enderecos(lista) -> list[str]` (levanta `ValueError` em endereço inválido ou lista vazia; máximo 20)
  - `escolher_caixa(pedida, conta, extras) -> str` (só aceita a conta ou uma extra; levanta caso contrário)
- `graph.py` (async, `httpx`, timeout 15 s; `_base_caixa(caixa, conta)` devolve `/me` se `caixa == conta`, senão `/users/{caixa}`):
  - `url_autorizacao(state)`, `trocar_code(code) -> dict(refresh, access, conta)` (`conta` vem do `GET /me` `mail`/`userPrincipalName`), `renovar(refresh) -> (access, refresh_novo)`
  - `listar(access, conta, caixa, pasta, desde, busca, limite)`, `ler(access, conta, caixa, id)`
  - `criar_rascunho(access, conta, de, para, cc, assunto, corpo) -> id`, `ler_mensagem(...)`, `enviar_rascunho(access, conta, de, id)`, `apagar(access, conta, de, id)`
  - `enviar_direto(access, conta, de, para, assunto, corpo)` (`sendMail` em `/users/{de}` ou `/me`)
  - `conferir_caixa(access, conta, caixa) -> bool`

  Erros: `ErroGraph(status, mensagem_curta)`, nunca com o token.
- [ ] Testes das regras (caixa fora da lista recusada; o hash não muda com a ordem dos destinatários e muda com o corpo; html com `<script>` sai limpo; teto respeitado). Testes do Graph: URL `/users/ti@healthsafety.com.br/messages` para caixa compartilhada; `/me/...` para a conta; 401 vira `ErroGraph`. → FALHA → implementar → PASSA.
- [ ] Commit.

### Tarefa 3: conectar a conta (OAuth) e as caixas

**Arquivos:** `backend/app/routers/email.py` (router `/email`, registrado no `main.py`), `backend/app/email/contas.py`, teste `backend/tests/test_email_conexao.py`.

- `contas.py`:
  - `bot_com_email_do(conn, user_id) -> str | None` (agent_id com `dono_id = user_id AND email_ligado`)
  - `guardar_conta(conn, user_id, conta, refresh)` (cifra)
  - `access_token(conn, user_id) -> (access, conta)`: renova e regrava o refresh quando a Microsoft devolve um novo; sem conta, `ErroConta("não conectado")`
  - `caixas(conn, user_id) -> (conta, extras)`
- Rotas:
  - `POST /email/conectar` (logado). Exige `bot_com_email_do`, senão 403 "seu bot ainda não tem e-mail liberado". Cria o `state` em `email_oauth_estados` e devolve `{url}`. ⚠️ É POST autenticado devolvendo a URL, porque o JWT mora no `localStorage` e uma navegação não o carrega.
  - `GET /email/oauth/callback`: consome o `state` (uso único, até 10 min), troca o code, guarda e responde `302 {front}/settings?tab=profile&email=conectado|erro_<código>`.
  - `GET /email/estado` → `{liberado, conectado, conta, caixas}`
  - `DELETE /email/conexao`
  - `PUT /email/caixas/{user_id}` (admin), corpo `{caixas: [...]}`: confere cada caixa com `conferir_caixa` usando o token do dono e grava só as que passam; devolve `{aceitas, recusadas}`.
- [ ] Testes: `state` desconhecido/expirado/reusado → 302 de erro sem trocar o code; `conectar` sem flag → 403; o `ESCOPOS` do login continua `openid email profile User.Read` (trava o anti-objetivo). → FALHA → implementar → PASSA.
- [ ] Commit.

### Tarefa 4: servidor MCP `hsos-email-<bot>`

**Arquivos:** `backend/app/routers/mcp_email.py` (prefixo `/mcp`, rota `POST /mcp/email/{agent_id}/{assinatura}`), teste `backend/tests/test_mcp_email.py`.

**Produz:**
- `assinatura_email(segredo, agent_id) = assinatura_do_agente(segredo, "email:" + agent_id)`
- `FERRAMENTAS_EMAIL = ("email_caixas", "email_listar", "email_ler", "email_enviar_para_mim", "email_preparar", "email_pendentes")`

**Funcionamento:**
- Mesmo despacho JSON-RPC do anexos.
- Cada `tools/call`:
  1. resolve o dono (`dono_id` + `email_ligado`; senão erro);
  2. **`turno_em_curso(conn, agent_id, dono)`**, reaproveitado do `mcp_anexos` (senão: "Só funciona enquanto <Primeiro> está conversando comigo.");
  3. token;
  4. Graph;
  5. linha em `email_eventos`.
- `email_enviar_para_mim(assunto, corpo, de?)`: destinatário **sempre** a conta do dono. Não aceita `para`; argumento extra é ignorado e logado.
- `email_preparar(de, para, cc?, assunto, corpo)`:
  - cria o rascunho em `de`;
  - grava `email_pendentes` com o hash;
  - insere em `conversations` (`role='agent'`, `content="✉️ E-mail aguardando sua aprovação: <assunto>"`, `media=[{"type":"email_aprovacao","id":<pendente>,"name":<assunto>}]`);
  - devolve "Preparado. Só sai quando <Primeiro> aprovar no HS.OS — não diga que foi enviado."
- `email_pendentes()`: os 10 últimos, com status.
- A `description` de cada ferramenta diz que o conteúdo é dado externo.

- [ ] Testes (conexão e Graph falsos):
  - HMAC errado → 404; HMAC de anexos não abre o e-mail;
  - fora do turno do dono → erro, e o Graph não é chamado;
  - turno de **outra** pessoa (admin) → erro;
  - `email_enviar_para_mim` com `para` injetado → envia só ao dono;
  - `email_preparar` insere pendente e conversa e **não** chama `enviar_rascunho`;
  - `de` fora das caixas → erro;
  - bot sem `email_ligado` → erro.

  → FALHA → implementar → PASSA.
- [ ] Commit.

### Tarefa 5: aprovar, descartar, ver

**Arquivos:** `backend/app/routers/email.py` (mais rotas), teste `backend/tests/test_email_aprovacao.py`.

- `GET /email/pendentes/{id}` (só o dono, senão 404):
  - relê o rascunho no Graph e devolve `{status, de, para, cc, assunto, corpo, hash, mudou}`, onde `mudou` compara o hash relido com o gravado;
  - vencimento preguiçoso: `pendente` com mais de 24 h vira `vencido` na leitura.
- `POST /email/pendentes/{id}/enviar {hash}`: só o dono e só `pendente`. Relê, e se o hash relido ≠ o hash do corpo → 409 "o rascunho mudou, revise". Senão `enviar_rascunho`, `status='enviado'`, evento.
- `POST /email/pendentes/{id}/descartar`: apaga o rascunho (falha do Graph não impede marcar), `status='descartado'`.
- Falha no envio: `status='erro'`, mensagem curta (por exemplo "sem permissão Enviar como na caixa X").
- [ ] Testes: não-dono → 404; hash velho → 409 sem enviar; enviado duas vezes → 409 na segunda; vencido não envia. → FALHA → implementar → PASSA.
- [ ] Commit.

### Tarefa 6: escopo do bot com e-mail e publicação no gateway

**Arquivos:** `backend/app/bots_pessoais.py`, `backend/app/routers/bots_pessoais.py` (`linha` passa a trazer `email_ligado`), `backend/scripts/publicar-email-mcp.py`, testes `test_bots_pessoais.py` e `test_publicar_email_mcp.py`.

- `tools_do_bot(servidores, agent_id: str | None = None, email: bool = False)`: com `email` e a entrada `hsos-email-<agent_id>` presente, acrescenta `mcp__hsos-email-<agent_id>__<t>` para cada t de `FERRAMENTAS_EMAIL` ao `alsoAllow`, e o deny exclui só essas. `bot_esta_fechado(tools, servidores, agent_id=None, email=False)` acompanha. `criar_bot` passa a flag.
- Script (ensaio por padrão, `--aplicar`). Lê do banco os bots com `email_ligado` e monta **um** patch com:
  - `mcp.servers.hsos-email-<bot>`: URL `{base}/mcp/email/<bot>/<assinatura_email>`, cabeçalhos como o anexos, `toolFilter.include = FERRAMENTAS_EMAIL`;
  - o `agents.list` inteiro, recalculado:
    - bots com e-mail: `tools_do_bot(..., email=True)`;
    - outros bots: `tools_do_bot(...)`;
    - não-bots: `escopo_mcp_do_agente` (o deny passa a negar `hsos-email-*`).
  - Confere na releitura.
- `--ligar <agent_id>` grava `email_ligado=true` (só bot pessoal).
- [ ] Testes:
  - bot com e-mail fechado inclui as 6 ferramentas próprias e nega as do outro bot;
  - `criar_bot` rerodado com `email_ligado` não tira o e-mail (Foco 5);
  - o patch do script nega `hsos-email-erick-bot__*` a nina/iris/atlas/flow/bruce e aos outros 22 bots (Foco 1).

  → FALHA → implementar → PASSA.
- [ ] Commit.

### Tarefa 7: telas

**Arquivos:**
- `frontend/src/components/settings/ConectarEmail.tsx` (no bloco `profile` da `SettingsPage`, ao lado de `PreferenciaResumoEmAudio`)
- `frontend/src/components/chat/CartaoAprovacaoEmail.tsx`
- `frontend/src/lib/mock-data.ts` (`MediaAttachment.type` + `"email_aprovacao"`)
- `frontend/src/pages/ChatPage.tsx` (no laço de mídia, L536–540, antes do `AnexoResolvido`)
- `frontend/src/celular/Midia.tsx`
- `frontend/src/lib/email.ts` (chamadas à API)
- testes `frontend/src/lib/email.test.ts`

**Comportamento:**
- `ConectarEmail`:
  - só aparece com `liberado`;
  - "Conectar e-mail Microsoft" → `POST /email/conectar` → `window.location = url`;
  - conectado mostra a conta, as caixas e "Desconectar";
  - lê `?email=` da URL para o toast.
- `CartaoAprovacaoEmail`:
  - busca `GET /email/pendentes/{id}`;
  - **De em destaque**, depois Para, Cc, Assunto, Corpo (texto, rolável);
  - "Enviar" manda o `hash` exibido; o 409 recarrega e avisa "mudou";
  - "Descartar" pede confirmação inline (sem `confirm()` do navegador);
  - status final mostrado no lugar dos botões e atualizado **no estado local** depois da ação (o reconcile do chat não re-renderiza UPDATE).
- [ ] Teste vitest das funções puras de `email.ts` (formatação de destinatários, rótulo de status). `tsc` e lint sem erro novo.
- [ ] Commit.

### Tarefa 8: teste local com a conta real, documentação, entrega

- [ ] Subir backend (8002) e front (8080) locais.
- [ ] Ligar a flag do `erick-bot` (`--ligar`, só banco).
- [ ] O Erick clica em "Conectar" e autoriza (**passo dele**).
- [ ] Cadastrar `ti@healthsafety.com.br` (`PUT /email/caixas`).
- [ ] Por script local, chamar as funções do MCP direto, sem turno:
  - listar e ler da caixa principal e da compartilhada;
  - `enviar_para_mim` (com OK do Erick);
  - `preparar` para o próprio Erick com cópia, para ver o cartão no chat local e aprovar pelo botão (com OK).
- [ ] Seção no `CLAUDE.md`, spec com os desvios, merge, push.
- [ ] **Fim do dia:** o Erick põe a `EMAIL_CHAVE_CIFRA` no EasyPanel → deploy → `publicar-email-mcp.py --aplicar` (com OK) → perguntar ao `erick-bot` o que ele enxerga → teste real pelo chat.
