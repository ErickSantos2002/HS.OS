/**
 * A conversa aberta na tela, informada às notificações: marca como lido o que
 * a pessoa está vendo, impede badge e som da conversa aberta, e avisa o
 * service worker (que não mostra push da conversa visível).
 *
 * Movido do `ChatPage` em 03/11/2026 (app do celular) — mesmo texto, mesmos
 * efeitos. `agentId` e `canalId` são exclusivos: conversa com agente OU canal.
 *
 * ⚠️ **Quem zera é o dono.** No celular duas telas de conversa convivem por
 * um instante (a que sai desliza por cima da que entrou). A que saía
 * re-renderizava inativa, rodava DEPOIS da nova e zerava tudo para `null` — a
 * conversa aberta passava a tocar som, receber push e não marcar lido. Agora
 * tela inativa (`ativa: false`) não mexe em nada, e a limpeza só zera se o
 * valor ativo ainda for desta instância.
 */
import { useEffect, useMemo, useRef } from "react";

import { useNotificationsContext } from "@/components/NotificationsProvider";
import { getAgentIdAliases } from "@/lib/agent-id";
import { clearUnreadAgent, setActiveAgentId } from "@/lib/chat-sender";

let donoDoAgente: object | null = null;
let donoDoCanal: object | null = null;

export function useConversaAtivaNasNotificacoes({
  agentId,
  canalId,
  agentDmChannelMap,
  ativa = true,
}: {
  agentId: string | null;
  canalId: string | null;
  agentDmChannelMap: Record<string, string>;
  /** A tela está à vista (topo da pilha)? Inativa não toca no estado global. */
  ativa?: boolean;
}) {
  const eu = useRef({}).current;
  const { markAllAsReadForChannel, markAllAsReadForAgent, setActiveChannel, setActiveAgent } = useNotificationsContext();
  // BUG 3 fix: keep agentDmChannelMap in a ref so this effect doesn't re-run
  // (and clean up via setActiveAgentId(null)) every time the map updates.
  const agentDmChannelMapRef = useRef(agentDmChannelMap);
  agentDmChannelMapRef.current = agentDmChannelMap;

  useEffect(() => {
    if (!ativa) return;
    donoDoAgente = eu;
    const soltar = () => {
      if (donoDoAgente !== eu) return;
      donoDoAgente = null;
      setActiveAgentId(null);
    };
    const currentAgentId = agentId;
    if (currentAgentId) {
      setActiveAgentId(currentAgentId);
      clearUnreadAgent(currentAgentId);
      // Defensive sweep: clears ghost notifications from channel-broadcast
      // even when agentDmChannelMap doesn't yet know the channel UUID.
      void markAllAsReadForAgent(currentAgentId);
      const dmChId = getAgentIdAliases(currentAgentId)
        .map((alias) => agentDmChannelMapRef.current[alias])
        .find(Boolean);
      if (dmChId) {
        markAllAsReadForChannel(dmChId);
        // NOTE: setActiveChannel is handled by the unified effect below
        // Re-sweep after 2s to catch late-arriving DB notifications (race condition)
        const sweepTimer = setTimeout(() => {
          markAllAsReadForChannel(dmChId);
          void markAllAsReadForAgent(currentAgentId);
        }, 2000);
        return () => { clearTimeout(sweepTimer); soltar(); };
      }
    } else {
      setActiveAgentId(null);
    }
    return soltar;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, ativa]);

  // Unified active channel tracking for notifications — prevents race conditions
  // between the agent effect and the channel effect
  const activeNotificationChannelId = useMemo(() => {
    if (canalId) return canalId;
    if (agentId) {
      return getAgentIdAliases(agentId)
        .map((alias) => agentDmChannelMap[alias])
        .find(Boolean) ?? null;
    }
    return null;
  }, [canalId, agentId, agentDmChannelMap]);

  useEffect(() => {
    if (!ativa) return;
    donoDoCanal = eu;
    if (activeNotificationChannelId) {
      setActiveChannel(activeNotificationChannelId);
      markAllAsReadForChannel(activeNotificationChannelId);
    } else {
      setActiveChannel(null);
    }
    // O agente ativo vai junto: notificação órfã (sem canal) que chegar
    // enquanto o chat desse agente está aberto é lida na hora, não vira badge.
    setActiveAgent(agentId);
    return () => {
      if (donoDoCanal !== eu) return;
      donoDoCanal = null;
      setActiveChannel(null);
      setActiveAgent(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeNotificationChannelId, agentId, ativa]);

  // When the tab/window becomes visible or focused again, re-sweep the active
  // channel so notifications that arrived while the app was in background
  // (but with this chat already open) are cleared without needing to switch chats.
  useEffect(() => {
    if (!ativa || !activeNotificationChannelId) return;
    const sweep = () => {
      if (document.visibilityState === "visible") {
        markAllAsReadForChannel(activeNotificationChannelId);
      }
    };
    document.addEventListener("visibilitychange", sweep);
    window.addEventListener("focus", sweep);
    return () => {
      document.removeEventListener("visibilitychange", sweep);
      window.removeEventListener("focus", sweep);
    };
  }, [activeNotificationChannelId, markAllAsReadForChannel, ativa]);
}
