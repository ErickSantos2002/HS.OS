import { useEffect, useState, useCallback } from "react";
import { api, lerToken } from "@/lib/api";

/** Resposta de GET /gateway/status. */
interface StatusApi {
  conectado: boolean;
  versao: string | null;
  protocolo: number | null;
  scopes: string[];
  erro: string | null;
}

export interface GatewayStatusData {
  config: {
    id: string;
    gateway_url: string;
    has_token: boolean;
    updated_at: string;
  } | null;
  connection_status: "online" | "slow" | "offline" | "unknown";
  minutes_since_heartbeat: number | null;
  latest_metrics: Record<string, unknown> | null;
  recent_history: Array<Record<string, unknown>>;
}

export function useGatewayStatus() {
  const [data, setData] = useState<GatewayStatusData | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    // Sem token guardado a chamada responderia 401 sem ter chance de dar certo —
    // acontece entre o app montar e a sessão existir, e a cada 60s enquanto ela
    // estiver expirada. Melhor nem chamar.
    if (!lerToken()) {
      setLoading(false);
      return;
    }
    try {
      const s = await api<StatusApi>("/gateway/status");
      // `latest_metrics` e `recent_history` vinham do heartbeat que a edge
      // function agregava de `gateway_health`. Essa coleta é do Lote 6
      // (monitoring); até lá o painel mostra só conectado/desconectado.
      setData({
        config: s.erro === "Gateway não configurado."
          ? null
          : { id: "", gateway_url: "", has_token: true, updated_at: "" },
        connection_status: s.conectado ? "online" : "offline",
        minutes_since_heartbeat: null,
        latest_metrics: s.versao ? { version: s.versao, protocol: s.protocolo } : null,
        recent_history: [],
      });
    } catch {
      /* backend fora do ar — mantém o último estado conhecido */
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    refetch();
    const interval = setInterval(refetch, 60_000);
    return () => clearInterval(interval);
  }, [refetch]);

  return { data, loading, refetch };
}
