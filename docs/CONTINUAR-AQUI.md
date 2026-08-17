# Continuar aqui

Ponto de retomada da portagem. Atualizado em **14/08/2026**. Leia isto, depois
`CLAUDE.md` e `docs/ROADMAP.md`.

👉 **Voltando na segunda (17/08)?** Pule para
[*Segunda-feira — por onde pegar*](#segunda-feira--por-onde-pegar).

🎉 **O front saiu do Supabase.** Nenhuma chamada `.from()`, nenhum
`functions.invoke`, nenhum `supabase.channel`. O único arquivo que ainda
importa o client é o próprio `integrations/supabase/client.ts`, que existe só
para lançar caso alguém o use. **Zero** edge functions por portar.

👉 **Arena, War room e voz pausadas em 10/08** — ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md).

👉 **Vai testar o sistema?** [`TESTAR-SEGUNDA.md`](TESTAR-SEGUNDA.md) é o roteiro
da **fase da migração** (escrito em 07–10/08), e essa fase fechou. Continua útil
para o básico — túnel, subida, login. Para o que mudou depois, veja
[*Conferir no navegador*](#conferir-no-navegador) logo abaixo.

---

## O que aconteceu em 14/08/2026

Dia longo e de tema único: **quase tudo que parecia funcionar estava conferindo a
configuração em vez do efeito.** Sete frentes, e o mesmo defeito de método em
todas.

**A Nina foi liberada para o CEO** (Nicholson, `np@`, `colaborador`). O acesso já
estava certo; o que faltava era o resto desta lista.

**Um agente falar com outro.** O `agent_to_agent` **não é uma ferramenta** — quem
conversa é o `sessions_send`, e `tools.agentToAgent` é a política que o deixa
cruzar a fronteira. E o `allow` lista **quem participa, não quem recebe**: com
`[iris, atlas]`, tanto `iris→nina` quanto `nina→iris` foram recusados. Só com os
três na lista funcionou. Quem *inicia* se controla por agente, com `deny`, que
**remove a ferramenta da lista** em vez de recusá-la em runtime.

**O roster do time foi para o `AGENTS.md`** dos três, não para o `USER.md` —
pessoa se descobre pela chave de sessão, agente se roteia por tabela. Com o
protocolo de perguntar antes de delegar. Testado ponta a ponta: a Nina reconhece
que faturamento é da Iris, oferece as duas saídas, e traz a resposta atribuindo.

**Todo agente alcançava os nove bancos.** `alsoAllow` é **aditivo** sobre o perfil
`coding`, que já libera todo servidor MCP; a publicação por agente organizava sem
isolar. Quem exclui é o `deny`, agora recalculado a cada publicação em
`_deny_de_mcp`. ⚠️ **O `deny` casa pelo nome SEM o prefixo `mcp__`**; a primeira
tentativa gravou com prefixo, passou na conferência e não removeu nada.

**O `avisar_administrador` nunca chegou em ninguém.** Apontava para `172.18.0.1`,
que é a bridge vista de dentro do backend — sem sentido a partir do gateway, que
vive noutra máquina. Corrigido para o domínio público. Hoje ele recusa jailbreak
e dispara de verdade: a linha está em `conversations` e `notifications`.

**Senha virou responsabilidade do administrador.** A HS é fechada e as pessoas
entram pelo **FortiPAM**; colaborador trocando a própria senha dessincronizaria o
cofre. `POST /profiles/{id}/senha` para o admin, `/auth/trocar-senha` restrito.
⚠️ **Não copie esta restrição para outra instalação sem o cofre junto.**

**O colaborador via administração de agente.** `GET /agents/{id}/arquivos` estava
em "só logado" — são os sete arquivos, ou seja, o prompt de sistema que o próprio
agente recusa mostrar. E os `crons` estavam abertos para **escrita**. Treze rotas
passaram a exigir admin; `/agents` continua aberta porque o mapa da frota é visão
do time, com o `AgentResumoPanel` no lugar do painel completo.

**DeepSeek entrou no lugar do Claude.** Provedor não-embutido precisa ser
**declarado** (`baseUrl` + `api` + lista de modelos), não só ter chave. Os três
agentes rodam nele, com delegação e guardrail **reverificados** — tinham sido
testados só em Claude, e trocar o modelo invalida o teste.

**A skill de faturamento tirou um erro de 48% do caminho da diretoria.** A Iris
somava toda nota "emitida" e devolvia R$ 654.645,95 para agosto; o certo é
R$ 441.712,80. A régua veio de `~/projetos/extracao-consultoria`, já conferida
contra a página Financeiro do DataCore.

⚠️ **E a descoberta que mais vale: skill publicada não é skill usada.** Publicada,
listada pelo gateway, e a Iris confirmando que a enxergava — ela respondeu errado
assim mesmo. Carregar sob demanda depende de o agente **lembrar**, e isso varia
com o modelo. O que resolveu foi um **ponteiro curto no `AGENTS.md`**: "pergunta
sobre X começa abrindo a skill Y".

**O painel do agente parou de mostrar zero.** `usage_events` e
`agent_integrations` têm zero linhas e nunca tiveram escritor, enquanto o gateway
tinha 38 sessões, 1,01 milhão de tokens e US$ 4,77. Os dois passam a cair para o
gateway quando a tabela está vazia — o coletor retoma a precedência sozinho
quando existir.

### O fio que costura o dia

Cada uma dessas frentes falhou do mesmo jeito: **alguém conferiu a configuração e
chamou de verificado.** O `deny` gravado que não removia nada; a auditoria
aprovando o alerta pelo `alsoAllow`; a skill listada e não usada; a tela dizendo
US$ 0,00 por ler tabela vazia.

O que funcionou, sempre, foi **perguntar ao agente** ou **olhar o efeito final**.
Deixe isso valer para o que vier na segunda.

---

## O que aconteceu em 13/08/2026

Dia inteiro na tela de **Conectores**, que passou de "parece funcionar" para
funcionando. Quatro consertos e uma descoberta que muda o desenho.

**Conectores (APIs de terceiros).** Editar um conector apagava as chaves que
você não redigitou. A tela nunca recebe os valores — está certo —, mas também
não sabia que existiam, então abria em branco e o servidor tratava o que a
pessoa digitou como o conjunto final. Agora a listagem devolve `credential_keys`
(os **nomes**, nunca os valores) e o PATCH mescla por chave.

**Provedores de LLM.** O card da Anthropic dizia "não conectado" sobre a
credencial que estava alimentando a `nina` naquele instante. O front já tinha a
lógica certa (`nativas`, em `LlmProvidersSection.tsx`); o backend é que nunca
mandava `perfis`. Mesma família do `useAgents` que derrubava quatro campos
declarados — **TypeScript afirma, não confere**.

**E o principal: configurar LLM pela tela funciona.** Passei o dia afirmando o
contrário, três vezes, e o Erick segurou o argumento de que o pessoal da dn.ia
não toca a VPS. Ele estava certo. Detalhes e os erros de raciocínio estão em
`CLAUDE.md`, seção *"Configurar LLM"* — vale ler antes de mexer em `llm.py`.

A `nina` ficou muda por horas por causa de uma chave inválida, não por nada
disso. Quem resolveu foi o log do gateway
(`journalctl --user -u openclaw-gateway.service`), que desfez **cada** palpite
que fizemos por correlação. É a primeira ferramenta a usar quando um agente
falha, não a última.

**Limpeza feita no mesmo dia:** 6 sessões de teste no gateway, o log de criação
de dois agentes que não existem, 6 mensagens de canal de teste, e as 4
tentativas que gravaram *"The agent run failed"* **como se fosse fala da
`nina`** — ela relia a conversa e via aquilo como coisa que tinha dito. Backup
em `~/backups/limpeza-2026-08-13/*.csv`. Na VPS saíram as pastas de agente
morto e os workspaces órfãos (`~/limpar-vps.sh`, com arquivo `.tar.gz` antes de
remover).

### Bancos de dados viraram o quarto tipo de conector

E a `nina` já consulta o banco do HS.OS pela tela — cadastro → `mcp.servers` no
gateway → `tools.alsoAllow` do agente, tudo por `config.patch`, sem tocar a VPS.

**Banco é tool, não skill.** Consultar é ação; o agente não precisa reaprender a
consultar, precisa poder executar. Skill continua sendo o certo para
procedimento com julgamento nosso dentro — como criar um agente. A troca custa
contexto (tool ocupa o prompt todo turno, skill só quando invocada) e para banco
compensa.

⚠️ **O usuário do banco é a trava, não a nossa coluna.** `db_somente_leitura` só
escolhe qual credencial usar. O usuário `leitura` do HS.OS tem
`pg_read_all_data`, `default_transaction_read_only = on` e **`BYPASSRLS`** — os
dois primeiros recusam escrita antes de olhar permissão; o terceiro foi preciso
porque as 191 policies de RLS exigem `auth.uid()`, que só existe quando o
backend emite `SET LOCAL app.current_user_id`. O servidor MCP abre a conexão e
manda SQL puro, então **sem `BYPASSRLS` as 69 tabelas devolviam zero linhas** e
a agente concluía que o banco estava vazio.

⚠️ **`sslmode=prefer` não quer dizer o mesmo em todo driver.** O libpq (psql,
asyncpg) rebaixa para texto puro quando o servidor recusa SSL; o node-postgres,
que roda dentro do MCP, trata como exigência e falha. O teste passava e o agente
falhava. Use `disable` para servidor sem SSL — a tela avisa e a publicação
recusa.

⚠️ **Dívida conhecida:** o servidor MCP recebe a URL por argv, e argv aparece no
`ps`. Contido enquanto só o root roda na VPS; **deixa de ser aceitável quando
existir escrita**, e o conserto é um servidor MCP nosso lendo do ambiente. Por
isso publicar banco marcado como leitura-e-escrita responde 501 hoje.

---

## Segunda-feira — por onde pegar

O que estava aqui era a ordem de 12–13/08, e ela **fechou**: a aba Empresa, os
sete arquivos da `nina`, a skill `criar-agente` e a criação do primeiro agente
pela orquestradora. A `iris` (DataCoreHS) e o `atlas` (GrowthHS) existem, e os
três passam no `python scripts/auditar-agente.py <id>`.

A frente aberta agora é **a tela de Skills e o painel de dentro de Super
agentes** (`/agents/:id`). Ordem combinada com o Erick em 14/08:

1. **Skills — a página.** Hoje `/skills` lê `public.skills`, que tem **zero
   linhas**, enquanto `/skills/catalogo` já lê o gateway e devolve **55**. A
   página mostra a tabela vazia. O dado está a uma chamada de distância; é o
   mesmo conserto do consumo e das integrações, já feito em `agents.py`.

   ⚠️ Distinga **nossas** de **embutidas**: `skills.status` traz `bundled` e
   `source` (`openclaw-managed` são as nossas — hoje `criar-agente` e
   `faturamento`). Das 55, 51 são do próprio OpenClaw.

2. **Guardrails no painel.** `GET /agents/{id}/guardrails` lê `agent_profiles` e
   devolve `[]`. É a área que mais mexemos esta semana e a tela não mostra nada
   do que foi configurado. Ver onde a configuração real mora antes de escrever:
   parte está no `SOUL.md`, parte em `tools.*` do gateway.

3. **Sessões recentes.** O gateway tem **38 sessões** com modelo, duração,
   status, tokens e custo. É a base do diagnóstico quando alguém disser "o
   agente não respondeu" — e hoje não aparece.

4. **O coletor de histórico.** Decisão do Erick: consumo ao vivo **primeiro**
   (feito), coletor **depois**. Enquanto ele não existir, "quanto gastamos em
   julho" não tem resposta — sessão podada leva o histórico junto. Quando
   entrar, ele enche `usage_events` e o `/consumo` volta a preferi-la sozinho,
   sem mexer na tela.

   ⚠️ O `docs/DEPLOY.md` diz que o serviço `worker` **ainda não está no deploy**.

**Cron jobs saiu da lista de consertar.** Nem a nossa tabela nem o gateway têm
agendamento nenhum: a tela está certa ao não mostrar nada. Ela só ganha utilidade
quando existir o primeiro cron de verdade.

### 📋 Backlog do primeiro uso real (15/08) — **não é a frente atual**

O Nicholson (CEO, `colaborador`) usou os três agentes no sábado: Atlas 06:20,
Nina 09:10, Iris 18:43. Três sessões, três `done`, nenhuma falha. Analisado em
17/08. **Nada disto entra antes do que está na lista acima** — a decisão do
Erick é ajustar tudo antes de liberar para as demais pessoas.

**O que funcionou, e vale preservar ao mexer:**

- **A identidade resolveu sozinha.** O Atlas consultou o Diretório e abriu com
  "Nicholson, bom dia", sabendo o cargo. O desenho de chave de sessão +
  `USER.md` funcionou com alguém que não somos nós.
- **A Iris recusou premissa errada.** Ele pediu "painel com todas as 106
  empresas"; ela respondeu que no banco dela são **91** e perguntou de onde veio
  o 106 antes de montar qualquer coisa.
- **Roteamento fora de escopo correto:** "oportunidades é do GrowthHS, quem
  trata é o Atlas".
- **O Atlas desconfiou do próprio número** (186 por vendedor contra 555 no
  total) e foi investigar em vez de entregar. Não estava escrito em lugar
  nenhum.

**O que consertar, em ordem de dano:**

1. **O Atlas precisa da skill do CRM.** Ele apresentou ao CEO **369 cards sem
   vendedor** como "risco de ninguém responsável". Conferido no banco: dos 696
   parados >3 dias, **593 estão na Prospecção**, e é lá que estão 484 dos 488
   sem vendedor — board de SDR, onde **não ter vendedor é o normal**. As regras
   já estão escritas em `~/projetos/extracao-consultoria/DESIGN.md`: `is_won = 0`
   é card **aberto** (não perdido), "Negócio Perdido" na Prospecção é descarte
   de lead, e o denominador do indicador de SDR é o outbound. É a mesma
   história da skill `faturamento` — e vai precisar do mesmo **ponteiro no
   `AGENTS.md`**, senão ele não abre.

2. **Custo aparece US$ 0,00 para DeepSeek.** O gateway não tem tabela de preço
   para provedor customizado; as sessões em `claude-sonnet-4-6` têm custo e as
   em `deepseek-chat` vêm zeradas. O painel de custo entregue em 14/08 mostra
   zero **justamente para o modelo que passou a rodar tudo**. O schema aceita
   `cost` (`input`/`output`/`cacheRead`/`cacheWrite`) por modelo dentro de
   `models.providers.<id>.models[]`. ⚠️ Confirmar o preço vigente do DeepSeek
   com o Erick — não inventar número.

3. **"pergunta a eles" — e a Iris não pôde.** O CEO pediu que ela acionasse o
   Atlas; ela explicou que não tem a ferramenta e ele respondeu *"serio mesmo
   iris?"*. A decisão de 14/08 (só a Nina inicia, via `deny` de `sessions_send`)
   colidiu com a expectativa de quem usa. Reabrir: o `agentToAgent.allow` é
   global e não tem lista de destino por agente, então "a Iris fala só com a
   Nina" **não** é configurável hoje — a saída seria soltar o `deny` dela e
   aceitar que alcance o Atlas também.

4. **`/new to start a fresh session` foi enviado como mensagem.** Ele digitou
   uma dica da interface e ela virou pergunta para a Iris. Defeito de tela.

5. **A Iris ofereceu "arquivo/planilha exportável (CSV/HTML)".** As ferramentas
   dela são três consultas e o alerta. Conferir se ela entrega arquivo ao
   usuário de fato; se não, é promessa que não se cumpre e sai do `IDENTITY.md`.

6. **A Nina foi a mais fraca.** Recebeu "bom dia" e respondeu "Bom dia! Em que
   posso ajudar?", sem identificar quem era — enquanto o Atlas identificou. É a
   primeira impressão da orquestradora com o CEO.

**Dado de custo que vale ter em mente:** cada sessão nova custa **~22 mil
tokens** antes da primeira palavra — são os sete arquivos entrando no contexto.
Com DeepSeek é barato; foi por isso que a troca importou.

### Conferir no navegador

⚠️ **Tudo de 14/08 foi verificado por API e perguntando aos agentes — nada foi
aberto na tela.** É uma lacuna real, e é o tipo de lacuna que o próprio dia
ensinou a não ignorar. Dez minutos resolvem:

| Onde | O que tem que aparecer |
|---|---|
| `/agents/nina` → painel | custo **≠ US$ 0,00** e tokens ≠ 0 · ferramentas, canais e skills preenchidos |
| `/agents` como colaborador | mapa abre · clique num agente abre o **resumo**, não o painel completo |
| `/agents` como colaborador | **sem** botão "Salvar layout" no grafo |
| `/settings` → Perfil, como colaborador | **sem** "Alterar Senha"; no lugar, a linha do FortiPAM |
| `/settings` → Usuários, como admin | botão **Senha** por pessoa, e ele funciona |
| Conectores → provedores LLM | DeepSeek aparece conectado, com V3 e R1 |
| Chat com a Nina | pergunta de faturamento → ela oferece perguntar à Iris |

Entre como **colaborador** para metade disso. Use a conta do Nicholson (a senha
está no arquivo de credenciais, e você a trocou em 14/08 — o arquivo está
desatualizado para ele) ou crie uma conta de teste em Usuários.

⚠️ **O deploy dos dois serviços é obrigatório antes de conferir.** Backend e
frontend mudaram em 14/08, e o EasyPanel só constrói quando alguém manda.

### Pendências curtas, que cabem em qualquer intervalo

- **`agentToAgent.allow` é manual.** Agente novo criado pela tela **não** entra
  na lista: nasce sem falar com a Nina e sem ser alcançável por ela, em silêncio.
  É o mesmo tipo de buraco que o `_deny_de_mcp` fechou. A hora certa de resolver
  é ao criar o quarto agente.
- **A `nina` está com `channels` vazio** em `agent_profiles`, e `iris`/`atlas`
  com `{webchat}`. Ela conversa normalmente — é o registro que está incompleto.
  Mesma família do `model` vazio que apareceu no mesmo dia. Testar
  `POST /agents/sync` e ver se realinha.
- **Marcador na skill `faturamento`**: uso `LIKE '%texto%'` e a régua oficial do
  `tiny-integrador` usa **igualdade exata**. Deu no mesmo em janeiro e agosto,
  mas são critérios diferentes — o meu excluiria uma nota cujo marcador apenas
  *contenha* "cancelar". Trocar e revalidar contra os dois números de referência.
- **O fluxo de criação de agente nunca rodou inteiro com o código corrigido.**
  O `atlas` nasceu antes de quatro dos cinco consertos e foi remendado à mão. O
  próximo agente é o teste — e ele exercita, de quebra, o reparo automático de
  provedor LLM em `llm.py`, que também não foi exercitado.

### Segurança, ainda em aberto

Nada disso é novo de 14/08, e nada disso bloqueia o trabalho acima:

- **Senha `administrador`/`administrador`** no superusuário do Postgres.
- **`integrations.credentials` em texto puro** — nove senhas de banco.
- **`sandbox` por agente**: um agente ainda alcança o SQLite do outro via `exec`.
  A tentativa com `tools.fs.workspaceOnly` foi revertida por não fechar isso e
  quebrar o trabalho da `nina`.
- **O sanitizador da exportação** não remove `usuario:senha@` de URL.

---

## Placar — medido, não mantido à mão

O contador deste arquivo já mentiu **duas** vezes. Na primeira, eu vinha
incrementando a cada port sem conferir e ele chegou a dizer "72 de 73
resolvidas" com 13 functions ainda na pasta. Na segunda — 14/08/2026 — dizia
**240 rotas** enquanto o comando ao lado devolvia **186**.

**Todo número aqui vem de um comando**, e o comando está ao lado. Rode-os ao
retomar; a tabela envelhece sozinha e ninguém percebe.

| | Hoje | Total | Como medir |
|---|---|---|---|
| Edge functions **por portar** | — | **0** | `ls backend/supabase/functions \| grep -vE "_shared\|_pausado\|_portado" \| wc -l` |
| Portadas | 65 | 73 | as outras 8 estão em `_pausado/` — ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md) |
| Arquivos do front com Supabase | **1** | 278 | `grep -rl "integrations/supabase/client" frontend/src \| grep -v _legado \| wc -l` |
| Rotas na API própria | **186** | — | `curl -s localhost:8002/openapi.json \| jq '.paths \| length'` |
| Chamadas `.from("…")` vivas | **0** | — | `grep -rln '\.from(\s*"' frontend/src \| grep -v _legado \| wc -l` |

**Duas linhas têm que andar juntas.** "Tem substituto no backend" e "a tela usa o
substituto" são coisas diferentes, e confundi-las já deixou telas quebradas em
produção — ver *Armadilhas*, abaixo.

---

## Estado por subsistema

Sair do Supabase é substituir cinco coisas. Elas estão em estados muito
diferentes, e o resumo antigo ("Realtime ✅ portado") escondia isso:

| Subsistema | Substituto | Front religado | O que falta |
|---|---|---|---|
| **Auth** | ✅ JWT próprio (PyJWT + bcrypt) | ✅ **completo** | o *reset por e-mail* não existe — sem envio de e-mail, quem esquece a senha pede uma temporária ao admin |
| **Storage** | ✅ `UPLOADS_DIR` em disco | ✅ **completo** | nada |
| **Realtime** | ✅ WebSocket + LISTEN/NOTIFY (`app/escuta_banco.py`) | ✅ **completo** | nada — `postgres_changes` zerado, e o "está digitando" também passou para o `/ws` |
| **Edge Functions** | ✅ 73 de 73 | ✅ sem pendências | nada — 65 portadas, 8 arquivadas por decisão |
| **Banco** (RLS direto do browser) | ✅ 240 rotas | ✅ **completo** | nada — 0 chamadas vivas (9 em `_legado/`, fora da compilação) |

O **banco é o único subsistema que ainda pesa.** Os outros quatro estão prontos
ou perto disso.

### Nenhuma chamada viva

As duas que restavam saíram: `SkillsPage` passou a falar com o router
`skills.py`, e o `ResetPasswordPage` deixou de consultar `profiles`.

Sobram **9 chamadas em `_legado/`**, distribuídas em cinco arquivos do wizard de
setup antigo. Nada ali é compilado nem roteado — o `grep` as encontra e é só
isso. Conferir com nome de arquivo, não com `-h`:

```bash
grep -rln '\.from(\s*"' frontend/src | grep -v _legado | wc -l   # 0
```

⚠️ O comando do placar acima usava `grep -rho`, que descarta o nome do arquivo e
faz o `grep -v _legado` seguinte não filtrar nada — ele reportava 9 chamadas
"vivas" que não existem. Corrigido; use o `-l` acima quando for medir.

---

## O que já funciona, verificado no navegador

- **Banco próprio** no Postgres da VPS — 69 tabelas, 191 policies de RLS ativas
  de verdade (o backend conecta como `hsos_app`, não como superusuário)
- **Autenticação própria** — JWT + bcrypt, com troca de senha exigindo a atual
- **Agentes** — criar, editar todas as abas, sincronizar, verificar modelo,
  liderança, acesso, excluir, exportar, arquivos do workspace
- **Chat com agente** — envio e resposta por long-poll do `agent.wait`
- **Canais** — criar, editar, mensagens, membros, anexos, resposta de agente
- **Automações** — CRUD, gatilho, disparo, importar crons, sincronizar status
- **Tarefas** (Loop Architecture) — checkpoint, pausar, retomar, concluir
- **Arquivos** — storage próprio em disco, cinco buckets, gerar PDF e DOCX
- **Arenas** — persistência completa (a voz ainda não)
- **Integrações** — a ponte `window.dnos.invoke()` dos live artifacts
- **Deploy** — `hsos.healthsafetytech.com` e `hsosapi.healthsafetytech.com`

---

## As duas coisas que travam o resto

Não são técnicas. São decisões suas.

### 🔴 Lovable AI Gateway

`transcribe-audio`, `chat-image-vision` e `parse-company-context` usam a LLM
hospedada pelo Lovable. Sair de lá significa escolher um provedor e pagar por
ele — ou aceitar que transcrição de áudio, visão de imagem e leitura automática
do contexto da empresa deixem de existir.

### 🟠 ElevenLabs

`list-elevenlabs-voices`, `elevenlabs-tts`, `arena-convai-create/update/signed-url`
e `arena-generate` — a voz da Arena. Mesma natureza: chave própria ou o recurso
sai do produto.

**Estratégia acordada:** portar tudo menos a chamada ao provedor, deixando-a
parametrizada. Assim a decisão vira configuração, não código.

---

## Próximo passo, em ordem de valor

### 1. O banco — é o que sobrou

**124 chamadas `.from("…")` vivas.** Eram ~222 no início de 07/08, então já caiu
quase pela metade — mas é o único subsistema que ainda pesa, e portá-lo é o que
falta para o front deixar de ser um cliente Supabase com endpoints por cima.

Portar por **tabela**, não por tela. Foi o que funcionou: uma tabela some do
front de uma vez, e o endpoint nasce coerente em vez de recortado pela
necessidade de uma tela só.

**Comece pelos conectores.** O CRUD já está pronto e testado no backend
(`GET/POST/PATCH/DELETE /integracoes/conectores` e
`GET /integracoes/modelos-de-conector`) e o front **não** foi religado — 9
chamadas em 5 arquivos, sendo `ConnectorsTab` a maior. É trabalho mecânico com o
servidor já verificado.

Depois, por tamanho: `channel_members` (9) e `channel_messages` (9), que
compartilham o `channels.py` e boa parte dos endpoints já existe;
`agent_profiles` (10, metade já saiu); `agent_results` (6).

### 2. As 4 edge functions de trabalho real

| Function | Linhas | Observação |
|---|---|---|
| `turn-reconciler` | 864 | precisa do serviço `worker` — não há `pg_cron` na VPS |
| `skill-manage` | 647 | tela de Skills, viva |
| `collect-agent-stats` | 552 | webhook do coletor da VPS; **duas formas de payload**, e o payload real não está documentado — conferir antes |

### 3. Resíduos de autenticação

11 chamadas a `supabase.auth.` espalhadas, quase todas `getSession()`/`getUser()`
que já não fazem falta — o token vem do `lib/api`. A exceção é a
`ResetPasswordPage`, que depende do fluxo de recuperação por e-mail; esse não
existe mais e o destino dela está em *Decisões pendentes*.

---

## ⚠️ Armadilhas que já custaram tempo

### Do projeto

- **`npx tsc --noEmit` não checa nada.** O `tsconfig.json` da raiz tem
  `"files": []`. O comando correto é `npx tsc --noEmit -p tsconfig.app.json`,
  rodado de dentro de `frontend/`.
- **Arquivo em `pages/` não quer dizer tela em uso.** Só **onze** páginas estão
  roteadas. Em 07/08 religuei a `ProfilePage`, que está morta, e deixei a
  `SettingsPage` — a viva, que serve `/settings` **e** `/profile` — quebrada.
  A conferência que funciona:
  ```bash
  grep -oP '<Route[^>]*element=\{<\K[A-Za-z]+' frontend/src/App.tsx | sort -u
  ```
- **Portar o backend não religa a tela.** Já aconteceu doze vezes: a edge sai da
  pasta, o endpoint entra, e a tela continua chamando `supabase.functions.invoke`
  de algo que não existe mais.

  ⚠️ **E a régua ingênua não pega tudo.** Um `grep 'invoke("nome")'` perde as
  chamadas quebradas em várias linhas — foi assim que
  `notify-orchestrator-onboarding` passou por dois audits antes de aparecer em
  07/08. A conferência que funciona:

  ```bash
  # forma 1 e 2: supabase.functions.invoke, inclusive quebrado em várias linhas
  grep -rzoP 'functions\.invoke\(\s*\n?\s*"[a-z0-9-]+"' frontend/src \
    | tr '\0' '\n' | grep -oP '"\K[a-z0-9-]+' | sort -u

  # forma 3: fetch cru para a URL da edge — não usa invoke nenhum
  grep -rn 'functions/v1/' frontend/src --include=*.ts --include=*.tsx | grep -v _legado
  ```

  Depois cruze cada nome com `ls backend/supabase/functions/`.

  ⚠️ **A terceira forma passou por dois audits.** Em 10/08 quatro chamadas
  ainda apontavam para edges apagadas por `fetch` direto, e o sintoma que
  chegou foi "No suitable key or wrong key type" — o Supabase recusando a
  chave, numa mensagem que não diz nada sobre a causa.
- **`$N::jsonb` com uma string do Python guarda um jsonb *string*, não objeto.**
  O asyncpg deduz o tipo do cast. Use `$N::text::jsonb`. Vale igual para
  `$N::timestamptz` → `$N::text::timestamptz`.
- **Ordem de rotas no FastAPI.** Prefixo fixo tem que ser declarado **antes** do
  parametrizado, senão o genérico engole. Já mordeu seis vezes: `/documentos/gerar`
  virava bucket, `/minhas/respostas` virava agente, `/produtividade` virava id.
- **`channels` não tem `updated_at`.** Um `SET updated_at = now()` ali dá 500.
- A coluna da senha é **`password_hash`**, não `encrypted_password` (esse era o
  nome no Supabase).

### Do gateway

- Ele **conecta com sucesso** e nega tudo com `missing scope` quando a identidade
  do cliente está errada — ou quando o scope não foi **pedido** no handshake
  (`SCOPES` em `client.py`).
- O **handshake dá timeout de vez em quando** com o túnel de pé e `/health` em
  200. Repita antes de concluir que caiu.
- O `model` é **assimétrico**: `agents.list` devolve `{"primary": "…"}`,
  `agents.update` exige string nua.
- As rotas REST de monitoramento (`monitoring/gateway/status`, `processes`,
  `events`, `cleanup-chrome`, `gateway/restart`) **respondem 404** nesta versão.
  Conferido ao vivo em 07/08.

### Do banco e do deploy

- **Superusuário bypassa RLS** — as policies ficam no catálogo sem proteger nada.
- No **PG 16+** a herança de role é gravada por associação: `ALTER ROLE NOINHERIT`
  posterior não altera GRANTs já feitos.
- `VITE_*` é embutido em **build**, não em runtime — no EasyPanel tem que ser
  *build arg*.
- `pg_cron` **não existe** na VPS; jobs agendados vão para um serviço `worker`.
- O Postgres da VPS **não suporta TLS**.
- **`integrations.integration_type` só aceita** `api_key`, `multi_key`, `mcp` —
  nunca `meta`. A Meta é reconhecida pelo nome ou pelo `key_name`.

---

## ⚠️ Erro de operação — não repita

Em 06/08/2026, uma sondagem mandou `agents.update` com um modelo inválido de
propósito, **esperando que o gateway recusasse**. Ele aceitou e gravou: a `nina`,
que é o `defaultId`, ficou com `model: "isto-nao-e-um-modelo"` em produção até
ser restaurada à mão. Na mesma sessão, outra sondagem sem `agentId` mandou uma
mensagem de verdade para ela.

**Regra:** leitura no gateway (`*.list`, `*.get`, `*.status`) é livre. Escrita,
combinar antes. Para descobrir formato de parâmetro, use um **`agentId`
inexistente** — a chamada falha na busca do agente, antes de gravar. E confira
que **toda** chamada do lote leva o alvo inexistente: basta uma sem ele.

---

## Ainda por verificar junto com o Erick

Escrito e testado só nas guardas, porque o caminho feliz tem efeito real:

- **`PUT /agents/{id}/acesso`** — manda mensagem ao agente líder
- **Resposta de agente em canal** — dispara o agente de verdade
- **`DELETE /agents/{id}`** — apaga no gateway e em três tabelas
- **Disparo de automação** — executa no gateway

---

## Antes de escrever qualquer linha

1. **Suba o túnel SSH.** Sem ele, tudo que toca o gateway falha com
   `Connection refused` e o sintoma parece bug de código.
2. **Confira `CLAUDE.md`** — as armadilhas do gateway e do banco estão lá, e
   cada uma custou horas.
3. **Leia a edge function correspondente antes de portar.** As que restam em
   `backend/supabase/functions/` são a especificação: descrevem um sistema que
   funcionava. Foi assim que descobrimos que o protocolo do gateway tinha mudado.

---

## Pendências de infraestrutura que a portagem criou

- ~~**`UPLOADS_DIR` volume persistente**~~ — confirmado montado no EasyPanel
  pelo Erick em 12/08/2026.
- ~~**Backup do banco**~~ — instalado em 12/08/2026, diário às 03:20 com 14
  dias de retenção e restauração verificada. Ver [`DEPLOY.md`](DEPLOY.md).
  **Falta**: cópia para fora da máquina.
- **O WebSocket exige `wss://`** em produção: o token vai na query (a API do
  navegador não permite cabeçalho), então em `ws://` viajaria em claro.
- **Desligar a ponte `dnos-files-bridge` na VPS** — pendência aberta em
  11/08/2026, **de propósito com data para depois**.

  Ela copiava os arquivos dos agentes para a tabela `agent_files` a cada 60s.
  Existia porque o gateway não deixava lê-los direto; hoje deixa, e painel,
  exportação e importação já falam com o gateway. A tabela está com **zero
  linhas** — nesta instalação a ponte nunca escreveu nada.

  ⚠️ **Não desligue antes de importar um agente pela tela, de ponta a ponta.**
  O caminho novo foi testado (agente `testo`, sete arquivos, criado e apagado
  em 11/08), mas a importação completa pela interface ainda não rodou. A ponte
  parada não faz mal; religá-la depois de desligada exige entrar na VPS.

  Quando for: `systemctl disable --now dnos-files-bridge` no 62.72.11.28.

- **O tempo real vive na memória de um processo.** Com mais de um worker do
  uvicorn, quem está no worker A não recebe o que foi publicado no B. Hoje roda
  em processo único e está correto — **mas isso vira problema ao escalar.**

---

## Decisões pendentes

| Decisão | Por quê importa |
|---|---|
| **Trocar a senha `admin123`** | Conta `super_admin` que guarda o token do gateway. O endpoint existe (`POST /auth/trocar-senha`) e a tela está pronta. Fazer **antes** de liberar para a equipe. |
| Flags `dnos_flag_*` viram padrão? | São 4 correções de estabilidade hoje **desligadas**: o sistema roda com os bugs antigos ativos. |
| Manter as 191 policies de RLS? | Funcionam, mas duplicam a autorização do FastAPI. Se aposentar, vira a `003`. |
| **Reescrever a documentação oficial** | Ela avisa que a parte técnica está defasada (11/08), mas continua descrevendo edge functions que não existem. São 2.791 linhas misturando material que vale com material errado. Adiado de propósito: com uso real dá para saber quais seções as pessoas consultam e corrigir essas primeiro. |
| Fluxo de "esqueci minha senha" | Sumiu com o Supabase Auth. A `ResetPasswordPage` ainda existe e não funciona. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |

### Resolvidas

- ~~Credencial da Anthropic expirada~~ — **alarme falso.** O `models.authStatus`
  diz `expired` no perfil `anthropic:claude-cli`, mas a `nina` responde. Existe
  credencial que o `authStatus` não enxerga; `POST /agents/test-model` avisa,
  não condena.
- ~~Convite por e-mail~~ — **removido do produto** por decisão sua: a conta do
  colaborador é criada direto no sistema.

---

## Onde está o resto

- `CLAUDE.md` — arquitetura, convenções, o estado híbrido
- `docs/ROADMAP.md` — os lotes, princípios e o histórico
- `docs/DEPLOY.md` — EasyPanel, variáveis, o túnel, diagnóstico
- `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` — os 49 achados herdados (A1–A19,
  B1–B10); leitura obrigatória antes de mexer no caminho do chat
- `frontend/src/_legado/README.md` — o que sobrou do wizard
