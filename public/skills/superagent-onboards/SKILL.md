# Skill: superagent-onboards v2

**ID:** superagent-onboards

Automated onboarding skill for dn.os Remix. Reads `company_profile` from Supabase, fetches agent templates from Lovable project URL, replaces placeholders, and creates all 7 Super Agents in OpenClaw in under 60 seconds.

---

## Trigger

Executed by Lia once during client onboarding via agent-task API. Frontend sends:

```
POST {{SUPABASE_URL}}/functions/v1/agent-task
Body: {
  task_type: 'onboarding',
  selected_agents: ['lia','rock','milo','kira','sigma','radar','cs'],
  trigger_skill: 'superagent-onboards'
}
```

---

## Prerequisites

1. OpenClaw Gateway running on client VPS.
2. `company_profile` table populated in Supabase (name, segment, product, target_audience, brand_voice, mission, differentials).
3. `{{LOVABLE_PROJECT_URL}}` configured — the client's Lovable remix project URL, set during setup wizard, stored in SHARED_CONFIG.md.
4. Agent templates accessible via:
   - `{{LOVABLE_PROJECT_URL}}/templates/AGENTS.md`
   - `{{LOVABLE_PROJECT_URL}}/templates/{agent_id}/SOUL.md`
   - `{{LOVABLE_PROJECT_URL}}/templates/{agent_id}/IDENTITY.md`
   - `{{LOVABLE_PROJECT_URL}}/templates/{agent_id}/TOOLS.md`

---

## Flow

### Step 1 — Validate company_profile

```
GET {SUPABASE_URL}/rest/v1/company_profile?select=*
```

- If empty: **ABORT**. Notify user: *"Preencha os dados da empresa em Configurações → Empresa antes de criar os agentes."*
- If populated: extract `name`, `segment`, `product`, `target_audience`, `brand_voice`, `mission`, `differentials`, `gateway_url`, `setup_date`.

### Step 2 — Fetch AGENTS.md (shared)

```
GET {{LOVABLE_PROJECT_URL}}/templates/AGENTS.md
```

Write to `/root/.openclaw/workspace/AGENTS.md`. No placeholder replacement needed. Shared by all 7 agents. Confirmed: does **NOT** include `sessions_spawn` rule.

### Step 3 — For each agent (lia, rock, milo, kira, sigma, radar, cs)

**3a.** Fetch template files:
```
GET {{LOVABLE_PROJECT_URL}}/templates/{agent_id}/SOUL.md
GET {{LOVABLE_PROJECT_URL}}/templates/{agent_id}/IDENTITY.md
GET {{LOVABLE_PROJECT_URL}}/templates/{agent_id}/TOOLS.md
```

**3b.** Save the ORIGINAL templates (with placeholders intact) to:

```
/root/.openclaw/workspace-{agent_id}/.templates/SOUL.md
/root/.openclaw/workspace-{agent_id}/.templates/IDENTITY.md
/root/.openclaw/workspace-{agent_id}/.templates/TOOLS.md
```

These originals are the source of truth for future exports (`.dnos`) — they
must never contain real company data. Write them BEFORE any placeholder
substitution.

**3c.** Replace all placeholders with values from `company_profile`:

| Placeholder | Fonte |
|---|---|
| `{{COMPANY_NAME}}` | company_profile.name |
| `{{COMPANY_SEGMENT}}` | company_profile.segment |
| `{{COMPANY_PRODUCT}}` | company_profile.product |
| `{{TARGET_AUDIENCE}}` | company_profile.target_audience |
| `{{BRAND_VOICE}}` | company_profile.brand_voice |
| `{{MISSION}}` | company_profile.mission |
| `{{DIFFERENTIALS}}` | company_profile.differentials |
| `{{GATEWAY_URL}}` | company_profile.gateway_url |
| `{{SETUP_DATE}}` | data atual (gerada em runtime) |

**3d.** Write the substituted files to `/root/.openclaw/workspace-{agent_id}/`
(SOUL.md, IDENTITY.md, TOOLS.md). Note: the workspace layout is
`workspace-{agent_id}/`, NOT `workspace/agents/{agent_id}/`.

**3e.** Register agent in OpenClaw:
```
POST /agents { id, name, workspace: "/root/.openclaw/workspace-{agent_id}" }
```
No hardcoded model — uses whatever LLM the client configured in dn.os Conectores.

### Step 4 — Update SHARED_CONFIG.md

Append section listing all 7 agents with emoji, role, and setup date under `Super Agentes Ativos`.

### Step 5 — Register in MEMORY.md

```
[{SETUP_DATE}] Onboarding concluído. 7 Super Agentes ativados: Lia, Rock, Milo, Kira, Sigma, Radar, CS.
Contexto carregado de company_profile. Templates de {{LOVABLE_PROJECT_URL}}/templates/.
```

### Step 6 — Webhook confirmation (optional)

If `{{SUPABASE_URL}}` is available:
```
POST {{SUPABASE_URL}}/functions/v1/onboarding-complete
Body: { status, onboarded, failed, setup_date, company }
```
If endpoint doesn't exist, skip — Step 5 already logs the result.

---

## Error Handling

| Situação | Comportamento |
|---|---|
| `company_profile` vazio | Abort — notificar: *"Preencha Configurações → Empresa"* |
| `LOVABLE_PROJECT_URL` não configurado | Abort — notificar para configurar a URL do projeto |
| Template fetch falha (404) | Log, pular agente, continuar com o próximo |
| Falha ao escrever arquivo | Log, pular agente |
| Falha ao registrar no OpenClaw | Log, marcar agente como failed |
| Gateway offline | Abort imediato, notificar usuário |
| Sucesso parcial | Concluir com status `partial`, listar agentes que falharam |
| Todos falharam | Status `failed` com detalhes |

---

## Notas

- Tempo estimado: ~30-60 segundos total (~5s por agente)
- `AGENTS.md` buscado uma única vez na raiz do workspace — compartilhado por todos os agentes
- Cada `SOUL.md` referencia `AGENTS.md` via seção `Every Session`
- Sem modelo hardcoded — usa a LLM configurada pelo cliente
- `sessions_spawn` removido do AGENTS.md (sem suporte no dn.os hoje)
- `{{LOVABLE_PROJECT_URL}}` é pré-requisito obrigatório
- **Localização da skill:** `/root/.openclaw/workspace/skills/superagent-onboards/SKILL.md`
