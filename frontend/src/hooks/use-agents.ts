import { useState, useEffect, useCallback } from "react";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getGatewayConfig } from "@/lib/gateway";
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

async function fetchAgents(userId?: string, isAdmin?: boolean): Promise<GatewayAgent[]> {
  const officialAgentIds = getOfficialAgentIds();

  // First, pull custom agents from agent_profiles (status != 'inactive')
  const { data: profileRows } = await supabase
    .from("agent_profiles")
    .select("agent_id, name, emoji, model, channels, status, access_type, allowed_user_ids")
    .neq("status", "inactive");

  // Build deny-set based on access control (admins bypass)
  const denyIds = new Set<string>();
  if (!isAdmin) {
    for (const row of (profileRows ?? []) as any[]) {
      const id = normalizeAgentId(row.agent_id ?? "");
      if (!id) continue;
      const at = row.access_type ?? "all";
      if (at === "all") continue;
      if (at === "admins_only") { denyIds.add(id); continue; }
      if (at === "specific_users") {
        const allowed: string[] = Array.isArray(row.allowed_user_ids) ? row.allowed_user_ids : [];
        if (!userId || !allowed.includes(userId)) denyIds.add(id);
      }
    }
  }

  const officialSet = new Set(officialAgentIds);
  const customAgentIds: string[] = [];
  const customMeta = new Map<string, { name?: string | null; model?: string | null }>();
  for (const row of (profileRows ?? []) as any[]) {
    const id = normalizeAgentId(row.agent_id ?? "");
    if (!id || officialSet.has(id)) continue;
    if (denyIds.has(id)) continue;
    customAgentIds.push(id);
    customMeta.set(id, { name: row.name, model: row.model });
  }

  const allAgentIds = [...officialAgentIds.filter((id) => !denyIds.has(id)), ...customAgentIds];

  // Run gateway fetch, RPC, and token snapshots in parallel
  const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const [gatewayResult, rpcResult, tokensResult] = await Promise.allSettled([
    // 1. Gateway fetch with timeout
    (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS);
      try {
        const config = getGatewayConfig();
        const res = await fetch(`${config.url}/v1/models`, {
          headers: {
            Authorization: `Bearer ${config.token}`,
            "Content-Type": "application/json",
          },
          signal: controller.signal,
        });
        if (!res.ok) return new Map<string, GatewayAgent>();
        const data = await res.json();
        const list = Array.isArray(data) ? data : (data.data ?? data.agents ?? []);
        const map = new Map<string, GatewayAgent>();
        const allowed = new Set(allAgentIds);
        for (const raw of list) {
          if (!isManagedAgentRecord(raw)) continue;
          const agent = parseAgentFromApi(raw);
          if (!agent.id || !allowed.has(agent.id)) continue;
          map.set(agent.id, agent);
        }
        return map;
      } finally {
        clearTimeout(timer);
      }
    })(),
    // 2. Supabase RPC
    (async () => {
      const rpcParams: any = { _agent_ids: allAgentIds };
      if (userId) rpcParams._user_id = userId;
      const { data: activityRows } = await supabase.rpc("get_agents_last_activity", rpcParams);
      const map = new Map<string, string>();
      if (activityRows) {
        for (const row of activityRows as any[]) {
          map.set(row.agent_id, row.last_active);
        }
      }
      return map;
    })(),
    // 3. Consumo MEDIDO por agente nos últimos 30 dias (task #19).
    // Era agent_token_snapshots — tabela alimentada por relato, sem ninguém
    // medindo; o ranking da lista comparava relatos, não fatos. Aqui cada
    // linha é uma chamada de LLM real, então soma (o "sessions" vira a
    // contagem de chamadas, que é o número que de fato existe).
    (async () => {
      const { data } = await supabase
        .from("usage_events")
        .select("agent_id, total_tokens")
        .gte("ts", since30d)
        .limit(20000);
      const map = new Map<string, { tokens: number; sessions: number }>();
      for (const row of (data ?? []) as any[]) {
        const id = normalizeAgentId(row.agent_id);
        const cur = map.get(id) ?? { tokens: 0, sessions: 0 };
        cur.tokens += row.total_tokens ?? 0;
        cur.sessions += 1;
        map.set(id, cur);
      }
      return map;
    })(),
  ]);

  const gatewayMap = gatewayResult.status === "fulfilled" ? gatewayResult.value : new Map<string, GatewayAgent>();
  const activityMap = rpcResult.status === "fulfilled" ? rpcResult.value : new Map<string, string>();
  const tokensMap = tokensResult.status === "fulfilled" ? tokensResult.value : new Map<string, { tokens: number; sessions: number }>();

  // Merge
  const agents: GatewayAgent[] = [];
  for (const agentId of allAgentIds) {
    let enriched = gatewayMap.get(agentId);
    if (!enriched) {
      enriched = createStubAgent(agentId);
      const meta = customMeta.get(agentId);
      if (meta?.name) enriched.name = meta.name;
      if (meta?.model) enriched.model = meta.model;
    }
    const lastConv = activityMap.get(agentId);
    const activityStatus = statusFromActivity(lastConv);
    if (activityStatus) {
      const rank: Record<string, number> = { active: 2, recent: 1, inactive: 0 };
      if ((rank[activityStatus] ?? 0) > (rank[enriched.status] ?? 0)) {
        enriched.status = activityStatus;
      }
    }
    const tokAgg = tokensMap.get(agentId);
    if (tokAgg) {
      enriched.tokensUsed = tokAgg.tokens;
      if (tokAgg.sessions > 0) enriched.sessions = tokAgg.sessions;
    }
    agents.push(enriched);
  }

  return agents.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
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
    const url = `${config.url}/api/stream?token=${encodeURIComponent(config.token)}`;
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
