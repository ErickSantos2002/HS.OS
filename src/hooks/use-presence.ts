import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Heartbeat that pings `profiles.last_seen_at = now()` while the tab is visible.
 * Pauses automatically when the tab is hidden to avoid noisy writes.
 */
export function usePresence(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    let timer: ReturnType<typeof setInterval> | null = null;

    const ping = async () => {
      try {
        await supabase
          .from("profiles")
          .update({ last_seen_at: new Date().toISOString() } as any)
          .eq("id", userId);
      } catch (err) {
        // Silent fail — presence is best-effort
        console.debug("[usePresence] heartbeat failed", err);
      }
    };

    const start = () => {
      if (timer) return;
      void ping();
      timer = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    };

    const stop = () => {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") start();
      else stop();
    };

    if (document.visibilityState === "visible") start();
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      stop();
    };
  }, [userId]);
}
