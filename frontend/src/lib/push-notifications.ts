/**
 * Web Push (PWA) subscription helpers.
 * Backend infra: push_subscriptions table, send-push edge function, sw.ts push handler.
 *
 * Usage:
 *   await subscribeToPushNotifications(userId);
 *
 * A chave pública VAPID vem de `GET /push/chave-publica`, sob demanda.
 */
import { api } from "@/lib/api";

let cachedPublicKey: string | null = null;

async function fetchVapidPublicKey(): Promise<string | null> {
  if (cachedPublicKey) return cachedPublicKey;
  try {
    const json = await api<{ publicKey?: string }>("/push/chave-publica");
    if (json?.publicKey) {
      cachedPublicKey = json.publicKey;
      return cachedPublicKey;
    }
    return null;
  } catch (e) {
    console.warn("[push] failed to fetch VAPID public key:", e);
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const out = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) out[i] = rawData.charCodeAt(i);
  return out;
}

function isPushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function subscribeToPushNotifications(
  userId: string
): Promise<PushSubscription | null> {
  if (!isPushSupported()) {
    console.log("[push] not supported in this browser");
    return null;
  }
  if (Notification.permission !== "granted") {
    console.log("[push] permission not granted; skipping subscribe");
    return null;
  }
  const publicKey = await fetchVapidPublicKey();
  if (!publicKey) {
    console.warn("[push] VAPID public key unavailable; skipping subscribe");
    return null;
  }

  try {
    // Wait for SW; fall back to existing registration if `ready` hangs.
    const registration = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<ServiceWorkerRegistration | undefined>((resolve) =>
        setTimeout(async () => {
          const r = await navigator.serviceWorker.getRegistration();
          resolve(r);
        }, 4000)
      ),
    ]);

    if (!registration) {
      console.warn("[push] no service worker registration available");
      return null;
    }

    let subscription = await registration.pushManager.getSubscription();

    // If the cached endpoint differs from the one currently held (e.g. FCM
    // rotated it after a long idle), force a fresh subscribe so push won't
    // silently die.
    const cachedEndpoint = (() => {
      try { return localStorage.getItem("hsos:push:endpoint"); } catch { return null; }
    })();
    if (subscription && cachedEndpoint && cachedEndpoint !== subscription.endpoint) {
      try { await subscription.unsubscribe(); } catch { /* noop */ }
      subscription = null;
    }

    if (!subscription) {
      const key = urlBase64ToUint8Array(publicKey);
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key as unknown as BufferSource,
      });
    }

    const json = subscription.toJSON();
    const endpoint = json.endpoint ?? subscription.endpoint;
    const p256dh = json.keys?.p256dh;
    const auth = json.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      console.warn("[push] subscription missing required keys");
      return subscription;
    }

    // Upsert by endpoint (unique per device); avoid duplicate inserts.
    let error: Error | null = null;
    try {
      await api("/push/inscricao", {
        method: "PUT",
        body: { endpoint, p256dh, auth, user_agent: navigator.userAgent },
      });
    } catch (e) {
      error = e as Error;
    }

    if (error) {
      console.warn("[push] failed to persist subscription:", error.message);
    } else {
      try { localStorage.setItem("hsos:push:endpoint", endpoint); } catch { /* noop */ }
      console.log("[push] subscription saved");
    }

    return subscription;
  } catch (err) {
    console.error("[push] subscribe failed:", err);
    return null;
  }
}

export async function unsubscribeFromPushNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      const endpoint = subscription.endpoint;
      await subscription.unsubscribe();
      await api(`/push/inscricao?endpoint=${encodeURIComponent(endpoint)}`, {
        method: "DELETE",
      });
    }
  } catch (err) {
    console.warn("[push] unsubscribe failed:", err);
  }
}
