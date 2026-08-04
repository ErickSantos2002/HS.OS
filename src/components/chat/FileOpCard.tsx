import { AlertCircle, ArrowRight, CheckCircle2, File, FolderOpen, Loader2, Move, Pencil, Plus, Trash2 } from "lucide-react";
import type { FileOperation } from "@/hooks/useFileSystem";

const CONFIG = {
  read: { icon: File, label: "Lendo" },
  write: { icon: Pencil, label: "Editando" },
  create: { icon: Plus, label: "Criando" },
  list: { icon: FolderOpen, label: "Listando" },
  delete: { icon: Trash2, label: "Apagando" },
  rename: { icon: Pencil, label: "Renomeando" },
  move: { icon: Move, label: "Movendo" },
} as const;

export function FileOpCard({ op }: { op: FileOperation }) {
  const cfg = CONFIG[op.action];
  const Icon = cfg.icon;

  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/60 px-3 py-2 text-xs">
      <Icon className="h-3.5 w-3.5 text-primary shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-muted-foreground">{cfg.label} </span>
        <span className="font-mono text-foreground truncate">{op.path || "/"}</span>
        {op.newPath && (
          <>
            <ArrowRight className="inline h-3 w-3 mx-1 text-muted-foreground" />
            <span className="font-mono text-foreground truncate">{op.newPath}</span>
          </>
        )}
      </div>
      {op.status === "pending" && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      {op.status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
      {op.status === "error" && (
        <span className="flex items-center gap-1 text-destructive" title={op.error}>
          <AlertCircle className="h-3.5 w-3.5" />
        </span>
      )}
    </div>
  );
}
