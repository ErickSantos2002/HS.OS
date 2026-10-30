import { api } from "@/lib/api";
import { useEffect } from "react";

const HEARTBEAT_INTERVAL_MS = 60_000;

/**
 * Heartbeat that pings `profiles.last_seen_at = now()` while the app is open.
 *
 * ⚠️ Bate também com a aba em segundo plano. Até 30/10/2026 o heartbeat parava
 * quando a aba saía de vista, e quem trabalhava no Excel ou numa chamada com o
 * HS.OS aberto atrás sumia da TV da War Room em dois minutos — "online"
 * significava "olhando para a aba agora". Um UPDATE por pessoa por minuto não
 * é ruído que valha esse engano. Ao voltar para a aba, bate na hora.
 */
export function usePresence(userId: string | undefined) {
  useEffect(() => {
    if (!userId) return;

    const ping = async () => {
      try {
        await api("/profiles/me/presenca", { method: "POST" });
      } catch (err) {
        // Silent fail — presence is best-effort
        console.debug("[usePresence] heartbeat failed", err);
      }
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") void ping();
    };

    void ping();
    const timer = setInterval(ping, HEARTBEAT_INTERVAL_MS);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      clearInterval(timer);
    };
  }, [userId]);
}
