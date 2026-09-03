# Continuar aqui

Ponto de retomada da portagem. Atualizado em **03/09/2026**. Leia isto, depois
`CLAUDE.md` e `docs/ROADMAP.md`.

👉 **Voltando na segunda (17/08)?** Pule para
[*Segunda-feira — por onde pegar*](#segunda-feira--por-onde-pegar).

🎉 **O front saiu do Supabase.** Nenhuma chamada `.from()`, nenhum
`functions.invoke`, nenhum `supabase.channel`. O único arquivo que ainda
importa o client é o próprio `integrations/supabase/client.ts`, que existe só
para lançar caso alguém o use. **Zero** edge functions por portar.

👉 **Arena e voz seguem pausadas; a War room voltou em 01/09** — ver
[`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md).

👉 **Vai testar o sistema?** [`TESTAR-SEGUNDA.md`](TESTAR-SEGUNDA.md) é o roteiro
da **fase da migração** (escrito em 07–10/08), e essa fase fechou. Continua útil
para o básico — túnel, subida, login. Para o que mudou depois, veja
[*Conferir no navegador*](#conferir-no-navegador) logo abaixo.

---

## O que aconteceu em 03/09/2026

**A cauda do tempo real tinha causa, e eram dois defeitos no cliente.** A
seção *O que NÃO foi conferido* de ontem registrava "a cauda existe; não se
sabe de onde ela vem". Sabe-se agora, e nenhum dos dois é rede:

1. **Reconexão fantasma, que vira cascata.** Os tópicos vão na URL, então
   trocar de canal refaz a conexão. O `onclose` da conexão substituída chegava
   com `socket` já apontando para a nova e **mesmo assim agendava outra
   reconexão**; passado o backoff, ela derrubava a saudável, cujo `onclose`
   agendava mais uma. Medido em teste: **7 sockets em 60 segundos** a partir de
   uma única troca de canal. A escada de espera é 1, 2, 4, 8, 16, 30s — e a
   entrega de **11,6s** cai entre 8 e 16.
2. **Conexão aberta e morta.** Sem vigia de silêncio, `readyState` fica `OPEN`
   para sempre e a aba fica surda até alguém recarregar. O servidor já contava
   com esse vigia: o comentário de `_INTERVALO_PING` afirma que "o cliente usa o
   silêncio prolongado como sinal de queda". **O cliente não usava.**

E ao reconectar agora **ressincroniza** — não há replay do que passou durante a
queda, então sem invalidar as buscas a tela fica com o estado de antes.

⚠️ **Isto não prova que aquelas duas medições foram estes defeitos.** Prova que
os defeitos existem e produzem exatamente esse sintoma. A confirmação é a
próxima medição com uso real, e ela precisa ser feita **trocando de canal**, que
é o gatilho.

**O guardião refazia briefing no fim de semana.** `_hora_marcada` lia só o
minuto e a hora do `expr` e ignorava `* * 1-5`. No sábado o cron corretamente
não roda, o documento corretamente não existe, e o guardião concluía que tinha
falhado: 20 documentos e 20 reservas `briefing_refeito:*` em sáb 22, dom 23,
sáb 29 e dom 30/08 — vinte execuções de agente e vinte alertas ao administrador
anunciando falha que não houve.

**A tela mostrava o horário do cron em UTC sem dizer que era UTC** — "Dias úteis
às 10:30" para um briefing que chega 07h30. Duas cópias de `describeCron`
viraram uma função pura, agora em Brasília e com a etiqueta.

**Varredura das pendências: três já não existiam.** As skills saíram para
`backend/skills/` (o 404 morreu), o `agentToAgent.allow` tem os cinco agentes,
e `cron` está negado em todos — inclusive na `nina`, que é quem se agendou em
25/08. A senha do superusuário e as feature flags estavam descritas errado
neste arquivo; corrigidas acima.

**O que continua aberto:** a `nina` segue com `channels` vazio em
`agent_profiles` (as outras quatro têm `{webchat}`), e `role` está vazio nos
cinco — quem carrega o papel é `specialty`.

---

## O que aconteceu em 02/09/2026

**A empresa entrou.** De 4 contas para **27**, e a conversa entre pessoas voltou
ao produto. O registro medido está em
[`CONFERENCIA-CHAT-PESSOAS.md`](CONFERENCIA-CHAT-PESSOAS.md) — leia de lá a
seção *O que NÃO foi conferido* antes de continuar o trabalho.

O que entrou em produção: as migrações `014` (a regra de quem vê um agente vira
função SQL com trigger) e `015` (canal de grupo só o administrador cria), os
dois canais DM órfãos apagados, e as 23 contas que faltavam do quadro do
TalentHS. Front deployado e confirmado no bundle.

**Onde pegar amanhã: os Passos 1, 2 e 4 da Tarefa 8.** As rotas de produção com
token de colaborador e de administrador, e a conversa no navegador com duas
contas. Nenhum dos três rodou. A conversa entre pessoas **nunca teve uma
mensagem sequer** neste sistema — nada em produção comprova aquele caminho.

⚠️ **Comparar `openapi.json` NÃO diz se o backend novo subiu.** Tentei: 195
rotas dos dois lados, nenhuma diferença — e não prova nada, porque esta entrega
não criou rota nenhuma, mudou o comportamento dentro das existentes. Método
errado para a pergunta. Quem responde é o Passo 1.

**Dado de pessoa em repositório público.** O `005` e o `006` descreviam a
coordenadora do RH pelo nome, com e-mail e cargo, em comentário; o teste da
carga tinha o mesmo registro. Trocado por gente inventada — e a branch foi
reconstruída commit a commit antes do push, porque limpar só o arquivo deixaria
o dado vivo no histórico que sobe junto. A branch original ficou guardada em
`backup/chat-entre-pessoas-pre-limpeza`. **Não devolva nome real ao fixture.**

**A senha antiga do superusuário do Postgres não autentica mais** em
`62.72.11.28:2222` — a rotação, dada como pendente desde ago/2026, foi feita.
Conferido só nesse host/porta/banco. Sobrou `backend/.env.superusuario` com a
credencial morta dentro: vale apagar.

---

## O que aconteceu em 01/09/2026

Dia de conferir o que 31/08 deixou marcado, e o que mais apareceu ao conferir.
O registro medido está em [`CONFERENCIA-2026-09-01.md`](CONFERENCIA-2026-09-01.md).

**Os cinco briefings passaram de primeira** (07:32–07:50), confirmando o conserto
da janela de contexto. O `/monitoring` encheu. Os `conversation_resets` caíram de
31 para 11 por semana — mas **sem tráfego que prove**: 14 mensagens em 31/08,
nenhuma em 01/09. Zero reset sem uso não separa conserto de silêncio; reconferir
na primeira semana de uso real.

**A lição do dia, que se repetiu três vezes: contar linha não é conferir dado.**

- Dei o `/monitoring` por resolvido olhando `count(*) > 0`. O coletor gravava
  **seis campos chumbados** — `version`, `uptime_seconds`, `messages_total`,
  `cache_hit_rate`, `error_rate`, `tool_calls`. De nove, três eram medidos.
- A War room ia mostrar todos os agentes apagados: `agent_stats.status` vale
  `"ok"`, não `"online"` — é resultado da última execução, não sinal de vida.
- Os nós iam subir sem rótulo: `agent_profiles.role` está **vazio** nos cinco;
  quem carrega o papel é `specialty`.

A régua que ficou no código, em `app/warroom.py` e `app/coletor_metricas.py`:
**medido ou `NULL`, nunca zero inventado.** Numa parede vista de longe, `0%` é
lido como medição.

**E dois bugs que só apareceram renderizando**, não na suíte: o rótulo de um nó
cuspiu o CSS de um artefato publicado pela tela toda, e o `dangerouslySetInnerHTML`
herdado transformava mensagem de agente em DOM — XSS numa tela que qualquer um
com o link da TV enxerga. Ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md).

**A War room voltou**, re-fonteada: 6 das 12 tabelas que a `warroom-feed` lia
estão vazias, então portar fiel teria subido uma TV em branco. A constelação
original é a mesma; só a origem dos dados mudou.

⚠️ **Front e back sobem separados no EasyPanel.** Deployar um só descasa as
versões, e foi o que deu tela branca em produção. `lib/warroom-feed.ts` agora
normaliza a resposta na fronteira, então a tela degrada em vez de quebrar — mas
a regra continua: mexeu nos dois, sobe os dois.

**Três contradições entre documentos** foram corrigidas — o Lote 6, o Lote 7 e o
bloqueio do Lovable descreviam estado que não existia mais. Todas da mesma forma:
um documento recebeu o fato novo e o outro não foi visitado. Nenhuma aparece
lendo; só cruzando. O `ROADMAP.md` é o que mais atrasa, por ser o mais citado.

---

## O que aconteceu em 26/08/2026

Voltando depois de quatro dias, a Base de Conhecimento estava **impossível de
ler**: 237 documentos, dos quais **197 eram ruído de um único cron**. O pedido
era "melhorar a organização dos documentos"; o problema era outro.

**Uma torneira aberta desde 25/08 às 05:25.** A `nina` criou para si um cron
`everyMs: 180000` — 3 em 3 minutos, sem prazo e sem condição de saída — para
vigiar se a `iris` desbloqueava. **560 execuções em 28 horas**, um documento novo
a cada uma. Ainda estava rodando quando a sessão começou; só parou porque o Erick
abriu a tela e estranhou.

⚠️ **Ela acertou o diagnóstico e errou a ação.** Escreveu "a sessão dela segue
travada no contexto estourado" e tinha `avisar_administrador` liberado — usou na
mesma conversa, para outra coisa. Escolheu patrulhar.

⚠️ **E o pedido nem era da `iris`.** Era "quem comprou bafômetro e não tem
calibração": calibração mora no GestorHS, que é do `flow`. O roster dela já dizia
isso, em texto corrido. Só pegou quando virou palavra nominal na tabela.

**O que foi feito, em três camadas independentes:**

1. `cron` negado aos cinco agentes, e posto em `_DENY_NAO_MCP` para não sumir na
   próxima publicação de conector. Conferido perguntando a ela.
2. `AGENTS.md` da `nina`: `bruce` entrou na tabela (faltava), calibração ficou
   nominal, pedido que cruza dois domínios volta para quem pediu, e a seção
   "Heartbeat" — que **convidava** a verificações periódicas — virou "eu não me
   agendo, e não fico vigiando", com o incidente escrito por extenso.
3. `app/guardiao_crons.py`: o disjuntor, na ronda do vigia.

**Achado de brinde, e grave:** `Hub.publicar` é síncrono e de três argumentos; o
`mcp_alerta` chamava com dois e com `await`, dentro de um `except`. **O push do
alerta ao administrador nunca funcionou** — só aparecia ao recarregar a tela.

⚠️ **Fica em aberto, e é de negócio:** o CEO pediu a lista de compradores de
bafômetro sem calibração e **nunca recebeu**. Está registrado num documento na
base, marcado como pendente, com os números parciais e o motivo de eles estarem
inflados (a régua pegava bocal e sensor, não só aparelho). Refazer o pedido, ao
`flow`, com a régua fechada antes e em duas etapas, é o próximo passo natural.

## O que aconteceu em 21/08/2026

Dia que começou com "o dia começou certo?" e terminou com **dois defeitos que se
escondiam bem**: um como ausência, o outro como número exato. O tema é o mesmo de
14/08 — conferir o efeito, não a configuração — com uma variação nova: **conferir
a coisa errada e dar certo**.

**A meta do trimestre saía com R$ 787 mil a mais.** `MESES_ANALISE` era lido
0-based pelo painel do DataCoreHS e 1-based pela skill: mesma chave, trimestres
diferentes. O briefing dizia 78,6% e faltando R$ 678 mil quando era **53,7% e
faltando R$ 1,46 milhão**, na véspera do fechamento. Normalizado nos dois lados.
⚠️ E o número errado tinha ✅ em **três** lugares, incluindo a âncora de
conferência da própria skill — porque a âncora conferia janeiro, que passa igual
com o trimestre errado. Ver *Config compartilhada* no `CLAUDE.md`.

**O briefing de Serviços não saía havia dias.** A sessão `cron:<jobId>` do `atlas`
acumulava entre execuções (`isolated` **não** é sessão nova) e estava em 40.588 de
uma janela útil de 41.536. O vigia não a via porque media contra a janela crua —
seu limiar caía **depois** do ponto de falha. Corrigido para `janela − reserveTokens`.

**E o agente gastava o contexto atrás de uma comparação que não existe:** o funil
de serviços do HSGrowth só entrou em uso em **20–22/07/2026** (antes: 6 cards de
teste em junho). Não é coleta quebrada — `audit_logs` registrou ~6.000/semana o
tempo todo. Está escrito na skill `funil-servicos` e no texto do cron.

**Os quatro itens que ficaram em aberto foram fechados:** `delivery: none` nos
cinco briefings (o `announce` sem canal fazia toda execução dizer `error`, mesmo
quando o documento saía), o cron de Serviços reescrito, o buraco do HSGrowth
explicado, e **agendar pela tela**, que nunca teve um chamador sequer.

⚠️ **A frente seguinte não foi escolhida.** O backlog de 15/08 fechou. Os
candidatos são a varredura do idioma `(r.get("payload") or r)` — 18 ocorrências,
e já mordeu uma vez — e o `delivery.mode: "webhook"`, que trocaria o
monitoramento puxado por aviso ativo quando um briefing termina ou falha.

## O que aconteceu em 14/08/2026

Dia longo e de tema único: **quase tudo que parecia funcionar estava conferindo a
configuração em vez do efeito.** Sete frentes, e o mesmo defeito de método em
todas.

**A Nina foi liberada para o CEO** (Nicholson, `np@`, `colaborador`). O acesso já
estava certo; o que faltava era o resto desta lista.

**Um agente falar com outro.** O `agent_to_agent` **não é uma ferramenta** — quem
conversa é o `sessions_send`, e `tools.agentToAgent` é a política que o deixa
cruzar a fronteira. E o `allow` lista **quem participa, não quem recebe**: com
`[iris, atlas]`, tanto `iris→nina` quanto `nina→iris` foram recusados. Só com os
três na lista funcionou. Quem *inicia* se controla por agente, com `deny`, que
**remove a ferramenta da lista** em vez de recusá-la em runtime.

**O roster do time foi para o `AGENTS.md`** dos três, não para o `USER.md` —
pessoa se descobre pela chave de sessão, agente se roteia por tabela. Com o
protocolo de perguntar antes de delegar. Testado ponta a ponta: a Nina reconhece
que faturamento é da Iris, oferece as duas saídas, e traz a resposta atribuindo.

**Todo agente alcançava os nove bancos.** `alsoAllow` é **aditivo** sobre o perfil
`coding`, que já libera todo servidor MCP; a publicação por agente organizava sem
isolar. Quem exclui é o `deny`, agora recalculado a cada publicação em
`_deny_de_mcp`. ⚠️ **O `deny` casa pelo nome SEM o prefixo `mcp__`**; a primeira
tentativa gravou com prefixo, passou na conferência e não removeu nada.

**O `avisar_administrador` nunca chegou em ninguém.** Apontava para `172.18.0.1`,
que é a bridge vista de dentro do backend — sem sentido a partir do gateway, que
vive noutra máquina. Corrigido para o domínio público. Hoje ele recusa jailbreak
e dispara de verdade: a linha está em `conversations` e `notifications`.

**Senha virou responsabilidade do administrador.** A HS é fechada e as pessoas
entram pelo **FortiPAM**; colaborador trocando a própria senha dessincronizaria o
cofre. `POST /profiles/{id}/senha` para o admin, `/auth/trocar-senha` restrito.
⚠️ **Não copie esta restrição para outra instalação sem o cofre junto.**

**O colaborador via administração de agente.** `GET /agents/{id}/arquivos` estava
em "só logado" — são os sete arquivos, ou seja, o prompt de sistema que o próprio
agente recusa mostrar. E os `crons` estavam abertos para **escrita**. Treze rotas
passaram a exigir admin; `/agents` continua aberta porque o mapa da frota é visão
do time, com o `AgentResumoPanel` no lugar do painel completo.

**DeepSeek entrou no lugar do Claude.** Provedor não-embutido precisa ser
**declarado** (`baseUrl` + `api` + lista de modelos), não só ter chave. Os três
agentes rodam nele, com delegação e guardrail **reverificados** — tinham sido
testados só em Claude, e trocar o modelo invalida o teste.

**A skill de faturamento tirou um erro de 48% do caminho da diretoria.** A Iris
somava toda nota "emitida" e devolvia R$ 654.645,95 para agosto; o certo é
R$ 441.712,80. A régua veio de `~/projetos/extracao-consultoria`, já conferida
contra a página Financeiro do DataCore.

⚠️ **E a descoberta que mais vale: skill publicada não é skill usada.** Publicada,
listada pelo gateway, e a Iris confirmando que a enxergava — ela respondeu errado
assim mesmo. Carregar sob demanda depende de o agente **lembrar**, e isso varia
com o modelo. O que resolveu foi um **ponteiro curto no `AGENTS.md`**: "pergunta
sobre X começa abrindo a skill Y".

**O painel do agente parou de mostrar zero.** `usage_events` e
`agent_integrations` têm zero linhas e nunca tiveram escritor, enquanto o gateway
tinha 38 sessões, 1,01 milhão de tokens e US$ 4,77. Os dois passam a cair para o
gateway quando a tabela está vazia — o coletor retoma a precedência sozinho
quando existir.

### O fio que costura o dia

Cada uma dessas frentes falhou do mesmo jeito: **alguém conferiu a configuração e
chamou de verificado.** O `deny` gravado que não removia nada; a auditoria
aprovando o alerta pelo `alsoAllow`; a skill listada e não usada; a tela dizendo
US$ 0,00 por ler tabela vazia.

O que funcionou, sempre, foi **perguntar ao agente** ou **olhar o efeito final**.
Deixe isso valer para o que vier na segunda.

---

## O que aconteceu em 13/08/2026

Dia inteiro na tela de **Conectores**, que passou de "parece funcionar" para
funcionando. Quatro consertos e uma descoberta que muda o desenho.

**Conectores (APIs de terceiros).** Editar um conector apagava as chaves que
você não redigitou. A tela nunca recebe os valores — está certo —, mas também
não sabia que existiam, então abria em branco e o servidor tratava o que a
pessoa digitou como o conjunto final. Agora a listagem devolve `credential_keys`
(os **nomes**, nunca os valores) e o PATCH mescla por chave.

**Provedores de LLM.** O card da Anthropic dizia "não conectado" sobre a
credencial que estava alimentando a `nina` naquele instante. O front já tinha a
lógica certa (`nativas`, em `LlmProvidersSection.tsx`); o backend é que nunca
mandava `perfis`. Mesma família do `useAgents` que derrubava quatro campos
declarados — **TypeScript afirma, não confere**.

**E o principal: configurar LLM pela tela funciona.** Passei o dia afirmando o
contrário, três vezes, e o Erick segurou o argumento de que o pessoal da dn.ia
não toca a VPS. Ele estava certo. Detalhes e os erros de raciocínio estão em
`CLAUDE.md`, seção *"Configurar LLM"* — vale ler antes de mexer em `llm.py`.

A `nina` ficou muda por horas por causa de uma chave inválida, não por nada
disso. Quem resolveu foi o log do gateway
(`journalctl --user -u openclaw-gateway.service`), que desfez **cada** palpite
que fizemos por correlação. É a primeira ferramenta a usar quando um agente
falha, não a última.

**Limpeza feita no mesmo dia:** 6 sessões de teste no gateway, o log de criação
de dois agentes que não existem, 6 mensagens de canal de teste, e as 4
tentativas que gravaram *"The agent run failed"* **como se fosse fala da
`nina`** — ela relia a conversa e via aquilo como coisa que tinha dito. Backup
em `~/backups/limpeza-2026-08-13/*.csv`. Na VPS saíram as pastas de agente
morto e os workspaces órfãos (`~/limpar-vps.sh`, com arquivo `.tar.gz` antes de
remover).

### Bancos de dados viraram o quarto tipo de conector

E a `nina` já consulta o banco do HS.OS pela tela — cadastro → `mcp.servers` no
gateway → `tools.alsoAllow` do agente, tudo por `config.patch`, sem tocar a VPS.

**Banco é tool, não skill.** Consultar é ação; o agente não precisa reaprender a
consultar, precisa poder executar. Skill continua sendo o certo para
procedimento com julgamento nosso dentro — como criar um agente. A troca custa
contexto (tool ocupa o prompt todo turno, skill só quando invocada) e para banco
compensa.

⚠️ **O usuário do banco é a trava, não a nossa coluna.** `db_somente_leitura` só
escolhe qual credencial usar. O usuário `leitura` do HS.OS tem
`pg_read_all_data`, `default_transaction_read_only = on` e **`BYPASSRLS`** — os
dois primeiros recusam escrita antes de olhar permissão; o terceiro foi preciso
porque as 191 policies de RLS exigem `auth.uid()`, que só existe quando o
backend emite `SET LOCAL app.current_user_id`. O servidor MCP abre a conexão e
manda SQL puro, então **sem `BYPASSRLS` as 69 tabelas devolviam zero linhas** e
a agente concluía que o banco estava vazio.

⚠️ **`sslmode=prefer` não quer dizer o mesmo em todo driver.** O libpq (psql,
asyncpg) rebaixa para texto puro quando o servidor recusa SSL; o node-postgres,
que roda dentro do MCP, trata como exigência e falha. O teste passava e o agente
falhava. Use `disable` para servidor sem SSL — a tela avisa e a publicação
recusa.

⚠️ **Dívida conhecida:** o servidor MCP recebe a URL por argv, e argv aparece no
`ps`. Contido enquanto só o root roda na VPS; **deixa de ser aceitável quando
existir escrita**, e o conserto é um servidor MCP nosso lendo do ambiente. Por
isso publicar banco marcado como leitura-e-escrita responde 501 hoje.

---

## Segunda-feira — por onde pegar

O que estava aqui era a ordem de 12–13/08, e ela **fechou**: a aba Empresa, os
sete arquivos da `nina`, a skill `criar-agente` e a criação do primeiro agente
pela orquestradora. A `iris` (DataCoreHS) e o `atlas` (GrowthHS) existem, e os
três passam no `python scripts/auditar-agente.py <id>`.

✅ **A lista de 17/08 fechou** — Skills, guardrails, sessões recentes e o
coletor. O que cada um virou está abaixo, riscado, porque o **porquê** de cada
decisão ainda vale na hora de mexer.

A frente seguinte ainda não foi escolhida. Os candidatos naturais são o
[backlog do primeiro uso real](#-backlog-do-primeiro-uso-real-1508--não-é-a-frente-atual)
— a skill do CRM para o Atlas e o preço do DeepSeek são os dois que produzem
número errado — e as pendências de produção logo abaixo.

Ordem que foi combinada e cumprida em 17/08:

1. ~~**Skills — a página.**~~ ✅ Hoje `/skills` lê `public.skills`, que tem **zero
   linhas**, enquanto `/skills/catalogo` já lê o gateway e devolve **55**. A
   página mostra a tabela vazia. O dado está a uma chamada de distância; é o
   mesmo conserto do consumo e das integrações, já feito em `agents.py`.

   ⚠️ Distinga **nossas** de **embutidas**: `skills.status` traz `bundled` e
   `source` (`openclaw-managed` são as nossas — hoje `criar-agente` e
   `faturamento`). Das 55, 51 são do próprio OpenClaw.

2. ~~**Guardrails no painel.**~~ ✅ `GET /agents/{id}/guardrails` lê `agent_profiles` e
   devolve `[]`. É a área que mais mexemos esta semana e a tela não mostra nada
   do que foi configurado. Ver onde a configuração real mora antes de escrever:
   parte está no `SOUL.md`, parte em `tools.*` do gateway.

3. ~~**Sessões recentes.**~~ ✅ O gateway tem **38 sessões** com modelo, duração,
   status, tokens e custo. É a base do diagnóstico quando alguém disser "o
   agente não respondeu" — e hoje não aparece.

4. ~~**O coletor de histórico.**~~ ✅ Decisão do Erick: consumo ao vivo **primeiro**
   (feito), coletor **depois**. Enquanto ele não existir, "quanto gastamos em
   julho" não tem resposta — sessão podada leva o histórico junto. Quando
   entrar, ele enche `usage_events` e o `/consumo` volta a preferi-la sozinho,
   sem mexer na tela.

   ⚠️ O `docs/DEPLOY.md` diz que o serviço `worker` **ainda não está no deploy**.

~~**Cron jobs saiu da lista de consertar.**~~ ⚠️ **Isto envelheceu mal e virou o
oposto.** Escrito em 17/08 quando não havia agendamento nenhum. Em 19/08 nasceram
os briefings da manhã e em 21/08 a tela passou a agendar de verdade — hoje são
**nove** jobs no gateway (cinco ligados) e `POST /agents/{id}/crons` fala com o
`cron.add`. Ver *21/08* abaixo.

### 📋 Backlog do primeiro uso real (15/08) — **não é a frente atual**

O Nicholson (CEO, `colaborador`) usou os três agentes no sábado: Atlas 06:20,
Nina 09:10, Iris 18:43. Três sessões, três `done`, nenhuma falha. Analisado em
17/08. **Nada disto entra antes do que está na lista acima** — a decisão do
Erick é ajustar tudo antes de liberar para as demais pessoas.

**O que funcionou, e vale preservar ao mexer:**

- **A identidade resolveu sozinha.** O Atlas consultou o Diretório e abriu com
  "Nicholson, bom dia", sabendo o cargo. O desenho de chave de sessão +
  `USER.md` funcionou com alguém que não somos nós.
- **A Iris recusou premissa errada.** Ele pediu "painel com todas as 106
  empresas"; ela respondeu que no banco dela são **91** e perguntou de onde veio
  o 106 antes de montar qualquer coisa.
- **Roteamento fora de escopo correto:** "oportunidades é do GrowthHS, quem
  trata é o Atlas".
- **O Atlas desconfiou do próprio número** (186 por vendedor contra 555 no
  total) e foi investigar em vez de entregar. Não estava escrito em lugar
  nenhum.

**O que consertar, em ordem de dano:**

1. ~~**O Atlas precisa da skill do CRM.**~~ ✅ **feito em 17/08.** Skill
   `pipeline-crm` publicada, concedida só ao atlas, com ponteiro no AGENTS.md
   dele. A mesma pergunta que gerou o erro passou a responder **82 cards
   parados de 141 abertos na Aquisição**, dizendo o board e explicando por que
   não somou a Prospecção. ⚠️ Ela nasceu bloqueada nos três — lista fixa não
   recebe skill nova — e precisou de concessão explícita. Contexto original: Ele apresentou ao CEO **369 cards sem
   vendedor** como "risco de ninguém responsável". Conferido no banco: dos 696
   parados >3 dias, **593 estão na Prospecção**, e é lá que estão 484 dos 488
   sem vendedor — board de SDR, onde **não ter vendedor é o normal**. As regras
   já estão escritas em `~/projetos/extracao-consultoria/DESIGN.md`: `is_won = 0`
   é card **aberto** (não perdido), "Negócio Perdido" na Prospecção é descarte
   de lead, e o denominador do indicador de SDR é o outbound. É a mesma
   história da skill `faturamento` — e vai precisar do mesmo **ponteiro no
   `AGENTS.md`**, senão ele não abre.

2. ~~**Custo aparece US$ 0,00 para DeepSeek.**~~ ✅ **resolvido em 17/08.**
   `deepseek-chat` é alias de `deepseek-v4-flash` — confirmado no painel do
   DeepSeek, que atribuiu a ele os 86 requests e 2,31M de tokens. O `cost` por
   modelo está declarado com os preços **fora de pico** (input 0.22, output 0.66,
   cacheRead 0.007), e a unidade é **US$ por 1M de tokens** — medido, não
   suposto: a conta fechou no centavo em duas execuções. O gateway aplica o
   `cacheRead` separado, e é isso que explica a fatura real ser tão baixa (de
   ~22 mil tokens por mensagem, ~13 mil vêm do cache). ⚠️ Cron noturno cai em
   pico e apareceria pela metade. Detalhe antigo, mantido para contexto: O gateway não tem tabela de preço
   para provedor customizado; as sessões em `claude-sonnet-4-6` têm custo e as
   em `deepseek-chat` vêm zeradas. O painel de custo entregue em 14/08 mostra
   zero **justamente para o modelo que passou a rodar tudo**. O schema aceita
   `cost` (`input`/`output`/`cacheRead`/`cacheWrite`) por modelo dentro de
   `models.providers.<id>.models[]`. ⚠️ Confirmar o preço vigente do DeepSeek
   com o Erick — não inventar número.

3. **"pergunta a eles" — e a Iris não pôde.** O CEO pediu que ela acionasse o
   Atlas; ela explicou que não tem a ferramenta e ele respondeu *"serio mesmo
   iris?"*. A decisão de 14/08 (só a Nina inicia, via `deny` de `sessions_send`)
   colidiu com a expectativa de quem usa. Reabrir: o `agentToAgent.allow` é
   global e não tem lista de destino por agente, então "a Iris fala só com a
   Nina" **não** é configurável hoje — a saída seria soltar o `deny` dela e
   aceitar que alcance o Atlas também.

4. **`/new to start a fresh session` foi enviado como mensagem.** Ele digitou
   uma dica da interface e ela virou pergunta para a Iris. Defeito de tela.

5. **A Iris ofereceu "arquivo/planilha exportável (CSV/HTML)".** As ferramentas
   dela são três consultas e o alerta. Conferir se ela entrega arquivo ao
   usuário de fato; se não, é promessa que não se cumpre e sai do `IDENTITY.md`.

6. **A Nina foi a mais fraca.** Recebeu "bom dia" e respondeu "Bom dia! Em que
   posso ajudar?", sem identificar quem era — enquanto o Atlas identificou. É a
   primeira impressão da orquestradora com o CEO.

**Dado de custo que vale ter em mente:** cada sessão nova custa **~22 mil
tokens** antes da primeira palavra — são os sete arquivos entrando no contexto.
Com DeepSeek é barato; foi por isso que a troca importou.

### Conferir no navegador

⚠️ **Tudo de 14/08 foi verificado por API e perguntando aos agentes — nada foi
aberto na tela.** É uma lacuna real, e é o tipo de lacuna que o próprio dia
ensinou a não ignorar. Dez minutos resolvem:

| Onde | O que tem que aparecer |
|---|---|
| `/agents/nina` → painel | custo **≠ US$ 0,00** e tokens ≠ 0 · ferramentas, canais e skills preenchidos |
| `/agents` como colaborador | mapa abre · clique num agente abre o **resumo**, não o painel completo |
| `/agents` como colaborador | **sem** botão "Salvar layout" no grafo |
| `/settings` → Perfil, como colaborador | **sem** "Alterar Senha"; no lugar, a linha do FortiPAM |
| `/settings` → Usuários, como admin | botão **Senha** por pessoa, e ele funciona |
| Conectores → provedores LLM | DeepSeek aparece conectado, com V3 e R1 |
| Chat com a Nina | pergunta de faturamento → ela oferece perguntar à Iris |

Entre como **colaborador** para metade disso. Use a conta do Nicholson (a senha
está no arquivo de credenciais, e você a trocou em 14/08 — o arquivo está
desatualizado para ele) ou crie uma conta de teste em Usuários.

⚠️ **O deploy dos dois serviços é obrigatório antes de conferir.** Backend e
frontend mudaram em 14/08, e o EasyPanel só constrói quando alguém manda.

### A base de conhecimento chegou nos agentes (17/08/2026)

`hsos-documentos` está declarado em `mcp.servers` apontando para
`https://hsosapi.healthsafetytech.com/mcp/wiki`, com as quatro ferramentas
(`documento_listar`, `ler`, `criar`, `editar`) concedidas aos cinco agentes. Eles
leem todos os espaços e escrevem só em **"Documentos dos agentes"**.

⚠️ **Declarar não bastou, e isso já era esperado.** O ponteiro entra no
`TOOLS.md` de cada um, entre `<!-- base-de-conhecimento:inicio -->` e `:fim`, e é
ele que faz o agente lembrar da ferramenta na hora certa — a mesma lição que a
skill `faturamento` custou. Sem o bloco, o agente tem a ferramenta e responde do
zero.

Conferido pelos dois lados: o `atlas` listou os 3 documentos de produção, e a
`iris`, perguntada sobre fechamento mensal **sem menção a ferramenta nenhuma**,
abriu o documento sozinha, disse que estava só esboçado e devolveu a parte de
Pipeline para o `atlas`.

**Ao escrever nos sete arquivos por script, escreva em bloco marcado e faça
backup.** Uma geração automática já apagou conteúdo editorial do roster da
`nina` neste mesmo dia. Os backups vão para `.backups-agentes/`, ignorada.

### A frota, e o que a criação de agente aprendeu em 17/08

São **cinco agentes**. `nina` orquestra; os outros quatro são especialistas com
lista fixa de skills, sem `sessions_send` e sem `skill_workshop`.

| agente | domínio | conectores |
|---|---|---|
| `nina` | orquestradora | HS.OS, Diretório |
| `iris` | DataCoreHS — faturamento, notas, contas | DataCoreHS, Diretório |
| `atlas` | GrowthHS — pipeline comercial | HSGrowth, Diretório |
| `flow` | operações — fluxos, calibração, chamados TI | TaskHS, GestorHS, ChamadosHS, Diretório |
| `bruce` | TalentHS — cadastro de pessoas | TalentHS, Diretório |

⚠️ **`bruce` é o único com acesso a dado de remuneração**, e por isso é
`specific_users` com duas pessoas. Hoje `profiles.current_salary` tem **1 de 28**
preenchido; no dia em que o RH preencher o resto, isso vira a folha inteira ao
alcance de quem conversar com ele. A restrição é o que segura.

**A `help` (HelpHS) foi adiada**: o sistema tem 14 chamados e não está no ar. O
schema é bom para SLA, mas com N=14 qualquer percentual é ruído — e soaria
analítico, que é o defeito que este repositório passou o dia corrigindo. Também
**não existe campo de satisfação** ali; se for pedido, precisa ser criado antes.

**A criação de agente foi provada nesta sequência.** O `flow` nasceu com 3
defeitos e o `bruce`, criado depois dos consertos, passou na auditoria **de
primeira** — o primeiro que não precisou de conserto nenhum:

| | iris | atlas | flow | bruce |
|---|---|---|---|---|
| consertos manuais | 3 | 4 | 3 | **0** |

Os quatro consertos que fizeram a diferença estão no commit `f724866` e
`9ccd3ce`: espera do `retry after` do `config.patch`, concessão automática do
alerta, travas de especialista, e entrada no `agentToAgent.allow` + roster.

⚠️ **A troca para Sonnet 5 na escrita dos sete arquivos estreou e funcionou**:
16:07 trocou, 16:10 devolveu. É global enquanto dura — quem falar com a
orquestradora nesses minutos é atendido por ela.

⚠️ **`bruce` recusa listar as próprias ferramentas**, por guardrail — os outros
três respondem. É comportamento correto e mais rígido, e **tira um método de
verificação**: com ele, confira pelo efeito, não pela auto-listagem.

### A regra dos três erros do fim de semana

Os três achados do primeiro uso real eram do mesmo tipo — **número certo, régua
errada** — e nenhum foi bug de código. Em todos, o agente aplicou uma régua
plausível que ninguém tinha escrito:

| | o agente disse | era |
|---|---|---|
| faturamento | R$ 654.645,95 | R$ 441.712,80 — faltava CFOP e marcador |
| cards parados | 369 "sem dono", risco | 82 na Aquisição — faltava separar board |
| contas antigas | "não achei" | "esta base começa em 2026" |

Os três se resolveram igual: **régua escrita, número de conferência dentro dela,
e gatilho num dos sete arquivos**. A última parte é a que não é óbvia — sem o
gatilho a régua existe e não é aberta, que foi o que aconteceu com a
`faturamento` em 14/08.

⚠️ O terceiro virou regra nos **três** agentes em vez de skill: "não achei" não
é "não existe" vale para qualquer pergunta com corte de tempo. E o horizonte é
**por tabela**, não por banco — no DataCoreHS as notas vão a 2015 e o contas a
receber começa em 2026; no GrowthHS os cards vêm de 2024 e a tabela de clientes
começa em 2026. Decorar a data de uma tabela não protege da próxima.

### Pendências que 17/08 criou

- ⚠️ **Deploy pendente.** Backend e frontend mudaram bastante hoje e nada foi
  reconstruído no EasyPanel. Tudo foi verificado em `localhost`.
- ~~⚠️ **`GET /skills/{slug}/conteudo` dá 404 em produção.**~~ ✅ **Resolvido.**
  A pasta foi movida para `backend/skills/`, dentro do contexto de build, e o
  `Dockerfile` define `SKILLS_DIR=/app/skills`. Conferido em 03/09/2026: as sete
  skills estão lá e não existe mais `skills/` na raiz. Mover a pasta foi o
  conserto certo — levar o contexto para a raiz quebraria o deploy, porque o
  EasyPanel tem o caminho fixo em `code/backend/`.
- **Os dias 15 e 17/08 seguem zerados na série de custo.** O preço é carimbado
  quando a sessão roda, e recalcular retroativamente exigiria inventar a
  repartição entre cache e não-cache. De 17/08 em diante o valor é real.
- **Os três agentes estão com lista fixa de skills** desde a separação de
  `criar-agente` (só nina) e `faturamento` (só iris). O painel de guardrails
  mostra isso como o único ponto de atenção dos três. Skill nova do OpenClaw não
  chega neles até a lista ser refeita — religar pela tela refaz.

### Pendências curtas, que cabem em qualquer intervalo

- **`agentToAgent.allow` é manual** — e continua sendo, embora hoje esteja
  completo. Conferido em 03/09/2026 no `config.get`: `allow` traz os cinco
  (`atlas`, `bruce`, `flow`, `iris`, `nina`), então `flow` e `bruce` foram
  incluídos à mão quando nasceram. O buraco não fechou; só não está aberto agora.
  Agente novo criado pela tela **continua** não entrando na lista, e nasce sem
  falar com a Nina e sem ser alcançável por ela, em silêncio. É o mesmo tipo de
  buraco que o `_deny_de_mcp` fechou — a diferença é que aquele é recalculado a
  cada publicação e este depende de alguém lembrar.
- **A `nina` está com `channels` vazio** em `agent_profiles`, e `iris`/`atlas`
  com `{webchat}`. Ela conversa normalmente — é o registro que está incompleto.
  Mesma família do `model` vazio que apareceu no mesmo dia. Testar
  `POST /agents/sync` e ver se realinha.
- **Marcador na skill `faturamento`**: uso `LIKE '%texto%'` e a régua oficial do
  `tiny-integrador` usa **igualdade exata**. Deu no mesmo em janeiro e agosto,
  mas são critérios diferentes — o meu excluiria uma nota cujo marcador apenas
  *contenha* "cancelar". Trocar e revalidar contra os dois números de referência.
- **O fluxo de criação de agente nunca rodou inteiro com o código corrigido.**
  O `atlas` nasceu antes de quatro dos cinco consertos e foi remendado à mão. O
  próximo agente é o teste — e ele exercita, de quebra, o reparo automático de
  provedor LLM em `llm.py`, que também não foi exercitado.

### Segurança, ainda em aberto

Nada disso é novo de 14/08, e nada disso bloqueia o trabalho acima:

- ~~🔴 **A senha padrão do superusuário do Postgres**~~ — **rotacionada.** A
  senha antiga não autentica mais em `62.72.11.28:2222` (conferido em
  02/09/2026, **só nesse host/porta/banco** — os outros dois que compartilham a
  conta não foram testados). O valor estava escrito nesta linha, em texto
  aberto, num repositório público; removê-lo do texto **não revogou nada** — ele
  segue no histórico do git e nos três outros repos onde vazou em set/2026. O
  que resolveu foi a rotação, que o torna inútil.

  ⚠️ Esta linha dizia "ainda não rotacionada" até 03/09/2026, enquanto a tabela
  de *Decisões pendentes*, no mesmo arquivo, já a dava como feita. Duas seções
  do mesmo documento em desacordo: quem lesse esta primeiro iria rotacionar de
  novo.
- **`integrations.credentials` em texto puro** — nove senhas de banco.
- **`sandbox` por agente**: um agente ainda alcança o SQLite do outro via `exec`.
  A tentativa com `tools.fs.workspaceOnly` foi revertida por não fechar isso e
  quebrar o trabalho da `nina`.
- **O sanitizador da exportação** não remove `usuario:senha@` de URL.

---

## Placar — medido, não mantido à mão

O contador deste arquivo já mentiu **duas** vezes. Na primeira, eu vinha
incrementando a cada port sem conferir e ele chegou a dizer "72 de 73
resolvidas" com 13 functions ainda na pasta. Na segunda — 14/08/2026 — dizia
**240 rotas** enquanto o comando ao lado devolvia **186**.

**Todo número aqui vem de um comando**, e o comando está ao lado. Rode-os ao
retomar; a tabela envelhece sozinha e ninguém percebe.

| | Hoje | Total | Como medir |
|---|---|---|---|
| Edge functions **por portar** | — | **0** | `ls backend/supabase/functions \| grep -vE "_shared\|_pausado\|_portado" \| wc -l` |
| Portadas | 65 | 73 | as outras 8 estão em `_pausado/` — ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md) |
| Arquivos do front com Supabase | **1** | 278 | `grep -rl "integrations/supabase/client" frontend/src \| grep -v _legado \| wc -l` |
| Rotas na API própria | **186** | — | `curl -s localhost:8002/openapi.json \| jq '.paths \| length'` |
| Chamadas `.from("…")` vivas | **0** | — | `grep -rln '\.from(\s*"' frontend/src \| grep -v _legado \| wc -l` |

**Duas linhas têm que andar juntas.** "Tem substituto no backend" e "a tela usa o
substituto" são coisas diferentes, e confundi-las já deixou telas quebradas em
produção — ver *Armadilhas*, abaixo.

---

## Estado por subsistema

Sair do Supabase é substituir cinco coisas. Elas estão em estados muito
diferentes, e o resumo antigo ("Realtime ✅ portado") escondia isso:

| Subsistema | Substituto | Front religado | O que falta |
|---|---|---|---|
| **Auth** | ✅ JWT próprio (PyJWT + bcrypt) | ✅ **completo** | o *reset por e-mail* não existe — sem envio de e-mail, quem esquece a senha pede uma temporária ao admin |
| **Storage** | ✅ `UPLOADS_DIR` em disco | ✅ **completo** | nada |
| **Realtime** | ✅ WebSocket + LISTEN/NOTIFY (`app/escuta_banco.py`) | ✅ **completo** | nada — `postgres_changes` zerado, e o "está digitando" também passou para o `/ws` |
| **Edge Functions** | ✅ 73 de 73 | ✅ sem pendências | nada — 65 portadas, 8 arquivadas por decisão |
| **Banco** (RLS direto do browser) | ✅ 240 rotas | ✅ **completo** | nada — 0 chamadas vivas (9 em `_legado/`, fora da compilação) |

O **banco é o único subsistema que ainda pesa.** Os outros quatro estão prontos
ou perto disso.

### Nenhuma chamada viva

As duas que restavam saíram: `SkillsPage` passou a falar com o router
`skills.py`, e o `ResetPasswordPage` deixou de consultar `profiles`.

Sobram **9 chamadas em `_legado/`**, distribuídas em cinco arquivos do wizard de
setup antigo. Nada ali é compilado nem roteado — o `grep` as encontra e é só
isso. Conferir com nome de arquivo, não com `-h`:

```bash
grep -rln '\.from(\s*"' frontend/src | grep -v _legado | wc -l   # 0
```

⚠️ O comando do placar acima usava `grep -rho`, que descarta o nome do arquivo e
faz o `grep -v _legado` seguinte não filtrar nada — ele reportava 9 chamadas
"vivas" que não existem. Corrigido; use o `-l` acima quando for medir.

---

## O que já funciona, verificado no navegador

- **Banco próprio** no Postgres da VPS — 69 tabelas, 191 policies de RLS ativas
  de verdade (o backend conecta como `hsos_app`, não como superusuário)
- **Autenticação própria** — JWT + bcrypt, com troca de senha exigindo a atual
- **Agentes** — criar, editar todas as abas, sincronizar, verificar modelo,
  liderança, acesso, excluir, exportar, arquivos do workspace
- **Chat com agente** — envio e resposta por long-poll do `agent.wait`
- **Canais** — criar, editar, mensagens, membros, anexos, resposta de agente
- **Automações** — CRUD, gatilho, disparo, importar crons, sincronizar status
- **Tarefas** (Loop Architecture) — checkpoint, pausar, retomar, concluir
- **Arquivos** — storage próprio em disco, cinco buckets, gerar PDF e DOCX
- **Arenas** — persistência completa (a voz ainda não)
- **Integrações** — a ponte `window.dnos.invoke()` dos live artifacts
- **Deploy** — `hsos.healthsafetytech.com` e `hsosapi.healthsafetytech.com`

---

## A coisa que trava o resto

Não é técnica. É decisão sua. **Eram duas até 10/08/2026** — a outra saiu.

### ✅ Lovable AI Gateway — resolvido em 10/08/2026

`transcribe-audio`, `chat-image-vision` e `parse-company-context` foram portadas
para OpenAI em `app/routers/ia.py` e estão ligadas em tela viva (conferido em
01/09). Não é mais decisão pendente.

### 🟠 ElevenLabs

`list-elevenlabs-voices`, `elevenlabs-tts`, `arena-convai-create/update/signed-url`
e `arena-generate` — a voz da Arena. Mesma natureza: chave própria ou o recurso
sai do produto.

**Estratégia acordada:** portar tudo menos a chamada ao provedor, deixando-a
parametrizada. Assim a decisão vira configuração, não código.

---

## Próximo passo, em ordem de valor

### 1. O banco — é o que sobrou

**124 chamadas `.from("…")` vivas.** Eram ~222 no início de 07/08, então já caiu
quase pela metade — mas é o único subsistema que ainda pesa, e portá-lo é o que
falta para o front deixar de ser um cliente Supabase com endpoints por cima.

Portar por **tabela**, não por tela. Foi o que funcionou: uma tabela some do
front de uma vez, e o endpoint nasce coerente em vez de recortado pela
necessidade de uma tela só.

**Comece pelos conectores.** O CRUD já está pronto e testado no backend
(`GET/POST/PATCH/DELETE /integracoes/conectores` e
`GET /integracoes/modelos-de-conector`) e o front **não** foi religado — 9
chamadas em 5 arquivos, sendo `ConnectorsTab` a maior. É trabalho mecânico com o
servidor já verificado.

Depois, por tamanho: `channel_members` (9) e `channel_messages` (9), que
compartilham o `channels.py` e boa parte dos endpoints já existe;
`agent_profiles` (10, metade já saiu); `agent_results` (6).

### 2. As 4 edge functions de trabalho real

| Function | Linhas | Observação |
|---|---|---|
| `turn-reconciler` | 864 | precisa do serviço `worker` — não há `pg_cron` na VPS |
| `skill-manage` | 647 | tela de Skills, viva |
| `collect-agent-stats` | 552 | webhook do coletor da VPS; **duas formas de payload**, e o payload real não está documentado — conferir antes |

### 3. Resíduos de autenticação

11 chamadas a `supabase.auth.` espalhadas, quase todas `getSession()`/`getUser()`
que já não fazem falta — o token vem do `lib/api`. A exceção é a
`ResetPasswordPage`, que depende do fluxo de recuperação por e-mail; esse não
existe mais e o destino dela está em *Decisões pendentes*.

---

## ⚠️ Armadilhas que já custaram tempo

### Do projeto

- **`npx tsc --noEmit` não checa nada.** O `tsconfig.json` da raiz tem
  `"files": []`. O comando correto é `npx tsc --noEmit -p tsconfig.app.json`,
  rodado de dentro de `frontend/`.
- **Arquivo em `pages/` não quer dizer tela em uso.** Só **onze** páginas estão
  roteadas. Em 07/08 religuei a `ProfilePage`, que está morta, e deixei a
  `SettingsPage` — a viva, que serve `/settings` **e** `/profile` — quebrada.
  A conferência que funciona:
  ```bash
  grep -oP '<Route[^>]*element=\{<\K[A-Za-z]+' frontend/src/App.tsx | sort -u
  ```
- **Portar o backend não religa a tela.** Já aconteceu doze vezes: a edge sai da
  pasta, o endpoint entra, e a tela continua chamando `supabase.functions.invoke`
  de algo que não existe mais.

  ⚠️ **E a régua ingênua não pega tudo.** Um `grep 'invoke("nome")'` perde as
  chamadas quebradas em várias linhas — foi assim que
  `notify-orchestrator-onboarding` passou por dois audits antes de aparecer em
  07/08. A conferência que funciona:

  ```bash
  # forma 1 e 2: supabase.functions.invoke, inclusive quebrado em várias linhas
  grep -rzoP 'functions\.invoke\(\s*\n?\s*"[a-z0-9-]+"' frontend/src \
    | tr '\0' '\n' | grep -oP '"\K[a-z0-9-]+' | sort -u

  # forma 3: fetch cru para a URL da edge — não usa invoke nenhum
  grep -rn 'functions/v1/' frontend/src --include=*.ts --include=*.tsx | grep -v _legado
  ```

  Depois cruze cada nome com `ls backend/supabase/functions/`.

  ⚠️ **A terceira forma passou por dois audits.** Em 10/08 quatro chamadas
  ainda apontavam para edges apagadas por `fetch` direto, e o sintoma que
  chegou foi "No suitable key or wrong key type" — o Supabase recusando a
  chave, numa mensagem que não diz nada sobre a causa.
- **`$N::jsonb` com uma string do Python guarda um jsonb *string*, não objeto.**
  O asyncpg deduz o tipo do cast. Use `$N::text::jsonb`. Vale igual para
  `$N::timestamptz` → `$N::text::timestamptz`.
- **Ordem de rotas no FastAPI.** Prefixo fixo tem que ser declarado **antes** do
  parametrizado, senão o genérico engole. Já mordeu seis vezes: `/documentos/gerar`
  virava bucket, `/minhas/respostas` virava agente, `/produtividade` virava id.
- **`channels` não tem `updated_at`.** Um `SET updated_at = now()` ali dá 500.
- A coluna da senha é **`password_hash`**, não `encrypted_password` (esse era o
  nome no Supabase).

### Do gateway

- Ele **conecta com sucesso** e nega tudo com `missing scope` quando a identidade
  do cliente está errada — ou quando o scope não foi **pedido** no handshake
  (`SCOPES` em `client.py`).
- O **handshake dá timeout de vez em quando** com o túnel de pé e `/health` em
  200. Repita antes de concluir que caiu.
- O `model` é **assimétrico**: `agents.list` devolve `{"primary": "…"}`,
  `agents.update` exige string nua.
- As rotas REST de monitoramento (`monitoring/gateway/status`, `processes`,
  `events`, `cleanup-chrome`, `gateway/restart`) **respondem 404** nesta versão.
  Conferido ao vivo em 07/08.

### Do banco e do deploy

- **Superusuário bypassa RLS** — as policies ficam no catálogo sem proteger nada.
- No **PG 16+** a herança de role é gravada por associação: `ALTER ROLE NOINHERIT`
  posterior não altera GRANTs já feitos.
- `VITE_*` é embutido em **build**, não em runtime — no EasyPanel tem que ser
  *build arg*.
- `pg_cron` **não existe** na VPS; jobs agendados vão para um serviço `worker`.
- O Postgres da VPS **não suporta TLS**.
- **`integrations.integration_type` só aceita** `api_key`, `multi_key`, `mcp` —
  nunca `meta`. A Meta é reconhecida pelo nome ou pelo `key_name`.

---

## ⚠️ Erro de operação — não repita

Em 06/08/2026, uma sondagem mandou `agents.update` com um modelo inválido de
propósito, **esperando que o gateway recusasse**. Ele aceitou e gravou: a `nina`,
que é o `defaultId`, ficou com `model: "isto-nao-e-um-modelo"` em produção até
ser restaurada à mão. Na mesma sessão, outra sondagem sem `agentId` mandou uma
mensagem de verdade para ela.

**Regra:** leitura no gateway (`*.list`, `*.get`, `*.status`) é livre. Escrita,
combinar antes. Para descobrir formato de parâmetro, use um **`agentId`
inexistente** — a chamada falha na busca do agente, antes de gravar. E confira
que **toda** chamada do lote leva o alvo inexistente: basta uma sem ele.

---

## Ainda por verificar junto com o Erick

Escrito e testado só nas guardas, porque o caminho feliz tem efeito real:

- **`PUT /agents/{id}/acesso`** — manda mensagem ao agente líder
- **Resposta de agente em canal** — dispara o agente de verdade
- **`DELETE /agents/{id}`** — apaga no gateway e em três tabelas
- **Disparo de automação** — executa no gateway

---

## Antes de escrever qualquer linha

1. **Suba o túnel SSH.** Sem ele, tudo que toca o gateway falha com
   `Connection refused` e o sintoma parece bug de código.
2. **Confira `CLAUDE.md`** — as armadilhas do gateway e do banco estão lá, e
   cada uma custou horas.
3. **Leia a edge function correspondente antes de portar.** As que restam em
   `backend/supabase/functions/` são a especificação: descrevem um sistema que
   funcionava. Foi assim que descobrimos que o protocolo do gateway tinha mudado.

---

## Pendências de infraestrutura que a portagem criou

- ~~**`UPLOADS_DIR` volume persistente**~~ — confirmado montado no EasyPanel
  pelo Erick em 12/08/2026.
- ~~**Backup do banco**~~ — instalado em 12/08/2026, diário às 03:20 com 14
  dias de retenção e restauração verificada. Ver [`DEPLOY.md`](DEPLOY.md).
  **Falta**: cópia para fora da máquina.
- **O WebSocket exige `wss://`** em produção: o token vai na query (a API do
  navegador não permite cabeçalho), então em `ws://` viajaria em claro.
- **Desligar a ponte `dnos-files-bridge` na VPS** — pendência aberta em
  11/08/2026, **de propósito com data para depois**.

  Ela copiava os arquivos dos agentes para a tabela `agent_files` a cada 60s.
  Existia porque o gateway não deixava lê-los direto; hoje deixa, e painel,
  exportação e importação já falam com o gateway. A tabela está com **zero
  linhas** — nesta instalação a ponte nunca escreveu nada.

  ⚠️ **Não desligue antes de importar um agente pela tela, de ponta a ponta.**
  O caminho novo foi testado (agente `testo`, sete arquivos, criado e apagado
  em 11/08), mas a importação completa pela interface ainda não rodou. A ponte
  parada não faz mal; religá-la depois de desligada exige entrar na VPS.

  Quando for: `systemctl disable --now dnos-files-bridge` no 62.72.11.28.

- **O tempo real vive na memória de um processo.** Com mais de um worker do
  uvicorn, quem está no worker A não recebe o que foi publicado no B. Hoje roda
  em processo único e está correto — **mas isso vira problema ao escalar.**

---

## Decisões pendentes

| Decisão | Por quê importa |
|---|---|
| ~~**Trocar a senha do `super_admin`**~~ | ✅ Feito em 01/09/2026. ⚠️ Trocar não apaga o histórico do git: a antiga segue nos commits anteriores deste repositório público — o que a rotação faz é torná-la inútil. |
| ~~Flags `dnos_flag_*` viram padrão?~~ | ✅ **Resolvida, e a pergunta estava errada.** Nunca foram 4: eram 3 no código, 2 delas já não faziam nada (morreram quando o `agent-chat.ts` substituiu o miolo de rede do `chat-sender`), e sobrou `hsos_flag_real_stop` — **ligada por padrão desde 31/08/2026**, não desligada. Conferido no código em 03/09: `cancelamentoRealLigado()` em `lib/chaves-locais.ts` é `lerChave(...) !== "off"`. |
| Manter as 191 policies de RLS? | Funcionam, mas duplicam a autorização do FastAPI. Se aposentar, vira a `003`. |
| **Reescrever a documentação oficial** | Ela avisa que a parte técnica está defasada (11/08), mas continua descrevendo edge functions que não existem. São 2.791 linhas misturando material que vale com material errado. Adiado de propósito: com uso real dá para saber quais seções as pessoas consultam e corrigir essas primeiro. |
| Fluxo de "esqueci minha senha" | Sumiu com o Supabase Auth. A `ResetPasswordPage` ainda existe e não funciona. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |

### Resolvidas

- ~~Credencial da Anthropic expirada~~ — **alarme falso.** O `models.authStatus`
  diz `expired` no perfil `anthropic:claude-cli`, mas a `nina` responde. Existe
  credencial que o `authStatus` não enxerga; `POST /agents/test-model` avisa,
  não condena.
- ~~Convite por e-mail~~ — **removido do produto** por decisão sua: a conta do
  colaborador é criada direto no sistema.

---

## Onde está o resto

- `CLAUDE.md` — arquitetura, convenções, o estado híbrido
- `docs/ROADMAP.md` — os lotes, princípios e o histórico
- `docs/DEPLOY.md` — EasyPanel, variáveis, o túnel, diagnóstico
- `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` — os 49 achados herdados (A1–A19,
  B1–B10); leitura obrigatória antes de mexer no caminho do chat
- `frontend/src/_legado/README.md` — o que sobrou do wizard
