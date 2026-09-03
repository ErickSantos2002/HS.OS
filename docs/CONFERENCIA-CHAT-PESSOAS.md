# Conferência — a volta do chat entre pessoas (02/09/2026)

A Tarefa 8 do plano `superpowers/plans/2026-09-01-chat-entre-pessoas-e-membros.md`.
Não muda comportamento: mede. Este arquivo registra o que foi batido, com que
resultado, e — a seção que vale mais daqui a um mês — **o que não foi conferido**.

---

## 1. As migrações, em produção

Aplicadas em 02/09/2026 pelo Erick, no Konsole, com `~/aplicar-hsos-014-015.sh`.
Conferido depois por leitura no banco, com o usuário de leitura do cadastro
único:

| objeto | antes | depois |
|---|---|---|
| função `pode_ver_agente` | 0 | **1** |
| função `exige_acesso_ao_agente_no_canal` | 0 | **1** |
| trigger `exige_acesso_ao_agente_no_canal_trigger` | 0 | **1** |
| policy `Only admins create channels` | 0 | **1** |
| policy `Authenticated users create channels` (a permissiva) | 1 | **0** |
| canais | 3 | **1** (`teste 2`, zero mensagens) |

Os dois canais DM órfãos — um com o dono do repositório sozinho, outro apontando
para alguém que não tem conta — foram apagados no mesmo script, pela guarda que
só apaga canal `dm` com zero mensagens.

## 2. As 27 contas

Criadas em 02/09/2026 pelo Erick com `~/criar-contas-hsos.sh` (login, token,
`--conferir`, confirmação e só então a criação). Senhas para o FortiPAM: cada
uma aparece uma vez e o backend guarda só o hash.

Conferido por leitura, e **não só pela contagem** — a régua da casa é que contar
linha não é conferir dado:

- **27 perfis**, 0 sem setor, 0 sem cargo, 0 e-mail repetido
- **13 setores e 21 cargos distintos** em 27 nomes distintos — se o script
  tivesse chumbado campo, esses números viriam colados
- `user_roles`: **26 colaborador + 1 administrador**
- `auth.users`: 27, todos ativos e todos com hash de senha
- do quadro do TalentHS não sobrou ninguém sem conta

Três perfis foram abertos e olhados campo a campo (laboratório, suporte,
marketing): nome, setor e cargo batem com o TalentHS.

## 3. O invariante, provado no banco

Banco de rascunho descartável (`scripts/banco-rascunho.sh`), migrations 001→015
aplicadas do zero:

| prova | resultado |
|---|---|
| `backend/scripts/provar_invariante.py` — a consulta que a rota roda | **4/4 casos** |
| `migrations/_testes/014_acesso_a_agente.test.sql` — função e trigger | **passou** |
| `migrations/_testes/015_quem_cria_canal.test.sql` — policy, e o DM que continua nascendo | **passou** |
| `pytest` do backend | **101 passed** |

Os quatro casos do `provar_invariante.py` incluem **os dois que devem passar**
(par que fecha; canal sem agente nenhum), não só os que devem recusar — regra
que recusa tudo passa em qualquer teste que só procure recusa.

O caso 3 é o que importa mais: `INSERT` direto em `channel_members`, sem passar
por endpoint nenhum, é recusado. Quem segura é o **trigger**, não o Python.

⚠️ **Gotcha do rascunho:** a porta padrão do script (5433) estava ocupada pelo
container `docshs-banco`. Rodar com `PORTA=5439 bash scripts/banco-rascunho.sh`.

## 4. O deploy — e a pergunta que o método errado não respondia

**O backend novo não estava em produção.** A versão anterior desta conferência
registrou "não sei", porque a pergunta tinha sido feita comparando o
`openapi.json` dos dois lados: 195 rotas iguais, nenhuma diferença. Era o método
errado — esta entrega não criou rota nenhuma, mudou o **comportamento** dentro
das que já existiam.

O método certo é uma rota cujo comportamento mudou. `POST /conversations/dm/abrir`
exigia `administrador` até o commit `572807d` e deixou de exigir depois. Com
token de colaborador, produção respondeu:

```
{"detail":"Permissão insuficiente para esta operação."}   [403]
```

Essa é a mensagem do `exige_papel` — a guarda que a versão de hoje não tem. Uma
chamada, e a pergunta que a comparação de rotas não respondia em duas telas
ficou respondida. Os dois **500** do Passo 1 confirmaram pelo outro lado: as
migrações estavam aplicadas no banco, e o backend velho não sabia traduzir nem o
`HS001` nem a recusa da policy.

Efeito prático enquanto durou: o front já mostrava a lista de pessoas, e a rota
recusava — **nenhum colaborador conseguia abrir uma conversa.**

⚠️ **Regra que fica:** para saber se um backend subiu, bater numa rota cujo
comportamento mudou. Contar rotas responde outra pergunta.

Depois disso o backend foi deployado duas vezes (a segunda com as correções da
seção 7), e cada deploy foi confirmado do mesmo jeito, por comportamento.

## 5. As rotas, com token de colaborador (Passo 1)

Token emitido na mão com o `emitir_token` do próprio repositório — o
`JWT_SECRET` local é o mesmo da produção, então não foi preciso senha de
ninguém. Colaboradora escolhida: uma das 26 contas novas, que não está no
`allowed_user_ids` de nenhum dos cinco agentes.

| chamada | esperado | veio |
|---|---|---|
| `POST /channels` | 403 | **403** |
| `POST /conversations/dm/abrir` com outra pessoa | 200 | **200**, com `channel_id` |
| `POST /channels/{canal alheio}/members` | 403 | **404** — ver abaixo |
| `POST /channels/{canal dele}/members` | 403 | **403** |
| `GET /channels/dms/interlocutores` | 200 | **200** |

**O 404 é melhor que o 403 que o plano previa.** O canal é privado e o RLS o
esconde de quem não é membro: o backend não sabe que ele existe. Recusa igual, e
sem confirmar a existência do canal para quem está de fora.

⚠️ **A primeira conversa entre duas pessoas deste sistema aconteceu aqui.** O
`POST /conversations/dm/abrir` criou o canal `dm` e as duas linhas de membro. Até
02/09/2026 aquele caminho nunca tinha rodado em produção.

## 6. O invariante contra a API de produção (Passo 2)

Com token de administrador, um canal limpo por caso — a primeira tentativa
usou um canal só para os quatro e **as duas primeiras linhas se contaminaram**:
o agente posto no caso 1 fazia o caso 2 ser recusado com razão. O resultado
abaixo é o da segunda rodada, com um canal por caso.

| tentativa | esperado | veio |
|---|---|---|
| juntar pessoa e agente que ela **pode** ver | 204 | **204** |
| juntar outra pessoa e outro agente que ela **pode** ver | 204 | **204** |
| pôr no canal quem **não** vê o agente que já está lá | 403 | **403**, nomeando pessoa e agente |
| pôr no canal um agente que um membro **não** vê | 403 | **403**, idem |

As duas primeiras linhas valem tanto quanto as duas últimas: regra que recusa
tudo passa em qualquer teste que só procure recusa.

A mensagem das recusas nomeia as duas pontas — "Fulana não tem acesso ao agente
Nina. Libere o acesso na tela do agente antes de juntar os dois no mesmo canal."
— que era o ponto de `_primeiro_par_sem_acesso` existir em vez de deixar o
trigger responder "alguém neste canal".

## 7. Três defeitos que a conferência achou, e que já estão corrigidos

Esta seção é o motivo de a Tarefa 8 existir. Nenhum dos três apareceria em teste
de unidade, e os três estavam **no ar**.

**a) `POST /channels` respondia 500: ninguém criava canal.** Desde a `015` o
administrador é o único que pode criar canal, e para ele a rota estourava — o
colaborador só via 403 porque o `exige_papel` corta antes do banco. A causa não
era policy nenhuma: era a forma do `INSERT` do primeiro membro. Nomear o alvo do
conflito (`ON CONFLICT (channel_id, user_id)`) faz o Postgres sondar o índice
único, e a sondagem exige SELECT na tabela; a policy de SELECT de
`channel_members` só deixa ver quem já é membro do canal, e num canal
recém-nascido o criador ainda não é — é justamente a linha que ele está
inserindo. Ovo e galinha, e só na primeira linha de um canal novo, que é por que
`adicionar_membros` (que já usava a forma sem alvo) nunca mostrou o defeito.
Havia **três cópias** desse `INSERT`; agora é uma constante só. Commit `17aa3ea`,
prova em `backend/scripts/provar_criacao_de_canal.py`.

**b) `allowed_user_ids` não valia fora do canal.** Nenhuma das rotas
`/conversations/{agent_id}` chamava `pode_ver_agente` — só `usuario_atual`. O
`GET /agents` filtra a lista, então o agente some da tela; `GET /conversations/atlas`
respondia **200** para quem não tem acesso ao atlas. A `014` fechou a porta do
canal e deixou esta aberta. É literalmente o "escondi o botão na tela mas deixei
a rota aberta" que o Passo 1 existe para pegar. Nove rotas passaram a depender de
`agente_visivel`; a décima (o `DELETE`) já era do administrador, que passa por
cima da regra. Commit `c40e408`.

**c) DM virava canal de grupo.** `POST /channels/{id}/members` isentava canal
`dm` do guarda de administrador, e um colaborador punha uma terceira pessoa
dentro de uma conversa de dois — canal de grupo sem passar por "só admin cria
canal de grupo", e com `type = 'dm'`, que a tela de DM não sabe desenhar.
Descoberto **executando**: a chamada veio 204 e o DM de produção ficou com três
humanos. Commit `c40e408`.

⚠️ **Medido antes de fechar a porta (b).** Das mensagens em `conversations`,
**nenhuma** é de alguém que não pode ver o agente com quem falou — o guarda não
tirou conversa de ninguém. Fechar acesso sem contar quem perde é como se derruba
usuário legítimo achando que se está corrigindo um furo.

## 8. A conversa na tela, com duas contas (Passo 4)

Duas janelas do Chrome, contextos isolados, token emitido localmente e injetado
em `localStorage` sob a chave `hsos.token` — as senhas das 27 contas foram para
o FortiPAM e o backend guarda só o hash. Duas colaboradoras de verdade: uma que
vê os cinco agentes, outra que vê dois.

| o que se olhou | resultado |
|---|---|
| DM: mensagem aparece na tela da outra **sem recarregar** | **sim**, nos dois sentidos |
| tempo de entrega, 6 medições | 5 abaixo de **1s**; uma em **11,6s**; uma **não chegou em 25s** |
| as mensagens que demoraram foram perdidas? | **não** — 15 de 15 gravadas em `channel_messages` |
| "está digitando" | **acende** |
| não-lidas | **conta**, com o número na lateral e nas abas |
| canal de grupo entre duas pessoas | **funciona** |
| agente mencionado dentro do canal | **não é acionado** — ver abaixo |

⚠️ **O realtime entrega rápido quase sempre, e trava de vez em quando.** Cinco de
seis entregas abaixo de um segundo, e duas fora da curva (11,6s e uma acima de
25s). Nada se perde: a mensagem está no banco e aparece ao recarregar — o defeito,
quando acontece, é só na tela de quem está esperando. Medir uma vez teria dado
"funciona"; medir seis foi o que mostrou a cauda.

⚠️ **O "está digitando" só existe em DM.** É ligado por
`useTypingActivity(dmChannels…)` e desenhado na lista lateral — dentro de um
canal de grupo ele não existe. A primeira medição deu "falhou" porque eu o
procurei no lugar errado; o defeito era do teste, não do produto.

### O agente não respondia quando era mencionado no canal — duas causas, corrigidas

Embaixo do campo de texto, o canal diz: *"Use @flow para mencionar um agente —
ele só responde quando for mencionado."* Mencionar não fazia nada. Eram **dois**
defeitos independentes, e cada um sozinho já bastava.

**a) A tela não chamava a rota.** Observando a rede, o envio produzia
`POST /channels/{id}/messages` e `POST /channels/{id}/notificar`, e nunca
`POST /channels/{id}/agentes/{agent_id}/responder`. O gatilho existia e estava no
caminho (`ChatPage` renderiza `ChannelChat`, que chama
`startChannelAgentReplies`); ele filtrava os membros do canal por
`isOfficialAgentId`, que consulta um catálogo montado de `GET /agents`
**filtrando por `isOfficial`**. E `agent_profiles.is_official` é coluna herdada do
schema Supabase (`001`, `DEFAULT false`) que **nada no backend jamais escreve**:
`GET /agents` devolvia os cinco agentes da casa, todos com `isOfficial: false`.
Catálogo vazio, ninguém "oficial", ninguém responde. O filtro ainda era
redundante — `/agents` seleciona de `agent_profiles`, então ter perfil é ser do
catálogo. Commit `b6c07eb`.

**b) A chave de sessão tinha a forma errada.** Com a rota chamada na mão, o
backend aceitava (202) e publicava no canal o aviso de falha, **8 segundos
depois** — e não os 140s do `agent.wait`, que era a hipótese óbvia. Nenhuma
sessão nascia no gateway. O gateway extrai o agente da própria chave e a confere
contra o `agentId`; o canal mandava `channel:{id}:{agente}:{uuid}` e ouvia:

```
agentId "flow" does not match session key "channel:b6de841a-…:flow:…"
```

Medido contra o gateway de produção antes de corrigir: forma antiga recusada em
0,7s, forma corrigida com `chat.send` em 0,6s, `agent.wait` devolvendo `ok` em
9,8s e o texto `pong`. A Arena tinha o mesmo defeito e devolvia 502. Três lugares
montavam chave e só um sabia da regra. Commit `475e176`.

**Conferido na tela depois do deploy:** duas menções, duas respostas certas, em
**7 segundos** cada — `@flow responda apenas com a palavra: alfa371729` → `alfa371729`,
e `@flow responda apenas: pong 757509` → `pong 757509`, com o indicador de
"trabalhando" acendendo entre as duas.

⚠️ **Uma resposta fora do lugar, não reproduzida.** Numa das medições o agente
respondeu à instrução de uma mensagem **anterior** do canal (o contexto enviado
são as últimas 30). Na medição limpa seguinte, com outra instrução no histórico,
ele respondeu à mensagem certa. Fica registrado como visto uma vez e não
reproduzido — o prompt manda "responda à última mensagem" sem marcar qual é ela.

⚠️ A correção (a) revive mais coisa que a menção: `use-agents` e `use-results`
também filtram por `isOfficialAgentId` e vinham recebendo lista vazia. A tela de
Monitoramento não foi conferida depois disso.

---

## O que NÃO foi conferido

Esta seção existe porque `docs/VARREDURAS-2026-08-31.md` registra duas varreduras
que deram limpo por fraqueza do método. Escrever o que ficou de fora é o que
impede alguém de confiar numa conferência que não conferiu.

**A resposta do agente vista por DUAS pessoas ao mesmo tempo.** A menção foi
conferida na tela, mas com uma janela só. Que a resposta do agente chegue à
segunda pessoa do canal pelo realtime não foi observado — e é justamente onde a
seção 8 já registra que a entrega tem cauda.

**A tela de Monitoramento depois do catálogo voltar a existir.** `use-agents` e
`use-results` filtravam por `isOfficialAgentId` e recebiam lista vazia; com o
catálogo populado elas passam a devolver os cinco agentes. Ninguém abriu essas
telas para ver o que mudou.

**A cauda do realtime não tinha causa; passou a ter em 03/09/2026.** Eram duas,
e a primeira suspeita registrada aqui — "reconexão de websocket" — estava certa:
o `onclose` de uma conexão substituída agendava outra reconexão, que derrubava a
saudável, em cascata (**7 sockets em 60s** a partir de uma troca de canal); e não
havia vigia de silêncio, então conexão morta com `readyState` OPEN deixava a aba
surda. A escada de espera é 1, 2, 4, 8, 16, 30s, e 11,6s cai entre 8 e 16.
Consertado em `2d7f432`, com teste.

⚠️ **Continua sem prova de que foram estes defeitos que produziram aquelas duas
medições** — só de que eles existem e dão exatamente este sintoma. A confirmação
é medir de novo com uso real, **trocando de canal**, que é o gatilho da cascata.

**Só duas contas, num navegador só.** Chrome, dois contextos isolados. Nada foi
visto em Firefox, em celular, nem com mais de duas pessoas no mesmo canal.

**O que a tela faz além de texto** — anexo, áudio, GIF, thread, reação, edição e
exclusão de mensagem — não foi tocado. O Passo 4 pedia a conversa; foi a conversa
que se mediu.

**`GET /gateway/config` responde 403 para colaborador, e a tela chama assim
mesmo.** Aparece no console de toda sessão que não é de administrador. Não
quebra nada visível e é anterior a esta entrega, mas é barulho que esconde erro
de verdade — quem for depurar essa tela vai tropeçar nele primeiro.

**Sujeira deixada em produção pelos testes: limpa, e conferida por leitura.**
Saíram os quatro canais `conferencia-*` e os dois DMs de teste — inclusive o que
tinha ganhado uma terceira pessoa pela chamada que revelou o defeito (c).
Produção voltou ao estado anterior: **um canal** (`teste 2`) e **zero mensagens**
em `channel_messages`.

⚠️ Apagar o DM entre as duas contas de teste **deu 404 com token de
administrador** e só funcionou com a conta que o criou. É o mesmo RLS da seção 5:
o admin não é membro daquele DM, então ele não existe para ele. Vale saber antes
de tentar limpar DM alheio pelo caminho óbvio.

## Achado de segurança, de brinde

A senha antiga do superusuário do Postgres — a que vazou em três repositórios
públicos em set/2026 — **não autentica mais** em `62.72.11.28:2222`. A rotação,
que a memória dava como pendente desde ago/2026, foi feita. Conferido só nesse
host, porta e banco: os outros bancos da empresa continuam por confirmar.

Efeito colateral: `backend/.env.superusuario` (fora do git) ficou com a senha
morta dentro. Vale apagar — arquivo cujo único conteúdo é uma credencial que
não serve é pior que arquivo nenhum.

## Notas relacionadas

- O plano: `docs/superpowers/plans/2026-09-01-chat-entre-pessoas-e-membros.md`
- O desenho: `docs/superpowers/specs/2026-09-01-chat-entre-pessoas-e-membros-design.md`
- A conferência anterior: `docs/CONFERENCIA-2026-09-01.md`
- O ponto de retomada: `docs/CONTINUAR-AQUI.md`
