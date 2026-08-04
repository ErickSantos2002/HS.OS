# REMIX_SECRETS — Variáveis para projetos remix (dn.os)

Configure em: **Backend (Lovable Cloud) → Settings → Edge Function Secrets**.

> Lista levantada direto do código (`Deno.env.get` nas Edge Functions) em 2026-07-17.
> Se você adicionar/remover Edge Functions, revalide esta lista.

---

## ⚠️ Importante: o LLM dos agentes NÃO é um secret do Lovable

Os super agentes rodam no **VPS (OpenClaw)**, e é o OpenClaw que chama o modelo de linguagem
(**DeepSeek V4 Pro**, na configuração atual). Portanto **a chave do LLM dos agentes é configurada
no VPS/OpenClaw**, não aqui. Não existe `ANTHROPIC_API_KEY` nem `GEMINI_API_KEY` em uso nas Edge
Functions (versões antigas deste manual pediam a chave da Anthropic — estava incorreto).

O único LLM chamado do lado Lovable é via **Lovable AI Gateway** (`LOVABLE_API_KEY`), usado por
`parse-company-context` e `transcribe-audio`.

---

## Gerenciadas automaticamente pelo Supabase/Lovable (NÃO cadastrar)

`SUPABASE_URL` · `SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` — recriadas sozinhas no remix,
apontando para o novo projeto.

---

## Obrigatórias — Gateway (sem elas os agentes não respondem)

| Variável | Descrição |
|---|---|
| `OPENCLAW_GATEWAY_URL` | URL do seu VPS OpenClaw. Também configurável na UI (Settings → Gateway → grava em `public.vps_config`); a env é o fallback quando a linha ainda não existe. |
| `OPENCLAW_ADMIN_TOKEN` | Token admin do VPS OpenClaw (gerado no setup do VPS). |
| `OPENCLAW_GATEWAY_TOKEN` | Só se usar `skill-manage`; se ausente, cai no `OPENCLAW_ADMIN_TOKEN`. |

## Obrigatórias — Segredos internos (gere strings aleatórias fortes)

Autenticam chamadas de volta do VPS/agentes para a plataforma. Cada uma deve ser uma string
aleatória longa e única desta instância.

| Variável | Usada por |
|---|---|
| `AUTOMATION_WEBHOOK_SECRET` | Callback das automações (`automation-result`) |
| `AGENT_REPLY_WEBHOOK_SECRET` | Resposta assíncrona de agente (`agent-reply-webhook`, `agent-task`) |
| `BROADCAST_API_KEY` | Broadcast API (`channel-broadcast`, `automations-api`) |
| `GUARDRAILS_API_TOKEN` | Guardrails dos agentes (`upsert-agent-guardrails`) |
| `SKILL_SYNC_SECRET` | Sync de skills (`skill-manage`) |
| `AGENT_ACTIVITY_BRIDGE_TOKEN` | Log de atividade do agente (`log-agent-activity`) |
| `INGEST_KEY` | Ingestão de snapshot de tokens (`ingest-token-snapshot`) |

## LLM auxiliar (Lovable AI Gateway)

| Variável | Descrição |
|---|---|
| `LOVABLE_API_KEY` | Parse de contexto da empresa e transcrição de áudio. Sem ela, essas features degradam. |

## Voz (opcional)

| Variável | Descrição |
|---|---|
| `ELEVENLABS_API_KEY` | Text-to-speech e agentes de voz (ConvAI nas Arenas). |

## E-mail (convites e recuperação de senha)

| Variável | Exemplo |
|---|---|
| `EMAIL_SITE_NAME` | Minha Empresa OS |
| `EMAIL_SENDER_DOMAIN` | notify.minhaempresa.com |
| `EMAIL_ROOT_DOMAIN` | minhaempresa.com |
| `EMAIL_FROM_DOMAIN` | minhaempresa.com |
| `EMAIL_SUBJECT_INVITE` / `_RECOVERY` / `_SIGNUP` / `_MAGICLINK` / `_REAUTHENTICATION` / `_EMAIL_CHANGE` | Assuntos dos e-mails (opcionais — têm default). |

## Push (opcional)

| Variável | Descrição |
|---|---|
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | Par VAPID (`web-push generate-vapid-keys`). |
| `VAPID_SUBJECT` | mailto: ou URL do responsável. |

## Específicas da dn.ia — NÃO cadastrar num remix de cliente

Estas são integrações internas da dn.ia. Deixe em branco no remix do cliente:
`DNMARKETING_API_KEY` · `META_ACCOUNT_ID` · `META_AD_ACCOUNT_ID` · `PRISMA_META_AD_ACCOUNT_ID` ·
`SKILLS_GATEWAY_URL` (só se tiver um registry de skills próprio).

---

## Segredos do Vault do banco (Supabase Vault — NÃO são Edge Function Secrets)

Algumas funções do banco (`trigger_send_push_on_notification`, `email_queue_dispatch`,
`email_queue_wake`) chamam Edge Functions via `net.http_post` e precisam saber a URL do
próprio projeto. Elas leem essa URL do **Vault do banco** (Supabase → Database → Vault, ou via
`SELECT vault.create_secret(...)`), não das Edge Function Secrets.

> **Auto-configuração:** ao abrir o **wizard de setup** (super_admin), a plataforma popula
> automaticamente `project_url`, `service_role_key` e `email_queue_service_role_key` no Vault a
> partir das env vars do próprio projeto (via edge function `configure-instance-vault`). Na maioria
> dos remixes você **não precisa fazer nada à mão**. A tabela abaixo é referência/fallback caso
> queira setar manualmente ou o setup não tenha rodado ainda.

**Se for setar manualmente** (senão push/e-mail não disparam ou caem no fallback da instância original):

| Secret (Vault) | Valor | Usado por |
|---|---|---|
| `project_url` | URL do SEU projeto Supabase (ex.: `https://SEU-REF.supabase.co`) | push + e-mail |
| `service_role_key` | Service role key do SEU projeto | push |
| `email_queue_service_role_key` | Service role key do SEU projeto (fila de e-mail) | e-mail |

> A migration `20260712144617` semeia `project_url` com a URL da instância original **apenas se
> ainda não existir** (`IF NOT EXISTS`). Por isso, num remix, crie o `project_url` do seu projeto
> **antes** de rodar/deployar — ou sobrescreva-o logo após. O fallback hardcoded nas funções é
> temporário ("um release") e será removido; não dependa dele.

---

## Limpeza dos dados dn.ia no remix (`remix_mode`)

As migrations rodam automaticamente no projeto novo e incluem seeds da dn.ia (agentes, canais,
integrações). Para o remix nascer limpo, ative o modo remix **antes/durante o primeiro deploy**:

- **Flag no banco** (dispara a migration `*_remix_cleanup`):
  ```sql
  ALTER DATABASE postgres SET app.remix_mode = 'true';
  ```
  Sem a flag a migration é no-op — proteção para a instância dn.ia.

- **Secret `REMIX_MODE=true`** — lido por `seed-agents` para não re-semear os agentes da dn.ia.

Ative **os dois** num remix de cliente.

---

> Dúvidas? Consulte o Consultor de Implementação dn.ia.
