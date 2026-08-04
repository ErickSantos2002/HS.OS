import React, { useState, useEffect, useRef, useCallback } from "react";
import { Check, Loader2, Search, FileText, Brain, Sparkles, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

/* ── Activity event system ── */

export const CHAT_ACTIVITY_EVENT = "chat-activity-update";

export interface ActivityItem {
  id: string;
  type: "thinking" | "tool_use" | "search" | "read_file" | "generating" | "executing" | "calling" | "preview";
  description: string;
  status: "running" | "done";
  timestamp: number;
}

export interface ChatActivityDetail {
  agentId: string;
  activity: ActivityItem;
}

export function emitActivity(agentId: string, activity: ActivityItem) {
  window.dispatchEvent(
    new CustomEvent<ChatActivityDetail>(CHAT_ACTIVITY_EVENT, {
      detail: { agentId, activity },
    })
  );
}

/* ── Global store ── */

interface StoredState {
  activities: ActivityItem[];
  hadRealActivity: boolean;
  startedAt: number;
}

const activityStore = new Map<string, StoredState>();

/* ── Icon map ── */

const activityIcon: Record<ActivityItem["type"], React.ElementType> = {
  thinking: Brain,
  tool_use: Zap,
  search: Search,
  read_file: FileText,
  generating: Sparkles,
  executing: Zap,
  calling: Zap,
  preview: Loader2,
};

const shortLabel: Record<ActivityItem["type"], string> = {
  thinking: "Pensando",
  tool_use: "Executando",
  search: "Buscando na web",
  read_file: "Lendo arquivos",
  generating: "Gerando",
  executing: "Executando código",
  calling: "Chamando API",
  preview: "Processando",
};

/* ── Shimmer Bar ── */

function ShimmerBar({ finishing }: { finishing: boolean }) {
  return (
    <div className="w-full h-[3px] rounded-full overflow-hidden bg-border/30 relative">
      <div
        className={cn(
          "absolute inset-y-0 w-1/3 rounded-full",
          "bg-gradient-to-r from-transparent via-primary to-transparent",
          finishing ? "animate-shimmer-fast" : "animate-shimmer"
        )}
      />
    </div>
  );
}

/* ── Activity Chip ── */

function ActivityChip({ item }: { item: ActivityItem }) {
  const Icon = activityIcon[item.type] ?? Zap;
  const isDone = item.status === "done";
  const label = item.type === "preview" ? (item.description || "Processando...") : (shortLabel[item.type] ?? item.description);

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium",
        "animate-in fade-in slide-in-from-left-2 duration-300",
        isDone
          ? "bg-secondary/40 text-muted-foreground"
          : "bg-primary/15 text-primary"
      )}
    >
      {isDone ? (
        <Check className="h-3 w-3 text-success shrink-0" />
      ) : (
        <Icon className="h-3 w-3 shrink-0 animate-pulse" />
      )}
      {label}
      {!isDone && (
        <Loader2 className="h-2.5 w-2.5 animate-spin opacity-60 shrink-0" />
      )}
    </span>
  );
}

/* ── Fallback phases ── */

const FALLBACK_PHASES = [
  { delay: 0, type: "thinking" as const },
  { delay: 2500, type: "search" as const },
  { delay: 6000, type: "read_file" as const },
  { delay: 10000, type: "generating" as const },
];

function buildFallbackActivities(elapsed: number): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (let i = 0; i < FALLBACK_PHASES.length; i++) {
    const phase = FALLBACK_PHASES[i];
    if (elapsed < phase.delay) break;
    const nextDelay = FALLBACK_PHASES[i + 1]?.delay ?? Infinity;
    const isRunning = elapsed < nextDelay;
    items.push({
      id: `fallback-${i}`,
      type: phase.type,
      description: shortLabel[phase.type],
      status: isRunning ? "running" : "done",
      timestamp: 0,
    });
  }
  return items;
}

/* ── Main component ── */

interface StreamingActivityIndicatorProps {
  agentId: string;
  isWorking: boolean;
  hasStreamingText: boolean;
}

export default React.memo(function StreamingActivityIndicator({
  agentId,
  isWorking,
  hasStreamingText,
}: StreamingActivityIndicatorProps) {
  const [activities, setActivities] = useState<ActivityItem[]>(() => {
    const stored = activityStore.get(agentId);
    return stored ? stored.activities : [];
  });
  const hadRealActivityRef = useRef(
    activityStore.get(agentId)?.hadRealActivity ?? false
  );
  const startedAtRef = useRef(
    activityStore.get(agentId)?.startedAt ?? Date.now()
  );

  // Sync state to global store
  const syncStore = useCallback(
    (acts: ActivityItem[], hadReal: boolean) => {
      activityStore.set(agentId, {
        activities: acts,
        hadRealActivity: hadReal,
        startedAt: startedAtRef.current,
      });
    },
    [agentId]
  );

  // Listen for real activity events
  useEffect(() => {
    if (!isWorking) return;

    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ChatActivityDetail>).detail;
      if (detail.agentId !== agentId) return;

      hadRealActivityRef.current = true;
      setActivities((prev) => {
        const existing = prev.findIndex((a) => a.id === detail.activity.id);
        let next: ActivityItem[];
        if (existing >= 0) {
          const copy = [...prev];
          copy[existing] = detail.activity;
          next = copy;
        } else {
          next = [...prev, detail.activity].slice(-8);
        }
        syncStore(next, true);
        return next;
      });
    };

    window.addEventListener(CHAT_ACTIVITY_EVENT, handler);
    return () => window.removeEventListener(CHAT_ACTIVITY_EVENT, handler);
  }, [agentId, isWorking, syncStore]);

  // Fallback phases — restore from elapsed time or start fresh
  useEffect(() => {
    if (!isWorking) {
      setActivities([]);
      hadRealActivityRef.current = false;
      activityStore.delete(agentId);
      return;
    }

    // Always reset when starting a new interaction
    hadRealActivityRef.current = false;
    startedAtRef.current = Date.now();
    setActivities([]);
    syncStore([], false);

    // Schedule fallback phases from scratch
    const timers: ReturnType<typeof setTimeout>[] = [];

    const tick = () => {
      if (hadRealActivityRef.current) return;
      const elapsed = Date.now() - startedAtRef.current;
      const fallback = buildFallbackActivities(elapsed);
      setActivities(fallback);
      syncStore(fallback, false);
    };

    // Immediate tick
    tick();

    // Schedule future phase transitions
    FALLBACK_PHASES.forEach((phase) => {
      if (phase.delay > 0) {
        timers.push(setTimeout(tick, phase.delay + 50));
      }
    });

    return () => timers.forEach(clearTimeout);
  }, [isWorking, agentId, syncStore]);

  // When streaming text starts, mark all as done and show "Escrevendo"
  useEffect(() => {
    if (hasStreamingText && isWorking) {
      setActivities((prev) => {
        const allDone = prev.map((a) =>
          a.status === "running" ? { ...a, status: "done" as const } : a
        );
        const hasWriting = allDone.some((a) => a.id === "writing");
        const next = hasWriting
          ? allDone
          : [
              ...allDone,
              {
                id: "writing",
                type: "generating" as const,
                description: "Escrevendo...",
                status: "running" as const,
                timestamp: Date.now(),
              },
            ];
        syncStore(next, hadRealActivityRef.current);
        return next;
      });
    }
  }, [hasStreamingText, isWorking, syncStore]);

  if (!isWorking) return null;

  return (
    <div className="flex flex-col gap-2 pl-11 md:pl-12 mt-3 mb-1">
      <ShimmerBar finishing={hasStreamingText} />

      {activities.length > 0 && (
        <div className="flex flex-row flex-wrap gap-1.5 items-center">
          {activities.map((item) => (
            <ActivityChip key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
});
