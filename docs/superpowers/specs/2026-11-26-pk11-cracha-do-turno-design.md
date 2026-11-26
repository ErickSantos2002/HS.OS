# PK-11 — Crachá assinado do turno

**Data:** 26/11/2026 · **Pacote:** PK-11 (Onda 0, item 05-2) · depende do PK-06.

## O problema

O gateway não diz ao servidor MCP de que sessão veio a chamada. O Guardi só
pode usar e-mail e sistemas no turno do **dono**, e o backend deduzia isso por
`agent_runs`: turno aberto do dono e **nenhum** de outra pessoa
(`outro_turno_aberto`). Com admin e dono conversando com o bot ao mesmo tempo,
a dedução não sabe de quem é a chamada — a saída era bloquear os dois.

## O que a investigação confirmou (OpenClaw 2026.7.1-2, lendo o código)

- `before_tool_call` recebe `ctx.agentId`, `ctx.sessionKey`, `ctx.runId` e pode
  devolver `params` reescritos (`docs/plugins/hooks.md`).
- Ele roda na execução de **toda** ferramenta não embrulhada antes
  (`tool-split-*.js`), inclusive as MCP do `bundle-mcp`, e o `callTool` da MCP
  manda os argumentos como vieram, sem validar contra o schema.
- O gancho é **fail-closed** (`hook-runner-global-*.js`): lançar bloqueia a
  ferramenta. O plugin nunca lança.
- `definePluginEntry` só devolve o objeto: um `export default {id, register}`
  em JS puro serve, sem depender do SDK. Instalação: `plugins install --link`
  (pode reiniciar o gateway sozinho) e reinício.

## Desenho

- **Plugin** `vps-gateway/plugin-cracha/`: nas ferramentas
  `hsos-email-*` e `hsos-bot-*`, descarta o `_cracha` que o modelo tenha posto
  e grava `{agente, sessao, run, ts, sig}`, `sig = HMAC-SHA256(segredo,
  agente\nsessao\nrun\nts)`. Só essas duas famílias: carimbar as outras
  `hsos-*` poria um argumento a mais em rota que não sabe tirá-lo.
- **Segredo** `CRACHA_TURNO_SEGREDO`: em `integration_secrets` e num arquivo
  0600 na VPS, **fora** do `openclaw.json` (o `config.get` que o backend lê
  não o devolve; os agentes com `exec` estão em sandbox).
- **Backend** `app/cracha.py`: confere assinatura, prazo (5 min) e agente;
  tira a pessoa de `agent:<id>:hsos-<user_id>`. No `_contexto` de
  `mcp_email` e `mcp_bot`:
  - crachá de pessoa = dono → passa, **sem** a dedução (o dono não fica mais
    bloqueado por um admin conversando junto);
  - crachá de pessoa ≠ dono → recusa, com certeza;
  - sem crachá, ou sessão que não é de pessoa (varredura, cron) → a dedução
    de antes, intacta;
  - crachá presente e inválido → recusa (forja ou relógio).

## Produção

1. Deploy do backend (sem plugin, nada muda: sem crachá vale a dedução).
2. `vps-gateway/plugin-cracha/configurar.sh` no Konsole: segredo no banco
   ANTES do plugin, arquivo e plugin na VPS, espera sem resposta em voo,
   instala e reinicia o gateway, confere.
3. Conferência: conversa do Erick com o próprio Guardi usando uma ferramenta
   `hsos-bot-*` → log da API `crachá ok, pessoa=<erick>`.

**Depois (não agora):** com o crachá estável, a dedução pode sair das
conversas de pessoa — hoje ela fica como rede para sessões sem crachá.
