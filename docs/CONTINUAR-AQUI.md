# Continuar aqui

Ponto de retomada da portagem. Atualizado em **06/08/2026**, ao fim do Lote 2b.
Leia isto, depois `CLAUDE.md` e `docs/ROADMAP.md`.

## O que já funciona

Tudo abaixo está **em produção** e verificado:

- **Banco próprio** no Postgres da VPS — 69 tabelas, 191 policies de RLS ativas
  de verdade (o backend conecta como `hsos_app`, não como superusuário)
- **Autenticação própria** — JWT + bcrypt, sem Supabase Auth
- **Marca HS.OS** aplicada; `dn.ia` só sobrevive em `frontend/src/_legado/`
- **Gateway conectado** por túnel SSH, com o `admin_token` fora do navegador
- **Agentes** — lista, sincronização, edição completa de perfil (todas as abas),
  verificação de modelo e liderança em lote
- **Deploy** — `hsos.healthsafetytech.com` e `hsosapi.healthsafetytech.com`

Endpoints: `/health`, `/auth/*`, `/branding`, `/profiles/*`, `/gateway/*`, `/agents/*`.

## Placar

**21 de 73** edge functions com substituto · **16 de 113** arquivos do front sem
Supabase · **27** functions distintas ainda referenciadas pelo front.

**O chat funciona** — conversa com agente e canais, verificados no navegador.

O `AgentEditDrawer` chama **uma** edge, `delete-agent` — era oito chamadas de
cinco functions diferentes no início de 06/08/2026.

⚠️ O número 34 corrige o "26" anterior, que era subestimado: o grep antigo não via
chamadas indiretas (`callEdge(fn, …)` com o nome em variável). A forma correta de
medir está em `docs/ROADMAP.md`.

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
