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
      const { data, error } = await supabase
        .from("agent_crons")
        .select("*")
        .eq("agent_id", agentId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as AgentCron[];
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
      const { error } = await supabase.from("agent_crons").insert({ agent_id: agentId, ...cron });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const toggleCron = useMutation({
    mutationFn: async ({ id, enabled }: { id: string; enabled: boolean }) => {
      const { error } = await supabase.from("agent_crons").update({ enabled }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteCron = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("agent_crons").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return { crons, isLoading, addCron, toggleCron, deleteCron };
}
