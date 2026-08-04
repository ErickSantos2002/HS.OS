import { useState, useRef, useEffect } from "react";
import { Code, Eye, FileCode, Layers, Trash2, Check, X, Pencil, Radio } from "lucide-react";
import { type ConversationArtifact, type ArtifactType } from "@/lib/artifact-extractor";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";

function getRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (diffDays === 1) return "Ontem";
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
}

const TYPE_ICON: Record<ArtifactType, typeof Code> = {
  html: FileCode,
  svg: Eye,
  jsx: Code,
  react: Code,
};

interface ArtifactsListProps {
  artifacts: ConversationArtifact[];
  onSelect: (artifact: { type: ArtifactType; code: string }) => void;
  onOpenLive?: (id: string) => void;
  onDelete?: (messageId: string) => void;
  onRename?: (messageId: string, newTitle: string) => void;
}

export default function ArtifactsList({ artifacts, onSelect, onOpenLive, onDelete, onRename }: ArtifactsListProps) {
  if (artifacts.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="relative inline-flex items-center gap-1 rounded-full border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground transition-colors"
          title="Artefatos da conversa"
        >
          <Layers className="h-3.5 w-3.5" />
          <span className="font-medium">{artifacts.length}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] max-w-[95vw] p-0">
        <div className="px-3 py-2 border-b border-border/30">
          <h4 className="text-xs font-semibold text-foreground">
            {artifacts.length} {artifacts.length === 1 ? "artefato" : "artefatos"}
          </h4>
        </div>
        <ScrollArea className="h-72 w-full">
          <div className="p-1.5 space-y-0.5">
            {artifacts.map((art, idx) => (
              <ArtifactRow
                key={`${art.messageId || idx}-${idx}`}
                art={art}
                onSelect={onSelect}
                onOpenLive={onOpenLive}
                onDelete={onDelete}
                onRename={onRename}
              />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

interface ArtifactRowProps {
  art: ConversationArtifact;
  onSelect: (artifact: { type: ArtifactType; code: string }) => void;
  onOpenLive?: (id: string) => void;
  onDelete?: (messageId: string) => void;
  onRename?: (messageId: string, newTitle: string) => void;
}

function ArtifactRow({ art, onSelect, onOpenLive, onDelete, onRename }: ArtifactRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(art.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const isLive = !!art.live && !!art.liveId;
  const Icon = isLive ? Radio : (TYPE_ICON[art.type] ?? Code);
  const canRename = !!onRename && !!art.messageId;
  const handleActivate = () => {
    if (isLive && onOpenLive && art.liveId) onOpenLive(art.liveId);
    else onSelect({ type: art.type, code: art.code });
  };

  const startEditing = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDraft(art.title);
    setEditing(true);
  };

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== art.title && canRename) {
      await onRename(art.messageId, trimmed);
    }
    setEditing(false);
  };

  const cancel = () => {
    setDraft(art.title);
    setEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") cancel();
  };

  return (
    <div className="w-full flex items-center gap-1 rounded-lg px-2.5 py-2 text-left hover:bg-secondary/60 transition-colors group">
      <div
        role="button"
        tabIndex={0}
        className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
        onClick={handleActivate}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleActivate(); }}
      >
        <div className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${isLive ? "bg-emerald-500/15 text-emerald-500" : "bg-primary/10 text-primary"}`}>
          <Icon className="h-3.5 w-3.5" />
          {isLive && (art.liveInterval ?? 0) > 0 && (
            <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-background" />
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={commit}
                onClick={(e) => e.stopPropagation()}
                className="min-w-0 flex-1 text-xs bg-transparent border-b border-primary/50 outline-none text-foreground placeholder:text-muted-foreground/50"
              />
              <button
                onClick={(e) => { e.stopPropagation(); commit(); }}
                className="shrink-0 p-1 rounded-md text-success hover:bg-success/10 transition-colors"
                title="Salvar"
              >
                <Check className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); cancel(); }}
                className="shrink-0 p-1 rounded-md text-muted-foreground hover:bg-muted transition-colors"
                title="Cancelar"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-1 min-w-0">
              <p className="truncate text-xs font-medium text-foreground group-hover:text-foreground">
                {art.title}
              </p>
              {isLive && (
                <span className="shrink-0 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-500">
                  Ao vivo
                </span>
              )}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground">
            {isLive
              ? `Vivo · ${(art.liveInterval ?? 0) > 0 ? `atualiza ${art.liveInterval}s` : "manual"} · ${getRelativeTime(art.createdAt)}`
              : `${art.type.toUpperCase()} · ${getRelativeTime(art.createdAt)}`}
          </p>
        </div>
      </div>
      {canRename && !editing && (
        <button
          onClick={startEditing}
          className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-all"
          title="Renomear"
        >
          <Pencil className="h-4 w-4" />
        </button>
      )}
      {onDelete && !editing && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(art.messageId); }}
          className="shrink-0 p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
          title="Remover artefato"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
