# Guardi no GestorHS, fase 2a: Expedição (design, 12/11/2026)

Continuação de `2026-11-11-guardi-gestorhs-design.md` (fase 1, consulta, no ar
para os 23 desde 11/11/2026). A fase 2 é **escrita por função** e tem três
frentes, tratadas uma de cada vez: **2a Expedição (esta spec)**, depois
Laboratório (certificado) e Serviços (proposta).

## Intenção

A Expedição (Rafael e Lucas) recebe as caixas dos clientes, abre a OS de cada
aparelho, manda a caixa ao laboratório e, quando ela volta pronta, despacha e
fecha com o código de rastreio. Hoje é tudo clicado tela a tela no GestorHS.
Uma caixa com 10 aparelhos são 10 aberturas de OS.

A ideia é a pessoa dizer ao Guardi o que chegou ("chegaram 10 bafômetros do
cliente X, séries A, B, C…, calibração"), e ele preparar tudo para ela
confirmar com um clique.

## Decisões do Erick (12/11/2026)

1. **Começar pela Expedição.**
2. **Fluxo de abertura, como é hoje:** a primeira OS é aberta **sem** caixa e o
   GestorHS cria a caixa sozinho (o número é o id). As demais OS do mesmo
   recebimento são abertas **informando essa caixa**. Um cliente que mandou 10
   aparelhos dá 10 OS na mesma caixa.
3. **Mais de um aparelho: o Guardi pergunta se veio tudo igual** (tipo de
   serviço, condição de chegada, acessórios, pilhas, bocais) ou se algum veio
   diferente. Depende do cliente, então nada de assumir.
4. **Avançar caixa** e **fechar caixa com o código de rastreio** entram.
5. **Cadastrar aparelho novo** entra. Serve à Expedição e ao Laboratório.
6. **A permissão é a função do dono no GestorHS** (decisão da fase 1, vale para
   a escrita). O Guardi faz o que a função faz, e quem confere é o GestorHS.

## O que o GestorHS já tem (lido em `~/github/GestorHS`, 12/11/2026)

- **`POST /ordens`** (`require_funcao("Expedição", "Administrador")`), corpo
  `OrdemAbrirIn`: `equipamento_cliente` (obrigatório), `tipo_servico`
  `C|M|A` (calibração, manutenção, os dois; obrigatório), `caixa` (sem ela, a
  caixa nasce na mesma transação), `data_chegada` (padrão hoje),
  `condicao_chegada` (uma de `Bom estado`, `Com avarias`, `Oxidado`,
  `Lacrado`, `Sem acessórios`), `checklist` (ids: 1 Bobinas, 2 Bocal, 3 Cabos
  USB, 4 Capa, 5 Carregador veicular, 6 Carregadores AC/DC, 7 Impressora,
  8 Maleta, 9 Nf de Remessa), `pilhas`, `bocais`, `observacoes`. Aparelho com
  OS ativa → **409**. Devolve a OS, com `caixa`.
- **`POST /caixas/{id}/avancar`** (qualquer usuário; dentro, `exige_funcao_da_fase`:
  só a função dona da fase atual, ou Administrador). Corpo `CaixaAvancarIn`:
  `obs`, `cod_retorno` (obrigatório de Preparando Retorno para Finalizada),
  `cliente_principal` (no avanço Recebido → Laboratório, obrigatório se a
  caixa tiver mais de um cliente), `sem_nota_fiscal` (só Administrador).
  Fluxo: Recebido(4, Expedição) → Laboratório(5) → Pós-Vendas(6) →
  Financeiro(10) → Preparando Retorno(7, Expedição) → Finalizada(8). Caixa
  100% módulo pula o Pós-Vendas. Recusas de regra são 409 com `detail` legível
  (desfecho de laboratório pendente, nota fiscal faltando etc.).
- **"Fechar caixa" é o mesmo `avancar`**, partindo de Preparando Retorno, com o
  `cod_retorno`.
- **`POST /equipamentos-cliente`** (`GESTOR_CADASTRO` = Administrador,
  Laboratório, Expedição), corpo `EquipamentoClienteCreate`: `cliente`,
  `equipamento` (id do modelo), `serie`, `patrimonio`, `datacompra`,
  `ult_calibragem`, `prox_calibragem`, `modulo` (padrão 0), `ativo`.
- Funções no GestorHS hoje: Expedição = Rafael e Lucas; Laboratório = Walbert,
  Paulo e Suelen.

## O que entra

Quatro ações de escrita. **Todas por cartão**, como no TaskHS: o Guardi
prepara, grava `acoes_pendentes` e mostra o cartão; o que executa é o
`payload` gravado, no clique do dono (`routers/acoes.py`, validade de 24 h).

### 1. Receber aparelhos (abrir OS em lote)

- Uma ferramenta, um cartão para o lote inteiro (1 a N aparelhos de um mesmo
  recebimento).
- O agente manda a lista de aparelhos (id do aparelho na frota) e, para cada
  um, tipo de serviço, condição, acessórios, pilhas, bocais e observação. Pode
  mandar **uma caixa já existente** para acrescentar aparelhos a ela (chegou
  mais um da mesma remessa).
- **Caixa existente, em qualquer fase ativa** (decisão do Erick, 12/11): a OS
  nova entra na fase em que a caixa está, que é o que o GestorHS já faz. Fora
  de Recebido, o cartão avisa em destaque: "a OS já entra em <fase>". Caixa
  Finalizada, Cancelada ou sem fase é recusada antes do cartão.
- **Clientes misturados podem** (decisão do Erick, 12/11; hoje há 93 caixas
  assim). O cartão mostra o cliente em cada linha e, quando houver mais de um,
  avisa "caixa com N clientes". No avanço de Recebido, o Guardi pergunta o
  cliente principal.
- **Antes do cartão**, o servidor confere cada aparelho no GestorHS (existe, de
  qual cliente, se tem OS ativa) e recusa o lote inteiro nomeando o problema.
  Assim o cartão nunca promete o que o GestorHS vai recusar.
- O cartão mostra uma linha por aparelho (modelo, série, cliente) com o que vai
  em cada um, e diz "caixa nova" ou "caixa N".
- **Execução:** primeira OS sem caixa (ou com a caixa informada), as demais com
  a caixa que voltou da primeira, em ordem.
- **Falha no meio:** para no primeiro erro e responde quais OS foram abertas, em
  qual caixa, e qual aparelho falhou e por quê. **Não desfaz.** OS aberta é
  registro, e a pessoa decide o resto. Isso fica registrado como `erro` com o
  texto completo, para o cartão mostrar. *(Chamada do Claude: sem estado novo
  de "parcialmente feito". O `erro` hoje é cortado em 300 caracteres em
  `routers/acoes.py` e passa a caber o texto do lote, até 2.000. A frase começa
  por "Parou no aparelho N de M", e o cartão mostra o texto como está.)*
- O agente **pergunta antes de preparar**, com mais de um aparelho, se veio
  tudo igual (decisão 3). Isso mora no `AGENTS.md` e na descrição da
  ferramenta.

### 2. Avançar caixa

- Cartão com a caixa, a fase atual e a próxima, e quantas OS andam junto.
- Vale para **qualquer função dona da fase** (o GestorHS confere): a Expedição
  em Recebido, o Laboratório, o Pós-Vendas e o Financeiro nas deles. É o mesmo
  endpoint, então o custo é zero. *(Chamada do Claude, pela decisão 6.)*
- **Antes do cartão**, o servidor lê a caixa. Se ela tiver mais de um cliente e
  estiver em Recebido sem cliente principal, a ferramenta pede o
  `cliente_principal`. Se estiver em Preparando Retorno, recusa e manda usar
  "fechar caixa". Não tenta prever as outras recusas de regra (desfecho de
  laboratório, nota fiscal): o 409 do GestorHS volta no cartão com o `detail`
  dele.
- `sem_nota_fiscal` **fica fora**. É exceção de Administrador para caixa antiga.

### 3. Fechar caixa (com rastreio)

- Ferramenta própria, para o agente não confundir com avançar: exige o
  `cod_retorno` e só aceita caixa em Preparando Retorno.
- Cartão: caixa, cliente, quantas OS, código de rastreio.

### 4. Cadastrar aparelho

- Cliente (id), modelo (id, de `modelos`), série, patrimônio, data de compra e
  datas de calibração opcionais.
- **Antes do cartão**, o servidor procura a série na frota (`q`). Se já existir,
  recusa dizendo de qual cliente é. Cadastro duplicado é o erro mais provável
  de quem fala "cadastra o bafômetro série X".
- Depois de cadastrado, o agente pode emendar o recebimento (ação 1) com o
  aparelho novo, em **outro** cartão. *(Chamada do Claude: dois cartões, porque
  o cadastro existe sozinho e o lote o referencia pelo id.)*

## Fora desta fase

- Cliente novo: continua pela tela. *(Chamada do Claude: é cadastro com CNPJ,
  endereço e integrações, e não foi pedido.)*
- Editar ou cancelar OS, mover OS entre caixas, transferir aparelho, fotos,
  nota fiscal, `sem_nota_fiscal`.
- Laboratório (certificado) e Serviços (proposta): próximas specs.

## Anti-objetivos

- Uma escrita sem o clique do dono.
- Dez cartões para uma caixa de dez aparelhos.
- O Guardi assumir que veio tudo igual sem perguntar.
- O HS.OS decidir quem pode o quê. Quem decide é a função no GestorHS.
- Desfazer sozinho o que já foi aberto quando o lote falha no meio.

## Restrições

- **Território:** a mudança no GestorHS é feita na sessão daquele repo (seção
  abaixo).
- Payload com IDs inteiros e textos curtos. `observacoes` e `obs` até 500
  caracteres; `cod_retorno` até 60; lote de 1 a 30 aparelhos. *(Tetos são
  chamada do Claude.)*
- Execução chamada **como o dono** (token de agente), com a auditoria de sempre
  (`agente_chamadas`). Timeout num POST vira "não sei se foi feito, confira
  antes de repetir" (`chamar_sistema` já faz isso).
- Ferramenta nova no `hsos-bot-<bot>` exige `publicar-bots-mcp.py --aplicar`
  (`FERRAMENTAS_BOT`). Ponteiro no `AGENTS.md` do template, medido contra o
  teto de 20.000 caracteres.
- As ferramentas de escrita existem para todo Guardi com `gestorhs` ligado. Quem
  não tem a função leva a recusa do GestorHS (403, traduzido em "a sua função no
  GestorHS não permite isso"), e isso é o certo pela decisão 6. A mensagem tem
  que dizer **qual função** faz aquilo, quando der para saber (avançar: a dona
  da fase).

## Para o GestorHS (sessão no repo `~/github/GestorHS`)

1. **Abrir a allowlist do token de agente para estas escritas, e só elas:**
   `POST /ordens`, `POST /caixas/{caixa_id}/avancar`,
   `POST /equipamentos-cliente`. Nelas a trava "só GET" da fase 1 cede, e daí
   em diante vale o `require_funcao` / `exige_funcao_da_fase` de cada rota, com
   a função do dono. Toda outra escrita continua 403 para o agente.
2. Para token de agente em `POST /caixas/{id}/avancar`, recusar
   `sem_nota_fiscal = true` (403), mesmo que o dono seja Administrador.
3. No log da OS (`registrar_log`) e no `LogOS`, quando vier de token de agente,
   acrescentar ao texto "via <bot>" (o `act.sub` que a fase 1 já guarda no
   request). Assim o histórico mostra que foi pelo Guardi.
4. Testes: agente com função Expedição abre OS e avança caixa em Recebido;
   agente com função Consulta → 403 nas três; agente Laboratório avança caixa
   em Laboratório e leva 403 em Recebido; `sem_nota_fiscal` → 403; outra
   escrita (ex.: `POST /caixas/{id}/cancelar`) → 403; o log traz "via".
5. Changelog e deploy pelo fluxo de lá. ⚠️ O deploy é no serviço
   **`gestorhs-api`**, não só no `gestorhs-sistema`.

## Ordem de construção

O lado do GestorHS (seção acima) é **pré-requisito** e vai como prompt para a
sessão daquele repo. O HS.OS é construído e testado em paralelo contra um
servidor falso (`MockTransport`), como na fase 1. Nada é ligado antes do deploy
do `gestorhs-api` com a allowlist nova.

## Conferência

Decisão do Erick (12/11): **sem teste artificial em produção.**
- Antes: no `erick-bot`, só o que não escreve. Preparar o cartão de um
  recebimento e **cancelar** o cartão; pedir para fechar uma caixa que não está
  em Preparando Retorno (recusa antes do cartão). No Guardi de um Consulta,
  pedir para abrir OS deve dar recusa citando a função.
- A primeira escrita é **um recebimento real com o Rafael ou o Lucas**,
  acompanhado, conferido na tela do GestorHS (OS, caixa, log "via <bot>").

## Para o construtor decidir

- Nomes das ferramentas e o desenho exato dos argumentos (lista de aparelhos
  com valores comuns + exceções, ou um objeto por aparelho).
- Como o cartão mostra o lote (texto do `resumo` ou estrutura nova). Se precisar
  de mudança no front do cartão, mantê-la mínima.
- Como o agente acha o id do aparelho a partir da série que a pessoa fala (a
  consulta `aparelhos` com `q` já resolve).
