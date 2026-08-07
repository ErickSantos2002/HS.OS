import { api } from "@/lib/api";
import { assinarTabela } from "@/lib/realtime";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useEffect } from "react";

export interface AgentCron {
  id: string;
  agent_id: string;
  name: string;
  expression: string;
  description: string | null;
  enabled: boolean;
  last_run: string | null;
  next_run: string | null;
  created_at: string;
}

export function useAgentCrons(agentId: string) {
  const qc = useQueryClient();
  const key = ["agent-crons", agentId];

  const { data: crons = [], isLoading } = useQuery({
    queryKey: key,
    queryFn: async () => {
      return await api<AgentCron[]>(`/agents/${encodeURIComponent(agentId)}/crons`);
    },
    enabled: !!agentId,
  });

  // Realtime
  useEffect(() => {
    if (!agentId) return;
    const cancelar =
      assinarTabela("agent_crons", (m) => {
        // O filtro por coluna do Supabase virou este `if`: o evento carrega o
        // `agent_id` justamente para a tela não recarregar por causa de outro.
        if (m.agent_id && m.agent_id !== agentId) return;
        qc.invalidateQueries({ queryKey: key });
      });
    return cancelar;
  }, [agentId]);

  const addCron = useMutation({
    mutationFn: async (cron: { name: string; expression: string; description?: string }) => {
      await api(`/agents/${encodeURIComponent(agentId)}/crons`, { method: "POST", body: cron });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const toggleCron = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      await api(`/agents/${encodeURIComponent(agentId)}/crons/${id}`, {
        method: "PATCH",
        body: { enabled },
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteCron = useMutation({
    mutationFn: async (id: string) => {
      await api(`/agents/${encodeURIComponent(agentId)}/crons/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { crons, isLoading, addCron, toggleCron, deleteCron };
}
