import { assinarTabela } from "@/lib/realtime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface AgentResult {
  id: string;
  agent_id: string;
  title: string;
  description: string | null;
  category: string | null;
  value: number | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export function useAgentResults(agentId: string, category?: string) {
  const qc = useQueryClient();
  const key = ["agent-results", agentId, category];

  const { data: results = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      let q = supabase
        .from("agent_results")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (category) q = q.eq("category", category);
      const { data, error } = await q;
      if (error) throw error;
      return data as AgentResult[];
    },
    enabled: !!agentId,
  });

  useEffect(() => {
    if (!agentId) return;
    const cancelar =
      assinarTabela("agent_results", (m) => {
        if (m.agent_id && m.agent_id !== agentId) return;
        qc.invalidateQueries({ queryKey: ["agent-results", agentId] });
      });
    return cancelar;
  }, [agentId]);

  const addResult = useMutation({
    mutationFn: async (r: { title: string; description?: string; category?: string; value?: number; user_id?: string | null }) => {
      const payload = { agent_id: agentId, ...r };
      const { error } = await supabase.from("agent_results").insert(payload as never);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-results", agentId] }),
  });

  const deleteResult = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_results").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-results", agentId] }),
  });

  return { results, isLoading, addResult, deleteResult };
}
