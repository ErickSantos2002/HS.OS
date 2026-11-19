# Midas — o CFO de IA da Health & Safety

**Data:** 18/11/2026 · **Pedido:** Nicholson · **Decisões:** Erick, nesta conversa
**Estado:** desenho aprovado em partes na conversa; este documento junta tudo.

## Por que existe

O Nicholson quer um CFO: alguém a quem perguntar como está a empresa — quanto
entrou, quanto saiu, o que vence, onde está o dinheiro preso, quanto sobra — sem
abrir painel. O Financeiro perde o seu operador em 19/11/2026 (Djalma), e o que
ele sabia ficou escrito em `~/Documentos/Djalma-Cerebro/` (16 rotinas FIN-01 a
FIN-16, calendário, mapa de dependências, pendências).

O Midas é um **especialista** como Nina, Iris, Atlas, Flow e Bruce: agente do
Nicholson, não um Guardi.

## Decisões já tomadas (do Erick)

1. **Agente novo, `midas`, que substitui a `iris`.** A Iris é "posta para
   dormir": desativada, workspace e histórico preservados, não apagada. O
   Nicholson tinha imaginado o CFO consultando a Iris; o Erick decidiu que, se o
   CFO faz, a Iris sobra. **Dois agentes no mesmo banco divergem de régua** e
   deixam a Nina sem saber a quem rotear.
2. **v1 = leitura + produção.** Responde, gera planilha/relatório em Documentos,
   faz briefing ao Nicholson e lembra o calendário financeiro. **Nada escreve
   fora do HS.OS** — nem Tiny, nem banco, nem Getnet. Escrita por cartão fica
   para depois (o Financeiro está sem dono e as rotinas FIN têm pendências
   fiscais abertas).
3. **Acesso:** DataCore, GestorHS, HSGrowth (Vendas e Serviços). Só leitura.
4. **Sem API direta do Tiny.** O token do Tiny não tem modo só leitura e um
   segundo caminho até o Tiny seria uma segunda régua. O que faltar do Tiny entra
   pelo extrator do DataCore.
5. **A régua do resultado mensal (DRE) mora no DataCore, como tabela `gold`
   (dbt)** — opção C. O sistema de origem é a autoridade; o painel do DataCore
   pode mostrar o mesmo número depois.

## Objetivos

- Responder com o número da régua: faturamento (vendas + serviços), meta do
  trimestre, contas a receber e inadimplência, contas a pagar, agenda de caixa
  (o que entra e sai nas próximas semanas), custo do mês (régua do Balancete),
  estoque e preço de custo, receita prevista (OS a faturar, propostas, funil).
- **Resultado mensal por competência** (etapa 2, depois do `gold` do DataCore).
- Dizer sempre **de que tipo** é o número: medido, provisório ou incompleto.
- Entregar listas e planilhas por ferramenta, nunca escritas pelo modelo.
- Avisar o Nicholson do que vence no calendário financeiro.

## Fora do escopo (v1)

- Qualquer escrita em sistema externo, inclusive por cartão.
- API do Tiny; extrato bancário, saldo em conta, Getnet, Open Finance.
- Comissão de vendas e de serviços (há divergência entre o FIN-09/10 e a
  calculadora do DataCore; o Erick deixou para depois).
- Custo da mercadoria vendida por unidade (ver "Custo de mercadoria" abaixo).
- Gráficos no chat (bloco ```chart da DN.OS) — pendência separada, depois do
  Midas.

## Anti-objetivos — falha mesmo funcionando

- **Número sem régua.** Se a resposta muda conforme o modelo monta o SQL, o
  Midas falhou (é o caso dos R$ 654 mil × R$ 441 mil da Iris em 14/08).
- **Custo parcial apresentado como total.** O Tiny tem o salário **líquido**, não
  o custo da folha; os dois últimos meses estão incompletos. Esconder isso é pior
  que não responder.
- **Dado financeiro em link público.** Dividendos, salários e dívida não vão para
  `publicar_pagina`.
- **Aparecer para outra pessoa.** Só o Nicholson; o Midas entrega dado também ao Erick Santos (administrador, por nome e e-mail do diretório) para conferência.
- **Patrulhar.** Bloqueio de terceiro se relata (`avisar_administrador`), não se
  vigia (os 560 crons da `nina` em 25/08).

## O que o dado permite — levantado em 18/11/2026

`tiny.contas_pagar` (milhares de linhas; centenas em aberto até 2031):

- **Plano de contas numerado com 82 categorias** — 1 pessoal, 2 ocupação,
  3 serviços de terceiros, 4 materiais, 5 dividendos, 6 importação/custo,
  7 impostos sobre venda, 8 impostos sobre lucro e taxas, 9 financeiro, 10 outros.
- `competencia` preenchida em 99%; `liquidacao` em toda conta paga.
- As contas recorrentes do FIN-11 aparecem, **inclusive as pagas pelo
  Nicholson** (aluguel DRCM, advocacia, Leão, leads, dividendos).

Ressalvas que viram regra:

| # | Achado | Tratamento |
|---|---|---|
| R1 | Parcelas mensais ao **Itaú em "9.3 - Tarifas Bancárias"**, histórico "Parcela N/44", parcelas até 2030 (a maior parte do a pagar em aberto). Parece empréstimo, não tarifa. | Reclassificar para dívida (amortização) **como classificação provisória e nomeada** até alguém do Financeiro confirmar. |
| R2 | Conta a pagar lançada **já paga e com emissão retroativa**, 30–60 dias depois (nota do vault *Contas a pagar lançadas com emissão retroativa*). | Os dois últimos meses de competência são **provisórios**, sempre ditos. |
| R3 | Fatura do cartão (9.1) só aparece de set/2026 em diante. | Meses sem a fatura são **incompletos** em despesa. |
| R4 | "1.3 - Salário" é o líquido; a folha cheia é fechada pela Eviane, fora do Tiny. | Pessoal é **parcial** — a resposta diz isso. |
| R5 | Categorias duplicadas no Tiny: "1.9.5 - Comissão" e "3.9.3 - Ouvidoria" (dois nomes quase iguais cada). | O mapeamento junta. |
| R6 | Importação entra em blocos (um mês concentra o pagamento). | Fora do resultado operacional do mês; linha própria. |
| R7 | Dividendos (5.x) em blocos. | Abaixo do resultado, não é despesa. |
| R8 | Um lote de 226 contas a pagar foi marcado `excluida_na_origem_em` em 05/09/2026. | Filtro obrigatório (já na skill `contas-receber`). |

Balancete/DRE da contabilidade (Isis Cruz, Sugere): **não encontrado** em lugar
que alcançamos. Se aparecer, ele vira a âncora de conferência do DRE.

### A régua de custo que já existe — e manda

O DataCoreHS tem a aba **Gerenciamento Financeiro → Balancete**, e a skill
`custos` (`backend/skills/custos/SKILL.md`) já a reproduz: `excluida_na_origem_em
IS NULL`, **mês pela `data_emissao`**, sem filtro de situação, soma `valor`, grupo
= número que abre a categoria, âncora em jul/2026 (R$ 462.917,93 sem impostos).
**O Balancete é a autoridade de custo** (o sistema de origem manda). Por isso:

- **Na etapa 1, custo é o do Balancete**, pela skill `custos`, que ganha as
  ressalvas R1, R3 e R4. Não nasce skill `custo-e-margem`.
- **O `gold.dre_mensal` usa a mesma régua de data do Balancete (emissão)**, e a
  receita a mesma do faturamento (`fato_vendas` por emissão, `fato_servicos` pela
  régua de serviços). Um DRE por competência ao lado do Balancete por emissão
  seriam dois "custos de outubro". *(Decisão minha, pela regra do CLAUDE.md:
  "o número do painel manda".)* A R2 continua valendo: o lançamento retroativo
  usa a emissão original, então o mês recente também cresce depois.
- O `gold.fato_contas_pagar` guarda as quatro datas; quem quiser competência um
  dia tem o dado, mas o DRE desta entrega é por emissão.
- **Margem por produto sai da v1.** O custo unitário dos carros-chefe é conta da
  tela Centro de Custo, não do banco; o Midas responde estoque e preço de custo
  pela `gold.dim_produto`, como a skill `custos` já manda, e diz que margem
  fechada é da tela do DataCore.

## Abordagens consideradas para a régua do DRE

| | Onde | Troca | |
|---|---|---|---|
| A | Skill do Midas, ele monta o SQL | rápido; número depende do modelo seguir a skill | descartada |
| B | Ferramenta Python no `hsos-relatorios` | determinístico e testado; régua no HS.OS, segunda régua se o painel um dia mostrar DRE | descartada |
| **C** | **`gold` no DataCore (dbt)** | uma régua só, painel pode reusar; depende de trabalho no repo DataCore | **escolhida** |

## Desenho

### Etapas

1. **Midas nasce herdando a Iris** (só HS.OS + gateway). Responde tudo menos o
   resultado mensal: faturamento, meta, a receber, inadimplência, a pagar, agenda
   de caixa, custo do mês (régua do Balancete, com R1–R4 ditas), estoque e preço de
   custo, receita prevista.
2. **DataCore entrega o `gold` de contas a pagar e o DRE** (sessão no repo
   DataCore, a partir da seção "Para o DataCore"). O Midas ganha a skill do
   resultado mensal com âncora.
3. **Iris dorme** — só depois de o Midas passar na conferência por perguntas
   (ver "Conferência").

A etapa 3 não espera a 2: a Iris pode dormir assim que o Midas cobrir o que ela
cobria.

### O agente

- `agent_id`: **`midas`**; nome **Midas**; workspace
  `/root/.openclaw/workspace-midas`; `allowed_user_ids` = só o Nicholson; modelo
  igual ao dos outros especialistas (DeepSeek, risco LGPD já aceito).
- Voz: `pt-BR-AntonioNeural` (decisão do builder se houver outra voz masculina
  pt-BR no edge-tts).
- **Os sete arquivos são escritos à mão** (não pela orquestradora), a partir dos
  da Iris: o `SOUL.md` mantém as seções de régua ("Não afirmo o que não sei —
  nem número, nem fato") e ganha a do tipo de número; o `AGENTS.md` traz os
  ponteiros de skill (uma linha cada: "pergunta sobre X começa abrindo a skill
  Y"). **Medir contra o teto de 20.000 caracteres antes de gravar.**
- **Toda resposta com número diz o tipo:** *medido* (régua conferida, mês
  fechado), *provisório* (R2) ou *incompleto* (R3, R4). Regra no `SOUL.md`.
- Perfil de ferramentas e denies iguais aos da Iris: `sessions_send`,
  `sessions_spawn`, `skill_workshop`, `cron` negados; `web_fetch`, `x_search` e
  `web_search` negados.

### Escopo de dados (`scripts/escopo-mcp.py`, `PROPRIO["midas"]`)

- `banco-datacorehs__query` (o da Iris)
- `banco-gestorhs__query` (OS a faturar, propostas)
- `banco-hsgrowth__query` (funil de Vendas e de Serviços)
- `hsos-relatorios__compradores_produto` e `hsos-relatorios__inadimplencia`
  (herdadas da Iris)

⚠️ **O `escopo-mcp.py` não descreve o escopo real da Iris:** `PROPRIO["iris"]`
tem só o banco; `compradores_produto` e `inadimplencia` foram dadas à mão (spec de
10/11). **Herdar a Iris é ler o `config.get`** (o `alsoAllow` dela e o
`toolFilter.include` do `hsos-relatorios`), não o script. O script passa a ter
`PROPRIO["midas"]` completo, com as duas ferramentas, para não as tirar na
próxima execução.
- `COMUM` **menos `hsos-relatorios__publicar_pagina`** — ver "Saída".

⚠️ O `flow` e o `atlas` continuam donos de operação e de vendas. O Midas lê
GestorHS e HSGrowth **como dado financeiro** (o que vai virar receita e quando),
não para responder sobre gargalo de OS ou desempenho de vendedor. As linhas
"não é dele" do roster precisam dizer isso nos dois sentidos.

### Skills

| skill | estado | uso |
|---|---|---|
| `faturamento` | existe (Iris) | faturamento, meta, vendedor, produto, compradores |
| `contas-receber` | existe (Iris) | a receber, a pagar, vencido, agenda de caixa — **ganhar R1 e R2 para o lado a pagar e trocar a âncora de 09/09** (poucos títulos): hoje o em aberto é muito maior, quase tudo parcela futura do Itaú, e a skill como está faria o Midas tratar o número certo como erro. **As parcelas do Itaú entram na agenda de caixa** (são saída de dinheiro), **em linha própria** "parcelas de empréstimo — classificação a confirmar". *(Decisão minha.)* |
| `funil-vendas`, `funil-servicos`, `pipeline-crm` | existem (Atlas) | receita prevista — o Midas aponta para elas, não as copia |
| `calendario-financeiro` | **nova** | datas do Financeiro (FIN-11 dia a dia, dia 05: certidões, contabilidade, APERAM; salário no último dia útil; descontos à Eviane ~5 dias antes). **Sem senhas, sem lista nominal da folha (FIN-12), sem e-mail pessoal.** |
| `resultado-mensal` | **nova, etapa 2** | lê `gold.dre_mensal`; diz o que é provisório e incompleto; âncora de conferência |
| `custos` | existe | custo do mês pela régua do Balancete, estoque e preço de custo — **ganhar R1, R3 e R4** |

Todas publicadas por `bash scripts/publicar-skills.sh --enviar`; a conferência é
a resposta do agente, não o `skills.status`.

### Saída

- **Lista e planilha por ferramenta**, nunca escritas pelo modelo (teto de 8.192
  tokens de saída; caso dos 137 compradores).
- **Documentos (bucket privado) é o destino padrão.** O Midas **não tem
  `publicar_pagina`**: contas a pagar trazem salário por pessoa, dividendos e
  dívida.
- ⚠️ **`compradores_produto` e `inadimplencia` têm, cada uma, o parâmetro
  `publicar_link`** (`routers/relatorios.py`), que monta página pública — a da
  inadimplência com a lista nominal de devedores e valor. **Para o Midas o
  servidor recusa `publicar_link`** (e o parâmetro sai do schema que ele vê);
  a planilha vai para Documentos. *(Decisão minha, pelo anti-objetivo.)*
- Ferramenta nova de planilha financeira (ex.: agenda de caixa em xlsx) só se a
  primeira semana de uso mostrar a necessidade; até lá, `enviar_arquivo` com CSV.

### Briefings

- **Faturamento diário (07h35):** o cron `hsos-briefing-*` da Iris passa a ser do
  Midas, com o mesmo conteúdo e o mesmo destino de hoje (o `guardiao_briefings`
  continua conferindo o documento).
- **Semana financeira (segunda, 08h):** agenda de caixa da semana (vence a pagar,
  vence a receber), vencidos novos, o que o calendário financeiro marca para a
  semana, faturamento do mês contra a meta. **Vai na conversa do Nicholson com o
  Midas, NÃO na Base de Conhecimento** — a wiki é legível por todos. Mecanismo:
  `disparar_turno` (`routers/conversations.py`), que é genérico (`agent_id`,
  `user_id`) e é a porta única do trabalho autônomo. O que **não** sai de graça é
  o agendamento: o quadro da Nina depende da tabela `varreduras`, do `semear` de
  dia útil e de SQL com `'nina'` fixo. O briefing semanal precisa de um tipo e de
  uma semeadura próprios **dentro da `passada` do `disparador_lembretes`**, com a
  mesma reserva por carimbo e o mesmo adiamento por run aberto — sem laço novo.

### Inadimplência como o Nicholson

`chamar_como_iris` (`backend/app/sistemas/datacore.py`) passa a ser
`chamar_como_agente(agente, …)` ou é renomeado para o Midas; o e-mail continua o
do Nicholson (`np@`, decisão de 10/11/2026). O id `iris` também está fixo em
`routers/relatorios.py` (o `INSERT` em `generated_documents` e a chamada de
`_compradores_e_guardar`) e nas mensagens de erro de `datacore.py` ("o acesso da
Iris"). Mesma ressalva de lá: quem pergunta
ao Midas não é identificado — só o Nicholson fala com ele.

### Nina e os outros

- Roster da Nina (`hsos:roster`): sai a Iris, entra o Midas com a frase
  nominal do que é dele (faturamento, a pagar, a receber, inadimplência, caixa,
  custo, margem, resultado). **Medir: o `AGENTS.md` da Nina vive a ~500
  caracteres do teto.**
- `tools.agentToAgent.allow`: troca `iris` por `midas`.
- Linhas "não é dele" de Flow e Atlas: OS e funil continuam deles; o Midas lê
  como previsão de receita.
- `backend/scripts/atualizar-time.py`: o bloco `hsos:time` lista os
  especialistas — regenerar.

### Pôr a Iris para dormir

Na ordem, e só depois da conferência do Midas:

**Dormir = fora da config do gateway, com tudo guardado para religar.**
*(Decisão minha.)* Deixá-la no `agents.list` não serve: o
`publicar-anexos-mcp.py` cobre todo agente da config e devolveria a ela a
`hsos-anexos-iris` a cada execução; o `escopo-mcp.py` pula quem não está em
`PROPRIO` e deixaria o `tools` dela como está; e o `hsos-alerta` nunca é negado.

1. Cron do briefing passa para o Midas (`cron.update` com o `agentId` novo, ou
   remove e recria — reler depois).
2. Sai do roster da Nina e do `agentToAgent.allow`.
3. Arquivar `agent:iris:main` e as sessões dela (`sessions.delete` arquiva).
4. **Guardar o JSON dela** (a entrada do `agents.list` da config, com `tools`)
   num arquivo versionado de operação, e **tirá-la do `agents.list`** por
   `config.patch` (lista inteira; conferir que os outros sobreviveram). O
   workspace `/root/.openclaw/workspace-iris` e o SQLite dela ficam no disco.
5. `agent_profiles.status = 'inactive'` (já tira o agente das telas).
6. **Não** apagar a linha em `agent_profiles` nem o workspace. Religar = devolver
   o JSON ao `agents.list` e voltar o status.
7. Avisar o Nicholson: quem responde o que a Iris respondia agora é o Midas.

### Custo de mercadoria (registro, não escopo)

O resultado operacional honesto precisa do custo da mercadoria **vendida** no mês
(unidades × custo unitário do `centro_custo_config`), não do pagamento da
importação. Na etapa 2 o DRE mostra a importação como linha própria fora do
resultado operacional e o Midas diz que a margem do mês é sem CMV; CMV por
unidade é a etapa seguinte, no DataCore.

## Para o DataCore (repo `~/github/DataCore`, sessão de lá)

Seguir o padrão de `analytics/models/gold/fato_contas_receber.sql` (grão, três
datas, nada que dependa de "hoje" dentro do fato).

1. `silver.stg_contas_pagar` — de `tiny.contas_pagar`, sem
   `excluida_na_origem_em`, situação normalizada (`aberto`/`pendente` = aberto,
   `pago` = quitado, `cancelada` fora dos dois).
2. **Seed `categoria_dre.csv`**: `categoria` (texto exato do Tiny) → `linha_dre`,
   `grupo`, `natureza` (`operacional`, `imposto_venda`, `imposto_lucro`,
   `financeiro`, `divida`, `dividendo`, `importacao`, `investimento`). As
   duplicatas (R5) apontam para a mesma linha. **Toda categoria do Tiny tem
   linha** — teste dbt que quebra com categoria sem mapeamento (categoria nova no
   Tiny não pode sumir do DRE em silêncio).
3. **Seed `excecoes_contas_pagar.csv`**: reclassificação por (`cliente_nome`,
   `categoria`, padrão de `historico`) → `linha_dre`, com coluna `motivo` e
   `confirmado` (sim/não). Primeira linha: Itaú em 9.3 com "Parcela" → dívida,
   `confirmado = não` (R1).
4. `gold.fato_contas_pagar` — grão a conta; emissão, vencimento, competência,
   liquidação (todas para `dim_tempo`); `linha_dre`, `natureza`,
   `reclassificada` e `reclassificacao_confirmada`.
5. `gold.dre_mensal` — por mês de **emissão**, a mesma data do Balancete (ver
   "A régua de custo que já existe"): receita bruta (`fato_vendas` +
   `fato_servicos`, a régua que já existe), impostos sobre venda, despesas por
   grupo, resultado operacional, financeiro e dívida, impostos sobre lucro,
   resultado, e abaixo: importação e dividendos. Colunas de qualidade:
   `tem_fatura_cartao` (R3). **Nada de "provisório" dentro do fato** — isso
   depende de hoje e é dito na consulta (R2).
6. Âncora: o total de despesa de jul/2026 no `dre_mensal` tem que bater com o
   Balancete da tela (R$ 462.917,93 sem impostos, grupos 7 e 8 fora); e conferir
   à mão, no Tiny, as linhas de um mês fechado (e contra o balancete da
   contabilidade, se aparecer). O Balancete da tela pode passar a ler o `gold`
   depois — não nesta entrega. A âncora tem que exercitar o
   mapeamento — conferir só a soma passa igual com categoria na linha errada.

Quem lê: o usuário de leitura (já lê `tiny.contas_pagar` hoje). O painel não
precisa mostrar nada nesta entrega.

## Conferência (antes da Iris dormir)

Perguntar ao Midas, sem citar a resposta na pergunta:

- que ferramentas ele tem (esperado: os três bancos, `compradores_produto`,
  `inadimplencia`, documentos, diretório, alerta, anexos; **sem**
  `publicar_pagina`, `web_*`, `sessions_*`, `cron`);
- faturamento do trimestre — tem que bater com o painel do DataCore;
- vencido em aberto a receber — tem que bater com o painel (régua de 08/09);
- quanto vence a pagar na próxima semana — conferir no banco;
- custo de outubro — tem que dizer que é **provisório** e que pessoal é
  **parcial**;
- o que vence no dia 05 — tem que vir do `calendario-financeiro`.

## Deixado para o builder

- Mecânica de criação (rota existente + gravação dos sete arquivos, ou script
  próprio idempotente como o dos Guardis).
- Nome final de `chamar_como_*` e onde o id do agente deixa de ser fixo.
- Ajuste do `disparar_turno` para especialista, se precisar.
- Ordem dos commits e o changelog (`frontend/src/data/changelog.ts`, obrigatório:
  "o Midas substitui a Iris").
