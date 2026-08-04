/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches } from "workbox-precaching";

declare const self: ServiceWorkerGlobalScope;

// Precache assets injected at build time by vite-plugin-pwa (injectManifest)
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// A versão nova ESPERA o usuário. O skipWaiting automático no install fazia
// o SW novo assumir sozinho e a página recarregar no meio da interação;
// agora ele só assume quando o app manda SKIP_WAITING — o que acontece no
// clique do botão "Atualizar agora" do aviso (main.tsx).
self.addEventListener("message", (event) => {
  if ((event.data as { type?: string } | null)?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// Helpers for the App Badging API (available on `self` in modern SWs).
const swNav = (self as unknown as {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}) ?? {};

async function setBadge(count: number) {
  try {
    if (count > 0 && typeof swNav.setAppBadge === "function") {
      await swNav.setAppBadge(count);
    } else if (typeof swNav.clearAppBadge === "function") {
      await swNav.clearAppBadge();
    }
  } catch {
    // ignore unsupported
  }
}

function buildChannelUrl(channelId: string | undefined, extra: Record<string, string> = {}) {
  const base = channelId ? `/chat?channel=${channelId}` : "/";
  const params = new URLSearchParams(extra);
  const qs = params.toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

async function focusOrOpen(targetUrl: string, extraMessage?: Record<string, unknown>) {
  const allClients = await self.clients.matchAll({
    type: "window",
    includeUncontrolled: true,
  });
  for (const client of allClients) {
    if ("focus" in client) {
      await client.focus();
      client.postMessage({ type: "notification-click", url: targetUrl, ...extraMessage });
      return;
    }
  }
  if (self.clients.openWindow) {
    await self.clients.openWindow(targetUrl);
  }
}

// --- Notification click / action ---
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as {
    url?: string;
    channel_id?: string;
    notification_id?: string;
  };
  const action = event.action;
  // `reply` field is populated when the user types in a notification text input (Android only)
  const replyText = (event as NotificationEvent & { reply?: string }).reply?.trim();

  event.waitUntil(
    (async () => {
      // ---- Marcar como lida ----
      if (action === "mark_read") {
        const allClients = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        if (allClients.length > 0) {
          // Let an open client perform the authenticated update.
          for (const client of allClients) {
            client.postMessage({
              type: "mark-notification-read",
              notificationId: data.notification_id ?? null,
              channelId: data.channel_id ?? null,
            });
          }
        } else if (self.clients.openWindow) {
          // No client open — open the app in the background so it can mark it read.
          const url = `/?mark_read=${encodeURIComponent(data.notification_id ?? "")}&channel=${encodeURIComponent(data.channel_id ?? "")}`;
          await self.clients.openWindow(url);
        }
        await setBadge(Math.max(0, await getUnreadFallback() - 1));
        return;
      }

      // ---- Responder ----
      if (action === "reply") {
        await setBadge(0);
        // Android quick-reply: text was typed in the notification.
        if (replyText) {
          const allClients = await self.clients.matchAll({
            type: "window",
            includeUncontrolled: true,
          });
          if (allClients.length > 0) {
            for (const client of allClients) {
              client.postMessage({
                type: "quick-reply",
                channelId: data.channel_id ?? null,
                text: replyText,
              });
            }
            // also focus a window so the user sees confirmation
            await allClients[0].focus().catch(() => undefined);
            return;
          }
          // No client open — open the chat with prefill+autosend so the SPA sends it on boot.
          const url = buildChannelUrl(data.channel_id, {
            prefill: replyText,
            autosend: "1",
            focus: "composer",
          });
          if (self.clients.openWindow) await self.clients.openWindow(url);
          return;
        }
        // Desktop (no text input) → just open the chat focused on the composer.
        const url = buildChannelUrl(data.channel_id, { focus: "composer" });
        await focusOrOpen(url);
        return;
      }

      // ---- Click padrão (corpo da notificação) ----
      await setBadge(0);
      const targetUrl = data.url ?? "/";
      await focusOrOpen(targetUrl);
    })()
  );
});

// Best-effort estimate of unread count when SW doesn't know it.
async function getUnreadFallback(): Promise<number> {
  return 1;
}

// --- Push handler ---
self.addEventListener("push", (event) => {
  if (!event.data) return;
  try {
    const payload = event.data.json() as {
      title?: string;
      body?: string;
      icon?: string;
      url?: string;
      tag?: string;
      unread_count?: number;
      notification_id?: string;
      channel_id?: string;
    };
    event.waitUntil(
      (async () => {
        // Update the dock/taskbar badge first — works even if no client window is open.
        if (typeof payload.unread_count === "number") {
          await setBadge(payload.unread_count);
        } else if (typeof swNav.setAppBadge === "function") {
          await setBadge(1);
        }

        await self.registration.showNotification(payload.title ?? "dn.os", {
          body: payload.body,
          icon: payload.icon ?? "/icons/icon-192.png",
          badge: "/icons/icon-192.png",
          tag: payload.tag,
          renotify: true,
          requireInteraction: false,
          data: {
            url: payload.url ?? "/",
            notification_id: payload.notification_id,
            channel_id: payload.channel_id,
          },
          // Action buttons. The `type: "text"` field on the reply action is
          // honored by Chrome on Android (opens an inline text input) and
          // ignored on desktop (Windows/macOS show the button only).
          actions: [
            {
              action: "reply",
              title: "Responder",
              type: "text",
              placeholder: "Resposta rápida...",
            },
            { action: "mark_read", title: "Marcar como lida" },
          ],
        } as NotificationOptions & {
          actions?: Array<{ action: string; title: string; type?: "text"; placeholder?: string }>;
        });

        // Auto-close after 6s so notifications don't pile up if the user
        // doesn't interact with them.
        await new Promise<void>((resolve) => setTimeout(resolve, 6000));
        try {
          const tag = payload.tag;
          const notifs = await self.registration.getNotifications(tag ? { tag } : {});
          notifs.forEach((n) => n.close());
        } catch {
          // ignore
        }
      })()
    );
  } catch (e) {
    console.warn("[sw] push payload parse failed:", e);
  }
});
