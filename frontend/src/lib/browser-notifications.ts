/**
 * Browser-native notifications (Notifications API).
 * Disparadas pelo cliente quando há aba aberta (mesmo em background).
 * Não cobre app totalmente fechado — isso exigiria Web Push + Service Worker + VAPID.
 */
const STORAGE_KEY = "hsos:browserNotifications";

export function isSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function getPermission(): NotificationPermission | "unsupported" {
  if (!isSupported()) return "unsupported";
  return Notification.permission;
}

export function isEnabled(): boolean {
  if (!isSupported()) return false;
  // default true; user can opt-out via settings toggle
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

export function setEnabled(v: boolean): void {
  localStorage.setItem(STORAGE_KEY, String(v));
}

export async function requestPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!isSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (e) {
    console.warn("[browser-notifications] requestPermission failed:", e);
    return Notification.permission;
  }
}

export interface ShowNotificationOptions {
  title: string;
  body?: string;
  tag?: string;
  icon?: string;
  url?: string;
  onClick?: () => void;
}

export type ShowNotificationResult =
  | { ok: true; via: "sw" | "direct" }
  | { ok: false; reason: string };

const AUTO_CLOSE_MS = 6000;

async function hasActivePushSubscription(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return false;
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg) return false;
    const sub = await reg.pushManager.getSubscription();
    return !!sub;
  } catch {
    return false;
  }
}

export async function showNotification(opts: ShowNotificationOptions): Promise<ShowNotificationResult> {
  if (!isSupported()) return { ok: false, reason: "Notifications API not supported" };
  if (Notification.permission !== "granted") return { ok: false, reason: `permission=${Notification.permission}` };
  if (!isEnabled()) return { ok: false, reason: "disabled in app settings" };

  // If Web Push is active, the server will deliver the rich notification
  // (with "Responder" / "Marcar como lida" actions) via the SW push handler.
  // Skip the client-side one to avoid duplicate toasts on desktop.
  if (await hasActivePushSubscription()) {
    return { ok: false, reason: "push subscription active — handled by SW" };
  }

  // Auto-dismiss after a few seconds so notifications don't pile up.
  const notifOptions: NotificationOptions & { data?: unknown; renotify?: boolean } = {
    body: opts.body,
    icon: opts.icon ?? "/icons/icon-192.png",
    requireInteraction: false,
    silent: false,
    data: { url: opts.url ?? "/" },
  };
  if (opts.tag) {
    notifOptions.tag = opts.tag;
    notifOptions.renotify = true;
  }

  // Prefer Service Worker (REQUIRED for PWA on Windows to surface in Action Center)
  if ("serviceWorker" in navigator) {
    try {
      const reg = await navigator.serviceWorker.ready;
      if (reg && typeof reg.showNotification === "function") {
        await reg.showNotification(opts.title, notifOptions);
        console.log("[browser-notifications] dispatched via SW (scope:", reg.scope, ")");
        // Auto-close after AUTO_CLOSE_MS
        setTimeout(async () => {
          try {
            const notifs = await reg.getNotifications(opts.tag ? { tag: opts.tag } : {});
            notifs.forEach((n) => n.close());
          } catch {
            // ignore
          }
        }, AUTO_CLOSE_MS);
        return { ok: true, via: "sw" };
      }
    } catch (e) {
      console.warn("[browser-notifications] SW showNotification failed, falling back:", e);
    }
  }

  // Fallback: direct Notification (works in regular browser tabs, NOT in PWA on Windows)
  try {
    const n = new Notification(opts.title, notifOptions);
    n.onclick = () => {
      window.focus();
      opts.onClick?.();
      n.close();
    };
    setTimeout(() => {
      try { n.close(); } catch { /* noop */ }
    }, AUTO_CLOSE_MS);
    console.log("[browser-notifications] dispatched via direct Notification()");
    return { ok: true, via: "direct" };
  } catch (e) {
    console.warn("[browser-notifications] new Notification() threw:", e);
    return { ok: false, reason: String(e) };
  }
}

// Listen for notification clicks coming from the Service Worker
if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
  navigator.serviceWorker.addEventListener?.("message", (event) => {
    const data = event.data as { type?: string; url?: string } | undefined;
    if (data?.type === "notification-click" && data.url) {
      try {
        // If we're already in the app, navigate via SPA
        if (window.location.pathname !== data.url) {
          window.history.pushState({}, "", data.url);
          window.dispatchEvent(new PopStateEvent("popstate"));
        }
        window.focus();
      } catch (e) {
        console.warn("[browser-notifications] navigation from SW failed:", e);
      }
    }
  });
}
