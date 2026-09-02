import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import { toast } from "sonner";
import App from "./App.tsx";
import "./index.css";
// A config do gateway (`exige_papel("administrador")`) era pedida aqui para
// qualquer sessão com token — não tinha como ler o papel antes do React
// montar. Isso trocava um 401 (sem token, resolvido antes) por um 403 em
// toda sessão de colaborador. O carregamento saiu daqui para
// `AuthGuard.tsx`, que já tem o `role` que o resto da tela usa.

// Check for new versions every 30 minutes while the app is open,
// and immediately whenever the user returns to the tab/PWA.
const UPDATE_CHECK_INTERVAL_MS = 30 * 60 * 1000;

const updateSW = registerSW({

  onNeedRefresh() {
    // Versão nova pronta — AVISA e ESPERA o clique. O reload automático de
    // 1,5s puxava o tapete no meio do que o usuário estava fazendo: cada
    // Publicar fazia a página "dar um refresh sozinha" segundos depois,
    // engolindo cliques e resultados (caçado em 29/07 como se fosse bug de
    // botão — era o auto-update da PWA).
    toast("Nova versão da HS.OS disponível", {
      description: "Clique para atualizar quando quiser.",
      duration: Infinity,
      action: {
        // updateSW(true) manda SKIP_WAITING e recarrega quando o SW novo
        // assume — recarregar aqui na mão chegaria antes da troca.
        label: "Atualizar agora",
        onClick: () => updateSW(true),
      },
    });
  },
  onOfflineReady() {
    console.log("[SW] App ready for offline use");
  },
  onRegistered(registration) {
    if (!registration) return;

    // Poll for updates periodically while the app stays open.
    setInterval(() => {
      registration.update().catch(() => undefined);
    }, UPDATE_CHECK_INTERVAL_MS);

    // Check immediately when the user comes back (foregrounded PWA / tab).
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        registration.update().catch(() => undefined);
      }
    });

    // Also check on network reconnect.
    window.addEventListener("online", () => {
      registration.update().catch(() => undefined);
    });
  },
  onRegisterError(err) {
    console.error("[SW] Registration error", err);
  },
});

createRoot(document.getElementById("root")!).render(<App />);
