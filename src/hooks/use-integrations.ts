import { useQuery } from "@tanstack/react-query";
import { getGatewayConfig } from "@/lib/gateway";

export interface AgentIntegrations {
  agentId: string;
  integrations: string[];
  connected: boolean;
}

// Use gateway config URL instead of hardcoded domain

/** Fetch integrations for a single agent */
async function fetchAgentIntegrations(agentId: string): Promise<AgentIntegrations> {
  const config = getGatewayConfig();
  try {
    const res = await fetch(`${config.url}/api/agents/${encodeURIComponent(agentId)}/integrations`, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!res.ok) return { agentId, integrations: [], connected: false };
    const data = await res.json();
    // Normalize: API may return { agent, integrations } or { agentId, integrations, connected }
    const integrations = Array.isArray(data?.integrations) ? data.integrations : Array.isArray(data) ? data : [];
    return { agentId, integrations, connected: integrations.length > 0 };
  } catch {
    return { agentId, integrations: [], connected: false };
  }
}

/** Fetch all agents' integrations at once */
async function fetchAllIntegrations(): Promise<Record<string, AgentIntegrations>> {
  const config = getGatewayConfig();
  const res = await fetch(`${config.url}/api/agents/integrations`, {
    headers: { Authorization: `Bearer ${config.token}` },
  });
  if (!res.ok) return {};
  return res.json();
}

/** Hook: single agent integrations */
export function useAgentIntegrations(agentId: string) {
  const { data, isLoading } = useQuery({
    queryKey: ["agent-integrations", agentId],
    queryFn: () => fetchAgentIntegrations(agentId),
    enabled: !!agentId,
    staleTime: 60_000,
    retry: 1,
  });

  return {
    integrations: data?.integrations ?? [],
    connected: data?.connected ?? false,
    loading: isLoading,
  };
}

/** Hook: all agents integrations (for fleet views) */
export function useAllIntegrations() {
  const { data, isLoading } = useQuery({
    queryKey: ["all-integrations"],
    queryFn: fetchAllIntegrations,
    staleTime: 60_000,
    retry: 1,
  });

  return { integrationsMap: data ?? {}, loading: isLoading };
}
