import { api } from "@/lib/api";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  PauseCircle,
  PlayCircle,
  Clock,
  Trash2,
  Pause,
  ListChecks,
} from "lucide-react";
import { useAgentTasks, type AgentTask, type TaskChunk } from "@/hooks/use-agent-tasks";
import { useAgents } from "@/hooks/use-agents";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { TaskDetailsDialog } from "./TaskDetailsDialog";


function relTime(iso: string) {
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
  running: {
    label: "Rodando",
    color: "text-success",
    ring: "border-success/40 bg-success/5",
    icon: PlayCircle,
  },
  checkpoint: {
    label: "Em checkpoint",
    color: "text-warning",
    ring: "border-warning/40 bg-warning/5",
    icon: PauseCircle,
  },
  done: {
    label: "Concluída",
    color: "text-success",
    ring: "border-success/40 bg-success/10",
    icon: CheckCircle2,
  },
  failed: {
    label: "Falhou",
    color: "text-destructive",
    ring: "border-destructive/40 bg-destructive/5",
    icon: AlertTriangle,
  },
};

const chunkStatusColor: Record<TaskChunk["status"], string> = {
  done: "bg-success text-success-foreground",
  running: "bg-primary text-primary-foreground animate-pulse",
  pending: "bg-muted text-muted-foreground",
  failed: "bg-destructive text-destructive-foreground",
};

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/40">
      <div
        className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          background: "linear-gradient(90deg, #3D61FF 0%, #6B8AFF 100%)",
          boxShadow: "0 0 12px rgba(61,97,255,0.5)",
        }}
      />
    </div>
  );
}

function TaskCard({
  task,
  agentName,
  onOpen,
  onDelete,
  busy,
}: {
  task: AgentTask;
  agentName: string;
  onOpen: () => void;
  onDelete: () => void;
  busy: boolean;
}) {
  const meta = statusMeta[task.status];
  const Icon = meta.icon;
  const total = task.chunks.length || 1;
  const doneCount = task.chunks.filter((c) => c.status === "done").length;
  const pct = (doneCount / total) * 100;
  const canDiscard = task.status === "checkpoint" || task.status === "failed";

  return (
    <div
      className={cn(
        "group relative rounded-2xl border p-4 glass-card cursor-pointer transition-all hover:border-primary/40",
        meta.ring,
      )}
      onClick={onOpen}
    >
      <div className="mb-2 flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", meta.color)} />
        <span className="truncate text-xs font-mono uppercase tracking-wider text-muted-foreground">
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
        {canDiscard && (
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            aria-label="Descartar task"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`Descartar a task "${task.title}"?`)) {
                onDelete();
              }
            }}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
          </Button>
        )}
      </div>

      <h3 className="font-display text-sm font-semibold text-foreground line-clamp-2 mb-3">
        {task.title}
      </h3>

      <div className="space-y-2">
        <ProgressBar value={pct} />
        <div className="flex items-center justify-between text-[11px] font-mono text-muted-foreground">
          <span>
            {doneCount}/{total} chunks
          </span>
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {relTime(task.updated_at || task.created_at)}
          </span>
        </div>
      </div>

      {task.chunks.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1">
          {task.chunks.map((chunk) => (
            <div
              key={chunk.id}
              title={`${chunk.label} · ${chunk.status}`}
              className={cn(
                "flex h-5 min-w-5 items-center justify-center rounded px-1.5 text-[10px] font-mono",
                chunkStatusColor[chunk.status],
              )}
            >
              {chunk.id}
            </div>
          ))}
        </div>
      )}

      {task.status === "failed" && task.checkpoint_data?.notes && (
        <p className="mt-2 text-[11px] text-destructive/90 line-clamp-2">
          {task.checkpoint_data.notes}
        </p>
      )}
    </div>
  );
}


export default function TaskLoopPanel() {
  const { data: tasks = [], isLoading, refetch, isFetching } = useAgentTasks();
  const { agents } = useAgents();
  const navigate = useNavigate();
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [tab, setTab] = useState<"active" | "history">("active");
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);


  const setBusy = (id: string, on: boolean) =>
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  /** A edge recebia a ação no corpo; o backend expõe uma rota por ação. */
  const invokeAgentTask = async (body: Record<string, unknown>) => {
    const { action, task_id: id, ...resto } = body as any;
    try {
      if (action === "delete") {
        await api(`/tarefas/${id}`, { method: "DELETE" });
      } else {
        await api(`/tarefas/${id}/${action}`, { method: "POST", body: resto });
      }
      return { error: null };
    } catch (e: any) {
      return { error: e };
    }
  };

  const handleDelete = async (task: AgentTask) => {
    setBusy(task.id, true);
    try {
      const { error } = await invokeAgentTask({ action: "delete", task_id: task.id });
      if (error) throw error;
      toast.success("Task excluída");
      await refetch();
    } catch (e) {
      toast.error(`Falha ao excluir: ${(e as Error).message}`);
    } finally {
      setBusy(task.id, false);
    }
  };

  const handlePause = async (task: AgentTask) => {
    setBusy(task.id, true);
    try {
      const { error } = await invokeAgentTask({
        action: "pause",
        task_id: task.id,
        notes: "Pausada pelo usuário via painel",
      });
      if (error) throw error;
      toast.success("Task pausada em checkpoint");
      await refetch();
    } catch (e) {
      toast.error(`Falha ao pausar: ${(e as Error).message}`);
    } finally {
      setBusy(task.id, false);
    }
  };

  const agentNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of agents) m.set(a.id, a.name);
    return m;
  }, [agents]);

  const nameOf = (id: string) => agentNameById.get(id) ?? id;

  const activeAgentIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) s.add(t.agent_id);
    return Array.from(s);
  }, [tasks]);

  const now = Date.now();
  const active = tasks.filter(
    (t) => t.status === "running" || t.status === "checkpoint" || t.status === "failed",
  );
  const history = tasks.filter(
    (t) =>
      t.status === "done" &&
      t.completed_at &&
      now - new Date(t.completed_at).getTime() < 24 * 60 * 60 * 1000,
  );

  const filterList = (list: AgentTask[]) =>
    (agentFilter === "all" ? list : list.filter((t) => t.agent_id === agentFilter))
      .slice()
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      .slice(0, 10);

  const visible = filterList(tab === "active" ? active : history);

  const openChat = (agentId: string) =>
    navigate(`/chat?agent=${encodeURIComponent(agentId)}`);

  return (
    <div className="glass-card-glow overflow-hidden rounded-2xl">
      <div className="glass-card-glow-effect" />
      <div className="relative z-10">
        <div className="aurora-glow flex flex-wrap items-center gap-3 border-b border-border/50 px-5 py-4">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)]">
            <ListChecks className="h-4 w-4 text-primary-foreground" />
          </div>
          <div>
            <h2 className="font-display text-base font-semibold text-foreground">
              Tasks em Andamento
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Loop Architecture · tarefas autônomas dos agentes
            </p>
          </div>
          <span className="ml-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-mono text-primary">
            {active.length}
          </span>

          <div className="ml-auto flex items-center gap-2">
            <div className="flex rounded-lg border border-border/50 bg-card/40 p-0.5">
              <button
                onClick={() => setTab("active")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-mono uppercase transition-colors",
                  tab === "active"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Ativas
              </button>
              <button
                onClick={() => setTab("history")}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[11px] font-mono uppercase transition-colors",
                  tab === "history"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                Concluídas
              </button>
            </div>

            {activeAgentIds.length > 0 && (
              <select
                value={agentFilter}
                onChange={(e) => setAgentFilter(e.target.value)}
                className="rounded-lg border border-border/50 bg-card/40 px-2 py-1 text-[11px] font-mono text-foreground outline-none focus:border-primary/60"
              >
                <option value="all">Todos os agentes</option>
                {activeAgentIds.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            )}

            <Button
              size="icon"
              variant="ghost"
              onClick={() => refetch()}
              className="h-7 w-7"
              aria-label="Atualizar"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </Button>
          </div>
        </div>

        <div className="p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : visible.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <ListChecks className="h-6 w-6 text-muted-foreground/60" />
              <p className="text-xs text-muted-foreground">
                {tab === "active"
                  ? "Nenhuma task em andamento no momento."
                  : "Nenhuma task concluída nas últimas 24h."}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visible.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  agentName={nameOf(task.agent_id)}
                  onOpen={() => setSelectedTaskId(task.id)}
                  onDelete={() => handleDelete(task)}
                  busy={busyIds.has(task.id)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <TaskDetailsDialog
        task={tasks.find((t) => t.id === selectedTaskId) ?? null}
        agentName={
          selectedTaskId
            ? nameOf(tasks.find((t) => t.id === selectedTaskId)?.agent_id ?? "")
            : ""
        }
        open={!!selectedTaskId}
        onOpenChange={(open) => !open && setSelectedTaskId(null)}
        onPause={async (t) => {
          await handlePause(t);
        }}
        onDelete={async (t) => {
          await handleDelete(t);
          setSelectedTaskId(null);
        }}
        busy={selectedTaskId ? busyIds.has(selectedTaskId) : false}
      />

    </div>
  );
}
