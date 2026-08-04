import { Bot, Zap, MessageSquare } from "lucide-react";
import type { GatewayAgent } from "@/hooks/use-agents";


interface Props {
  agents: GatewayAgent[];
  avatars: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function GridView({ agents, avatars, selectedId, onSelect }: Props) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 p-1 overflow-y-auto h-full">
      {agents.map((agent) => {
        const isSelected = selectedId === agent.id;
        const avatar = avatars[agent.id];
        const isActive = agent.status === "active";

        return (
          <button
            key={agent.id}
            onClick={() => onSelect(agent.id)}
            className={`group relative glass-card-glow rounded-2xl text-left transition-all duration-300 ${
              isSelected ? "ring-1 ring-primary shadow-lg shadow-primary/20 scale-[1.02]" : "hover:scale-[1.01]"
            }`}
          >
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 p-4 space-y-3">
              {/* Avatar + status */}
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div
                    className="h-12 w-12 rounded-2xl flex items-center justify-center overflow-hidden border-2 bg-gradient-to-br from-card to-secondary"
                    style={{
                      borderColor: isActive ? "hsl(160 84% 39%)" : agent.status === "inactive" ? "hsl(0 0% 20%)" : "hsl(38 92% 50%)",
                    }}
                  >
                    {avatar ? (
                      <img src={avatar} alt={agent.name} className="w-full h-full object-cover" />
                    ) : (
                      <Bot className="h-5 w-5 text-muted-foreground" />
                    )}
                  </div>
                  {/* Status dot */}
                  <div
                    className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-card ${
                      isActive ? "bg-success" : agent.status === "inactive" ? "bg-muted-foreground" : "bg-warning"
                    }`}
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-display font-bold text-foreground truncate">{agent.name}</h3>
                  <span className="text-[10px] font-mono text-muted-foreground">{agent.model}</span>
                </div>
              </div>

              {/* Mini metrics */}
              <div className="grid grid-cols-2 gap-2">
                <div className="flex items-center gap-1.5 bg-card/60 rounded-xl px-2 py-1.5">
                  <Zap className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-mono text-muted-foreground">{agent.tokensUsed.toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-1.5 bg-card/60 rounded-xl px-2 py-1.5">
                  <MessageSquare className="h-3 w-3 text-primary" />
                  <span className="text-[10px] font-mono text-muted-foreground">{agent.sessions}</span>
                </div>
              </div>

              {/* Channels */}
              <div className="flex gap-1 flex-wrap">
                {agent.channels.slice(0, 3).map((ch) => (
                  <span key={ch} className="px-2 py-0.5 text-[9px] font-mono rounded-lg bg-primary/10 text-primary border border-primary/30 uppercase">
                    {ch}
                  </span>
                ))}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}
