import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

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
    // Sem sessão a função responde 401 e o erro sobe como "erro de runtime" no
    // preview do Lovable — barulho por uma chamada que nunca teve chance de
    // dar certo. Acontece no intervalo entre o app montar e a sessão existir,
    // e a cada 60s enquanto a sessão estiver expirada.
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      setLoading(false);
      return;
    }
    const { data: result, error } = await supabase.functions.invoke("get-gateway-status");
    if (!error && result?.success) {
      setData(result.data as GatewayStatusData);
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
