/// <reference lib="webworker" />
import {
  precacheAndRoute,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
} from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";
import { LISTA_NEGADA } from "./lib/navegacao-do-app";
import { clienteDaResposta } from "./lib/resposta-rapida";

declare const self: ServiceWorkerGlobalScope;

// Precache assets injected at build time by vite-plugin-pwa (injectManifest)
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// Fallback de navegação: toda tela do SPA é respondida pelo index.html
// precacheado. É o que faz o app instalado abrir sem rede mostrando o app,
// e não a página de erro do navegador. API, tempo real, arquivos e artefatos
// publicados ficam de fora (LISTA_NEGADA) e vão direto à rede.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL("/index.html"), { denylist: LISTA_NEGADA }),
);

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

// ─────────────────────────────────────────────────────────────────────────────
// Push, clique e badge — Frente B da spec 2026-11-03 (mobile). O precache e o
// fallback de navegação acima são da Frente A.
// ─────────────────────────────────────────────────────────────────────────────

interface PayloadPush {
  title?: string;
  body?: string;
  icon?: string;
  url?: string;
  tag?: string;
  // "agente:<id>" | "canal:<id>" — a chave que a aba compara com a conversa
  // aberta. Ver `lib/conversa-aberta.ts`.
  conversa?: string;
  // Só em mensagem de canal/DM. Sem ele as ações "Responder" e "Marcar como
  // lida" não aparecem: na conversa com agente não há o que marcar.
  channel_id?: string;
  // Só em resposta de thread: a resposta rápida vai para a thread, não para a
  // raiz do canal.
  thread_id?: string;
}

const swNav = self as unknown as {
  setAppBadge?: (count?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
  navigator: { userAgent: string };
};

/**
 * Badge do ícone = quantas conversas têm notificação aberta na bandeja (uma
 * por `tag`). Antes era `setAppBadge(1)` fixo. Se não der para contar, um
 * ponto (`setAppBadge()` sem número) em vez de um número inventado.
 */
async function atualizarBadge(): Promise<void> {
  try {
    if (typeof swNav.setAppBadge !== "function") return;
    let quantas: number | null = null;
    try {
      const abertas = await self.registration.getNotifications();
      quantas = new Set(abertas.map((n) => n.tag || n.title)).size;
    } catch {
      quantas = null;
    }
    if (quantas === null) await swNav.setAppBadge();
    else if (quantas > 0) await swNav.setAppBadge(quantas);
    else await swNav.clearAppBadge?.();
  } catch {
    // sem suporte
  }
}

/**
 * Safari/WebKit da Apple (iPhone, iPad, Safari do Mac).
 *
 * ⚠️ Lá, push que chega sem notificação visível faz o Safari **revogar a
 * inscrição**. Por isso nesses o SW mostra sempre, e a aba que estiver olhando
 * fecha a notificação logo em seguida (`push-mostrado`).
 */
function ehWebKitDaApple(): boolean {
  const ua = swNav.navigator?.userAgent ?? "";
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Safari/.test(ua) && !/Chrome|Chromium|CriOS|Edg|Firefox|FxiOS|Android/.test(ua);
}

async function janelas(): Promise<readonly WindowClient[]> {
  return self.clients.matchAll({ type: "window", includeUncontrolled: true });
}

/** Pergunta a uma aba se ela está na conversa. Sem resposta em 400 ms, "não". */
function perguntar(cliente: WindowClient, conversa: string): Promise<boolean> {
  return new Promise((resolve) => {
    const canal = new MessageChannel();
    const prazo = setTimeout(() => resolve(false), 400);
    canal.port1.onmessage = (ev) => {
      clearTimeout(prazo);
      resolve(!!(ev.data as { sim?: boolean } | null)?.sim);
    };
    cliente.postMessage({ type: "esta-na-conversa", conversa }, [canal.port2]);
  });
}

/** Alguma aba visível e com foco está com esta conversa aberta? */
async function alguemOlhando(conversa: string): Promise<boolean> {
  const visiveis = (await janelas()).filter((c) => c.visibilityState === "visible" && c.focused);
  if (visiveis.length === 0) return false;
  const respostas = await Promise.all(visiveis.map((c) => perguntar(c, conversa)));
  return respostas.some(Boolean);
}

function urlDoCanal(channelId: string | undefined, extra: Record<string, string> = {}) {
  const base = channelId ? `/chat?channel=${channelId}` : "/chat";
  const qs = new URLSearchParams(extra).toString();
  if (!qs) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${qs}`;
}

/** Foca uma aba existente e navega nela; sem aba, abre a `url`. */
async function focarOuAbrir(url: string): Promise<void> {
  const abertas = await janelas();
  const alvo = abertas.find((c) => c.focused) ?? abertas[0];
  if (alvo) {
    await alvo.focus().catch(() => undefined);
    // A navegação é da SPA (`browser-notifications.ts` ouve isto): trocar a
    // URL pelo `navigate()` recarregaria o app inteiro.
    alvo.postMessage({ type: "notification-click", url });
    return;
  }
  if (self.clients.openWindow) await self.clients.openWindow(url);
}

// --- Push ---
self.addEventListener("push", (event) => {
  if (!event.data) return;
  let payload: PayloadPush;
  try {
    payload = event.data.json() as PayloadPush;
  } catch {
    payload = { title: "HS.OS", body: event.data.text() };
  }

  event.waitUntil(
    (async () => {
      const apple = ehWebKitDaApple();
      // ⚠️ Não notificar quem está olhando — mas só fora do iOS, onde push
      // sem notificação revoga a inscrição.
      if (payload.conversa && !apple && (await alguemOlhando(payload.conversa))) {
        return;
      }

      const temCanal = !!payload.channel_id;
      await self.registration.showNotification(payload.title ?? "HS.OS", {
        body: payload.body,
        icon: payload.icon ?? "/icons/icon-192.png",
        // Monocromático (branco sobre transparente): o Android pinta a barra
        // de status só com o alfa, e o ícone colorido virava um quadrado branco.
        badge: "/icons/badge-96.png",
        tag: payload.tag,
        renotify: !!payload.tag,
        requireInteraction: false,
        data: {
          url: payload.url ?? "/chat",
          channel_id: payload.channel_id,
          thread_id: payload.thread_id,
          conversa: payload.conversa,
        },
        // `type: "text"` abre o campo de resposta no Chrome do Android; no
        // desktop aparece só o botão.
        actions: temCanal
          ? [
              { action: "reply", title: "Responder", type: "text", placeholder: "Resposta rápida..." },
              { action: "mark_read", title: "Marcar como lida" },
            ]
          : [],
      } as NotificationOptions & {
        renotify?: boolean;
        actions?: Array<{ action: string; title: string; type?: "text"; placeholder?: string }>;
      });
      // ⚠️ Sem auto-fechamento: no celular ela sumia da bandeja em 6 s.

      await atualizarBadge();

      if (apple && payload.conversa) {
        for (const c of await janelas()) {
          c.postMessage({ type: "push-mostrado", tag: payload.tag, conversa: payload.conversa });
        }
      }
    })(),
  );
});

// --- Clique na notificação / ações ---
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const data = (event.notification.data ?? {}) as {
    url?: string;
    channel_id?: string;
    thread_id?: string;
  };
  const action = event.action;
  // Preenchido quando a pessoa digita no campo da notificação (só Android).
  const replyText = (event as NotificationEvent & { reply?: string }).reply?.trim();

  event.waitUntil(
    (async () => {
      // ---- Marcar como lida (só canal/DM; esclarecimento 1) ----
      if (action === "mark_read" && data.channel_id) {
        const abertas = await janelas();
        if (abertas.length > 0) {
          for (const c of abertas) {
            c.postMessage({ type: "mark-notification-read", channelId: data.channel_id });
          }
        } else if (self.clients.openWindow) {
          // Sem aba aberta o SW não tem o token: abre o app para ele marcar.
          await self.clients.openWindow(`/chat?marcar_lido=${encodeURIComponent(data.channel_id)}`);
        }
        await atualizarBadge();
        return;
      }

      // ---- Responder ----
      if (action === "reply" && data.channel_id) {
        if (replyText) {
          // ⚠️ Uma aba só: cada aba que recebe posta, e com o PWA e o
          // navegador abertos a resposta saía duas vezes.
          const alvo = clienteDaResposta(await janelas());
          if (alvo) {
            alvo.postMessage({
              type: "quick-reply",
              channelId: data.channel_id,
              threadId: data.thread_id ?? null,
              text: replyText,
            });
            await alvo.focus().catch(() => undefined);
          } else if (self.clients.openWindow) {
            // Sem aba aberta o SW não tem o token: abre o app com o texto na
            // URL e ele posta. Com `thread`, o app do celular (`TelaThread`)
            // responde NA thread; o desktop, que não abre thread pela URL,
            // ignora o pedido em vez de postar na raiz.
            await self.clients.openWindow(
              urlDoCanal(data.channel_id, {
                ...(data.thread_id ? { thread: data.thread_id } : {}),
                prefill: replyText, autosend: "1", focus: "composer",
              }),
            );
          }
        } else {
          // Desktop: sem campo de texto, abre a conversa com o cursor no
          // composer (`?focus=composer`, tratado no `ChannelChat`).
          await focarOuAbrir(urlDoCanal(data.channel_id, { focus: "composer" }));
        }
        await atualizarBadge();
        return;
      }

      // ---- Clique no corpo ----
      await focarOuAbrir(data.url ?? "/chat");
      await atualizarBadge();
    })(),
  );
});

self.addEventListener("notificationclose", (event) => {
  event.waitUntil(atualizarBadge());
});
