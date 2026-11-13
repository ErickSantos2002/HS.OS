/**
 * O catálogo de agentes como valor reativo.
 *
 * `getAgentDisplayName` lê um cache de módulo (`lib/agent-catalog.ts`) que o
 * `useAgentCatalog` preenche depois do primeiro render. Enquanto as listas de
 * mensagem redesenhavam a cada render, o nome certo aparecia "de carona";
 * com elas em `memo` (13/11/2026), a bolha ficava com o nome provisório
 * ("Nina Bot") até a próxima mensagem — e um Guardi renomeado não mudava.
 * Quem chama o nome dentro de uma lista memo passa este valor como prop.
 */
import { useSyncExternalStore } from "react";

import { getOfficialAgentEntries, subscribeAgentCatalog, type AgentCatalogEntry } from "@/lib/agent-catalog";

const assinar = (aoMudar: () => void) => {
  const cancelar = subscribeAgentCatalog(aoMudar);
  return () => { cancelar(); };
};

export function useCatalogoDeAgentes(): AgentCatalogEntry[] {
  return useSyncExternalStore(assinar, getOfficialAgentEntries, getOfficialAgentEntries);
}
