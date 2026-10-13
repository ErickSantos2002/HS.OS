# Anexos em todas as conversas, storage no Cloudflare R2 — design

Data: 13/10/2026 · Status: aprovado em conversa, aguardando revisão da spec

## Por que agora

O HS.OS vai ser liberado pessoa a pessoa, devagar, porque o sistema ainda não
garante que um agente não entregue mais do que deve. A primeira depois do
Nicholson é a Lindsay (RH), que vai usar o `bruce` para transformar a planilha
de ponto exportada do Flash no relatório que hoje ela monta à mão.

Para isso ela precisa **mandar a planilha pelo sistema**, e hoje não dá:

| caminho | estado em 13/10/2026 |
|---|---|
| pessoa ↔ pessoa (canal, DM) | sobe e aparece — mas no bucket **público** `agent-files`, aberto a quem tiver a URL |
| pessoa → agente, no canal | sobe; o agente recebe `[mensagem sem texto — provavelmente anexo…]` e não lê |
| pessoa → agente, chat direto | a tela anexa (`ChatPage.tsx:1973`) e manda em `media`; o `/send` **descarta** |
| agente → pessoa | só pela Documentos, não aparece na conversa |

E tudo isso grava em `UPLOADS_DIR`, no disco da VPS, que cresce sem teto.

**Objetivo:** anexo funcionando nos quatro caminhos, privado, com até 100 MB,
guardado no R2 — e o `UPLOADS_DIR` deixando de existir.

**Fora do escopo:** a régua do ponto da Lindsay (próxima frente, consome o
`id` de anexo daqui); visão de imagem pelo modelo — a doc do OpenClaw não
documenta anexo no `chat.send`, e o modelo hoje é DeepSeek.

## Decisões tomadas

1. **O R2 substitui o storage inteiro**, os cinco buckets de hoje — não só anexos.
   Dois storages convivendo é o tipo de híbrido que este repo já pagou para
   desfazer.
2. **O backend é a porta, não o cano.** Leitura responde 302 para URL assinada;
   envio é `PUT` assinado direto do navegador para o R2. As URLs já gravadas no
   banco (`/storage/<bucket>/<caminho>`) continuam valendo, `<img src>` dos
   buckets públicos segue sem token, e a VPS não gasta disco nem banda.
3. **Limite de 100 MB** por arquivo (era 25 MB).
4. **O agente lê anexo por ferramenta, sob demanda.** A mensagem leva só uma
   linha de referência; o conteúdo vem pelo `ler_anexo`. Colar a planilha na
   mensagem estouraria o contexto e cairia nos cortes silenciosos já
   catalogados no `CLAUDE.md`.
5. **A identidade do agente é verificada no servidor, não declarada.** Hoje os
   servidores MCP recebem `agente` e `solicitante` como argumento que o próprio
   agente preenche. Para anexo isso não serve: a trava contra vazamento tem que
   estar no código, não no prompt.

## 1. Camada de storage

### Um bucket físico, prefixo por bucket lógico

Bucket R2 `hsos-arquivos`. O bucket lógico vira prefixo: `agent-files/…`,
`generated-documents/…`, `anexos/…`. A permissão continua sendo do bucket
lógico; um bucket físico só é uma credencial e um CORS.

| bucket lógico | leitura |
|---|---|
| `agent-files` | pública (avatar em `<img>`) |
| `audio-messages` | pública (`<audio src>`) |
| `wiki-uploads` | pública (imagem em documento) |
| `company-docs` | autenticado |
| `generated-documents` | só o dono (pasta por pessoa) |
| **`anexos`** (novo) | só quem participa da conversa — ver seção 2 |

### `backend/app/armazenamento.py`

Único módulo que fala com o R2, via `boto3` (API S3). Interface:

```
gravar(bucket, caminho, dados: bytes, mime) -> None
ler(bucket, caminho) -> bytes                 # para extrair-texto e ler_anexo
url_assinada_get(bucket, caminho, segundos, nome_download?) -> str
url_assinada_put(bucket, caminho, mime, tamanho, segundos) -> str
cabecalho(bucket, caminho) -> {tamanho, mime} | None
apagar(bucket, caminho) -> None
listar(bucket, prefixo) -> list[{caminho, tamanho, modificado}]
```

`storage.py`, `relatorios.py` (`_gerar_e_guardar`, `_compradores_e_guardar`) e
`POST /storage/documentos/gerar` passam a usá-lo. O `_resolver` sai; a validação
de segmento (`_SEGMENTO`, sem `..`) fica e passa a validar a **chave**.
`preparar_diretorios()` sai do `main.py`.

Configuração nova no `.env` e no `.env.example`: `R2_ACCOUNT_ID`,
`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`. Sem elas o backend
**sobe** e as rotas de arquivo respondem 503 com mensagem dizendo o que falta
— mesmo comportamento do `exige_segredo`.

### Rotas

| rota | comportamento |
|---|---|
| `GET /storage/{bucket}/{path}` | só buckets públicos; 302 para URL assinada de 1 h |
| `GET /storage/privado/{bucket}/{path}` | autenticado; confere o dono; 302 para URL assinada de 5 min |
| `POST /storage/upload/iniciar` (nova) | `{bucket, caminho, mime, tamanho}` → confere bucket, caminho, permissão e `tamanho ≤ 100 MB`; devolve `{url_put, expira_em}` |
| `POST /storage/upload/concluir` (nova) | confere no R2 (`cabecalho`) que o objeto existe **com o tamanho declarado**; devolve `{bucket, path, url, size}` como o upload atual |
| `POST /storage/{bucket}/{path}` | multipart; fica para arquivo pequeno (avatar), limite 100 MB, grava pelo módulo |
| `GET /storage/listar/{bucket}/{prefixo}` | `listar` do módulo |
| `DELETE /storage/{bucket}/{path}` | `apagar` do módulo |
| `POST /storage/extrair-texto/{bucket}/{path}` | `ler` para memória em vez de abrir do disco |
| `POST /storage/faxina` | mesma regra (30 dias, `agent-files`), sobre `listar` |

⚠️ O `PUT` assinado leva `Content-Length` assinado: o R2 recusa corpo maior que
o declarado. O `concluir` confere de novo porque é o único lugar em que o
servidor vê o que chegou de fato.

### Migração do disco

`scripts/migrar-uploads-r2.py`, rodado **dentro do container de produção**:
percorre `/app/uploads/<bucket>/…`, sobe cada arquivo para `<bucket>/…` no R2,
e ao fim imprime contagem e bytes por bucket dos dois lados. Idempotente (pula
o que já existe com o mesmo tamanho). O volume persistente só sai do EasyPanel
depois de a contagem bater — e o `DEPLOY.md` perde a instrução de montá-lo.

### O que o Erick faz na Cloudflare

Criar o bucket `hsos-arquivos`; token de API R2 com **Object Read & Write só
nesse bucket**; CORS permitindo `PUT` e `GET` dos domínios do HS.OS (produção e
`http://localhost:8080`), com `Content-Type` nos cabeçalhos permitidos. O JSON
do CORS vai pronto em `docs/DEPLOY.md`.

## 2. Anexos nas conversas

### Tabela `anexos` — migração `017_anexos.sql`

```
id                uuid PK
bucket            text      -- sempre 'anexos' hoje; fica explícito
caminho           text      -- chave no R2, sob o bucket
nome              text      -- nome original, para exibir e baixar
mime              text
tamanho           bigint
enviado_por_user  uuid NULL -- pessoa que enviou
enviado_por_agent text NULL -- agente que enviou (enviar_arquivo)
contexto          text      -- 'canal' | 'conversa_agente'
channel_id        uuid NULL -- quando contexto = 'canal'
agent_id          text NULL -- quando contexto = 'conversa_agente'
dono_conversa     uuid NULL -- a pessoa da conversa com o agente
created_at        timestamptz
```

Com `CHECK` amarrando `contexto` aos campos que ele exige. **É esta tabela que
responde quem pode ler**, não o caminho do arquivo. Caminho no R2:
`anexos/<contexto>/<channel_id|agent_id>/<id>/<nome-saneado>`.

Regra de leitura para **pessoa**:
- `canal` → membro do canal (inclui DM);
- `conversa_agente` → `dono_conversa` é ela;
- `administrador` não ganha atalho — anexo de conversa é da conversa.

Rota `GET /anexos/{id}/url` → `{url, expira_em}` (assinada, 5 min). O front
pede essa URL antes de exibir, porque `<img src>` não manda token.

Escrita: o `upload/iniciar` aceita `bucket: "anexos"` com `{contexto,
channel_id | agent_id}` e confere que quem envia participa; o `concluir` insere
a linha em `anexos` e devolve o `id`.

### Os quatro caminhos

**Pessoa ↔ pessoa.** O item de `attachments` ganha `id` (fica
`{id, name, url, size, mimeType}`). Anexo novo vai para `anexos`; os antigos,
que estão em `agent-files`, continuam servidos de lá — **nenhuma URL gravada é
reescrita**.

**Pessoa → agente, chat direto.** O `media` do `POST /conversations/{agent_id}`
passa a carregar o `id` do anexo, e o `/send` acrescenta à mensagem do
`chat.send` uma linha por anexo:

```
[anexo: ponto-setembro.xlsx · 2,3 MB · planilha · id=<uuid>]
```

**Pessoa → agente, canal.** A consulta que alimenta `_responder_no_canal` passa
a buscar `attachments`; o `_SEM_TEXTO` dá lugar às mesmas linhas.

**Agente → pessoa.** Ferramenta `enviar_arquivo` (abaixo): grava no R2, insere
em `anexos` (`enviado_por_agent`), insere a mensagem `role='agent'` em
`conversations` com o anexo no `media`, e registra em `generated_documents` para
aparecer na Documentos. Publica no `/ws` como qualquer mensagem do agente.

### Servidor MCP `hsos-anexos`, com identidade verificada

Rota `POST /mcp/anexos/{agent_id}/{assinatura}`, onde
`assinatura = HMAC-SHA256(ANEXOS_MCP_SEGREDO, agent_id)` em hex. O servidor
recalcula com `compare_digest`; não bate → 404 (não confirma que a rota existe).
O `agent_id` da URL é **a** identidade — nenhum argumento de ferramenta a
substitui.

No gateway, **uma entrada por agente** em `mcp.servers`
(`hsos-anexos-<agentId>`), cada uma com a sua URL. O `_deny_de_mcp` existente
(`backend/app/routers/integracoes.py`) já nega a cada agente os servidores fora
do `alsoAllow` dele; cada agente recebe no `alsoAllow` só a própria entrada. O
segredo continua também no `GUARDRAILS_API_TOKEN` como os outros servidores,
para que a rota não fique aberta só por URL.

Por que URL e não cabeçalho: a doc do OpenClaw não nomeia o campo de cabeçalhos
por servidor, e `url` é o campo que se sabe funcionar.

**`ler_anexo(id, aba?, pagina?)`** — entrega se, e só se:
- `contexto = 'conversa_agente'` e `agent_id` = o agente da URL; ou
- `contexto = 'canal'` e o agente da URL é membro do canal.

Formatos:
- `xlsx`/`xls`/`csv` → lista de abas com nº de linhas; da aba pedida, cabeçalho
  + 200 linhas por página, com `pagina` e `total_paginas`. Células como texto
  (datas em ISO), via `openpyxl` (já no `requirements.txt`).
- `pdf`, `docx`, `txt`, `md` → texto, paginado em blocos de 20.000 caracteres.
- imagem e o resto → só os metadados, dizendo que o conteúdo não é legível por
  ferramenta.

Recusa com texto explícito ("este anexo não pertence a uma conversa sua") em
vez de "não encontrado" — o agente precisa saber que não deve tentar de novo.

**`enviar_arquivo(para, nome, formato, conteudo)`**
- `para`: id da pessoa. Recusado se ela **nunca trocou mensagem com esse
  agente** (`conversations` com `agent_id` e `user_id`).
- `formato`: `csv`, `xlsx` (montado no servidor a partir de CSV), `md`,
  `docx`, `pdf` (reusando `_montar_docx` / `_montar_pdf`). O modelo nunca
  produz bytes binários.
- devolve o `id` do anexo e uma frase para o agente dizer a quem pediu.

Ambas com a regra de uso na `description` do parâmetro, não em docstring —
lição do `dias_de_validade`.

## 3. Front

- `lib/storage.ts`: envio em dois passos (`iniciar` → `PUT` no R2 com
  `XMLHttpRequest` para ter progresso → `concluir`). `enviarArquivo` mantém a
  assinatura para os chamadores atuais; ganha `aoProgredir?`.
- `urlDoAnexo(id)` com cache em memória até 30 s antes de expirar.
- Componente `<Anexo>` único (imagem, áudio, arquivo com ícone e tamanho,
  download), substituindo as três renderizações de `ChannelChat`,
  `ThreadPanel` e `ChatPage`. Item sem `id` (anexo antigo) usa a `url` como hoje.
- `use-chat-media`: limite 100 MB, mensagem de erro com o limite.
- `GeneratedDocumentCard` não muda — segue o 302.

## 4. Testes

Backend, pytest sem rede (o R2 é um `FakeArmazenamento` em memória atrás da
mesma interface). Cada teste com docstring do que tranca:

- caminho com `..`, segmento vazio ou bucket desconhecido → 400/404;
- `iniciar` com `tamanho > 100 MB` → 413;
- `concluir` com tamanho divergente do objeto → 400, e nenhuma linha em `anexos`;
- falha do R2 no `gravar` vira 502 nomeado, não 500 genérico;
- leitura de anexo de canal por quem não é membro → 403;
- `ler_anexo` com HMAC trocado → 404; anexo de outro agente → recusa; canal em
  que o agente não é membro → recusa;
- `ler_anexo` de planilha pagina e devolve cabeçalho em toda página;
- `enviar_arquivo` para quem nunca falou com o agente → recusa;
- `/send` com `media` leva a linha `[anexo: …]` ao `chat.send`;
- `_responder_no_canal` com anexo e sem texto não manda mais `_SEM_TEXTO`.

Front: teste do `urlDoAnexo` (cache e expiração) e do envio em dois passos.

## 5. Ordem de entrega

Cada fase sobe sozinha para produção.

| fase | conteúdo | gate |
|---|---|---|
| 1 · Storage no R2 | `armazenamento.py`, rotas, envio em dois passos, script de migração | Erick cria bucket/token/CORS e roda a migração; contagem bate; volume sai do EasyPanel |
| 2 · Anexos privados | `017_anexos.sql`, bucket `anexos`, `GET /anexos/{id}/url`, `<Anexo>`, pessoa ↔ pessoa no fluxo novo | script de `017` com perfil admin que **confere a tabela no banco** ao fim, rodado pelo Erick |
| 3 · Pessoa → agente | linhas de anexo no `/send` e no canal, `hsos-anexos` com HMAC, `ler_anexo` | `config.patch` das entradas por agente: **payload mostrado e confirmado antes**; conferência perguntando ao `bruce` que ferramentas ele vê e pedindo que leia um anexo de teste |
| 4 · Agente → pessoa | `enviar_arquivo` | o `bruce` manda um CSV ao Erick e ele aparece na conversa e na Documentos |

A Lindsay entra depois da fase 4.

## Riscos conhecidos

- **CORS mal configurado** derruba todo upload novo com erro de rede no
  navegador — o mesmo sintoma enganoso do "Não foi possível falar com o
  servidor". O `iniciar` não tem como detectar; a fase 1 só fecha com um envio
  real pelo navegador de produção.
- **URL assinada vencida em aba aberta há horas**: o `<Anexo>` pede de novo ao
  falhar o carregamento, uma vez.
- **Anexos antigos continuam públicos** em `agent-files`. Não são reescritos;
  quem precisar fechá-los é tarefa separada.
- **`ler_anexo` só protege o que passa por ele.** Se a Lindsay colar dados na
  mensagem, eles vão para a sessão do agente como qualquer texto.
