---
name: pipeline-crm
description: >-
  A régua do funil comercial da Health & Safety no GrowthHS. Use SEMPRE que
  perguntarem sobre pipeline, oportunidades, negócios ganhos ou perdidos, cards
  parados, motivo de perda, desempenho de vendedor ou de SDR, taxa de conversão
  ou qualquer contagem de card. Contar card sem separar os boards infla perda em
  8× e inventa "cards sem dono" que não existem.
emoji: 📊
always: false
---

# Pipeline — a régua da casa

⚠️ **Contar card no funil inteiro produz número errado com cara de exato.** Em
15/08/2026 o CEO perguntou quantos cards estavam parados e recebeu **"369 sem
vendedor atribuído — 66% do total"**, apresentado como *risco de ninguém
responsável*. Quase todos estavam na **Prospecção**, onde card não tem vendedor
porque quem trabalha lá é o SDR. Não era risco nenhum: era o funcionamento
normal, lido como problema.

## Os três boards, e por que isso muda tudo

| `board_id` | board | o que é | quem trabalha |
|---|---|---|---|
| 6 | **Prospecção** | lista fria, higiene de base | SDR |
| 7 | **Aquisição** | o funil de negócio de verdade | vendedor |
| 8 | Expansão (Pós Venda) | hoje **vazio** | — |

**Pergunta sobre negócio é Aquisição (board 7).** Prospecção é atividade de
prospecção, não negócio — e é onde está a maior parte dos cards.

```sql
FROM cards c
JOIN lists l ON l.id = c.list_id
WHERE l.board_id = 7                      -- Aquisição
  AND COALESCE(c.is_deleted, false) = false
```

O `is_deleted` some com card excluído e é fácil de esquecer.

## `is_won`: três valores, e o 0 é o que engana

| valor | significa |
|---|---|
| `1` | Ganho |
| `-1` | Perdido |
| `0` | **Aberto** — ainda em andamento |

⚠️ **`is_won = 0` NÃO é perdido.** É o card que está vivo no funil. Quem lê 0
como "não ganhou" transforma todo o pipeline aberto em derrota.

## "Negócio Perdido" na Prospecção não é perda

É a etapa onde o SDR descarta lead que não deu liga — higiene de base, e o
volume normal do trabalho dele.

Em 2026, cards com `is_won = -1`:

| board | quantidade |
|---|---|
| Prospecção | **4.520** |
| Aquisição | **650** ← a perda real |

Somar os dois dá 5.170 e infla a perda em **8×**. Quando perguntarem "quantos
negócios perdemos", a resposta é a da Aquisição.

## Vendedor e SDR são coisas diferentes

- `assigned_to_id` é o **vendedor**, e só faz sentido na Aquisição. Card da
  Prospecção sem vendedor é o esperado — **não** é card órfão.
- `sdr_id` é o SDR, e o trabalho dele é o **outbound**.

⚠️ **O denominador do indicador de SDR é o outbound, não o funil.** Em 2026:

| `acquisition_channel` | cards | com SDR |
|---|---|---|
| Outbound | 4.838 | 4.549 |
| Inbound | 831 | **2** |

Inbound não passa por SDR. Cobrar cobertura de SDR sobre o funil inteiro produz
um número baixo que não descreve nada.

## O CRM não tem 2025 utilizável

| ano | cards | com SDR | com canal |
|---|---|---|---|
| 2024 | 2.132 | **0** | 279 |
| 2025 | 1.817 | **1** | 55 |
| 2026 | 6.244 | 4.620 | 5.875 |

2024 e 2025 são quase todos importação via planilha. **Recorte por pessoa, canal
ou origem só existe de 2026 em diante.** Pedido de histórico anterior: diga isso
em vez de devolver zero — zero aqui significa "não foi registrado", não
"não aconteceu".

O histórico de faturamento antigo existe, mas no DataCoreHS, com a Iris.

## Confira antes de responder

**2026, board 7 (Aquisição), sem excluídos:**

| status | cards | valor |
|---|---|---|
| Ganho | **335** | R$ 3.421.893,01 |
| Perdido | **650** | R$ 8.909.272,20 |
| Aberto | **139** | R$ 2.859.647,00 |

Se a sua consulta não reproduzir esses números para 2026, **pare**: a régua está
errada e o resultado não serve. Diga o que divergiu em vez de entregar.

## Ao responder

- **Diga o board** que usou. "Pipeline" sem board é ambíguo, e a diferença é 8×.
- **Card parado**: informe por board separadamente, e não some. Prospecção
  parada é lead frio; Aquisição parada é negócio esfriando — só a segunda pede
  ação.
- **Sem vendedor** só é sinal de alerta na **Aquisição**. Na Prospecção, é o
  normal.
- Valor de card é expectativa, não receita. **Faturamento realizado é com a
  Iris**, no DataCoreHS — não tente responder faturamento daqui.

⚠️ **Nunca apresente contagem do funil inteiro como se fosse desempenho
comercial.** Foi assim que 369 cards viraram um "risco" que não existia, numa
resposta para a diretoria.
