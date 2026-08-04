import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { useAuthContext } from "@/contexts/auth-context";
import {
  isSupported as isBrowserNotifSupported,
  requestPermission as requestBrowserNotifPermission,
  setEnabled as setBrowserNotifEnabled,
} from "@/lib/browser-notifications";

const DISMISS_KEY = "dnos:notifBannerDismissedAt";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function shouldShow(): boolean {
  if (!isBrowserNotifSupported()) return false;
  if (Notification.permission !== "default") return false;
  const dismissed = localStorage.getItem(DISMISS_KEY);
  if (!dismissed) return true;
  const ts = Number(dismissed);
  if (Number.isNaN(ts)) return true;
  return Date.now() - ts > SNOOZE_MS;
}

export function NotificationsPermissionBanner() {
  const { user } = useAuthContext();
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!user) return;
    // small delay so it doesn't pop in during initial paint
    const t = setTimeout(() => setVisible(shouldShow()), 1500);
    return () => clearTimeout(t);
  }, [user]);

  if (!user || !visible) return null;

  const handleEnable = async () => {
    setBusy(true);
    try {
      const result = await requestBrowserNotifPermission();
      if (result === "granted") {
        setBrowserNotifEnabled(true);
        if (user?.id) {
          const { subscribeToPushNotifications } = await import("@/lib/push-notifications");
          subscribeToPushNotifications(user.id).catch((e) =>
            console.warn("[banner] push subscribe failed:", e)
          );
        }
      }
      // hide regardless of choice; if "default" again (closed), respect snooze
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-[min(92vw,560px)]">
      <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-background/95 backdrop-blur-md px-4 py-3 shadow-2xl shadow-primary/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary shrink-0">
          <Bell className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">
            Ative as notificações do dn.os
          </p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Receba alertas quando alguém te mencionar ou enviar uma mensagem direta.
          </p>
        </div>
        <button
          type="button"
          onClick={handleEnable}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity disabled:opacity-50 shrink-0 font-medium"
        >
          {busy ? "Aguarde..." : "Ativar"}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Dispensar"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary/50 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
