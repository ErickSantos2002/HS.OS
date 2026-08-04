import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { getSetting, setSetting, deleteSetting } from "@/lib/app-settings";
import { useNavigate } from "react-router-dom";
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  Handle,
  Position,
  type NodeProps,
  MarkerType,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useTeams, type Team } from "@/hooks/use-teams";
import { useAgents } from "@/hooks/use-agents";
import { isOfficialAgentId } from "@/lib/active-agents";
import { Plus, Users, Save, Trash2, UserPlus, UserMinus, Bot, LayoutGrid } from "lucide-react";

import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import TeamIcon from "@/components/TeamIcon";

/* ── Constants ── */
const COLORS = ["#3D61FF", "#E41A11", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899", "#06B6D4", "#F97316"];
const ICON_OPTIONS = [
  "Bot", "Rocket", "Briefcase", "Target", "Zap", "Flame",
  "Star", "Shield", "BarChart3", "Brain", "MessageSquare", "Palette",
];

/* ── Custom Nodes ── */

function TeamNode({ data }: NodeProps) {
  const d = data as {
    label: string; color: string; emoji: string; description: string;
    agentCount: number; selected: boolean; onSelect: () => void;
  };
  return (
    <div
      onClick={(e) => { e.stopPropagation(); d.onSelect(); }}
      className="cursor-pointer rounded-2xl px-6 py-5 transition-all duration-200"
      style={{
        background: "hsl(0 0% 7%)",
        border: `2px solid ${d.color}60`,
        minWidth: 220,
        boxShadow: d.selected
          ? `0 0 30px ${d.color}30, 0 8px 32px rgba(0,0,0,0.5)`
          : `0 4px 24px rgba(0,0,0,0.4)`,
      }}
    >
      <Handle type="source" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="source" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="flex items-center gap-4">
        <div
          className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: `${d.color}20` }}
        >
          <TeamIcon name={d.emoji} className="h-6 w-6" style={{ color: d.color }} />
        </div>
        <div>
          <p className="text-[15px] font-bold text-white leading-tight">{d.label}</p>
          <p className="text-xs text-white/40 leading-tight mt-0.5">{d.description || "Sem descrição"}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs text-white/40">
        <Bot className="h-3.5 w-3.5" style={{ color: d.color }} />
        <span>{d.agentCount} agente{d.agentCount !== 1 ? "s" : ""}</span>
        <span className="ml-auto text-[9px] opacity-50">{d.selected ? "clique p/ recolher" : "clique p/ expandir"}</span>
      </div>
    </div>
  );
}

function AgentNode({ data }: NodeProps) {
  const d = data as { label: string; teamColor: string; highlighted: boolean };
  return (
    <div
      className="rounded-xl px-5 py-2.5 transition-all duration-200"
      style={{
        background: "hsl(0 0% 7%)",
        border: `2px solid ${d.teamColor}50`,
        boxShadow: `0 2px 12px rgba(0,0,0,0.3)`,
      }}
    >
      <Handle type="target" position={Position.Top} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Bottom} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Left} className="!bg-transparent !border-0 !w-0 !h-0" />
      <Handle type="target" position={Position.Right} className="!bg-transparent !border-0 !w-0 !h-0" />
      <div className="flex items-center gap-2.5">
        <Bot className="h-4 w-4" style={{ color: d.teamColor }} />
        <span className="text-sm font-medium text-white whitespace-nowrap">{d.label}</span>
      </div>
    </div>
  );
}

const nodeTypes = { team: TeamNode, agent: AgentNode };

/* ── Circular layout ── */

function buildGraph(
  teams: Team[],
  agents: ReturnType<typeof useAgents>["agents"],
  selectedTeamId: string | null,
  onSelectTeam: (id: string) => void,
) {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // Calculate max agents per team for adaptive spacing
  const maxAgentsInTeam = Math.max(1, ...teams.map((t) => t.agentIds.length));
  const TEAM_SPACING = Math.max(450, maxAgentsInTeam * 30);
  const COLS = Math.max(1, Math.ceil(Math.sqrt(teams.length)));

  teams.forEach((team, ti) => {
    const visibleAgentIds = team.agentIds.filter(isOfficialAgentId);
    const col = ti % COLS;
    const row = Math.floor(ti / COLS);
    const tx = col * TEAM_SPACING;
    const ty = row * TEAM_SPACING;
    const isSelected = selectedTeamId === team.id;

    nodes.push({
      id: team.id,
      type: "team",
      position: { x: tx, y: ty },
      data: {
        label: team.name,
        color: team.color || COLORS[0],
        emoji: team.emoji || "Bot",
        description: team.description,
        agentCount: visibleAgentIds.length,
        selected: isSelected,
        onSelect: () => onSelectTeam(team.id),
      },
    });

    // Build agent list: match gateway agents by ID, fall back to showing agent_id as name
    const agentEntries = visibleAgentIds.map((agentId) => {
      const gatewayAgent = agents.find((a) => a.id === agentId || a.name === agentId);
      return { id: agentId, name: gatewayAgent?.name ?? agentId };
    });
    const count = agentEntries.length;
    if (count === 0) return;

    const agentRadius = Math.max(140, count * 20);
    const angleStep = (2 * Math.PI) / count;
    const startAngle = -Math.PI / 2;
    const color = team.color || COLORS[0];

    agentEntries.forEach((agent, ai) => {
      const angle = startAngle + ai * angleStep;
      const ax = tx + 40 + Math.cos(angle) * agentRadius;
      const ay = ty + 30 + Math.sin(angle) * agentRadius;
      const nodeId = `agent-${team.id}-${agent.id}`;

      nodes.push({
        id: nodeId,
        type: "agent",
        position: { x: ax, y: ay },
        data: {
          label: agent.name,
          teamColor: color,
          highlighted: isSelected,
        },
      });

      edges.push({
        id: `e-${team.id}-${agent.id}`,
        source: team.id,
        target: nodeId,
        type: "smoothstep",
        animated: true,
        className: "animated-edge",
        style: {
          stroke: color,
          strokeWidth: 2.5,
          opacity: 0.45,
          strokeDasharray: "8 6",
        },
      });
    });
  });

  return { nodes, edges };
}

/* ── Page ── */

export default function TeamsPage() {
  const { teams, createTeam, deleteTeam, addAgentToTeam, removeAgentFromTeam } = useTeams();
  const { agents } = useAgents();
  const navigate = useNavigate();

  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [managingTeam, setManagingTeam] = useState<Team | null>(null);
  const [form, setForm] = useState({ name: "", description: "", color: COLORS[0], emoji: ICON_OPTIONS[0] });

  const toggleSelect = useCallback((id: string) => {
    setSelectedTeamId((prev) => (prev === id ? null : id));
  }, []);

  const unassignedAgents = useMemo(() => {
    const assignedAgentIds = new Set(teams.flatMap((team) => team.agentIds));
    return agents.filter((agent) => !assignedAgentIds.has(agent.id));
  }, [agents, teams]);

  const { nodes: initNodes, edges: initEdges } = useMemo(
    () => buildGraph(teams, agents, selectedTeamId, toggleSelect),
    [teams, agents, selectedTeamId, toggleSelect],
  );

  const SETTINGS_KEY = "teams-graph-positions";

  // Load saved positions from Supabase (once)
  const [savedPositions, setSavedPositions] = useState<Record<string, { x: number; y: number }> | null>(null);
  const [positionsLoaded, setPositionsLoaded] = useState(false);
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    getSetting<Record<string, { x: number; y: number }>>(SETTINGS_KEY).then((pos) => {
      if (pos) setSavedPositions(pos);
      setPositionsLoaded(true);
    });
  }, []);

  // Persistent position map — survives initNodes rebuilds
  const draggedPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  // Seed draggedPositionsRef from saved positions on first load
  useEffect(() => {
    if (positionsLoaded && savedPositions) {
      Object.entries(savedPositions).forEach(([id, pos]) => {
        draggedPositionsRef.current.set(id, pos);
      });
    }
  }, [positionsLoaded, savedPositions]);

  // Merge: dragged positions > saved positions > computed positions
  const mergedNodes = useMemo(() => {
    return initNodes.map((n) => ({
      ...n,
      position:
        draggedPositionsRef.current.get(n.id) ??
        savedPositions?.[n.id] ??
        n.position,
    }));
  }, [initNodes, savedPositions, positionsLoaded]);

  const [nodes, setNodes, onNodesChange] = useNodesState(mergedNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  // Sync when data changes (teams added/removed, selection) but keep dragged positions
  useEffect(() => {
    setNodes((prev) => {
      const prevPosMap = new Map(prev.map((n) => [n.id, n.position]));
      return initNodes.map((n) => ({
        ...n,
        position:
          draggedPositionsRef.current.get(n.id) ??
          prevPosMap.get(n.id) ??
          savedPositions?.[n.id] ??
          n.position,
      }));
    });
    setEdges(initEdges);
  }, [initNodes, initEdges, setNodes, setEdges]);

  const handleNodeDragStop = useCallback((_: any, node: Node) => {
    draggedPositionsRef.current.set(node.id, node.position);
    setIsDirty(true);
  }, []);

  const handleSaveLayout = useCallback(async () => {
    // Collect all current node positions
    const posMap: Record<string, { x: number; y: number }> = {};
    nodes.forEach((n) => { posMap[n.id] = n.position; });
    await setSetting(SETTINGS_KEY, posMap);
    setSavedPositions(posMap);
    setIsDirty(false);
  }, [nodes]);

  const handleReorganize = useCallback(() => {
    draggedPositionsRef.current.clear();
    setNodes(initNodes);
    setEdges(initEdges);
    deleteSetting(SETTINGS_KEY);
    setSavedPositions(null);
    setIsDirty(false);
  }, [initNodes, initEdges, setNodes, setEdges]);

  const handleCreate = () => {
    if (!form.name.trim()) return;
    createTeam(form);
    setShowCreate(false);
    setForm({ name: "", description: "", color: COLORS[0], emoji: ICON_OPTIONS[0] });
  };

  const selectedTeam = teams.find((t) => t.id === selectedTeamId) ?? null;

  return (
    <div className="flex flex-col h-full">
      {/* Header — aurora glow */}
      <div className="aurora-glow flex items-center justify-between p-4 border-b border-border/50 shrink-0">
        <div className="flex items-center gap-3 relative z-10">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-lg shadow-primary/20">
            <Users className="h-5 w-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-foreground">Times</h1>
            <p className="text-[11px] text-muted-foreground">Grafo interativo — arraste nós, clique num time para destacar</p>
          </div>
        </div>
        <div className="flex gap-2 relative z-10">
          <button
            onClick={handleReorganize}
            className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-full glass-card hover:border-primary/30 transition-colors"
            title="Reorganizar layout"
          >
            <LayoutGrid className="h-4 w-4" /> Reorganizar
          </button>
          {isDirty && (
            <button
              onClick={handleSaveLayout}
              className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 transition-all animate-pulse"
              title="Salvar posições atuais"
            >
              <Save className="h-4 w-4" /> Salvar Layout
            </button>
          )}
          {selectedTeam && (
            <>
              <button
                onClick={() => setManagingTeam(selectedTeam)}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-full glass-card hover:border-primary/30 transition-colors"
              >
                <UserPlus className="h-4 w-4" /> Super agentes
              </button>
              <button
                onClick={() => { if (confirm(`Deletar time "${selectedTeam.name}"?`)) { deleteTeam(selectedTeam.id); setSelectedTeamId(null); } }}
                className="flex items-center gap-1.5 px-3 py-2 text-sm rounded-full glass-card border-destructive/30 text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground shadow-lg shadow-primary/20 hover:opacity-90 transition-all"
          >
            <Plus className="h-4 w-4" /> Novo Time
          </button>
        </div>
      </div>

      {/* Graph */}
      <div className="flex-1 relative">
        {teams.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center space-y-2">
              <Users className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm text-muted-foreground">Nenhum time criado ainda</p>
              <button onClick={() => setShowCreate(true)} className="text-xs text-primary hover:underline">
                Criar primeiro time
              </button>
            </div>
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={handleNodeDragStop}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.4 }}
            proOptions={{ hideAttribution: true }}
            className="bg-background"
            minZoom={0.2}
            maxZoom={2.5}
            onPaneClick={() => setSelectedTeamId(null)}
          >
            <Background color="hsl(var(--muted-foreground))" gap={32} size={1} style={{ opacity: 0.1 }} />
            <Controls className="!bg-card !border-border !rounded-lg !shadow-lg [&>button]:!bg-card [&>button]:!border-border [&>button]:!text-foreground [&>button:hover]:!bg-secondary" />
          </ReactFlow>
        )}
      </div>

      {unassignedAgents.length > 0 && (
        <div className="shrink-0 border-t border-border/50 bg-card/30 px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-display font-semibold text-foreground">Super agentes sem time</h2>
              <p className="text-[11px] text-muted-foreground">Novos agentes aparecem aqui até serem atribuídos a um time.</p>
            </div>
            <div className="text-xs text-muted-foreground">
              {unassignedAgents.length} agente{unassignedAgents.length !== 1 ? "s" : ""}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {unassignedAgents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}`)}
                className="flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-secondary/40"
              >
                <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Bot className="h-3.5 w-3.5" />
                </div>
                <div>
                  <p className="text-sm text-foreground">{agent.name}</p>
                  <p className="text-[10px] font-mono text-muted-foreground">{agent.model}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Create Dialog */}
      <Dialog open={showCreate} onOpenChange={setShowCreate}>
        <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl p-0 gap-0">
          <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
            <DialogTitle className="font-display text-lg font-bold text-foreground">Criar Time</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Nome</label>
                <div className="glass-input mt-1 px-3 py-0">
                  <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="w-full bg-transparent py-2.5 text-sm text-foreground focus:outline-none font-mono" placeholder="Nome do time" />
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Descrição</label>
                <div className="glass-input mt-1 px-3 py-0">
                  <input value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} className="w-full bg-transparent py-2.5 text-sm text-foreground focus:outline-none font-mono" placeholder="Descrição do time" />
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Cor</label>
              <div className="flex gap-2 mt-1">
                {COLORS.map((c) => (
                  <button key={c} onClick={() => setForm((f) => ({ ...f, color: c }))} className={`h-7 w-7 rounded-full border-2 transition-all ${form.color === c ? "border-foreground scale-110" : "border-transparent"}`} style={{ backgroundColor: c }} />
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Ícone</label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {ICON_OPTIONS.map((icon) => (
                  <button key={icon} onClick={() => setForm((f) => ({ ...f, emoji: icon }))} className={`h-8 w-8 rounded-full flex items-center justify-center border transition-all ${form.emoji === icon ? "border-primary/50 bg-primary/10" : "border-border/30 hover:bg-secondary/30"}`}>
                    <TeamIcon name={icon} className="h-4 w-4 text-foreground" />
                  </button>
                ))}
              </div>
            </div>
            <button onClick={handleCreate} disabled={!form.name.trim()} className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm shadow-lg shadow-primary/20 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2">
              <Save className="h-4 w-4" /> Criar
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Manage Agents Dialog */}
      <Dialog open={!!managingTeam} onOpenChange={(open) => !open && setManagingTeam(null)}>
        <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl p-0 gap-0">
          <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
            <DialogTitle className="font-display flex items-center gap-2 text-foreground relative z-10">
              {managingTeam && <TeamIcon name={managingTeam.emoji} className="h-5 w-5" style={{ color: managingTeam.color }} />}
              {managingTeam?.name} — Gerenciar Super agentes
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2 max-h-80 overflow-y-auto p-4">
            {agents.map((agent) => {
              const isInTeam = managingTeam?.agentIds.includes(agent.id) ?? false;
              return (
                <div key={agent.id} className="flex items-center justify-between px-3 py-2 rounded-xl hover:bg-primary/5 transition-colors">
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/40 to-primary/10 flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm text-foreground">{agent.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground">{agent.model}</p>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!managingTeam) return;
                      if (isInTeam) removeAgentFromTeam(managingTeam.id, agent.id);
                      else addAgentToTeam(managingTeam.id, agent.id);
                      setManagingTeam((prev) => prev ? { ...prev, agentIds: isInTeam ? prev.agentIds.filter((id) => id !== agent.id) : [...prev.agentIds, agent.id] } : null);
                    }}
                    className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-full border transition-colors ${isInTeam ? "bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20" : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20"}`}
                  >
                    {isInTeam ? <UserMinus className="h-3 w-3" /> : <UserPlus className="h-3 w-3" />}
                    {isInTeam ? "Remover" : "Adicionar"}
                  </button>
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
