# Remix Audit — Hardcodes dn.ia na dnOS

**Escopo:** somente leitura. Nenhum arquivo foi modificado.
**Objetivo:** listar tudo que precisa parametrizar antes de rodar remix para clientes.

Legenda de risco:
- 🔴 **Bloqueante** — remix quebra se não tratar
- 🟡 **Degradação** — funciona mas mostra "dn.ia" pro cliente ou usa quota errada
- 🟢 **Cosmético** — só copy/mock, sem impacto funcional

---

## 🔴 1. Gateway URL fixo (`agentes.dnia.ai`)

Cliente que fizer remix aponta para o gateway da dn.ia por padrão até editar em Settings.

| Arquivo | Linha | Nota |
|---|---|---|
| `supabase/migrations/20260627203557_*.sql` | 3, 49 | DEFAULT + INSERT em `vps_config` |
| `supabase/functions/_shared/gateway-config.ts` | 12 | `DEFAULT_URL` |
| `supabase/functions/skill-manage/index.ts` | 8 | fallback direto (não usa `getGatewayConfig`) |
| `supabase/functions/gateway-files-proxy/index.ts` | 199-204 | lista hardcoded de bases |
| `src/lib/gateway.ts` | 8 | `DEFAULT_URL` do frontend |
| `src/lib/file-upload.ts` | 233 | `fetch("https://agentes.dnia.ai/api/extract-text")` — **não passa por vps_config** |
| `src/pages/SettingsPage.tsx` | 985 | apenas placeholder — OK |

**Ação:** trocar defaults por string vazia + validar no wizard; refatorar `file-upload.ts` e `skill-manage` para lerem `vps_config`.

---

## 🔴 2. `'lia'` hardcoded no runtime

Cliente pode renomear/remover a Lia; código quebra.

| Arquivo | Linha | Uso |
|---|---|---|
| `supabase/functions/channel-broadcast/index.ts` | 4 | lista de agentes oficiais |
| `supabase/functions/channel-agent-reply/index.ts` | 32-35 | `OFFICIAL_AGENT_IDS` + display names |
| `src/lib/active-agents.ts` | 7 | `OFFICIAL_AGENT_ORDER` |
| `src/components/monitoring/UsageTab.tsx` | 34 | `AGENT_ORDER` |
| `src/components/monitoring/AgentsTab.tsx` | 23 | catálogo com cor hex |
| `src/components/agents/AgentActivityFeed.tsx` | 34 | catálogo com emoji |
| `src/components/agents/NeuralMap.tsx` | 53 | `agents.find(a => a.name.includes("lia"))` |
| `src/lib/arena-agents-catalog.ts` | 12, 18 | catálogo arena |
| `src/pages/ArenaViewPage.tsx` | 292 | fallback `"lia"` |
| `src/lib/dnos-documentation-yaml.ts` | 240 | exemplo de payload |

**Já corretos** (usam `is_leader = true`): `notify-orchestrator-onboarding`, `seed-agents:261`, `AgentEditDrawer`, `AgentDetailPanel`, `UsersPage`.

**Ação:** trocar todas as listas por query em `agent_profiles`; substituir `.find("lia")` por `.find(a => a.is_leader)`.

---

## 🔴 3. UUID de canal fixo em trigger de signup

| Arquivo | Linha | O quê |
|---|---|---|
| `supabase/migrations/20260319231612_*.sql` | 23 | `handle_new_user()` faz INSERT em `channel_members` com channel_id fixo `da171c99-...` |
| `supabase/migrations/20260319181804_*.sql` | 19-45 | mesma UUID + adição de todos os agentes oficiais como membros |

**Impacto:** em novo Supabase, esse UUID não existe → toda função `handle_new_user` na versão atual (`ON CONFLICT DO NOTHING`) engole silenciosamente, mas o novo usuário não entra em nenhum canal padrão.

**Ação:** migration nova que busca `channels WHERE type='public' ORDER BY created_at LIMIT 1` em vez de UUID literal.

---

## 🔴 4. Migrations com dados dn.ia

Rodam automaticamente no remix e inserem entidades erradas.

| Arquivo | Conteúdo |
|---|---|
| `20260318122351_*.sql` | `UPDATE profiles ... WHERE email = 'rodrigo@dnia.ai'` |
| `20260318230331_*.sql` | INSERT dos canais `geral`, `geração-demanda`, `operações` |
| `20260318232422_*.sql` | Adiciona Lia como membro de canais dn.ia |
| `20260319181804_*.sql` | Adiciona todos os 8 agentes oficiais como membros |
| `20260517162929_*.sql` | Departamentos hardcoded (`lia:Operações`, `rodrigo:Estratégia`, ...) |
| `20260517164628_*.sql` | Roles/specialties hardcoded |
| `20260621024251_*.sql` | Seed da tabela `integrations` com 15+ credenciais dn.ia (Nexus CRM, dnMarketing, Mentor.ia, DNTASK) |
| `20260628022358_*.sql` | Seed dos 6 agentes canônicos |
| `20260628025827_*.sql` | Normalização de nomes/descrições |
| `20260628032335_*.sql` | Fix específico do `cs` e `rodrigo` |

**Ação:** essas migrations são **história** — não dá para editar. Estratégia é migration nova (numa release "remix-ready") que:
1. Trunca/remove os dados dn.ia se `setup_config.remix_mode = true`
2. Ou marca as antigas como "seed condicional" e reseta via edge function no wizard.

---

## 🔴 5. Seed dos SOULs dos agentes está em código

`supabase/functions/seed-agents/index.ts` linhas 22-118 tem `TEMPLATES` com SOULs específicos dn.ia (Milo/Meta Ads, Kira/conteúdo, Rock/vendas, Sigma/copy, Radar/pesquisa) — inclusive tom de voz e regras.

**Ação:** mover TEMPLATES para tabela `agent_templates` ou storage, e permitir override por remix.

---

## 🟡 6. Project ref do Supabase em funções DB

| Arquivo | Linha |
|---|---|
| `supabase/migrations/20260522113229_*.sql` | 22: `_supabase_url TEXT := 'https://zozyfhisrbkqvdcsdbfp.supabase.co'` |
| `supabase/migrations/20260607010500_*.sql` | 8: idem |

Usado em `trigger_send_push_on_notification` e `email_queue_dispatch` para `net.http_post`. Em remix, o novo Supabase tem outro ref → push/email vão pro projeto errado.

**Ação:** substituir por `current_setting('app.supabase_url')` ou vault entry.

---

## 🟡 7. Domínios de e-mail dn.ia

`supabase/functions/auth-email-hook/index.ts` linhas 40-42:
```
SENDER_DOMAIN = "notify.www.dnia.ai"
ROOT_DOMAIN   = "www.dnia.ai"
FROM_DOMAIN   = "notify.www.dnia.ai"
```

**Ação:** ler de `branding` ou env var por-tenant.

---

## 🟡 8. Integrações fake (dn.marketing, dn.nexus, Mentor.ia)

`src/components/settings/IntegrationsTab.tsx` 88-127, 202-206, 923 — categoria "APIs dn.ia" com Nexus/dnMarketing/Mentor.ia. Cliente vê integração que não existe pra ele.

**Ação:** ocultar categoria `dnia` quando `branding.tenant !== 'dnia'`.

---

## 🟡 9. Fallback env `OPENCLAW_*`

`_shared/gateway-config.ts:32-33` e `skill-manage/index.ts:14`. Em remix, essas envs estão vazias e `vps_config` também até o wizard rodar. Tudo bem — retorna string vazia — desde que UI trate "não configurado" corretamente. **Verificar** que edge functions críticas retornam erro claro em vez de 500.

---

## 🟢 10. Branding textual "DN.IA" espalhado

~30 ocorrências em `DocumentationPage.tsx`, `dnos-documentation-yaml.ts`, `dnos-design-system-yaml.ts`, `index.css` comments, `FleetHealthBar.tsx` (h1 "Centro de Comando dnia"), `WelcomeCard.tsx`, `LoginPage.tsx` (logo fallback `/dnia-logo.png`), `PublicArtifactPage.tsx`, `theme-provider.tsx` (`storageKey="dnia-theme"`), `mock-data.ts`, `chat-sender.ts:312` (cores DN.IA azul/vermelho).

**Ação:** trocar por `branding.companyName` onde é UI viva. Docs (`DocumentationPage`, YAMLs) podem virar template Handlebars ou permanecer "dnOS by dn.ia" (é o produto).

---

## 🟢 11. Aliases legados (`rodrigo`, `cs`)

`src/lib/agent-id.ts:18-23`, `src/pages/ChatPage.tsx:2270`, várias migrations. São aliases de retrocompat da dn.ia — em remix não interferem, mas viram peso morto.

---

## Resumo executivo

| Categoria | Itens | Prioridade |
|---|---|---|
| Gateway URL default | 7 arquivos | 🔴 antes do wizard |
| `'lia'` hardcoded | 10 arquivos (código vivo) | 🔴 antes do wizard |
| Canal UUID + trigger signup | 2 migrations | 🔴 nova migration |
| Migrations com dados dn.ia | 10 migrations | 🔴 estratégia `remix_mode` |
| SOULs em código | 1 arquivo (seed-agents) | 🔴 mover pra dados |
| Project ref no DB | 2 funções | 🟡 vault/setting |
| Domínio de e-mail | 1 arquivo | 🟡 branding |
| Integrações fake dn.ia | 1 arquivo | 🟡 ocultar por tenant |
| Fallback env OPENCLAW | 3 arquivos | 🟡 verificar UX de erro |
| Copy "DN.IA" | ~30 ocorrências | 🟢 branding.companyName |
| Aliases legados | 3 arquivos | 🟢 limpar depois |

**Total bloqueante:** ~30 arquivos + 12 migrations.
**Ordem sugerida:** #5 (SOULs) → #2 (`'lia'`) → #1 (gateway URL) → #3+#4 (migrations/UUID) → resto.
