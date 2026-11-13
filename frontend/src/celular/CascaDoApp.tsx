/**
 * Quem desenha a casca das rotas logadas: o `AppLayout` de sempre, ou — no
 * celular, em `/` e `/chat` — o app próprio (spec 2026-11-03).
 *
 * O app do celular fica FORA do `AppLayout`, mas precisa do que ele montava
 * para todo mundo: as notificações (contador, som, push), a presença e o
 * catálogo de agentes. A janela de lembrete (spec 2026-11-13) fica aqui,
 * fora das duas, para valer em ambas.
 */
import { useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AppLayout } from "@/components/AppLayout";
import { JanelaDeLembrete } from "@/components/agenda/JanelaDeLembrete";
import { NotificationsProvider } from "@/components/NotificationsProvider";
import { NovidadesProvider } from "@/components/novidades/NovidadesProvider";
import { useAuthContext } from "@/contexts/auth-context";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { useAgents } from "@/hooks/use-agents";
import { pruneUnreadAgents, resumePendingBackgroundTasks } from "@/lib/chat-sender";
import { useIsMobile } from "@/hooks/use-mobile";
import { usePresence } from "@/hooks/use-presence";
import AppCelular from "./AppCelular";
import { usaAppCelular } from "./pilha";

function AppCelularComServicos() {
  const { user } = useAuthContext();
  usePresence(user?.id);
  useAgentCatalog();
  // O que o `ChatPage` faz ao montar: retomar a espera de resposta que estava
  // em curso antes de recarregar, e limpar "não lida" de agente que não existe.
  const { agents } = useAgents();
  const idsDosAgentes = agents.map((a) => a.id).sort().join(",");
  useEffect(() => {
    if (user?.id) resumePendingBackgroundTasks(user.id);
  }, [user?.id]);
  useEffect(() => {
    if (idsDosAgentes) pruneUnreadAgents(idsDosAgentes.split(","));
  }, [idsDosAgentes]);
  return (
    <NotificationsProvider>
      <AppCelular />
    </NotificationsProvider>
  );
}

export function CascaDoApp({ children }: { children: ReactNode }) {
  const isMobile = useIsMobile();
  const { pathname } = useLocation();
  return (
    <NovidadesProvider>
      {usaAppCelular(isMobile, pathname) ? <AppCelularComServicos /> : <AppLayout>{children}</AppLayout>}
      {/* Fora das duas cascas: uma janela só, valendo no desktop e no celular,
          e que não remonta (nem toca o som de novo) ao trocar de casca. */}
      <JanelaDeLembrete />
    </NovidadesProvider>
  );
}
