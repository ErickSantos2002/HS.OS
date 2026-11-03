/**
 * Quem desenha a casca das rotas logadas: o `AppLayout` de sempre, ou — no
 * celular, em `/` e `/chat` — o app próprio (spec 2026-11-03).
 *
 * O app do celular fica FORA do `AppLayout`, mas precisa do que ele montava
 * para todo mundo: as notificações (contador, som, push), a presença e o
 * catálogo de agentes.
 */
import type { ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AppLayout } from "@/components/AppLayout";
import { NotificationsProvider } from "@/components/NotificationsProvider";
import { useAuthContext } from "@/contexts/auth-context";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePresence } from "@/hooks/use-presence";
import AppCelular from "./AppCelular";
import { usaAppCelular } from "./pilha";

function AppCelularComServicos() {
  const { user } = useAuthContext();
  usePresence(user?.id);
  useAgentCatalog();
  return (
    <NotificationsProvider>
      <AppCelular />
    </NotificationsProvider>
  );
}

export function CascaDoApp({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  if (usaAppCelular(isMobile, pathname)) return <AppCelularComServicos />;
  return <AppLayout>{children}</AppLayout>;
}
