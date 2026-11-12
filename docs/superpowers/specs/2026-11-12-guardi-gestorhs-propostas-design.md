# Guardi no GestorHS, fase 2c: Serviços / propostas (design, 12/11/2026)

Última frente da fase 2. Reaproveita a infraestrutura da 2a e da 2b: cartão em
`acoes_pendentes`, executores em `app/acoes.py`, `gestorhs.chamar(..., metodo=,
json=)`, regras puras em `app/gestorhs_escrita.py`, e a permissão pela função do
dono no GestorHS. Propostas: `require_funcao("Comercial Pós-Vendas",
"Administrador", "Financeiro")`. Hoje são Ellen, Leticia, André (Serviços), mais
Djalma, Leandro e Lidisay (Financeiro).

## Intenção

Toda a negociação acontece no **WhatsApp** com o cliente: quais aparelhos
calibrar, desconto, condição de pagamento, endereço. Depois alguém de Serviços
passa isso para o formulário de proposta do GestorHS, campo a campo. São ~150
propostas por mês. **Boa parte nasce só com o básico e é ajustada até a versão
final.**

O Guardi recebe o que o cliente pediu **contado com as palavras da pessoa**
(não o print da conversa), monta a proposta pelo padrão da casa e **lembra o que
ficou faltando ou fugiu do padrão**. Depois altera a mesma proposta conforme o
cliente pede mudanças.

## Decisões do Erick (12/11/2026)

1. A pessoa conta o pedido com as próprias palavras. Não se cola o WhatsApp.
2. O Guardi usa **o padrão das propostas que já existem** e lembra o
   funcionário do que faltou ou do que está diferente.
3. **Criar e alterar** proposta. Alterar acontece sempre.

## O que o reconhecimento mostrou (12/11/2026)

**Padrão real** (559 propostas ativas dos últimos 120 dias, banco `gestorhs`):

| campo | padrão |
|---|---|
| `validade_dias` | 30 (541 de 559) |
| `observacoes` | o texto fixo `DEFAULT_NOTES` (541) |
| `desconto` | 0 (só 3 com desconto) |
| `frete` | tabela por região do modelo: Norte 200, Nordeste 150, Sul 250, Sudeste 200, Centro-Oeste 200 (333 com 200; 134 com 0) |
| `condicao_pagamento`, `forma_envio`, `forma_frete`, `transportador` | quase sempre em branco |
| `vendedor` | quem cria (o GestorHS grava o nome do usuário; imutável) |
| itens | do catálogo `GET /servicos` (`sku`, `nome`, `preco`): calibração com gás 395 (442×), módulo Phoebus 625,40, célula 650, coifa 80, preventiva 175 |
| `outros_itens` | HTML do modelo `buildDefaultOtherItems(modelo, aparelhos)` (serviço, valor, SEDEX, frete e prazo por região, CNAEs, endereço de envio, contato) |

**Dois modelos de `outros_itens`, escolhidos à mão na tela** (mesmos 120 dias):
`buildDefaultOtherItems` (o padrão, com "Calibração / R$ 395,00" fixos e a
tabela de frete) e `buildPhoebusOtherItems` (88 propostas, frete incluso, com
lacunas "[Inserir número]"/"R$ ____" que ficam sem preencher em 82 delas).
**Frete 0** em 122: 79 são Phoebus (frete incluso); 43 do modelo padrão.
O catálogo da tela busca em `GET /servicos` **e** `GET /produtos` (221 produtos).

⚠️ **O padrão mora no FRONT do GestorHS** (`frontend/src/app/propostas/propostaDefaults.ts`
e `PropostaModal.tsx`), não no servidor.

**Escrita:**
- `POST /propostas` (`PropostaCreate`): `itens` (`descricao`, `sku`,
  `quantidade`, `unidade`, `preco_un`), `aparelhos` (`equipamento_cliente`),
  `destinatario`, `contato`, `data`, `intro`, `outros_itens`, `desconto`,
  `frete`, `forma_envio`, `forma_frete`, `transportador`, `condicao_pagamento`,
  `validade_dias`, `data_entrega`, `descricao_entrega`,
  `endereco_entrega_diferente`, `endereco_entrega`, `observacoes`,
  `assinatura`. Número sequencial gerado lá.
- `PUT /propostas/{id}` (`PropostaUpdate`): todos opcionais; **`itens` e
  `aparelhos`, se vierem, substituem a lista inteira**. **Toda alteração
  arquiva uma versão** com o PDF da anterior (`PropostaVersao`). Proposta
  desabilitada → 409.
- ⚠️ **`destinatario` ESCREVE NO CADASTRO** do cliente ou empresa (nome,
  documento, endereço, e-mail, telefone) e agenda sincronização com o **Tiny
  (ERP)**. O `nome` é obrigatório no `DestinatarioIn`: mandar um nome diferente
  renomeia o cliente.

## O que entra

### 1. Criar proposta

- A pessoa conta: cliente, aparelhos (ou "os bafômetros dele"), serviços, e o
  que mais o cliente disse (pagamento, desconto, entrega).
- **Antes do cartão**, o servidor:
  - acha o cliente (ou empresa) **já cadastrado** e os aparelhos dele no
    GestorHS;
  - monta os itens a partir do **catálogo**, serviços e produtos (`sku`, nome e
    preço de lá). Se a
    pessoa disser um preço, ele vai, mas marcado como diferente do catálogo;
  - preenche o padrão (validade, observação, `outros_itens` com modelo e
    aparelhos, frete). **Modelo:** Phoebus se algum item for de módulo
    Phoebus, senão o padrão. As lacunas do Phoebus ficam como a tela deixa,
    com um lembrete. **Frete:** Phoebus → 0 (incluso); padrão → tabela pela
    região do estado do cliente. *(Chamadas do Claude, tiradas dos dados.)*
  - calcula o total (itens − desconto + frete), do mesmo jeito que o GestorHS
    calcula;
  - compara com o padrão e com **a última proposta desse cliente**, e monta a
    lista de **lembretes**.
- **Lembretes** (o "lembrar o funcionário" da decisão 2), cada um uma linha no
  cartão e também devolvidos ao agente, para ele perguntar antes de preparar,
  se quiser:
  - frete diferente da tabela para o estado do cliente (só no modelo padrão;
    frete 0 vira "cliente retira?"), ou estado desconhecido;
  - lacunas do modelo Phoebus sem preencher;
  - preço de item diferente do catálogo;
  - desconto (raro);
  - condição de pagamento diferente da última proposta **do mesmo destinatário**
    (cliente ou empresa/filial, não a matriz); *(chamada do Claude)*
  - aparelho ativo do cliente, com calibração vencida ou vencendo em 90 dias,
    que ficou fora da proposta;
  - entrega em endereço diferente do cadastro.
  Lembrete **não bloqueia**: é aviso. *(Chamada do Claude.)*
- O cartão mostra cliente, itens (quantidade × preço = total da linha), aparelhos
  (modelo e série), frete, desconto, total, validade, pagamento e os lembretes
  em destaque.
- **Execução:** `POST /propostas`. Devolve número e `link_pdf`.

### 2. Alterar proposta

- "Na proposta 1234, troca o pagamento para 60 dias e tira o aparelho F3."
- **Antes do cartão**, o servidor lê a proposta (`GET /propostas/{id}`), aplica
  a mudança pedida e monta o **antes → depois** só do que muda. Se mexer em
  itens ou aparelhos, manda a lista **inteira** resultante, como o `PUT` exige,
  e o cartão mostra o que entra e o que sai. Recalcula o total e refaz os
  lembretes sobre o resultado.
- **`outros_itens` na alteração:** se os aparelhos mudarem e o texto ainda for
  o do modelo gerado para os aparelhos antigos, refaz pelo modelo. Se alguém
  editou o texto à mão, **não toca** e põe o lembrete "o texto de outros itens
  foi editado na tela: confira modelo e séries". *(Chamada do Claude.)*
- **Destinatário não muda pela alteração.** Trocar cliente ou empresa fica pela
  tela. *(Chamada do Claude.)*
- Recusa proposta desabilitada e faturada. *(Chamada do Claude: faturada é
  assunto do Financeiro.)*
- **Execução:** `PUT /propostas/{id}` com só os campos que mudam. O GestorHS
  arquiva a versão anterior sozinho. Devolve o `link_pdf` novo.

## Fora desta fase

- **Cadastro do cliente pelo Guardi**: nome, documento, endereço, e-mail e
  telefone do destinatário, e "nova empresa". *(Chamada do Claude: isso
  sincroniza com o Tiny.)* Cliente novo continua pela tela.
- Duplicar, desabilitar, faturar e desfaturar proposta.
- Enviar a proposta ao cliente (WhatsApp ou e-mail). O Guardi devolve o link e a
  pessoa manda.
- Ler a conversa do WhatsApp.

## Anti-objetivos

- O Guardi renomear ou alterar o cadastro de um cliente ao montar uma proposta.
- Lembrete que trava a proposta.
- Um `PUT` que apaga itens ou aparelhos porque mandou a lista pela metade.
- O padrão do HS.OS divergir do padrão da tela do GestorHS.
- O modelo fazer a conta do total.

## Restrições

- Cartão sempre. Executor só com o `payload` gravado. Corpo por lista fixa de
  chaves.
- Itens: até 30; quantidade > 0; preço ≥ 0. `desconto` e `frete` ≥ 0.
  `observacoes`, `intro`, `condicao_pagamento`, `descricao_entrega` com teto de
  tamanho. `outros_itens` só o do padrão, nunca texto livre do agente.
  *(Chamada do Claude: o HTML vai ao PDF do cliente.)*
- Ações: `criar_proposta`, `alterar_proposta`. Ferramentas:
  `gestorhs_criar_proposta`, `gestorhs_alterar_proposta`.
- Total calculado no servidor, em `Decimal`, 2 casas.

## Para o GestorHS (sessão no repo `~/github/GestorHS`)

1. **Servir o padrão** numa rota de leitura, `GET /propostas/padrao`, com o que
   hoje vive em `propostaDefaults.ts` e no `PropostaModal`: observação padrão,
   validade, a tabela de frete por região (com a lista UF → região) e os **dois**
   `outros_itens` (padrão e Phoebus) montados para `?modelo=&aparelhos=`. A tela passa a usar a
   mesma fonte, para não haver duas cópias.
2. Allowlist do token de agente: `POST /propostas`, `PUT /propostas/{id}` e, na
   leitura, `GET /propostas/padrao`, `GET /servicos` e `GET /produtos`. Vale o `_escrever`
   (Comercial Pós-Vendas, Financeiro, Administrador) com a função do dono.
3. **Para token de agente, `destinatario` NÃO toca no cadastro:** aceitar só
   `{tipo: "cliente"|"empresa", id}` e vincular como o caminho do duplicar
   (`vinculo`, cópia congelada do cadastro atual). Qualquer outro campo do
   destinatário, ou `nova_empresa`, vira 403. No `PUT`, o agente não manda
   `destinatario` (403 se mandar). Nada agenda sync com o Tiny a
   partir do agente.
4. Para token de agente, `PUT` recusa proposta faturada (409).
5. "via <bot>" no log ou na versão da proposta, em `alterado_por`.
6. Testes: Pós-Vendas e Financeiro criam e alteram; Laboratório, Expedição e
   Consulta → 403; destinatário com nome ou endereço via agente → 403 e o
   cadastro não muda; o `PUT` do agente arquiva a versão; faturada → 409.
7. Changelog e deploy do **`gestorhs-api`** (e do `gestorhs-sistema`, se a tela
   passar a ler o padrão da rota).

## Conferência

- No `erick-bot`: preparar o cartão de uma proposta para um cliente real e
  **cancelar**. Conferir o total, o frete do estado e os lembretes (forçar um
  com preço fora do catálogo). Preparar uma alteração numa proposta existente e
  **cancelar**.
- Primeira escrita real **com a Ellen, a Leticia ou o André**, acompanhada.

## Para o construtor decidir

- Como o agente identifica o cliente pelo que a pessoa diz (`clientes q=`) e o
  que fazer com mais de um resultado (perguntar).
- Como casar o serviço falado ("calibração", "troca de célula") com o catálogo.
  Ambíguo → o agente pergunta.
- Formato do "antes → depois" no cartão da alteração.
- O estado (UF) do cliente: de onde vem no `GET /clientes/{id}`.
