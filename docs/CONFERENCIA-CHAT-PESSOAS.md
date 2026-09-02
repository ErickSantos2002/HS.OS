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

---

## O que NÃO foi conferido

Esta seção existe porque `docs/VARREDURAS-2026-08-31.md` registra duas varreduras
que deram limpo por fraqueza do método. Escrever o que ficou de fora é o que
impede alguém de confiar numa conferência que não conferiu.

**Passo 4 — a conversa no navegador, com duas contas. Não rodou.** Duas janelas,
DM e canal de grupo, agente acionado dentro do canal, e conferir na tela:
mensagem chegando sem recarregar, "está digitando", não-lidas contando. Esbarra
nas senhas: as 27 foram para o FortiPAM e o backend guarda só o hash. Os dois
caminhos são injetar token emitido localmente no `localStorage` de duas janelas
do Playwright, ou usar duas senhas de conta de teste.

⚠️ **Continua sendo o buraco maior, e a conferência de hoje aumentou o motivo.**
As rotas foram batidas e passaram, mas **nenhuma mensagem trocada entre duas
pessoas foi vista numa tela** — o DM foi criado, e nada foi escrito dentro dele.
Em 01/09 dois defeitos da War room só apareceram abrindo o navegador, e hoje o
defeito (c) só apareceu porque uma chamada foi de fato executada.

**O caminho do agente dentro do canal não foi acionado.** O `POST
/channels/{id}/agentes/{id}/responder` não foi chamado em produção — exigiria
o gateway respondendo, e não era o que o Passo 2 media.

**Sujeira deixada em produção, de propósito, para não apagar sem combinar:** o
canal `teste 2` ganhou nada, mas nasceram três canais de conferência
(`conferencia-tarefa8`, `conferencia-t8-nina`, `conferencia-t8-flow`) e um DM
entre duas pessoas — e esse DM tem uma **terceira pessoa** dentro, gravada pela
chamada que revelou o defeito (c). O defeito está fechado, a linha não: ela
continua lá e a tela vai mostrar dois interlocutores no mesmo DM.

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
