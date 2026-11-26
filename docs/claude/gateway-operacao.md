# Gateway — operação: LLM, sessões, agente a agente, escopo e cron

> Saiu do `CLAUDE.md` em 23/11/2026 (o arquivo passou do teto de 150 mil caracteres
> de instruções do Claude Code). Texto movido sem edição. Leia antes de mexer na área.

### Configurar LLM: credencial e catálogo, os dois pela config

Levantado ao vivo em 13/08/2026, depois de **três conclusões erradas minhas** que valem mais que a
resposta:

- **`models.providers.<id>.apiKey` é o caminho suportado para a credencial.** O `config.schema`
  (existe como método RPC, e responde) declara a seção com `apiKey` aceitando string ou SecretRef,
  `additionalProperties: false` e **nenhum campo obrigatório**. Consultá-lo leva trinta segundos e
  teria evitado a tarde inteira.
- **Não confunda "não usado" com "não suportado".** `models` estava ausente do `openclaw.json` porque
  esta instância foi configurada pelo CLI, não porque o gateway rejeitasse a seção. Foi essa
  inferência que me levou a afirmar três vezes que configurar pela tela era impossível.
- **A nota de 01/08 sobre "hot-add crasha o reload" estava errada** e custou uma fila inteira
  (`llm_provider_ops`) que nunca teve executor. O nó era válido; naquele dia havia *também* um modelo
  irresolvível no catálogo, e o crash foi atribuído à escrita que coincidiu.

⚠️ **O cofre do agente ganha da config.** A credencial também pode viver em `auth_profile_store`, no
SQLite de cada agente (`~/.openclaw/agents/<id>/agent/openclaw-agent.sqlite`) — é o que o
`openclaw onboard` cria. Quando existe, ela **vence** o `models.providers`, e esvaziar
`auth.profiles` não adianta: o cofre sobrevive à declaração. O que resolve é zerar a ordem:

```json
{"auth": {"order": {"anthropic": []}}}
```

⚠️ **Modelo que o gateway não resolve envenena o catálogo inteiro.** `agents.defaults.models` aceita
qualquer id (são chaves com valor `{}`), mas quem resolve é um registro interno; id desconhecido volta
no `models.list` **sem `api`** e faz **toda** execução de agente falhar em ~200ms com zero token —
inclusive a de quem usa modelo válido. A lista que a tela oferece vem da API do provedor, que tem ids
que este gateway não executa. Não dá para validar antes (o modelo só aparece depois de entrar no
catálogo): escreva, confira com `models.list` e recolha o que não colou.

⚠️ **Provedor não-embutido precisa ser DECLARADO, não só ter chave.** Levantado em 14/08/2026
tentando pôr o DeepSeek: `models.providers.deepseek.apiKey` estava lá e nada funcionava. O gateway
tem `anthropic` embutido — sabe URL, adaptador e modelos dele — e não tem o DeepSeek. Sem
declaração, os ids entram em `agents.defaults.models` e voltam do `models.list` **sem `api`**, que é
o estado que envenena o catálogo inteiro. O que resolve:

```json
{"models": {"providers": {"deepseek": {
  "baseUrl": "https://api.deepseek.com/v1",
  "api": "openai-completions",
  "models": [{"id": "deepseek-chat", "name": "DeepSeek V3", "contextWindow": 65536, "maxTokens": 8192}]
}}}}
```

O `api` é um enum do schema: `openai-completions`, `openai-responses`, `anthropic-messages`,
`google-generative-ai`, `google-vertex`, `github-copilot`, `bedrock-converse-stream`, `ollama`,
`azure-openai-responses` e `openai-chatgpt-responses`. Cada item de `models` exige `id` e `name`.

⚠️ **`_PROVEDORES` em `llm.py` é "o que a nossa tela oferece", NÃO "o que o gateway tem embutido".**
O código tratava as duas coisas como a mesma e por isso mandava só a `apiKey` para o DeepSeek. Como
saber quem é embutido: `models.authStatus` lista os que o gateway conhece — aqui, só `anthropic` e
`claude-cli`.

⚠️ **Tirar a declaração NÃO faz os modelos pararem de resolver na hora.** Removi `api`/`baseUrl`/
`models` do nó do DeepSeek e o `models.list` continuou devolvendo os dois com `api` — o gateway
guarda o catálogo já resolvido. Consequência prática: **config quebrada pode parecer sã até o
próximo restart**, e um teste que depende de "quebrar de propósito" não reproduz o defeito.

⚠️ **Remover item de array exige `replacePaths`.** O `config.patch` recusa com "would remove entries
from array path(s): …" em vez de apagar em silêncio, e **nomeia os caminhos na mensagem** — use os
nomes que ele deu. Existe também `config.apply` para troca da config inteira.

⚠️ **Depois de um 401 o perfil entra em cooldown** e as execuções seguintes falham em ~200ms sem
tentar. Isso faz o tempo de falha variar (261ms → 3589ms → 195ms) e convida a atribuir a variação à
última coisa que você mexeu. Não atribua: leia
`journalctl --user -u openclaw-gateway.service`, que traz `profile=sha256:…`, o status HTTP e o
`rawError` do provedor. Foi o log que desfez cada palpite errado deste dia.

**O vazamento do token foi fechado (Lote 1).** `frontend/src/lib/gateway.ts` não conhece mais o
`admin_token` — expõe só `{url, temToken, configurado}`. Toda chamada ao gateway passa por
`/gateway/*` ou `/agents`. **Não reintroduza o token no front** ao portar os pontos que ainda usam
`gatewayNaoPortado()`: crie o endpoint proxy no backend.

### Um agente falar com outro — levantado ao vivo em 14/08/2026

O `agent_to_agent` **não é uma ferramenta**. Ligar `tools.agentToAgent` não faz aparecer nada com
esse nome: quem conversa entre agentes é o **`sessions_send`** (e o `sessions_spawn`), que vêm do
perfil `coding` e já estavam lá. O `agentToAgent` é a **política** que libera esses dois a cruzarem
a fronteira do agente. Com ele desligado, o `sessions_send` existe e é recusado.

⚠️ **`allow` lista quem PARTICIPA, não quem recebe.** Foi lido errado aqui, e o erro só apareceu
porque as duas pontas foram testadas:

| quem inicia | destino | `allow` | resultado |
|---|---|---|---|
| `iris` | `nina` | `[iris, atlas]` | recusado — falta `nina` |
| `nina` | `iris` | `[iris, atlas]` | recusado — falta `nina` |
| `nina` | `iris` | `[nina, iris, atlas]` | ✅ |

Ou seja: **os dois lados têm que estar na lista.** A recusa é explícita e boa —
`{"status":"forbidden","error":"Agent-to-agent messaging denied by tools.agentToAgent.allow."}`.

**Quem *inicia* se controla por agente, com `deny`.** `agents.list[].tools.deny =
["sessions_send","sessions_spawn"]` em `iris` e `atlas` deixa só a `nina` acionando. O `deny`
**remove a ferramenta da lista do agente** em vez de recusá-la em runtime — a `iris` responde
"não tenho essa ferramenta". Não existe `agentToAgent` por agente; o schema por agente tem só
`allow`, `alsoAllow`, `deny`, `byProvider`, `codeMode`, `elevated`, `exec`, `fs`, `loopDetection`,
`message`, `profile`, `sandbox`, `toolsBySender`.

`sessions_send` aceita `timeoutSeconds`: com timeout a resposta volta **inline**, e o agente
que delegou não precisa ficar consultando depois. E o destino recebe a mensagem marcada como
**dado entre sessões**, não como instrução de usuário — o que é uma defesa de graça contra usar
um agente para injetar comando noutro.

⚠️ **`agents.list` é array: merge patch substitui o array inteiro.** Para mudar um agente, mande a
lista completa e confira no `conferir` que o `alsoAllow` dos outros sobreviveu.

⚠️ **Servidor MCP se pausa sozinho depois de erros seguidos** (`bundle-mcp server "X" is paused
after repeated failures`). A `nina` chutou três nomes de coluna e derrubou o `banco-hsos` para ela
mesma. Volta sozinho — mas é motivo de sobra para o arquivo do agente mandar consultar
`information_schema` em vez de adivinhar.

⚠️ **O que o agente acionado manda pela ferramenta `message` NÃO volta para quem
acionou.** O `sessions_send` devolve só o texto final do run (está na doc,
`concepts/session-tool`); o `message` segue outro caminho. A `iris` respondia a
`nina` assim — conteúdo pelo `message`, resumo no texto final ("reenviei o
detalhamento") — e a `nina` ficava sem a tabela: pedia de novo ou travava. Foi
o "preciso do conteúdo das listas… Montando o painel" de 29/09, seguido de 1h20
de silêncio com o CEO esperando. Havia ~960 usos de `message` nas sessões
arquivadas da `iris`. Iris, Atlas, Flow e Bruce têm no `AGENTS.md` o bloco
`resposta-a-nina` ("a resposta inteira vai no texto final"). Se voltar a
acontecer, o próximo passo é negar `message` a eles no `deny`.

⚠️ **Sessão principal com tentativa errada na memória repete o erro, mesmo com a
skill corrigida.** Em 30/09 a `iris` voltou duas vezes com o número errado
("reaproveitei a apuração já conferida nesta sessão") até a `agent:iris:main` ser
arquivada. Corrigiu régua ou regra de um agente que vinha errando na mesma
pergunta? Arquive a `main` dele antes de conferir.

### Escopo de banco por agente: `alsoAllow` concede, só o `deny` exclui

⚠️ **`tools.alsoAllow` é ADITIVO — declarar um servidor em `mcp.servers` já o entrega a todos.**
Com `tools.profile: "coding"` e sem `tools.allow` global, todo servidor MCP fica visível para todo
agente; o `alsoAllow` não restringe nada, só acrescenta. Até 14/08/2026 a `nina` enxergava os nove
bancos da empresa tendo dois publicados, e a tela de Conectores dizia o contrário. O comentário do
`publicar_banco` **afirmava explicitamente** que declarar o servidor não dava acesso a ninguém —
estava errado, e sobreviveu porque ninguém perguntou ao agente.

Quem exclui é o **`deny` por agente**, recalculado a cada publicação em `_deny_de_mcp`
(`backend/app/routers/integracoes.py`): `deny = (tudo em mcp.servers) − (o alsoAllow do agente)`,
preservando os denies que não são de MCP (`sessions_send`, `sessions_spawn`).

⚠️ **O `deny` casa pelo nome SEM o prefixo `mcp__`; o `alsoAllow` usa COM.** Os dois convivem no
mesmo objeto e aceitam formatos diferentes. Aplicar `deny: ["mcp__banco-x__query"]` grava, passa em
qualquer conferência que releia a config, e **não remove nada** — a `iris` seguiu enxergando os dez
bancos com o deny "aplicado". O que vale é `banco-x__query`, que é o nome que o agente vê.

Verificação que serve: **perguntar ao agente** quais ferramentas ele enxerga. Reler o `config.get`
não distingue um deny que funcionou de um que não casou com nada.

✅ **Desde 24/11/2026 há verificação melhor, sem gastar turno: `tools.effective`.** É só leitura
(`operator.read`), recebe `sessionKey` e devolve o inventário que a sessão de fato recebe, já com a
política aplicada — `{groups: [{tools: [{id, source}]}]}`, o nome está em **`id`**, não em `name`.
Não cria runtime de MCP: servidor MCP só aparece se a sessão já estiver quente. Foi como o PK-05
conferiu o corte de `exec`/escrita/`sessions_*` nos cinco especialistas
(`scripts/cortar-ferramentas.py --conferir`). Perguntar ao agente continua sendo a conferência de
**texto** nos sete arquivos; para ferramenta, `tools.effective`.

⚠️ **O que cada especialista tem de ferramenta nativa (PK-05, 24/11/2026):** Midas e Flow só `read`,
`memory_get` e as de sessão/objetivo/plano — sem `exec` nem escrita. Atlas e Bruce mantêm `exec` e
escrita (Atlas roda script; o Bruce processa a planilha do ponto do Flash por `exec` e nunca chamou o
`relatorio_ponto`); Nina idem, mais `sessions_*` por orquestrar. `memory_search` saiu de todos:
falha sempre por falta de embeddings. O caminho de quem ficou com `exec` é o PK-06 (fora do root).

⚠️ **`mcp__hsos-alerta__avisar_administrador` só funciona com o backend em produção.** O servidor
aponta para o backend pela rede, e o gateway vive noutra máquina (`2.24.85.122`) — o backend está em
`62.72.11.28`, atrás de `hsosapi.healthsafetytech.com`. Apontar para `172.18.0.1` é o engano fácil:
essa é a bridge do Swarm vista **de dentro do backend**, boa para o backend falar com o túnel, e
sem sentido a partir do gateway. Enquanto a URL esteve errada, `nina` e `iris` confirmaram cada uma
que a ferramenta não aparecia — e o `SOUL.md` das duas mandava usá-la ao detectar tentativa de
subverter os limites. **Servidor MCP fora do ar não publica ferramenta e não dá erro.**

### Todo servidor MCP sobe para TODA sessão — o `deny` não impede (PK-47, 24/11/2026)

⚠️ **O runtime de MCP é por sessão, e conecta todo servidor de `mcp.servers`.** Quem decide criar o
runtime é `shouldCreateBundleMcpRuntimeForAttempt` (dist do OpenClaw 2026.7.1), que olha só o
`toolsAllow` *da execução* — não o `tools.deny` do agente. O `deny` esconde a ferramenta **depois**
que o processo subiu. O runtime fica vivo `mcp.sessionIdleTtlMs` parado (padrão 10 min).

Com os `banco-*` em stdio (`npx -y server-postgres`), cada sessão de cada agente subia 9 pares de
processo, ~720 MB — inclusive os 23 Guardis, que têm todos os bancos negados. Rajada de varredura e
briefing empilhava sessões e a VPS (7,8 GB, sem swap) entrava em OOM: 30 vezes de 17 a 23/11, e o
`erick-bot` minutos em "Iniciando…". Desde 24/11 os 9 apontam para o **`banco-mcp`**, um serviço só
em `127.0.0.1:18790` (`vps-gateway/banco-mcp/`), com a URL do banco no cabeçalho `X-Banco-Url`.
A VPS ganhou também 2 GB de swap (`/swapfile`, `vm.swappiness=10` em
`/etc/sysctl.d/90-pk47-swap.conf`) — rede contra pico, não memória de trabalho: swap em uso
constante é sinal de que algo voltou a crescer.

**Consequência para quem declarar servidor novo:** stdio em `mcp.servers` custa um processo **por
sessão viva**, para todos os agentes. Servidor novo é HTTP (como os `hsos-*`) ou entra no
`banco-mcp`. E os 78 HTTP `hsos-*` também são conectados por toda sessão — não pesam memória na VPS,
mas são handshakes no backend a cada sessão nova.

⚠️ **E "por sessão" é, na prática, por EXECUÇÃO** (25/11/2026): execução embutida pede limpeza do
runtime no fim (`configuration-reference.md` do OpenClaw), então toda mensagem reconecta os 87. Pela
API pública, a etapa `bundle-tools` do log (`prep stages: … bundle-tools:NNNNms`) levava **~20 s em
toda mensagem** e a rajada dava 130 `Request timed out`/dia. Desde 25/11 os 78 `hsos-*` apontam para
a **`mcp-ponte`** (`127.0.0.1:18791`, `vps-gateway/mcp-ponte/`): `initialize` e `tools/list` saem de
cache (vencido aos 5 min, servido na hora e atualizado em segundo plano), `tools/call` vai à API.
**Ferramenta nova num deploy aparece com uma execução de atraso** — com pressa, `curl -X POST 127.0.0.1:18791/esquecer` na VPS. Servidor novo `hsos-*` herda a ponte porque
os scripts de publicação copiam a base do `hsos-relatorios`; quem montar URL na mão, use a ponte.
O OpenClaw não tem escopo de servidor por agente fora do harness do Codex (`codex.agents`) nem manda
a identidade do agente ao servidor — por isso a ponte, e não um servidor único por família.

⚠️ **Sem `requestTimeoutMs` na entrada, o `tools/list` de cada MCP tem 1,5 s** (26/11/2026). É o
`BUNDLE_MCP_CATALOG_LIST_TIMEOUT_MS` do `agent-bundle-mcp-runtime-*.js`; declarando o campo, vale o
valor dele. A ponte não bastou: na rajada de 26/11 07:30 (6 execuções juntas, 87 clientes cada) houve
23 `Request timed out` com a ponte respondendo do cache — o log dela vazio, e o `banco-mcp`, outro
serviço, caindo igual. Quem atrasava era o laço do próprio gateway. **Três falhas tiram o servidor
por 60 s** (`BUNDLE_MCP_FAILURE_COOLDOWN_MS`), e foi assim que bots ficaram sem os próprios anexos e
e-mail. Desde 26/11 as 87 entradas têm `requestTimeoutMs: 60000` (`scripts/prazo-catalogo-mcp.py`).
**60.000 e não menos**: é o `DEFAULT_REQUEST_TIMEOUT_MS`, e o mesmo campo governa o `tools/call` —
um número menor cortaria relatório e anexo. Entrada nova montada na mão tem que levar o campo; o
`publicar-anexos-mcp.py` copia o modelo inteiro e herda, e o `entrada_mcp_banco` já o leva.

⚠️ **O `exec` da nina e do atlas roda em sandbox Docker desde 26/11/2026 (PK-06).**
Contêiner `openclaw-sbx-agent-<id>-*`, sem rede, raiz só-leitura, `capDrop: ALL`, 512 MB, com
SÓ o workspace montado em `/workspace` (o `/root/.openclaw/openclaw.json` fica fora de alcance).
Três armadilhas, todas da documentação e conferidas ao vivo:
- **A sandbox tem uma SEGUNDA lista de permitidas** (`tools.sandbox.tools`). O padrão só deixa
  `exec`, arquivos e `sessions_*`: sem `alsoAllow` com `bundle-mcp` o agente perde TODAS as MCP.
  O `scripts/sandbox-especialistas.py` usa o inventário do `tools.effective` mais `bundle-mcp`.
- **O `elevated` (rodar `exec` FORA da sandbox) vem LIGADO por padrão**, mesmo ausente da config —
  `openclaw sandbox explain --agent X --json` mostrou `enabled: true`. Fechado por agente
  (`tools.elevated.enabled: false`); o portão por agente só restringe.
- **Backend SSH não serve aqui**: é "remote-canonical", copia o workspace uma vez e nunca volta —
  quebraria a regra dos sete. Docker monta o workspace do host, que continua o oficial.
- **Sessão em sandbox tem trava própria de visibilidade** (`sandbox.sessionToolsVisibility`,
  padrão `"spawned"`): só enxerga as sessões que ela mesma criou, **mesmo com
  `tools.sessions.visibility="all"`**. Em 26/11/2026 isso cortou a delegação da nina às 09:43
  (PK-06) e ninguém viu até 13:49 — "Session not visible from this sandboxed agent session" no
  `sessions_send` para `agent:atlas:main`/`agent:midas:main`. ⚠️ **Só vale em
  `agents.defaults.sandbox`**: gravada em `agents.list[nina].sandbox` o schema ACEITA e o gateway
  IGNORA (às 13:55, depois da gravação, seguia "forbidden"). Hoje `agents.defaults.sandbox.
  sessionToolsVisibility = "all"` (`--visibilidade` no script) — vale para nina, atlas e bruce, o
  estado de antes das 09:43. A chave por agente ficou na nina, inerte: o mesmo patch não a tirou.
Conferir: `openclaw sandbox explain --agent nina --json` e `docker inspect` do contêiner.
Agente novo com `exec` nasce SEM sandbox — entra na lista `ALVOS` do script.

⚠️ **Na VPS do gateway, nunca rode a CLI do OpenClaw com `OPENCLAW_STATE_DIR` alternativo.** Em
24/11, um `openclaw mcp probe` com estado numa pasta temporária (para testar uma config à parte)
"migrou" o estado legado e **renomeou o `/root/.openclaw/exec-approvals.json` do gateway vivo** para
`.migrated`. Desfeito no minuto seguinte. Para testar config à parte, `OPENCLAW_CONFIG_PATH` sozinho.

### Sessão: compactar é prevenção, e a `main` não tem dono

Levantado em 20/08/2026, destravando a `iris` depois que o CEO recebeu "Envio
desconhecido".

⚠️ **`sessions.compact` existe e funciona; a mensagem `/compact` não.** São
coisas diferentes: a mensagem é um turno como outro qualquer e numa sessão
estourada nem chega a rodar. Medido na sessão do CEO — `totalTokens` ficou em
182.161 antes e depois do `/compact`, e caiu na primeira chamada do RPC. Passei
uma manhã inteira concluindo errado a partir daquele número parado.

⚠️ **Não há segunda compactação.** Sessão já compactada devolve
`{"ok": false, "compacted": false, "reason": "Already compacted"}` e continua do
mesmo tamanho, para sempre. A `agent:iris:main` tinha **três** marcadores de
`Compaction` e respondia "Context overflow" a "responda apenas: ok". Depois
desse ponto só `sessions.delete`, que **arquiva** em vez de destruir.

⚠️ **`totalTokens` do `sessions.list` é o tamanho ATUAL do contexto**, não
consumo acumulado. Três turnos curtos numa sessão nova: 23.416 → 23.450 →
23.476. Eu li isso errado nos dois sentidos no mesmo dia — primeiro certo,
depois "corrigindo" para cumulativo. O teste leva trinta segundos.

⚠️ **Sessão travada aparece com `totalTokens` zerado ou nulo**, não com número
alto: o contador só é atualizado por turno que deu certo. Limiar sozinho não a
encontra.

⚠️ **A `agent:<id>:main` é onde caem os `sessions_send` entre agentes, e ninguém
olhava por ela.** A auto-compactação mora no `/reply`, que só roda com alguém
esperando na tela. A `main` acumulava até travar, e travada **derruba todo
`sessions_send` para aquele agente** — foi assim que a `nina` disse "deixa eu
acioná-los em paralelo" e o CEO viu "Envio desconhecido". Hoje quem cuida é
`app/vigia_sessoes.py`, que compacta no limiar e arquiva a sessão sem dono que
já passou.

⚠️ **O piso do prompt de um agente nosso é ~23 mil tokens numa janela de 65 mil.**
Medido com sessão nova respondendo "oi". Com `reserveTokens: 24000` de buffer de
compactação, sobram **~18 mil para conversa de verdade** — meia dúzia de
resultados de consulta. É por isso que a compactação entra tão cedo.

⚠️ **E servidor MCP quase não pesa nesse piso — eu chutei e errei por 600x.**
Afirmei em 20/08/2026 que os 12 servidores eram ~15.300 dos 23.416, e que fechar
o escopo devolveria contexto. Fechei: a `iris` passou de 12 servidores para 2, e
o piso foi de 23.416 para **23.391**. Vinte e cinco tokens. O schema de um
`banco-x__query` é minúsculo; o peso está nos sete arquivos (~8.100 na `iris`),
nas ferramentas embutidas do perfil `coding` e na lista de skills.

**Fechar o escopo continua certo — só que por outro motivo.** É acesso a dado:
até 20/08 a `iris` enxergava o banco de gente e o `atlas` o financeiro. Hoje cada
um vê o seu, mais `banco-diretorio-hs-os` (identidade de quem fala), a base de
conhecimento, `publicar_pagina` e o alerta — cortar qualquer um desses faz o
agente contradizer os próprios arquivos, que os citam nominalmente.

| agente | banco |
|---|---|
| `nina` | só `banco-hsos` — orquestra e delega o domínio |
| `iris` | dormindo desde 19/11/2026 — o `midas` a substitui |
| `midas` | `banco-datacorehs`, `banco-gestorhs`, `banco-hsgrowth` + `compradores_produto` e `inadimplencia` — sem `publicar_pagina` |
| `atlas` | `banco-hsgrowth` + `relatorio_vendedores` |
| `flow` | `banco-gestorhs`, `banco-taskhs`, `banco-chamadoshs` |
| `bruce` | `banco-talenths`, `banco-pessoas-hs` |

⚠️ **O `banco-hsos` da `nina` entra com `hsos_agente`, não com `leitura`
(10/11/2026).** O `leitura` tem `pg_read_all_data` + BYPASSRLS — por ele a
`nina` lia toda DM, as `email_*` e `integrations.credentials` (senhas dos
conectores). O `hsos_agente` lê uma **allowlist** de 26 relações
(`033_usuario_agente.sql`, tirada de 2.004 consultas reais dela) e as
funções SECURITY DEFINER não lhe são executáveis (`034`). Consequências:

- **Tabela nova nasce invisível à `nina`.** Se ela precisar, acrescente na
  allowlist (nova migração) — e pergunte antes se é dado de pessoa.
- ⚠️ **Função SECURITY DEFINER nova nasce com EXECUTE para PUBLIC** e
  atravessa a allowlist: repita nela o `REVOKE … FROM PUBLIC` + grants da
  `034` e rode `~/aplicar-hsos-034.py` de novo, que confere todas.
- O `leitura` continua sendo o usuário do Erick (e do Claude) para consulta.

⚠️ **`agents.list` (RPC) NÃO devolve o `tools` declarado na config.** Ele veio com
`deny: []` para os cinco enquanto a config tinha `sessions_send`, `sessions_spawn`
e `skill_workshop` negados — foi o que me fez concluir que o escopo nunca tinha
sido aplicado. Para ler o que está declarado, use `config.get`; para saber o que
o agente **enxerga**, pergunte a ele.

### O gateway zerava toda conversa uma vez por dia — 16/11/2026

⚠️ **Sem `session.reset` declarado, o OpenClaw 2026.7.1 usa `mode: "daily"` com
`atHour: 4`, no fuso da VPS (UTC → 01:00 de Brasília).** A doc atual diz que o
padrão é "nenhum reset"; o código desta versão (`reset-policy.ts`,
`DEFAULT_RESET_MODE = "daily"`) diz o contrário, e é ele que vale. A sessão é
arquivada como `<id>.jsonl.reset.<ISO>` na **primeira mensagem do dia
seguinte**, com a mesma chave: no nosso lado aparece só como `seq` que volta
para 1–2 no `agent_runs`, sem linha em `conversation_resets`.

Achado pela Lara: o Guardi dela entregou um roteiro às 15h e, na manhã
seguinte, respondeu "não tenho o roteiro na memória desta conversa". Eram 19
agentes com resets que ninguém pediu desde 05/11. O `MEMORY.md` (o `lembrar`)
sobrevivia, e por isso o estilo ficava e só o trabalho em curso sumia.

Hoje: `session.reset = {mode: "idle", idleMinutes: 525600}` (um ano = na
prática nunca), aplicado com `openclaw config set` na VPS. ⚠️ O schema recusa
`idleMinutes: 0` e não aceita `mode: "none"` nesta versão. Quem limita o
tamanho é a compactação do vigia (`_TETO`), e recomeçar é o "Nova conversa".
**Ao atualizar o OpenClaw, confira se o padrão mudou** antes de tirar a chave.

### Agendamento (`cron.*`) — contrato levantado em 19/08/2026

```
cron.add    { name, schedule, sessionTarget, agentId, payload }  → o JOB, no topo
cron.list   { includeDisabled? }                                 → { jobs: [...] }
cron.get    { id }                                               → o job
cron.update { id, patch }  ⚠️ é `patch`, não os campos soltos
cron.remove { id }         ⚠️ por `id`, não por `name`
```

⚠️ **`cron.add` devolve o job NO TOPO, e o job tem um campo `payload`.** O
`chamar()` já entrega o resultado do RPC desembrulhado (`client.py:172`), então o
idioma `(r.get("payload") or r)` — espalhado pelo backend como desembrulho
defensivo, 18 ocorrências — aqui encontra o `payload` **do cron**
(`{kind, message, timeoutSeconds}`) e devolve o objeto errado, sem erro nenhum.
Em 21/08/2026 isso produziu HTTP 201 com `gateway_job_id` nulo: o job nascia no
gateway e ficava órfão, sem como desligar nem apagar. O idioma é inofensivo
quando o resultado não tem `payload` — `cron.list` e `agents.list` são assim —, e
foi por isso que sobreviveu. **Desconfie dele em todo método cujo resultado seja
um objeto de domínio, não um envelope.**

Varrido em 21/08/2026, chamando cada método e olhando as chaves do resultado:

| resultado tem `payload` no topo? | métodos |
|---|---|
| **⚠️ sim — o idioma devolve o objeto errado** | `cron.add`, `cron.get`, `cron.update` (os três devolvem o **job**) |
| não — o idioma é inerte | `agents.list`, `agents.files.list`, `agents.files.get`, `config.get`, `models.list`, `models.authStatus`, `skills.status`, `cron.list`, `channels.status`, `sessions.list` |

Ou seja: as 18 ocorrências espalhadas pelo backend **não estão quebradas hoje** —
todas caem na segunda linha. Não saí trocando, porque mexer em 18 lugares sem
mudança de comportamento é churn com risco. O que muda é a regra: **método novo
que devolva um objeto de domínio, use `r` direto e confira as chaves antes.**

⚠️ **`cron.list` sem parâmetro OMITE job desligado.** Levantado em 21/08/2026:
desligar um agendamento o fazia sumir da lista, e como é ela que a tela mostra, o
botão de religar sumia junto — porta de mão única com cara de "o toggle apagou o
job". Com `includeDisabled: true` os 5 jobs viram **11** neste gateway: os
desligados de propósito e mais quatro disparos de tiro único (`kind: "at"`) que o
gateway desliga sozinho depois de rodar, e que ninguém via.

⚠️ **`cron.update` não valida o enum de `delivery.mode`.** Um `patch` com
`{"delivery":{"mode":"isto-nao-existe"}}` passa na validação de params e só falha
no id. Mesma família do `agents.update` que grava modelo inválido: **releia
depois de escrever**.

`schedule` é uma união de três formas, e a mensagem de erro nomeia todas:
`{kind:"at", at:"<ISO>"}` (tiro único, recusa horário no passado),
`{kind:"cron", expr:"30 10 * * 1-5"}` e uma terceira com `everyMs`.

⚠️ **É `expr`, não `expression`** — e não há campo de fuso: **o `expr` é em UTC**.
Confirmado criando um job e lendo o `nextRunAtMs` de volta: `30 10 * * 1-5` cai às
07h30 de Brasília.

⚠️ **`cron.add` NÃO valida o `agentId`, e isso quebra o truque de sondagem.** A
regra de ouro daqui — "para descobrir formato sem escrever, use um `agentId`
inexistente, que o gateway valida o schema e falha antes de resolver o agente" —
**não vale para o `cron.add`**. Em 19/08/2026 uma sondagem com
`agentId: "agente-que-nao-existe-xyz"` foi **aceita** e criou o job. Foi removida
no mesmo minuto porque a checagem seguinte era um `cron.list`; sem ela, teria
ficado um agendamento fantasma apontando para um agente que não existe.

⚠️ **Existem TRÊS coisas chamadas "cron" e nenhuma concordava com as outras.**
Levantado em 19/08/2026 porque o painel do `flow` dizia "nenhum agendamento" com
dois crons rodando:

| onde | quem escreve | estado hoje |
|---|---|---|
| `public.agent_crons` | `POST /agents/{id}/crons` | **espelho real desde 21/08** — a rota agenda no gateway e guarda o `gateway_job_id` |
| `public.cron_jobs` | `POST /coletor/estatisticas`, que um coletor da VPS deveria empurrar e **não empurra** | 0 linhas, segue morta |
| `cron.list` do gateway | o próprio gateway | **a verdade** |

O painel lia o espelho vazio. Hoje `GET /agents/{id}/agendamentos-do-gateway`
pergunta ao `cron.list` **com `includeDisabled`**, com recuo para a tabela se o
gateway estiver fora — mostrar o que se sabia é melhor que trocar vazio
silencioso por erro.

✅ **`POST /agents/{id}/crons` agenda de verdade desde 21/08/2026** (`b76689c`,
`69c5f48`, migração `013`). Gateway primeiro, banco depois: se o `cron.add`
recusar a expressão, nada é gravado. A rota confere o agente no `agents.list`
antes, porque o `cron.add` não valida `agentId`. O `PATCH` liga/desliga por
`cron.update` e o `DELETE` remove por `cron.remove`.

⚠️ **Antes disso a rota não estava "sendo usada errado" — ela não tinha UM
chamador.** O hook `use-agent-crons.ts` expunha `addCron`/`toggleCron`/
`deleteCron` e nenhum era chamado; o `AgentDetailPanel` importava `useAgentCrons`
e não o usava. A tela mostrava um "+" desabilitado. É a mesma doença da
`agent_context_state`, que o comentário do vigia já nomeava: *"endpoint sem um
único chamador em todo o repositório"*. **Ao encontrar uma rota que "não
funciona", confira primeiro se alguém a chama** — pode não ser bug, pode ser
código que nunca foi exercido.

⚠️ **O nome do job carrega o id da nossa linha:** `hsos-agentcron-<uuid>`. É o que
permite à tela saber o que é editável sem buscar duas listas. Cron criado direto
no gateway (os briefings) aparece e fica read-only.

⚠️ **Nós criamos, o gateway numera.** O `id` do job **não** é o uuid da nossa
linha — o gateway atribui o dele. Sem guardar o `gateway_job_id` não há como
editar nem apagar depois.

**Os briefings da manhã** são **cinco** jobs recorrentes em dias úteis, todos em
`sessionTarget: "isolated"` e usando a skill do seu domínio: `flow` 07h30
(Operação), `iris` 07h35 (Faturamento), `atlas` 07h40 (Vendedores), 07h45 (SDR) e
07h50 (Serviços).

⚠️ **`sessionTarget: "isolated"` NÃO é sessão nova a cada execução.** Existe uma
`agent:<id>:cron:<jobId>` que persiste e acumula entre os dias. Em 21/08/2026 a do
cron de Serviços estava em 40.588 tokens — 98% da janela útil do `atlas` — e o
briefing falhava com "Context overflow" todo dia. Ver *A janela útil* abaixo.

⚠️ **`delivery: {mode: "announce"}` sem canal faz TODA execução terminar em
`error`, mesmo quando o briefing saiu.** Este gateway não tem canal nenhum
(`channels.status` devolve `channels: {}`), então o announce nunca entregou nada.
Em 21/08 os cinco jobs reportaram `error` e **quatro tinham funcionado** — o campo
que deveria ser o sinal de saúde mentia em 80% dos casos. Hoje os cinco estão em
`{mode: "none"}` ("no runner fallback delivery"), e `error` voltou a significar
falha de verdade. Os modos são `announce`, `webhook` e `none`.

⚠️ **Por isso o guardião confere o EFEITO, não o status.** `app/guardiao_briefings.py`
pergunta "o documento existe?" em vez de olhar `lastRunStatus` — se olhasse o
status, em 21/08 teria refeito os cinco, quatro deles à toa, gastando contexto do
`atlas`. Ele também **não** usa `includeDisabled`: briefing que alguém desligou de
propósito não deve ser refeito.

### Agente não agenda a si mesmo — e o disjuntor que ficou disso

⚠️ **Em 25/08/2026 a `nina` criou para si um cron de 3 em 3 minutos e ele rodou
560 vezes em 28 horas.** Ela percebeu que a `iris` estava travada por contexto
estourado — escreveu isso, com essas palavras — e, em vez de avisar, montou um
vigia próprio para conferir se a colega voltava. Cada execução escrevia um
documento novo dizendo "ainda pendente": **197 documentos**, contra 40 úteis na
Base de Conhecimento inteira. Parou porque o Erick abriu a tela por outro motivo.

⚠️ **Ela tinha `avisar_administrador` liberado e usou na MESMA conversa**, para
outra coisa. Não faltou ferramenta nem diagnóstico — faltou a regra de que
bloqueio de terceiro se relata, não se patrulha. É o exemplo mais limpo que
temos de agente que acerta o diagnóstico e erra a ação.

E o pedido nem era da `iris`: era *"quem comprou bafômetro e não tem
calibração"*, e o cadastro de calibração vive no **GestorHS**, que é do `flow`.
O roster no `AGENTS.md` dela dizia isso — em texto corrido, no meio de uma frase
longa. Só passou a funcionar quando virou palavra nominal (`aparelho`,
`calibração`) na linha do Flow **e** na coluna "não é dele" da Iris.

Três camadas saíram disso, e de propósito **nenhuma depende das outras**:

| camada | onde | o que garante |
|---|---|---|
| a ferramenta | `cron` em `_DENY_NAO_MCP` | o agente não consegue se agendar |
| o julgamento | `AGENTS.md` da `nina` | ele relata em vez de patrulhar |
| o disjuntor | `app/guardiao_crons.py` | pega o que as duas primeiras não previram |

⚠️ **`cron` precisou entrar na tupla `_DENY_NAO_MCP`, não só na config.** O
`_deny_de_mcp` reescreve o `deny` de cada agente **do zero** a cada publicação de
conector; o que não estiver naquela tupla some sem erro e sem aviso.

⚠️ **A conferência de um `deny` é perguntar ao agente.** Reler o `config.get` não
distingue um deny que casou de um que não casou — mesma armadilha de 14/08 com o
prefixo `mcp__`. Aqui: *"você tem a ferramenta `cron`?"* → *"NÃO."*

**O disjuntor não julga se o job é útil** — julgar intenção foi o que falhou. Ele
mede o período por `nextRunAtMs − lastRunAtMs` (serve para `expr` e para
`everyMs` sem interpretar expressão cron) e confere a procedência pelo nome:

- abaixo de 15 min **e** fora de `hsos-agentcron-*`/`hsos-briefing-*` → **desliga** e alerta;
- abaixo de 15 min mas nascido pela tela → só alerta o custo, porque a escolha foi de gente;
- procedência desconhecida com ritmo normal → só visibilidade.

Uma ação por job por dia, reservada em `app_settings` com `ON CONFLICT DO
NOTHING` — sem isso os dois workers do uvicorn alertam em dobro.

### A janela útil — e a janela que estava declarada pela metade

⚠️ **Em 31/08/2026 descobriu-se que a conta abaixo partia de um número errado.**
O `deepseek-chat` foi aposentado em 24/07/2026 e as chamadas roteiam para o
**DeepSeek-V4-Flash, que tem 1.000.000 de contexto**. A config do gateway
declarava 65.536 — 6,5% da capacidade real. A denúncia estava no próprio
`models.providers`: `"name": "DeepSeek V4 Flash"` sob `"id": "deepseek-chat"`.

Era essa a causa dos 24 resets de conversa na semana de 24/08 e do
`Context overflow` que derrubava briefing de manhã. A prova: logo após a
correção, o `sessions list` mostrou a sessão do `atlas` em **66k** — que, contra
os 65.536 declarados antes, é **mais de 100% da janela**.

```
                                   até 31/08      depois
janela do deepseek                 65.536         1.000.000
− reserveTokens                    24.000         24.000
──────────────────────────────────────────────────────────
janela útil                        41.536         976.000
piso de um agente nosso           ~25.124        ~25.124
espaço real de conversa           ~16.412        ~950.000
```

⚠️ **O vigia lê a janela do gateway, então ele acompanhou sozinho — e foi longe
demais.** `_LIMIAR` de 0,85 sobre 976.000 dá ~829.600: sessão crescendo 23× antes
de compactar. Como o prompt inteiro é reenviado a cada turno, contexto grande é
custo e latência em **todo** turno seguinte, não uma vez. Por isso existe agora
um teto absoluto, `_TETO = 150_000` em `vigia_sessoes.py`: acaba o estouro em 41K
sem deixar a sessão inchar sem limite. O ponto de compactar virou
`_ponto_de_compactar(limite, reserva)`, com teste.

⚠️ **Não baixe a fração achando que é mais seguro** — o raciocínio de 21/08
continua valendo dentro do teto: 0,65 sobre a útil antiga daria 26.998, e com o
piso em ~25.124 isso é compactar uma sessão com 1.874 tokens de conversa.

⚠️ **A conta antiga, que ficou aqui como registro do erro de método.** Até
21/08/2026 o `_LIMIAR` multiplicava a **janela crua**: 0,65 × 65.536 = 42.598, ou
seja mil tokens **depois** do ponto de falha — uma faixa morta em que a sessão
falhava em toda execução e o vigia, olhando o denominador errado, achava que
estava folgada. O erro de 31/08 é o mesmo em outra camada: o denominador certo
sobre um número que ninguém tinha conferido na origem.

### O `models.json` de cada agente não acompanha a config

⚠️ **Mudar `models.providers` na config NÃO chega aos agentes sozinho.** Cada um
tem uma cópia do catálogo em `~/.openclaw/agents/<id>/agent/models.json`, e o
gateway só a regrava para o agente **padrão** (`nina`), ao iniciar; nos outros,
só quando o modelo não resolve pela cópia — e ela resolve. Levantado em
30/09/2026 lendo o código (`server-startup-post-attach`, `embedded-agent`): a
correção da janela de 31/08 **nunca chegou ao `flow` nem ao `bruce`**, que
rodaram um mês com 65.536 de contexto enquanto a config dizia 1.000.000.

Depois de qualquer mudança de modelo na config: confira o `models.json` dos
cinco (o script `~/alinhar-models-agentes.sh` do Erick alinha e reinicia) e
reinicie o gateway.

⚠️ **Esse arquivo guarda a `apiKey` do provedor em texto puro.** Ao inspecioná-lo,
leia os campos por script — nunca `cat`/`sed` do arquivo inteiro. Em 30/09 a
chave da DeepSeek foi parar num transcript assim.


### Fila única de 6 e teto por agente (PK-12, 25/11/2026)

`agents.defaults.maxConcurrent: 6` (padrão do 2026.7.1: 4). A fila `main` é **uma para a empresa
inteira**: em 25/11, com 4, foram 8 turnos esperando ~41 s (máx. 51 s) só para começar
(`lane wait exceeded … activeAhead=4` no log). 6 foi a decisão de 23/11, condicionada ao swap
(PK-47) e ao timeout dos MCP (mcp-ponte). **Medir de novo antes de subir mais.**

A `nina` tem `bootstrapMaxChars: 30000` e `bootstrapTotalMaxChars: 80000` na entrada dela de
`agents.list`. Script: `scripts/pk12-config-gateway.py` (manda a lista INTEIRA — com lista
parcial o `replacePaths` do `aplicar_patch` tiraria os outros agentes). Backup:
`/root/openclaw.json.antes-pk12`.

⚠️ **Compactação com roteiro não existe pelo RPC:** `sessions.compact` aceita só `key`, `agentId`
e `maxLines` (`additionalProperties: false`), e não há instrução configurável para a automática.
O `/compact <instruções>` é mensagem de chat — e mensagem não compacta sessão estourada.
