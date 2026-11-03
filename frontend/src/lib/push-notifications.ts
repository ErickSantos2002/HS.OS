/**
 * Web Push (PWA) subscription helpers.
 * Backend: `push_subscriptions` + `app/push_envio.py` (o servidor envia a
 * partir da mensagem gravada, spec 2026-11-03) + handler `push` em `sw.ts`.
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
      confirmacao = { endpoint, ok: true, em: Date.now() };
      console.log("[push] subscription saved");
    }

    return subscription;
  } catch (err) {
    console.error("[push] subscribe failed:", err);
    return null;
  }
}

/**
 * Desinscreve ESTE aparelho: apaga no servidor e no navegador.
 *
 * ⚠️ **Servidor primeiro, e antes de limpar o token.** O `DELETE` exige login e
 * confere o dono (esclarecimento 4 da spec). É o que o logout chama — sem
 * isto, um aparelho compartilhado seguia recebendo as mensagens de quem saiu.
 * Desligar as notificações nas Configurações também passa por aqui.
 */
export async function unsubscribeFromPushNotifications(): Promise<void> {
  if (!isPushSupported()) return;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await api(`/push/inscricao?endpoint=${encodeURIComponent(endpoint)}`, {
      method: "DELETE",
    }).catch((e) => console.warn("[push] server unsubscribe failed:", e));
    await subscription.unsubscribe().catch(() => false);
    try { localStorage.removeItem("hsos:push:endpoint"); } catch { /* noop */ }
    confirmacao = null;
  } catch (err) {
    console.warn("[push] unsubscribe failed:", err);
  }
}

// Cache curto da confirmação: a notificação local consulta isto a cada
// mensagem, e uma ida ao servidor por mensagem seria desperdício.
let confirmacao: { endpoint: string; ok: boolean; em: number } | null = null;
const VALIDADE_CONFIRMACAO_MS = 5 * 60 * 1000;

/**
 * O servidor tem a inscrição DESTE aparelho? (`/push/inscricoes/contagem?endpoint=`)
 *
 * ⚠️ Inscrição no navegador não basta: até 03/11/2026 a notificação local era
 * suprimida só por existir inscrição no navegador, o servidor nunca enviava, e
 * quem se inscrevia perdia as duas.
 */
export async function inscricaoConfirmada(endpoint: string): Promise<boolean> {
  const agora = Date.now();
  if (confirmacao && confirmacao.endpoint === endpoint && agora - confirmacao.em < VALIDADE_CONFIRMACAO_MS) {
    return confirmacao.ok;
  }
  try {
    const r = await api<{ count: number }>(
      `/push/inscricoes/contagem?endpoint=${encodeURIComponent(endpoint)}`,
    );
    const ok = (r?.count ?? 0) > 0;
    confirmacao = { endpoint, ok, em: agora };
    return ok;
  } catch {
    return false;
  }
}
