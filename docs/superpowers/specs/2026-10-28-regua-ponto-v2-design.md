# Régua de ponto v2 — Grupo A (Pontualidade e Jornada)

**Data:** 2026-10-28 · **Escopo:** `backend/app/relatorios/ponto.py`, a
ferramenta `relatorio_ponto` em `backend/app/routers/mcp_anexos.py`, a skill
`ponto-flash` e o `AGENTS.md` do `bruce`.
**Substitui** a régua de `2026-10-13-relatorio-ponto-design.md` (v1).

## Por que

A coordenadora de RH (Lidisay) passou duas semanas homologando o `bruce` contra
os relatórios do Flash e, em 27/10/2026, mandou ao Erick a régua nova por
escrito. Três coisas desta homologação definem o desenho:

1. **O `bruce` não usou a ferramenta.** Ela anexou três CSV (marcações, banco e
   **eventos**) e a `relatorio_ponto` aceita exatamente dois; ele leu os
   arquivos com `ler_anexo` e calculou de cabeça.
2. **E calculou errado.** Contou 21 eventos aprovados e 2 cancelados; o CSV
   tem 20 e 3 (conferido em 28/10: as 24 linhas têm os 24 campos, a coluna
   `Status` está certa). Ele inventou um "deslocamento de coluna" para explicar
   a própria leitura. É a lição de sempre: **número sai de código**.
3. **Ele publicou um painel com dado individual em link público**
   (`publicar_pagina`, 21/10, validade 7 dias). Ela pede acesso restrito.

## A régua (texto dela, 27/10/2026)

Jornada padrão: segunda a sexta, 07h30–17h00, 1h de intervalo. O Flash faz a
apuração oficial (tolerância de 15 min); **estes critérios são gerenciais e não
mexem em saldo nenhum do Flash.**

| | Indicador | Regra (por minuto, segundos descartados) |
|---|---|---|
| **A1** | Entrada antecipada | entrada < 07:20 |
| — | Entrada permitida | 07:20 ≤ entrada ≤ 07:45 |
| **A2** | Atraso | entrada ≥ 07:46 |
| **A3** | Saída antecipada | saída < 16:50 |
| — | Saída permitida | 16:50 ≤ saída ≤ 17:10 |
| **A4** | Permanência após jornada | saída > 17:10 |
| **A5** | Intervalo reduzido | intervalo < 60 min |
| — | Intervalo regular | intervalo = 60 min |
| **A6** | Intervalo prolongado | intervalo > 60 min |

⚠️ **A numeração A1–A6 é nossa**, na ordem da tabela dela; ela fala em "A1 a
A6" sem listar. A planilha e o resumo trazem número **e** nome, para ela
corrigir se a ordem for outra — é uma constante.

As faixas "permitida/regular" não são ocorrência, mas entram na planilha: são o
que fecha a conta (antecipada + permitida + atraso = dias avaliados).

**Saem da v1:** as duas réguas ("originais" e "analisadas"), a recorrência
(10+), os status CRÍTICO / ATENÇÃO / ACOMPANHAMENTO e o padrão — **suspensos
por ela** até o RH validar critério novo. A contagem de ajustes por motivo de
trabalho também sai do Grupo A: marcação justificada vira evidência na
ocorrência, não indicador.

## Entrada

| arquivo (pelo cabeçalho) | obrigatório | para quê |
|---|---|---|
| `MarcacoesOriginaisJustificadas` | sim | as batidas |
| `Eventos` | sim | dias e períodos justificados; sem ele não há denominador |
| `BancoHoras` | não | saldo do Flash, só exibido |

`Eventos` se reconhece por `EventoId`, `Motivo`, `Data Inicio`, `Status`. Colunas
usadas: `Matrícula`, `Nome`, `EventoId`, `Motivo`, `Descrição`, `Data Inicio`,
`Data Fim`, `Hora Inicio`, `Hora Fim`, `Qtde`, `Status`.

⚠️ **`CID` e `Justificativa` de evento não são lidos nem saem em lugar nenhum**
(planilha, resumo, histórico). Ela pediu explicitamente para não reproduzir
diagnóstico. Os testes trancam isso.

⚠️ **Relatório "Cálculos Diários"** — ela manda conferi-lo nos dias de marcação
fora do padrão, mas ainda não temos o export dele. Nesta versão esses dias saem
como **pendentes de verificação**, com a nota "conferir no Cálculos Diários".
Quando o arquivo vier, entra como quarto tipo, opcional, numa v2.1.

Casamento entre arquivos: matrícula sem zeros à esquerda; sem matrícula
(`-`), nome sem acento e minúsculo. Igual à v1.

## Calendário

**Dia útil** = segunda a sexta, fora do feriado. Feriados (lista dela, todos
valem para a HS — Recife/PE):

| data | feriado | tipo |
|---|---|---|
| 01/01 | Confraternização Mundial | Nacional |
| Páscoa − 47 | Carnaval (17/02/2026) | Nacional |
| 06/03 | Data Magna | Estadual |
| Páscoa − 2 | Paixão de Cristo (03/04/2026) | Nacional |
| 21/04 | Tiradentes | Nacional |
| 01/05 | Dia do Trabalhador | Nacional |
| 24/06 | São João | Estadual |
| 07/09 | Independência | Nacional |
| 12/10 | Nossa Senhora Aparecida | Nacional |
| 19/10 | Dia do Comerciário | Municipal |
| 02/11 | Finados | Nacional |
| 15/11 | Proclamação da República | Nacional |
| 20/11 | Consciência Negra | Nacional |
| 08/12 | Imaculada Conceição | Municipal |
| 25/12 | Natal | Nacional |

Carnaval e Paixão são **calculados pela Páscoa** (algoritmo de Gauss/Meeus),
não fixados em 2026 — senão a régua quebra em janeiro. A lista é constante no
módulo, com o nome; teste confere as datas de 2026 que ela deu.

Marcação em sábado, domingo ou feriado: não entra em indicador nenhum; vai para
a aba de pendências como "marcação fora da escala".

## Eventos

- **Só `Status = Aprovado` justifica.** `Cancelado` (e qualquer outro) aparece
  na aba de eventos, marcado "não usado", e não justifica nada.
- **Evento de dia inteiro** — sem `Hora Inicio`/`Hora Fim` (`Qtde` = "Dia
  Todo" / "N Dias"): cada dia de `Data Inicio` a `Data Fim` (vazia = início)
  **sai dos dias elegíveis** da pessoa. Férias, atestado de dia todo, day-off.
- **Evento parcial** — com horas: o período `[Hora Inicio, Hora Fim]` daquele
  dia é **período justificado** (ver abaixo).
- **Código de efeito** — o número entre parênteses na `Descrição` (`(1004)`).
  Vai para a evidência. Efeitos confirmados por ela na configuração do Flash:
  `1004` abona horas negativas do dia (não é crédito); `1001` compensação de
  banco; `1006`/`1007`/`1008` redução total ou parcial da escala. **Para o
  Grupo A todos agem igual: o período aprovado está justificado.** Nenhum saldo
  é recalculado.
- **Data de aprovação** fora do mês não muda nada: vale o status do arquivo.

## Por dia elegível

Batidas = `Hora da Marcação N` preenchidas, em ordem. Batida `Justificada`
com `Status Marcação` ≠ `Aprovado` torna o dia **pendente** inteiro (hoje não
há nenhuma; é guarda).

| batidas | entrada (A1/A2) | saída (A3/A4) | intervalo (A5/A6) |
|---|---|---|---|
| 4 | 1ª | última | 3ª − 2ª |
| 2 ou 6 | 1ª | última | **pendente** |
| 1, 3, 5 | 1ª | **pendente** | **pendente** |
| 0 | — dia **pendente**: "sem marcação e sem evento aprovado" — **não é falta** | | |

Ela foi explícita: não excluir dia de 2 ou 6 batidas, e **não presumir
intervalo** quando as batidas não bastam. Por isso entrada e saída desses dias
são avaliadas e o intervalo vira pendência, não ocorrência.

Batida `Justificada` (ajuste aprovado no Flash) é **horário válido** — o Flash
já tratou. A ocorrência que nascer dela leva "batida ajustada: motivo" na
evidência. *Marcação justificada ≠ evento de ausência*, são registros
distintos (texto dela).

### Situação de cada ocorrência

Toda ocorrência A1–A6 sai com uma de três situações:

- **identificada** — aconteceu e nada a cobre;
- **justificada** — um evento aprovado parcial cobre o desvio:
  - A2 atraso: o evento começa até 07:45 e termina em ou depois da entrada;
  - A3 saída antecipada: o evento começa em ou antes da saída e termina em ou
    depois de 16:50;
  - A6 intervalo prolongado: o evento sobrepõe o intervalo e, descontada a
    sobreposição, o intervalo fica ≤ 60 min;
  - A1, A4 e A5 não são justificáveis por evento de ausência (chegar cedo,
    sair tarde e voltar antes não são ausência).
- **pendente** — não é ocorrência; é o dia/medida que não pôde ser avaliado.
  Fica fora do numerador **e** do denominador, contado à parte.

## Indicadores

Para cada A1–A6, por pessoa e no total:

- **ocorrências identificadas**, **justificadas** e **pendentes**;
- **denominador** = dias elegíveis em que aquela medida pôde ser avaliada
  (entrada para A1/A2, saída para A3/A4, intervalo para A5/A6);
- **percentual** = identificadas ÷ denominador (as justificadas aparecem ao lado,
  não somam);
- **colaboradores envolvidos** = pessoas com ≥ 1 identificada.

E por pessoa: dias úteis do mês, dias fora por evento de dia inteiro, dias
elegíveis, dias pendentes.

**Fechamento:** a ferramenta soma as linhas individuais e compara com o total
geral de cada coluna, e confere `antecipada + permitida + atraso = avaliados`
(idem saída e intervalo). Divergência é defeito: a ferramenta **recusa entregar**
e devolve o erro, em vez de mandar planilha que não fecha. A aba "Conferência"
mostra as somas.

## Saída

`Controle de jornada - <MÊS>-<ANO>.xlsx`, abas:

1. **Resumo** — período, versão da régua, arquivos processados (nome + sha256
   curto), quadro A1–A6 (identificadas, justificadas, pendentes, denominador, %,
   pessoas), e a comparação com o mês anterior quando houver (abaixo).
2. **Por colaborador** — matrícula, nome, setor, dias úteis / fora / elegíveis /
   pendentes, e para A1–A6: identificadas, denominador, %, justificadas. Saldo
   do banco se o arquivo veio. **Sem rótulo de status.**
3. **Ocorrências** — uma linha por ocorrência: matrícula, nome, data, indicador
   (`A2 — Atraso`), horário/duração, situação, evento que justifica (EventoId +
   motivo + código), todas as batidas do dia (`07:52 · 12:00 · 13:00 · 17:05`),
   batida ajustada (motivo do Flash).
4. **Pendências** — dia e medida, motivo ("2 batidas: intervalo não
   verificável — conferir no Cálculos Diários", "sem marcação e sem evento",
   "marcação fora da escala", "batida justificada não aprovada").
5. **Eventos** — os eventos do arquivo **sem CID e sem justificativa**: id,
   matrícula, nome, motivo, código, início/fim, horas, `Qtde`, status, "usado"
   (sim/não e por quê).
6. **Conferência** — as somas do fechamento.

Números como número; horário como fração de dia em `hh:mm` (igual à v1). A
proteção contra fórmula da v1 continua.

Resumo ao modelo: quadro A1–A6 com denominadores, quantos pendentes, quantos
eventos usados/não usados, resultado do fechamento, comparação com o mês
anterior. **Sem nome de pessoa** — os detalhes são da planilha, que é privada.

## Histórico mensal

Cada apuração grava um JSON no R2, bucket lógico novo **`ponto-historico`**
(privado, sem rota de leitura: só o servidor lê):

`ponto-historico/<AAAA-MM>/<versao>-<sha8 dos arquivos>.json` com período,
`VERSAO_REGUA` (`"2026-10-28"`), arquivos (nome, sha256), totais e números por
matrícula (sem nome, sem horário, sem evento). Reprocessar o mesmo período com
outros arquivos gera outro JSON; o mais recente vale.

**Comparação:** ao apurar `M`, a ferramenta procura `M−1` com a **mesma
`VERSAO_REGUA`**. Achou: coluna "mês anterior" e variação no Resumo. Achou só em
outra versão: diz isso ("agosto foi apurado na régua X; reprocesse para
comparar") e não compara. Mudou a régua → a constante muda → comparação só
entre meses da mesma régua, que é o que ela pediu.

Por que R2 e não tabela: a tabela ficaria ao alcance do `banco-hsos` da `nina`.

## Ferramenta

`relatorio_ponto` passa a aceitar `ids` com **2 a 3** anexos (marcações e
eventos obrigatórios; banco opcional), mesma checagem de dono/turno da v1.
A `description` diz quais arquivos e que **eventos é obrigatório** — é ali que
o agente lê a regra. Falta de eventos responde com mensagem que nomeia o
arquivo que falta.

## Acesso

- Planilha: privada, como na v1 (Documentos da pessoa + a conversa).
- **O `bruce` não publica página com dado de ponto.** Regra na skill e no
  `AGENTS.md`; e se ele tiver `publicar_pagina`, ela sai do escopo dele.
  Dashboard com acesso restrito é etapa seguinte, depois da homologação dela.

## Homologação

Reprocessar setembro/2026 com os três CSV de 27/10 e entregar a ela A1–A6. Os
números conferidos à mão por nós antes de entregar: 21 dias úteis (22 dias de semana; 07/09
feriado), 20 eventos aprovados e 3 cancelados (`4686575`, `4806494`,
`4806560`), 424 dias de 4 batidas, 7 de 2 e 4 de 6.

## Fora do escopo

- Rótulos de reincidência (suspensos por ela).
- Grupos de indicador além do A.
- Dashboard.
- Jornada contratada por pessoa / escalas diferentes da padrão.

## v2.1 — Cálculo Diário (28/10/2026)

A Lidisay mandou o export `CalculoDiario_Empresa_5747_*.csv` de setembro. É o
relatório que ela mandou conferir nos dias fora do padrão, e o que ele mostrou
mudou o plano: **o FLASH não trata intervalo sozinho.** Num dia de 2 batidas
(07:40 e 17:48) ele dá `Horas Trabalhadas` 10:08, o dia inteiro, sem desconto.
Ou seja, o Cálculo Diário não resolve o intervalo desses dias: confirma que não
há intervalo registrado. Pela regra dela ("não presumir intervalo reduzido"),
eles **continuam pendentes**, agora com a evidência do FLASH, não com "conferir".

### Entrada

Quarto arquivo, **opcional mas recomendado**: `ids` aceita 2 a 4. Reconhecido
pelo cabeçalho (`Marcações Válidas`, `Natureza Dia`, `Jornada Considerada`).
Uma linha por pessoa × dia do mês (inclusive folga e feriado). Colunas usadas:
`Matrícula`, `Nome`, `Data`, `Natureza Dia` (`Trabalho` / `Folga` /
`Feriado`), `Nome Escala`, `Marcações Válidas` (pares `HH:MM - HH:MM`
separados por `|`), `Jornada Considerada` (`Trabalho Esperado`, `Trabalho com
Horas Excedentes`, `Trabalho com horas negativas`, `Falta`, `Folga`,
`Feriado`), `Horas Trabalhadas`, `Eventos` (nomes separados por vírgula, `-`
quando nenhum). **`CPF`, `PIS`, `CNPJ` e `Admissão` não são lidos.** Sem o
arquivo, tudo funciona como na v2, e o resumo avisa que ele faltou.

### O que ele muda

1. **Calendário do FLASH vence.** Com o arquivo, dia útil da pessoa =
   `Natureza Dia = Trabalho`. A lista de feriados continua como recuo. Toda
   diferença entre as duas vira aviso na Conferência ("FLASH diz Folga em
   dd/mm, nossa régua dizia dia útil").
2. **Marcações tratadas pelo FLASH vencem.** `Marcações Válidas` são os
   registros tratados ("utilizar os registros válidos e tratados pela FLASH").
   Quando diferirem das batidas do CSV de marcações, valem as do Cálculo e a
   diferença vira aviso, com as duas listas. (Setembro: 435 de 435 iguais.)
3. **Evento que só o FLASH conhece.** Dia útil sem marcação, sem evento nenhum
   no CSV de Eventos naquele dia, e com `Eventos` preenchido no Cálculo → sai
   dos dias elegíveis, com a evidência "FLASH: <Eventos> (não consta no export
   de Eventos)". Em setembro são 5 dias de férias de uma pessoa (01–04 e 08/09)
   que o export de Eventos não traz. Se o CSV de Eventos tem algo no dia
   (parcial, cancelado), vale a regra da v2 e o Cálculo só entra como evidência.
4. **Evidência nas pendências.** Toda pendência de um dia que está no Cálculo
   ganha `Jornada Considerada`, `Horas Trabalhadas`, `Marcações Válidas` e
   `Eventos` do FLASH. O texto do motivo muda:
   - 2 batidas → "FLASH sem intervalo registrado (horas trabalhadas HH:MM)";
   - 6 batidas → "FLASH registrou N pausas: HH:MM–HH:MM (X min), …" — qual
     delas é o intervalo é decisão do RH, não nossa;
   - sem marcação → "FLASH: <Jornada Considerada>, eventos: <Eventos>". O
     FLASH chama esses dias de `Falta`; nós continuamos **não** chamando.
5. **Conferência nova.** Pessoa-dia do Cálculo × pessoa-dia das marcações: dia
   com marcação que não está no Cálculo (ou o contrário) vira aviso. Pessoa que
   só existe no Cálculo e não tem marcação no mês (o CEO, matrícula `-`) fica
   de fora, como na v2.

`VERSAO_REGUA` passa a `"2026-10-28.1"`: o calendário e a exclusão de dias
mudam com o arquivo, então o histórico de setembro apurado sem ele não é
comparável.

### Conferido à mão em setembro

Marcações Válidas iguais às batidas em 435/435 dias. Calendário do FLASH: 483
pessoa-dia de `Trabalho` = 23 × 21, igual ao nosso. Os 11 dias "sem marcação e
sem evento" da v2 viram **6**: os 5 de férias da matrícula 39 saem.
