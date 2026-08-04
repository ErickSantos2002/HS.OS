import React, { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Check, Loader2, Circle, Clock, ChevronDown, ChevronUp } from "lucide-react";
import { setAgentActivityVisible } from "@/lib/agent-activity-visibility";
import {
  useAgentActivitiesFeed,
  type AgentActivity,
  type AgentActivityStep as Step,
} from "@/hooks/use-agent-activities";

export type { AgentActivity } from "@/hooks/use-agent-activities";

interface AgentActivityCardProps {
  agentId: string;
  userId?: string | null;
  agentName?: string;
  className?: string;
  /** Force aggregate to "done" — used for sealed history cards. */
  forceIdle?: boolean;
  /** Parent turn still in progress — keeps aggregate "running". */
  taskActive?: boolean;
  maxHistory?: number;
}

const DONE_STATUSES = new Set(["done", "completed", "finished", "success"]);
const RUNNING_STATUSES = new Set(["running", "in_progress", "pending", "working"]);

const EMOJI_RE =
  /(\p{Extended_Pictographic}|\p{Emoji_Presentation}|\uFE0F|\u200D|[\u{1F1E6}-\u{1F1FF}])/gu;
function stripEmoji(text: string | undefined | null): string {
  if (!text) return "";
  return text.replace(EMOJI_RE, "").replace(/\s{2,}/g, " ").trim();
}

function normalizeStatus(status: string): "running" | "done" | "pending" {
  const s = status?.toLowerCase() || "pending";
  if (DONE_STATUSES.has(s)) return "done";
  if (RUNNING_STATUSES.has(s)) return "running";
  return "pending";
}

function relativeTime(iso: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diff < 5) return "agora";
  if (diff < 60) return `há ${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `há ${m}min`;
  return `há ${Math.floor(m / 60)}h`;
}

function StepIcon({ status }: { status: string }) {
  const s = normalizeStatus(status);
  if (s === "done") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-500">
        <Check className="h-2.5 w-2.5" />
      </span>
    );
  }
  if (s === "running") {
    return (
      <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
      </span>
    );
  }
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-muted text-muted-foreground">
      <Circle className="h-2 w-2" />
    </span>
  );
}

function labelStatus(status: string): string {
  const s = status?.toLowerCase() || "";
  if (DONE_STATUSES.has(s)) return "Concluído";
  if (RUNNING_STATUSES.has(s)) return "Processando";
  return "Pendente";
}

function ActivityStatusBadge({ status }: { status: string }) {
  const s = normalizeStatus(status);
  const label = labelStatus(status);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        s === "running" && "border-primary/40 bg-primary/10 text-primary",
        s === "done" && "border-emerald-500/40 bg-emerald-500/10 text-emerald-500",
        s === "pending" && "border-muted-foreground/30 bg-muted/30 text-muted-foreground"
      )}
    >
      {s === "running" && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
      {s === "done" && <Check className="h-2.5 w-2.5" />}
      {s === "pending" && <Clock className="h-2.5 w-2.5" />}
      {label}
    </span>
  );
}

function currentStep(steps: Step[]): Step | null {
  if (!steps.length) return null;
  const running = steps.find((s) => normalizeStatus(s.status) === "running");
  if (running) return running;
  const lastDone = [...steps].reverse().find((s) => normalizeStatus(s.status) === "done");
  if (lastDone) return lastDone;
  return steps[0];
}

/* ── Presentational bucket card ────────────────────────────────────────── */

export interface AgentActivityBucketCardProps {
  activities: AgentActivity[];
  agentId: string;
  agentName?: string;
  /** Force aggregate to "done" regardless of raw statuses. */
  forceIdle?: boolean;
  /** Keeps aggregate as "running" even if all rows report done. */
  taskActive?: boolean;
  /** Start the card collapsed. History cards default to closed. */
  initialCollapsed?: boolean;
  className?: string;
}

export const AgentActivityBucketCard = React.memo(function AgentActivityBucketCard({
  activities,
  agentId,
  agentName,
  forceIdle = false,
  taskActive = false,
  initialCollapsed = true,
  className,
}: AgentActivityBucketCardProps) {
  const anyRowRunning = activities.some(
    (a) => normalizeStatus(a.status) === "running"
  );
  const aggregateRunning = !forceIdle && (taskActive || anyRowRunning);
  const aggregateStatus = aggregateRunning ? "running" : "done";

  // Default: card stays collapsed. User can expand manually to inspect steps.
  const [collapsed, setCollapsed] = useState(initialCollapsed);


  if (activities.length === 0) return null;

  const lastIndex = activities.length - 1;
  const latest = activities[lastIndex];

  return (
    <div
      className={cn(
        "pl-11 md:pl-12 mt-2 mb-1 animate-in fade-in slide-in-from-top-2 duration-300",
        className
      )}
    >
      <div
        className={cn(
          "relative overflow-hidden rounded-xl border border-border/40 bg-card/50 shadow-[0_0_24px_-12px_hsl(var(--primary)/0.25),inset_0_0_0_1px_hsl(var(--primary)/0.06)] backdrop-blur-xl transition-all",
          aggregateRunning &&
            "shadow-[0_0_32px_-8px_hsl(var(--primary)/0.35),inset_0_0_0_1px_hsl(var(--primary)/0.08)]"
        )}
      >
        {aggregateRunning && (
          <div className="shimmer-bar absolute inset-x-0 top-0 h-[2px] overflow-hidden">
            <div className="h-full w-1/3 bg-gradient-to-r from-transparent via-primary to-transparent animate-shimmer" />
          </div>
        )}

        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="w-full flex items-center gap-2.5 p-3 text-left hover:bg-secondary/20 transition-colors"
          aria-label={collapsed ? "Expandir" : "Recolher"}
        >
          <div className="min-w-0 flex-1 flex items-center gap-2 flex-wrap">
            <ActivityStatusBadge status={aggregateStatus} />
            <span className="text-[10px] text-muted-foreground">
              {activities.length}{" "}
              {activities.length === 1 ? "atividade" : "atividades"}
            </span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {relativeTime(latest.updated_at)}
            </span>
          </div>
          <div className="shrink-0 text-muted-foreground">
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5" />
            )}
          </div>
        </button>

        {!collapsed && (
          <div className="flex flex-col divide-y divide-border/20 border-t border-border/30">
            {activities.map((a, i) => {
              const isLatest = i === lastIndex;
              const cardForceIdle = forceIdle || !isLatest;
              const rawSteps = Array.isArray(a.steps) ? a.steps : [];
              const steps: Step[] = cardForceIdle
                ? rawSteps.map((s) => ({ ...s, status: "done" }))
                : rawSteps;
              // Rows keep their real status; only the aggregate badge reflects
              // "Processando" while the task is active. Completed activities
              // keep their green check to avoid flip-flopping.
              const effectiveStatus = cardForceIdle ? "done" : a.status;
              const step = currentStep(steps);
              const title = stripEmoji(a.title);
              const stepLabel = step ? stripEmoji(step.label) : "";
              return (
                <div key={a.id} className="px-3 py-2 flex items-start gap-2">
                  <div className="mt-0.5">
                    <StepIcon status={effectiveStatus} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-medium text-foreground/90 truncate">
                        {title}
                      </span>
                      <span className="text-[9px] text-muted-foreground uppercase tracking-wide">
                        {a.activity_type}
                      </span>
                      <span className="text-[10px] text-muted-foreground ml-auto">
                        {relativeTime(a.updated_at)}
                      </span>
                    </div>
                    {stepLabel && stepLabel !== title && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground truncate">
                        {stepLabel}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
});

/* ── Self-fetching container (backwards compatible) ────────────────────── */

export default React.memo(function AgentActivityCard({
  agentId,
  userId,
  agentName,
  className,
  forceIdle = false,
  taskActive = false,
  maxHistory = 10,
}: AgentActivityCardProps) {
  const activities = useAgentActivitiesFeed(agentId, userId, maxHistory);

  useEffect(() => {
    setAgentActivityVisible(agentId, activities.length > 0);
    return () => setAgentActivityVisible(agentId, false);
  }, [agentId, activities.length]);

  return (
    <AgentActivityBucketCard
      activities={activities}
      agentId={agentId}
      agentName={agentName}
      forceIdle={forceIdle}
      taskActive={taskActive}
      className={className}
    />
  );
});
