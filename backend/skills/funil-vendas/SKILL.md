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

⚠️ **Esta pergunta tem UMA resposta certa, e ela é a da tela do CRM.** Existe um
"Ranking SDR · Reuniões Agendadas" no dashboard do HSGrowth, o time olha para
ele, e é com ele que a sua resposta tem que bater. Qualquer outra contagem
plausível — e há várias — vai divergir do que a pessoa tem na frente dela.

Em 20/08/2026 esta seção dizia outra coisa e produziu o estrago: o CEO recebeu
**16** às 11h39 e **22** às 12h04, para a mesma pergunta, no mesmo dia, enquanto
a tela dele mostrava **17**. Nenhum dos dois batia.

A régua é `report_service.py` do HSGrowth (`top_sdrs_by_meetings`), e são
**quatro** condições:

1. Conta **entrada na lista `Agendado`** (`lists.id = 26`, board **Prospecção**),
   lida em `card_list_history` — é passagem, não estado atual.
2. Atribui pelo **`cards.sdr_id`**, nunca por quem moveu o card nem pelo
   responsável.
3. **`count(DISTINCT card_id)`** — card que voltou para "Agendado" conta uma vez.
4. ⚠️ **Desconta no-show — a ENTRADA, não o card.** O que sai da conta é a
   **linha de `card_list_history`** que tem, depois dela, uma `card_tasks` com
   `is_noshow = true`. O card continua contando pelas outras entradas dele.

   ⚠️ **Ler isto como "card com no-show não conta" é o erro que já aconteceu**,
   em 20/08/2026, com esta mesma skill aberta: o agente reescreveu a consulta a
   partir desta frase, usou `NOT EXISTS (… ct.is_noshow)` sobre o card, e
   entregou Claudia 3 quando a tela do CRM mostrava 7. **Use o SQL abaixo como
   está.** Ele não é ilustração; é a régua.

## Confira antes de entregar

Rode a consulta para **01–20/08/2026** e compare com esta tabela:

| SDR | certo | se você obtiver… | o que você errou |
|---|---|---|---|
| Claudia | **7** | 3 | excluiu o card inteiro em vez da entrada |
| Karolaine Martins | **6** | 5 | idem |
| Miguel Luiz | **5** | 4 | idem |
| **Total** | **18** | 15 → régua errada · 21 → esqueceu o no-show | |

**Bateu, siga. Não bateu, PARE** — não entregue o número, diga o que divergiu.
Estes três valores foram conferidos contra o "Ranking SDR · Reuniões Agendadas"
do dashboard do HSGrowth em 20/08/2026.

```sql
WITH noshow AS (
  SELECT clh.id
    FROM public.card_list_history clh
    JOIN public.card_tasks ct
      ON ct.card_id = clh.card_id
     AND ct.is_noshow = true
     AND ct.completed_at >= clh.entered_at
   WHERE clh.list_id = 26
)
SELECT u.name AS sdr, count(DISTINCT clh.card_id) AS agendadas
  FROM public.card_list_history clh
  JOIN public.cards c ON c.id = clh.card_id
  JOIN public.users u ON u.id = c.sdr_id
 WHERE clh.list_id = 26
   AND c.sdr_id IS NOT NULL
   AND clh.entered_at::date >= DATE :inicio
   AND clh.entered_at::date <= DATE :fim
   AND clh.id NOT IN (SELECT id FROM noshow)
 GROUP BY u.id, u.name ORDER BY 2 DESC;
```

⚠️ **O intervalo é fechado nos dois lados** (`>=` e `<=` sobre `entered_at::date`),
igual ao CRM. Trocar por `< fim` muda o número do dia corrente.

⚠️ **Reunião agendada NÃO é entrada na Aquisição.** São coisas diferentes e o
`acquisition_entry_date` responde a outra pergunta — quando o vendedor recebeu o
card. Usá-lo aqui foi o erro de 11h39.

⚠️ **Se o seu número não bater com a tela, o errado é o seu.** Antes de entregar,
confira se a diferença não é só o relógio: card que entra em "Agendado" depois da
hora em que a pessoa olhou a tela aparece para você e não para ela. Foi o que
aconteceu com a Karolaine em 20/08 — 5 às 12h07, 6 às 15h07.

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
| `acquisition_entry_date` | quando entrou na Aquisição — é o **repasse ao vendedor**, ⚠️ **não** a data da reunião agendada |
| `closed_at` | quando foi ganho ou perdido |

Para "quanto tempo leva do lead ao fechamento", use essas três. Para tempo
**dentro de uma etapa**, use `card_list_history` (`entered_at`/`exited_at`), que
é o único lugar com a passagem card a card.

## Troca de dono: a tabela óbvia está vazia e responde errado

⚠️ **`card_transfers` e `transfer_approvals` têm ZERO linhas e o HSGrowth não
usa nenhuma das duas.** Quem consultar qualquer uma para saber se um card mudou
de responsável recebe "nunca houve transferência nenhuma" — para todo card,
sempre. Não é ausência de movimento, é ausência de uso da tabela.

**Transferir, no HSGrowth, não é criar registro em tabela de transferência.** É
abrir o card e **trocar o vendedor no campo de responsável** — tira um, põe
outro. Não existe tela de "transferir", existe edição. Por isso o rastro está
onde ficam as edições, e não numa tabela com nome de transferência.

Em 08/09/2026 isso produziu duas conclusões opostas na mesma conversa com o CEO,
com uma hora de intervalo: primeiro "a carteira sumiu sem rastro", depois a
correção. A tabela vazia parece resposta.

**A troca de dono real é a edição do campo `assigned_to_id`, e ela está no
`audit_logs`:**

```sql
SELECT al.created_at, al.entity_id AS card, q.name AS executou,
       ua.name AS de, ub.name AS para, c.value
  FROM public.audit_logs al
  LEFT JOIN public.users q  ON q.id  = al.user_id
  LEFT JOIN public.cards c  ON c.id  = al.entity_id::int
  LEFT JOIN public.users ua ON ua.id = (al.data_before->>'assigned_to_id')::int
  LEFT JOIN public.users ub ON ub.id = (al.data_after ->>'assigned_to_id')::int
 WHERE al.entity_type = 'Card'
   AND (al.data_before->>'assigned_to_id')
        IS DISTINCT FROM (al.data_after->>'assigned_to_id')
   AND al.created_at >= DATE :inicio
 ORDER BY al.created_at;
```

⚠️ **`entity_type` é `'Card'` com C maiúsculo** — `'card'` não casa com nada e
devolve zero linhas, que é indistinguível de "não houve troca".

⚠️ **Um `para` nulo não quer dizer "ficou sem dono".** Acontece quando o
`assigned_to_id` novo não resolve no join; olhe `cards.assigned_to_id` para saber
quem é o dono **hoje** e feche o destino por ali.

**Confira antes de entregar.** Rode a consulta com `:inicio = 2026-09-08` e
compare — todas por Welton Kellyson, todas saindo de Sandra Silva:

| para | cards | valor |
|---|---|---|
| Adriana Oliveira | 3 | R$ 95.000 |
| Eduardo Luna | 3 | R$ 58.800 |
| Karolaine Martins | 3 | R$ 49.000 |
| Miguel Luiz | 3 | R$ 24.500 |
| **total** | **12** | **R$ 227.300** |

Vieram **zero** linhas? O `entity_type` está minúsculo, ou você foi na
`card_transfers`. **Pare** — não responda "não houve transferência".

### Ao concluir sobre uma CARTEIRA, varra as trocas todas — não só o recorte pedido

⚠️ **Este é o erro que custou a conclusão de 08/09/2026, e ele não é de SQL.** A
pergunta do CEO era sobre 35 cards perdidos; a resposta apurou os 35 corretamente
e então afirmou, sobre a **carteira inteira**, que ela "foi abatida, não
redistribuída". Naquela mesma manhã, uma hora antes, 12 cards vivos daquela
vendedora (R$ 227.300) tinham sido reatribuídos a quatro colegas. Os dois fatos
eram verdadeiros; a conclusão entregue tinha só um.

**O recorte que responde à pergunta não é o recorte que sustenta a conclusão.**
Antes de dizer o que aconteceu com a carteira de alguém, rode a consulta acima
para **essa pessoa, sem filtrar pelos cards da pergunta**, e diga as duas coisas:
o que foi perdido e o que mudou de dono.

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
