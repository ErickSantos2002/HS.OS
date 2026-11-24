# banco-mcp

O MCP de banco da VPS do gateway (PK-47). Um processo só, persistente, que
atende as 9 entradas `banco-*` do `mcp.servers` — no lugar dos 9 `npx` que o
OpenClaw subia **para cada sessão**. Porquê, medido, e o desenho:
[`docs/superpowers/specs/2026-11-24-banco-mcp-persistente-design.md`](../../docs/superpowers/specs/2026-11-24-banco-mcp-persistente-design.md).

- Escuta só em `127.0.0.1:18790`. `POST /mcp` (MCP streamable HTTP, sem
  estado) e `GET /saude`.
- A URL do banco chega no cabeçalho `X-Banco-Url` de cada entrada. O serviço
  não guarda credencial nem lê disco.
- Uma tool, `query`, com a saída **byte a byte** do `server-postgres` 0.6.2 —
  e recusando vários comandos numa string.

## Operar

```bash
bash vps-gateway/banco-mcp/instalar.sh          # instala/atualiza e reinicia
ssh root@2.24.85.122 'systemctl status banco-mcp; journalctl -u banco-mcp -n 30 -o cat'
ssh root@2.24.85.122 'curl -s 127.0.0.1:18790/saude'   # {"ok":true,"bancos":N}
```

Trocar as entradas do gateway (uma vez; idempotente):

```bash
cd backend && .venv/bin/python ../scripts/trocar-banco-mcp.py [--aplicar | --voltar]
```

## Antes de mudar versão de dependência

⚠️ **Rode o comparador nos bancos reais.** A saída depende da versão do `pg` e
do fuso do processo (fixado em UTC no unit): `date` e `timestamp` saem como o
`pg` os converte. Uma atualização que mude isso muda número em briefing.

```bash
ssh root@2.24.85.122 'cd /opt/banco-mcp && node comparar.mjs \
  --antigo /root/.npm/_npx/*/node_modules/@modelcontextprotocol/server-postgres/dist/index.js \
  --config /root/.openclaw/openclaw.json'
```

Ele nunca imprime linha de tabela, só OK/DIFERENTE. Sai com 1 se divergir.
O servidor antigo vive no cache do `npx` da VPS; se o cache sumir, `npm i` do
`@modelcontextprotocol/server-postgres@0.6.2` numa pasta à parte serve.

## O que já mordeu

- O `StdioClientTransport` do SDK **não repassa `TZ`** ao filho. A primeira
  comparação acusou datas com 3 h de diferença que eram do comparador, não do
  serviço. Por isso o `comparar.mjs` passa o `env` inteiro.
- `pool.on("error")` é obrigatório: sem ele, uma conexão ociosa derrubada pelo
  banco mata o processo — e aqui ele atende todos os agentes.
