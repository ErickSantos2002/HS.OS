import { api } from "@/lib/api";
import React, { createContext, useContext, useState, useEffect, useMemo } from "react";
import { useNotifications, type Notification } from "@/hooks/use-notifications";
import { useAuthContext } from "@/contexts/auth-context";
import { AGENT_UNREAD_EVENT, clearUnreadAgent, getUnreadAgentCount, getUnreadAgentIds } from "@/lib/chat-sender";
import { getAgentIdAliases } from "@/lib/agent-id";
import { NotificationsPermissionBanner } from "@/components/NotificationsPermissionBanner";
import { supabase } from "@/integrations/supabase/client";

interface NotificationsContextValue {
  notifications: Notification[];
  unreadCount: number;
  unreadByChannel: Record<string, number>;
  // Não lidas de agente SEM canal (channel_id nulo) — invisíveis para
  // unreadByChannel. Quem exibe badge de agente soma os dois mapas.
  unreadByAgentOnly: Record<string, number>;
  markAsRead: (id: string) => Promise<void>;
  markAllAsReadForChannel: (channelId: string) => Promise<void>;
  markAllAsReadForAgent: (agentId: string) => Promise<void>;
  markMessageAsUnread: (args: {
    messageId: string;
    channelId: string | null;
    agentId?: string | null;
    authorName: string;
    contentPreview: string;
  }) => Promise<boolean>;
  setActiveChannel: (channelId: string | null) => void;
  setActiveAgent: (agentId: string | null) => void;
}

const fallbackNotificationsContext: NotificationsContextValue = {
  notifications: [],
  unreadCount: 0,
  unreadByChannel: {},
  unreadByAgentOnly: {},
  markAsRead: async () => undefined,
  markAllAsReadForChannel: async () => undefined,
  markAllAsReadForAgent: async () => undefined,
  markMessageAsUnread: async () => false,
  setActiveChannel: () => undefined,
  setActiveAgent: () => undefined,
};


const NotificationsContext = createContext<NotificationsContextValue>(fallbackNotificationsContext);

const BASE_DOC_TITLE = "HS.OS";

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuthContext();
  const notifs = useNotifications(user?.id);

  const [agentUnreadCount, setAgentUnreadCount] = useState(() => getUnreadAgentCount());
  const [agentUnreadIds, setAgentUnreadIds] = useState<string[]>(() => getUnreadAgentIds());

  useEffect(() => {
    const handler = () => {
      setAgentUnreadCount(getUnreadAgentCount());
      setAgentUnreadIds(getUnreadAgentIds());
    };
    window.addEventListener(AGENT_UNREAD_EVENT, handler);
    return () => window.removeEventListener(AGENT_UNREAD_EVENT, handler);
  }, []);

  // Auto-subscribe to Web Push on app load if permission is already granted.
  useEffect(() => {
    if (!user?.id) return;
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    import("@/lib/push-notifications").then(({ subscribeToPushNotifications }) => {
      subscribeToPushNotifications(user.id).catch((e) =>
        console.warn("[NotificationsProvider] push auto-subscribe failed:", e)
      );
    });
  }, [user?.id]);

  // Handle Service Worker action messages: "Marcar como lida" and quick-reply.
  useEffect(() => {
    if (!user?.id) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    const onSwMessage = async (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; notificationId?: string | null; channelId?: string | null; text?: string }
        | undefined;
      if (!data?.type) return;

      if (data.type === "mark-notification-read") {
        try {
          if (data.notificationId) {
            await notifs.markAsRead(data.notificationId);
          } else if (data.channelId) {
            await notifs.markAllAsReadForChannel(data.channelId);
          }
        } catch (e) {
          console.warn("[NotificationsProvider] mark-read from SW failed:", e);
        }
        return;
      }

      if (data.type === "quick-reply" && data.channelId && data.text) {
        try {
          const { data: profile } = await api<any>("/profiles/me").then((d) => ({ data: d })).catch(() => ({ data: null }));
          const displayName =
            (profile?.full_name?.trim()) || user.email?.split("@")[0] || "Usuário";
          await supabase.from("channel_messages").insert({
            channel_id: data.channelId,
            author_id: user.id,
            author_type: "human",
            author_name: displayName,
            content: data.text,
            author_avatar: profile?.avatar_url || null,
          } as any);
          await notifs.markAllAsReadForChannel(data.channelId);
        } catch (e) {
          console.warn("[NotificationsProvider] quick-reply from SW failed:", e);
        }
      }
    };

    navigator.serviceWorker.addEventListener("message", onSwMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onSwMessage);
  }, [user?.id, notifs]);

  // Handle direct URL params from SW openWindow (?mark_read=<id>)
  useEffect(() => {
    if (!user?.id) return;
    const params = new URLSearchParams(window.location.search);
    const markReadId = params.get("mark_read");
    if (!markReadId) return;
    notifs.markAsRead(markReadId).catch((e) =>
      console.warn("[NotificationsProvider] URL mark_read failed:", e)
    );
    // Clean URL
    params.delete("mark_read");
    const newSearch = params.toString();
    const newUrl = `${window.location.pathname}${newSearch ? `?${newSearch}` : ""}${window.location.hash}`;
    window.history.replaceState({}, "", newUrl);
  }, [user?.id, notifs]);

  // Map agentId → DM channelId so we can detect overlap with DB-counted unreads.
  // Cached lazily; refreshed when the set of unread agents changes.
  const [agentToDmChannel, setAgentToDmChannel] = useState<Record<string, string>>({});

  // Set of channel_ids whose DM target is "unreachable" from the UI
  // (e.g. agent member with invalid/emoji ID not present in catalog).
  // These notifications must be ignored in the global unread badge so they
  // don't become permanent ghost counters.
  const [ghostChannelIds, setGhostChannelIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!user?.id) return;
    const channelIds = Object.keys(notifs.unreadByChannel);
    if (channelIds.length === 0) {
      if (ghostChannelIds.size > 0) setGhostChannelIds(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("channel_members")
        .select("channel_id, user_id, member_type")
        .in("channel_id", channelIds);
      if (cancelled || !data) return;
      const validId = /^[a-z0-9_-]+$/;
      const ghosts = new Set<string>();
      const byChannel: Record<string, { agents: string[]; humans: string[] }> = {};
      for (const row of data as any[]) {
        if (!byChannel[row.channel_id]) byChannel[row.channel_id] = { agents: [], humans: [] };
        if (row.member_type === "agent") byChannel[row.channel_id].agents.push(row.user_id);
        else byChannel[row.channel_id].humans.push(row.user_id);
      }
      for (const cid of channelIds) {
        const m = byChannel[cid];
        if (!m) continue;
        // Mark as ghost if it's an agent DM with an invalid agent id.
        if (m.agents.length > 0 && m.agents.every((id) => !validId.test(id))) {
          ghosts.add(cid);
        }
      }
      setGhostChannelIds(ghosts);
    })();
    return () => { cancelled = true; };
  }, [Object.keys(notifs.unreadByChannel).join(","), user?.id]);

  useEffect(() => {
    if (!user?.id || agentUnreadIds.length === 0) return;
    const missing = agentUnreadIds.filter((id) => !(id in agentToDmChannel));
    if (missing.length === 0) return;

    let cancelled = false;
    void (async () => {
      // Find DM channels where these agents are members AND the current user is also a member
      const { data: agentRows } = await supabase
        .from("channel_members")
        .select("channel_id, user_id")
        .in("user_id", missing)
        .eq("member_type", "agent");

      if (cancelled || !agentRows || agentRows.length === 0) return;

      const channelIds = Array.from(new Set(agentRows.map((r: any) => r.channel_id)));
      const { data: userRows } = await supabase
        .from("channel_members")
        .select("channel_id")
        .eq("user_id", user.id)
        .eq("member_type", "human")
        .in("channel_id", channelIds);

      if (cancelled) return;
      const userChannelSet = new Set((userRows ?? []).map((r: any) => r.channel_id));

      const next: Record<string, string> = {};
      for (const row of agentRows as any[]) {
        if (userChannelSet.has(row.channel_id)) {
          next[row.user_id] = row.channel_id;
          clearUnreadAgent(row.user_id);
        }
      }
      if (Object.keys(next).length > 0) {
        setAgentToDmChannel((prev) => ({ ...prev, ...next }));
      }
    })();

    return () => { cancelled = true; };
  }, [agentUnreadIds, user?.id, agentToDmChannel]);

  // Deduplicate: if an agent's DM channel already has an unread row in DB,
  // don't double-count it via the localStorage agentUnread tracker.
  const deduplicatedUnreadCount = useMemo(() => {
    // Recount DB unreads excluding ghost channels (DMs to invalid agent IDs).
    const dbUnreadFiltered = Object.entries(notifs.unreadByChannel)
      .filter(([cid]) => !ghostChannelIds.has(cid))
      .reduce((acc, [, count]) => acc + (count as number), 0);
    // Órfãs de agente (channel_id nulo) — sem esta parcela, o título da aba e
    // o badge do PWA também ignoravam essas notificações.
    const dbAgentOnly = Object.values(notifs.unreadByAgentOnly)
      .reduce((acc, count) => acc + count, 0);
    const dbChannelIds = new Set(Object.keys(notifs.unreadByChannel));
    // Chaves do mapa de órfãs, expandidas por alias, para o rastreador local
    // não recontar um agente que já tem linha órfã no banco.
    const dbAgentOnlyIds = new Set(
      Object.keys(notifs.unreadByAgentOnly).flatMap((id) => getAgentIdAliases(id)),
    );
    const agentUnreadFiltered = agentUnreadIds.filter((agentId) => {
      if (getAgentIdAliases(agentId).some((alias) => dbAgentOnlyIds.has(alias))) return false;
      const dmChannel = agentToDmChannel[agentId];
      return !dmChannel || !dbChannelIds.has(dmChannel);
    }).length;
    return dbUnreadFiltered + dbAgentOnly + agentUnreadFiltered;
  }, [notifs.unreadCount, notifs.unreadByChannel, notifs.unreadByAgentOnly, agentUnreadIds, agentToDmChannel, ghostChannelIds]);

  // BUG 1 fix: reflect unread count in the browser tab title
  useEffect(() => {
    if (deduplicatedUnreadCount > 0) {
      document.title = `(${deduplicatedUnreadCount}) ${BASE_DOC_TITLE}`;
    } else {
      document.title = BASE_DOC_TITLE;
    }
    return () => {
      document.title = BASE_DOC_TITLE;
    };
  }, [deduplicatedUnreadCount]);

  // App Badging API — red dot/count on the installed app icon (desktop PWA, Android, some iOS).
  // Works on Chrome/Edge desktop, Safari macOS 16.4+, and Android Chrome when the app is installed.
  useEffect(() => {
    const nav = navigator as Navigator & {
      setAppBadge?: (count?: number) => Promise<void>;
      clearAppBadge?: () => Promise<void>;
    };
    try {
      if (deduplicatedUnreadCount > 0 && typeof nav.setAppBadge === "function") {
        void nav.setAppBadge(deduplicatedUnreadCount).catch(() => undefined);
      } else if (typeof nav.clearAppBadge === "function") {
        void nav.clearAppBadge().catch(() => undefined);
      }
    } catch {
      // Silently ignore on unsupported browsers
    }
  }, [deduplicatedUnreadCount]);

  const value = useMemo<NotificationsContextValue>(() => ({
    ...notifs,
    unreadCount: deduplicatedUnreadCount,
  }), [notifs, deduplicatedUnreadCount]);

  return (
    <NotificationsContext.Provider value={value}>
      <NotificationsPermissionBanner />
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotificationsContext() {
  return useContext(NotificationsContext);
}

