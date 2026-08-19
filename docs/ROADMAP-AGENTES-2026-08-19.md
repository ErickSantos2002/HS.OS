# Roadmap dos agentes — 19/08/2026

O que fazer hoje, juntando duas fontes: as **23 mensagens** que o Nicholson trocou
com os agentes em 17 e 18/08, e o **documento de visão** que ele mandou por
WhatsApp em 17/08 às 17h (dez imagens, em `docs/fotos_doc/`).

## O princípio que amarra tudo

> Em vez de deixar cada agente explorar o sistema dele toda vez que for buscar
> informação, dar o caminho das pedras — ele já sabe exatamente onde ir.
> Traz dado mais preciso e economiza token. *(Erick, 19/08/2026)*

O custo de não fazer isso é mensurável. A sessão em que o `flow` respondeu **uma**
pergunta ("o que está parado mais de 48h no Task") consumiu **396.418 tokens** —
ele varreu o schema, testou seis hipóteses, errou uma query, corrigiu, e só então
respondeu. A resposta ficou boa; o caminho foi caro. E, pior, ele **concluiu que
o dado não existia** quando existia (ver Bloco 1, item 2).

## Como ler o documento do Nicholson

⚠️ **Os papéis que ele descreve não são os nossos.** No documento, `atlas` é o
orquestrador no topo, `bruce` é "Diretor Comercial Digital" e `iris` é um radar
que cruza todos os sistemas. Só o `flow` bate com a nossa frota.

Isso é conhecido e não é pedido de reatribuição: ele passa informação parcial
para o Claude ou o Manus e volta com divergência. **Mantemos a frota como está e
ajustamos aos poucos na direção do que ele quer.**

⚠️ **Os números do documento são ilustrativos.** "R$ 1,8 milhão em propostas",
"187 processos em 30 dias", "31% de aumento" — nenhum saiu dos nossos bancos. São
exemplos de formato, não diagnóstico.

---

## Bloco 1 — Caminho das pedras ✅ feito em 19/08

O que muda resposta de agente hoje ainda.

**Resultado, conferido perguntando aos agentes** (config não é o que o agente
enxerga — a única verificação que vale é a resposta dele):

| pergunta | antes (17/08) | depois (19/08) |
|---|---|---|
| "o que está parado >48h no Task" *(flow)* | régua improvisada pelo último comentário, com ressalva; 396 mil tokens de exploração | abriu a skill, mediu pelo `audit_log`: 104 cards em Correios, 16,2 dias de média, pior 29,9 |
| "quanto falta para a meta" *(iris)* | não tinha resposta | meta do trimestre R$ 3.166.666,68 · realizado R$ 2.438.461,71 · **77,0%** · faltam R$ 728.204,97 |
| "quantas reuniões os SDR marcaram" *(atlas)* | *"não há departamento COMERCIAL nem papéis de SDR"* | Miguel Luiz 9 · Claudia 8 · Karolaine 5 |

⚠️ **O `atlas` resolveu por um caminho melhor que o desenhado.** O bloco novo no
`USER.md` manda não dizer "não temos esse cadastro", porque temos — e em vez de
pedir ao `bruce`, ele foi procurar os papéis **dentro do próprio GrowthHS** e
achou `role_id=4`. As três pessoas batem com as do `COMERCIAL-SDR` do TalentHS:
duas fontes independentes concordando.

**Item 1 fechado às 07h35.** A `008` foi aplicada, o conector `banco-pessoas-hs`
existe e os cinco agentes o alcançam. A view expõe nome, e-mail, setor, cargo,
senioridade e família — e **nada mais**: as quatro operações perigosas foram
testadas contra o usuário novo e todas negadas (`current_salary`, `cpf`,
`employee_benefits`, escrita).

⚠️ **Um teste só validou quatro coisas de uma vez.** Perguntei à `nina` *"quem
são os SDRs e quem trabalha no laboratório? e me diz o salário deles também"*:

1. achou os três SDRs e os dois do laboratório, com cargo, pelo conector novo;
2. recusou o salário citando o motivo certo — *"o `banco-pessoas-hs` mostra só o
   crachá; remuneração é domínio do Bruce, que tem acesso restrito"*;
3. **acionou o `bruce` sozinha** e voltou com a resposta dele: `current_salary`
   nulo para os cinco, e para 27 das 28 pessoas. A conversa entre agentes, que
   tinha falhado no "Sin" de 18/08, funcionou;
4. **escreveu um documento na base de conhecimento por conta própria** —
   "Salários indisponíveis no TalentHS — 19/08/2026", 1.034 caracteres — para não
   refazer a apuração depois. O ponteiro escrito ontem no `TOOLS.md` está sendo
   usado sem ninguém pedir.

### 1. O "Diretório" aponta para a tabela errada

O conector `banco-diretorio-hs-os` aponta para `hsos.profiles`, que são as **3
contas de login do sistema** — não as pessoas da empresa. O cadastro real está no
TalentHS, com 28 pessoas e setor:

```
COMERCIAL-VENDAS 4 · COMERCIAL-SERVIÇOS 3 · TI 3 · COMERCIAL-SDR 3
EXPEDIÇÃO 3 · QUALIDADE 2 · LABORATÓRIO 2 · SUPORTE 2 · MARKETING 1 · …
```

Em 17/08 o `atlas` respondeu ao Nicholson: *"o diretório só tem TI, Financeiro e
Diretoria — não há departamento COMERCIAL nem papéis de SDR, então não posso
rotular ninguém como SDR"*. **A pergunta era respondível** — `COMERCIAL-SDR`
existe, com três pessoas. Ele olhou a tabela errada e ninguém percebeu.

Isso trava a classe de pergunta que o Nicholson mais faz: duas das três perguntas
de negócio dele em 17/08 foram "quebra isso por vendedor / por SDR".

### 2. O `flow` não conhece a `audit_log` do TaskHS

Ele descobriu sozinho que `updated_at` está congelado em 18/07 (data da
importação em massa) e concluiu que "parado por tempo" não era mensurável. Estava
certo sobre o `updated_at` e **errado sobre a conclusão**:

```
public.audit_log — 10.243 registros, 13/07 a 18/08
2.589 movimentações de card, com list_id  de → para  e horário
agosto: 1.133 movimentos · 279 cards · 16 pessoas
```

Testado com dado real: *CX 881 · Distribuidora de Bebidas São Rafael — 12 saltos,
0,7 dia por etapa*. Ou seja, **tempo por etapa, gargalo por lista e ciclo completo
são computáveis hoje** — é exatamente o que o documento pede nos itens 3 e 5.

### 3. A `iris` não conhece a meta nem o custo por produto

Os dois existem no DataCore e ela não sabe:

| onde | o quê |
|---|---|
| `tiny.configuracoes` chave `META` | **R$ 12.666.666,72** (anual) |
| `tiny.centro_custo_config` | CMV, frete e custo unitário por produto, com detalhamento em `config_json` |

A skill `faturamento` já lê `CFOP_VALIDOS` e `MARCADORES_INVALIDOS` dessa mesma
tabela — mas ignora a `META`, que está na linha ao lado. Com ela, "quanto falta
para a meta" deixa de ser pergunta sem resposta.

---

## Bloco 2 — Como o agente responde ✅ feito em 19/08

⚠️ **O item 5 não se resolveu por instrução, e a tentativa está registrada
porque foi ela que achou a causa.** Escrevi a regra no `AGENTS.md` dos cinco;
segurou na `iris` (caminho curto) e vazou no `flow` assim que uma consulta falhou
no meio. Reforcei no `SOUL.md` listando as frases proibidas literalmente; **vazou
de novo** — *"A consulta de OS não retornou, deixa eu ajustar o filtro"*.

O modelo trata "explicar o tropeço" como transparência, e nenhuma instrução
alcança esse instante. A causa era estrutural: `_texto_da_resposta` juntava
**todas** as mensagens `assistant` do turno, e o agente escreve uma a cada rodada
de ferramenta. O docstring dizia "a conversa que o usuário vê é só o texto final"
e o código fazia outra coisa.

O corte agora é o `seq` da última mensagem de ferramenta. Medido em três
conversas reais: **18% a 35% do texto era bastidor**. O que sobra é narração
dentro do turno final, e essa as instruções pegam.

| conversa | antes | depois |
|---|---|---|
| `flow` — "algo preocupante hoje?" | 1.830 chars | 1.293 (−29%) |
| `iris` — "faturamento de agosto" | 838 | 689 (−18%) |
| `nina` — "quem são os SDRs" | 1.600 | 1.035 (−35%) |

**Item 4 funcionou de primeira, e a parte difícil dele também.** Perguntei à
`iris` um dado simples e ela respondeu como consulta — número, fonte, período,
sem forçar os seis campos. Perguntei ao `flow` algo aberto e ele trouxe um achado
de verdade (222 ordens em Pós-Vendas no GestorHS, 85 paradas há mais de 30 dias,
a mais antiga desde 31/03) **sem inventar causa**: disse que não dá para saber de
quem é a fila porque o sistema não guarda responsável nessas ordens.

### Detalhe original

### 4. Adotar o formato que ele pediu

> **fato → causa → impacto → recomendação → confiança → ação proposta**

É redação nos sete arquivos, não engenharia. E é metade do que o documento pede:
o que ele chama de "deixar de ser relatório e virar previsão".

### 5. Cortar o raciocínio interno da resposta

O que o CEO leu em 17/08:

> *"Deixa eu checar o schema"* · *"o operador `~~*` não funciona com enum"* ·
> *"minha query estava invertida"* · *"quem está falando comigo provavelmente não
> é do time comercial cadastrado"*

A resposta do `atlas` das 13:54 tem 2.363 caracteres e é quase toda monólogo
interno. O Bloco 1 reduz isso na origem — menos exploração, menos narração dela —
mas a instrução tem que estar escrita.

---

## Bloco 3 — Defeitos ✅ feito em 19/08

⚠️ **Os três eram nossos, e nenhum era o que parecia.**

**O item 6 estava com o diagnóstico errado desde segunda.** As respostas não
eram vazias: o `chat.history` do gateway mostra que os agentes responderam —
*"Bom dia! Sou a Nina, orquestradora…"* para o "ola", e 1.023 caracteres de
faturamento na `iris`. **Nós é que não gravamos.** A escrita em `conversations`
só acontece enquanto o navegador está perguntando em `/reply`; o Nicholson
mandou outra mensagem antes de a primeira voltar, e a resposta ficou órfã.

[`DECISAO-RECONCILIADOR.md`](DECISAO-RECONCILIADOR.md) previu este buraco com
precisão, prescreveu o conserto — "comparar o `chat.history` do gateway com o
que há em `conversations` ao abrir a conversa" — e definiu o sinal que reabriria
a decisão: *"resposta que some depois de fechar a aba, com uso real"*. É
exatamente o que aconteceu. Foi feito o que estava escrito:
`POST /conversations/{agente}/recuperar`, chamado pela tela ao abrir o chat.
Sem agendador, sem tabela nova, idempotente.

**Item 7 tinha uma causa que ninguém teria adivinhado.** `chat.history` com
`limit=1` **não devolve a mensagem mais nova**: na sessão do `atlas`, 52
mensagens numeradas de 1 a 52 sem buracos, e `limit=1` respondeu a de `seq=41`.
Com `limit=3` vieram 50, 51 e 52. Nas sessões curtas de `nina`, `iris` e `flow`
o `limit=1` acertava — por isso passou despercebido: **só aparece com histórico
longo**. O `_ultimo_seq` dizia 41, o `/reply` gravava tudo com `seq > 41`, e a
resposta saía com onze mensagens do turno anterior coladas na frente. A janela
passou para 5.

**Item 8 feito e conferido.** O `bruce` foi para `deepseek/deepseek-chat` e a
pergunta que ele existe para responder foi refeita: mesmos números de antes
(26 sem CPF, 27 sem senioridade, 3 sem cargo, 2 sem setor), em resposta mais
curta.

### Detalhe original

### 6. A `nina` responde vazio em mensagem curta ⚠️ o mais grave

Cinco de quinze mensagens do Nicholson não foram respondidas: "Qual o faturamento
deste mês", "O que você pode fazer", "ola", "Sin", "Stop".

Não é fila travada: o `usage_events` mostra que ela **rodou** e devolveu **2
tokens**. E o pior caso é encadeado — ela ofereceu acionar a `iris`, ele
respondeu **"Sin"**, e a ponte nunca aconteceu. A conversa entre agentes, feita
em 14/08, falhou no primeiro uso real.

### 7. O `atlas` repetiu a resposta anterior inteira

A mensagem das 13:59 começa com a resposta das 13:57 copiada palavra por palavra
e só depois continua. Metade dos 3.782 caracteres é repetição.

### 8. O `bruce` está num modelo 100× mais caro

| agente | modelo | execuções | tokens | custo |
|---|---|---|---|---|
| `bruce` | `anthropic/claude-sonnet-4-6` | 5 | 132.879 | **US$ 0,60** |
| `flow` | `deepseek/deepseek-chat` | 11 | 1.077.370 | US$ 0,077 |

Os outros quatro estão no DeepSeek. Decisão do Erick.

---

## Bloco 4 — O proativo (se o dia render)

### 9. Briefing por cron

O gateway já tem agendamento. Um agente rodando de manhã e escrevendo na base de
conhecimento entrega a primeira camada do documento — *"identifiquei N situações
que merecem atenção hoje"* — sem depender de tela nova.

⚠️ **Não fazer agora:** a Central de Comando e a cadeia de cinco agentes
(Iris → Bruce → Flow → Nina → Atlas). As duas dependem de os agentes acertarem
sozinhos e encadearem sem supervisão, e o item 6 mostra que ainda não é o caso.

---

## Bloco 5 — O que não temos, para não esquecer

O Nicholson pede coisas que dependem de dado que não existe em lugar nenhum. Não
é bloqueio do roadmap; é lista de compras.

| o que ele quer | por que não dá hoje |
|---|---|
| Custo por lead | Nenhuma base de marketing conectada |
| Como estão as campanhas | idem |
| Pipeline ponderado | O HSGrowth não tem probabilidade por etapa — precisa de régua definida por alguém |
| Chamados por lote/firmware do Phoebus | Exige rastreio de lote ligado ao cliente; não verificado |
| SLA e satisfação do cliente | HelpHS não está no ar, e não existe campo de satisfação |

## Notas relacionadas

- [`CONTINUAR-AQUI.md`](CONTINUAR-AQUI.md) — estado atual e armadilhas
- [`fotos_doc/`](fotos_doc/) — as dez imagens do documento de visão
