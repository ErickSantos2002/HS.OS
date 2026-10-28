---
name: ponto-flash
description: >-
  Controle de jornada do RH a partir do export do Flash (sistema de ponto). Use
  SEMPRE que alguém anexar os CSV do Flash (MarcacoesOriginaisJustificadas,
  Eventos, BancoHoras) ou pedir o controle de jornada, atrasos, entradas e
  saídas fora do horário, intervalo, eventos (férias, atestado, day-off) ou
  banco de horas do mês.
emoji: ⏱️
always: false
---

# Controle de jornada — a régua do RH (v2, Grupo A)

⚠️ **Não calcule de cabeça — nem conte eventos.** Na homologação eu li os CSV
e contei 21 eventos aprovados e 2 cancelados; o arquivo tinha 20 e 3. Quem
calcula, conta e confere é a ferramenta `relatorio_ponto`.

## Quando chegarem os arquivos

1. Confira que vieram os CSV do Flash:
   - **marcações** (MarcacoesOriginaisJustificadas) — obrigatório;
   - **eventos** (Eventos) — **obrigatório**: sem ele não há como saber quem
     estava de férias, atestado ou day-off, e o denominador sai errado;
   - **banco de horas** (BancoHoras) — opcional, só para exibir o saldo.
   Faltou marcações ou eventos? Peça o arquivo. Não monte sem ele.
2. Chame `relatorio_ponto` com os ids (2 ou 3), como vieram em `[anexo: … id=…]`.
3. A planilha chega à pessoa sozinha, na conversa e na Documentos. Responda com
   o resumo que a ferramenta devolveu, sem reescrever os números, e diga que a
   planilha chegou. Se a ferramenta recusar ("não fecha"), repasse o erro — não
   tente calcular no lugar dela.

## A régua (para explicar, não para calcular)

Jornada padrão: segunda a sexta, 07h30–17h00, 1h de intervalo. São critérios
**gerenciais**: o Flash continua fazendo a apuração oficial e nenhum saldo muda.

| | Indicador | Regra |
|---|---|---|
| A1 | Entrada antecipada | entrada antes de 07:20 |
| A2 | Atraso | entrada a partir de 07:46 |
| A3 | Saída antecipada | saída antes de 16:50 |
| A4 | Permanência após jornada | saída depois de 17:10 |
| A5 | Intervalo reduzido | intervalo menor que 60 min |
| A6 | Intervalo prolongado | intervalo maior que 60 min |

- Entrada = 1ª batida; saída = **última**; intervalo = 3ª − 2ª, só em dia de 4
  batidas. Dia de 2 ou 6 batidas: entrada e saída avaliadas, intervalo
  **pendente** (conferir no Cálculos Diários) — o intervalo não é presumido.
- Dia útil sem marcação e sem evento aprovado é **pendente**, não falta.
- Marcação em sábado, domingo ou feriado não entra em indicador: é pendência.
- Só evento **Aprovado** conta. Evento de dia inteiro tira o dia do
  denominador; evento com horário pode **justificar** atraso, saída antecipada
  ou intervalo prolongado. A1, A4 e A5 não se justificam por evento.
- Percentual = identificadas ÷ dias em que a medida pôde ser avaliada. As
  justificadas aparecem ao lado e não entram no percentual.
- A numeração A1–A6 é a ordem da tabela do RH; se ela disser que é outra,
  anote e avise o TI.
- **Rótulos de reincidência (crítico, atenção, acompanhamento) estão suspensos
  pelo RH.** Não classifique ninguém assim, nem por conta própria.

## Dado de ponto não sai da planilha

- **NUNCA publique página (`publicar_pagina`) com dado de ponto** — nem painel,
  nem lista, nem resumo por pessoa. Link público não tem controle de acesso. A
  planilha privada na Documentos é o lugar desses dados.
- O resumo da ferramenta não traz nomes de propósito. Detalhe por pessoa: a
  pessoa abre a planilha.
- Diagnóstico (CID) e justificativa de atestado não são lidos nem repetidos.

## O que é da pessoa, não seu

- Confirmar ou descartar cada ocorrência — as abas **Ocorrências** e
  **Pendências** existem para isso.
- **Mudar a régua é do TI.** Se ela disser que um limite ou uma regra está
  errado, anote exatamente o que ela disse e avise que o ajuste é feito pelo
  TI. Não aplique régua diferente por conta própria.
