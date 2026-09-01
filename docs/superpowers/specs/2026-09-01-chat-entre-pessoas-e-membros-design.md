# Conversa entre pessoas volta, e a empresa inteira entra

Desenho aprovado em 01/09/2026 (Erick). Reverte a decisão de 17/08/2026 e abre o
HS.OS para os 26 funcionários da Health & Safety.

## Por que existe este documento

Em 17/08/2026 o commit `c8797b6` — "Pessoa fala com agente, não com pessoa" —
tirou as pessoas da lista do Chat. O motivo estava escrito e era honesto: depois
da conversa com o Nicholson o controle ficou mais restrito, sobraram três
pessoas na plataforma (TI, CEO e Financeiro), e gente conversar com gente ali
tinha perdido o sentido. Nada foi perdido ao esconder: os dois canais de DM
entre pessoas que existiam tinham **zero** mensagens.

A direção mudou de novo. O pedido agora é o oposto: a conversa entre pessoas
volta, e todos os funcionários entram como membros — cada um enxergando apenas
os agentes que fazem sentido para o trabalho dele.

Este documento é o desenho dessa volta. Ele não é grande porque a conversa
precise ser construída — ela existe e funciona. É grande porque **abrir o
sistema de 4 para 26 pessoas transforma em risco o que era conveniência entre
gente de confiança**, e é isso que precisa ser desenhado com cuidado.

## O que já existe, e não vai ser construído de novo

Levantado no repositório e no banco de produção em 01/09/2026, antes de decidir
qualquer coisa:

| Peça | Estado |
|---|---|
| `backend/app/routers/channels.py` | 964 linhas: canais, membros, mensagens, threads, reações, arquivos, DM |
| `GET /channels/dms/interlocutores` | devolve com quem eu falo em cada DM, com o perfil junto |
| `frontend/src/components/chat/ChannelChat.tsx` | **vivo**, e já renderiza DM (`type === "dm"`, com `dmPeerName`) |
| `frontend/src/hooks/use-people.ts` | **vivo**: lista as pessoas com `departamento` e `cargo`, e tem `findOrCreateDm` |
| Realtime | WebSocket próprio já roteia por `canal:<id>`, inclusive o "fulano está digitando" |
| `agent_profiles.access_type` + `allowed_user_ids` | acesso por agente **já funciona**; os 5 agentes usam hoje |
| `AgentEditDrawer` e `users/AgentAccessDialog` | as duas telas de atribuir pessoas a agente já existem |
| `POST /profiles` | cria conta completa (`auth.users` + `profiles` + `user_roles`) numa transação, com `departamento` e `cargo` |

A remoção de agosto foi cirúrgica: mexeu em 14 linhas do `ChatPage.tsx`, fechou
uma rota e limpou ids órfãos. Reverter o caminho é pequeno. O que é grande é o
que vem junto com 26 pessoas.

## O estado de hoje, medido

Contas no HS.OS: **4** — Erick (administrador), Nicholson, Djalma, Ketlin.
Quadro real da empresa, na view `pessoas` do TalentHS: **28 linhas**, das quais
26 são gente (`Bruce` e `Carlos` são cadastro de teste), distribuídas em 9
setores. A Ketlin é consultoria e não está no TalentHS.

Agentes: `nina` (orquestradora, líder), `atlas` (comercial), `bruce` (cadastro
de pessoas/RH), `flow` (operações), `iris` (ERP/DataCore). Todos com
`access_type = specific_users`.

Canais: 3, **todos com zero mensagens** — um privado de teste, e dois DMs
órfãos (um com o Erick sozinho, um da Adriana, que não tem conta).

## As decisões

Todas tomadas por Erick em 01/09/2026.

1. **Escopo da conversa:** DM 1-a-1 entre pessoas, canais de grupo, **e** agente
   participando de canal de grupo.
2. **Quem entra:** os 26 do TalentHS, todos de uma vez — **23 contas novas**,
   porque Erick, Nicholson e Djalma já têm a sua. Fora: `Bruce` e `Carlos`. A
   Ketlin permanece como está e não vem do TalentHS. Total ao fim: **27
   contas**.
3. **Senha:** mantém a regra de 14/08 — colaborador **não** troca a própria
   senha, a credencial mora no FortiPAM. Nada muda aqui; nenhum fluxo de senha
   é construído.
4. **Acesso a agentes:** definido na mão, pelo Erick, depois da carga. As telas
   já existem; nenhuma regra automática por setor será construída.
5. **Agente em canal:** só entra agente que **todos** os membros humanos do
   canal podem ver. O `allowed_user_ids` continua sendo a palavra final e não
   há caminho lateral.
6. **Criação das contas:** script único rodado no Konsole, não função de
   produto.
7. **Governança:** DM livre entre todas as pessoas; canal de grupo só o
   administrador cria.

## 1. O invariante de acesso

### A regra, num lugar só

Hoje a regra de quem pode ver um agente mora no `_pode_ver`, em
`backend/app/routers/agents.py`. Ela passa a morar numa função SQL, e o Python
passa a chamá-la:

```sql
public.pode_ver_agente(_user_id uuid, _agent_id text) RETURNS boolean
```

Tradução literal do `_pode_ver`, sem mudança de comportamento: administrador
passa por cima de tudo; `all` libera; `admins_only` recusa a quem não é admin;
`specific_users` exige o id em `allowed_user_ids`; qualquer outro valor libera.
O papel sai de `has_role`, a mesma função que as policies de RLS já usam.

Mover a regra para o banco não é preferência de estilo: o trigger abaixo precisa
dela, e ter a mesma regra escrita duas vezes em duas linguagens é como as duas
pontas divergem sem ninguém perceber.

### O trigger

`BEFORE INSERT ON public.channel_members`, recusando nas duas direções:

- inserindo `member_type = 'agent'`: todo humano já no canal precisa poder ver
  esse agente;
- inserindo `member_type = 'human'`: essa pessoa precisa poder ver todo agente
  já no canal.

A recusa nomeia quem e qual agente, e usa `ERRCODE` próprio para o backend
poder traduzi-la sem casar string de mensagem.

O Python chama `pode_ver_agente` **antes**, nos endpoints que mexem em membro, e
devolve 403 com mensagem humana ("A Sandra não tem acesso à Iris"). O trigger
não é a mensagem: é a rede embaixo, e vale para rota que ainda não foi escrita.
Esta é a mesma escolha que o repositório já fez com as 191 policies de RLS, e
pela mesma razão — o commit que removeu as pessoas em agosto foi escrito
reclamando de "esconder na tela e deixar a rota aberta".

### Duas consequências que precisam estar escritas

⚠️ **`find_or_create_dm` é `SECURITY DEFINER` e insere em `channel_members`
direto — o trigger pega ela também.** DM entre duas pessoas passa
trivialmente, porque não tem agente. Mas **DM com agente passa a exigir
autorização**, e isso é mudança de comportamento num caminho que hoje funciona:
quem abrir DM com agente que não pode ver vai receber erro explícito em vez de
um canal que existe e não serve para nada. É o comportamento correto e é
desejado — mas é mudança, e precisa ser exercitada antes do deploy.

⚠️ **O trigger valida na entrada, não continuamente.** Tirar o acesso de uma
pessoa depois não a remove dos canais em que ela já está. Isso não é furo do
trigger — é uma pergunta de manutenção, e foi exatamente esse tipo de dado
velho que virou 11 ids órfãos em `allowed_user_ids` em agosto. A entrega inclui
uma consulta de conferência, guardada no repositório:

> quem está hoje em canal com agente que já não pode ver?

Ela é para rodar depois de cada mudança de acesso. Não vira alarme automático
nesta entrega: com 26 pessoas e 5 agentes, uma consulta que alguém roda é
honesta; um alarme que ninguém lê é pior que nada.

## 2. Backend: uma porta reabre, três fecham

| rota | hoje | fica |
|---|---|---|
| `POST /conversations/dm/abrir` | `exige_papel("administrador")` | `usuario_atual` — DM livre entre todos |
| `POST /channels` | qualquer autenticado | `exige_papel("administrador")` |
| `POST /channels/{id}/members` | **nenhuma checagem** | membro do canal + admin fora de DM + o invariante |
| `POST /channels/{id}/agentes/{id}/responder` | membro do canal | + o invariante |

A terceira linha preocupa mais que a primeira. Hoje **qualquer pessoa
autenticada adiciona qualquer pessoa ou qualquer agente a qualquer canal**, sem
verificação nenhuma — o endpoint faz `INSERT ... ON CONFLICT DO NOTHING` e
pronto. Com 4 pessoas de confiança isso nunca teve consequência. Com 26
pessoas dentro, é o caminho mais curto para furar o `allowed_user_ids`: basta
me adicionar a um canal onde o agente está.

A policy de RLS `Authenticated users create channels` aperta junto com o
`POST /channels`, senão a rota fecha e o banco continua aberto.

⚠️ **Conferido antes de fechar `POST /channels`:** o DM com agente **não**
nasce por ali. Os únicos chamadores de `createChannel` no front são os dois
diálogos de criação de canal (`ChannelsPage` e `ChatPage`); o DM nasce por
`/conversations/dm/abrir` → `find_or_create_dm`. Fechar a criação de canal para
administrador não quebra o chat do colaborador.

## 3. Front: o caminho de volta

O painel de conversa não precisa ser construído. `ChannelChat` está vivo, é
renderizado em dois pontos do `ChatPage` e **já trata DM**. O que foi cortado em
agosto foi o caminho até ele.

**Lista lateral (aba DM).** Volta a receber pessoas no `unifiedDmList`, com a
ordem: agentes visíveis, depois pessoas **com quem já existe conversa**, tudo
ordenado por atividade. Pessoa sem conversa não ocupa linha.

Começar conversa nova é um campo de busca sobre o `usePeople`, que já devolve os
26 com `departamento` e `cargo` — dá para achar por nome ou por setor.

A razão de não listar as 26 sempre: com 26 pessoas e 5 agentes, uma lista
completa empurra os agentes — que são o foco do produto — para baixo da dobra
já na primeira semana, quando ainda não existe conversa nenhuma.

⚠️ **O ramo `kind: "person"` está no `ChatPage.tsx` como código morto e nunca
rodou uma vez.** São ~100 linhas em dois pontos de render. O plano é religá-lo e
**exercitá-lo com duas contas no navegador**, consertando no lugar o que
quebrar. Não reescrever às cegas: trocar código não testado por outro código não
testado não é progresso. E não confiar nele às cegas: ele nunca produziu uma
mensagem.

**Criar canal** passa a aparecer só para administrador. O diálogo de criação
recusa com motivo quando a combinação pessoa×agente não fecha, em vez de deixar
o backend devolver erro genérico.

## 4. A carga das contas que faltam

`POST /profiles` já faz o trabalho inteiro: cria em `auth.users`, `profiles` e
`user_roles` numa transação, aceita `departamento` e `cargo`, e registra no log
de acesso. O script **não toca no banco** — ele é um cliente da API com token de
administrador, e portanto usa o caminho que já está testado em produção.

`scripts/carregar-pessoas.py`:

1. lê a view `pessoas` do TalentHS (nome, e-mail, setor, cargo);
2. descarta `Bruce` e `Carlos`;
3. compara com `GET /profiles` e separa quem falta — hoje **23** dos 26,
   porque `ti@`, `np@` e `financeiro01@` já existem;
4. cria cada um como `colaborador`, com senha forte gerada na hora;
5. imprime a lista pessoa→senha para o FortiPAM, e só ali.

Idempotente: rodar duas vezes não duplica ninguém, porque o passo 3 é uma
diferença e porque `POST /profiles` já devolve 409 em e-mail repetido.

Quem já tem conta não é tocado: as três já têm setor e cargo preenchidos, e
atualizar nome de quem está usando o sistema não é trabalho desta carga.

Efeito de lambuja que vale registrar: isso preenche `departamento` e `cargo` de
quem entra, e a view `diretorio` — que os agentes leem para saber quem está
falando com eles — passa a ter a empresa inteira em vez de três pessoas. É
exatamente a queixa que gerou a migration `008_pessoas_talenths.sql`, quando o
`atlas` não soube dizer quem era SDR.

**Higiene junto:** os dois canais DM órfãos são apagados (zero mensagens, e um
deles aponta para pessoa sem conta).

## 5. Como se prova que funciona

A régua desta casa — "contar linha não é conferir dado" — vale dobrado aqui,
porque **a conversa entre pessoas nunca teve uma mensagem sequer**. Não existe
nada em produção que comprove que aquele caminho funciona.

1. **Cada rota que mudou, batida com token de colaborador emitido na mão**
   (`emitir_token(...)`), direto na API. É como as restrições foram conferidas
   em agosto e é o que pega "escondi na tela mas deixei a rota aberta".
2. **O invariante, nas duas direções e nos dois sentidos de recusa:** agente
   entrando em canal com humano não autorizado; humano entrando em canal com
   agente que ele não vê; e os dois casos que **devem** passar.
3. **O trigger, testado por dentro do banco**, com `INSERT` direto — se ele só
   for exercitado pela API, não se sabe se é ele que está segurando ou o Python.
4. **A conversa, no navegador, com duas contas de verdade**, trocando mensagem.
   Dois defeitos da War room em 01/09 só apareceram assim; nenhum teste
   unitário os teria pego.
5. **A carga, conferida por leitura**: as 23 contas novas existem com setor e
   cargo preenchidos, ninguém foi duplicado, e a `diretorio` devolve **27**
   linhas.

## O que fica de fora, de propósito

- **Regra de acesso por setor.** Foi proposta e recusada: o Erick define na mão.
- **Importador do TalentHS na tela.** O script resolve a carga; um importador
  exigiria o backend do HS.OS alcançar o banco do TalentHS — conector novo,
  credencial nova, superfície nova, para um botão usado quando entra gente.
- **Qualquer fluxo de senha** — troca pelo colaborador, primeiro acesso,
  "esqueci minha senha". A credencial mora no FortiPAM e a decisão de 14/08
  continua de pé.
- **Notificação nova.** O que existe (não lidas, `dm_reads`, push) atende; abrir
  o chat entre pessoas não é motivo para mexer nisso.
- **Limpar o `ChatPage.tsx`.** Ele tem 3.359 linhas e merece ser quebrado, mas
  não nesta entrega — refatoração não pedida no arquivo mais delicado do
  projeto, junto com mudança de comportamento, é como se perde a origem de um
  defeito.

## Notas relacionadas

- `CLAUDE.md` — autorização, papéis, o caminho crítico do chat
- `docs/CONTINUAR-AQUI.md` — decisões pendentes e o que está desligado
- `backend/migrations/008_pessoas_talenths.sql` — por que o quadro de pessoal
  mora no TalentHS e o que fica fora da view
- commit `c8797b6` — a remoção que este documento reverte
