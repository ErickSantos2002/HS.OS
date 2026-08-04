import { useMemo, useState } from "react";
import { getAgentDisplayName } from "@/lib/channel-agents";
import { useAgents } from "@/hooks/use-agents";
import { usePeople } from "@/hooks/use-people";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, Hash, Lock, MessageCircle, Loader2 } from "lucide-react";

function AgentIcon({ agentId, className }: { agentId: string; className?: string }) {
  return <Bot className={className ?? "h-4 w-4"} />;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (name: string, desc: string, type: "public" | "private" | "dm", agentIds?: string[], memberIds?: string[]) => Promise<void>;
}

export default function CreateChannelDialog({ open, onOpenChange, onCreate }: Props) {
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [type, setType] = useState<"public" | "private" | "dm">("public");
  const [agents, setAgents] = useState<string[]>([]);
  const [members, setMembers] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const { people } = usePeople();
  const { agents: availableAgents } = useAgents();

  const sortedAgents = useMemo(
    () => [...availableAgents].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    [availableAgents],
  );

  const toggleAgent = (id: string) => setAgents((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const toggleMember = (id: string) => setMembers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      await onCreate(
        name.trim(),
        desc.trim(),
        type,
        agents.length > 0 ? agents : undefined,
        members.length > 0 ? members : undefined,
      );
      setName("");
      setDesc("");
      setType("public");
      setAgents([]);
      setMembers([]);
    } finally {
      setCreating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-h-[85vh] overflow-y-auto p-0 gap-0 rounded-2xl">
        <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
          <DialogTitle className="font-display text-lg font-bold text-foreground">Criar Canal</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 p-6">
          {/* Nome */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome</Label>
            <div className="glass-input px-3 py-0">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="ex: marketing"
                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 h-10 text-sm"
              />
            </div>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Descrição (opcional)</Label>
            <div className="rounded-2xl border border-border/30 bg-secondary/20 backdrop-blur-md px-3 py-1">
              <Textarea
                value={desc}
                onChange={(e) => setDesc(e.target.value)}
                placeholder="Sobre o que é este canal?"
                rows={2}
                className="border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0 text-sm resize-none"
              />
            </div>
          </div>

          {/* Tipo */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tipo</Label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: "public" as const, label: "Público", icon: Hash },
                { value: "private" as const, label: "Privado", icon: Lock },
                { value: "dm" as const, label: "DM", icon: MessageCircle },
              ]).map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setType(opt.value)}
                  className={`flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl border text-sm font-medium transition-all ${
                    type === opt.value
                      ? "border-primary/50 bg-primary/10 text-primary shadow-sm shadow-primary/10"
                      : "border-border/30 bg-secondary/20 text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
                  }`}
                >
                  <opt.icon className="h-3.5 w-3.5" />
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Pessoas */}
          {people.length > 0 && (
            <div className="space-y-2">
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Pessoas no canal</Label>
              <div className="grid grid-cols-2 gap-2">
                {people.map((person) => {
                  const selected = members.includes(person.id);
                  return (
                    <button
                      key={person.id}
                      onClick={() => toggleMember(person.id)}
                      className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-all text-left ${
                        selected
                          ? "border-primary/40 bg-primary/10 text-foreground"
                          : "border-border/20 bg-secondary/15 text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                      }`}
                    >
                      <div className={`h-6 w-6 rounded-full shrink-0 overflow-hidden flex items-center justify-center ${
                        selected ? "ring-2 ring-primary/30" : ""
                      } bg-gradient-to-br from-primary/40 to-primary/10`}>
                        {person.avatar_url ? (
                          <img src={person.avatar_url} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="text-[10px] font-bold text-foreground">{(person.full_name || person.email).charAt(0).toUpperCase()}</span>
                        )}
                      </div>
                      <span className="truncate text-xs">{person.full_name || person.email}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Super agentes */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Super agentes no canal</Label>
            <div className="grid grid-cols-2 gap-2">
              {sortedAgents.map((agent) => {
                const agentId = agent.id;
                const selected = agents.includes(agentId);
                return (
                  <button
                    key={agentId}
                    onClick={() => toggleAgent(agentId)}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-all text-left ${
                      selected
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border/20 bg-secondary/15 text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                    }`}
                  >
                    <div className={`h-6 w-6 rounded-full shrink-0 flex items-center justify-center ${
                      selected ? "ring-2 ring-primary/30 bg-gradient-to-br from-primary/60 to-primary/20" : "bg-secondary/40"
                    }`}>
                      <AgentIcon agentId={agentId} className="h-3 w-3" />
                    </div>
                    <span className="text-xs">{agent.name || getAgentDisplayName(agentId)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Submit */}
          <button
            onClick={handleCreate}
            disabled={!name.trim() || creating}
            className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Criando...
              </>
            ) : (
              "Criar Canal"
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
