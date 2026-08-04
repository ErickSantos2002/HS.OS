// Shared agent status utilities — single source of truth for colors, labels, and stale detection

import type { AgentStatus } from "@/hooks/use-agents";

const STALE_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes
const ACTIVE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes
const RECENT_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

/** Derive agent status from last conversation timestamp */
export function statusFromActivity(lastMessageAt: string | null | undefined): AgentStatus | null {
  if (!lastMessageAt) return null;
  const elapsed = Date.now() - new Date(lastMessageAt).getTime();
  if (elapsed < ACTIVE_THRESHOLD_MS) return "active";
  if (elapsed < RECENT_THRESHOLD_MS) return "recent";
  return null; // too old to override
}

export const statusColor: Record<AgentStatus | string, string> = {
  active: "bg-success",
  recent: "bg-warning",
  inactive: "bg-muted-foreground",
};

export const statusLabel: Record<AgentStatus | string, string> = {
  active: "Ativo",
  recent: "Recente",
  inactive: "Inativo",
};

/** CSS class for the status dot, including stale degradation */
export function getStatusDotClass(status: AgentStatus, lastStatusUpdate?: number): string {
  const base = statusColor[status] ?? "bg-muted";
  if (lastStatusUpdate && Date.now() - lastStatusUpdate > STALE_THRESHOLD_MS) {
    return `${base} opacity-50`;
  }
  return base;
}

/** Whether the status data is considered stale (SSE hasn't updated in > 2 min) */
export function isStatusStale(lastStatusUpdate?: number): boolean {
  if (!lastStatusUpdate) return false;
  return Date.now() - lastStatusUpdate > STALE_THRESHOLD_MS;
}

/** Returns a human-readable label with optional stale suffix */
export function getStatusLabel(status: AgentStatus, lastStatusUpdate?: number): string {
  const label = statusLabel[status] ?? status;
  if (isStatusStale(lastStatusUpdate)) {
    return `${label} (stale)`;
  }
  return label;
}
