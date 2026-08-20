---
name: funil-vendas
description: >-
  Como o funil de vendas do HSGrowth funciona de verdade — os dois boards
  (Prospecção e Aquisição), quem trabalha em cada um, e o que conta como reunião
  agendada, qualificada e negócio ganho. Use SEMPRE que perguntarem sobre SDR,
  vendedor, reunião, proposta, funil, conversão ou desempenho comercial.
emoji: 🎯
always: false
---

# O funil de vendas — os dois boards

O CRM tem **dois sistemas de board**: o de **Vendas** (este documento) e o de
**Serviços**, que é outro fluxo, com outras tabelas. Não misture.

O de Vendas tem dois boards, e o card **atravessa os dois nesta ordem**:

```
PROSPECÇÃO  →  o SDR prospecta e agenda a reunião
   Lead Novo → Prospecção → Conectado → Reagendamento → Agendado
                                                   ↓
AQUISIÇÃO   →  o vendedor conduz a reunião e fecha
   Reunião Agendada → Qualificação → Diagnóstico e Proposta →
   Negociação → Aguardando Pedido → Negócio Ganho
```

Cada board tem também **Negócio Perdido**, que é fim de linha.

## Quem trabalha onde

| board | quem | o que faz |
|---|---|---|
| **Prospecção** | **SDR** (`roles.name = 'sdr'`) e também vendedor | O SDR trabalha **outbound**; o objetivo dele é **agendar reunião**. O vendedor também atua aqui, mas mais **inbound**. |
| **Aquisição** | **só vendedor** (`roles.name = 'salesperson'`) | Realiza a reunião, qualifica, faz diagnóstico, monta proposta, negocia e fecha. |

Hoje os SDR são **Claudia, Karolaine Martins e Miguel Luiz**; os vendedores,
**Adriana Oliveira, Eduardo Luna, Gislayne Nunes e Sandra Silva** (o "Vendedor
Teste" e o "Erick Santos" estão no papel mas não vendem — deixe de fora).

⚠️ **Não deduza quem é SDR pelo nome nem pelo cargo escrito em outro sistema.** O
papel está em `users.role_id` → `roles.name`.

## As duas perguntas que sempre aparecem, e a diferença entre elas

### "Quantas reuniões o SDR agendou?"

É o card **entrando na Aquisição**, com o SDR registrado:

```sql
SELECT u.name AS sdr, count(*) AS agendadas
  FROM public.cards c
  JOIN public.users u ON u.id = c.sdr_id
 WHERE c.sdr_id IS NOT NULL
   AND COALESCE(c.is_deleted, false) = false
   AND c.acquisition_entry_date >= DATE :inicio
   AND c.acquisition_entry_date <  DATE :fim
 GROUP BY 1 ORDER BY 2 DESC;
```

⚠️ **`sdr_id` é quem prospectou; `assigned_to_id` é o vendedor dono do card.** São
pessoas diferentes e colunas diferentes — trocar as duas troca o mérito de lugar.

### "Quantas reuniões do SDR foram qualificadas?"

⚠️ **Qualificação é PASSAGEM, não estado.** A lista `Qualificação` tem quase
sempre **zero cards parados** — o card entra e sai no mesmo dia. Contar quem está
lá agora dá zero e parece que ninguém qualifica nada.

O que vale é o card **ter passado** pela lista, e isso está em
`card_list_history`:

```sql
WITH qual AS (
  SELECT l.id FROM public.lists l
    JOIN public.boards b ON b.id = l.board_id
   WHERE b.name = 'Aquisição' AND l.name = 'Qualificação')
SELECT u.name AS sdr, count(DISTINCT c.id) AS qualificadas
  FROM public.cards c
  JOIN public.users u ON u.id = c.sdr_id
  JOIN public.card_list_history h ON h.card_id = c.id
 WHERE h.list_id IN (SELECT id FROM qual)
   AND COALESCE(c.is_deleted, false) = false
   AND h.entered_at >= DATE :inicio
   AND h.entered_at <  DATE :fim
 GROUP BY 1 ORDER BY 2 DESC;
```

**É só depois de passar pela Qualificação que a reunião do SDR conta como
qualificada.** Antes disso ela é só uma reunião agendada.

⚠️ **NÃO divida qualificadas por agendadas do mesmo mês para dar "taxa de
qualificação".** São datas diferentes: reunião agendada em julho pode ser
qualificada em agosto. Em agosto/2026 isso produz Claudia com 5 agendadas e 6
qualificadas — uma "taxa" de 120%, que não quer dizer nada. Para taxa de verdade,
siga a **mesma coorte** de cards, não o mesmo mês.

⚠️ **A lista Qualificação só existe desde 25/02/2026.** Antes disso não há
registro de qualificação, e comparar com 2025 é comparar com ausência de dado.

## O que é fechamento

`lists.is_done_stage = true` marca **Negócio Ganho**; `lists.is_lost_stage = true`
marca **Negócio Perdido** (os dois boards têm o perdido). Use as flags, não o
nome da lista — nome muda, flag não.

Valor do negócio é `cards.value`; a data de fechamento é `cards.closed_at`.

## Datas que o card carrega

| coluna | o que é |
|---|---|
| `prospection_entry_date` | quando entrou na Prospecção |
| `acquisition_entry_date` | quando entrou na Aquisição — **é a data da reunião agendada** |
| `closed_at` | quando foi ganho ou perdido |

Para "quanto tempo leva do lead ao fechamento", use essas três. Para tempo
**dentro de uma etapa**, use `card_list_history` (`entered_at`/`exited_at`), que
é o único lugar com a passagem card a card.

## Ao responder

- **Diga qual board** o número veio. "104 propostas" sem dizer que é a etapa
  Diagnóstico e Proposta do board Aquisição não significa nada.
- **Separe SDR de vendedor.** São dois times com objetivos diferentes; juntar os
  dois num "comercial" apaga justamente o que a pergunta quer ver.
- Quando a pergunta for sobre **desempenho de pessoa**, confira o papel em
  `roles` antes de rotular alguém.

## Notas relacionadas

- O board de **Serviços** é outro fluxo, com `service_cards` — não está aqui.
- A tabela `proposals` **não é o funil**: são propostas de pós-venda, quase todas
  rascunho e sem card. Proposta de verdade é a etapa Diagnóstico e Proposta.
