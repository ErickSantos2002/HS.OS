# PK-01 — XSS e phishing da wiki e da prévia HTML

**Data:** 24/11/2026 · **Pacote:** PK-01 (Onda 0) · **Origem:** auditoria de
02/11 do DN.OS (M4, C1, C2, FD-04), portada fiel.

## Os três defeitos, todos vivos

1. **`/wiki-html-preview` é pública e confia no endereço.** `?url=` busca
   *qualquer* site e o mostra em tela cheia sob `hsos.healthsafetytech.com`
   (login falso pronto); `?key=` faz `localStorage.removeItem` de *qualquer*
   chave guardada em JSON. *Corrigido ao testar:* a análise dizia que
   `?key=hsos.token` deslogava — não acontecia, porque o token é texto cru e o
   `JSON.parse` falhava antes do `removeItem`. A fila de tarefas longas do chat
   (`hsos:pending-long-tasks`) sumia de fato.
2. **SVG/XML da wiki abrem como blob de mesma origem.** O `openPreview` escreve
   o blob numa aba `about:blank`, que herda a origem do app: `<script>` no SVG
   lê `hsos.token` (JWT de 168 h no `localStorage`) = conta tomada.
3. **`javascript:` em endereço de anexo/vídeo.** O `href`/`src` vem do conteúdo
   do documento — que agentes escrevem (`documento_criar`/`editar`) depois de
   ler e-mail de terceiros. O Baixar cai num `window.open(href)` quando o
   `fetch` falha, e aí o `javascript:` roda na origem do app.

Hoje nenhum documento tem `href`/`src` (conferido no banco), então o risco de
quebrar algo vivo é baixo e o de deixar a porta aberta é o de sempre.

## O conserto (o do DN.OS, adaptado ao nosso armazenamento)

- `lib/previa-html.ts`: `chaveDaPrevia` (só `wiki-html-preview:<carimbo>:<sorteio>`)
  e `enderecoDaPrevia`. No DN.OS a segunda origem aceita era o Storage do
  Supabase (`/storage/v1/`); **aqui é a origem da API (`VITE_API_URL`) no
  caminho `/storage/`** — é de lá que o backend serve os buckets. Fica de fora
  todo o resto da API (`/p/…`, `/mcp/…`).
- `lib/endereco-seguro.ts`: só http(s), `blob:` e relativo; `data:` só imagem
  raster; recusa `//host` e esquema disfarçado com espaço/controle.
- `mediaActions.ts`: `recusar()` antes de abrir ou baixar; SVG/XML **baixam**.
- `AttachmentNode` e `VideoNode`: `enderecoSeguro` ao ler o HTML, ao gravar e ao
  mostrar.
- **Backend, a segunda ponta** (recomendação da verificação de 23/11): o
  `_para_html` do `mcp_wiki` neutraliza `href`/`src` com esquema que roda
  código antes de gravar — inclusive com entidade HTML (`&#106;avascript:`).

Fora daqui: arquivo privado com link assinado (PK-09), `salvarComo` e o
`podeEditar` do anexo (outros pacotes do DN.OS).

## Plano

1. Testes do front primeiro (portados do DN.OS: bloco M4 e `endereco-seguro`,
   com o caso do domínio da API no lugar do Supabase) — falhando.
2. As duas libs, a página, `mediaActions`, os dois nós.
3. Teste e filtro no `_para_html`.
4. Suíte do front, suíte do back, lint, build. Changelog. Merge e push.
   Deploy no fim do dia junto com o do PK-47.
