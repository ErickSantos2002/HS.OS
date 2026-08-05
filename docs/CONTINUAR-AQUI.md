# Continuar aqui

Ponto de retomada da portagem. Escrito em **05/08/2026**, ao fim da sessão que fez
a fundação. Leia isto, depois `CLAUDE.md` e `docs/ROADMAP.md`.

## O que já funciona

Tudo abaixo está **em produção** e verificado no navegador:

- **Banco próprio** no Postgres da VPS — 69 tabelas, 191 policies de RLS ativas
  de verdade (o backend conecta como `hsos_app`, não como superusuário)
- **Autenticação própria** — JWT + bcrypt, sem Supabase Auth
- **Marca HS.OS** aplicada; `dn.ia` só sobrevive em `frontend/src/_legado/`
- **Gateway conectado** por túnel SSH, com o `admin_token` fora do navegador
- **Agentes** — lista, sincronização e edição de perfil
- **Deploy** — `hsos.healthsafetytech.com` e `hsosapi.healthsafetytech.com`

Endpoints: `/health`, `/auth/*`, `/branding`, `/profiles/*`, `/gateway/*`, `/agents/*`.

## Placar

**12 de 73** edge functions com substituto · **13 de 113** arquivos do front sem
Supabase · **26** functions distintas ainda invocadas.

```bash
# medir a qualquer momento
grep -rn 'functions\.invoke(' frontend/src --include=*.ts --include=*.tsx \
  | grep -v _legado | grep -oP 'invoke\(\s*"\K[^"]+' | sort -u | wc -l
grep -rl 'integrations/supabase/client' frontend/src --include=*.ts --include=*.tsx \
  | grep -v _legado | wc -l
```

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

### 1. Gravação de agente — fecha o Lote 2b

`AgentEditDrawer.tsx` já **lê** pela nossa API, mas ainda **grava** por edge
function. Portar `update-agent-profile`, `test-llm-model` e
`sync-agent-leadership`.

Atenção: `update-agent-profile` grava no banco **e** no gateway (`agents.update`).
Só metade seria pior que nada — o banco diria uma coisa e o agente faria outra.

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
| **Trocar a senha `admin123`** | Conta `super_admin` que guarda o token do gateway. Precisa de `POST /auth/change-password`. Fazer **antes** de liberar para a equipe. |
| Flags `dnos_flag_*` viram padrão? | São 4 correções de estabilidade hoje desligadas — o sistema roda com os bugs antigos ativos. |
| Manter as 191 policies de RLS? | Funcionam, mas duplicam a autorização do FastAPI. Se aposentar, vira a `003`. |
| Gerenciador de pacotes do front | Convivem `bun.lock`, `bun.lockb` e `package-lock.json`. |
| Variante do wordmark para tema escuro | O "OS" cinza tem contraste baixo no escuro. |

## Armadilhas que já custaram tempo

Repetidas aqui porque são as que fazem perder uma tarde:

- O gateway **conecta com sucesso** e nega tudo com `missing scope` quando a
  identidade do cliente está errada
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
