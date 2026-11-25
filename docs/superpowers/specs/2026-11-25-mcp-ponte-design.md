# mcp-ponte — os 78 MCP `hsos-*` atendidos no loopback da VPS do gateway

**Data:** 25/11/2026 · **Pacote novo** (proposto no `CONTINUAR-AQUI` de 24/11) ·
pré-requisito da fila de 6 turnos do PK-12 (decisão de 23/11: "fila só junto
com swap e timeout dos MCP").

## O que foi medido (25/11, log do gateway e chamada direta)

- O runtime MCP é **por execução**: "one-shot embedded runs request run-end
  cleanup" (`docs/gateway/configuration-reference.md` do OpenClaw). Toda
  mensagem a qualquer agente reconecta **todos** os servidores de `mcp.servers`.
- São 87: 9 `banco-*` no `banco-mcp` (loopback) e **78 HTTP** na API pública —
  23 bots × (`hsos-anexos`, `hsos-bot`, `hsos-email`) + os compartilhados. O
  OpenClaw não tem escopo de servidor por agente (só no harness do Codex,
  `codex.agents`) nem manda a identidade do agente ao servidor: a sessão do
  `paulo-bot` conecta os servidores da Suelen, e o `deny` descarta depois
  (1.352 ferramentas removidas por execução).
- Cada handshake custa ~0,36 s de rede (TLS novo até `62.72.11.28`) por
  requisição; `initialize` + `tools/list` ≈ 0,73 s; o backend responde os dois
  sem tocar o banco.
- **A etapa `bundle-tools` leva ~20 s em TODA execução** (8 de 8 fora da
  rajada, 19,7–25 s). Preparação total: mediana **20,8 s** fora da rajada,
  **30,6 s** na rajada (máx. 40 s).
- Na rajada (07:30, 13:30) ~31 sessões × 78 servidores: 130 `Request timed out`
  por dia, **92% em servidor de outro bot** (inofensivo), mas **5/dia no
  servidor do próprio bot** — naquela execução a ferramenta dele some.

## O conserto

Um serviço local, `mcp-ponte`, em `127.0.0.1:18791`, sem dependência:

- `initialize` e `tools/list` respondidos **do cache** (por caminho + cabeçalho
  de autenticação, 5 min). Na falta, busca na API, guarda e serve — pedidos
  iguais simultâneos esperam a mesma busca. O `id` do JSON-RPC é o do pedido.
- Notificação (sem `id`) → 202 local, como o backend faz.
- `tools/call` e qualquer outro método → repassados à API, com conexão
  persistente (`keepAlive`), cabeçalhos e corpo como vieram. A API continua
  conferindo token e assinatura em toda chamada de ferramenta.
- API fora no `tools/list` com cache vencido → serve o vencido (melhor que a
  ferramenta sumir); sem cache nenhum → devolve o erro dela.
- `POST /esquecer` (loopback) esvazia o cache — para depois de um deploy que
  mude ferramenta, se não der para esperar os 5 min.

As 78 entradas passam de `https://hsosapi.healthsafetytech.com/mcp/...` para
`http://127.0.0.1:18791/mcp/...` (mesmo caminho). Os scripts de publicação
(`publicar-bots-mcp.py`, `publicar-anexos-mcp.py`) copiam a base da entrada
`hsos-relatorios`, então publicações futuras herdam a ponte sem mudar código.

**Por que loopback e sem credencial guardada:** o cabeçalho `X-Bridge-Token`
chega em cada pedido, vindo da própria entrada do `openclaw.json`; quem alcança
a porta já é root e leria o arquivo de qualquer jeito (mesmo raciocínio do
`banco-mcp`).

## O que NÃO muda

- A API continua a autoridade: assinatura por bot e token em todo `tools/call`.
- Ferramenta nova ou removida aparece em até 5 min (ou `/esquecer`).
- Os servidores de outros bots continuam sendo "conectados" — agora em
  microssegundos, sem rede.

## Produção

1. `bash vps-gateway/mcp-ponte/instalar.sh` (sobe o serviço; não mexe no gateway).
2. `node comparar.mjs` na VPS: para cada entrada, `tools/list` pela ponte ==
   pela API.
3. Troca das 78 entradas: `scripts/trocar-mcp-ponte.py` (ensaio → **combinar o
   payload com o Erick** → `--aplicar`, com backup na VPS e `--voltar`).
4. Conferir: `bundle-tools` < 2 s nas execuções seguintes; zero `Request timed
   out` na rajada de 26/11.
