# Encaminhar mensagem — plano de implementação

> **Para agentes:** usar superpowers:executing-plans. Passos em checkbox.

**Objetivo:** ação "Encaminhar" em qualquer mensagem, para várias pessoas, grupos e o próprio Guardi (rascunho), com anexos que abrem para quem recebe.

**Arquitetura:** `POST /encaminhar` faz tudo no servidor (lê a origem sob RLS, copia anexo no R2, insere com `encaminhada=true`, avisa). Front: ação nas `acoes-da-mensagem`, um seletor global montado no `App.tsx`, handoff de módulo para o Guardi.

**Stack:** FastAPI + asyncpg, boto3 (R2), React/Vite, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-27-encaminhar-mensagem-design.md`

## Restrições globais

- Teto: **10** destinos por envio, contando o Guardi.
- Encaminhar **não** acorda agente; menção dentro de encaminhada **não** fura silenciar.
- Migração `047` aplicada **antes** do deploy (`~/aplicar-hsos-047.py`, com conferência).
- Português em código, comentário e mensagens; changelog no topo.

## Foco de revisão

1. Mensagem só com áudio de canal (`audio_url = anexo:<id>`, conteúdo vazio) — tem que chegar tocando.
2. Anexo legado sem `id` (URL `/storage/...` ou GIF do Giphy) — vai como está, sem tentar copiar.
3. Resposta do agente com cartão (`acao_aprovacao`) e resumo em áudio — os dois ficam de fora; o texto vai.
4. Destino repetido ou a própria pessoa em `pessoas` — 400 antes de qualquer escrita.
5. Guardi marcado por quem não tem Guardi — falha nomeada, os outros destinos seguem.

---

### Tarefa 1: `copiar` no armazenamento

**Arquivos:** `backend/app/armazenamento.py`, `backend/tests/test_armazenamento.py`

**Produz:** `async def copiar(origem: str, destino: str) -> None` (chaves completas, `R2.copiar` via `s3.copy_object(Bucket, Key=destino, CopySource={"Bucket", "Key": origem})`; `Memoria.copiar` duplica a tupla; erro do R2 → mesmo 502 do `_rodar`).

- [ ] Teste `test_copiar_duplica_o_objeto_e_o_original_fica`: grava `anexos/a/1/x.pdf`, copia para `anexos/b/2/x.pdf`; `ler` das duas devolve os mesmos bytes; apagar a cópia não apaga o original.
- [ ] Rodar → falha; implementar; rodar → passa; commit.

### Tarefa 2: regras puras `app/encaminhamento.py`

**Arquivos:** criar `backend/app/encaminhamento.py`, `backend/tests/test_encaminhamento.py`

**Produz:**
- `LIMITE_DESTINOS = 10`
- `def anexos_do_canal(attachments: list[dict] | None) -> tuple[list[dict], list[str]]` — `(publicos_como_estao, ids_para_copiar)`; item com `id` vai para cópia.
- `def anexos_da_conversa(media: list[dict] | None, role: str) -> list[str]` — ids de `file`/`image` com `id`; `audio` só se `role == "user"` (o do agente é resumo); cartões fora.
- `def id_do_audio(audio_url: str | None) -> str | None` — `"anexo:<id>"` → id; outra coisa → `None`.
- `def conferir_destinos(pessoas: list[str], canais: list[str], guardi: bool, eu: str) -> None` — `ValueError` com frase para: nenhum destino, mais de 10, repetido, `eu` em `pessoas`.
- `def conteudo_para_mencao(conteudo: str | None, encaminhada: bool) -> str` — `""` se encaminhada.

- [ ] Testes (um por regra, incluindo os itens 2–4 do foco): GIF sem id fica público; `acao_aprovacao` e áudio do agente fora; `anexo:abc` → `abc`, `https://…` → `None`; 11 destinos, repetido e `eu` levantam; `@todos` encaminhado → `""`.
- [ ] Rodar → falha; implementar; passa; commit.

### Tarefa 3: migração 047 + coluna na saída + push

**Arquivos:** criar `backend/migrations/047_mensagem_encaminhada.sql`; modificar `backend/app/routers/channels.py` (`_COLUNAS_MSG` ganha `m.encaminhada`), `backend/app/routers/schemas.py` ou onde mora `MensagemCanalOut` (`encaminhada: bool = False`), `backend/app/push_envio.py` (SELECT da mensagem ganha `m.encaminhada`; `destinatarios_canal(..., conteudo_para_mencao(linha["content"], linha["encaminhada"]), ...)`).

- [ ] SQL idempotente (`ADD COLUMN IF NOT EXISTS ... NOT NULL DEFAULT false`), com cabeçalho explicando.
- [ ] Suíte inteira passa (`python -m pytest tests -q`); commit.

### Tarefa 4: rotas `/encaminhar`

**Arquivos:** criar `backend/app/routers/encaminhar.py`; registrar em `backend/app/main.py`; teste `backend/tests/test_encaminhar_rota.py` só para o que é puro (montagem do texto/anexos do Guardi e do item de anexo copiado).

**Consome:** Tarefas 1–2; `buscar_anexo`, `pessoa_pode_ler`, `membro_do_canal` (`routers/anexos.py`/`app/anexos.py`); `_recusar_quem_nao_escreve`, `_COLUNAS_MSG`, `_msg_saida`, `nome_de_quem_envia`, `traduzir_hs001`, `topico_canal`, `hub` (`routers/channels.py`).

**Produz:**
- `GET /encaminhar/destinos` → `{guardi: {id, nome} | null, pessoal: channel_id | null, grupos: [{id, nome}], pessoas: [{id, nome, avatar_url}]}` — pessoas `status='active'` menos eu, ordem alfabética; grupos `public`/`private` onde sou membro humano e `pode_escrever_no_canal`.
- `POST /encaminhar` com `{origem: {tipo, id}, pessoas, canais, guardi}` → `{enviados: [{destino, channel_id, message_id}], falhas: [{destino, motivo}], guardi: {agent_id, texto, anexos} | null}`.
- `def item_copiado(anexo: Anexo, novo_id: str) -> dict` — `{id, name, url: "", size, mimeType}` (formato de `ChannelAttachment`).
- `async def copiar_anexo(conn_service, anexo, contexto, alvo_id, usuario_id) -> str` — novo uuid, `caminho_do_anexo`, `arm.copiar`, INSERT em `anexos` (campos do contexto conforme a CHECK da 017), devolve id.

Cada destino em `try` próprio; `HTTPException` vira `falhas[].motivo = detail`; outra exceção é logada e vira "Não foi possível encaminhar." Publicar no hub depois da transação.

- [ ] Teste de `item_copiado`; implementar; suíte passa; commit.

### Tarefa 5: front — tipos, ação e handoff

**Arquivos:** criar `frontend/src/lib/encaminhar.ts` + `frontend/src/test/encaminhar.test.ts`; modificar `frontend/src/hooks/use-channels.ts` (`encaminhada?: boolean`), `frontend/src/lib/acoes-da-mensagem.ts`, `frontend/src/hooks/use-chat-media.ts` (anexo com `id` e sem `base64` passa direto no `finalizeStaged`).

**Produz (`lib/encaminhar.ts`):**
- `type OrigemEncaminhar = { tipo: "canal" | "agente"; id: string; previa: string }`
- `abrirEncaminhar(o)`, `fecharEncaminhar()`, `useOrigemEncaminhar(): OrigemEncaminhar | null` (store de módulo com `useSyncExternalStore`)
- `guardarParaOGuardi(p: { agentId: string; texto: string; anexos: MediaAttachment[] })`, `consumirParaOGuardi(agentId: string): {texto, anexos} | null` (uso único; outro agente → `null` e não consome)
- `textoParaOGuardi(rascunho: string, texto: string): string` = `acrescentarCitacao`
- `encaminhar(origem, destinos): Promise<RespostaEncaminhar>` e `carregarDestinos()` (chamadas `api`).

Ação: `{ rotulo: "Encaminhar", icone: Forward, aoEscolher: () => abrirEncaminhar(...) }` — no canal depois de "Responder"; no agente depois de "Copiar"; só se houver conteúdo, anexo ou áudio.

- [ ] Testes: consumir duas vezes → segunda `null`; consumir com outro agente → `null` e o certo ainda consome; ações do canal incluem "Encaminhar" e não em apagada; agente com erro sem ações.
- [ ] Rodar → falha; implementar; passa; commit.

### Tarefa 6: front — seletor, selo e consumo no Guardi

**Arquivos:** criar `frontend/src/components/chat/EncaminharDialog.tsx`; montar em `frontend/src/App.tsx`; selo em `components/chat/ChannelChat.tsx`, `components/chat/ThreadPanel.tsx`, `celular/Bolha.tsx` (+ `celular/ListaDoCanal.tsx` passando `encaminhada`); consumo em `pages/ChatPage.tsx` e `celular/TelaConversaAgente.tsx`; changelog.

- Seletor conforme o desenho da spec; Guardi com "(vira rascunho)"; contador "N de 10"; desabilita marcar acima de 10.
- Ao concluir: toast `Encaminhada para N` / `Não foi para: A, B (motivo)`; com Guardi, `guardarParaOGuardi` + `navigate("/chat?agent=<id>")`.
- `ChatPage`/`TelaConversaAgente`: efeito por `agentId` chama `consumirParaOGuardi`; se veio, `syncToDraft(textoParaOGuardi(...))`/`setRascunho` e `media.addStaged` em cada anexo.
- Selo: `↪ Encaminhada` em `text-[10px] italic text-muted-foreground` acima do conteúdo, só se `encaminhada && !deleted`.

- [ ] `npm run lint` sem erro novo, `npm run test` e `npm run build` passam; commit.

### Tarefa 7: migração em produção e conferência

- [ ] `~/aplicar-hsos-047.py` (perfil admin, venv do cadastro) e conferir `information_schema.columns` para `channel_messages.encaminhada`.
- [ ] Teste ponta a ponta local (backend 8002 + Vite) com o login de dev: encaminhar mensagem com anexo para uma pessoa e para o Guardi; conferir no banco a linha com `encaminhada = true` e o anexo copiado legível.
- [ ] Merge na `main` + push; registrar no `docs/claude/conversas.md`.
