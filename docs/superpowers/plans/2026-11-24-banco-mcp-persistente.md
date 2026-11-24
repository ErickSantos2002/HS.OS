# Plano — PK-47, MCP de banco persistente

Spec: [`../specs/2026-11-24-banco-mcp-persistente-design.md`](../specs/2026-11-24-banco-mcp-persistente-design.md)

Branch `pk47-banco-mcp`. Um passo só começa com o anterior conferido.

1. **Serviço** — `vps-gateway/banco-mcp/`: `server.mjs`, `package.json` com
   versões exatas (`pg` 8.23.0, SDK fixado) e `package-lock.json`,
   `banco-mcp.service`, `instalar.sh`.
2. **Comparador** — `comparar.mjs`: sobe o `server-postgres` antigo por stdio e
   fala com o novo por HTTP, roda a mesma bateria nos dois e exige texto
   idêntico. Primeiro contra um Postgres 18 local em container (tipos,
   erro, escrita recusada, multi-comando recusado só no novo).
3. **Backend** — `entrada_mcp_banco()` pura em `integracoes.py`, usada pelo
   `_publicar_banco`; teste em `backend/tests/test_banco_mcp_entrada.py`; a
   suíte inteira verde.
4. **VPS** — instalar o serviço, `/saude`, comparador nos 9 bancos reais
   (lendo as URLs do `openclaw.json` lá mesmo, sem trazê-las para cá). Swap de
   2 GB.
5. **Gateway** — backup do `openclaw.json`; patch das 9 entradas pelo
   `aplicar_patch` com `conferir`, num momento sem `npm exec` vivo;
   `openclaw mcp probe`.
6. **Conferência** — journal do serviço com chamadas reais, `ps` sem
   `npm exec`, gateway sem erro de MCP; anotar em
   `docs/claude/gateway-operacao.md` o que se aprendeu do ciclo de vida;
   changelog; merge na `main` e push. Deploy do backend fica para o fim do dia.
