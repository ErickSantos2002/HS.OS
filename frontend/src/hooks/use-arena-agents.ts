import { api } from "@/lib/api";
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
    const { data, error } = await api<ArenaAgentRole[]>(`/arenas/${arenaId}/agentes`)
      .then((d) => ({ data: d, error: null as Error | null }),
            (e: Error) => ({ data: null, error: e }));
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
      // Apagar e reinserir numa transação só, do lado do servidor. Eram dois
      // passos separados: falhar no segundo deixava a arena sem elenco nenhum,
      // e o erro dizia "erro ao salvar" sem contar que o que existia já tinha
      // ido embora.
      try {
        await api(`/arenas/${arenaIdParam}/agentes`, { method: "PUT", body: agentRoles });
      } catch (e) {
        console.error("[use-arena-agents] elenco:", (e as Error).message);
        return { error: e as Error };
      }

      if (agentRoles.length > 0) {
        const data = await api<ArenaAgentRole[]>(
          `/arenas/${arenaIdParam}/agentes`,
        ).catch(() => []);
        setAgents(data ?? []);
      } else {
        setAgents([]);
      }
      return { error: null };
    },
    [],
  );

  return { agents, loading, saveAgents, refresh: load };
}
