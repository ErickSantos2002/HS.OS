import { useState, useEffect, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";
import { getGatewayConfig, gatewayNaoPortado } from "@/lib/gateway";

/** Resposta de GET /agents — o backend já entrega no formato da tela. */
interface RespostaAgentes {
  agents: Array<{
    id: string;
    name: string;
    status: string;
    model: string;
    channels: string[];
    systemPrompt?: string;
    tokensUsed?: number;
    sessions?: number;
    lastActive?: string | null;
    lastChannel?: string;
    emoji?: string | null;
    avatarUrl?: string | null;
    department?: string | null;
  }>;
  defaultId: string | null;
  gatewayOnline: boolean;
  gatewayErro: string | null;
}
import { useAuthContext } from "@/contexts/auth-context";
import { getAgentDisplayNameById, getModelForAgent, getOfficialAgentIds, isManagedAgentRecord, isOfficialAgentId, normalizeAgentId } from "@/lib/active-agents";
import { statusFromActivity } from "@/lib/agent-status";

export type AgentStatus = "active" | "recent" | "inactive";

export interface ChannelConfig {
  platform: string;
  active: boolean;
  configured: boolean;
  allowFrom: string[];
}

export interface AgentTool {
  name: string;
  description?: string;
}

export interface GatewayAgent {
  id: string;
  name: string;
  status: AgentStatus;
  model: string;
  channels: string[];
  channelConfigs: ChannelConfig[];
  tools: AgentTool[];
  systemPrompt: string;
  tokensUsed: number;
  sessions: number;
  lastActive: string;
  lastChannel: string;
  /** Timestamp (ms) of last SSE status update for stale detection */
  lastStatusUpdate?: number;
}

function parseTools(raw: any): AgentTool[] {
  const t = raw?.tools ?? raw?.skills ?? [];
  if (!Array.isArray(t)) return [];
  return t
    .map((item: any) => {
      if (typeof item === "string") return { name: item };
      if (item && typeof item === "object") {
        const name = item.name ?? item.id ?? item.tool ?? "";
        if (!name) return null;
        return { name: String(name), description: item.description ?? item.desc ?? undefined };
      }
      return null;
    })
    .filter(Boolean) as AgentTool[];
}

/* ── Parsing helpers ─────────────────────────────────── */

function stripPrefix(id: string) {
  return normalizeAgentId(id.includes(":") ? id.split(":").pop()! : id);
}

function parseChannelConfigs(raw: any): ChannelConfig[] {
  const configs: ChannelConfig[] = [];
  const channelsData = raw.channelConfigs ?? raw.channel_configs ?? raw.channels_config ?? {};

  if (typeof channelsData === "object" && !Array.isArray(channelsData)) {
    for (const [platform, cfg] of Object.entries(channelsData)) {
      const c = cfg as any;
      configs.push({
        platform: String(platform),
        active: c.active ?? c.enabled ?? true,
        configured: !!(c.botToken || c.token || c.webhook || c.configured),
        allowFrom: Array.isArray(c.allowFrom ?? c.allow_from) ? (c.allowFrom ?? c.allow_from) : [],
      });
    }
  }

  if (configs.length === 0) {
    const channels = (raw.channels ?? []).map((ch: any) =>
      typeof ch === "string" ? ch : ch.channel ?? String(ch)
    );
    const lastChannel = raw.lastChannel ?? raw.last_channel ?? "";
    const allChannels = new Set<string>([...channels, ...(lastChannel ? [lastChannel] : [])]);
    for (const name of allChannels) {
      configs.push({ platform: String(name), active: String(name) === lastChannel, configured: true, allowFrom: [] });
    }
  }

  return configs;
}

function normalizeStatus(raw: any): AgentStatus {
  const s = raw?.status ?? "";
  if (s === "active" || s === "online" || s === "processing") return "active";
  if (s === "recent") return "recent";
  if (s === "inactive" || s === "offline") return "inactive";
  const lastChannel = raw?.lastChannel ?? raw?.last_channel ?? "";
  return lastChannel ? "active" : "inactive";
}

function parseAgentFromApi(raw: any): GatewayAgent {
  const rawId = raw.id ?? "";
  const id = stripPrefix(rawId);
  const apiName = raw.name ?? raw.displayName;
  const name = getAgentDisplayNameById(id, apiName);
  const lastChannel = raw.lastChannel ?? raw.last_channel ?? "";
  const channelConfigs = parseChannelConfigs(raw);
  return {
    id,
    name,
    status: normalizeStatus(raw),
    model: raw.model ?? getModelForAgent(id || rawId),
    channels: (raw.channels ?? (lastChannel ? [lastChannel] : [])).map((ch: any) =>
      typeof ch === "string" ? ch : ch.channel ?? ch.platform ?? String(ch)
    ),
    channelConfigs,
    tools: parseTools(raw),
    systemPrompt: raw.system_prompt ?? raw.systemPrompt ?? "",
    tokensUsed: raw.tokens_used ?? raw.tokensUsed ?? 0,
    sessions: raw.sessions ?? 0,
    lastActive: raw.lastActive ?? raw.last_active ?? raw.created ? new Date((raw.created ?? 0) * 1000).toISOString() : new Date().toISOString(),
    lastChannel,
  };
}

/* ── Stub for agents in Supabase but not in gateway ──── */

function createStubAgent(agentId: string): GatewayAgent {
  return {
    id: agentId,
    name: getAgentDisplayNameById(agentId),
    status: "inactive",
    model: getModelForAgent(agentId),
    channels: [],
    channelConfigs: [],
    tools: [],
    systemPrompt: "",
    tokensUsed: 0,
    sessions: 0,
    lastActive: new Date().toISOString(),
    lastChannel: "",
  };
}

/* ── Placeholder stubs for instant render ────────────── */

function getPlaceholderAgents(): GatewayAgent[] {
  return getOfficialAgentIds().map(createStubAgent).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

const GATEWAY_TIMEOUT_MS = 4_000;

/* ── Fetch: Gateway + RPC in parallel with timeout ───── */

async function fetchAgents(_userId?: string, _isAdmin?: boolean): Promise<GatewayAgent[]> {
  // Uma chamada só. A junção de `agent_profiles` com o `agents.list` do gateway,
  // mais o controle de acesso por usuário, acontecem no servidor — antes eram
  // quatro consultas paralelas daqui, uma delas batendo no gateway com o
  // admin_token no navegador. Ver app/routers/agents.py.
  const d = await api<RespostaAgentes>("/agents");

  if (!d.gatewayOnline) {
    // O banco ainda sabe quem existe; o que não dá para afirmar é quem está de
    // pé. Melhor mostrar a lista com o aviso do que fingir que todos morreram.
    console.warn("[agents] gateway indisponível:", d.gatewayErro);
  }

  return d.agents.map((a) => ({
    id: a.id,
    name: a.name,
    status: a.status as AgentStatus,
    model: a.model || getModelForAgent(a.id),
    channels: a.channels ?? [],
    channelConfigs: [],
    tools: [],
    systemPrompt: a.systemPrompt ?? "",
    tokensUsed: a.tokensUsed ?? 0,
    sessions: a.sessions ?? 0,
    lastActive: a.lastActive ?? new Date().toISOString(),
    lastChannel: a.lastChannel ?? "",
  }));
}



/* ── Singleton SSE for live status updates ───────────── */

let sseInstance: EventSource | null = null;
let sseRefCount = 0;
let sseRetryTimeout: ReturnType<typeof setTimeout> | null = null;
let sseConnected = false;
let sseRetryAttempts = 0;
const sseListeners = new Set<(connected: boolean) => void>();

function notifySSEListeners() {
  sseListeners.forEach((fn) => fn(sseConnected));
}

function startSSE(queryClient: any) {
  sseRefCount++;
  if (sseInstance) return;

  function connect() {
    const config = getGatewayConfig();
    const url = `${config.url}/api/stream?token=${encodeURIComponent(gatewayNaoPortado("Agentes do gateway"))}`;
    const es = new EventSource(url);
    sseInstance = es;

    es.onopen = () => {
      sseConnected = true;
      sseRetryAttempts = 0;
      notifySSEListeners();
    };

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const list = Array.isArray(data) ? data : (data.agents ?? data.data ?? []);
        if (list.length > 0) {
          queryClient.setQueriesData({ queryKey: ["gateway-agents"] }, (prev: GatewayAgent[] | undefined) => {
            const parsedAgents = list
              .filter((item: any) => isManagedAgentRecord(item))
              .map((item: any) => parseAgentFromApi(item))
              .filter((agent: GatewayAgent) => isOfficialAgentId(agent.id));

            const officialIds = getOfficialAgentIds();
            const prevMap = new Map((prev ?? []).map((agent) => [agent.id, agent]));

            for (const agentId of officialIds) {
              if (!prevMap.has(agentId)) {
                prevMap.set(agentId, createStubAgent(agentId));
              }
            }

            for (const agent of parsedAgents) {
              const current = prevMap.get(agent.id);
              prevMap.set(agent.id, {
                ...current,
                ...agent,
                lastStatusUpdate: Date.now(),
              });
            }

            return officialIds.map((agentId) => prevMap.get(agentId) ?? createStubAgent(agentId));
          });
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      sseConnected = false;
      notifySSEListeners();
      es.close();
      sseInstance = null;
      sseRetryAttempts += 1;
      if (sseRetryTimeout) clearTimeout(sseRetryTimeout);
      const retryDelay = sseRetryAttempts >= 3 ? 60_000 : 10_000;
      sseRetryTimeout = setTimeout(connect, retryDelay);
    };
  }

  connect();
}

function stopSSE() {
  sseRefCount--;
  if (sseRefCount <= 0) {
    sseRefCount = 0;
    if (sseRetryTimeout) clearTimeout(sseRetryTimeout);
    sseRetryTimeout = null;
    sseRetryAttempts = 0;
    if (sseInstance) {
      sseInstance.close();
      sseInstance = null;
    }
    sseConnected = false;
    notifySSEListeners();
  }
}

/* ── Hook ────────────────────────────────────────────── */

export function useAgents() {
  const queryClient = useQueryClient();
  const { user, role } = useAuthContext();
  const currentUserId = user?.id;
  const isAdmin = role === "super_admin";

  const { data: agents = [], isLoading: loading, error: queryError, refetch } = useQuery({
    queryKey: ["gateway-agents", currentUserId, isAdmin],
    queryFn: () => fetchAgents(currentUserId, isAdmin),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: 2,
    refetchOnWindowFocus: true,
    enabled: !!currentUserId,
    placeholderData: getPlaceholderAgents,
  });

  const error = queryError ? (queryError as Error).message : null;

  // Track SSE connected state
  const [connected, setConnected] = useSSEConnected();

  // Polling keeps agent status fresh; direct browser SSE is disabled because the
  // gateway stream currently rejects cross-origin EventSource requests and can loop.
  useEffect(() => {
    stopSSE();
  }, []);

  // Realtime subscription on team_agents — refetch when rows change
  useEffect(() => {
    const channel = supabase
      .channel("team_agents_changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "team_agents" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["gateway-agents"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "usage_events" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["gateway-agents"] });
          queryClient.invalidateQueries({ queryKey: ["agent-token-stats"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_profiles" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["gateway-agents"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);

  const refetchAgents = useCallback(async () => {
    await refetch();
  }, [refetch]);

  return { agents, loading: loading && agents.length === 0, error, connected, refetch: refetchAgents };
}

/* ── SSE connected state hook ────────────────────────── */

function useSSEConnected(): [boolean, (v: boolean) => void] {
  const [connected, setConnected] = useState(sseConnected);

  useEffect(() => {
    const listener = (v: boolean) => setConnected(v);
    sseListeners.add(listener);
    return () => { sseListeners.delete(listener); };
  }, []);

  return [connected, setConnected];
}
