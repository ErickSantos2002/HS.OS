# Continuar aqui

Ponto de retomada da portagem. Atualizado em **06/08/2026**, ao fim de uma sessão
longa. Leia isto, depois `CLAUDE.md` e `docs/ROADMAP.md`.

## O que já funciona

Tudo abaixo está verificado **no navegador**, não só por endpoint:

- **Banco próprio** no Postgres da VPS — 69 tabelas, 191 policies de RLS ativas
  de verdade (o backend conecta como `hsos_app`, não como superusuário)
- **Autenticação própria** — JWT + bcrypt
- **Agentes** — ciclo de vida completo: criar, editar (todas as abas), sincronizar,
  verificar modelo, liderança, excluir
- **Usuários** — lista, criar conta, papel, ativar/desativar, excluir
- **Chat com agente** — envio e resposta, por long-poll do `agent.wait`
- **Canais** — criar, mensagens, membros
- **Arquivos** — storage próprio em disco, cinco buckets
- **Tempo real** — WebSocket em `/ws`, substitui o `postgres_changes`
- **Deploy** — `hsos.healthsafetytech.com` e `hsosapi.healthsafetytech.com`

## Placar

**52 de 73** edge functions com substituto · **33** ainda na pasta ·
**20 de 113** arquivos do front sem Supabase.

O `ls backend/supabase/functions | grep -v _shared | wc -l` agora é a medida
honesta: tudo que tem substituto saiu da pasta.

## ⚠️ Antes de confiar em qualquer verificação

**`npx tsc --noEmit` não checa nada neste projeto.** O `tsconfig.json` da raiz tem
`"files": []` com project references. O build do Vite também não checa tipos —
o esbuild só os remove. O comando certo é:

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Isso custou meia sessão de falsa confiança. **Sempre use o `-p`.**

## As duas coisas que travam o resto

### 🔴 Lovable AI Gateway — decisão de produto, não técnica

`transcribe-audio`, `chat-image-vision` e `parse-company-context` chamam
`ai.gateway.lovable.dev` com `LOVABLE_API_KEY`. É dependência da plataforma de
origem. As três opções e o custo de cada uma estão em `docs/ROADMAP.md`.

### 🟠 ElevenLabs — mesma natureza

As functions de voz e arena (`list-elevenlabs-voices`, `elevenlabs-tts`,
`arena-convai-*`) dependem de chave da ElevenLabs.

**Estratégia acordada para as duas:** portar tudo que dá e deixar **só** a chamada
ao provedor parametrizada, esperando a chave. Assim elas saem da pasta e não
travam o placar.

## Próximo passo, em ordem de valor

1. **`configure-llm-provider`** (717 linhas) — a maior sem bloqueio. A tela usa
   cinco ações: `list`, `save`, `remove`, `discover`, `discover_status`. As outras
   (`ops_pull`, `ops_report`) servem a um worker na VPS, não ao navegador. Usa a
   tabela `llm_provider_ops` como fila de trabalho.
2. **`agent-task`** (706 linhas) + **`turn-reconciler`** (864) — Loop Architecture,
   tarefas longas com `checkpoint_data`. São as duas maiores do que sobrou.
3. **`skill-manage`**, **`generate-document`**, **`warroom-feed`** — médias, com
   tela por trás.
4. **`monitoring-proxy`** — ⚠️ proxia para `${gateway}/api/monitoring/*`, que é REST.
   Provavelmente 404 como as outras rotas REST do gateway. **Confirme antes de
   portar**, senão você reescreve algo que não tem para onde apontar.

**Padrão que funcionou bem hoje:** os endpoints máquina-a-máquina (a VPS chamando
a plataforma) estão todos em `app/routers/integracoes.py`, com a autenticação por
segredo compartilhado em `app/integracoes.py`. Function nova desse tipo entra lá.

⚠️ **O cache de segredo é de 60 segundos.** Ao testar um endpoint desses logo
depois de gravar o segredo, espere o cache expirar ou o 401 vai confundir.

## Pendências de infraestrutura que a portagem criou

- **`UPLOADS_DIR` precisa ser volume persistente** no EasyPanel. Sem isso, todo
  deploy apaga avatares e anexos.
- **O WebSocket exige `wss://`** em produção: o token vai na query (a API do
  navegador não permite cabeçalho), então em `ws://` ele viajaria em claro.
- **O tempo real vive na memória de um processo.** Com mais de um worker do
  uvicorn, quem está no worker A não recebe o que foi publicado no B. Hoje roda em
  processo único e está correto.

## ⚠️ Erro de operação que já aconteceu — não repita

Em 06/08/2026, uma sondagem mandou `agents.update` com um modelo inválido de
propósito, **esperando que o gateway recusasse**. Ele aceitou e gravou: o agente
`nina`, que é o `defaultId`, ficou com `model: "isto-nao-e-um-modelo"` em
produção até ser restaurado à mão.

**O gateway não valida o que grava.** Para descobrir formato de parâmetro, use um
`agentId` inexistente — a chamada falha na busca do agente, antes de escrever.
Nunca use valor inválido num alvo real.

## Antes de escrever qualquer linha

1. **Suba o túnel SSH.** Sem ele, tudo que toca o gateway falha com
   `Connection refused` e o sintoma parece bug de código.
2. **Confira `CLAUDE.md`** — as armadilhas do gateway (protocolo WebSocket, a
   identidade que concede scopes, o loopback) e do banco (superusuário bypassa
   RLS) estão lá e cada uma custou horas.
3. **Leia a edge function correspondente antes de portar.** As 73 em
   `backend/supabase/functions/` são a especificação: descrevem um sistema que
   funcionava. Foi assim que descobrimos que o protocolo do gateway tinha mudado.

## Próximos passos, em ordem de dependência

### 0. Verificar com o Erick o que ficou pendente (fazer primeiro)

Três coisas foram escritas e **não** foram verificadas rodando, porque testar
dispara efeito real. Ficou combinado fazer junto:

- **Avisos aos agentes** (`_avisar_agente` em `app/routers/agents.py`). Mudar o
  acesso ou a liderança de um agente manda mensagem de verdade para o
  orquestrador, que entra no histórico dele. Testar: mudar o acesso de um agente
  na tela e confirmar que a `nina` recebeu.
- **`delete-agent`**, ainda não portada — apaga no gateway (`agents.delete`) e em
  três tabelas (`agent_profiles`, `agent_avatars`, `agent_integrations`). Não dá
  para verificar sem apagar um agente de verdade.
- **O drawer inteiro na tela** — ver o item 1 abaixo, que é o que o desbloqueia.

### 1. A `UsersPage` está vazia e esconde o Lote 2b inteiro

O `AgentEditDrawer` é montado **só** em `UsersPage`, que aparece embutida em
`/settings?tab=users`. Essa tela mostra **0 registros** porque o `fetchAll` dela
(`frontend/src/pages/UsersPage.tsx:198-206`) ainda lê `profiles`, `user_roles`,
`agent_profiles` e `agent_stats` direto do Supabase.

Sem lista não há como abrir o drawer, então todo o trabalho do Lote 2b está
entregue e invisível. As três primeiras leituras já têm endpoint pronto
(`/profiles` e `/agents`, este último já devolvendo `leaderId`); `agent_stats`
não tem, e serve só para o "última atividade".

É escopo do Lote 4, mas é o que faz o 2b aparecer.

### 2. Criar e excluir agente — Lote 2c

`create-agent` (448 linhas) provisiona workspace no gateway e dispara onboarding
pelo agente líder. `delete-agent` remove dos dois lados. São os mais delicados do
lote porque mexem em estado externo.

### 3. Chat — Lote 3, onde vira produto

⚠️ **Leia `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` antes.** A1–A19 e B1–B10
documentam execução duplicada, falso-positivo de estouro de contexto e heartbeat
descartando a resposta final. As quatro correções estão atrás de flags
`dnos_flag_*` **desligadas por padrão** — decidir se viram comportamento padrão.

`frontend/src/lib/chat-sender.ts` (~2.100 linhas) é o arquivo mais delicado do
projeto. Portar em etapas, verificando cada uma.

### 4. Storage — destrava avatares e anexos

Seis buckets a recriar: `agent-files`, `audio-messages`, `wiki-uploads`
(públicos), `company-docs`, `generated-documents` (privados). É o que falta para
`use-agent-avatar.ts` funcionar.

## Decisões pendentes

| Decisão | Por quê importa |
|---|---|
| ~~Credencial da Anthropic expirada~~ — **resolvido, era alarme falso** | O `models.authStatus` diz `expired` no perfil `anthropic:claude-cli`, mas em 06/08/2026 a `nina` respondeu a uma mensagem de verdade pelo chat portado. Existe credencial que o `authStatus` não enxerga. Ou seja: `POST /agents/test-model` pode reprovar modelo que funciona — ele avisa, não condena. |
| **Trocar a senha `admin123`** | Conta `super_admin` que guarda o token do gateway. Precisa de `POST /auth/change-password`. Fazer **antes** de liberar para a equipe. |
| Flags `dnos_flag_*` viram padrão? | São 4 correções de estabilidade hoje desligadas — o sistema roda com os bugs antigos ativos. |
| Manter as 191 policies de RLS? | Funcionam, mas duplicam a autorização do FastAPI. Se aposentar, vira a `003`. |
| Gerenciador de pacotes do front | Convivem `bun.lock`, `bun.lockb` e `package-lock.json`. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |

## Armadilhas que já custaram tempo

Repetidas aqui porque são as que fazem perder uma tarde:

- O gateway **conecta com sucesso** e nega tudo com `missing scope` quando a
  identidade do cliente está errada — ou quando o scope não foi **pedido** no
  handshake (`SCOPES` em `client.py`)
- O **handshake WebSocket dá timeout de vez em quando** com o túnel de pé e
  `/health` em 200. Repita antes de concluir que o gateway caiu
- O modelo é **assimétrico**: `agents.list` devolve `{"primary": "..."}`,
  `agents.update` exige string nua
- **Superusuário bypassa RLS** — as policies ficam no catálogo sem proteger nada
- No **PG 16+** a herança de role é gravada por associação: `ALTER ROLE NOINHERIT`
  posterior não altera GRANTs já feitos
- `VITE_*` é embutido em **build**, não em runtime — no EasyPanel tem que ser
  *build arg*
- `pg_cron` **não existe** na VPS; os jobs agendados vão para um serviço `worker`
- O Postgres da VPS **não suporta TLS**

## Onde está o resto

- `CLAUDE.md` — arquitetura, convenções, o estado híbrido
- `docs/ROADMAP.md` — os 7 lotes, princípios e o placar
- `docs/DEPLOY.md` — EasyPanel, variáveis, o túnel, diagnóstico
- `docs/AUDITORIA-ESTABILIDADE-2026-07-16.md` — os 49 achados herdados
- `frontend/src/_legado/README.md` — o que sobrou do wizard e o que vale aproveitar
