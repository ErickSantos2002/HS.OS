# Continuar aqui

Ponto de retomada da portagem. Atualizado em **13/08/2026**. Leia isto, depois
`CLAUDE.md` e `docs/ROADMAP.md`.

🎉 **O front saiu do Supabase.** Nenhuma chamada `.from()`, nenhum
`functions.invoke`, nenhum `supabase.channel`. O único arquivo que ainda
importa o client é o próprio `integrations/supabase/client.ts`, que existe só
para lançar caso alguém o use. **Zero** edge functions por portar.

👉 **Arena, War room e voz pausadas em 10/08** — ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md).

👉 **Vai testar o sistema?** Comece por [`TESTAR-SEGUNDA.md`](TESTAR-SEGUNDA.md)
— roteiro em ordem, o que já se sabe que não funciona, e o que precisa ser
testado junto porque tem efeito real.

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

---

## Retomando — nesta ordem

Os quatro agentes especializados foram apagados em 12/08, por decisão: cada um
tinha sido montado enquanto se aprendia a ferramenta, sem padrão. Só a `nina`
restou. Os workspaces completos estão em `~/backups/agentes-hsos-2026-08-12/`
— é o único registro deles.

A ordem combinada, e o porquê dela:

1. ~~**Preencher a aba Empresa**~~ ✅ **feito em 13/08.** O bloco da empresa é
   escrito pelo backend direto no `AGENTS.md` de cada agente, entre marcadores
   `hsos:empresa:inicio/fim`, iterando o `agents.list`. Sem LLM no caminho: a
   primeira versão mandava a orquestradora fazer, custou 34 mil tokens, e ela
   escreveu em quatro workspaces que não existiam mais.

2. **Converter o [`AGENT_CREATION.md`](AGENT_CREATION.md) em skill.** O
   procedimento não pode virar arquivo no workspace: o gateway só escreve os
   sete canônicos, e arquivo fora deles não carrega sozinho. A skill é
   carregada sob demanda; no contexto dela fica só *"para criar agente, use a
   skill X"*. Confirmado com quem opera a plataforma de origem.
   ⚠️ Até isso existir, o briefing aponta para um arquivo que não está no
   workspace dela.

3. **A orquestradora cria o primeiro agente**, de ponta a ponta. É o teste que
   fecha o ciclo.

Dois consertos de 12/08 que tornam isso possível: o aviso ao líder ia num
formato que o gateway recusava (todos os avisos estavam quebrados, não só o de
criação), e a falha era engolida — a tela dizia "criado" para um agente vazio.
Hoje, briefing não entregue **desfaz** a criação.

⚠️ **Pendência de segurança que não pode esperar:** a senha de superusuário dos
bancos DataCore (`administrador`/`administrador`) esteve em texto puro no
workspace de um agente por três meses, indo para a LLM a cada sessão. O agente
foi apagado, mas **a senha precisa ser trocada** — e o sanitizador da exportação
não a remove, o que é bug nosso.

---

## Placar — medido, não mantido à mão

O contador deste arquivo já mentiu uma vez: eu vinha incrementando a cada port
sem conferir, e ele chegou a dizer "72 de 73 resolvidas" com 13 functions ainda
na pasta. **Todo número aqui vem de um comando**, e o comando está ao lado.

| | Hoje | Total | Como medir |
|---|---|---|---|
| Edge functions **por portar** | — | **0** | `ls backend/supabase/functions \| grep -vE "_shared\|_pausado\|_portado" \| wc -l` |
| Portadas | 65 | 73 | as outras 8 estão em `_pausado/` — ver [`EM-CONSTRUCAO.md`](EM-CONSTRUCAO.md) |
| Arquivos do front com Supabase | **1** | 278 | `grep -rl "integrations/supabase/client" frontend/src \| grep -v _legado \| wc -l` |
| Rotas na API própria | **240** | — | `curl -s localhost:8002/openapi.json \| jq '.paths \| length'` |
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
