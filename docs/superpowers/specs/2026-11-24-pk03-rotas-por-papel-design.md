# PK-03 — Rotas fechadas por papel e amarra de destinatário

**Data:** 24/11/2026 · **Pacote:** PK-03 (Onda 0) · **Itens:** 01-62, 02-5,
02-6, 02-30, 04-38, 07-54, 08-7 da análise do remix de novembro.

## O que fecha

| frente | antes | agora |
|---|---|---|
| `GET /uso/eventos`, `/uso/snapshots`, `/uso/estatisticas-de-agente` | qualquer logado — com um Guardi por pessoa, 58% dos eventos dizem quando e quanto cada colaborador usa | administrador (as duas telas que usam já eram) |
| `GET /gateway/agents`, `/gateway/sessions` | logado / colaborador — `agents.list` e `sessions.list` crus, por cima do `_pode_ver` | administrador; nenhum front chama |
| `hsos-relatorios` sem `solicitante` | caía no administrador mais antigo; 3 das 4 ferramentas gravam arquivo financeiro nos Documentos do dono | recusa e ensina o agente a tirar o id da chave de sessão; `required` no schema |
| rota nova sem autenticação | conferência à mão | `test_portas_fechadas.py`: falha, salvo exceção com motivo |

## O que ficou de fora, e por quê

- **A wiki mantém o recuo para o administrador.** É decisão de 17/08 e o
  caminho dos briefings: 326 documentos de `atlas`/`iris`/`flow` sem pessoa
  pedindo. O documento vai para a base que todos leem e a resposta avisa o
  agente — não há vazamento a fechar.
- **"Trocar a URL do gateway exige token novo"** (02-8): descartado na
  verificação de 23/11 — em produção o `.env` fixa URL e token.
- **O `hsos_agente` (a `nina`, pelo `banco-hsos`) lê `usage_events`**
  (migração 033). Fechar a rota não fecha esse caminho; a `nina` atende o CEO.
  Fica registrado para quando o escopo de banco dos agentes for revisto.

## Conferido

- Os únicos chamadores de `/uso/*` são `/monitoring` e `/analytics`, ambos
  `allowedRoles={["administrador"]}`.
- Nenhum cron do gateway chama as ferramentas de relatório (o único que as
  menciona está desligado); toda sessão de especialista vinda do HS.OS tem
  `hsos-<uuid>` na chave.
- O teste de portas pega rota aberta: tirar o guard de `/gateway/agents` de
  propósito o fez falhar nomeando a rota.
