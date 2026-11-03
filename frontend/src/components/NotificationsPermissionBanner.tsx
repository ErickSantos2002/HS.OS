import { useEffect, useState } from "react";
import { Bell, BellOff, Smartphone, X } from "lucide-react";
import { useAuthContext } from "@/contexts/auth-context";
import {
  isSupported as isBrowserNotifSupported,
  setEnabled as setBrowserNotifEnabled,
} from "@/lib/browser-notifications";
import { ehIosNaoInstalado } from "@/lib/instalacao-app";

/**
 * O pedido de notificação, por aparelho (spec 2026-11-03, B3):
 *
 * - iPhone no Safari, sem instalar: diz que é preciso instalar o app e como.
 * - Permissão ainda não pedida: "Ativar notificações", pedindo no clique.
 * - Negada: explica como reativar nos ajustes, uma vez só.
 */
type Estado = "instalar-ios" | "pedir" | "negado";

const DISMISS_KEY = "hsos:notifBannerDismissedAt";
const DISMISS_IOS_KEY = "hsos:notifBannerIosDismissedAt";
const DISMISS_NEGADO_KEY = "hsos:notifBannerNegadoDispensado";
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;
const SNOOZE_IOS_MS = 14 * 24 * 60 * 60 * 1000;

function ler(chave: string): string | null {
  try { return localStorage.getItem(chave); } catch { return null; }
}

function gravar(chave: string, valor: string): void {
  try { localStorage.setItem(chave, valor); } catch { /* noop */ }
}

function dispensadoHaMenosDe(chave: string, ms: number): boolean {
  const ts = Number(ler(chave));
  return !!ts && Date.now() - ts < ms;
}

function estadoAtual(): Estado | null {
  if (ehIosNaoInstalado()) {
    return dispensadoHaMenosDe(DISMISS_IOS_KEY, SNOOZE_IOS_MS) ? null : "instalar-ios";
  }
  if (!isBrowserNotifSupported()) return null;
  if (Notification.permission === "default") {
    return dispensadoHaMenosDe(DISMISS_KEY, SNOOZE_MS) ? null : "pedir";
  }
  if (Notification.permission === "denied") {
    // Negado não volta a cada 7 dias: quem negou sabe, e insistir é chato.
    return ler(DISMISS_NEGADO_KEY) ? null : "negado";
  }
  return null;
}

export function NotificationsPermissionBanner() {
  const { user } = useAuthContext();
  const [estado, setEstado] = useState<Estado | null>(null);

  useEffect(() => {
    if (!user) return;
    // small delay so it doesn't pop in during initial paint
    const t = setTimeout(() => setEstado(estadoAtual()), 1500);
    return () => clearTimeout(t);
  }, [user]);

  if (!user || !estado) return null;

  const dispensar = () => {
    if (estado === "instalar-ios") gravar(DISMISS_IOS_KEY, String(Date.now()));
    else if (estado === "negado") gravar(DISMISS_NEGADO_KEY, "1");
    else gravar(DISMISS_KEY, String(Date.now()));
    setEstado(null);
  };

  // ⚠️ **`requestPermission` é a primeira coisa do clique, sem `await` antes.**
  // O Safari do iPhone (e o Firefox) só aceita o pedido dentro do gesto do
  // usuário; um `await` qualquer antes dele perde o gesto e o pedido é
  // recusado em silêncio.
  const ativar = () => {
    const pedido = Notification.requestPermission();
    void pedido.then(async (resultado) => {
      if (resultado === "granted") {
        setBrowserNotifEnabled(true);
        const { subscribeToPushNotifications } = await import("@/lib/push-notifications");
        subscribeToPushNotifications(user.id).catch((e) =>
          console.warn("[banner] push subscribe failed:", e)
        );
        setEstado(null);
        return;
      }
      if (resultado === "denied") {
        setEstado("negado");
        return;
      }
      gravar(DISMISS_KEY, String(Date.now()));
      setEstado(null);
    });
  };

  const textos: Record<Estado, { titulo: string; corpo: string; icone: typeof Bell }> = {
    "instalar-ios": {
      titulo: "Para receber notificações no iPhone, instale o app",
      corpo:
        "No Safari, toque em Compartilhar e depois em “Adicionar à Tela de Início”. " +
        "Abra o HS.OS pelo ícone novo e ative as notificações lá.",
      icone: Smartphone,
    },
    pedir: {
      titulo: "Ative as notificações do HS.OS",
      corpo: "Avisamos quando um agente responder, quando alguém te mencionar ou mandar mensagem.",
      icone: Bell,
    },
    negado: {
      titulo: "As notificações estão bloqueadas neste aparelho",
      corpo:
        "Para reativar: no Android, toque no cadeado ao lado do endereço (ou Configurações › Apps › HS.OS › Notificações); " +
        "no iPhone, Ajustes › Notificações › HS.OS; no computador, no cadeado da barra de endereço.",
      icone: BellOff,
    },
  };
  const { titulo, corpo, icone: Icone } = textos[estado];

  return (
    <div className="fixed top-3 left-1/2 -translate-x-1/2 z-[100] w-[min(92vw,560px)]">
      <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-background/95 backdrop-blur-md px-4 py-3 shadow-2xl shadow-primary/10">
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary shrink-0">
          <Icone className="h-4 w-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-foreground leading-tight">{titulo}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{corpo}</p>
        </div>
        {estado === "pedir" && (
          <button
            type="button"
            onClick={ativar}
            className="text-xs px-3 py-1.5 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity shrink-0 font-medium"
          >
            Ativar notificações
          </button>
        )}
        <button
          type="button"
          onClick={dispensar}
          aria-label="Dispensar"
          className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-secondary/50 shrink-0"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
