import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ArenaAgentRole {
  id: string;
  arena_id: string;
  agent_id: string;
  role_name: string | null;
  role_description: string | null;
  is_primary: boolean;
}

export function useArenaAgents(arenaId: string | undefined) {
  const [agents, setAgents] = useState<ArenaAgentRole[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!arenaId) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("arena_agents")
      .select("*")
      .eq("arena_id", arenaId);
    if (error) {
      console.error("[use-arena-agents] load:", error.message);
      setAgents([]);
      setLoading(false);
      return;
    }
    setAgents((data ?? []) as ArenaAgentRole[]);
    setLoading(false);
  }, [arenaId]);

  useEffect(() => { load(); }, [load]);

  const saveAgents = useCallback(
    async (
      arenaIdParam: string,
      agentRoles: Omit<ArenaAgentRole, "id">[],
    ): Promise<{ error: Error | null }> => {
      // Delete existing
      const { error: delError } = await supabase
        .from("arena_agents")
        .delete()
        .eq("arena_id", arenaIdParam);
      if (delError) {
        console.error("[use-arena-agents] delete:", delError.message);
        return { error: new Error(delError.message) };
      }

      // Insert new
      if (agentRoles.length > 0) {
        const { data, error: insError } = await supabase
          .from("arena_agents")
          .insert(agentRoles)
          .select();
        if (insError) {
          console.error("[use-arena-agents] insert:", insError.message);
          return { error: new Error(insError.message) };
        }
        setAgents((data ?? []) as ArenaAgentRole[]);
      } else {
        setAgents([]);
      }
      return { error: null };
    },
    [],
  );

  return { agents, loading, saveAgents, refresh: load };
}
