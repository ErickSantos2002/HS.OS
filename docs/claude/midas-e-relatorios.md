# Midas (CFO) e relatórios gerados por agente

> Saiu do `CLAUDE.md` em 23/11/2026 (o arquivo passou do teto de 150 mil caracteres
> de instruções do Claude Code). Texto movido sem edição. Leia antes de mexer na área.

### Midas — o CFO (18/11/2026)

Especialista financeiro do Nicholson, que **substitui a `iris`**. Spec
`docs/superpowers/specs/2026-11-18-cfo-midas-design.md`; plano ao lado, em `plans/`.
Herda da Iris faturamento, contas a receber, `compradores_produto` e `inadimplencia`;
ganha a pagar, custos (régua do Balancete), `calendario-financeiro` e GestorHS/HSGrowth
**como dado financeiro** (flow e atlas seguem donos de operação e vendas).

- ⚠️ **Quem recebe dado financeiro:** o Nicholson **e, nominalmente, o Erick Santos**
  (`ti@healthsafetytech.com`, `administrador`; quem configura e confere o Midas) — conferido
  pelo diretório, por nome e e-mail, **não** "qualquer administrador". Qualquer outra pessoa:
  recusa + `avisar_administrador`. Trava em `test_midas_arquivos.py`.
- ⚠️ **Repositório público: sem valor absoluto da empresa** nas skills e docs (dívida, a
  pagar, parcelas). O arquivo traz a régua e a consulta; o agente mede na hora.
- **Código:** `app/agentes/midas.py` (os sete arquivos, com `TOOLS.md`),
  `app/agentes/midas_escopo.py` (`tools_do_midas`, `escopo_final`, `midas_esta_fechado`,
  `decidir_criacao`), `backend/scripts/criar-midas.py` (**ensaio por padrão**; ordem:
  criar → arquivos → patch conferido → `agentToAgent` → INSERT em `agent_profiles` →
  roster) e `PROPRIO["midas"]` no `escopo-mcp.py`.
- **DataCore:** `datacore.chamar_como_financeiro` (`AGENTE_FINANCEIRO="midas"`,
  `EMAIL_DO_FINANCEIRO_NO_DATACORE`) — o Midas lê como o Nicholson, igual a Iris.
- **Resultado mensal ainda não existe:** `gold.dre_mensal` não foi construído; o Midas diz
  que não tem resultado do mês. Prompt para a sessão do DataCore em
  `docs/superpowers/specs/2026-11-18-cfo-midas-datacore-prompt.md`.
- **Varredura tipo `financeiro`** (migração `040`): **todo dia útil** às 08:00 (era
  semanal até 19/11/2026 — o Nicholson pediu diário, na conversa, sem documento),
  limite 11:00, uma por pessoa em `allowed_user_ids` do `midas` (o Nicholson e o Erick,
  que recebe a própria cópia para conferir). No 1º dia útil da semana a mensagem
  acrescenta o `calendario-financeiro`. Cabeçalho `[Situação financeira — <nome>]`.
  ⚠️ **A `040` precisa estar aplicada ANTES do deploy**; a semeadura roda em savepoint,
  então código antes da migração não derruba a varredura dos Guardis.
- ⚠️ **`publicar_link` saiu de `compradores_produto` e `inadimplencia` para TODOS** (não só
  o Midas): a lista nominal de devedores e a folha não vão para página pública. O Midas não
  tem `publicar_pagina`; planilha vai para Documentos.
- ⚠️ **`escopo-mcp.py` não descreve o escopo real da Iris** (`PROPRIO["iris"]` só tem o banco;
  as duas ferramentas de relatório foram dadas à mão). Herdar a Iris é ler o `config.get`.
- ⚠️ **Skills não têm filtro por agente:** o Midas enxerga todas; o que o contém são os
  ponteiros do `AGENTS.md` e o escopo de dados.
- ⚠️ **O bloco `hsos:empresa` da Iris está vazio**, então o Midas nasce sem perfil da empresa:
  rodar `POST /onboarding-empresa` depois de criá-lo.
- **Skills:** `contas-receber` (âncora nova de 18/11; parcelas do Itaú em linha própria),
  `custos` (R1, R3, R4, tipo do número), `calendario-financeiro` (nova). Toda resposta
  com número diz se é *medido*, *provisório* ou *incompleto*.
- **No ar desde 19/11/2026; a Iris DORME.** Conferido perguntando ao Midas (pela conta
  do Erick, liberado nominalmente). As tabelas "quem é quem" de Nina, Flow, Atlas e
  Bruce apontam para o Midas. O cron `hsos-briefing-faturamento` passou para o
  `midas` **desligado, como já estava** — religar é decisão do Erick. A Iris saiu do
  `agents.list` e do `agentToAgent.allow`, sessões arquivadas, `status='inactive'`;
  workspace e linha no banco ficam. **Backup da entrada dela fora do repo** (traz os
  ids dos Guardis): `~/projetos/backups-hs/gateway/iris-agents-list-2026-11-19.json`.
  Religar: devolver o JSON ao `agents.list` (lista inteira), `iris` no `allow`,
  `status='active'`. Script: `backend/scripts/dormir-iris.py`.
- ⚠️ **O gateway mescla o `agents.list` POR ID: mandar a lista sem um agente NÃO o
  remove**, e como não há recusa o `aplicar_patch` não repete com `replacePaths`. Para
  tirar agente, mande `replacePaths: ["agents.list"]` explícito e confira relendo.
  Em 19/11/2026 o `allow` mudou e a Iris ficou na config até o segundo patch.
- ⚠️ **Conta de cabeça é o defeito do Midas.** Na conferência ele somou grupos de
  custo à mão e inverteu a projeção do trimestre. Correção que funcionou: **consulta
  pronta na skill** que devolve o total/veredito (`custos`: totais do mês;
  `faturamento`: "Ritmo e projeção" com `veredito`). Só a regra no `SOUL.md` não
  bastou. Pergunta nova com conta: dê a ele a consulta, não a instrução.

### Relatório gerado por agente

`hsos-relatorios` é o terceiro servidor MCP nosso, ao lado do `hsos-alerta` e do
`hsos-documentos`, e serve **só ao `atlas`**: `relatorio_vendedores` monta a
planilha de vendedores do HSGrowth e a guarda em Documentos, no nome de quem
pediu.

⚠️ **A régua é cópia fiel de `~/projetos/relatorios-hsgrowth/vendedores.py`.**
`backend/app/relatorios/vendedores.py` mudou duas coisas e só: a conexão sai do
conector cadastrado em `integrations` (o módulo `bancos` só existe na máquina do
Erick) e `gerar()` devolve bytes. **Régua muda lá primeiro** — senão o número do
agente e o do Erick divergem em silêncio.

⚠️ **O arquivo vai para bucket PRIVADO** (`generated-documents/<usuário>/`), com
registro em `generated_documents` — o mesmo caminho de PDF e DOCX. Não há link
público de propósito: a planilha traz card a card com nome de cliente, valor e
link do CRM.

⚠️ **O período era `sys.argv`.** Virou parâmetro, e os SQL de módulo carregam um
marcador `__DIAS__` trocado em tempo de execução — as f-strings deles já foram
avaliadas com as outras constantes, e trocar por `%s` exigiria mexer na régua.

⚠️ **A `publicar_pagina` do mesmo router é o caminho OPOSTO, e isso é fácil de
esquecer.** Ela grava `is_public = true` em `artifacts_published`, e
`GET /artefatos/publicados/{id}` **não exige autenticação** — o que protege é o
UUID não ser adivinhável. É deliberado: os vendedores não têm login no HS.OS
(só três pessoas têm), então Documentos não os alcançaria.

O que existe contra o vazamento é o `dias_de_validade`, **opcional**. Em
08/09/2026 a `nina` publicou **sete** páginas num dia — entre elas a lista
nominal dos 35 clientes que uma vendedora perdeu, com nome de contato e valor —
e **nenhuma** com validade. A regra estava escrita no docstring de
`_publicar_pagina`, que o agente não lê; foi movida para a `description` do
parâmetro, que ele lê. ⚠️ **Regra que o agente precisa seguir mora na
`description` da ferramenta, não no comentário do código.**

⚠️ **Lista longa não se escreve com o modelo: `compradores_produto`.** Em
30/09/2026 a lista de 137 compradores de Phoebus que o CEO pediu fez a `iris`
bater no teto de saída (8.192 tokens) e o turno inteiro ser descartado, três
vezes — e a `nina` diagnosticou "contexto estourado" e pediu reset, que não
resolveria. Quando a `iris` conseguiu, publicou a página escrevendo o HTML ela
mesma: somava o bruto (768) sob o título "757 líquidas". A ferramenta
(`app/relatorios/compradores.py`, só na `iris`) aplica a régua da skill
`faturamento`, guarda a planilha em Documentos e, com `publicar_link`, monta a
página **no servidor**, dos mesmos números. O modelo só recebe totais e top 10.

⚠️ **O teto de 8.192 tokens de saída vem de dentro do OpenClaw, e a causa não foi
achada.** A API da DeepSeek entrega mais (testado: 16.000 com `deepseek-chat`);
config e `models.json` dos cinco agentes dizem 32.768; o log continua mostrando
`output: 8192`. Qualquer resposta muito longa ainda corta — lista, sai por
ferramenta.

⚠️ **"Bruto cheio − devoluções" é o método errado, e a âncora de um ano só o
aprovou.** A `iris` reincluiu as vendas que a régua tirou por recusa e subtraiu
as devoluções delas: 230 Phoebus em 2025 (certo: 217) e "faltam 95" (certo: 83).
2024 bateu por coincidência em 194 e ela usou isso como prova. A skill hoje traz
âncora líquida nos três anos (194 · 217 · 134) e a regra: devolução só abate
quando a nota de origem, citada nas `observacoes`, ainda conta na régua.

✅ **Desde 01/10/2026 a régua de venda é a do DataCoreHS: `gold.fato_vendas`**
(o dbt de `~/github/DataCore/analytics`), na ferramenta e na skill. Antes, as
duas remontavam a régua lendo `CFOP_VALIDOS` e `MARCADORES_INVALIDOS` de
`tiny.configuracoes` — chaves que o DataCore aposentou. Rodadas lado a lado, as
três âncoras de Phoebus bateram **por outro caminho** (as vendas 005725 e 004743
saem pelo marcador de rejeição em vez de serem abatidas), e na base inteira a
régua antiga contava 27 notas que não são venda e perdia 13 que são. O
cabeçalho de `compradores.py` tem a conta. **Não reintroduza filtro de CFOP ou
marcador do lado de cá**: duas réguas foi o que fez o faturamento divergir por
anos. ⚠️ O fato é recalculado às 05:00 — nota de hoje entra amanhã.


### A situação das 8h começa em sessão limpa — 23/11/2026

⚠️ O resumo das 8h ao Erick abriu com o alerta de caixa de **19/11** (R$ 284.391,
"semana de 16 a 22/11"): o Midas não rodou a consulta de `alertas-financeiros` —
copiou o número que estava três vezes no histórico da sessão — e perdeu o alerta
do dia (Mineração Caraíba). A instrução já mandava rodar primeiro. O conserto não é
texto: `disparar_varredura` faz `sessions.delete` da sessão do Midas com a pessoa
**antes** do turno `financeiro` (`zerar_sessao`, sem `conversation_resets` — a tela
não muda), depois do teste de turno aberto. O OpenClaw não tem reset por agente
(`session.reset*` é global, por tipo ou por canal — conferido na doc em 23/11).
Custo aceito: o Midas não lembra a conversa da véspera; perguntas do mesmo dia têm
contexto. **Número de painel diário em sessão longa é número velho esperando para
ser copiado.**
