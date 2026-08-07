import { useState, useEffect, useCallback, useRef } from "react";
import { api } from "@/lib/api";

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
  try {
    return await api<any>(`/gateway/manutencao/${encodeURIComponent(action)}`, { method: "POST" });
  } catch (e: any) {
    return { success: false, error: e?.message ?? "Falha na manutenção do gateway." };
  }
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

      const dados = await api<{
        agents: any[];
        health: any | null;
        cron: any[];
        usage: any | null;
      }>("/gateway/monitoramento");

      const agents = dados.agents || [];
      const healthRow = dados.health;
      const cron = dados.cron || [];
      const usageRow = dados.usage;

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
