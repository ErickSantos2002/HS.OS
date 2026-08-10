import { api } from "@/lib/api";
import { assinarTabela } from "@/lib/realtime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
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
      const params = new URLSearchParams({ agent_id: agentId, limite: "50" });
      if (category) params.set("category", category);
      return await api<AgentResult[]>(`/agents/resultados?${params}`);
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
      await api("/agents/resultados", { method: "POST", body: { agent_id: agentId, ...r } });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-results", agentId] }),
  });

  const deleteResult = useMutation({
    mutationFn: async (id: string) => {
      await api(`/agents/resultados/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["agent-results", agentId] }),
  });

  return { results, isLoading, addResult, deleteResult };
}
