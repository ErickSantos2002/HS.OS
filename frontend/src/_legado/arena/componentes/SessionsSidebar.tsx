import { useState } from "react";
import { Plus, MessageSquare, Pencil, Check, Trash2 } from "lucide-react";
import type { ArenaSession } from "@/hooks/use-arena-sessions";

interface Props {
  sessions: ArenaSession[];
  activeSessionId: string | null;
  onSelect: (id: string) => void;
  onNewSession: (title?: string, inheritContext?: boolean) => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
}

export default function SessionsSidebar({ sessions, activeSessionId, onSelect, onNewSession, onRenameSession, onDeleteSession }: Props) {
  const [showNewModal, setShowNewModal] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [inheritContext, setInheritContext] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");

  const handleCreate = () => {
    onNewSession(newTitle || undefined, inheritContext);
    setNewTitle("");
    setShowNewModal(false);
  };

  const handleRename = (id: string) => {
    if (editTitle.trim()) {
      onRenameSession(id, editTitle.trim());
    }
    setEditingId(null);
  };

  return (
    <div className="flex flex-col h-full bg-secondary/20 border-r border-border/40">
      {/* Header */}
      <div className="shrink-0 px-3 py-3 border-b border-border/40">
        <button
          onClick={() => setShowNewModal(true)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-medium hover:bg-primary/20 transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Nova sessão
        </button>
      </div>

      {/* New session modal */}
      {showNewModal && (
        <div className="shrink-0 px-3 py-3 border-b border-border/40 space-y-2 bg-background/50">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Nome da sessão..."
            className="w-full bg-background border border-border/50 rounded-lg px-3 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-primary"
            autoFocus
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          />
          {sessions.length > 0 && (
            <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={inheritContext}
                onChange={(e) => setInheritContext(e.target.checked)}
                className="rounded border-border"
              />
              Herdar contexto da sessão anterior
            </label>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={handleCreate}
              className="flex-1 px-2 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-medium hover:bg-primary/90"
            >
              Criar
            </button>
            <button
              onClick={() => setShowNewModal(false)}
              className="px-2 py-1.5 rounded-lg border border-border/50 text-[11px] text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto py-1">
        {sessions.length === 0 ? (
          <div className="px-3 py-6 text-center">
            <MessageSquare className="h-5 w-5 text-muted-foreground/40 mx-auto mb-2" />
            <p className="text-[11px] text-muted-foreground/60">Nenhuma sessão</p>
          </div>
        ) : (
          sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => onSelect(s.id)}
              className={`group flex items-center gap-2 px-3 py-2 mx-1 rounded-lg cursor-pointer transition-colors ${
                activeSessionId === s.id
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
              }`}
            >
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
              <div className="flex-1 min-w-0">
                {editingId === s.id ? (
                  <div className="flex items-center gap-1">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleRename(s.id)}
                      onBlur={() => handleRename(s.id)}
                      className="flex-1 bg-background border border-border/50 rounded px-1.5 py-0.5 text-[11px] focus:outline-none"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                    <button onClick={(e) => { e.stopPropagation(); handleRename(s.id); }}>
                      <Check className="h-3 w-3 text-primary" />
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="text-xs font-medium truncate">{s.title}</p>
                    <p className="text-[10px] text-muted-foreground/60">
                      {s.message_count ?? 0} msgs · {new Date(s.created_at).toLocaleDateString("pt-BR")}
                    </p>
                  </>
                )}
              </div>
              {editingId !== s.id && (
                <div className="flex items-center gap-0.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingId(s.id);
                      setEditTitle(s.title);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-secondary/50 transition-opacity"
                    title="Renomear"
                  >
                    <Pencil className="h-3 w-3 text-muted-foreground" />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm(`Excluir a sessão "${s.title}"? Todas as mensagens serão perdidas.`)) {
                        onDeleteSession(s.id);
                      }
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 transition-opacity"
                    title="Excluir sessão"
                  >
                    <Trash2 className="h-3 w-3 text-muted-foreground hover:text-destructive" />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
