# Guardi no HSGrowth: Serviços (fase 2), design de 12/11/2026

Continuação de `2026-11-12-guardi-hsgrowth-vendas-design.md` (fase 1, vendedor),
que já está na `main`. Mesmo molde e mesma infraestrutura: cliente
`app/sistemas/hsgrowth.py`, token `aud=hsgrowth`, escrita por cartão. Esta fase
cobre o **kanban de Serviços** do HSGrowth, que lá dentro é outra pilha de código
(`service_*`), com outras regras.

Desenho proposto pelo Claude a partir do código e dos dados, por pedido do Erick
("pode propor o desenho direto a partir do código dessa vez"). O que é chamada
do Claude está marcado.

## Intenção

O setor de Serviços (Comercial Pós-Vendas: **Ellen, Leti e André**, função
`service` no HSGrowth) trabalha o pós-calibração: o GestorHS libera os aparelhos
do laboratório e cria o card; o time preenche, contata o cliente, manda a
proposta (que sai do **GestorHS** — o Guardi já monta, fase 2c do GestorHS),
fecha e marca ganho, e o ganho avisa o GestorHS para a caixa ir ao Financeiro.
No quadro de Cobrança o time persegue recalibração a vencer ou atrasada.

O Guardi deles deve, como o do vendedor: **ver tudo** do quadro e **ajudar a
preencher, registrar e mover**, a partir do que a pessoa conta ("liguei pra
ACME, pediram recalibração dos 3, já mandei a proposta 812 pelo Gestor, passa
pra Proposta").

## O que o reconhecimento mostrou (código do `hsgrowth-sistema` e banco, 12/11/2026)

- **Uso real (30 dias):** o GestorHS cria os cards (163) e põe produtos; André,
  Ellen e Leti movem etapa (~550), registram follow-up/WhatsApp/e-mail, põem
  serviços, anotam, anexam e marcam ganho/perdido (~180).
- **Dois quadros com regra:** 1 = **Serviços** (Liberados do Laboratório →
  Dados Preenchidos → Tentativa de Contato → Proposta → Aguardando Pedido;
  Ganho, Perdido) e 2 = **Serviço - Cobrança** (Oportunidade Existente →
  Tentativa de Contato → Proposta → Operações; Ganho, Perdido). Os ids 1 e 2
  são fixos no código de lá (`SERVICE_RULE_BOARD_IDS`). Ganho/perdido é a
  **lista** (flag `is_done_stage`/`is_lost_stage` ou o nome), não um campo.
- **⚠️ Card de Serviços não tem dono.** Os 1.922 cards estão com
  `assigned_to_id` nulo; o módulo é "colaborativo — sem dono único"
  (`service_board_service.py:377`); qualquer `service` mexe em qualquer card.
  A regra "só no card do dono" da fase 1 **não se aplica aqui**.
- **Regras de etapa** (`_validate_advance`, `service_board_service.py:591-760`):
  voltar é livre; avançar é só para a etapa seguinte; perder nunca trava.
  Requisitos (quadro 1): Dados Preenchidos → seguinte exige produtos, serviços,
  cliente, contato e `service_type`; Tentativa de Contato → seguinte exige uma
  atividade **concluída**; Proposta → Aguardando Pedido exige `closing_type =
  pedido` e `proposal_number`; Ganho exige `proposal_number` e
  `faturamento_direto` (vindo de Proposta) ou `order_number`. Quadro 2:
  Oportunidade → Tentativa exige produtos, serviços, cliente, contato,
  `collection_type`, `acquisition_channel`; Tentativa → Proposta exige atividade
  concluída e `service_type`; Proposta → Operações exige **arquivo no slot
  `proposta`** e `form_answered`; Ganho exige `shipping_confirmed = sim`.
- **Ganho avisa o GestorHS** (quadros 1 e 2, card com `external_source =
  gestorhs.os`): `POST …/caixas/{external_id}/ganho` com o `proposal_number`, e
  a caixa vai de Pós-Vendas para Financeiro. Em segundo plano, 3 tentativas,
  nunca falha alto. ⚠️ A API **não expõe** `external_source` no card — o
  agente não sabe se o ganho vai avisar o GestorHS.
- **Ganho/perda é só mover:** perder, na tela, é uma anotação "Motivo da perda:
  <motivo>" seguida do movimento para Perdido (motivos em
  `frontend/src/constants/blueprintOptions.ts:194-214`). O backend é **mais
  frouxo** que a tela no ganho (no quadro 2 só confere `shipping_confirmed`;
  dá para ganhar de qualquer etapa pela API). Ganho conclui as atividades
  pendentes, menos `follow_up`.
- **Atividade, anotação e arquivo** são uma coisa só: `ServiceCardActivity`
  (`/service-boards/{b}/cards/{c}/activities`), `category` `atividade` |
  `anotacao`; concluir é `PATCH …/complete {is_completed, is_valid}`. Não usa
  `card_tasks`/`card_notes` de Vendas. Campos personalizados não existem: o
  que é do negócio mora no JSON `business_info` (`collection_type`,
  `service_type`, `acquisition_channel`, `form_answered`, `closing_type`,
  `proposal_number`, `order_number`, `from_collection`, `shipping_confirmed`).
- **Produtos (aparelhos) e serviços do card** têm rotas próprias e catálogo
  (`/service-products`, `/services`); o **valor do card** é a soma dos serviços.
- **Leitura:** `GET /service-boards/{b}/cards` só pagina (até 500), sem filtro;
  a tela filtra no navegador. Cada card já vem com `pending_status`,
  `is_stuck_3d/7d`, `collaborators`, `products`, `device_serials`, `value`.
  `GET /service-activities?status=pending` dá as pendências do time.
  `GET /search/global` acha card de Serviço por cliente, CNPJ, contato e
  **número de série**. Painel: `GET /service-dashboard` (para não-admin, só o
  próprio usuário).
- **Propostas do HSGrowth estão descontinuadas** (`router.tsx:53`, "migrado p/
  sistema externo"): as 264 da tabela são rascunho. A proposta de verdade é a
  do GestorHS, e o `business_info.proposal_number` guarda o número dela.
- **Armadilhas de lá:** `PUT` do card com `list_id` move **sem** regra, sem
  evento e sem avisar o GestorHS (e aceita `is_deleted`); `business_info` é
  substituído inteiro; `DELETE` do card é apagamento físico; rotas de item
  (produto/serviço) não conferem se o item é do card; editar/duplicar quadro
  está aberto a `service`.
- **Tela:** card em `/servicos/{board}/cards/{card}`.

## O que a fase 2 entrega

### Quem

Ellen, Leti e André (função `service` lá). Piloto no `erick-bot` (admin: pula
regra de etapa, como na fase 1). Liga por sistema próprio em
`sistemas_ligados`: **`hsgrowth_servicos`** (chamada do Claude) — separado do
`hsgrowth` de Vendas, para o Guardi do vendedor não ganhar as ferramentas de
Serviços nem o inverso. `--ligar-hsgrowth-servicos` liga só quem responde
`role = service` no `/users/me`.

### Permissão: colaborativa, como a tela (chamada do Claude)

Sem dono no card, a régua é a mesma da decisão 1 do GestorHS: **a função lá é a
permissão do Guardi**. O Guardi de quem é `service` escreve em qualquer card dos
quadros 1 e 2, como a pessoa faz na tela. O que segura o estrago é o resto do
desenho: cartão em toda escrita, lista fechada do que escreve, nada de apagar.
Quadros fora de 1 e 2 (kanbans livres) ficam fora da fase.

### Leitura (direta)

`hsgrowth_servicos_consultas` / `hsgrowth_servicos_consultar`, catálogo como na
fase 1 (agente escolhe consulta, nunca caminho; link do servidor:
`HSGROWTH_URL/servicos/<board>/cards/<id>`):

| consulta | rota |
|---|---|
| `quadros`, `etapas` | `/service-boards`, `/service-boards/{b}/lists` |
| cards do quadro (filtros locais: etapa, `pendencia` overdue/today/future/none, `parado` 3d/7d, `cobranca` a_vencer/atrasados, `colaborador` = eu) | `/service-boards/{b}/cards` (pagina até 500; o servidor lê as páginas que precisar, com teto) |
| um card (com produtos, serviços, `business_info`) | `/service-boards/{b}/cards/{c}` + `/products` + `/services` |
| atividades e anotações do card | `/service-boards/{b}/cards/{c}/activities` |
| pendências (do time ou só minhas) | `/service-activities?status=pending` (corte local por `user_id` = eu quando pedir "minhas") |
| busca (cliente, CNPJ, contato, **série**) | `/search/global` (só a parte de serviço) |
| catálogos | `/service-products`, `/services` |
| meu painel do mês | `/service-dashboard` |
| clientes e contatos | `/clients`, `/persons` (já no catálogo da fase 1) |

### Escrita (sempre por cartão)

| ferramenta | o que faz | rota(s) |
|---|---|---|
| `hsgrowth_servicos_registrar` | o pós-contato num cartão só: `business_info` (só as chaves da lista, com os valores da tela), cliente/contato ligados ao card (`client_id`, `person_id` de cadastro que existe), atividade nova, concluir atividade (com `valida`), anotação, mover uma etapa | `PUT …/cards/{c}`, `POST`/`PATCH …/activities`, `PUT …/move` |
| `hsgrowth_servicos_itens` | pôr, alterar ou tirar aparelho (produto) e serviço do card, só do catálogo | `…/products[/{i}]`, `…/services[/{i}]` |
| `hsgrowth_servicos_ganhar` | Negócio Ganho | `PUT …/move` para a lista de ganho |
| `hsgrowth_servicos_perder` | anotação "Motivo da perda: X" + mover para Perdido | `POST …/activities`, `PUT …/move` |
| `hsgrowth_servicos_anexar_proposta` | baixar o PDF da proposta N **do GestorHS** e anexar no slot `proposta` do card (chamada do Claude: é o requisito de Proposta → Operações na Cobrança, e o PDF já existe lá) | GestorHS `link_pdf` → `POST …/activities/files?slot=proposta` |

Regras do nosso lado:

- **Mover sempre por `/move`**, nunca `PUT` com `list_id`. `PUT` do card leva só
  `business_info`, `client_id`, `person_id`, `title`, `description`,
  `due_date`, `contact_info` — **nunca** `list_id`, `position`, `is_deleted`,
  `assigned_to_id`.
- **`business_info` é mesclado na hora do clique:** o executor relê o card,
  mescla só as chaves do cartão e grava o dicionário inteiro (lá é
  substituição). O cartão mostra antes → depois de cada chave. Valores fora das
  opções da tela são recusados.
- **Ganho conferido como a tela, não como a API:** só da última etapa ativa do
  quadro (Aguardando Pedido no 1; Operações no 2 — ou de Proposta com
  `faturamento_direto` no 1), com os requisitos do backend conferidos antes do
  cartão (`proposal_number`, `order_number`/`faturamento_direto`,
  `shipping_confirmed`), e no quadro 1 o `from_collection` que a tela pede. O
  cartão diz: **"o ganho avisa o GestorHS e a caixa vai para o Financeiro"**
  quando o card vier do GestorHS (precisa do item 3 de "Para o HSGrowth"; até
  lá, o cartão diz "se este card veio do GestorHS, …"). O ganho entra nesta
  fase mesmo antes do item 3: o efeito no GestorHS é o esperado do negócio
  (é o mesmo do botão da tela) e a pessoa confirma lendo o aviso. (Chamada do
  Claude; se preferir travar o ganho até o item 3 subir, é uma linha.)
- **`proposal_number` confere com o GestorHS:** se o Guardi tem `gestorhs`
  ligado, lê a proposta N lá antes do cartão (existe? é do mesmo cliente?) e o
  cartão mostra cliente e valor dela. Diferença vira aviso, não trava (chamada
  do Claude). "Mesmo cliente" = **CNPJ/CPF em dígitos** do cliente do card e do
  destinatário da proposta; se um dos lados não tiver documento, não há aviso
  (aviso falso ensina a ignorar aviso). A busca lá é `GET /propostas?q=<número>`,
  e `proposal_number` é o `numero` da proposta, não o id.
- **Mover uma etapa, para frente ou para trás** (lá, voltar é livre). O cartão
  grava a etapa de origem **e** a de destino; no clique o executor relê o card e
  **recusa se a etapa atual não for mais a de origem** ("alguém mexeu no card
  desde o cartão — peça de novo"). Sem isso, num quadro compartilhado, um
  cartão velho pularia etapas — e para admin (que pula a regra lá) sem
  conferência nenhuma. O "uma etapa" é conferido do nosso lado para todo mundo,
  inclusive admin. (Chamada do Claude, a partir da revisão.)
- **Requisitos de etapa: quem julga é o HSGrowth.** Não simulamos o card
  mesclado; o cartão executa na ordem `business_info`/cliente/contato →
  atividades e anotação → mover, e **para e não desfaz** no primeiro erro,
  dizendo o que entrou e traduzindo a recusa de lá (o padrão do lote da fase 1).
  Do nosso lado, só o ganho é conferido antes (abaixo). (Chamada do Claude.)
- **Concluir atividade exige `valida`** (realizada × tentativa sem resultado),
  como na fase 1.
- **Item de produto/serviço só do catálogo**, e alterar/tirar confere que o
  item é do card (lá não confere).
- **Anexar proposta:** o PDF vem do GestorHS pelo `link_pdf` assinado da
  proposta (fase 2c do GestorHS), nunca de URL do agente; teto 10 MB (o de lá).
  Sem `gestorhs` ligado, proposta não achada ou PDF que não baixa → recusa antes
  do cartão, dizendo para anexar pela tela. Slot `proposta` já ocupado → o
  cartão diz **qual arquivo será substituído** (lá a troca é silenciosa).
  (Chamadas do Claude.)
- **Ações com prefixo `hsgrowth_servicos_`**, sistema `hsgrowth_servicos` em
  `acoes_pendentes` (o front despacha pelo nome).
- Mesmas guardas do `hsos-bot-<bot>` e mesmos saneamentos (`uma_linha`) da fase 1.

## Como ficou (decisões da construção, o código é a verdade)

Nomes finais das consultas: `quadros`, `etapas`, `cards`, `card`, `atividades`,
`pendencias`, `buscar`, `catalogo_aparelhos`, `catalogo_servicos`, `painel`,
`clientes`, `contatos`. Ferramentas de escrita: `hsgrowth_servicos_registrar`,
`_itens`, `_ganhar`, `_perder`, `_anexar_proposta`; leitura:
`hsgrowth_servicos_consultas` / `hsgrowth_servicos_consultar`. Cliente e contato
ficaram no `registrar` (`campos.client_id`/`person_id`).

- **`contact_info` nunca é editado** pelo Guardi.
- **Quadro conferido por nós:** o HSGrowth ignora o `board_id` nas rotas de card;
  o Guardi confere que a `list_id` do card é etapa do quadro dado, no preparo
  **e** no clique.
- **Etapa reconferida no clique:** `de` diferente da atual → recusa, nada é
  gravado. Uma etapa adiante ou atrás, conferido aqui para todos, admin incluído.
- **Ganho segue a regra mais estrita da tela**, não a da API; o cartão avisa
  da caixa do GestorHS indo ao Financeiro.
- **Card ganho/perdido:** só aceita atividade e anotação novas; `itens` e
  `anexar_proposta` são recusados.
- **Conferência da proposta:** aviso de outro cliente por dígitos do CNPJ lidos
  de `GET /clients/{id}` (o `GET` do card não traz documento); busca
  `GET /propostas?q=` com `page_size` 100 e `numero` exato.
- **Download do PDF:** só https nos hosts de `GESTORHS_API_URL`/`GESTORHS_URL`,
  porta 443, sem userinfo, sem redirecionamento, 10 MB, confere que é PDF;
  baixado no preparo (recusa cedo) e de novo no clique. O GestorHS monta o
  `link_pdf` com o `CERT_PUBLIC_BASE_URL` dele: se esse host for outro em
  produção, o anexo recusa (o piloto mostra).
- **Retorno embrulhado:** o que as ferramentas devolvem com texto externo passa
  por `como_dado_externo` (`_preparado`), também nas de GestorHS e Vendas.
- **Ligar:** `--ligar-sistema <bot> hsgrowth_servicos` (piloto) e
  `--ligar-hsgrowth-servicos` (só `service`, ensaio sem `--aplicar`).

## Fora da fase 2

- Apagar card, clonar, reabrir (mover de ganho/perdido de volta), editar
  quadro/lista, quadros livres (fora de 1 e 2).
- Propostas do HSGrowth (descontinuadas).
- Upload de arquivo qualquer (só a proposta do GestorHS); slots `os` e `oc`.
- Ligações, reuniões e e-mail pelas abas do card; cadastro de cliente/contato
  novo (ligar ao card só o que existe — a fase 1 cobre criar, para quem vende).
- Painel de gestor (Lidisay).

## Anti-objetivos

- Card mudar de etapa sem passar pelo `/move` (sem regra e sem avisar o GestorHS).
- Ganho pela API saltando etapas que a tela não deixaria.
- `business_info` perder chaves que outra pessoa gravou entre o cartão e o clique.
- Guardi de vendedor com ferramenta de Serviços, ou o inverso.

## Para o HSGrowth (soma à seção da fase 1, na mesma sessão de lá)

1. **Allowlist do token de agente, Serviços:** GET `/service-boards`,
   `/service-boards/{b}`, `/service-boards/{b}/lists`, `/service-boards/{b}/cards`,
   `/service-boards/{b}/cards/{c}`, `…/products`, `…/services`, `…/activities`,
   `/service-activities`, `/service-products`, `/services`, `/service-dashboard`;
   escrita `PUT …/cards/{c}`, `PUT …/cards/{c}/move`, `POST …/activities`,
   `PUT …/activities/{a}`, `PATCH …/activities/{a}/complete`,
   `POST …/activities/files`, `POST`/`PUT`/`DELETE …/products[/{i}]` e
   `…/services[/{i}]`. Fora (403 para agente): `DELETE` de card, clone, check,
   criar/editar/apagar/duplicar quadro e lista, `pull-devices`, `/proposals`,
   stream.
2. Token de agente em `PUT …/cards/{c}` → 403 se vier `list_id`, `position`,
   `is_deleted` ou `assigned_to_id`.
3. Expor `external_source` (e `external_id`) no `GET` do card de serviço, para o
   Guardi saber se o ganho avisa o GestorHS.
4. Rotas de item (produto/serviço) conferirem que o item é do card (vale para
   todo mundo — hoje não confere).
5. "via <bot>" na atividade (`ServiceCardActivity`) quando vier de token de agente.
6. Rotas de card de serviço devem usar `get_card_in_board` (hoje ignoram o
   `board_id`; o Guardi confere do seu lado, mas a rota deveria recusar).
7. Testes: agente `service` move com regra; `PUT` com `list_id` → 403; `DELETE`
   do card → 403; item de outro card → 404.

## Restrições

- Reaproveita o cliente HTTP, o token e a infraestrutura de cartão da fase 1.
- Ordem de produção: a mesma da fase 1 (o lado do HSGrowth sobe as duas fases
  juntas), mais `--ligar-hsgrowth-servicos` no fim.
- Construído e testado contra `MockTransport`; nada ligado antes do deploy de lá.

## Conferência

- `erick-bot`: leituras conferidas na tela (cards parados do quadro 1,
  pendências de hoje, busca por série), um cartão de registrar preparado e
  cancelado, ganho fora da última etapa recusado antes do cartão.
- Primeira escrita real com a Ellen, o André ou a Leti, acompanhada: o
  pós-contato de um card de Cobrança, conferido na tela do HSGrowth.

## Para o construtor decidir

- Nomes dos argumentos; se cliente/contato ficam no `registrar` ou numa
  ferramenta à parte.
- Teto de páginas lidas em `cards do quadro` (o quadro de Cobrança tem ~1.600
  cards) e o formato enxuto da saída.
- Como o cartão mostra a mescla do `business_info`.
