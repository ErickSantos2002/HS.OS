import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useAgents, type GatewayAgent } from "@/hooks/use-agents";
import { useAllAvatars } from "@/hooks/use-agent-avatar";
import { usePeople } from "@/hooks/use-people";
import { Loader2, WifiOff, RefreshCw, AlertTriangle } from "lucide-react";
import FleetHealthBar, { type ViewMode, type StatusFilter } from "@/components/agents/FleetHealthBar";
import NeuralMap from "@/components/agents/NeuralMap";
import GridView from "@/components/agents/GridView";
import ListView from "@/components/agents/ListView";
import FleetRoster from "@/components/agents/FleetRoster";
import AgentDetailPanel from "@/components/agents/AgentDetailPanel";

export default function AgentsPage() {
  const { agents, loading, error, connected, refetch } = useAgents();
  const avatars = useAllAvatars();
  const { people } = usePeople();

  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("neural");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  

  const goToAgent = (id: string) => navigate(`/agents/${encodeURIComponent(id)}`);


  const filtered = useMemo(() => {
    let list = agents;
    if (statusFilter === "active") list = list.filter((a) => a.status === "active");
    else if (statusFilter === "inactive") list = list.filter((a) => a.status === "inactive");
    else if (statusFilter === "unknown") list = list.filter((a) => a.status === "recent");
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.model.toLowerCase().includes(q));
    }
    return list;
  }, [agents, search, statusFilter]);

  const selectedAgent = selectedId ? agents.find((a) => a.id === selectedId) ?? null : null;

  return (
    <div className="flex flex-col min-h-[calc(100vh-3rem)] p-5 gap-4">
      {/* Fleet Health Bar */}
      <FleetHealthBar
        agents={agents}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        connected={connected}
      />


      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive glass-card rounded-2xl px-4 py-3 border border-destructive/30">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {error}
          <button onClick={refetch} className="ml-auto text-foreground hover:text-primary transition-colors">
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Loading */}
      {loading && agents.length === 0 && (
        <div className="flex-1 flex items-center justify-center min-h-[400px]">
          <div className="glass-card rounded-2xl p-8 flex flex-col items-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <span className="text-xs text-muted-foreground font-display">Carregando frota...</span>
          </div>
        </div>
      )}

      {/* Main content */}
      {!loading && (
        <div className="flex gap-4 relative" style={{ minHeight: "70vh", height: "80vh" }}>
          {/* Center: View */}
          <div className="flex-1 min-w-0 h-full">
            {viewMode === "neural" && (
              <NeuralMap agents={filtered} avatars={avatars} selectedId={selectedId} onSelect={setSelectedId} people={people} />
            )}
            {viewMode === "grid" && (
              <GridView agents={filtered} avatars={avatars} selectedId={selectedId} onSelect={setSelectedId} />
            )}
            {viewMode === "list" && (
              <ListView agents={filtered} avatars={avatars} selectedId={selectedId} onSelect={setSelectedId} />
            )}
          </div>

          {/* Right: Fleet Roster */}
          <div className="hidden lg:flex w-80 flex-shrink-0 glass-card rounded-2xl p-3">
            <FleetRoster agents={filtered} avatars={avatars} selectedId={selectedId} onSelect={goToAgent} people={people} />
          </div>

          {/* Detail Panel (overlay) */}
          {selectedAgent && (
            <AgentDetailPanel
              agent={selectedAgent}
              avatar={avatars[selectedAgent.id] ?? null}
              onClose={() => setSelectedId(null)}
            />
          )}
        </div>
      )}

      {/* Breathing space below */}
      <div className="h-16 shrink-0" />
    </div>
  );
}
