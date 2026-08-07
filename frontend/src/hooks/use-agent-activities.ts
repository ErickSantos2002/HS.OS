import { assinarTabela } from "@/lib/realtime";
import { useEffect, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

export type AgentActivityStep = {
  label: string;
  status: string;
};

export type AgentActivity = {
  id: string;
  agent_id: string;
  activity_type: string;
  title: string;
  status: string;
  steps: AgentActivityStep[];
  result: Json | null;
  user_id: string | null;
  channel: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/**
 * Fetches and subscribes to the agent_activity feed for one agent, optionally
 * scoped to the current user. Returns activities ordered oldest → newest.
 */
export function useAgentActivitiesFeed(
  agentId: string | undefined | null,
  userId: string | null | undefined,
  maxHistory = 40
): AgentActivity[] {
  const [activities, setActivities] = useState<AgentActivity[]>([]);
  const capRef = useRef(maxHistory);
  capRef.current = maxHistory;

  const upsert = useCallback((row: AgentActivity) => {
    setActivities((prev) => {
      const idx = prev.findIndex((a) => a.id === row.id);
      let next: AgentActivity[];
      if (idx >= 0) {
        next = [...prev];
        next[idx] = row;
      } else {
        next = [...prev, row];
      }
      next.sort(
        (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
      );
      if (next.length > capRef.current) next = next.slice(-capRef.current);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!agentId) {
      setActivities([]);
      return;
    }
    let mounted = true;

    const fetchInitial = async () => {
      // Filtra por usuário igual ao matchesUser do realtime (abaixo). Sem isso a
      // carga inicial trazia as atividades de TODOS os usuários daquele agente —
      // um mesmo agente atende várias pessoas, então as tool calls de outra
      // conversa apareciam misturadas na sua. O realtime já filtrava; era só a
      // busca inicial que estava inconsistente.
      let query = supabase
        .from("agent_activity")
        .select("*")
        .eq("agent_id", agentId);
      if (userId) {
        // user_id nulo = atividade de sistema/legado, mantida (igual ao matchesUser)
        query = query.or(`user_id.is.null,user_id.eq.${userId}`);
      }
      const { data, error } = await query
        .order("created_at", { ascending: false })
        .limit(capRef.current);
      if (!mounted || error || !data) return;
      const rows = (data as AgentActivity[]).slice().reverse();
      setActivities(rows);
    };
    void fetchInitial();

    const filter = `agent_id=eq.${agentId}`;
    const matchesUser = (row: AgentActivity) =>
      !userId || !row.user_id || row.user_id === userId;

    // O evento não carrega a linha (ver `docs/PLANO-REALTIME.md`), então em vez
    // de `upsert(row)` a lista é recarregada. Feed de atividade é de baixo
    // volume; trocar precisão de payload por uma busca a mais compensa.
    const cancelar = assinarTabela("agent_activity", (m) => {
      if (m.agent_id && m.agent_id !== agentId) return;
      void fetchInitial();
    });

    return () => {
      mounted = false;
      cancelar();
    };
  }, [agentId, userId, upsert]);

  return activities;
}
