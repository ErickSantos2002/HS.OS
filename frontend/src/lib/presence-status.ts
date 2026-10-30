// Derives human presence from `profiles.last_seen_at`
// Online: < 3 min, Away: < 30 min, Offline: otherwise
//
// A janela de online é 3x o heartbeat (60 s): aba em segundo plano tem o timer
// estrangulado pelo navegador. É o `_ONLINE` de `backend/app/warroom.py` — a TV
// usa a mesma régua; mude os dois juntos.

export type Presence = "online" | "away" | "offline";

const ONLINE_THRESHOLD_MS = 3 * 60 * 1000;
const AWAY_THRESHOLD_MS = 30 * 60 * 1000;

export function derivePresence(lastSeenAt: string | null | undefined): Presence {
  if (!lastSeenAt) return "offline";
  // ⚠️ Negativo é relógio local atrasado em relação ao banco, não ausência:
  // até 30/10/2026 isso apagava quem tinha acabado de bater.
  const elapsed = Date.now() - new Date(lastSeenAt).getTime();
  if (Number.isNaN(elapsed)) return "offline";
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
