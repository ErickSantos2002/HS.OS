# PK-05 — Cortar ferramentas que os especialistas não usam

**Data:** 24/11/2026 · **Pacote:** PK-05 (Onda 0) · **Itens:** 02-13, 02-19,
07-16, 07-34 (02-14 e 01-47 fora: segredo por agente é o PK-06/08; `secrets`
não existe na 2026.7.1).

## Medido antes de cortar (30 dias de histórico, só contagem)

| agente | `exec` | escrita | `sessions_list/history` | decisão |
|---|---|---|---|---|
| Midas | 1 (`sleep 45`) | 0 | 0 | corta exec, escrita, sessions_*, memory_search |
| Flow | 1 (`date -u`) | 0 | 0 | idem |
| Atlas | 28 (scripts Python) | 3 | 0 | corta sessions_*, memory_search |
| Bruce | 31 (`cd /tmp/flash`: ponto) | 0 | 0 | corta sessions_*, memory_search |
| Nina | 47 (preço, CRM) | 6 | 8 (orquestra) | corta só memory_search |

`memory_search` falha sempre (`No API key found for provider "openai"`).
`memory_get` funciona e fica.

**O Bruce fica com `exec` de propósito.** O `relatorio_ponto` existe desde
13/10 e ele nunca o chamou — processa a planilha do Flash por `exec`. Tirar
mudaria o que o RH recebe. Vai para o PK-06 (exec fora do root), junto de uma
conversa sobre usar a ferramenta.

## Como

- `_DENY_NAO_MCP` e `_TRAVAS_DE_ESPECIALISTA` ganham `sessions_list`,
  `sessions_history`, `memory_search`: especialista novo nasce sem.
- `_DENY_PRESERVADO` ganha `exec`, `process`, `code_execution`, `write`,
  `edit`, `apply_patch`: o corte por agente sobrevive ao recálculo do deny.
- `scripts/cortar-ferramentas.py` aplicou no gateway (14:2x, sem reiniciar) e
  conferiu pelo `tools.effective` — o inventário real da sessão, não a config.
- O `TOOLS.md` do Flow listava como dele `exec`, `write`, `cron`,
  `sessions_send`… (os três últimos já negados antes). Reescrito a partir do
  `tools.effective`.

## Conferido

`--conferir`: os cinco OK. E o outro lado: Midas/Flow mantêm `read` (abre as
skills) e `memory_get`; Atlas/Bruce/Nina mantêm `exec`.
