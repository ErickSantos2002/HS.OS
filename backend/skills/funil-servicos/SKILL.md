---
name: funil-servicos
description: >-
  O funil de SERVIÇOS do HSGrowth — os boards Serviços e Serviço - Cobrança,
  calibração, e o que "Negócio Ganho" significa em cada um (não é a mesma coisa).
  Use quando perguntarem sobre calibração, recalibração, cobrança de serviço,
  aparelho na empresa, ou qualquer número do funil de serviços.
emoji: 🔧
always: false
---

# O funil de serviços — dois boards, e "ganho" quer dizer coisas diferentes

⚠️ **Esta é a armadilha central, e some num `GROUP BY`.** Os dois boards têm uma
lista chamada **Negócio Ganho**, e elas marcam **eventos diferentes**:

| board | o aparelho está… | **ganho significa** |
|---|---|---|
| **Serviços** | já **na empresa** (OS aberta no GestorHS) | foi **calibrado e o cliente aprovou faturar** |
| **Serviço - Cobrança** | ainda **no cliente** | o cliente **enviou o aparelho** para a empresa |

Somar os dois e dizer "X negócios ganhos em serviços" mistura *receita aprovada*
com *aparelho a caminho*. **Sempre diga de qual board veio.**

E os dois são **tabelas próprias**: `service_boards`, `service_lists`,
`service_cards`. Não são os `boards`/`lists`/`cards` do funil de vendas.

## Board "Serviços" — o aparelho já chegou

```
Liberados do Laboratório → Dados Preenchidos → Tentativa de Contato →
Proposta → Aguardando Pedido → Negócio Ganho / Negócio Perdido
```

O setor de serviços pega a CX quando ela é **liberada do laboratório**, preenche
dados que precisa buscar por fora, entra em contato, monta a proposta, verifica
se vai precisar de pedido, e fecha.

## Board "Serviço - Cobrança" — o aparelho ainda está no cliente

```
Oportunidade Existente → Tentativa de Contato → Proposta →
Operações → Negócio Ganho / Negócio Perdido
```

A primeira lista junta **quem já está atrasado** e **quem vence em até um mês**.
A equipe contata, monta proposta mostrando como será a calibração e pede que o
aparelho seja enviado. O card fica em **Operações** até o cliente **confirmar o
envio** — e é aí que vira ganho.

⚠️ **"Operações" não é o setor de operações**: é a espera pelo aparelho chegar.

## De onde o card veio — `external_source`

```
gestorhs.atrasados    967   calibração já vencida
gestorhs.calibracao   316   vence em breve
gestorhs.os            79   veio de uma OS aberta
```

É o que separa **atrasado** de **a vencer** dentro da mesma primeira lista, e o
`external_id` liga de volta ao GestorHS. Use isso quando a pergunta for "quantos
estão atrasados" — não tente adivinhar pela data.

## As consultas

### O funil, por board e etapa

```sql
SELECT b.name AS board, l.position AS pos, l.name AS lista,
       count(c.id) FILTER (WHERE COALESCE(c.is_deleted,false)=false) AS cards
  FROM public.service_lists l
  JOIN public.service_boards b ON b.id = l.board_id
  LEFT JOIN public.service_cards c ON c.list_id = l.id
 GROUP BY 1,2,3 ORDER BY b.name, l.position;
```

### Valor de um card

⚠️ **`service_cards` NÃO tem coluna de valor.** Ele sai de duas tabelas e a maior
parte está em serviços, não em produtos:

```sql
SELECT c.id, c.title,
       COALESCE(pr.total,0) + COALESCE(se.total,0) AS valor
  FROM public.service_cards c
  LEFT JOIN (SELECT service_card_id,
                    sum(COALESCE(quantity,1)*COALESCE(unit_price,0) - COALESCE(discount,0)) total
               FROM public.service_card_products GROUP BY 1) pr ON pr.service_card_id = c.id
  LEFT JOIN (SELECT service_card_id,
                    sum(COALESCE(quantity,1)*COALESCE(unit_price,0) - COALESCE(discount,0)) total
               FROM public.service_card_services GROUP BY 1) se ON se.service_card_id = c.id
 WHERE COALESCE(c.is_deleted,false) = false;
```

### Tempo numa etapa

⚠️ **NÃO é o `card_list_history`.** Aquela tabela só tem os boards 6 e 7 —
Prospecção e Aquisição, que são vendas. Um teste meu comparou ids entre tabelas
diferentes, que colidem, e concluiu que ela cobria serviço; o `atlas` derrubou
isso no primeiro briefing, conferindo pelo `board_id`. Registro o erro porque a
consulta enganosa é fácil de repetir.

O histórico de serviço está em **`service_card_activities`**, com
`activity_type = 'stage_change'` para a troca de etapa e `card_won` para o ganho:

```sql
SELECT activity_type, count(*) FROM public.service_card_activities GROUP BY 1;
-- product_added 1564 · card_created 1393 · stage_change 818 · follow_up 561 …
```

⚠️ **E ele começa em 10/06/2026** — `stage_change` só existe a partir daí, e as
primeiras semanas são de implantação. Comparar com período anterior a isso é
comparar com ausência de registro, não com desempenho.

## Duas armadilhas de configuração

⚠️ **`is_lost_stage` está `false` nas duas listas "Negócio Perdido" de serviço.**
Só o ganho está marcado. Quem filtrar perdido por essa flag **perde 65 cards** e
não recebe erro nenhum. Enquanto não for corrigido no CRM, identifique o perdido
**pelo nome da lista**, e diga que fez assim.

⚠️ **`service_cards` não tem `closed_at` nem `is_won`**, ao contrário do card de
vendas. "Quando fechou" só existe como a entrada na lista de ganho, em
`card_list_history`.

## Ao responder

- **Diga o board.** Sem isso, "ganho" é ambíguo por construção.
- Quando a pergunta for de cobrança, diga se é **atrasado** ou **a vencer** —
  estão na mesma lista e são conversas comerciais diferentes.
⚠️ **A primeira lista da Cobrança tem mais de mil cards e isso NÃO é acúmulo.**
  Todos os clientes com aparelho atrasado foram carregados de uma vez, de
  propósito: ela funciona como **base de oportunidades que gera trabalho**, não
  como fila do dia que alguém deixou crescer. Chamá-la de gargalo é ler errado o
  desenho — e é o tipo de conclusão que soa analítica e desinforma.

## Notas relacionadas

- O funil de **vendas** (Prospecção e Aquisição) está na skill `funil-vendas`.
- O GestorHS é a fonte das ordens de serviço e da data de calibração; aqui só
  chega o que virou card.
