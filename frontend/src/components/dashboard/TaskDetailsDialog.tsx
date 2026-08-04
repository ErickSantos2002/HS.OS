import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Pause,
  PauseCircle,
  PlayCircle,
  Trash2,
  StickyNote,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentTask, TaskChunk } from "@/hooks/use-agent-tasks";

function relTime(iso?: string | null) {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return "agora";
  if (m < 60) return `há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h} h`;
  return `há ${Math.floor(h / 24)} d`;
}

const statusMeta: Record<
  AgentTask["status"],
  { label: string; color: string; ring: string; icon: typeof PlayCircle }
> = {
  running: { label: "Rodando", color: "text-success", ring: "border-success/40 bg-success/5", icon: PlayCircle },
  checkpoint: { label: "Em checkpoint", color: "text-warning", ring: "border-warning/40 bg-warning/5", icon: PauseCircle },
  done: { label: "Concluída", color: "text-success", ring: "border-success/40 bg-success/10", icon: CheckCircle2 },
  failed: { label: "Falhou", color: "text-destructive", ring: "border-destructive/40 bg-destructive/5", icon: AlertTriangle },
};

const chunkStatusColor: Record<TaskChunk["status"], string> = {
  done: "bg-success text-success-foreground",
  running: "bg-primary text-primary-foreground animate-pulse",
  pending: "bg-muted text-muted-foreground",
  failed: "bg-destructive text-destructive-foreground",
};

export function TaskDetailsDialog({
  task,
  agentName,
  open,
  onOpenChange,
  onPause,
  onDelete,
  busy,
}: {
  task: AgentTask | null;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPause?: (task: AgentTask) => void;
  onDelete?: (task: AgentTask) => void;
  busy?: boolean;
}) {
  const navigate = useNavigate();
  if (!task) return null;

  const meta = statusMeta[task.status];
  const Icon = meta.icon;
  const total = task.chunks.length || 1;
  const doneCount = task.chunks.filter((c) => c.status === "done").length;
  const pct = Math.round((doneCount / total) * 100);
  const currentChunkId = task.checkpoint_data?.currentChunk;
  const notes = task.checkpoint_data?.notes;

  const openChat = () => {
    navigate(`/chat?agent=${encodeURIComponent(task.agent_id)}`);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Icon className={cn("h-4 w-4", meta.color)} />
            <span className="text-xs font-mono uppercase tracking-wider text-muted-foreground">
              {agentName}
            </span>
            <span
              className={cn(
                "ml-auto rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider",
                meta.color,
                meta.ring,
              )}
            >
              {meta.label}
            </span>
          </div>
          <DialogTitle className="font-display text-lg leading-tight">
            {task.title}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-3 text-[11px] font-mono">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              atualizada {relTime(task.updated_at)}
            </span>
            <span>criada {relTime(task.created_at)}</span>
            <span className="font-mono opacity-70">ID: {task.id.slice(0, 8)}…</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Progresso */}
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-mono text-muted-foreground">
              <span>Progresso</span>
              <span>
                {doneCount}/{total} chunks · {pct}%
              </span>
            </div>
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
              <div
                className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  background: "linear-gradient(90deg, #3D61FF 0%, #6B8AFF 100%)",
                  boxShadow: "0 0 12px rgba(61,97,255,0.5)",
                }}
              />
            </div>
          </div>

          {/* Chunks */}
          {task.chunks.length > 0 && (
            <div>
              <div className="mb-2 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                Chunks
              </div>
              <ul className="space-y-1.5">
                {task.chunks.map((chunk) => {
                  const isCurrent = currentChunkId === chunk.id;
                  return (
                    <li
                      key={chunk.id}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border border-border/40 bg-card/40 px-2.5 py-1.5",
                        isCurrent && "border-primary/50 bg-primary/5",
                      )}
                    >
                      <span
                        className={cn(
                          "flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-[10px] font-mono",
                          chunkStatusColor[chunk.status],
                        )}
                      >
                        {chunk.id}
                      </span>
                      <span className="flex-1 truncate text-xs text-foreground">
                        {chunk.label}
                      </span>
                      <span className="text-[10px] font-mono uppercase text-muted-foreground">
                        {chunk.status}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Notas de checkpoint */}
          {notes && (
            <div className="rounded-lg border border-border/40 bg-card/40 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-wider text-muted-foreground">
                <StickyNote className="h-3 w-3" />
                Checkpoint
              </div>
              <p className="whitespace-pre-wrap text-xs text-foreground/90">{notes}</p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row flex-wrap justify-between gap-2 sm:justify-between">
          <div className="flex items-center gap-1.5">
            {onPause && task.status === "running" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPause(task)}
                disabled={busy}
                className="text-warning hover:bg-warning/15 hover:text-warning"
              >
                <Pause className="mr-1.5 h-3.5 w-3.5" />
                Pausar
              </Button>
            )}
            {onDelete && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="text-destructive hover:bg-destructive/15 hover:text-destructive"
                  >
                    {busy ? (
                      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                    )}
                    Excluir
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Excluir task?</AlertDialogTitle>
                    <AlertDialogDescription>
                      "{task.title}" será removida permanentemente. Esta ação não pode ser desfeita.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => onDelete(task)}
                      className="bg-destructive hover:bg-destructive/90"
                    >
                      Excluir
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
          <Button size="sm" onClick={openChat}>
            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
            Abrir chat do agente
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
