// Derives human presence from `profiles.last_seen_at`
// Online: < 2 min, Away: < 30 min, Offline: otherwise

export type Presence = "online" | "away" | "offline";

const ONLINE_THRESHOLD_MS = 2 * 60 * 1000;
const AWAY_THRESHOLD_MS = 30 * 60 * 1000;

export function derivePresence(lastSeenAt: string | null | undefined): Presence {
  if (!lastSeenAt) return "offline";
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isNaN(elapsed) || elapsed < 0) return "offline";
  if (elapsed < ONLINE_THRESHOLD_MS) return "online";
  if (elapsed < AWAY_THRESHOLD_MS) return "away";
  return "offline";
}

export const presenceDotClass: Record<Presence, string> = {
  online: "bg-success",
  away: "bg-warning",
  offline: "bg-muted-foreground",
};

export const presenceLabel: Record<Presence, string> = {
  online: "Online",
  away: "Ausente",
  offline: "Offline",
};
