import { useEffect, useRef } from "react";
import { toast } from "sonner";

/**
 * Detecta novas versões da HS.OS em produção comparando o fingerprint do
 * /index.html atual contra o que foi carregado inicialmente. Quando muda,
 * mostra um toast persistente com botão "Atualizar agora" que faz reload.
 *
 * - Ignora dev, iframes, previews Lovable
 * - Poll a cada 2 min + ao voltar para a aba (visibilitychange)
 * - Toast é único (id fixo) e não some sozinho
 */

const POLL_MS = 2 * 60 * 1000;
const TOAST_ID = "dnos-update-available";

function isPreviewOrDev(): boolean {
  if (!import.meta.env.PROD) return true;
  if (typeof window === "undefined") return true;
  try {
    if (window.self !== window.top) return true;
  } catch {
    return true;
  }
  const h = window.location.hostname;
  if (h.startsWith("id-preview--") || h.startsWith("preview--")) return true;
  if (h === "lovableproject.com" || h.endsWith(".lovableproject.com")) return true;
  if (h === "lovableproject-dev.com" || h.endsWith(".lovableproject-dev.com")) return true;
  if (h === "beta.lovable.dev" || h.endsWith(".beta.lovable.dev")) return true;
  return false;
}

async function fetchFingerprint(): Promise<string | null> {
  try {
    const res = await fetch(`/index.html?_v=${Date.now()}`, {
      cache: "no-store",
      headers: { "cache-control": "no-cache" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    // Match hashed asset filenames (e.g. /assets/index-DEa8b1cD.js)
    const assets = html.match(/\/assets\/[A-Za-z0-9_-]+\.(?:js|css)/g);
    if (assets && assets.length) {
      return assets.sort().join("|");
    }
    // Fallback: hash the raw HTML length + head snippet
    return `${html.length}:${html.slice(0, 512)}`;
  } catch {
    return null;
  }
}

function showUpdateToast() {
  toast("Nova versão da HS.OS disponível", {
    id: TOAST_ID,
    description: "Atualize para receber os últimos recursos e correções.",
    duration: Infinity,
    action: {
      label: "Atualizar agora",
      onClick: () => {
        try {
          // Best-effort: limpa caches do SW para forçar bundle novo
          if ("caches" in window) {
            caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
          }
        } catch {
          /* noop */
        }
        window.location.reload();
      },
    },
  });
}

export function useVersionCheck() {
  const initialRef = useRef<string | null>(null);
  const notifiedRef = useRef(false);

  useEffect(() => {
    if (isPreviewOrDev()) return;

    let cancelled = false;

    const check = async () => {
      const fp = await fetchFingerprint();
      if (cancelled || !fp) return;
      if (initialRef.current == null) {
        initialRef.current = fp;
        return;
      }
      if (fp !== initialRef.current && !notifiedRef.current) {
        notifiedRef.current = true;
        showUpdateToast();
      }
    };

    // Baseline imediato
    check();

    const interval = window.setInterval(check, POLL_MS);
    const onVis = () => {
      if (document.visibilityState === "visible") check();
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);
}
