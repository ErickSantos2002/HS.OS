# Relatório de ponto (Flash) no `bruce` — design

**Data:** 2026-10-13 · **Escopo:** `backend/` (régua, ferramenta MCP, skill) e o
`AGENTS.md` do `bruce` no gateway.

## Objetivo

A coordenadora de RH monta todo mês, à mão, uma planilha de controle de jornada a
partir de dois CSV exportados do **Flash** (sistema de ponto externo) e manda o
resumo ao CEO. O objetivo é que ela anexe os dois CSV na conversa com o `bruce` e
receba de volta a planilha pronta — os números que ela usa e o relatório para o
CEO — calculada por código, não escrita pelo modelo.

**Sucesso =** com os CSV de setembro/2026, a ferramenta reproduz a planilha que
ela fez à mão nos pontos em que a régua é regra (ver *Conferência*), e entrega um
xlsx em que somar uma coluna no Excel funciona.

A régua começa como está aqui e evolui pelas conversas dela com o `bruce`, como
foi feito com o CEO. **A régua é dela, não nossa:** mudou na conversa, muda aqui.

## Fora do escopo

- **A coluna "Tratativa".** É a única que ela escreve à mão; sai em branco.
- **O julgamento caso a caso da contagem analisada.** Ela descarta ocorrências
  olhando dia a dia (no "após jornada" de uma pessoa, 10 marcadas e 5
  confirmadas). Não há regra que reproduza isso — testado por horário e por tempo
  trabalhado. A ferramenta entrega a contagem pela régua e a lista de ocorrências
  para ela confirmar.
- **"Solicitações de jornada" e a "Matriz de aprovação".** São abas de cadastro
  manual, sem relação com o CSV.
- **Ler o Flash direto.** A entrada continua sendo o export dela.

## Como a régua foi levantada

Das planilhas de setembro/2026 que ela mandou (dois CSV + o xlsx ajustado de 8
abas) e das respostas dela por WhatsApp em 13/10/2026:

- A aba "Lista de Marcações" é o CSV de marcações **colado sem alteração**
  (476 linhas, conferido célula a célula); "Saldos-Banco de Horas" é o CSV de
  banco de horas.
- O "Controle Principal" é calculado por fórmula sobre a lista. Recalculado do
  bruto, **149 de 150** células batem; a outra foi digitada por cima da fórmula,
  e ela confirmou que só a Tratativa é editável.
- A aba "Dados e-mail" ("ocorrências analisadas") parte do Controle Principal com
  a régua tolerante e correções na mão. A régua tolerante reproduz **128 de 150**
  células; das 22 restantes, 8 ela não revisou (ficou o número do Controle
  Principal) e 14 são julgamento.
- Os 97 ajustes do "Histórico Detalhado" são exatamente as batidas `Justificada`
  do CSV, e a regra "motivo de trabalho não conta" reproduz a coluna "Conta no
  indicador?" em **97 de 97** e a coluna AJUSTES do Controle Principal em
  **25 de 25**.

## Entrada

Dois CSV do Flash, `;` como separador, UTF-8 com BOM:

| arquivo | colunas usadas |
|---|---|
| `MarcacoesOriginaisJustificadas_*` | `Nome`, `Matrícula`, `Departamento`, `Data da Marcação`, e para N = 1..6: `Tipo Marcação N`, `Motivo Marcação N`, `Justificativa N`, `Hora da Marcação N` |
| `BancoHoras_*` | `Nome`, `Matrícula`, `Cargo`, `Nome Departamento`, `Nome Gestor`, `Saldo banco anterior`, `Saldo banco no periodo`, `Saldo banco total` |

Qual é qual se decide **pelo cabeçalho**, não pelo nome do arquivo. Saldo vem
como `HH:MM` ou `(-HH:MM)` para negativo; vira minutos com sinal.

A pessoa é casada entre os dois arquivos pela **matrícula sem zeros à esquerda**
(`000054` = `54`, `0072` = `72`): em setembro, 4 das 25 pessoas têm o nome
escrito diferente nos dois arquivos, e o CEO aparece no banco de horas com
matrícula `-`. Sem matrícula, cai no nome. Quem está no banco de horas sem marcação no mês (o CEO)
**fica de fora** do controle, como na planilha dela (25 monitorados).

## A régua

### Por dia (uma linha do CSV de marcações)

As batidas são as `Hora da Marcação N` preenchidas, na ordem.

- **Entrada** = 1ª batida.
- **Intervalo** = 3ª − 2ª, se houver 3 batidas.
- **Saída** = **última** batida, se houver 4 ou mais. *(Confirmado por ela: a
  planilha pegava sempre a 4ª, o que erra nos dias de 6 batidas; ela corrigia à
  mão.)* Dia com 2 batidas não tem intervalo nem saída avaliados.

Duas contagens, com os mesmos indicadores:

| indicador | originais | analisadas |
|---|---|---|
| entrada antecipada | entrada < 07:29 | entrada ≤ 07:19 |
| atraso | entrada ≥ 07:46 | entrada ≥ 07:50 |
| intervalo < 1h | intervalo < 60 min | igual |
| intervalo > 1h | intervalo > 60 min | igual |
| saída antecipada | saída < 16:59 | saída ≤ 16:48 |
| após jornada | saída > 17:01 | saída ≥ 17:20 |

As originais são as fórmulas da planilha dela; as analisadas, a régua que ela
declarou ("7h19, atraso a partir de 7h50, antecipada até 16h49 e extra a partir
de 17h20"). **Saída antecipada às 16:49 não conta** nas analisadas: é o que os
números dela dizem (22/25 contra 20/25); a frase admite as duas leituras e fica
para ela confirmar na conversa.

Os limites ficam em constantes nomeadas no topo de `app/relatorios/ponto.py`.

### Ajustes

Ajuste = batida com `Tipo Marcação N = "Justificada"`. **Conta**, exceto quando
`Motivo` + `Justificativa` (sem acento, minúsculo) contém `externo`, `viagem`,
`home office` ou `cliente`. É a mesma contagem nas originais e nas analisadas.

### Por pessoa no mês

- Contagem de cada indicador, nas duas réguas.
- **Recorrente** = indicador com 10 ou mais ocorrências **nas originais**.
- **Status**: 3+ recorrentes `CRÍTICO`, 2 `ATENÇÃO`, 1 `ACOMPANHAMENTO`, 0 `REGULAR`.
- **Padrão**: os recorrentes por extenso ("Atraso recorrente + Intervalo
  reduzido recorrente"), sem o `+ ` sobrando no fim que a fórmula dela deixa.
- **Saldo**: `Saldo banco total` do banco de horas.

Status e padrão saem das originais porque é assim na planilha dela; a contagem
analisada aparece ao lado. Se ela quiser o status sobre as analisadas, é uma
constante.

## A ferramenta

### `relatorio_ponto`, no servidor MCP `hsos-anexos`

O servidor `hsos-anexos` já resolve o que importa aqui: a identidade do agente
vem da assinatura da URL (não de argumento), o anexo tem que ser de conversa com
ele, e a pessoa dona do anexo tem que estar com um turno em curso.

- **Só o `bruce` enxerga.** O `tools/list` passa a depender do agente da URL, por
  uma tabela `{ferramenta: agentes}`; `tools/call` de quem não pode recebe
  "ferramenta desconhecida", igual a um nome inexistente.
- **Argumentos:** `ids` — lista com os ids dos dois anexos, em qualquer ordem.
- **Permissão:** cada id passa pela mesma checagem do `ler_anexo` (pertence a
  conversa do agente, turno em curso). Os dois têm que ser da **mesma pessoa**.
- **Destino:** o arquivo vai para o dono dos anexos. Não há argumento `para`.
- **Execução:** leitura dos CSV e montagem do xlsx numa thread
  (`anyio.to_thread`), como o `ler_anexo` e o `enviar_arquivo`.
- **Entrega:** o mesmo caminho do `enviar_arquivo` — anexo em `public.anexos`,
  cópia em `generated-documents` com linha em `generated_documents`, bolha
  `📎 <nome>` na conversa. Esse trecho é extraído do `_enviar_arquivo` para uma
  função comum, sem mudar o comportamento dele.
- **Nome do arquivo:** `Controle de jornada - <MÊS>-<ANO>.xlsx`, com mês e ano
  tirados das datas do CSV.

### O que volta ao modelo

Só o resumo, em texto curto: mês, número de pessoas monitoradas, totais de
ajustes e de cada indicador (originais e analisadas), quantos em cada status e
quem está `CRÍTICO` ou `ATENÇÃO` com saldo e padrão. O modelo não recebe as
linhas e não reescreve número.

### Erros, todos nomeados ao agente

- Um dos ids não é anexo dele, ou está fora do turno: a mesma mensagem do
  `ler_anexo`.
- Falta um dos dois arquivos, ou um cabeçalho não é do Flash: diz qual foi
  reconhecido e qual falta.
- Os dois anexos são de pessoas diferentes: recusa.
- Marcações de mais de um mês no mesmo arquivo: recusa, dizendo os meses.
- Teto: 5.000 linhas de marcação (um mês da HS tem ~500).

## O xlsx

Números são números (célula numérica). Horário e duração são **frações de dia
com formato `hh:mm`**. O saldo vai em **duas colunas**: o texto `-07:42` para
ler e os **minutos com sinal** (−462) para somar e filtrar — o Excel mostra
`#####` para hora negativa em `[h]:mm`, então fração de dia não serve para saldo.

| aba | conteúdo |
|---|---|
| Resumo Gerencial | indicadores principais; quadro de ocorrências com pessoas afetadas, total original e total analisado; lista de quem não está `REGULAR`, com saldo, status, padrão e Tratativa em branco |
| Controle Principal | por pessoa: setor, ajustes e os seis indicadores (originais), saldo, padrão, status, Tratativa em branco |
| Dados e-mail | por pessoa: os seis indicadores nas analisadas e o saldo |
| Ocorrências | uma linha por ocorrência: pessoa, data, indicador, horário (ou duração do intervalo) e se conta nas originais, nas analisadas ou nas duas |
| Ajustes | pessoa, departamento, data, tipo da batida (entrada, saída para intervalo, retorno, saída), motivo, justificativa, horário, conta no indicador? |

A aba "Ocorrências" é onde ela confirma os casos de julgamento. A aba de
marcações cruas não é repetida: o CSV já está anexado na conversa.

## Skill e agente

- **Skill `ponto-flash`** em `backend/skills/ponto-flash/SKILL.md`, publicada com
  `scripts/publicar-skills.sh --enviar`: quando chegam os dois CSV do Flash,
  chamar `relatorio_ponto` com os dois ids; como explicar a régua; que a
  Tratativa e o julgamento caso a caso são dela; que ajuste de régua pedido por
  ela vira registro para o TI, não conta de cabeça.
- **Ponteiro no `AGENTS.md` do `bruce`**, uma linha: "planilha de ponto do Flash
  começa abrindo a skill `ponto-flash`". Medir antes de gravar (hoje 8.937 de
  20.000). Conferência: perguntar ao `bruce` o que ele faz com os CSV do Flash,
  sem citar a skill.
- **`scripts/publicar-anexos-mcp.py` não muda:** a ferramenta nasce no servidor
  que o `bruce` já tem.

## Testes

**Pytest, sem banco** (`backend/tests/test_relatorio_ponto.py`), com CSV
inventados — **nenhum nome ou matrícula real no repositório**:

- reconhecimento dos dois arquivos pelo cabeçalho, em qualquer ordem; cabeçalho
  desconhecido nomeado no erro;
- cada limite das duas réguas na fronteira exata (07:19/07:20, 07:49/07:50,
  16:48/16:49, 17:19/17:20 e os das originais);
- saída na última batida num dia de 6 batidas; dia de 2 batidas sem intervalo e
  sem saída;
- ajuste de trabalho não conta (`Externo`, `Home Office`, "atendimento ao
  cliente"), esquecimento conta;
- status nas quatro faixas; padrão sem `+` sobrando;
- saldo `(-07:42)` vira −462 minutos; casamento por matrícula com zeros;
- o xlsx: célula de contagem é `int`, saldo é número com formato `[h]:mm`;
- `tools/list` do `bruce` tem `relatorio_ponto`, o de outro agente não; e
  `tools/call` de outro agente é recusado.

**Conferência com os dados reais, fora do repositório** (script no scratchpad,
contra os anexos de setembro):

- Controle Principal: com a saída na **4ª** batida a régua original tem que
  bater as **149/150** do levantamento; com a **última**, as diferenças têm que
  cair só nos dias de 6 batidas.
- Dados e-mail: as **128/150** do levantamento.
- Ajustes: **97/97** na coluna "Conta no indicador?".

**Ao vivo, no fim:** a coordenadora anexa os CSV de setembro na conversa com o
`bruce` e recebe a planilha.

## Arquivos

| arquivo | mudança |
|---|---|
| `backend/app/relatorios/ponto.py` | criar — régua pura, leitura dos CSV, montagem do xlsx |
| `backend/app/routers/mcp_anexos.py` | `relatorio_ponto`, `tools/list` por agente, entrega extraída do `_enviar_arquivo` |
| `backend/tests/test_relatorio_ponto.py` | criar |
| `backend/tests/test_mcp_anexos.py` | ferramenta visível só ao `bruce` |
| `backend/skills/ponto-flash/SKILL.md` | criar |
| `AGENTS.md` do `bruce` (gateway) | uma linha de ponteiro |
| `CLAUDE.md`, `docs/CONTINUAR-AQUI.md` | registrar a ferramenta e o estado |
