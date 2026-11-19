---
name: calendario-financeiro
description: >-
  O calendário financeiro da Health & Safety: o que vence ou se faz em cada dia
  do mês, quem fornece cada conta ou guia e as rotinas do dia 05. Use SEMPRE que
  perguntarem o que vence, "o que pagar esta semana", "dia 05", certidão, folha,
  salário, descontos da folha, contas recorrentes, APERAM, prestação de contas à
  contabilidade ou "calendário financeiro".
emoji: 📅
always: false
---

# Calendário financeiro — contas e rotinas do mês

> **Origem:** levantamento do Financeiro de **18/11/2026**, em
> procedimentos aprovados "operacionalmente, com pendências" (FIN-11, 12, 13, 14
> e 16 e o Calendário). É a **prática habitual**, não vencimento de boleto: a
> data real de cada cobrança está no documento do mês.
>
> **Pendências dele que valem para toda resposta daqui:**
> - **Dia 05 não útil** (FIN-13, 14 e 16): não há regra. Não invente "passa para
>   o próximo dia útil"; diga que a regra não foi definida.
> - Os "cerca de 5 dias" antes da folha: **não confirmado se úteis ou corridos**.
> - Vencimentos específicos de cada cobrança do FIN-11 e a conciliação dos
>   débitos automáticos ainda não foram feitos.
> - Datas efetivas de fechamento das comissões.

⚠️ **Data do calendário não é vencimento.** Débito automático não prova
pagamento, e conta paga fora do Financeiro não é do Financeiro. Para o que
**está em aberto de fato** (títulos, saldo, vencido), use a skill
`contas-receber`; esta skill só diz o que costuma acontecer em cada dia.

## Agenda de contas recorrentes, por dia do mês

Entre parênteses, **quem fornece a cobrança**.

| Dia | Conta ou obrigação | Onde vem |
|---|---|---|
| 02 | Geração de leads (fornecedor) | fora do caixa do Financeiro |
| 03 | Marketing (produção de vídeo/agência) | fora do caixa do Financeiro |
| 03 | Empréstimo de capital de giro (Pronampe) | fora do caixa do Financeiro |
| 03 | Gás de calibração | boleto por e-mail da Administração |
| 04 | Processamento / TI (fornecedor) | fora do caixa do Financeiro |
| 05 | Contabilidade | e-mail da Administração |
| 05 | Limpeza | cálculo do Financeiro |
| 05 | Benefício de educação de colaborador | boleto entregue pelo colaborador |
| 05 | Marketing (agência) | fora do caixa do Financeiro |
| 05 | Plano de saúde | portal da operadora |
| 05 | Dividendos dos sócios | compromisso fixo do dia 05, fora do Financeiro |
| 05 | Aluguel | fora do caixa do Financeiro |
| 10 | ISS do município | WhatsApp (pessoa da Administração) ou portal de NFS-e |
| 14 | Itaú — parcela de capital de giro | débito automático |
| 14 | Itaú — seguro | débito automático |
| 15 | ICMS — SEFAZ-PE | e-mail da contabilidade |
| 15 | Condomínio das salas | e-mail da contabilidade |
| 15 | Telefonia/internet (três operadoras) | portal de cada operadora |
| 20 | IRPJ / CSLL | e-mail da contabilidade |
| 20 | FGTS | e-mail de quem fecha a folha, com a folha |
| 21 | Plano odontológico | e-mail de Atendimento da operadora (link pendente) |
| 21 | Itaú — parcela de capital de giro (2ª) | débito automático |
| 23 | PIS | e-mail da contabilidade |
| 23 | COFINS | e-mail da contabilidade |
| 26 | Consultoria em RH | WhatsApp do RH |
| 28 | Advocacia | fora do caixa do Financeiro |
| 30 | Parcelamento DAS | e-CAC (Receita Federal) |
| 30 | Parcelamento ICMS | e-CAC (Receita Federal) |
| 30 | Parcelamento GNRE / ICMS-ST | portal da PGE-SP (Dívida Ativa) |
| 30 | Vale alimentação e transporte | portal do fornecedor de benefícios |
| 30 | Despesas corporativas (cartão de benefícios) | portal do fornecedor de benefícios |
| 30 | Correios | Sistema de Faturas dos Correios |

⚠️ **Os "fora do caixa do Financeiro" não são pagos por ele**, mas aparecem no
`tiny.contas_pagar` (aluguel, advocacia, marketing, leads, dividendos). Ao somar "o
que a empresa paga no mês", eles entram; ao dizer "o que o Financeiro paga", não.
Os vínculos conta × canal ainda não tiveram validação final independente.

⚠️ **As parcelas do Itaú (dias 14 e 21) parecem empréstimo, mas o Tiny as lança
como tarifa bancária.** Na agenda de caixa vão em linha própria, "parcelas de
empréstimo — classificação a confirmar" (ver `contas-receber` e `custos`).

⚠️ **Parcelamentos (dia 30)**: os portais indicados ainda precisam de conferência
quanto à obrigação correta. Não afirme o que está parcelado.

## Salário e folha

- **Pagamento:** no **último dia útil do próprio mês trabalhado**. Exemplo: a
  folha de outubro/2026 foi paga em 30/10, porque 31/10 caiu num sábado.
- O quinto dia útil do mês seguinte é o **prazo legal geral**, não a data que a
  empresa usa. O PDF antigo dizia "dia 05"; foi corrigido — não repita.
- **Descontos de benefícios a quem fecha a folha:** a relação segue
  **cerca de 5 dias antes** do pagamento. Úteis ou corridos: **não confirmado**.
  Conteúdo: desconto de plano de saúde (titulares e dependentes) e de plano odontológico, por colaborador, conferidos a cada
  competência. Procedimento: identificar a data de pagamento, preparar a relação,
  conferir inclusões e exclusões de dependentes e os valores vigentes, enviar e
  guardar a evidência. Histórico: pesquisar a troca com quem fecha a folha no e-mail corporativo.
- ⚠️ **A relação nominal de descontos é dado individual de folha**: não a
  reproduza, não cite valor de pessoa. Totais e o procedimento, sim.
- Comissões de vendas (FIN-09) e de serviços (FIN-10): apuradas **após o
  encerramento mensal**; a data efetiva de fechamento não foi confirmada.
- FGTS (dia 20) vem por e-mail de quem fecha a folha, junto dela.

## Dia 05 — a rotina inteira

| Rotina | Procedimento | Resumo |
|---|---|---|
| Prestação de contas à contabilidade (**até** o dia 05) | FIN-13 | reunir as contas pagas do mês, casar cada comprovante bancário (Santander, Itaú, Bradesco) com a cobrança e enviar por e-mail, em três grupos: **Pagamentos** (NF/boleto + comprovante), **Impostos** (guia + comprovante) e **Comprovantes** (sem documento de cobrança correspondente) |
| Sete certidões (**até** o dia 05) | FIN-14 | emitir **todas de novo todo mês**, mesmo com as anteriores válidas: FGTS, CND União, Fazenda (licitação), Negativa Estadual, Negativa Municipal, Falência e Trabalhista; arquivar na pasta do mês; se alguma vier com restrição ou indisponível, registrar e avisar — **não declarar concluído** |
| Locação APERAM (**no** dia 05) | FIN-16 | TaskHS → Locação → card da APERAM; no Tiny, Notas de Serviços, clonar a NF anterior com o marcador "Locação", salvar, transmitir, **esperar a autorização** e só então enviar aos e-mails do card |

Também no dia 05 vencem, pela agenda acima: contabilidade, limpeza, benefício
de educação, marketing, plano de saúde, dividendos e aluguel.

⚠️ **Não dê por feito o que o procedimento manda confirmar:** APERAM só está
faturada com a nota **autorizada** (salva ou transmitida não basta); certidão só
está emitida quando as sete estão na pasta; conta só está quitada com
comprovante.

## Importação (FIN-15)

Sem data mensal fixa. A rotina começa pela chegada prevista da mercadoria e o
recebimento dos documentos. Não a ponha em agenda por dia do mês.

## Ao responder

- Diga que a fonte é o levantamento de 18/11/2026 e que **dia útil/não útil**
  de vários itens está pendente — principalmente o dia 05.
- "O que pagar esta semana?" → pegue os dias do mês da semana nesta tabela,
  separe o que é pago fora do Financeiro, e **confira em `contas-receber`** o que está de
  fato em aberto antes de dar valor.
- Esta skill não traz **valor**: a agenda diz o quê e quando, o dinheiro vem do
  banco.
- Não reproduza credencial de acesso, link de portal com identificador nem a lista
  nominal da folha. Credenciais ficam na planilha restrita da rede (FIN-11) e
  **não** são para resposta de IA.
