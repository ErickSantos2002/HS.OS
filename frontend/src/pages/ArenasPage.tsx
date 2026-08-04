import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { loadArenas, deleteArena, type Arena } from "@/lib/arena-store";
import { Plus, Trash2, Swords, ArrowRight, Settings, Mic, MessageSquare } from "lucide-react";
import EditArenaDialog from "@/components/arena/EditArenaDialog";
import { supabase } from "@/integrations/supabase/client";
import type { ArenaAgentRole } from "@/hooks/use-arena-agents";

export default function ArenasPage() {
  const navigate = useNavigate();
  const [arenas, setArenas] = useState<Arena[]>([]);
  const [editing, setEditing] = useState<Arena | null>(null);
  const [editingAgents, setEditingAgents] = useState<ArenaAgentRole[]>([]);

  const refresh = () => loadArenas().then(setArenas);

  useEffect(() => {
    refresh();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    const ok = window.confirm(
      `Excluir a arena "${name}"?\n\nTodas as sessões e mensagens serão apagadas em cascata.`,
    );
    if (!ok) return;
    const { error } = await deleteArena(id);
    if (error) {
      toast.error(`Erro ao excluir arena: ${error.message}`);
      return;
    }
    toast.success("Arena excluída.");
    setArenas((prev) => prev.filter((a) => a.id !== id));
  };

  const handleOpenEdit = async (arena: Arena) => {
    const { data, error } = await supabase
      .from("arena_agents")
      .select("*")
      .eq("arena_id", arena.id);
    if (error) {
      toast.error(`Erro ao carregar agentes: ${error.message}`);
      return;
    }
    setEditingAgents((data ?? []) as ArenaAgentRole[]);
    setEditing(arena);
  };

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Aurora header */}
      <div className="aurora-glow rounded-2xl px-5 py-4">
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-lg shadow-primary/20">
              <Swords className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-foreground">Arenas</h1>
              <p className="text-[11px] text-muted-foreground">Ambientes colaborativos gerados por IA</p>
            </div>
          </div>
          <button
            onClick={() => navigate("/arenas/new")}
            className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
          >
            <Plus className="h-4 w-4" />
            Nova Arena
          </button>
        </div>
      </div>

      {arenas.length === 0 ? (
        <div className="glass-card-glow glow-accent rounded-2xl">
          <div className="glass-card-glow-effect" />
          <div className="relative z-10 p-12 flex flex-col items-center justify-center text-center">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-primary/20 to-[hsl(260,70%,55%)]/20 flex items-center justify-center mb-4">
              <Swords className="h-7 w-7 text-primary" />
            </div>
            <h2 className="text-lg font-display font-semibold text-foreground mb-2">
              Nenhuma Arena criada
            </h2>
            <p className="text-sm text-muted-foreground max-w-md mb-6">
              Descreva o que você precisa e o orquestrador criará uma Arena com agentes especializados.
            </p>
            <button
              onClick={() => navigate("/arenas/new")}
              className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
            >
              <Plus className="h-4 w-4" />
              Criar primeira Arena
            </button>
          </div>
        </div>
      ) : (
        <div className="grid gap-3">
          {arenas.map((arena) => (
            <div
              key={arena.id}
              className="glass-card rounded-2xl p-4 flex items-center justify-between group hover:border-primary/30 transition-all cursor-pointer"
              onClick={() => navigate(`/arenas/${arena.id}`)}
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/20 to-[hsl(260,70%,55%)]/20 flex items-center justify-center shrink-0">
                  <Swords className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    {arena.convaiAgentId ? (
                      <Mic className="h-3.5 w-3.5 text-primary shrink-0" aria-label="Arena de áudio">
                        <title>Arena de áudio</title>
                      </Mic>
                    ) : (
                      <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-label="Arena de chat">
                        <title>Arena de chat</title>
                      </MessageSquare>
                    )}
                    <h3 className="text-sm font-display font-semibold text-foreground truncate">
                      {arena.name}
                    </h3>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {arena.description}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">


                    {arena.agents.map((a) => (
                      <span
                        key={a.id}
                        className="px-1.5 py-0.5 text-[10px] font-mono rounded-lg bg-primary/10 text-primary border border-primary/30"
                      >
                        {a.name}
                      </span>
                    ))}
                    <span className="text-[10px] text-muted-foreground/50 font-mono">
                      {new Date(arena.createdAt).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleOpenEdit(arena);
                  }}
                  className="p-2 rounded-xl text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Editar arena"
                  title="Editar configurações"
                >
                  <Settings className="h-4 w-4" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(arena.id, arena.name);
                  }}
                  className="p-2 rounded-xl text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                  aria-label="Excluir arena"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditArenaDialog
          arena={editing}
          agents={editingAgents}
          open={!!editing}
          onOpenChange={(v) => { if (!v) setEditing(null); }}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
