# mcp-ponte

Os 78 MCP HTTP `hsos-*` atendidos no loopback da VPS do gateway
(`127.0.0.1:18791`). O OpenClaw reconecta todos os servidores de `mcp.servers` a
cada execução; pela API pública isso custava ~20 s por mensagem. Aqui
`initialize` e `tools/list` saem do cache (5 min, por caminho + token) e
`tools/call` vai à API com conexão persistente. Porquê, medido, e o desenho:
[`docs/superpowers/specs/2026-11-25-mcp-ponte-design.md`](../../docs/superpowers/specs/2026-11-25-mcp-ponte-design.md).

## Operar

```bash
bash vps-gateway/mcp-ponte/instalar.sh                      # instala/atualiza e reinicia
ssh root@2.24.85.122 'node /opt/mcp-ponte/comparar.mjs'     # ponte == API, servidor a servidor
ssh root@2.24.85.122 'curl -s 127.0.0.1:18791/saude'        # {"ok":true,"cache":N}
ssh root@2.24.85.122 'curl -s -X POST 127.0.0.1:18791/esquecer'   # depois de deploy que mude ferramenta
node --test vps-gateway/mcp-ponte/ponte.test.mjs
```

Trocar as entradas do gateway (idempotente; backup na VPS):

```bash
cd backend && .venv/bin/python ../scripts/trocar-mcp-ponte.py [--aplicar | --voltar]
```

⚠️ **Ferramenta nova ou removida num deploy aparece em até 5 min** — o
`tools/list` está em cache. Com pressa, `/esquecer`.
