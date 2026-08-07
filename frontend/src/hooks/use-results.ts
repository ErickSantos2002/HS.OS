import { api } from "@/lib/api";
import { assinarTabela } from "@/lib/realtime";
import { useMemo, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAgents } from "@/hooks/use-agents";
import { getAgentDisplayNameById, isOfficialAgentId } from "@/lib/active-agents";

export type ResultsPeriod = "7d" | "30d" | "90d" | "all";

export const CATEGORY_MARKET_VALUE: Record<string, { humanHours: number; hourlyRate: number }> = {
  automacao: { humanHours: 4, hourlyRate: 150 },
  integracao: { humanHours: 6, hourlyRate: 180 },
  integration: { humanHours: 6, hourlyRate: 180 },
  conteudo: { humanHours: 2, hourlyRate: 120 },
  setup: { humanHours: 8, hourlyRate: 150 },
  research: { humanHours: 3, hourlyRate: 130 },
  strategy: { humanHours: 5, hourlyRate: 200 },
  growth: { humanHours: 4, hourlyRate: 180 },
  task: { humanHours: 1, hourlyRate: 100 },
};

export function getResultValue(result: { value: number | null; category: string | null }): number {
  if (result.value && result.value > 0) return result.value;
  const cat = result.category?.toLowerCase().trim() ?? "task";
  const ref = CATEGORY_MARKET_VALUE[cat] ?? CATEGORY_MARKET_VALUE["task"];
  return ref.humanHours * ref.hourlyRate;
}

export interface ResultRecord {
  id: string;
  agent_id: string;
  user_id: string | null;
  title: string;
  description: string | null;
  category: string | null;
  value: number | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ResultsFilters {
  period: ResultsPeriod;
  category: string;
  agentId: string;
  userId: string;
}

interface ProfileLite {
  id: string;
  full_name: string | null;
  email: string;
}

interface ResultsOverview {
  totalCount: number;
  totalEconomy: number;
}

const RESULTS_BATCH_SIZE = 1000;

function getPeriodStart(period: ResultsPeriod) {
  if (period === "all") return null;
  const now = new Date();
  const days = period === "7d" ? 7 : period === "30d" ? 30 : 90;
  now.setDate(now.getDate() - days);
  return now;
}

function getMonthStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

function matchesNonPeriodFilters(result: ResultRecord, filters: ResultsFilters) {
  if (filters.category !== "all" && (result.category ?? "sem categoria") !== filters.category) return false;
  if (filters.agentId !== "all" && result.agent_id !== filters.agentId) return false;
  if (filters.userId !== "all" && (result.user_id ?? "") !== filters.userId) return false;
  return true;
}

async function fetchAllAgentResults<T>({
  select,
  since,
}: {
  select: string;
  since?: Date | null;
}) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from("agent_results")
      .select(select)
      .order("created_at", { ascending: false })
      .range(from, from + RESULTS_BATCH_SIZE - 1);

    if (since) {
      query = query.gte("created_at", since.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;

    const batch = (data ?? []) as T[];
    rows.push(...batch);

    if (batch.length < RESULTS_BATCH_SIZE) break;
    from += RESULTS_BATCH_SIZE;
  }

  return rows;
}

export function useResultsOverview(period: Exclude<ResultsPeriod, "all"> = "30d") {
  const { data, isLoading } = useQuery({
    queryKey: ["results-overview", period],
    queryFn: async () => {
      const since = getPeriodStart(period);
      let query = supabase
        .from("agent_results")
        .select("id", { count: "exact", head: true });

      if (since) {
        query = query.gte("created_at", since.toISOString());
      }

      const [{ count, error }, economyRows] = await Promise.all([
        query,
        fetchAllAgentResults<Pick<ResultRecord, "value" | "category">>({ select: "value, category", since }),
      ]);

      if (error) throw error;

      return {
        totalCount: count ?? 0,
        totalEconomy: economyRows.reduce((sum, r) => sum + getResultValue({ value: r.value ?? null, category: (r as any).category ?? null }), 0),
      } satisfies ResultsOverview;
    },
    staleTime: 60_000,
  });

  return { overview: data ?? { totalCount: 0, totalEconomy: 0 }, isLoading };
}

export function useResults(filters: ResultsFilters) {
  const { agents } = useAgents();
  const queryClient = useQueryClient();

  useEffect(() => {
    const cancelar =
      assinarTabela("agent_results", () => {
        queryClient.invalidateQueries({ queryKey: ["results-page-data"] });
        queryClient.invalidateQueries({ queryKey: ["results-overview"] });
      });
    return cancelar;
  }, [queryClient]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["results-page-data"],
    staleTime: 15_000,
    refetchInterval: 30_000,
    queryFn: async () => {
      const results = await fetchAllAgentResults<ResultRecord>({
        select: "id, agent_id, user_id, title, description, category, value, created_at, metadata",
      });
      const officialResults = results.filter((result) => isOfficialAgentId(result.agent_id));
      const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
      const userIds = [...new Set(officialResults.map((result) => result.user_id).filter((id): id is string => !!id && UUID_RE.test(id)))];

      let profiles: ProfileLite[] = [];
      if (userIds.length > 0) {
        const profileRows = await api<ProfileLite[]>("/profiles");
        profiles = profileRows ?? [];
      }

      return { results: officialResults, profiles };
    },
  });

  const agentNameMap = useMemo(
    () => {
      const map = new Map(agents.map((agent) => [agent.id, agent.name]));

      for (const result of data?.results ?? []) {
        if (!map.has(result.agent_id)) {
          map.set(result.agent_id, getAgentDisplayNameById(result.agent_id));
        }
      }

      return map;
    },
    [agents, data?.results],
  );

  const profileMap = useMemo(
    () => new Map((data?.profiles ?? []).map((profile) => [profile.id, profile])),
    [data?.profiles],
  );

  const filteredResults = useMemo(() => {
    const since = getPeriodStart(filters.period);

    return (data?.results ?? []).filter((result) => {
      if (!matchesNonPeriodFilters(result, filters)) return false;
      if (!since) return true;
      return new Date(result.created_at) >= since;
    });
  }, [data?.results, filters]);

  const totalEconomy = useMemo(
    () => filteredResults.reduce((sum, result) => sum + getResultValue(result), 0),
    [filteredResults],
  );

  const monthlyResults = useMemo(() => {
    const monthStart = getMonthStart();
    return (data?.results ?? []).filter((result) => {
      if (!matchesNonPeriodFilters(result, filters)) return false;
      return new Date(result.created_at) >= monthStart;
    });
  }, [data?.results, filters]);

  const categoryOptions = useMemo(
    () => [...new Set((data?.results ?? []).map((result) => result.category?.trim()).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR")),
    [data?.results],
  );

  const agentOptions = useMemo(() => {
    return agents
      .filter((agent) => isOfficialAgentId(agent.id))
      .map((agent) => ({ id: agent.id, label: agentNameMap.get(agent.id) ?? agent.name }))
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [agentNameMap, agents]);

  const userOptions = useMemo(() => {
    const ids = [...new Set((data?.results ?? []).map((result) => result.user_id).filter(Boolean))] as string[];
    return ids
      .map((id) => {
        const profile = profileMap.get(id);
        return {
          id,
          label: profile?.full_name?.trim() || profile?.email || id,
        };
      })
      .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));
  }, [data?.results, profileMap]);

  return {
    results: filteredResults,
    totalCount: filteredResults.length,
    totalEconomy,
    monthlyCount: monthlyResults.length,
    categoryOptions,
    agentOptions,
    userOptions,
    agentNameMap,
    profileMap,
    isLoading,
    error,
  };
}