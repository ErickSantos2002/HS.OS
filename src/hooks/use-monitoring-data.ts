import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

interface MonitoringState {
  agents: any[] | null;
  health: any | null;
  cron: any[] | null;
  usage: any | null;
  gatewayStatus: any | null;
  processes: any | null;
  events: any | null;
  isLoading: boolean;
  error: string | null;
  lastUpdated: Date | null;
  lastCollectedAt: Date | null;
  gatewayOnline: boolean;
  healthLatencyMs: number | null;
}

export async function postProxyAction(action: string): Promise<any> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
  const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

  const url = `${supabaseUrl}/functions/v1/monitoring-proxy`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });

  return res.json();
}

export function useMonitoringData(pollingInterval = 60_000) {
  const [state, setState] = useState<MonitoringState>({
    agents: null,
    health: null,
    cron: null,
    usage: null,
    gatewayStatus: null,
    processes: null,
    events: null,
    isLoading: true,
    error: null,
    lastUpdated: null,
    lastCollectedAt: null,
    gatewayOnline: true,
    healthLatencyMs: null,
  });

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refetch = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));

    try {
      const today = new Date().toISOString().split("T")[0];

      const [agentsRes, healthRes, cronRes, usageRes] = await Promise.all([
        supabase.from("agent_stats").select("*").order("collected_at", { ascending: false }).limit(200),
        supabase.from("gateway_health").select("*").order("collected_at", { ascending: false }).limit(1),
        supabase.from("cron_jobs").select("*").order("name", { ascending: true }),
        supabase.from("usage_daily").select("*").order("date", { ascending: false }).limit(1),
      ]);

      const agents = agentsRes.data || [];
      const healthRow = healthRes.data?.[0] || null;
      const cron = cronRes.data || [];
      const usageRow = usageRes.data?.[0] || null;

      const gatewayOnline = healthRow?.status === "online";

      // Find most recent collected_at across all data
      const collectedDates = [
        healthRow?.collected_at,
        ...agents.map((a: any) => a.collected_at),
        ...cron.map((c: any) => c.collected_at),
        usageRow?.collected_at,
      ].filter(Boolean).map((d: string) => new Date(d).getTime());
      const latestCollected = collectedDates.length > 0 ? new Date(Math.max(...collectedDates)) : null;

      setState({
        agents,
        health: healthRow,
        cron,
        usage: usageRow,
        gatewayStatus: healthRow,
        processes: null,
        events: null,
        isLoading: false,
        error: null,
        lastUpdated: new Date(),
        lastCollectedAt: latestCollected,
        gatewayOnline,
        healthLatencyMs: healthRow?.latency_ms ?? null,
      });
    } catch (err: any) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err.message || "Erro desconhecido",
        gatewayOnline: false,
        lastUpdated: new Date(),
      }));
    }
  }, []);

  useEffect(() => {
    refetch();
    intervalRef.current = setInterval(refetch, pollingInterval);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refetch, pollingInterval]);

  return { ...state, refetch };
}
