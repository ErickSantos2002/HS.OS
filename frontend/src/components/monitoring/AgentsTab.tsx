import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Bot, Circle, MessageSquare, Cpu, Clock, AlertTriangle,
  Users, Zap, ExternalLink, Globe,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getModelLabel } from "@/lib/model-pricing";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { getOfficialAgentEntries } from "@/lib/active-agents";

/* ───────── Agent catalog (loaded from agent_profiles) ───────── */
interface KnownAgent {
  id: string;
  name: string;
  role: string;
  hex: string;
}

/* ───────── Helpers ───────── */
function relativeTime(dateStr: string | undefined | null): string {
  if (!dateStr) return "—";
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86400)}d`;
}

function channelIcon(ch: string | undefined | null) {
  if (!ch) return <Globe className="h-3 w-3" />;
  const lower = (ch || "").toLowerCase();
  if (lower.includes("telegram")) return <span className="text-xs">💬</span>;
  if (lower.includes("whatsapp")) return <span className="text-xs">📱</span>;
  if (lower.includes("web")) return <Globe className="h-3 w-3" />;
  return <MessageSquare className="h-3 w-3" />;
}

type AgentStatus = "online" | "processing" | "inactive" | "error";

function normalizeStatus(s: string | undefined): AgentStatus {
  if (!s) return "inactive";
  const l = s.toLowerCase();
  if (l === "online" || l === "active") return "online";
  if (l === "processing" || l === "busy") return "processing";
  if (l === "error") return "error";
  return "inactive";
}

const STATUS_CONFIG: Record<AgentStatus, { label: string; dotClass: string; glowClass: string }> = {
  online: { label: "Online", dotClass: "text-success", glowClass: "glow-success" },
  processing: { label: "Processando", dotClass: "text-warning", glowClass: "glow-accent" },
  inactive: { label: "Inativo", dotClass: "text-muted-foreground", glowClass: "" },
  error: { label: "Erro", dotClass: "text-destructive", glowClass: "glow-destructive" },
};

/* ───────── Props ───────── */
interface AgentsTabProps {
  data: any | null;
  isLoading: boolean;
  gatewayOnline: boolean;
  lastUpdated: Date | null;
}

/* ───────── Component ───────── */
export function AgentsTab({ data, isLoading, gatewayOnline }: AgentsTabProps) {
  const navigate = useNavigate();
  useAgentCatalog();
  const KNOWN_AGENTS: KnownAgent[] = getOfficialAgentEntries().map((e) => ({
    id: e.id,
    name: e.name || e.id,
    role: "", // department kept out to avoid brand-specific labels
    hex: e.color || "#64748b",
  }));
  const [showSkeleton, setShowSkeleton] = useState(true);

  // Per-agent today deltas from agent_token_snapshots
  const [agentToday, setAgentToday] = useState<Record<string, { tokens: number; input: number; output: number }>>({});
  // Per-agent latest known model (last 7 days, non-null, non-unknown) — same source as agent profile
  const [agentModels, setAgentModels] = useState<Record<string, string>>({});
  // Per-agent session_count from agent_stats (latest row)
  const [agentSessions, setAgentSessions] = useState<Record<string, number>>({});
  // Latest model snapshot overall (for "Modelo principal" card)
  const [latestModel, setLatestModel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const [snapsRes, statsRes, modelsRes] = await Promise.all([
        supabase
          .from("agent_token_snapshots")
          .select("agent_id,total_tokens,input_tokens,output_tokens,snapshot_at")
          .gte("snapshot_at", todayStart.toISOString())
          .order("snapshot_at", { ascending: true }),
        supabase
          .from("agent_stats")
          .select("agent_id,session_count,collected_at")
          .order("collected_at", { ascending: false })
          .limit(500),
        supabase
          .from("agent_token_snapshots")
          .select("agent_id,model,snapshot_at")
          .gte("snapshot_at", sevenDaysAgo.toISOString())
          .not("model", "is", null)
          .neq("model", "unknown")
          .order("snapshot_at", { ascending: false })
          .limit(2000),
      ]);

      if (cancelled) return;

      const minMax: Record<string, { tMin: number; tMax: number; iMin: number; iMax: number; oMin: number; oMax: number }> = {};
      for (const r of snapsRes.data || []) {
        const id = r.agent_id;
        if (!id) continue;
        const t = r.total_tokens ?? 0;
        const i = r.input_tokens ?? 0;
        const o = r.output_tokens ?? 0;
        const cur = minMax[id];
        if (!cur) {
          minMax[id] = { tMin: t, tMax: t, iMin: i, iMax: i, oMin: o, oMax: o };
        } else {
          cur.tMin = Math.min(cur.tMin, t); cur.tMax = Math.max(cur.tMax, t);
          cur.iMin = Math.min(cur.iMin, i); cur.iMax = Math.max(cur.iMax, i);
          cur.oMin = Math.min(cur.oMin, o); cur.oMax = Math.max(cur.oMax, o);
        }
      }
      const grouped: Record<string, { tokens: number; input: number; output: number }> = {};
      for (const [id, v] of Object.entries(minMax)) {
        grouped[id] = {
          tokens: Math.max(0, v.tMax - v.tMin),
          input: Math.max(0, v.iMax - v.iMin),
          output: Math.max(0, v.oMax - v.oMin),
        };
      }
      setAgentToday(grouped);

      // Latest model per agent (modelsRes is desc by snapshot_at; first row per id wins)
      const models: Record<string, string> = {};
      let topModel: string | null = null;
      for (const r of modelsRes.data || []) {
        const id = r.agent_id;
        const m = r.model;
        if (!id || !m) continue;
        if (!models[id]) models[id] = m;
        if (!topModel) topModel = m;
      }
      setAgentModels(models);
      setLatestModel(topModel);

      const sessions: Record<string, number> = {};
      for (const r of statsRes.data || []) {
        const id = r.agent_id;
        if (!id || sessions[id] !== undefined) continue;
        sessions[id] = r.session_count ?? 0;
      }
      setAgentSessions(sessions);
    }
    load();
    const id = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  useEffect(() => {
    if (!isLoading) { setShowSkeleton(false); return; }
    const t = setTimeout(() => setShowSkeleton(false), 3000);
    return () => clearTimeout(t);
  }, [isLoading]);

  const agentList: any[] = Array.isArray(data) ? data : data?.agents ?? [];
  const agentMap = new Map<string, any>();
  for (const a of agentList) {
    const key = (a.agent_id || a.id || a.name || "").toLowerCase().replace(/[\s_]+/g, "-");
    agentMap.set(key, a);
    if (a.name) agentMap.set(a.name.toLowerCase(), a);
  }

  const merged = KNOWN_AGENTS.map((ka) => {
    const remote = agentMap.get(ka.id) || agentMap.get(ka.name.toLowerCase());
    const status = normalizeStatus(remote?.status);
    const today = agentToday[ka.id];
    const modelRaw = agentModels[ka.id] || null;
    return {
      ...ka,
      status,
      model: modelRaw,
      lastActive: remote?.last_active || remote?.lastActive,
      lastChannel: remote?.last_channel || remote?.lastChannel,
      msgsToday: remote?.messages_today ?? remote?.msgs_today ?? 0,
      tokensToday: today?.tokens ?? 0,
      sessionsActive: agentSessions[ka.id] ?? 0,
      errorsToday: remote?.errors_today ?? remote?.errorsToday ?? 0,
      cronJobs: remote?.cron_jobs ?? remote?.cronJobs ?? 0,
    };
  });

  const onlineCount = merged.filter((a) => a.status === "online").length;
  const errorAgents = merged.filter((a) => a.status === "error");
  const totalMsgsToday = merged.reduce((s, a) => s + (a.msgsToday || 0), 0);
  // "Modelo principal" = modelo usado pela maioria dos 8 agentes oficiais
  // (1 voto por agente, baseado no modelo do snapshot mais recente de cada um)
  const modelVotes: Record<string, number> = {};
  for (const a of merged) {
    if (a.model) modelVotes[a.model] = (modelVotes[a.model] ?? 0) + 1;
  }
  const winner = Object.entries(modelVotes).sort((a, b) => b[1] - a[1])[0];
  const mostUsedModel = winner ? getModelLabel(winner[0]) : "—";
  const lastActiveAgent = merged
    .filter((a) => a.lastActive)
    .sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime())[0];



  /* Loading skeleton */
  if (isLoading && showSkeleton) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-4"><Skeleton className="h-10 w-full" /></div>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-6"><Skeleton className="h-32 w-full" /></div>
          ))}
        </div>
      </div>
    );
  }

  /* Empty state */
  if (!agentList.length && !isLoading && !gatewayOnline) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4">
        <div className="h-16 w-16 rounded-2xl glass-card flex items-center justify-center overflow-hidden">
          <Bot className="h-8 w-8 text-muted-foreground" />
        </div>
        <p className="text-sm text-muted-foreground text-center max-w-sm">
          Nenhum agente encontrado. Verifique o gateway.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Alerts */}
      {!gatewayOnline && !isLoading && (
        <Alert variant="destructive" className="rounded-2xl border-destructive/30 bg-destructive/5 backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Gateway offline — agentes indisponíveis</AlertTitle>
          <AlertDescription>Os dados abaixo podem estar desatualizados.</AlertDescription>
        </Alert>
      )}
      {gatewayOnline && errorAgents.length > 0 && (
        <Alert className="rounded-2xl border-warning/30 bg-warning/5 backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>{errorAgents.length} agente(s) com problema</AlertTitle>
          <AlertDescription>{errorAgents.map((a) => a.name).join(", ")}</AlertDescription>
        </Alert>
      )}

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card rounded-2xl p-4 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Super agentes Online</span>
          <span className={`text-2xl font-mono font-bold block ${onlineCount === 8 ? "text-success" : "text-destructive"}`}>
            {onlineCount}/8
          </span>
        </div>
        <div className="glass-card rounded-2xl p-4 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Mensagens hoje</span>
          <span className="text-2xl font-mono font-bold block text-foreground">{totalMsgsToday.toLocaleString("pt-BR")}</span>
        </div>
        <div className="glass-card rounded-2xl p-4 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Modelo principal</span>
          <Badge variant="outline" className="font-mono text-xs mt-1 border-primary/30 text-primary">{mostUsedModel}</Badge>
        </div>
        <div className="glass-card rounded-2xl p-4 space-y-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Último ativo</span>
          <span className="text-sm font-semibold block text-foreground">{lastActiveAgent?.name || "—"}</span>
          {lastActiveAgent?.lastActive && (
            <span className="text-[10px] text-muted-foreground font-mono">{relativeTime(lastActiveAgent.lastActive)}</span>
          )}
        </div>
      </div>

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {merged.map((agent) => {
          const sc = STATUS_CONFIG[agent.status];
          return (
            <div key={agent.id} className={`glass-card-glow ${sc.glowClass} rounded-2xl overflow-hidden`}>
              <div className="glass-card-glow-effect" />
              {/* Header */}
              <div className="relative z-10 p-4 pb-3 flex items-start gap-3">
                <div
                  className="h-10 w-10 rounded-xl shrink-0 overflow-hidden border-2 shadow-lg flex items-center justify-center bg-gradient-to-br from-card to-secondary"
                  style={{ borderColor: agent.hex, boxShadow: `0 8px 20px -8px ${agent.hex}66` }}
                >
                  <Bot className="h-5 w-5" style={{ color: agent.hex }} />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-display font-semibold text-foreground">{agent.name}</h3>
                  <p className="text-[10px] text-muted-foreground">{agent.role}</p>
                </div>
                <Badge
                  variant="outline"
                  className="shrink-0 text-[10px] gap-1 rounded-full border-border/50 backdrop-blur-sm"
                >
                  <Circle className={`h-2 w-2 fill-current ${sc.dotClass}`} />
                  {sc.label}
                </Badge>
              </div>

              <div className="relative z-10 px-4 pb-4 space-y-3">
                {/* Model + channel + last active */}
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline" className="font-mono text-[10px] border-purple-500/30 text-purple-400 rounded-full">
                    {agent.model ? getModelLabel(agent.model) : "—"}
                  </Badge>
                  <span className="flex items-center gap-1 text-xs text-muted-foreground">
                    {channelIcon(agent.lastChannel)}
                    {agent.lastChannel || "—"}
                  </span>
                  <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                    {relativeTime(agent.lastActive)}
                  </span>
                </div>

                {/* Metrics 2×2 */}
                <div className="grid grid-cols-2 gap-px rounded-xl overflow-hidden bg-border/30">
                  {[
                    { label: "Msgs hoje", value: agent.msgsToday, icon: MessageSquare },
                    { label: "Tokens hoje", value: agent.tokensToday, icon: Cpu, dashWhenZero: true },
                    { label: "Sessões ativas", value: agent.sessionsActive, icon: Users },
                    { label: "Erros hoje", value: agent.errorsToday, icon: AlertTriangle },
                  ].map((m) => {
                    const isZero = typeof m.value === "number" && m.value === 0;
                    const display = m.dashWhenZero && isZero
                      ? "—"
                      : typeof m.value === "number" ? m.value.toLocaleString("pt-BR") : m.value;
                    return (
                      <div key={m.label} className="bg-card/40 backdrop-blur-sm px-3 py-2 flex flex-col gap-0.5">
                        <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                          <m.icon className="h-3 w-3" />
                          {m.label}
                        </span>
                        <span className={`text-sm font-mono font-bold ${m.label.includes("Erros") && (m.value as number) > 0 ? "text-destructive" : "text-foreground"}`}>
                          {display}
                        </span>
                      </div>
                    );
                  })}
                </div>


                {/* Footer */}
                <div className="flex items-center justify-between pt-1">
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Zap className="h-3 w-3" />
                    {agent.cronJobs} cron job{agent.cronJobs !== 1 ? "s" : ""}
                  </span>
                  <div className="flex gap-1.5">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1 rounded-full hover:bg-primary/10"
                      onClick={() => navigate(`/sessions?agent=${agent.id}`)}
                    >
                      <Clock className="h-3 w-3" /> Sessões
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs gap-1 rounded-full hover:bg-primary/10"
                      onClick={() => navigate(`/chat?agent=${agent.id}`)}
                    >
                      <ExternalLink className="h-3 w-3" /> Chat
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
