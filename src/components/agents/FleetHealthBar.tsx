import { Search, Activity, Bot, AlertTriangle, Clock, Signal } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { GatewayAgent } from "@/hooks/use-agents";

export type ViewMode = "neural" | "grid" | "list";
export type StatusFilter = "all" | "active" | "inactive" | "unknown";

interface Props {
  agents: GatewayAgent[];
  search: string;
  onSearchChange: (v: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (v: StatusFilter) => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  connected: boolean;
}

export default function FleetHealthBar({
  agents, search, onSearchChange, statusFilter, onStatusFilterChange,
  viewMode, onViewModeChange, connected
}: Props) {
  const total = agents.length;
  const active = agents.filter((a) => a.status === "active").length;
  const inactive = agents.filter((a) => a.status === "inactive").length;
  const unknown = agents.filter((a) => a.status === "recent").length;

  const healthPct = total > 0 ? Math.round(active / total * 100) : 0;

  const kpis = [
  {
    label: "Total Agents",
    value: total,
    icon: Bot,
    filter: "all" as StatusFilter,
    iconBg: "bg-primary/20",
    iconColor: "text-primary",
    valueColor: "text-foreground"
  },
  {
    label: "Healthy",
    value: active,
    icon: Activity,
    filter: "active" as StatusFilter,
    iconBg: "bg-success/20",
    iconColor: "text-success",
    valueColor: "text-success"
  },
  {
    label: "Degraded",
    value: inactive,
    icon: AlertTriangle,
    filter: "inactive" as StatusFilter,
    iconBg: "bg-warning/20",
    iconColor: "text-warning",
    valueColor: "text-warning"
  },
  {
    label: "Stale",
    value: unknown,
    icon: Clock,
    filter: "unknown" as StatusFilter,
    iconBg: "bg-muted/30",
    iconColor: "text-muted-foreground",
    valueColor: "text-muted-foreground"
  }];


  return (
    <div className="space-y-4">
      {/* Title row — aurora glow */}
      <div className="aurora-glow rounded-2xl px-5 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-lg shadow-primary/20">
            <Signal className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-xl font-display font-bold text-foreground tracking-wide">Centro de Comando</h1>
            <p className="text-[11px] text-muted-foreground">Fleet overview & operational status</p>
          </div>
        </div>
        <div className="flex items-center gap-3 relative z-10">
          {connected &&
          <span className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono font-bold text-success bg-success/10 border border-success/30 rounded-full">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> LIVE
            </span>
          }
        </div>
      </div>

      {/* KPI Cards — Vision UI style */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map((k) => {
          const isActive = statusFilter === k.filter;
          return (
            <button
              key={k.label}
              onClick={() => onStatusFilterChange(k.filter)}
              className={`glass-card-glow rounded-2xl p-4 text-left transition-all duration-200 ${
              isActive ? "ring-1 ring-primary/60 shadow-lg shadow-primary/10" : ""}`
              }>
              
              <div className="glass-card-glow-effect" />
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{k.label}</span>
                  <div className={`h-8 w-8 rounded-xl ${k.iconBg} flex items-center justify-center`}>
                    <k.icon className={`h-4 w-4 ${k.iconColor}`} />
                  </div>
                </div>
                <div className={`text-2xl font-display font-bold ${k.valueColor}`}>{k.value}</div>
                {k.filter === "active" && total > 0 &&
                <span className="text-[10px] font-medium text-success mt-1 inline-block">
                    {healthPct}% do total
                  </span>
                }
              </div>
            </button>);

        })}
      </div>

      {/* Fleet Health progress bar */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-display font-semibold text-foreground">Saúde dos Super agentes

          </span>
          <span className="text-xs font-mono text-primary font-bold">{healthPct}%</span>
        </div>
        <div className="h-2 rounded-full bg-muted/40 overflow-hidden">
          <div className="h-full rounded-full bg-gradient-to-r from-primary to-success transition-all duration-700" style={{ width: `${healthPct}%` }} />
          
        </div>
      </div>

      {/* Agent Fleet title + toggle + search */}
      <div className="flex items-center justify-between">
        <h2 className="text-base font-display font-bold text-foreground">Super agentes</h2>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <div className="glass-input">
              <input
                value={search}
                onChange={(e) => onSearchChange(e.target.value)}
                placeholder="Buscar agente..."
                className="w-44 bg-transparent pl-8 pr-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none" />
              
            </div>
          </div>
          <ToggleGroup
            type="single"
            value={viewMode}
            onValueChange={(v) => v && onViewModeChange(v as ViewMode)}
            className="glass-input p-0.5">
            
            <ToggleGroupItem value="grid" className="text-[10px] px-2.5 py-1 rounded-full data-[state=on]:bg-gradient-to-r data-[state=on]:from-primary data-[state=on]:to-[hsl(260,70%,55%)] data-[state=on]:text-primary-foreground font-mono">
              GRID
            </ToggleGroupItem>
            <ToggleGroupItem value="neural" className="text-[10px] px-2.5 py-1 rounded-full data-[state=on]:bg-gradient-to-r data-[state=on]:from-primary data-[state=on]:to-[hsl(260,70%,55%)] data-[state=on]:text-primary-foreground font-mono">
              NEURAL
            </ToggleGroupItem>
            <ToggleGroupItem value="list" className="text-[10px] px-2.5 py-1 rounded-full data-[state=on]:bg-gradient-to-r data-[state=on]:from-primary data-[state=on]:to-[hsl(260,70%,55%)] data-[state=on]:text-primary-foreground font-mono">
              COMMAND
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
      </div>
    </div>);

}