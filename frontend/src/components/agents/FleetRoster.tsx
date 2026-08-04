import { Bot, Clock, Activity, Users } from "lucide-react";
import type { GatewayAgent } from "@/hooks/use-agents";
import type { Person } from "@/hooks/use-people";

const HUMAN_COLOR = "hsl(185, 70%, 50%)";
const HEXAGON_CLIP = "polygon(50% 0%, 93% 25%, 93% 75%, 50% 100%, 7% 75%, 7% 25%)";

interface Props {
  agents: GatewayAgent[];
  avatars: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  people?: Person[];
}

function timeAgo(iso: string) {
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "agora";
    if (mins < 60) return `${mins}m atrás`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h atrás`;
    return `${Math.floor(hrs / 24)}d atrás`;
  } catch {
    return "—";
  }
}

function agentDescription(agent: GatewayAgent) {
  if (agent.systemPrompt) {
    const clean = agent.systemPrompt.replace(/\n/g, " ").trim();
    return clean.length > 80 ? clean.slice(0, 80) + "…" : clean;
  }
  const channels = agent.channels.join(", ");
  return channels ? `Channels: ${channels}` : `Model: ${agent.model}`;
}

function getInitials(name: string | null) {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

export default function FleetRoster({ agents, avatars, selectedId, onSelect, people = [] }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-1 mb-3">
        <Activity className="h-3.5 w-3.5 text-primary" />
        <h2 className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-[0.2em]">
          Fleet Roster
        </h2>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">{agents.length + people.length}</span>
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-1 scrollbar-thin">
        {/* Agents */}
        {agents.map((agent) => {
          const isSelected = selectedId === agent.id;
          const isActive = agent.status === "active";
          const avatarUrl = avatars[agent.id] ?? avatars[agent.id.replace(/^openclaw:/, "")];
          return (
            <button
              key={agent.id}
              onClick={() => onSelect(agent.id)}
              className={`w-full text-left rounded-2xl p-3 transition-all duration-200 border ${
                isSelected
                  ? "bg-primary/10 border-primary/40 shadow-lg shadow-primary/10"
                  : "bg-card/30 border-transparent hover:bg-card/60 hover:border-border"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <div className="relative">
                  <div
                    className="h-9 w-9 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden border mt-0.5 bg-gradient-to-br from-card to-secondary"
                    style={{
                      borderColor: isActive ? "hsl(160 84% 39%)" : agent.status === "inactive" ? "hsl(0 0% 22%)" : "hsl(38 80% 45%)",
                    }}
                  >
                    {avatarUrl ? (
                      <img src={avatarUrl} alt={agent.name} className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card ${
                      isActive ? "bg-success" : agent.status === "inactive" ? "bg-muted-foreground" : "bg-warning"
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-xs font-display font-bold text-foreground truncate">{agent.name}</span>
                    <span className={`text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-lg tracking-wider ${
                      isActive ? "bg-success/15 text-success" : agent.status === "inactive" ? "bg-muted/50 text-muted-foreground" : "bg-warning/15 text-warning"
                    }`}>
                      {isActive ? "ACTIVE" : agent.status === "inactive" ? "OFF" : "STALE"}
                    </span>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-tight mt-1 line-clamp-2">
                    {agentDescription(agent)}
                  </p>
                  <div className="flex items-center gap-1 mt-1.5 text-[10px] text-muted-foreground">
                    <Clock className="h-2.5 w-2.5" />
                    <span>{timeAgo(agent.lastActive)}</span>
                  </div>
                </div>
              </div>
            </button>
          );
        })}

        {/* Human team section */}
        {people.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-1 mt-4 mb-2">
              <Users className="h-3.5 w-3.5" style={{ color: HUMAN_COLOR }} />
              <h3 className="text-[10px] font-display font-bold uppercase tracking-[0.2em]" style={{ color: HUMAN_COLOR }}>
                Equipe Humana
              </h3>
              <span className="ml-auto text-[10px] font-mono text-muted-foreground">{people.length}</span>
            </div>
            {people.map((person) => (
              <div
                key={person.id}
                className="w-full text-left rounded-2xl p-3 bg-card/30 border border-transparent"
              >
                <div className="flex items-center gap-2.5">
                  {/* Hexagonal avatar */}
                  <div
                    className="h-9 w-9 flex-shrink-0 flex items-center justify-center overflow-hidden"
                    style={{ clipPath: HEXAGON_CLIP }}
                  >
                    {person.avatar_url ? (
                      <img src={person.avatar_url} alt={person.full_name ?? ""} className="w-full h-full object-cover" />
                    ) : (
                      <div
                        className="w-full h-full flex items-center justify-center"
                        style={{ background: `linear-gradient(135deg, hsl(185 40% 15%), hsl(185 50% 25%))` }}
                      >
                        <span className="text-[10px] font-bold" style={{ color: HUMAN_COLOR }}>
                          {getInitials(person.full_name)}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-display font-bold text-foreground truncate block">
                      {person.full_name ?? person.email.split("@")[0]}
                    </span>
                    <span className="text-[10px] text-muted-foreground truncate block">{person.email}</span>
                  </div>
                  <span
                    className="text-[8px] font-mono font-bold px-1.5 py-0.5 rounded-lg tracking-wider shrink-0"
                    style={{ backgroundColor: "hsl(185, 60%, 25%)", color: HUMAN_COLOR }}
                  >
                    {person.status === "active" ? "ATIVO" : "INATIVO"}
                  </span>
                </div>
              </div>
            ))}
          </>
        )}

        {agents.length === 0 && people.length === 0 && (
          <div className="text-center py-8">
            <Bot className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
            <p className="text-xs text-muted-foreground">Nenhum agente encontrado</p>
          </div>
        )}
      </div>
    </div>
  );
}