import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";

export interface AgentProductivity {
  agentId: string;
  messages: number;
  results: number;
  economyEstimate: number;
}

export interface FleetProductivity {
  totalMessages: number;
  totalResults: number;
  totalEconomy: number;
  byAgent: AgentProductivity[];
  maxMessages: number;
}

// Cost assumptions (per interaction)
const HUMAN_COST_PER_INTERACTION = 2.5;
const AI_COST_PER_1K_TOKENS = 0.002;

export function useFleetProductivity(
  agents: { id: string; tokensUsed: number }[]
) {
  const agentIds = agents.map((a) => a.id);

  const { data, isLoading } = useQuery({
    queryKey: ["fleet-productivity", agentIds.join(",")],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      // Use server-side aggregation RPC instead of fetching all rows
      let rows: any[] | null = null;
      let error: any = null;
      try {
        rows = await api<any[]>("/agents/frota/produtividade?dias=30");
      } catch (e) {
        error = e;
      }

      if (error) {
        console.error("[fleet-productivity] RPC error:", error);
        return { totalMessages: 0, totalResults: 0, totalEconomy: 0, byAgent: [], maxMessages: 1 } as FleetProductivity;
      }

      const serverMap = new Map<string, { convCount: number; resultCount: number }>();
      if (rows) {
        for (const r of rows as any[]) {
          serverMap.set(r.agent_id, {
            convCount: Number(r.conv_count) || 0,
            resultCount: Number(r.result_count) || 0,
          });
        }
      }

      const byAgent: AgentProductivity[] = agents.map((a) => {
        const srv = serverMap.get(a.id);
        const msgs = srv?.convCount ?? 0;
        const results = srv?.resultCount ?? 0;
        const humanCost = msgs * HUMAN_COST_PER_INTERACTION;
        const aiCost = (a.tokensUsed / 1000) * AI_COST_PER_1K_TOKENS;
        return {
          agentId: a.id,
          messages: msgs,
          results,
          economyEstimate: Math.max(0, humanCost - aiCost),
        };
      });

      const totalMessages = byAgent.reduce((s, a) => s + a.messages, 0);
      const totalResults = byAgent.reduce((s, a) => s + a.results, 0);
      const totalEconomy = byAgent.reduce((s, a) => s + a.economyEstimate, 0);
      const maxMessages = Math.max(1, ...byAgent.map((a) => a.messages));

      return { totalMessages, totalResults, totalEconomy, byAgent, maxMessages } as FleetProductivity;
    },
    enabled: agents.length > 0,
    staleTime: 120_000, // 2 min — this data changes slowly
  });

  return { productivity: data ?? null, isLoading };
}
