/**
 * Como a resposta de `GET /agents` vira o catálogo de agentes da casa.
 *
 * Mora fora do hook para poder ser testada sem React nem rede — foi aqui que o
 * defeito viveu, e um teste de hook não o teria pego.
 */
import type { AgentCatalogEntry } from "@/lib/agent-catalog";

/**
 * ⚠️ **Não filtre por `isOfficial` aqui.** A versão anterior filtrava, e o
 * catálogo ficava permanentemente vazio: `agent_profiles.is_official` é coluna
 * herdada do schema Supabase (`001_initial_schema.sql`, `DEFAULT false`) que
 * **nada no backend jamais escreve**. Em 02/09/2026, `GET /agents` em produção
 * devolvia os cinco agentes da casa, todos com `isOfficial: false`.
 *
 * O efeito era mudo e grande: com o catálogo vazio, `isOfficialAgentId()`
 * responde `false` para todo mundo, e tudo que depende dela morre em silêncio —
 * mencionar um agente num canal nunca acionou agente nenhum, porque
 * `getRespondingAgents` filtra os membros por ela.
 *
 * O filtro também era redundante: `GET /agents` seleciona **de
 * `agent_profiles`** (ver `backend/app/routers/agents.py`), então tudo que ele
 * devolve já é do catálogo por construção. Ter perfil é ser do catálogo.
 */
export function catalogoDaResposta(agentes: unknown): AgentCatalogEntry[] {
  const lista = Array.isArray(agentes) ? agentes : [];
  return lista
    .map((row: any) => ({
      id: String(row?.id ?? "").trim(),
      name: row?.name ?? "",
      emoji: row?.emoji ?? null,
      color: row?.color ?? null,
      isLeader: !!row?.isLeader,
      sortOrder: row?.sortOrder ?? null,
    }))
    .filter((e) => e.id);
}
