import { api } from "@/lib/api";
import { useCallback, useEffect, useState } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { toast } from "sonner";
import {
  ackExpiry,
  isExpiryAcked,
  setSelfStatusCache,
  type ActiveStatus,
  type UserStatusPreset,
} from "@/lib/user-status";

const ALERT_AFTER_MS = 90 * 60 * 1000; // 1h30
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // every 5 min

interface ProfileStatusRow {
  custom_status: string | null;
  custom_status_emoji: string | null;
  custom_status_set_at: string | null;
}

/**
 * Manages the current user's custom status:
 * - Reads from `profiles` on mount
 * - Provides setStatus / clearStatus
 * - Triggers a toast + push alert once the status is older than 90 min
 */
export function useUserStatus() {
  const { user } = useAuthContext();
  const [status, setStatus] = useState<ActiveStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Load initial status
  useEffect(() => {
    if (!user?.id) {
      setStatus(null);
      setSelfStatusCache(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const data = await api<any>("/profiles/me").catch(() => null);
      if (cancelled) return;
      if (data) {
        const row = data as unknown as ProfileStatusRow;
        const active: ActiveStatus | null =
          row.custom_status && row.custom_status_emoji && row.custom_status_set_at
            ? { label: row.custom_status, emoji: row.custom_status_emoji, setAt: row.custom_status_set_at }
            : null;
        setStatus(active);
        setSelfStatusCache(active);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  const setUserStatus = useCallback(
    async (preset: UserStatusPreset) => {
      if (!user?.id) return;
      const nowIso = new Date().toISOString();
      const next: ActiveStatus = { label: preset.label, emoji: preset.emoji, setAt: nowIso };
      setStatus(next);
      setSelfStatusCache(next);
      // O carimbo de quando o status foi posto é do servidor: com o relógio do
      // navegador adiantado, "há 5 minutos" vira "daqui a 5 minutos" para quem vê.
      const error = await api("/profiles/me", {
        method: "PATCH",
        body: { custom_status: preset.label, custom_status_emoji: preset.emoji },
      }).then(() => null, (e: Error) => e);
      if (error) {
        toast.error("Não foi possível atualizar seu status.");
      } else {
        toast.success(`Status atualizado: ${preset.emoji} ${preset.label}`);
      }
    },
    [user?.id]
  );

  const clearUserStatus = useCallback(async () => {
    if (!user?.id) return;
    setStatus(null);
    setSelfStatusCache(null);
    const error = await api("/profiles/me", {
      method: "PATCH",
      body: { custom_status: null, custom_status_emoji: null },
    }).then(() => null, (e: Error) => e);
    if (error) {
      toast.error("Não foi possível remover seu status.");
    } else {
      toast.success("Status removido.");
    }
  }, [user?.id]);

  // 1h30 expiry alert (toast + push)
  useEffect(() => {
    if (!user?.id) return;

    const check = () => {
      const current = status;
      if (!current) return;
      const elapsed = Date.now() - new Date(current.setAt).getTime();
      if (elapsed < ALERT_AFTER_MS) return;
      if (isExpiryAcked(current.setAt)) return;
      ackExpiry(current.setAt);

      // In-app toast with actions
      toast(`Você ainda está em ${current.emoji} ${current.label}?`, {
        description: "Seu status já dura mais de 1h30.",
        duration: 15000,
        action: {
          label: "Limpar",
          onClick: () => {
            void clearUserStatus();
          },
        },
      });

      // Push do navegador/PWA. Era a edge `send-push`; hoje é `/push/enviar`.
      // Silencioso de propósito: o toast acima já avisou dentro do app, e a
      // instalação pode nem ter as chaves VAPID configuradas (503).
      void api("/push/enviar", {
        method: "POST",
        body: {
          user_id: user.id,
          title: `Você ainda está em ${current.emoji} ${current.label}?`,
          body: "Seu status já dura mais de 1h30. Toque para atualizar.",
          url: "/settings?tab=profile",
        },
      }).catch(() => undefined);
    };

    check();
    const id = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [status, user?.id, clearUserStatus]);

  return { status, loading, setUserStatus, clearUserStatus };
}
