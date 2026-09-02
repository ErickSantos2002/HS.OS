# Três coisas que a tela conta errado

Saíram da conferência da Tarefa 8 (`docs/CONFERENCIA-CHAT-PESSOAS.md`), medidas em
produção em 02/09/2026. Nenhuma é hipótese: cada uma tem a medida que a mostrou.

## Global Constraints

- **Backend:** `cd backend && ./.venv/bin/python -m pytest tests -q`. Os testes do
  backend são **função pura com objeto falso** — nenhum toca banco nem rede. O que
  precisar de banco vira script em `backend/scripts/provar_*.py`, fora do pytest.
- **Front:** `cd frontend && npx vitest run` e `npx tsc --noEmit`. Os dois têm que
  ficar limpos.
- **Nada é testado contra produção nesta branch.** Quem confere em produção é o
  Erick, depois do deploy.
- **Repositório PÚBLICO.** Nenhum nome, e-mail, uuid de pessoa real ou credencial
  entra em código, teste ou comentário. Use dados inventados.
- **Não deployar, não mexer em `main`, não rodar migração.** O trabalho é nesta
  worktree.
- **Comentário explica *por quê*, não *o quê*.** É o estilo do repositório: quando
  um defeito custou caro, o comentário conta a medida que o revelou.
- Nada de `git add -A`: adicionar arquivo por arquivo.

---

### Task 1: O Monitoramento diz "offline" com o gateway no ar

**Files:**
- Modify: `frontend/src/components/monitoring/AgentsTab.tsx` e o que mais alimentar
  a contagem e o aviso (procure a origem antes de mexer)
- Create: teste em `frontend/src/lib/` para a função pura que decidir o estado

**O que foi medido em 02/09/2026, em produção, no mesmo minuto:**

| fonte | valor |
|---|---|
| `GET /gateway/status` | `{"conectado": true, "versao": "2026.7.1-2", "scopes": [operator.read/write/admin]}` |
| um agente acionado num canal | respondeu em **7 segundos** |
| `agent_stats` (5 linhas) | `status = 'ok'` em todas; `latest_updated_at` do `flow` de minutos atrás |
| a tela `/monitoring` | **"Gateway offline — agentes indisponíveis"** e **"SUPER AGENTES ONLINE 0/8"** |

Duas suspeitas, as duas para conferir no código antes de corrigir:

1. **`agent_stats.status` vale `'ok'`, não `'online'`.** Se a tela compara com
   `'online'`, nenhum agente jamais conta como no ar. Este mesmo tropeço já
   aconteceu na War room em 01/09/2026 — ver `docs/CONFERENCIA-2026-09-01.md`.
2. **O total `8` é chumbado.** Existem **5** agentes em `agent_profiles`. O
   denominador tem que vir da lista, não de uma constante.

**Aceite:**
- Com o gateway conectado e as linhas de `agent_stats` como acima, a tela **não**
  mostra o aviso de offline, e a contagem é `N/N` com `N` = agentes que a tela
  recebeu.
- Com o gateway de fato fora, o aviso **continua aparecendo** — a correção não pode
  ser "nunca avisar". Este caso vale tanto quanto o outro: regra que nunca alerta
  passa em qualquer teste que só procure o alerta sumindo.
- A decisão de estado sai para uma **função pura**, testada com os valores acima
  (`'ok'`, e também `'online'`, `null` e um valor desconhecido), e com o caso de
  gateway offline.

⚠️ Não invente um valor novo para `status` nem "conserte" o coletor: a correção é
na leitura. Mudar o que o coletor grava quebraria dado já gravado.

---

### Task 2: `GET /gateway/config` responde 403 para colaborador, e a tela chama assim mesmo

**Files:**
- Modify: quem chama `/gateway/config` no front (procure; é chamado em toda sessão)

**Medido:** em duas janelas de colaboradoras diferentes, o console de produção
registrou, na carga do `/chat`:

```
403 GET /gateway/config {"detail":"Permissão insuficiente para esta operação."}
```

A rota é de administrador (`exige_papel`) e está certa em recusar. Quem está errado
é o chamador: pede sempre, para todo mundo. Não quebra nada visível — e é
exatamente por isso que incomoda: vira barulho permanente no console e esconde o
erro de verdade de quem for depurar essa tela.

**Aceite:**
- Sessão de colaborador não dispara a chamada e não gera o 403.
- Sessão de administrador continua recebendo a config, igual a hoje.
- O papel vem de onde o resto da tela já o lê (`useAuthContext`/`role`) — não
  invente uma segunda fonte de verdade para papel.
- Se a chamada estiver dentro de um hook usado por telas de admin e não-admin, o
  guard fica no hook, não espalhado em cada tela.

---

### Task 3: O prompt da menção não diz qual é a última mensagem

**Files:**
- Modify: `backend/app/routers/channels.py` (`_responder_no_canal`)
- Create/Modify: teste em `backend/tests/`

**Medido em 02/09/2026:** num canal com duas instruções no histórico, o agente
respondeu à **anterior** — respondeu `diagnostico` quando a mensagem que o
mencionou pedia `pong 474611`. Numa medição limpa seguinte ele acertou, então isto
foi **visto uma vez e não reproduzido**. Não trate como defeito garantido: trate
como prompt frouxo.

Hoje o pedido é montado assim: as últimas 30 mensagens do canal viram linhas
`"<autor>: <conteúdo>"`, precedidas de *"Você está no canal e foi mencionado.
Responda à última mensagem."* — e nada no texto marca **qual** é a última. O código
já sabe qual é: a variável `gatilho`, que existe para a deduplicação.

**Aceite:**
- A montagem do pedido sai para uma **função pura** (recebe o histórico e o
  gatilho, devolve o texto), testável sem banco e sem gateway — é a única forma de
  testar isto dentro da regra da casa.
- O texto resultante identifica sem ambiguidade a mensagem a responder, e o
  histórico anterior continua presente como contexto.
- Testes: histórico com várias mensagens; histórico com uma só; mensagem de agente
  no meio do histórico; conteúdo vazio descartado como hoje.
- **Não mude o comportamento de deduplicação nem o `marco`** — só o texto enviado.
