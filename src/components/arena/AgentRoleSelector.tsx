import { useState } from "react";
import { Bot, Star, ChevronDown } from "lucide-react";
import { getArenaAgentsCatalog, type ArenaAgentCatalog } from "@/lib/arena-agents-catalog";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";

export interface SelectedAgentRole {
  agentId: string;
  agentName: string;
  roleName: string;
  roleDescription: string;
  isPrimary: boolean;
}

interface Props {
  value: SelectedAgentRole[];
  onChange: (agents: SelectedAgentRole[]) => void;
}

export default function AgentRoleSelector({ value, onChange }: Props) {
  useAgentCatalog();
  const catalog = getArenaAgentsCatalog();
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  const isSelected = (id: string) => value.some((a) => a.agentId === id);

  const toggle = (cat: ArenaAgentCatalog) => {
    if (isSelected(cat.id)) {
      onChange(value.filter((a) => a.agentId !== cat.id));
    } else {
      onChange([
        ...value,
        {
          agentId: cat.id,
          agentName: cat.name,
          roleName: cat.suggestedRoles[0],
          roleDescription: "",
          isPrimary: value.length === 0,
        },
      ]);
      setExpandedAgent(cat.id);
    }
  };

  const updateRole = (agentId: string, field: Partial<SelectedAgentRole>) => {
    onChange(value.map((a) => (a.agentId === agentId ? { ...a, ...field } : a)));
  };

  const setPrimary = (agentId: string) => {
    onChange(value.map((a) => ({ ...a, isPrimary: a.agentId === agentId })));
  };

  return (
    <div className="space-y-2">
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-display">
        Super agentes e Papéis
      </label>

      <div className="space-y-1.5">
        {catalog.map((cat) => {
          const selected = isSelected(cat.id);
          const agentData = value.find((a) => a.agentId === cat.id);
          const expanded = expandedAgent === cat.id && selected;

          return (
            <div key={cat.id} className="rounded-xl border border-border/60 overflow-hidden transition-all">
              {/* Agent row */}
              <button
                type="button"
                onClick={() => toggle(cat)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                  selected
                    ? "bg-primary/10 border-primary/30"
                    : "hover:bg-secondary/40"
                }`}
              >
                <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${
                  selected ? "bg-primary/20" : "bg-secondary/50"
                }`}>
                  <Bot className={`h-4 w-4 ${selected ? "text-primary" : "text-muted-foreground"}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <span className={`text-sm font-medium ${selected ? "text-foreground" : "text-muted-foreground"}`}>
                    {cat.name}
                  </span>
                  {agentData?.roleName && selected && (
                    <span className="text-xs text-primary ml-2">— {agentData.roleName}</span>
                  )}
                </div>
                {selected && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {agentData?.isPrimary && (
                      <Star className="h-3.5 w-3.5 text-warning fill-warning" />
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedAgent(expanded ? null : cat.id);
                      }}
                      className="p-1 rounded hover:bg-secondary/50"
                    >
                      <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
                    </button>
                  </div>
                )}
              </button>

              {/* Expanded role config */}
              {expanded && agentData && (
                <div className="px-3 pb-3 pt-1 space-y-2 bg-secondary/20">
                  {/* Suggested roles */}
                  <div className="flex flex-wrap gap-1.5">
                    {cat.suggestedRoles.map((role) => (
                      <button
                        key={role}
                        type="button"
                        onClick={() => updateRole(cat.id, { roleName: role })}
                        className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
                          agentData.roleName === role
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "border-border/40 text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                        }`}
                      >
                        {role}
                      </button>
                    ))}
                  </div>

                  {/* Custom role input */}
                  <input
                    type="text"
                    value={agentData.roleName}
                    onChange={(e) => updateRole(cat.id, { roleName: e.target.value })}
                    placeholder="Papel personalizado..."
                    className="w-full bg-background/50 border border-border/40 rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
                  />

                  {/* Description */}
                  <textarea
                    value={agentData.roleDescription}
                    onChange={(e) => updateRole(cat.id, { roleDescription: e.target.value })}
                    placeholder="Descreva o papel deste agente na Arena..."
                    rows={2}
                    className="w-full bg-background/50 border border-border/40 rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary resize-none"
                  />

                  {/* Primary toggle */}
                  {!agentData.isPrimary && (
                    <button
                      type="button"
                      onClick={() => setPrimary(cat.id)}
                      className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-warning transition-colors"
                    >
                      <Star className="h-3 w-3" />
                      Definir como agente principal
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
