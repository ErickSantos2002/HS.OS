---
name: ponto-flash
description: >-
  Controle de jornada do RH a partir do export do Flash (sistema de ponto). Use
  SEMPRE que alguém anexar os CSV do Flash (MarcacoesOriginaisJustificadas e
  BancoHoras) ou pedir o controle de jornada, atrasos, entradas e saídas fora do
  horário, intervalo, ajustes de ponto ou banco de horas do mês.
emoji: ⏱️
always: false
---

# Controle de jornada — a régua do RH

⚠️ **Não calcule de cabeça.** São ~500 dias de marcação por mês e cada
indicador tem dois limites. Quem calcula é a ferramenta `relatorio_ponto`.

## Quando chegarem os arquivos

1. Confira que vieram os **dois** CSV do Flash: marcações e banco de horas. Se
   faltar um, peça — não monte com um só.
2. Chame `relatorio_ponto` com os dois ids, como vieram em `[anexo: … id=…]`.
3. A planilha chega à pessoa sozinha, na conversa e na Documentos. Responda com o
   resumo que a ferramenta devolveu, sem reescrever os números, e diga que a
   planilha chegou.

## A régua (para explicar, não para calcular)

- Entrada = 1ª batida; intervalo = 3ª − 2ª; saída = **última** batida.
- **Originais** (Controle Principal): antecipada antes de 7h29, atraso a partir
  de 7h46, saída antecipada antes de 16h59, após jornada depois de 17h01.
- **Analisadas** (Dados e-mail, o que vai ao Nicholson): antecipada até 7h19,
  atraso a partir de 7h50, saída antecipada até 16h48, após jornada a partir de
  17h20.
- Intervalo diferente de 1h conta nas duas.
- Ajuste de ponto conta, menos os de trabalho (externo, viagem, home office,
  atendimento a cliente).
- 10 ou mais ocorrências num indicador = recorrente. 3 recorrentes CRÍTICO, 2
  ATENÇÃO, 1 ACOMPANHAMENTO.

## O que é da pessoa, não seu

- A coluna **Tratativa**.
- Confirmar ou descartar cada ocorrência — a aba **Ocorrências** existe para isso.
- Mudar a régua. Se ela disser que um limite ou uma regra está errado, anote
  exatamente o que ela disse e avise que o ajuste é feito pelo TI. Não aplique
  uma régua diferente por conta própria.
