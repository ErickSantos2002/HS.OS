/**
 * Loads the official agents catalog from `agent_profiles` and syncs it
 * into the module-level cache used by sync accessors in `@/lib/agent-catalog`.
 *
 * Mount once inside AuthProvider (see AppLayout) — subsequent renders reuse
 * the React Query cache; realtime changes on `agent_profiles` invalidate.
 */

import { api } from "@/lib/api";
import { assinarTabela } from "@/lib/realtime";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AgentCatalogEntry,
  getOfficialAgentEntries,
  setAgentCatalog,
} from "@/lib/agent-catalog";

const QUERY_KEY = ["agent-catalog"] as const;

async function fetchCatalog(): Promise<AgentCatalogEntry[]> {
  // `/agents` devolve `{agents, defaultId, gatewayOk}`, não um array.
  const { agents: todos } = await api<{ agents: any[] }>("/agents");
  const data = (todos ?? []).filter((a) => a.isOfficial);

  return data.map((row: any) => ({
    id: String(row.id ?? ""),
    name: row.name ?? "",
    emoji: row.emoji ?? null,
    color: row.color ?? null,
    isLeader: !!row.isLeader,
    sortOrder: row.sortOrder ?? null,
  })).filter((e) => e.id);
}

export function useAgentCatalog() {
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: fetchCatalog,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    placeholderData: () => getOfficialAgentEntries(),
  });

  // Sync into module cache whenever data changes.
  useEffect(() => {
    if (query.data) {
      setAgentCatalog(query.data);
    }
  }, [query.data]);

  // Realtime: refetch on any agent_profiles change.
  useEffect(() => {
    const cancelar =
      assinarTabela("agent_profiles", () => {
        queryClient.invalidateQueries({ queryKey: QUERY_KEY });
      });
    return cancelar;
  }, [queryClient]);

  return query;
}
