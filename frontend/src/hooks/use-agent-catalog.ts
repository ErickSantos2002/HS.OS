/**
 * Loads the official agents catalog from `agent_profiles` and syncs it
 * into the module-level cache used by sync accessors in `@/lib/agent-catalog`.
 *
 * Mount once inside AuthProvider (see AppLayout) — subsequent renders reuse
 * the React Query cache; realtime changes on `agent_profiles` invalidate.
 */

import { assinarTabela } from "@/lib/realtime";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  AgentCatalogEntry,
  getOfficialAgentEntries,
  setAgentCatalog,
} from "@/lib/agent-catalog";

const QUERY_KEY = ["agent-catalog"] as const;

async function fetchCatalog(): Promise<AgentCatalogEntry[]> {
  const { data, error } = await supabase
    .from("agent_profiles")
    .select("agent_id, name, emoji, color, is_leader, sort_order")
    .eq("is_official", true);

  if (error) throw error;

  return (data ?? []).map((row: any) => ({
    id: String(row.agent_id ?? ""),
    name: row.name ?? "",
    emoji: row.emoji ?? null,
    color: row.color ?? null,
    isLeader: !!row.is_leader,
    sortOrder: row.sort_order ?? null,
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
