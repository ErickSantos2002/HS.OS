# Roadmap dos agentes — 31/08/2026

Sucessor do [`ROADMAP-AGENTES-2026-08-19.md`](ROADMAP-AGENTES-2026-08-19.md). A
fonte agora é maior e melhor: **79 perguntas** que o Nicholson fez aos agentes
entre 24 e 30/08 — Atlas 34, Iris 27, Nina 10, Flow 8 — com 137 respostas. Não é
teste, é uso de CEO: perguntas encadeadas, corrigindo o recorte no meio.

A análise em prosa está no vault, em
`_inbox/HS-OS-Retrospectiva-24-a-30-Ago-2026.md`. Aqui fica só o que fazer.

## O princípio que amarra tudo

> O conteúdo entregue foi bom. A plataforma em volta dele é que falhou.

Nenhum problema da semana foi agente errando número. A régua de faturamento se
sustentou (a Iris validou contra a âncora de janeiro antes de responder, R$
409.592,52 bateu exato), os agentes recusaram inventar dado que não existe, e o
roteamento entre domínios funcionou sozinho em todas as ocasiões.

O que quebrou foi tudo em volta: contexto estourando, mensagem duplicada,
pergunta engolida, custo não medido. **Enquanto isso não fechar, não entra
feature nova.** Um CEO que faz oito perguntas encadeadas sobre o mesmo assunto —
que foi exatamente o padrão da semana — bate no limite antes de terminar o
raciocínio.

⚠️ **Dois defeitos deste roadmap já foram dados como corrigidos em 19/08 e
voltaram.** O Bloco 2 é sobre eles, e a lição é a mesma nos dois casos: a
correção mudou o limiar em vez da causa.

---

## Bloco 1 — Contexto: o gargalo nº 1

Foram **24 resets de conversa na semana** (18 na anterior), descartando 2.630
mensagens de histórico. A Iris sozinha: 12 resets, 1.304 mensagens jogadas fora.

```sql
select agent_id, count(*), sum(mensagens) from conversation_resets
where created_at >= '2026-08-24' and created_at < '2026-08-31' group by 1;
```

### 1. ~~Subir o `reserveTokensFloor`~~ ❌ premissa errada — o defeito era outro

⚠️ **Este item estava errado, e o roadmap o colocou em primeiro lugar.** A
premissa veio do `CORRIGIR-CONVERSA-CEO-2026-08-20.md`, que apurou em 20/08 que
a seção `agents.defaults.compaction` não existia. Ela existe. Conferido no
gateway em 31/08 comparando os três backups da config:

```
openclaw.json.bak.2 (21/08)  floor=20000 reserve=24000
openclaw.json.bak.1 (21/08)  floor=20000 reserve=24000
openclaw.json.bak   (26/08)  floor=20000 reserve=24000
openclaw.json       (atual)  floor=20000 reserve=24000
```

O `reserveTokensFloor` já estava em 20000 desde pelo menos 21/08 — **antes das
três falhas de compactação** (27/08 10h03 e 18h23, 28/08 19h30). A única
mudança de 26/08 foi acrescentar `"cron"` a umas listas de permissão. A
recomendação que o gateway dá na própria mensagem de erro já estava aplicada e
não resolveu.

### 1b. A causa real: o gateway declarava 6,5% do contexto ✅ feito em 31/08

⚠️ **O `deepseek-chat` foi aposentado em 24/07/2026.** As chamadas roteiam para
o **DeepSeek-V4-Flash**, que tem **1.000.000** de contexto. A config do gateway
declarava **65.536** — 6,5% da capacidade real. (O nome no `models.providers`
entrega: `"name": "DeepSeek V4 Flash"` com `"id": "deepseek-chat"`.)

| | contextWindow |
|---|---|
| declarado até 31/08 | 65.536 |
| passo intermediário (doc do V3.1, desatualizada) | 131.072 |
| **aplicado** | **1.000.000** |

**A prova de que era isto.** Logo após subir para 131.072, o `sessions list`
mostrou a sessão do `atlas` em **66k/131k (50%)**. Com os 65.536 declarados
antes, a mesma sessão estaria **acima de 100% da janela** — é exatamente a
condição que faz a compactação disparar sem parar e, às vezes, não conseguir
recuperar. Os 24 resets da semana não eram um sistema no limite: eram um sistema
usando 6,5% do que tem.

⚠️ **O `reserveTokens` de 24.000 ficou irrelevante** contra 1M — não precisa
mexer. E o `maxTokens` de saída segue em 8.192 de propósito: o V4 Flash aceita
muito mais, mas resposta de chat não deve crescer.

**Como aplicar e desfazer.** `openclaw-gateway.service` é unidade **de usuário**
(`systemctl --user`, não a de sistema — foi por isso que o primeiro script não
achava o serviço). E é obrigatório **parar o gateway antes de editar**: ele mesmo
escreve nessa config e sobrescreve a mudança ao desligar. Scripts na máquina do
Erick: `~/hsos-contextwindow-1m.sh` e `~/hsos-rollback-contextwindow.sh`.

Conferido depois de subir: serviço ativo, 18789 escutando no loopback (v4 e v6),
plugins pré-aquecidos, `hsosapi.healthsafetytech.com/health` em 200, e as sessões
vivas já reportando a janela nova.

⚠️ **Ruído no boot, não causado por isto:** `[main-session-restart-recovery]
failed to resume interrupted main session agent "main"`. É estado velho de antes
da frota ser separada — a `usage_events` tem uma sessão `main` com eventos de
11/05 a 23/08. Falha sozinha (`recovered=0 failed=1`) e o gateway segue. Não dá
para provar que é anterior pelo journal (ele só guarda desde 25/08 e o gateway
não reiniciou nesse intervalo), mas o caminho é de startup e não tem relação com
janela de contexto.

⚠️ **O que ainda não foi medido:** se a janela certa derruba a taxa de reset.
Só aparece com uso — reconferir `conversation_resets` daqui a uma semana.

### 2. O aviso cru de compactação não pode chegar à tela ✅ feito em 31/08

Três vezes o Nicholson leu, no chat, em inglês:

> ⚠️ Auto-compaction could not recover this turn. I kept this conversation
> mapped to the current session. Please try again, use `/compact`, or use
> `/new` to start a fresh session.

`/compact` e `/new` **não existem no HS.OS** — são comandos do runtime. Estamos
mandando o CEO rodar um comando que a interface dele não tem. Isso precisa virar
mensagem nossa, em português, com a ação que existe de verdade (o botão de
resetar conversa) — ou, melhor, ser resolvido sem aparecer.

Ocorrências: `atlas` 27/08 10h03 e 18h23, `flow` 28/08 19h30.

### 3. Delegação em cascata não sobrevive ao estouro

O caso de 25/08 às 5h da manhã é o retrato do problema. O Nicholson pediu à Nina
a lista de empresas que compraram bafômetro e não calibraram. A Nina delegou à
Iris, **a Iris estourou o contexto no meio da apuração**, e a Nina passou quatro
mensagens tentando destravar antes de dizer ao CEO que dependia de intervenção do
Erick. O mesmo se repetiu em 28/08 às 19h13, com o custo do Phoebus.

A Nina se comportou bem — foi honesta, não inventou, avisou. Mas o desenho tem um
buraco: **quando o agente delegado trava, quem delegou não tem como destravar.**
Não existe reset de sessão acionável por outro agente nem timeout na espera.

Decidir: ou a Nina ganha permissão de resetar a sessão de quem ela acionou, ou a
espera tem prazo e devolve erro em vez de ficar pendurada.

⚠️ **Não fazer cron de retry em loop.** A própria Nina identificou isso como
saída errada na hora, e ela estava certa.

---

## Bloco 2 — Os dois defeitos de 19/08 que voltaram

### 4. Mensagem duplicada — a correção só moveu o limiar ✅ feito em 31/08

**12 respostas idênticas repetidas** em menos de 10 minutos, nos quatro agentes:
Atlas 5, Iris 5, Flow 1, Nina 1. É a resposta longa aparecendo duas vezes na
tela, com minutos de diferença. Num painel que o CEO usa, lê como bug de produto.

Em 19/08 o item 7 diagnosticou a causa: `chat.history` com `limit=1` **não
devolve a mensagem mais nova** — na sessão do `atlas`, 52 mensagens sem buracos e
`limit=1` respondeu a de `seq=41`. O `_ultimo_seq` subestimava, o `/reply` gravava
tudo com `seq >` aquele número, e vinham mensagens do turno anterior coladas.

A correção foi `_JANELA_ULTIMO_SEQ = 5` (`backend/app/routers/conversations.py:573`).

**Hipótese — a mais forte, ainda não confirmada contra o gateway:** isso não
consertou a causa, só empurrou o limiar. Se uma janela de 1 falha aos 52
mensagens, uma janela de 5 falha mais adiante. E o histórico desta semana foi
muito maior: a sessão do Atlas tinha **177 mensagens** antes do reset de 28/08, a
da Iris 113. Exatamente a condição que o comentário no código descreve como
"só aparece com histórico longo".

**Verificar antes de mexer:** pegar uma sessão longa viva, comparar o `seq`
máximo real com o que `_ultimo_seq` devolve com `limit=5`. Se divergir, está
confirmado.

**Correção certa, se confirmar:** parar de derivar "qual é a mais nova" de uma
leitura paginada do gateway. Já gravamos `seq_antes` em `agent_runs` — a nossa
própria tabela sabe onde o turno anterior parou, e não depende de o gateway
devolver a fatia certa. Trocar a fonte da verdade resolve para qualquer tamanho
de histórico; subir a janela de 5 para 20 só compra tempo.

### 5. Pergunta engolida — o `/recuperar` não alcança sessão longa ✅ feito em 31/08

**Oito perguntas ficaram sem nenhuma resposta** na semana. Não uma resposta
ruim: nenhuma.

| agente | quando | pergunta |
|---|---|---|
| atlas | 24/08 16h34 | faturamento agosto por vendedor |
| iris | 24/08 17h14 | reload |
| iris | 24/08 17h44 | os 2 novos vendedores vao somar ao time, lara cocri nao faz mais parte |
| iris | 24/08 17h59 | estou falando de lara e nao de laura… |
| iris | 24/08 18h29 | tirar lara |
| atlas | 26/08 23h45 | Qual a previsão para serviços dentro do mês |
| atlas | 27/08 10h12 | refazer |
| iris | 28/08 12h50 | Quero apenas o faturamento do mês de agosto de 2026 |

⚠️ **`reload` e `refazer` são o Nicholson percebendo que travou e empurrando
sozinho.** Ele não reclamou; ele tentou consertar. Isso some de qualquer métrica
que não olhe a conversa.

Este é o item 6 de 19/08 de volta — resposta órfã, gravada só enquanto o
navegador está em `/reply`. A correção de lá foi
`POST /conversations/{agente}/recuperar`, chamado pela tela ao abrir o chat, que
compara o `chat.history` do gateway com o nosso `conversations`.

**O buraco:** o `/recuperar` lê com `limit=60`
(`backend/app/routers/conversations.py:746`). A sessão do Atlas chegou a 177
mensagens. Qualquer resposta órfã mais antiga que as últimas 60 **não é
recuperável** — e o reset de 28/08 apagou a sessão, então provavelmente essas
oito estão perdidas de vez.

Duas frentes: subir/paginar a janela do `/recuperar`, e atacar a origem — gravar
a resposta quando ela chega, não quando o navegador vem buscar.

---

## Bloco 3 — Como o agente fala

### 6. O monólogo interno continua vazando ✅ feito em 31/08

O item 5 de 19/08 mandou cortar o raciocínio interno da resposta. Não pegou.
**15 mensagens** desta semana falam do usuário em terceira pessoa ou narram o
próprio processo:

> *"O CEO pergunta sobre a origem dos leads de agosto."* · *"Vou verificar quem
> está falando comigo."* · *"Vou montar a resposta final."* · *"Antes de
> responder ao CEO…"*

Por agente: Atlas 11, Iris 3, Nina 1. O Nicholson está lendo o agente pensar
sobre ele — e sendo chamado de "o CEO" na terceira pessoa, na cara dele.

Como a instrução escrita não foi suficiente, o corte tem que ser no nosso lado:
não gravar em `conversations` a mensagem que é claramente monólogo. O sinal é
razoavelmente limpo (terceira pessoa + anúncio de próximo passo).

### 7. Preâmbulo demais ✅ feito em 31/08 — é o mesmo defeito do item 6

**1,8 bolha de agente por pergunta** (Nina 2,0; Atlas 1,8; Iris e Flow 1,6), e
**22 delas são só preâmbulo** — mensagens curtas começando com "Vou consultar…",
"Vou verificar…", "Vou montar…", sem conteúdo.

Uma bolha de "estou indo buscar" tem valor enquanto a resposta demora — e o Atlas
teve pergunta de **341 segundos**. Mas então é estado de carregamento, não
mensagem de chat: não deveria ficar no histórico depois que a resposta chega.

---

## Bloco 4 — Estamos cegos para medir

### 8. `usage_events` parou de registrar as conversas ✅ feito em 31/08 — causa achada

Os eventos de DM do Nicholson (`label = 'hsos-83bc4b9d-…'`) vão de 15/08 a
**24/08 e param** — justamente a semana de uso pesado. O total contabilizado de
24 a 30/08 foi **US$ 0,15 em 38 chamadas**, para 216 mensagens trocadas. O que
sobrou registrando é cron e sessão `main`.

Não dá para responder quanto custou a semana. E o Bloco 1 do roadmap anterior era
justamente sobre economia de token — sem essa tabela não há como saber se
funcionou.

### 9. ~~`agent_turns` está inteiramente vazia~~ ❌ não é defeito: é entulho arquivado

⚠️ **Eu levantei isto como decisão pendente e não era.** A resposta já estava
escrita em [`DECISAO-RECONCILIADOR.md`](DECISAO-RECONCILIADOR.md), de 11/08.

A `agent_turns` (e a `agent_turn_events`, também com 0 linhas e 0 escritores)
alimentava a `turn-reconciler`, arquivada de propósito em `_pausado/`. O motivo:
o desenho herdado **empurrava** a resposta e a reconciliadora existia para
recuperar o que o webhook perdesse; o nosso **puxa**, e o buraco não existe.

O mesmo doc definiu o sinal que reabriria a decisão — *"resposta que some depois
de fechar a aba, com uso real"* — e mandou consertar pela recuperação ao abrir a
conversa, **não** portando a reconciliadora. O sinal apareceu em 17/08 e o
conserto foi feito (`/recuperar`).

**As 8 perguntas engolidas de 24 a 30/08 são o mesmo sinal pela segunda vez**, e
a resposta certa segue a mesma: o item 5 deste roadmap, feito em 31/08.

Não há nada a construir nem a decidir. Fica a lição de leitura: `0 linhas, 0
escritores` parece instrumentação quebrada e é tabela aposentada — o repo arquiva
sem apagar de propósito (ver `EM-CONSTRUCAO.md`), então tabela vazia pede uma
busca nos docs antes de virar item de roadmap.

### 9b. As quatro tabelas de monitoramento ✅ feito em 31/08

Era maior do que parecia: as **quatro** (`gateway_health`, `usage_daily`,
`agent_stats`, `cron_jobs`) estavam em zero linha. Quem as enchia era um coletor
na VPS chamando `POST /coletor/estatisticas` — e ele **não existe mais**.
Conferido na máquina do gateway: nenhum script, agendamento ou serviço, nem
sequer o que apontava para o Supabase, que era o que o `TESTAR-SEGUNDA.md` dizia
estar lá.

Agora quem enche é `app/coletor_metricas.py`, um laço ao lado dos três que o
backend já roda. A escrita reusa o `_gravar` do router; o que o módulo acrescenta
são os adaptadores, porque o formato do gateway é aninhado e o do coletor antigo
era plano.

### 10. Não existe registro de login

`access_logs` só grava ação de administrador — `create_user`, `delete_user`,
`change_role`, `deactivate_user`. Não há evento de login. A única pista de que
alguém entrou é o `profiles.last_seen_at`, que é heartbeat de aba visível
(`use-presence.ts` → `profiles.py:413`).

Foi o que sobrou para responder se a Ketlin usou o sistema (Bloco 5). Deu para
responder, mas por acidente.

---

## Bloco 5 — Adoção: dar acesso não é dar uso

### 11. A Ketlin entrou por 4 minutos e não voltou ⛔ fora de escopo (Erick, 31/08)

**Ketlin Scalco**, Consultora de Vendas, criada em 25/08 às 11h11 com acesso a um
agente só, o Atlas.

A configuração está correta — o id dela está em `agent_profiles.allowed_user_ids`
do `atlas` e a regra `specific_users` do `_pode_ver`
(`backend/app/routers/agents.py:93`) a libera. **Não é bug de acesso.**

Ela entrou: presença registrada das 11h11 às **11h15h27** — quatro minutos e
vinte e cinco segundos — e nunca mais, em seis dias. Zero mensagens, zero
conversas, zero eventos.

Quatro minutos é tempo de abrir, olhar e fechar. **Antes de mexer em produto,
perguntar a ela o que aconteceu.** As hipóteses (não sabia o que perguntar, não
entendeu que podia, não voltou) levam a correções diferentes, e a diferença entre
elas não está no banco.

O que já dá para dizer: um usuário com um agente só cai numa tela de chat vazia,
sem exemplo, sem "experimente perguntar". O Nicholson aprendeu o que perguntar
porque acompanhou a construção. Ninguém mais tem esse contexto.

---

## Bloco 6 — Dívida com o usuário

### 12. ~~Um pedido nunca foi entregue~~ ✅ entregue por fora no mesmo dia

**Empresas que compraram bafômetro e não fizeram calibração** — pedido de 25/08
às 5h15 à Nina. A Iris estourou o contexto no meio, chegou a calcular 946 CNPJs,
e ela mesma questionou o número: a primeira versão da consulta contava **peças e
acessórios** (bocal, sensor, visor, LCD, módulos) como "comprou bafômetro",
inflando a lista.

**O dado chegou — só que não pelos agentes.** O Nicholson perguntou à Nina às
05h15; às **07h55 do mesmo dia** a planilha
`Calibracoes-Atrasadas-2026-08-25.xlsx` foi gerada pelo `atrasadas.py`, no
caminho do Erick: 984 clientes, 3.126 aparelhos atrasados, **1.632 nunca
calibrados** — que é exatamente a pergunta dele. O critério que a Iris estava
refinando quando estourou (só aparelho, não peça) é a decisão de escopo nº 2
daquele script: Phoebus conta pelo módulo, nunca pelo aparelho.

Fica como medida do custo real da falha: 2h40 e um caminho humano para uma
pergunta que o sistema deveria responder.

---

## O que NÃO fazer agora

- **Central de Comando e a cadeia de cinco agentes.** Segue valendo o que o
  roadmap de 19/08 escreveu: dependem de os agentes encadearem sem supervisão, e
  o Bloco 1 desta semana mostra que a delegação ainda quebra quando o delegado
  trava.
- **Agente novo.** Cinco já é mais do que a plataforma aguenta hoje.
- **Cron de retry em loop** para destravar sessão (ver item 3).

## Ordem sugerida

1. ~~Item 1 (`reserveTokensFloor`)~~ — era premissa errada; a causa real (contextWindow pela metade) foi corrigida em 31/08
2. Item 4 (duplicata) — confirmar a hipótese do `seq` antes de mexer
3. Item 5 (pergunta engolida) — é o que o CEO sente mais
4. Item 8 (medição) — sem isso não se sabe se o resto funcionou
5. Item 2 (aviso em inglês na tela)
6. Itens 6 e 7 (como o agente fala)
7. ~~Item 11 (falar com a Ketlin)~~ — descartado em 31/08

## Notas relacionadas

- [`ROADMAP-AGENTES-2026-08-19.md`](ROADMAP-AGENTES-2026-08-19.md) — o anterior
- [`DECISAO-RECONCILIADOR.md`](DECISAO-RECONCILIADOR.md) — previu o buraco da
  resposta órfã e definiu o sinal que reabriria a decisão; o sinal apareceu de novo
- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado atual e armadilhas


---

## O que foi feito em 31/08

Tudo no `backend/`, com teste. `cd backend && ./.venv/bin/python -m pytest tests -q`
→ **12 passando**. Nada commitado, nada em produção.

**Item 4 — duplicata.** `_ultimo_seq` ganhou um `piso`, vindo do maior
`seq_antes` que o nosso `agent_runs` já registrou para aquela sessão. O `seq` de
uma sessão só cresce, então o que já vimos nunca some, por mais que a janela do
gateway devolva fatia velha. Também deixou de devolver `0` quando o gateway está
fora — isso zerava o corte e regravava a sessão inteira como nova.

⚠️ **A hipótese do Bloco 2 continua não confirmada contra o gateway** (não há
acesso SSH nesta máquina). A correção foi escrita para não depender dela: o piso
protege qualquer que seja o motivo de a janela vir curta. Se a hipótese estiver
errada, o piso não faz mal — ele nunca superestima.

⚠️ **Há um segundo caminho de duplicata**, já documentado em
`CORRIGIR-CONVERSA-CEO-2026-08-20.md`: dois `/reply` em voo em workers
diferentes, corrigido em `2c05b76` pela reserva no banco. Não foi tocado agora, e
pode ser a causa de parte das 12 desta semana.

**Item 5 — pergunta engolida.** Janela do `/recuperar` de 60 para 200 (a sessão
do `atlas` chegou a 177). E **a lista de comparação passou a usar a mesma
constante**: ler mais do gateway do que se compara do nosso lado reimportaria
como órfã a resposta antiga que já está na tela — subir só um dos dois números
teria criado duplicata nova.

**Item 2 — aviso em inglês.** O `/reply` já se recusava a gravar esse texto; o
`/recuperar` não tinha a trava e o reimportava a cada abertura da tela. A decisão
virou uma função só, `_deve_recuperar`, usada pelos dois.

**Item 8 — o coletor de uso.** Causa encontrada e é boa: `session_key` é fixo por
(agente, usuário), e o botão "Limpar" apaga a sessão no gateway, que recomeça do
zero com a mesma chave. O coletor comparava com a **soma** do que já gravamos, o
que virou marca d'água permanente — `delta` negativo, `continue`, para sempre.
Confere com o dado: cada agente do CEO parou de registrar no primeiro reset dele
(`atlas` 20/08, `nina` 23/08, `iris` 24/08) e não voltou. Agora a comparação é
com o **último retrato**, e total menor que ele é a assinatura da sessão
recriada.

## Decisões que ficaram para o Erick

**Item 11 — a Ketlin.** Descartado pelo Erick em 31/08. O achado de
onboarding continua valendo para o próximo usuário que entrar: acesso dado não é
uso, e quem cai numa tela de chat vazia sem exemplo não volta.


## Itens 6 e 7, feitos depois — e o corpus como bancada de teste

Eu tinha parado nestes dois por não poder verificar contra o gateway. Não era
preciso: as **137 respostas da semana estão no banco**, e elas são a bancada.

**O mecanismo não era o que o roadmap supunha.** Não é o `/reply`, que grava uma
linha por run e só depois de o run terminar. É o `POST /webhook/resposta`: o
agente empurra `content` como lista e **cada item vira uma linha**. O único
filtro era o `_HEARTBEAT`, que olha se o texto começa com emoji — narração em
texto puro passava direto.

**A primeira regra que escrevi estava errada, e o corpus mostrou.** Descartar a
mensagem que começa com monólogo derrubaria 5 das 24: elas trazem a resposta no
mesmo bloco, como *"O CEO pergunta quem está melhor no mês. […] Vou responder
direto. / Nicholson, o destaque do mês é o Eduardo Luna."* Trocada por aparar
parágrafos do começo, medida de novo contra as 137:

| | |
|---|---|
| mensagens aparadas | 41 |
| bastidor puro (o bloco todo some) | 25 |
| que perderam texto com R$ ou tabela | **0** |

⚠️ **É heurística, calibrada numa semana de um usuário.** Vale reconferir o
número quando houver outro mês de conversa — e a lista de marcadores em
`_BASTIDOR` é o lugar de ajustar, não o desenho.


---

## Fechamento de 31/08

Não sobrou item de código em aberto neste roadmap. O que resta são duas coisas
que não são dele:

**Decisão do Erick — as 191 policies de RLS.** Funcionam e são defesa em
profundidade, mas duplicam a autorização que já está no FastAPI. Aposentar é
migração de banco, e a decisão vem antes do trabalho. Está no `ROADMAP.md`, em
"Decisões em aberto", desde antes deste documento.

**Projeto de conteúdo — reescrever a Documentação.** São 2.859 linhas entre
`DocumentationPage.tsx` e `dnos-documentation-yaml.ts` descrevendo a arquitetura
anterior. ⚠️ **Não é ponta solta:** os dois arquivos já carregam, cada um, um
aviso específico no topo dizendo o que está velho e por quê — inclusive um
dirigido a LLMs, para não gerarem código chamando função que não existe. Em
31/08 saíram os dois erros que o aviso não cobria: o papel `member`/`user`, que
não existe no banco desde a migração 005, e o tempo verbal da seção de Edge
Functions.

**Item 3 — a delegação em cascata — segue sem conserto e provavelmente sem
precisar.** As duas vezes que a Nina ficou pendurada foi porque a Iris travou por
contexto estourado; com a janela real (1M em vez de 65.536) essa condição fica
muito mais difícil. **Reavaliar depois de ver os agentes rodando uma semana**, em
vez de construir agora um destravamento para um caso que pode ter deixado de
existir.

### O que conferir amanhã

➡️ **Conferido em 01/09.** Resultado em
[`CONFERENCIA-2026-09-01.md`](CONFERENCIA-2026-09-01.md): os cinco briefings
passaram de primeira, o `/monitoring` encheu, e os resets caíram — mas sem
tráfego que prove, então a linha 2 continua em aberto.


| quando | o quê | o que significa |
|---|---|---|
| 07h30–07h50 | os cinco briefings | passar de primeira confirma o diagnóstico da janela |
| depois das 08h | `conversation_resets` | a taxa deve cair muito abaixo de 24/semana |
| a qualquer hora | `/monitoring` | deixa de estar vazia pela primeira vez |
| se algo falhar | o chat da `nina` | o guardião agora avisa, em vez de só registrar em log |
