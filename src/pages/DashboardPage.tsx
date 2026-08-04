import { useAgents } from "@/hooks/use-agents";
import { useTeams } from "@/hooks/use-teams";
import { useFleetProductivity } from "@/hooks/use-fleet-productivity";
import { useResultsOverview } from "@/hooks/use-results";
import { useNavigate } from "react-router-dom";
import { Bot, MessageSquare, Loader2, WifiOff, Activity, CheckCircle, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import TeamIcon from "@/components/TeamIcon";
import { statusColor, statusLabel } from "@/lib/agent-status";
import StatCard from "@/components/dashboard/StatCard";
import WelcomeCard from "@/components/dashboard/WelcomeCard";
import FleetProductivity from "@/components/dashboard/FleetProductivity";
import TaskLoopPanel from "@/components/dashboard/TaskLoopPanel";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAllAvatars } from "@/hooks/use-agent-avatar";

function formatNumber(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

function formatCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function timeAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return `${Math.floor(hrs / 24)}d`;
  } catch {
    return "—";
  }
}

export default function DashboardPage() {
  const { agents, loading, error, connected } = useAgents();
  const { getTeamsForAgent } = useTeams();
  const { productivity } = useFleetProductivity(agents);
  const { overview: resultsOverview, isLoading: resultsOverviewLoading } = useResultsOverview("30d");
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const agentAvatars = useAllAvatars();

  const onlineAgents = agents.filter((a) => a.status === "active").length;

  const highlightedAgents = agents
    .slice()
    .sort((a, b) => (b.status === "active" ? 1 : 0) - (a.status === "active" ? 1 : 0))
    .slice(0, 4);

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Aurora header - desktop */}
      {!isMobile && (
        <div className="aurora-glow rounded-2xl px-5 py-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-lg shadow-primary/20">
            <Activity className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-foreground">Dashboard</h1>
            <p className="text-[11px] text-muted-foreground">Visão geral da frota e métricas operacionais</p>
          </div>
        </div>
      )}
      {/* Gateway status badge - mobile */}
      {isMobile && (
        <div className="flex items-center gap-2">
          {connected ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-card">
              <div className="relative">
                <div className="h-2 w-2 rounded-full bg-success" />
                <div className="absolute inset-0 h-2 w-2 rounded-full bg-success animate-ping opacity-40" />
              </div>
              <span className="text-xs font-mono text-muted-foreground">Gateway Live</span>
            </div>
          ) : error ? (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-card">
              <WifiOff className="h-3 w-3 text-destructive" />
              <span className="text-xs font-mono text-destructive">Desconectado</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full glass-card">
              <div className="h-2 w-2 rounded-full bg-warning" />
              <span className="text-xs font-mono text-warning">Reconectando...</span>
            </div>
          )}
          <span className="text-xs font-mono text-muted-foreground ml-auto">
            {onlineAgents}/{agents.length} ativos
          </span>
        </div>
      )}

      {/* Stat Cards: 2x2 on mobile, 4 cols on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <StatCard
          label="Super agentes Online"
          value={loading ? "—" : `${onlineAgents}/${agents.length}`}
          sub="Ativos agora"
          icon={Bot}
          gradient="bg-gradient-to-br from-primary/80 to-primary/40"
        />
        <StatCard
          label="Interações"
          value={loading ? "—" : formatNumber(productivity?.totalMessages ?? 0)}
          trendValue={productivity ? `+${Math.round(productivity.totalMessages * 0.12)}` : undefined}
          trend="up"
          sub="30 dias"
          icon={MessageSquare}
          gradient="bg-gradient-to-br from-chart-4/80 to-chart-4/40"
        />
        <StatCard
          label="Resultados"
          value={loading || resultsOverviewLoading ? "—" : formatNumber(resultsOverview.totalCount)}
          sub="30 dias"
          icon={CheckCircle}
          gradient="bg-gradient-to-br from-chart-2/80 to-chart-2/40"
        />
        <StatCard
          label="Economia estimada"
          value={loading || resultsOverviewLoading ? "—" : formatCurrency(resultsOverview.totalEconomy)}
          sub="Base de resultados · 30 dias"
          icon={DollarSign}
          gradient="bg-gradient-to-br from-success/80 to-success/40"
        />
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive glass-card rounded-2xl px-4 py-3 border border-destructive/30">
          <WifiOff className="h-3.5 w-3.5 shrink-0" /> {error}
        </div>
      )}

      {loading && agents.length === 0 && (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      )}

      {/* Welcome + Agents - responsive */}
      {!isMobile && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <WelcomeCard connected={connected} error={error} onlineCount={onlineAgents} totalCount={agents.length} />
          <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-2 gap-4">
            {highlightedAgents.map((agent) => {
              const teams = getTeamsForAgent(agent.id);
              return (
                <div
                  key={agent.id}
                  className="glass-card-glow p-5 space-y-3 flex flex-col cursor-pointer rounded-2xl"
                  onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                >
                  <div className="glass-card-glow-effect" />
                  <div className="relative z-10 space-y-2 flex flex-col flex-1">
                    <div className="flex items-center justify-between">
                      <Badge variant="outline" className="text-[10px] bg-accent/10 text-accent border-accent/30">
                        {statusLabel[agent.status] ?? agent.status}
                      </Badge>
                      <div className={`h-2 w-2 rounded-full ${statusColor[agent.status] ?? "bg-muted"}`} />
                    </div>
                    <span className="text-base font-display font-semibold text-foreground">{agent.name}</span>
                    <p className="text-xs text-muted-foreground flex-1">{agent.model}</p>
                    <div className="flex items-center gap-1.5 pt-1 flex-wrap">
                      {agent.channels.map((ch) => (
                        <span key={ch} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-primary/10 text-primary border border-primary/30 uppercase">{ch}</span>
                      ))}
                      {teams.map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border" style={{ backgroundColor: t.color + "20", color: t.color }}>
                          <TeamIcon name={t.emoji} className="h-3 w-3" style={{ color: t.color }} /> {t.name}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Mobile: Agent cards vertical list */}
      {isMobile && !loading && agents.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-display font-semibold text-foreground">Super agentes</h2>
            <span className="ml-auto text-xs font-mono text-muted-foreground">{agents.length}</span>
          </div>
          <div className="space-y-2">
            {agents.map((agent) => {
              const teams = getTeamsForAgent(agent.id);
              const avatar = agentAvatars[agent.id];
              return (
                <button
                  key={agent.id}
                  onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                  className="w-full glass-card rounded-2xl p-4 flex items-center gap-3 text-left touch-target"
                >
                  <div className="relative shrink-0">
                    <div className="h-11 w-11 rounded-xl overflow-hidden bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center">
                      {avatar ? (
                        <img src={avatar} alt={agent.name} className="h-full w-full object-cover" />
                      ) : (
                        <Bot className="h-5 w-5 text-foreground" />
                      )}
                    </div>
                    <div className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${
                      agent.status === "active" ? "bg-success" : agent.status === "recent" ? "bg-warning" : "bg-muted-foreground"
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-display font-semibold text-foreground truncate">{agent.name}</span>
                      <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-lg ${
                        agent.status === "active" ? "bg-success/15 text-success" : agent.status === "inactive" ? "bg-muted/50 text-muted-foreground" : "bg-warning/15 text-warning"
                      }`}>
                        {agent.status === "active" ? "ATIVO" : agent.status === "inactive" ? "OFF" : "STALE"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      {agent.channels.length > 0 && (
                        <span className="text-[11px] text-muted-foreground truncate">
                          {agent.channels.join(", ")}
                        </span>
                      )}
                      <span className="text-[10px] text-muted-foreground/60 shrink-0">
                        {timeAgo(agent.lastActive)}
                      </span>
                    </div>
                    {teams.length > 0 && (
                      <div className="flex items-center gap-1 mt-1 flex-wrap">
                        {teams.slice(0, 2).map((t) => (
                          <span key={t.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border" style={{ backgroundColor: t.color + "20", color: t.color }}>
                            <TeamIcon name={t.emoji} className="h-3 w-3" style={{ color: t.color }} /> {t.name}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Loop Architecture — autonomous long-running tasks */}
      <TaskLoopPanel />

      {/* Fleet Productivity Charts */}
      {!loading && agents.length > 0 && <FleetProductivity agents={agents} />}

      {/* Agents Table - desktop only */}
      {!loading && agents.length > 0 && !isMobile && (
        <div className="glass-card-glow glow-accent overflow-hidden rounded-2xl">
          <div className="glass-card-glow-effect" />
          <div className="aurora-glow px-5 py-4 border-b border-border/50 flex items-center gap-2 relative z-10">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            <h2 className="text-base font-display font-semibold text-foreground">Todos os Super agentes</h2>
            <span className="ml-auto text-xs font-mono text-muted-foreground">{agents.length} agente(s)</span>
          </div>
          <div className="overflow-x-auto relative z-10">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border/50 text-left sticky top-0 bg-card/50 backdrop-blur-sm">
                  <th className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Nome</th>
                  <th className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Status</th>
                  <th className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Modelo</th>
                  <th className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Canais</th>
                  <th className="px-4 py-2.5 text-xs text-muted-foreground uppercase tracking-wider font-medium">Times</th>
                </tr>
              </thead>
              <tbody>
                {agents.map((agent) => {
                  const teams = getTeamsForAgent(agent.id);
                  return (
                    <tr
                      key={agent.id}
                      className="border-b border-border/30 hover:bg-primary/5 transition-colors duration-150 cursor-pointer"
                      onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                    >
                      <td className="px-4 py-3">
                        <div>
                          <span className="font-medium text-foreground">{agent.name}</span>
                          <p className="text-[10px] font-mono text-muted-foreground">{agent.id}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`h-2 w-2 rounded-full ${statusColor[agent.status] ?? "bg-muted"}`} />
                          <span className="text-xs text-muted-foreground">{statusLabel[agent.status] ?? agent.status}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{agent.model}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          {agent.channels.map((ch) => (
                            <span key={ch} className="px-1.5 py-0.5 text-[10px] font-mono rounded bg-primary/10 text-primary border border-primary/30 uppercase">{ch}</span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {teams.map((t) => (
                            <span key={t.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded border border-border" style={{ backgroundColor: t.color + "20", color: t.color }}>
                              <TeamIcon name={t.emoji} className="h-3 w-3" style={{ color: t.color }} /> {t.name}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && agents.length === 0 && (
        <div className="glass-card p-8 text-center space-y-2 rounded-2xl">
          <Bot className="h-8 w-8 text-muted-foreground mx-auto" />
          <p className="text-sm text-muted-foreground">Nenhum agente encontrado no gateway.</p>
        </div>
      )}
    </div>
  );
}
