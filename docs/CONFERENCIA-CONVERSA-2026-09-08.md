# Conferência da conversa de 08/09/2026 — o CEO e a Nina

O Nicholson usou o sistema o dia inteiro em 08/09: **41 mensagens** com a `nina`
(17 dele, 24 dela), das 03h31 às 13h51, tendo zerado a conversa às 03h29 (117
mensagens acumuladas). Foi o dia de maior tráfego desde 28/08 e o mais caro da
série — **2.918.867 tokens, US$ 0,48**, dos quais o `atlas` sozinho consumiu
1.357.257 em 16 execuções.

Método: o mesmo da `AUDITORIA-RESPOSTAS-2026-08-31.md` — reconstruir cada número
do zero, das tabelas cruas, com a régua da skill, **e só então** comparar com o
que o agente disse. Quatro bancos: `hsos`, `datacore`, `hsgrowth`, `taskhs`,
`gestorhs`.

## O placar

| frente | resultado |
|---|---|
| Faturamento (Iris) | ✅ exato nos três cortes do dia |
| Funil — perdidos da Sandra (Atlas) | ✅ exato, inclusive a lista nominal das 35 |
| Ganhos e SDR (Atlas) | ✅ exatos na janela de tempo dele |
| Serviço parados (Flow) | ⚠️ 176 de manhã (inflado ~34%), 136 corrigido à tarde |
| **Vencido em aberto (Iris)** | ❌ **+41 títulos e +R$ 148.906** |
| **Parados de Eduardo e Adriana (Atlas)** | ❌ **+R$ 192.945 na soma; contagens certas** |
| **Conclusão sobre a carteira da Sandra** | ❌ **incompleta — faltou o que aconteceu 1h antes** |
| Plataforma | ❌ 5 defeitos, 2 deles visíveis ao CEO — **3 já corrigidos** |

---

# Parte 1 — o que a plataforma fez de errado

## 1.1 As duas entregas principais do dia foram cortadas ao meio

As mensagens de **03:36:48** e **12:30:28** têm exatamente **8.018 caracteres** e
terminam com o literal `\n...(truncated)...`, no meio do HTML do painel. São
justamente os dois panoramas consolidados — a entrega mais importante do dia,
duas vezes.

⚠️ **A consequência está escrita na própria conversa.** Às 04:00:44 o CEO
perguntou **"Qual o link ?"**. O link estava no fim da mensagem, **depois do
corte**. Ele não estava distraído: a mensagem que ele recebeu não tinha link.

**A causa, achada no código do gateway:** `truncateChatHistoryText`, em
`openclaw/dist/session-transcript-path-EobUxjvp.js`, devolve
`` `${text.slice(0, maxChars)}\n...(truncated)...` `` com
`DEFAULT_CHAT_HISTORY_TEXT_MAX_CHARS = 8e3`. Os 8.018 são 8.000 mais os 18
caracteres do sufixo.

⚠️ **E não é um bug do gateway — é o default de uma projeção para exibição, que
nós usávamos como se fosse a resposta.** Duas evidências de que o desenho previa
isto:

1. `resolveEffectiveChatHistoryMaxChars(_cfg, maxChars)` usa o valor recebido
   quando ele vem: **o `chat.history` aceita `maxChars` como parâmetro**, e 8.000
   é só o padrão.
2. A interface do próprio OpenClaw trata o sufixo como **sinal**, não como
   conteúdo: em `control-ui/assets/chat-page-*.js` ela marca
   `shouldFetchFullMessage` quando o texto `includes("\n...(truncated)...")` e
   vai buscar a íntegra.

O nosso backend fazia o contrário: lia o texto já cortado e o gravava em
`conversations` como resposta final.

**Medido ao vivo em 09/09/2026**, na sessão `agent:atlas:main`:

| `chat.history` | mensagens truncadas |
|---|---|
| padrão | **1** |
| `maxChars=200000` | **0** |

⚠️ **O corte é por BLOCO de texto, não por mensagem** — foi por isso que passou
tanto tempo despercebido. Na mesma medição, mensagens de 10.351 e 10.076
caracteres vieram inteiras: só o bloco que sozinho passa de 8.000 é cortado.
Resposta longa em vários parágrafos escapa; painel HTML num bloco só, não.

Corrigido em `_MAX_CHARS_HISTORICO` (`conversations.py`), aplicado nos quatro
pontos que montam texto de resposta — o `/reply`, o `/recuperar`, o envio direto
e a resposta de agente em canal (`channels.py`). O `_ultimo_seq` não precisa: ele
lê `seq`, não texto.

## 1.2 O CEO recebeu a resposta anterior colada na frente, duas vezes

| hora | tamanho | o que era |
|---|---|---|
| 13:42:27 | 1.895 | a resposta certa |
| 13:43:57 | 3.556 | **a de 13:42 inteira** + 1.661 de conteúdo novo |
| 13:44:49 | 5.137 | **a de 13:43 inteira** (que já continha a de 13:42) + 1.581 novos |

Verificado por conteúdo, não por semelhança: `a in b` e `b in c` são verdadeiros,
os dois no offset 0.

**A causa está medida em `agent_runs`.** O `seq_antes` da sessão cresceu normal a
manhã toda (43 → 54 → 61 → 67 → 73 → 77 → 87 → 101 → 103 → 107 → 115 → 119) e
então **congelou em 119 por três turnos** (13:43, 13:44, 13:46), voltando a 120
só no último. Enquanto ele não andava, o `/reply` gravava tudo com `seq > 119` —
ou seja, o turno anterior junto.

Por que congelou: `_ultimo_seq()` devolve `max(piso, chat.history limit=5)`. Numa
sessão de 120+ mensagens o `limit=5` devolve `seq` velho — é o defeito do gateway
que o próprio `conversations.py` documenta. O `piso` deveria salvar, mas ele vem
de `max(seq_antes) FROM agent_runs`: **é o último valor que o gateway acertou, e
não sobe sozinho.** Vira teto congelado.

⚠️ **Esta é a terceira encarnação do mesmo bug** — `limit=1` em 17/08, `limit=5`
de 24 a 30/08, e agora o piso que não sobe. As duas primeiras correções trataram
o número da janela; esta trata a memória.

⚠️ **O `/reply` sabe o `seq` que consumiu e joga a informação fora.** Ele lê o
histórico com `limit=40` e junta tudo acima do corte — sabe exatamente qual foi o
maior `seq` que entrou no texto, e não grava. O conserto é gravar esse número
(uma coluna `seq_depois` em `agent_runs`) e fazer `_piso_do_seq` ler dele. Aí o
piso passa a andar com a conversa em vez de esperar o gateway acertar.

## 1.3 Sete páginas públicas, sem expiração, com nome de cliente e valor

`artifacts_published` tem **7 linhas de 08/09, todas `is_public = true` e todas
com `expires_at` nulo**. Entre elas, a lista nominal dos 35 clientes que a Sandra
perdeu — com **nome do contato** e valor — e as 81 oportunidades de Eduardo e
Adriana, com cliente e valor.

`GET /artefatos/publicados/{id}` **não tem `Depends(usuario_atual)`** (só filtra
`is_public = true`). O que protege é o UUID não ser adivinhável. Não há senha,
não há expiração, e a Nina colou os links no chat dizendo "sem login, repasse só
a quem deve ver" — o desenho conta com o repasse cuidadoso.

⚠️ **A regra certa já existe, e está no lugar que o agente não lê.** O docstring
de `_publicar_pagina` (`backend/app/routers/relatorios.py`) diz:

> *"Para relatório com nome de cliente e valor, use `dias_de_validade`."*

Mas a `description` do parâmetro, que é o que o agente enxerga, diz só:
*"Opcional. Depois disso o link diz 'expirado'. Sem isso, não expira."* — não diz
**quando** usar. A Nina não usou em nenhuma das sete.

Sobrou também a **v1 errada** do painel de Eduardo e Adriana (`94866aa6…`),
publicada às 13:47 e substituída às 13:51 pela v2. As duas continuam no ar.

## 1.4 A espera pelo `announce` — que nunca ia chegar, e ela não podia saber

Às 12:36:59 e às 13:28:02 a Nina escreve que está esperando a resposta completa
do Atlas "chegar por announce" e trabalha com o bastidor incompleto. Às 13:28 ela
diz que a resposta final "veio em **ANNOUNCE_SKIP** e não retive".

⚠️ **`ANNOUNCE_SKIP` não é "a resposta foi por outro canal". É o agente
respondente dizendo que NÃO vai dizer mais nada.** No código do gateway
(`subagent-session-cleanup-*.js`) ele é um dos `NON_DELIVERABLE_REPLY_TOKENS`, ao
lado de `REPLY_SKIP` e `HEARTBEAT`, e o prompt que o produz é explícito:

> *"If you want to remain silent, reply exactly `ANNOUNCE_SKIP`. Any other reply
> will be posted to the target channel. **After this reply, the agent-to-agent
> conversation is over.**"*

Ou seja: **o Atlas escolheu encerrar, e o que a Nina já tinha era tudo o que
haveria.** Ela esperou duas vezes por uma segunda entrega que não existia — e
como este gateway não tem canal nenhum (`channels.status` devolve `channels: {}`,
o motivo de os cinco briefings terem saído de `announce` para `none` em 21/08), o
announce também não teria para onde entregar.

⚠️ **E não é falta de instrução: o `AGENTS.md` dela já manda usar
`timeoutSeconds`**, na primeira linha da seção "Como aciono outro agente" —
*"com timeout a resposta volta na hora, e eu não preciso ficar checando depois"*.
Ela usou. O que faltou foi **saber ler o sentinela**.

O efeito prático está confessado às 13:48:20, com as palavras dela:

> *"cometi um erro ao transcrever manualmente a lista da Adriana (dupliquei
> Atlantic Nickel...). Isso exatamente o que eu vinha evitando — transcrever
> manualmente 81 linhas e errar."*

Ela remontou 81 linhas de cabeça a partir de "retornos truncados/remontados"
enquanto esperava uma entrega que já tinha sido declarada encerrada. Some a isso
o corte de 8.000 da seção 1.1 — que também atinge o que ela lê do histórico — e
o quadro fecha: **os dados chegaram cortados, ela esperou pela versão íntegra que
não vinha, e acabou digitando à mão.**

## 1.5 Bastidor na tela do CEO

Foram **24 mensagens de agente para 17 perguntas**. As excedentes são raciocínio
interno: *"Vou checar se o Flow e o Atlas já terminaram de responder"*,
*"Deixa eu fazer isso — pedir ao Atlas para gerar a página..."*, e a conferência
aritmética à mão de 13:29:20 (*"deixe-me conferir por contagem... 416.500+73.875
= 490.375; +44.100 = 534.475..."*).

E a mensagem das 03:36:48 abre com **"Agora detesto a resposta consolidada"** —
texto corrompido, era "Agora tenho". Foi a primeira linha da entrega principal do
dia.

---

# Parte 2 — a auditoria dos números

## 2.1 O que bateu

| afirmação | ela disse | eu medi | |
|---|---|---|---|
| NFS-e set. até 04/09 | 18 notas · R$ 48.442,00 | 18 · R$ 48.442,00 | ✅ exato |
| Vendas set. (às 12:30) | 12 notas · R$ 55.853,25 | 10 até 04/09 + as 2 do dia | ✅ |
| Meta trimestre (manhã) | 74,0% · falta R$ 823.270,89 | coerente com as 2 notas | ✅ |
| Meta trimestre (tarde) | 74,5% · falta R$ 809.011,89 | hoje 74,8% · R$ 799.211,89 | ✅ |
| Sandra · 35 perdidos | 35 · R$ 649.302 | 35 · R$ 649.302,00 | ✅ exato |
| Sandra · lista das 35 empresas | nominal, com valor | 35 de 35, na ordem | ✅ linha a linha |
| Sandra · motivo "sem budget" | 28 | 28 | ✅ exato |
| Sandra · 2 ganhos | R$ 8.874 | R$ 8.874,25 | ✅ |
| Ganhos set. até 07/09 | 6 · R$ 33.374 | 6 · R$ 33.374,25 | ✅ |
| Ganhos set. até 08/09 | 9 · R$ 57.433 | 9 · R$ 57.433,25 | ✅ |
| SDR | 6 · Claudia 5, Karolaine 1, Miguel 0 | idem às 12:30 | ✅ |
| Gislaine · redistribuídos | 9 cards · ~R$ 191 mil | 9 = R$ 191.100 | ✅ |
| Serviço parados (tarde) | 136 | 131 | ✅ |
| Aterpa, Salobo, Adufertil, Atlantic Nickel | valor e dias parados | idênticos | ✅ |

Duas observações de método que a auditoria de 31/08 já tinha ensinado e que
voltaram a valer:

- **A diferença de R$ 9.800 no faturamento não é erro dela.** É a nota 008678
  (Eduardo Luna), que entrou depois das 12:30. Os três cortes do dia — 03:36,
  12:30 e hoje — são internamente consistentes ao centavo, e a diferença entre
  cada par é exatamente as notas emitidas no intervalo.
- **"Miguel 0" estava certo.** A reunião dele entrou na lista Agendado às
  **19:47:46**, sete horas depois de ela falar. Hoje eu meço 1; ontem ao meio-dia
  era 0.

⚠️ **A lista nominal das 35 empresas está perfeita, linha a linha** — nomes,
valores, ordem dos ids, a soma de R$ 649.302 e até o "Carlos" sem sobrenome. A
Nina encerrou aquela entrega recomendando *"a conferência pontual dos clientes de
maior valor (Rumo Malha Norte R$ 42.777, Pirecal/CBL R$ 29.400)"*. Conferi: os
três estão certos. **A desconfiança dela estava apontada para o lugar errado** —
ver 2.2.

## 2.2 Eduardo e Adriana: as contagens certas, as somas erradas — R$ 192.945

| | ela disse | eu medi | diferença |
|---|---|---|---|
| Eduardo · cards parados >3d | **35** | **35** | ✅ |
| Eduardo · valor parado | R$ 1.001.800 | **R$ 833.700,00** | ❌ **+R$ 168.100 (+20,2%)** |
| Adriana · cards parados >3d | **46** | **46** | ✅ |
| Adriana · valor parado | R$ 902.771,40 | **R$ 877.926,40** | ❌ **+R$ 24.845 (+2,8%)** |
| **Total entregue ao CEO** | **R$ 1.904.571,40** | **R$ 1.711.626,40** | ❌ **+R$ 192.945 (+11,3%)** |

⚠️ **Não é divergência de régua, e há prova aritmética disso.** O teto absoluto do
Eduardo — **todos** os cards abertos dele, nos dois boards, sem nenhum filtro de
"parado" — é **R$ 912.100 em 66 cards**. Foi afirmado **R$ 1.001.800 em apenas 35
cards parados**: R$ 89.700 acima do máximo possível. Nenhum recorte produz esse
número.

E não foi o dado que mudou: `audit_logs` não registra **nenhuma** alteração de
`value` em card desde 08/09.

Que as duas contagens (35 e 46) e todos os detalhes nominais conferidos (Aterpa
R$ 147.000 / 62 dias / 113 no CRM; Adufertil R$ 24.500 / 138 / 189; Atlantic
Nickel R$ 137.000 / 5,9 dias) estejam **exatos** diz onde o erro está: o Atlas
selecionou os cards certos e **somou errado**.

⚠️ **E a Nina abdicou da conferência exatamente ali.** Ela escreveu, às 13:51:23:

> *"O Atlas informou o total consolidado de 902.771,40 e 46 cards — **confio
> nesse total oficial dele, que foi conferido pelo próprio na origem dos
> dados**."*

Naquele mesmo turno ela contou linha por linha a lista nominal (que estava
certa) e aceitou de olhos fechados o total (que estava errado). **A conferência
foi gasta no que não precisava e faltou onde decidia.** É a mesma lição do
`MESES_ANALISE` em 21/08: âncora que não exercita o que pode estar errado dá
confiança em vez de segurança.

## 2.3 Vencido em aberto: R$ 148.906 inflados, e a autoridade tem a régua

| | dito | a régua da casa |
|---|---|---|
| títulos | 414 | **373** |
| valor | R$ 1.101.692,67 | **R$ 952.786,57** |

O número foi repetido igual nas duas respostas do dia.

⚠️ **A causa é um filtro que falta, e quem a nomeia é o sistema de origem.** A
API que serve o painel do DataCoreHS (`tinyapi.healthsafetytech.com`) expõe
`GET /contas_receber/` com o parâmetro **`incluir_excluidas`, cujo default é
`false`**. Batendo nela hoje, com `situacao=aberto` e `vencimento_fim=2026-09-07`:

| | títulos | valor |
|---|---|---|
| `incluir_excluidas=false` (o default, o que o painel vê) | **373** | **R$ 952.786,57** |
| `incluir_excluidas=true` | 410 | R$ 1.112.811,77 |

A Iris entregou **414 / R$ 1.101.692,67** — a faixa de cima. A diferença são as
**41 contas marcadas `excluida_na_origem_em` em 05/09/2026** (R$ 173.480,80, todas
em aberto), três dias antes de ela responder. O mesmo evento de ETL marcou 226
contas a pagar; foi um lote só, num dia só.

A mesma consulta no Postgres com a régua da casa devolve **373 /
R$ 952.786,57** — idêntico à API, ao centavo. A régua é: `situacao` em
`aberto`/`pendente` (`recebido` e `pago` são as quitadas), `excluida_na_origem_em
IS NULL`, e o valor em aberto é o **`saldo`**, não o `valor`.

⚠️ **A causa estrutural é maior que o filtro, e vale mais que este número: a API
aplica um default de régua que o acesso direto ao banco não aplica.** O painel
lê pela API e é protegido de graça; a Iris lê o Postgres cru pelo MCP
`banco-datacorehs` e **contorna todos os defaults da API sem saber que existem**.
Todo número que um agente tira direto do banco carrega esse risco, não só este.

⚠️ **E não existia skill de contas a receber.** As sete publicadas cobrem
faturamento, os dois funis, gargalos do TaskHS, pipeline do CRM, criação de
agente e o relatório de vendedores. "Vencido em aberto" foi improvisado na hora —
e é **o único número grande do dia que errou de forma estrutural**, não por
janela de tempo. A skill `contas-receber` foi escrita a partir desta conferência.

⚠️ **Correção do meu próprio primeiro diagnóstico, que vale registrar.** Ao
levantar isto eu medi **376 / R$ 968.466,57**, incluindo as três contas
`parcial`. Errado: o dialeto do DataCoreHS
(`src/pages/ContasReceber.tsx`) define `estaEmAberto` como `pendente` ou
`aberto`, e só. Eu tinha inventado meia régua a partir do que a coluna parecia
significar, exatamente o que o `CLAUDE.md` da máquina proíbe — a régua da HS mora
no sistema de origem, e bastava perguntar a ele.

## 2.4 Serviço: 176 de manhã, e a régua estava escrita

O Flow reportou **176 cards parados >48h** às 03:36 e corrigiu para **136** às
12:30, explicando bem: *"o Flow contou cards já arquivados como parados"*. Meço
**131** pela régua (100 movidos + 31 que nunca se moveram), com as etapas
batendo — Manutenção 19, Coletado 19, Despachado 19 — e as médias de dias
fechando quando se contam os que nunca saíram do lugar desde 18/07.

⚠️ **O número da tarde está bom. O problema é o da manhã ter existido.** A skill
`gargalos-taskhs` documenta esse erro exato, em destaque, com o caso de 31/08:
*"sem ele, o board Serviço reporta 166 cards parados em Correios onde há 47 — 3,5
vezes"*. A régua estava escrita, com o exemplo, e não foi aplicada. Só se
corrigiu porque o CEO digitou "atualizar".

É o mesmo padrão de 14/08 com a skill `faturamento`: **skill publicada não é
skill usada.**

---

# Parte 3 — o achado mais sério: a conclusão sobre a Sandra

Às **12:51:53** a Nina entregou ao CEO a conclusão final das duas carteiras:

> *"**Nenhum dos 35 cards saiu da carteira da Sandra.** Zero mudanças de
> responsável para fora dela. ... **Conclusão:** o caso da Sandra é **(a)
> abatimento real em lote**, não redistribuição. Diferente do caso da Gislaine,
> que **sim** tinha redistribuição viva real."*

**Sobre os 35, ela está certa.** Verifiquei os `card_transfers` (vazia, como ela
disse) e o `audit_logs`: os 35 perdidos e os cards transferidos são conjuntos
**disjuntos**. A afirmação estrita se sustenta.

⚠️ **Mas entre 11:54:20 e 11:57:55 daquela mesma manhã — uma hora antes — o
Welton Kellyson transferiu 12 cards VIVOS da Sandra, R$ 227.300**, por edição do
campo responsável:

| para | cards | valor |
|---|---|---|
| Adriana Oliveira | 3 | R$ 95.000 |
| Eduardo Luna | 3 | R$ 58.800 |
| Karolaine Martins | 3 | R$ 49.000 |
| Miguel Luiz | 3 | R$ 24.500 |

Às 12:45 — cinquenta minutos depois disso — ela respondeu *"Sandra: zerada... ela
tem 1 card aberto"* e atribuiu o esvaziamento **inteiramente** ao abate de
01–04/09. Hoje a Sandra tem **zero** cards abertos no Aquisição.

**A carteira da Sandra teve as duas coisas** — abate em lote *e* redistribuição
viva —, e o CEO recebeu a versão em que teve só uma, apresentada como o contraste
que definia o caso dela contra o da Gislaine.

⚠️ **A causa é de método, e é a lição mais reaproveitável do dia: ela olhou só os
35 cards que o CEO pediu e generalizou dali para a carteira inteira.** O recorte
que responde à pergunta não é o recorte que sustenta a conclusão. Bastava, antes
de afirmar "a carteira foi abatida, não redistribuída", varrer `audit_logs` por
**todas** as trocas de responsável da Sandra — não só as dos 35.

A recomendação dela continua válida (*"confirmar com o Welton Kellyson"*), e
agora fica melhor: a conversa com ele deve incluir os 12 cards de 08/09.

---

# Parte 4 — o que ela acertou, e que vale preservar

- **A divergência do GestorHS, marcada nas duas respostas — e ela está certa.**
  Confirmei: `gestorhs.ordens` tem **última `data_solicitacao` em
  17/07/2026 e zero ordens novas em agosto e setembro**, enquanto `logs_os`
  registra **362 eventos em setembro** e `data_chegada` chega a **08/09**. O
  sistema é operado todo dia; a gravação de ordem e fase quebrou há ~7 semanas e
  **ninguém do time reportou**. É o achado operacional mais valioso da conversa,
  e veio de um agente.
  (De quebra, dado sujo na mesma tabela: `data_retorno` máximo **2100-06-29** e
  `data_calibracao` **2027-05-14** — a mesma família dos nove registros com data
  impossível do `CONFERIR-NA-VOLTA.md`.)
- **Recusou duas vezes uma régua impossível.** O CEO pediu "quanto tempo estava
  parado **depois** da perda" e confirmou o pedido quando questionado; ela
  explicou que perdido é estado final, traduziu para "parado na etapa antes do
  abate" e disse que estava traduzindo. Comportamento certo.
- **Marcou o dado como sensível de carteira antes de entregar**, todas as vezes.
- **Corrigiu-se três vezes com dado novo** (176→136, Sandra "redistribuída"→
  abatida, `card_transfers`→`audit_logs`), sempre dizendo o que mudou e por quê.
- **A descoberta metodológica sobre o `card_transfers` é real e vale virar régua:**
  a tabela tem **0 linhas** e o sistema não a usa; troca de dono no HSGrowth é
  edição do campo responsável, registrada em `audit_logs` com
  `entity_type = 'Card'`. Quem consultar `card_transfers` conclui que nunca houve
  transferência nenhuma.

---

# Parte 5 — os ajustes, em ordem de custo/benefício

| # | ajuste | onde | custo |
|---|---|---|---|
| 1 | Dizer **quando** usar `dias_de_validade` na `description` da ferramenta, não só no docstring | `backend/app/routers/relatorios.py` | ✅ feito |
| 2 | Régua de troca de dono (`audit_logs`, não `card_transfers`) na skill `funil-vendas` | `backend/skills/funil-vendas/SKILL.md` | ✅ feita |
| 3 | **Atualizar** o ponteiro do `flow` — ele já existe e nomeia a armadilha errada (`updated_at`, não o arquivado) | `AGENTS.md` do `flow` | ✅ escrito (+772 chars) |
| 4 | Skill nova de **contas a receber** — a régua que não existia | `backend/skills/contas-receber/` | ✅ feita |
| 5 | `seq_depois` em `agent_runs`, gravado pelo `/reply` e lido pelo `_piso_do_seq` | `conversations.py` + migração `016` | ✅ feito, com teste |
| 6 | Ensinar a ler `ANNOUNCE_SKIP` — ela já usa `timeoutSeconds`; o que faltou foi saber que o token quer dizer "acabou" | `AGENTS.md` da `nina` | ✅ escrito |
| 7 | Onde gastar a conferência (o total, não a lista) + recorte de pergunta ≠ recorte de conclusão | `AGENTS.md` da `nina` | ✅ escrito (+2.314 chars) |
| 8 | Remover o truncamento em 8.000 caracteres (`maxChars` no `chat.history`) | `conversations.py`, `channels.py` | ✅ feito, medido ao vivo |

⚠️ **Os itens 1, 2 e 4 valem mais do que parecem**, porque os três erros de
número do dia têm a mesma forma: **régua que existe e não foi aberta (serviço),
régua que não existe (vencido em aberto), e conferência gasta no lugar errado
(Eduardo/Adriana)**. Nenhum deles é falta de capacidade do agente.

⚠️ **E dois dos ajustes que eu tinha proposto já estavam escritos — descobri ao
ir aplicá-los.** O ponteiro para a skill `gargalos-taskhs` está no `AGENTS.md` do
`flow` desde 17/08; a ordem de usar `timeoutSeconds` está na primeira linha da
seção de delegação da `nina`. **Acrescentar texto não teria consertado nada.** O
que faltava era outra coisa nos dois casos: no `flow`, o ponteiro nomeia a
armadilha de 17/08 (`updated_at`) e não a de 31/08 (arquivado), e nomear uma faz
parecer que é a única; na `nina`, saber que `ANNOUNCE_SKIP` quer dizer "acabou".

Vale como método: **antes de propor uma instrução para um agente, leia o
`AGENTS.md` dele.** Metade do que eu ia escrever já estava lá, e a metade que
importava era outra.

## Fora do sistema, para gente resolver

1. **GestorHS não grava ordem nova desde 17/07/2026** (~7 semanas). Prioridade
   alta: é o sistema de calibração, e o `flow` não consegue dizer o que está
   parado *agora* por causa disso.
2. **Welton Kellyson** — confirmar a intenção do abate em lote da Sandra
   (35 cards, R$ 649.302, 01–04/09, 28 deles "Sem budget aprovado") **e** da
   redistribuição dos 12 cards vivos dela em 08/09 (R$ 227.300).
3. **Sem meta de valor cadastrada no GrowthHS** — apontado nas duas respostas do
   dia. Enquanto não houver, nenhum agente consegue dizer quanto falta em vendas.

## ⚠️ O que ainda NÃO está provado: o arquivo mudou, o agente pode não ter visto

Os três blocos foram escritos por `agents.files.set` e conferidos por releitura —
byte a byte idênticos ao que mandei. **Isso prova que gravou, e só.**

⚠️ **Sessão viva carrega o prompt que tinha quando nasceu, e as nossas
persistem.** A `agent:flow:cron:9304a0f7…` — a do briefing das 07h30 — está com
29.801 tokens e roda desde agosto: `sessionTarget: "isolated"` **não** abre
sessão nova a cada execução, como o `CLAUDE.md` já registra. Se o system prompt
for montado na criação da sessão, **o briefing de amanhã ainda usa o `AGENTS.md`
antigo** e o ajuste do arquivado não terá efeito nenhum.

Não consegui decidir isso por leitura: o `agents.list` não devolve o prompt
montado (só `agentRuntime`, `identity`, `model`, `workspace`…) e não há método de
leitura que o exponha.

**As duas conferências que serviriam**, nenhuma delas feita ainda porque as duas
são escrita e escrita no gateway se combina antes:

1. **Perguntar ao agente** — a única que vale, e a que este repositório já
   aprendeu a exigir para skill e para `deny`. *"Quantas armadilhas você conhece
   ao contar cards parados?"* Se responder uma, o texto não chegou.
2. **Arquivar a sessão de cron do `flow`** (`sessions.delete`, que arquiva em vez
   de destruir) para que a execução de amanhã nasça com o arquivo novo.

⚠️ **Enquanto isso não for feito, o item 3 está "escrito", não "em vigor".** É
exatamente a distinção que custou o número errado de 14/08 — *skill publicada não
é skill usada* — e ela vale igual para os sete arquivos.

## Aplicar em produção

A migração `016` precisa de superusuário — o `hsos_app` não tem `CREATE` em
`public`. No Konsole:

```bash
psql 'postgresql://administrador:SENHA@62.72.11.28:2222/hsos' \
     -v ON_ERROR_STOP=1 -f backend/migrations/016_seq_depois.sql
```

⚠️ **A ordem importa, e o inverso é seguro.** A coluna pode ser criada antes do
deploy do código — o backend antigo não a usa. Fazer o contrário derruba o
`/reply`, que passa a escrever numa coluna inexistente.

As skills já foram publicadas (`bash scripts/publicar-skills.sh --enviar`) e o
gateway as reconhece: 61 skills, `contas-receber` entre elas, `always: false`.
⚠️ **Mas skill publicada não é skill usada** — a conferência de verdade é
perguntar ao agente, não olhar o `skills.status`.

## Notas relacionadas

- `docs/AUDITORIA-RESPOSTAS-2026-08-31.md` — a auditoria anterior, mesmo método
- `docs/CONFERENCIA-2026-09-01.md` — a conferência que pediu "a primeira semana
  em que o Nicholson usar de verdade" para julgar os resets. Ela chegou: 41
  mensagens e **um** reset, no início da conversa, não no meio dela.
- `docs/CONFERIR-NA-VOLTA.md` — o placar do que o CEO pediu
