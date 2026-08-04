import { Bot } from "lucide-react";
import type { GatewayAgent } from "@/hooks/use-agents";

interface Props {
  agents: GatewayAgent[];
  avatars: Record<string, string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export default function ListView({ agents, avatars, selectedId, onSelect }: Props) {
  return (
    <div className="glass-card rounded-2xl overflow-hidden h-full">
      <div className="overflow-y-auto h-full">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border text-muted-foreground text-[10px] uppercase tracking-wider bg-card/80 sticky top-0 z-10">
              <th className="text-left py-3 px-4 font-medium">Agente</th>
              <th className="text-left py-3 px-4 font-medium">Status</th>
              <th className="text-left py-3 px-4 font-medium hidden sm:table-cell">Modelo</th>
              <th className="text-left py-3 px-4 font-medium hidden md:table-cell">Canais</th>
              <th className="text-right py-3 px-4 font-medium hidden sm:table-cell">Tokens</th>
              <th className="text-right py-3 px-4 font-medium">Sessões</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => {
              const isSelected = selectedId === agent.id;
              const avatar = avatars[agent.id];
              return (
                <tr
                  key={agent.id}
                  onClick={() => onSelect(agent.id)}
                  className={`border-b border-border/30 cursor-pointer transition-all duration-200 ${
                    isSelected ? "bg-primary/10" : "hover:bg-card/60"
                  }`}
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <div className="h-8 w-8 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden border border-border bg-gradient-to-br from-card to-secondary">
                        {avatar ? (
                          <img src={avatar} alt={agent.name} className="w-full h-full object-cover" />
                        ) : (
                          <Bot className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </div>
                      <div>
                        <div className="font-display font-bold text-foreground">{agent.name}</div>
                        <div className="text-[10px] font-mono text-muted-foreground">{agent.id}</div>
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-1.5">
                      <div className={`h-2.5 w-2.5 rounded-full ${
                        agent.status === "active" ? "bg-success shadow-sm shadow-success/50" : agent.status === "inactive" ? "bg-muted-foreground" : "bg-warning"
                      }`} />
                      <span className="capitalize text-muted-foreground text-[11px]">{agent.status}</span>
                    </div>
                  </td>
                  <td className="py-3 px-4 font-mono text-muted-foreground hidden sm:table-cell">{agent.model}</td>
                  <td className="py-3 px-4 hidden md:table-cell">
                    <div className="flex gap-1 flex-wrap">
                      {agent.channels.slice(0, 2).map((ch) => (
                        <span key={ch} className="px-1.5 py-0.5 text-[9px] font-mono rounded-lg bg-primary/10 text-primary border border-primary/30 uppercase">
                          {ch}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted-foreground hidden sm:table-cell">
                    {agent.tokensUsed.toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-mono text-muted-foreground">{agent.sessions}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
