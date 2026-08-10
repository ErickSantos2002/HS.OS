/**
 * Arena agents catalog — computed at runtime from the official agents
 * catalog (`agent_profiles` via `@/lib/agent-catalog`).
 *
 * Suggested roles are optional starting points shown in the AgentRoleSelector.
 * They're keyed by `agent_id` and left empty when no hint is configured, so
 * remix deployments work without a per-brand list.
 */

import { getOfficialAgentEntries } from "@/lib/agent-catalog";

export interface ArenaAgentCatalog {
  id: string;
  name: string;
  suggestedRoles: string[];
}

const ROLE_HINTS: Record<string, string[]> = {
  // HS.OS curated hints
  lia: ["Orquestradora", "Analista", "Coordenadora"],
  milo: ["Estrategista de Tráfego", "Growth Hacker", "Performance"],
  kira: ["Diretora de Conteúdo", "Criativa", "Copywriter"],
  radar: ["Inteligência de Mercado", "Pesquisador", "Analista Competitivo"],
  sigma: ["Pesquisa e Dados", "Cientista de Dados", "Analista Quantitativo"],
  cs: ["Atendimento e Sucesso", "Customer Success", "Suporte Especializado"],
  rodrigo: ["Visão Estratégica", "CEO / Diretor", "Tomada de Decisão"],
  rock: ["Diretor de Vendas", "Comercial", "Closer"],
  // remix canonical templates
  orchestrator: ["Orquestrador", "Coordenador", "Facilitador"],
  traffic: ["Estrategista de Tráfego", "Performance", "Growth"],
  content: ["Diretor de Conteúdo", "Editorial", "Criativo"],
  sales: ["Diretor Comercial", "Vendedor", "Closer"],
  copy: ["Copywriter", "Estrategista de Copy", "Redator"],
  research: ["Pesquisador", "Analista de Mercado", "Inteligência Competitiva"],
  success: ["Customer Success", "Atendimento", "Retenção"],
};

/**
 * Live catalog derived from `agent_profiles.is_official = true`.
 * Returns an empty list when the catalog hasn't loaded yet.
 */
export function getArenaAgentsCatalog(): ArenaAgentCatalog[] {
  return getOfficialAgentEntries().map((e) => ({
    id: e.id,
    name: e.name || e.id,
    suggestedRoles: ROLE_HINTS[e.id] ?? [],
  }));
}
