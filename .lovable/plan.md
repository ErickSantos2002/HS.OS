## Objetivo

Arena = espaço para juntar **agentes existentes** e fazê-los conversar. Pode ser **single-agent** (1 agente — típico em modo voz) ou **multi-agent** (2+ agentes — típico em chat/debate). Nada de criar agente dentro da arena. Se o usuário quiser transformar um agente em vendedor/entrevistador, ele usa o **papel por agente na arena** (`arena_agents.role_name` / `role_description`, que já existe) — instrução temporária, não vira agente novo.

## Fora do escopo (remover)

- Persona no nível da arena (`persona_name`, `persona_role`, `system_prompt`)
- Criar agente pela tela da arena (`new_agent_name`, `new_agent_soul`)

## Fica

- Seleção de 1+ agentes existentes com papel opcional por agente
- Nome, descrição, emoji, prompt inicial, voz opcional, `opening_message`

## Mudanças

### 1. Migração
`ALTER TABLE public.arenas DROP COLUMN IF EXISTS persona_name, persona_role, system_prompt, new_agent_name, new_agent_soul;`

### 2. Frontend
- **`src/lib/arena-store.ts`**: remover `personaName`, `personaRole`, `systemPrompt`, `newAgentName`, `newAgentSoul` de `Arena`, `rowToArena`, `saveArena`.
- **`src/pages/ArenaCreatePage.tsx`**: remover seção "Persona / Simulador" e o form "novo agente". Validação passa a exigir **≥ 1 agente** (não 2). Sem aviso de "precisa de 2 para debate".
- **`src/pages/ArenaViewPage.tsx`**: desfazer hack que mostrava `personaName` no avatar — volta a ser o próprio agente. Papel por agente continua no tooltip/legenda.
- **`src/components/arena/TemplateSelector.tsx`**: parar de preencher campos de persona; templates só sugerem `prompt` + papéis por agente.
- **`src/lib/arena-sandbox.ts`** e **`supabase/functions/arena-generate/index.ts`**: remover `persona_*`/`system_prompt` do payload. Contexto do LLM = `agents[] + role_description opcional + prompt`. Suportar 1 agente sem quebrar.
- **`supabase/functions/arena-convai-create/index.ts`**: `systemPrompt` passa a vir de `prompt` da arena.

### 3. Não mexer
- `arena_agents` (papel por agente já resolve "simulador")
- Sessões/mensagens
- Sem migração de dados: arenas antigas mantêm `agents` e `prompt`; campos removidos somem.

## Ordem
1. Migração (drop colunas) via supabase--migration
2. Após aprovação e regeneração de types, ajustar frontend + edge functions no mesmo turno.

---

## Dívida técnica — Onboarding wizard (Task #30)

**Antes do primeiro remix real em produção:**

- `company_profile` hoje exige `super_admin` para escrita. Passo 3 do wizard (PR 3) grava direto via cliente — vai falhar para o primeiro usuário se ele não for admin.
- **Solução escolhida:** rotear a persistência de `company_profile` (e opcionalmente `integrations` do PR 4) por uma edge function com `service_role`, autorizada apenas quando `onboarding_progress.completed_at IS NULL` para o `auth.uid()` corrente.
- **Não** abrir política de escrita direta em `company_profile` para `authenticated`.
