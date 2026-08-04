import { createElement, useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAgentIdAliases } from "@/lib/agent-id";
import { toast } from "sonner";
import { playNotificationSound } from "@/lib/notification-sound";
import { showNotification as showBrowserNotification } from "@/lib/browser-notifications";

export interface Notification {
  id: string;
  user_id: string;
  // Nulo quando a notificação é de DM de agente e o canal não pôde ser
  // resolvido (dm-agent-reply insere assim). O tipo dizia `string` enquanto
  // banco e edge function gravam nulo — e foi por isso que os agregadores
  // foram escritos sem guarda e essas linhas sumiam da contagem.
  channel_id: string | null;
  message_id: string | null;
  agent_id?: string | null;
  author_name: string;
  content_preview: string;
  read: boolean;
  created_at: string;
}

export function useNotifications(userId: string | undefined) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const initialLoadDone = useRef(false);
  const activeChannelRef = useRef<string | null>(null);
  // Agente cujo chat está aberto agora. Complementa activeChannelRef para as
  // notificações que chegam SEM canal (agent_id apenas): quem está olhando o
  // chat não deve ganhar badge pela mensagem que está vendo.
  const activeAgentRef = useRef<string | null>(null);
  const notificationsRef = useRef<Notification[]>([]);
  const lastToastRef = useRef<Map<string, number>>(new Map());
  const clearedChannelsRef = useRef<Set<string>>(new Set());
  // Message IDs that were just manually flagged as "unread" by the local user.
  // The realtime INSERT handler must NOT auto-mark these as read even if the
  // user is in the active channel — that's the whole point of the action.
  const manualUnreadMessageIdsRef = useRef<Set<string>>(new Set());

  const navigateToChannel = (channelId: string, threadRootId?: string | null) => {
    window.dispatchEvent(
      new CustomEvent("navigate-to-channel", {
        detail: { channelId, threadRootId: threadRootId ?? null },
      })
    );
  };

  const getNotificationAgentId = (notification: Notification) => {
    const agentId = notification.agent_id?.trim();
    return agentId ? agentId : null;
  };

  const navigateToNotification = (notification: Notification) => {
    const agentId = getNotificationAgentId(notification);
    if (agentId) {
      window.dispatchEvent(new CustomEvent("navigate-to-agent", { detail: { agentId } }));
      return;
    }
    if (notification.channel_id) {
      navigateToChannel(notification.channel_id, notification.message_id);
    }
  };

  const renderNotificationToast = (toastId: string | number, notification: Notification) => {
    const isThreadReply = !!notification.message_id && !getNotificationAgentId(notification);
    return createElement(
      "button",
      {
        type: "button",
        onClick: () => {
          navigateToNotification(notification);
          toast.dismiss(toastId);
        },
        className:
          "w-full max-w-sm rounded-lg border border-border bg-background/95 px-4 py-3 text-left shadow-lg backdrop-blur-sm transition-colors hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring",
      },
      createElement(
        "div",
        { className: "flex items-center gap-2 text-sm font-semibold text-foreground" },
        isThreadReply
          ? createElement("span", { className: "rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary" }, "💬 Resposta")
          : null,
        createElement("span", null, `Nova mensagem de ${notification.author_name}`)
      ),
      notification.content_preview
        ? createElement(
            "div",
            { className: "mt-1 line-clamp-2 text-sm text-muted-foreground" },
            notification.content_preview.slice(0, 80)
          )
        : null
    );
  };

  useEffect(() => {
    notificationsRef.current = notifications;
  }, [notifications]);

  const removeNotificationsForChannel = (channelId: string) => {
    const current = notificationsRef.current;
    const removedUnread = current.filter((n) => n.channel_id === channelId && !n.read).length;
    const next = current.filter((n) => n.channel_id !== channelId);

    notificationsRef.current = next;
    setNotifications(next);

    if (removedUnread > 0) {
      setUnreadCount((count) => Math.max(0, count - removedUnread));
    }
  };

  // Fetch initial notifications — only unread
  useEffect(() => {
    if (!userId) {
      setNotifications([]);
      setUnreadCount(0);
      initialLoadDone.current = false;
      return;
    }
    initialLoadDone.current = false;

    (async () => {
      const { data } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", userId)
        .eq("read", false)
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) {
        const typed = data as unknown as Notification[];

        // Filter out notifications for channels already cleared locally
        const filtered = typed.filter(
          (n) => !(n.channel_id && clearedChannelsRef.current.has(n.channel_id))
        );

        setNotifications(filtered);
        setUnreadCount(filtered.filter((n) => !n.read).length);

        // If a channel is already active, clear its notifications
        const active = activeChannelRef.current;
        if (active) {
          const unreadIdsForActive = filtered
            .filter((n) => n.channel_id === active && !n.read)
            .map((n) => n.id);

          if (unreadIdsForActive.length > 0) {
            setNotifications((prev) => prev.filter((n) => n.channel_id !== active));
            setUnreadCount((c) => Math.max(0, c - unreadIdsForActive.length));
            void supabase
              .from("notifications")
              .update({ read: true })
              .in("id", unreadIdsForActive);
          }
        }
      }
      initialLoadDone.current = true;
    })();
  }, [userId]);

  // Realtime subscription — with status logging, auto-retry, and reconnect on
  // visibility change. A silent dropped WebSocket was a major cause of "às
  // vezes as notificações não chegam".
  useEffect(() => {
    if (!userId) return;

    let currentChannel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    // Last known status of the realtime channel. Used so visibilitychange
    // doesn't resubscribe a perfectly healthy channel (which caused the
    // CLOSED → retry loop and the notification delays).
    let lastStatus: string | null = null;
    let retryAttempt = 0;

    const handleInsert = (payload: any) => {
      const newNotif = payload.new as unknown as Notification;

      const tabActive =
        typeof document !== "undefined" &&
        !document.hidden &&
        document.visibilityState === "visible" &&
        document.hasFocus();

      // Exige canal de verdade: sem o guard, uma notificação de agente com
      // channel_id nulo casava com activeChannelRef nulo (null === null) e era
      // marcada como lida na chegada sempre que nenhum canal estivesse ativo
      // com a aba focada — a mensagem sumia sem nunca acender badge nenhum.
      const isActiveChannel =
        !!newNotif.channel_id && activeChannelRef.current === newNotif.channel_id;
      // Notificação sem canal mas com agente: conta como "estou olhando" se o
      // chat aberto é o desse agente (comparando por alias, porque o agent_id
      // gravado pode ser uma variação do id canônico).
      const notifAgentId = getNotificationAgentId(newNotif);
      const isActiveAgent =
        !newNotif.channel_id &&
        !!notifAgentId &&
        !!activeAgentRef.current &&
        getAgentIdAliases(activeAgentRef.current).includes(notifAgentId);
      const wasManualUnread =
        !!newNotif.message_id && manualUnreadMessageIdsRef.current.has(newNotif.message_id);
      if (wasManualUnread && newNotif.message_id) {
        manualUnreadMessageIdsRef.current.delete(newNotif.message_id);
        if (newNotif.channel_id) clearedChannelsRef.current.delete(newNotif.channel_id);
      }

      // Auto-mark-as-read ONLY when the user is actively viewing THIS exact
      // channel right now. Visiting it in the past (clearedChannelsRef) is
      // NOT a reason to suppress future notifications — that was the bug
      // making messages disappear after switching channels.
      if (!wasManualUnread && (isActiveChannel || isActiveAgent) && tabActive) {
        void supabase
          .from("notifications")
          .update({ read: true })
          .eq("id", newNotif.id);
        return;
      }

      setNotifications((prev) => {
        if (prev.some((n) => n.id === newNotif.id)) return prev;
        return [newNotif, ...prev].slice(0, 50);
      });
      setUnreadCount((c) => c + 1);

      if (initialLoadDone.current) {
        // Sound dedupe (800ms) — prevents audio spam for rapid bursts,
        // but TOAST and OS notification ALWAYS fire so the user sees them.
        const dedupeKey = `${newNotif.channel_id}:${newNotif.author_name}`;
        const now = Date.now();
        const lastTime = lastToastRef.current.get(dedupeKey) || 0;
        if (now - lastTime > 800) {
          lastToastRef.current.set(dedupeKey, now);
          playNotificationSound();
        }

        toast.custom(
          (toastId) => renderNotificationToast(toastId, newNotif),
          { position: "top-right" }
        );

        const shouldNotifyOS =
          document.hidden || activeChannelRef.current !== newNotif.channel_id;
        if (shouldNotifyOS) {
          const agentId = getNotificationAgentId(newNotif);
          const targetUrl = agentId
            ? `/chat?agent=${encodeURIComponent(agentId)}`
            : newNotif.channel_id
              ? `/chat?channel=${encodeURIComponent(newNotif.channel_id)}${
                  newNotif.message_id ? `&thread=${encodeURIComponent(newNotif.message_id)}` : ""
                }`
              : "/chat";
          const uniqueTag = `msg-${newNotif.id}`;
          showBrowserNotification({
            title: `Nova mensagem de ${newNotif.author_name}`,
            body: newNotif.content_preview?.slice(0, 120),
            tag: uniqueTag,
            url: targetUrl,
            onClick: () => navigateToNotification(newNotif),
          });
        }
      }
    };

    const handleUpdate = (payload: any) => {
      const updated = payload.new as Notification;
      const previous = payload.old as Partial<Notification> | undefined;
      if (!updated?.id) return;

      const wasUnread = previous?.read === false || previous?.read === undefined;
      if (!updated.read || !wasUnread) return;

      const current = notificationsRef.current;
      const existed = current.some((n) => n.id === updated.id && !n.read);
      if (!existed) return;

      const next = current.filter((n) => n.id !== updated.id);
      notificationsRef.current = next;
      setNotifications(next);
      setUnreadCount((c) => Math.max(0, c - 1));
    };

    const subscribe = async () => {
      if (cancelled) return;
      // Tear down any previous channel and WAIT for the server to confirm,
      // otherwise the new socket races the old one and the server closes it
      // (which produced the endless CLOSED → retry loop).
      if (currentChannel) {
        try { await supabase.removeChannel(currentChannel); } catch { /* noop */ }
        currentChannel = null;
      }
      if (cancelled) return;

      // Stable channel name — no Date.now() — so we don't churn server-side
      // subscriptions every time visibilitychange fires.
      const ch = supabase
        .channel(`notifications-${userId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          handleInsert
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${userId}`,
          },
          handleUpdate
        )
        .subscribe((status) => {
          lastStatus = status;
          if (status === "SUBSCRIBED") {
            retryAttempt = 0;
            console.log("[notifications] realtime SUBSCRIBED");
          } else if (
            status === "CHANNEL_ERROR" ||
            status === "TIMED_OUT" ||
            status === "CLOSED"
          ) {
            // Exponential backoff capped at 30s — avoids hammering the
            // server when the connection is flapping.
            const delay = Math.min(30000, 2000 * Math.pow(2, retryAttempt));
            retryAttempt = Math.min(retryAttempt + 1, 5);
            console.warn(
              "[notifications] realtime status:",
              status,
              `→ retry in ${Math.round(delay / 1000)}s`
            );
            if (retryTimer) clearTimeout(retryTimer);
            retryTimer = setTimeout(() => { void subscribe(); }, delay);
          }
        });
      currentChannel = ch;
    };

    void subscribe();

    // Only resubscribe on visibility change if the channel is NOT currently
    // SUBSCRIBED — a healthy channel should be left alone.
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (lastStatus === "SUBSCRIBED") return;
      console.log("[notifications] tab visible & channel not subscribed → refreshing realtime channel");
      void subscribe();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      if (retryTimer) clearTimeout(retryTimer);
      if (currentChannel) void supabase.removeChannel(currentChannel);
    };
  }, [userId]);

  async function markAsRead(notifId: string) {
    const notification = notificationsRef.current.find((item) => item.id === notifId);
    setNotifications((prev) => prev.filter((item) => item.id !== notifId));

    if (notification && !notification.read) {
      setUnreadCount((c) => Math.max(0, c - 1));
    }

    await supabase.from("notifications").update({ read: true }).eq("id", notifId);
  }

  async function markAllAsReadForChannel(channelId: string) {
    if (!userId || !channelId) return;

    removeNotificationsForChannel(channelId);
    clearedChannelsRef.current.add(channelId);

    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("channel_id", channelId)
      .eq("read", false);
  }

  /**
   * Defensive sweep: marks as read every notification belonging to any DM channel
   * where `agentId` is an agent member. Covers "ghost" notifications produced by
   * channel-broadcast (which inserts notifications pointing to a channel UUID
   * the frontend never resolves back to the agentId).
   */
  async function markAllAsReadForAgent(agentId: string) {
    if (!userId || !agentId) return;
    const aliases = getAgentIdAliases(agentId);
    if (aliases.length === 0) return;

    // 1. Find all DM channels where this agent is a member
    const { data: memberRows } = await supabase
      .from("channel_members")
      .select("channel_id")
      .in("user_id", aliases)
      .eq("member_type", "agent");

    const channelIds = (memberRows ?? []).map((r: any) => r.channel_id);

    // Mark channel DMs as cleared locally so future realtime inserts auto-read
    for (const cid of channelIds) clearedChannelsRef.current.add(cid);

    // 2. Update local state — remove unread for those channels AND any
    // notification carrying this agent_id directly (DMs inserted with
    // channel_id = NULL by dm-agent-reply).
    const matches = (n: Notification) =>
      (!!n.channel_id && channelIds.includes(n.channel_id)) ||
      aliases.includes((n as any).agent_id);

    const current = notificationsRef.current;
    const removedUnread = current.filter((n) => matches(n) && !n.read).length;
    const next = current.filter((n) => !matches(n));
    notificationsRef.current = next;
    setNotifications(next);
    if (removedUnread > 0) {
      setUnreadCount((c) => Math.max(0, c - removedUnread));
    }

    // 3. Persist — two queries: by channel_id list, and by agent_id alias.
    if (channelIds.length > 0) {
      await supabase
        .from("notifications")
        .update({ read: true })
        .eq("user_id", userId)
        .eq("read", false)
        .in("channel_id", channelIds);
    }
    await supabase
      .from("notifications")
      .update({ read: true })
      .eq("user_id", userId)
      .eq("read", false)
      .in("agent_id", aliases);
  }

  /**
   * Re-flag a single message as "unread" for the current user.
   * Inserts a fresh notification row pointing to that message. The realtime
   * handler is told (via manualUnreadMessageIdsRef) to NOT auto-mark it as read
   * even though the user is currently in the active channel — that's the
   * whole point of the action.
   */
  async function markMessageAsUnread(args: {
    messageId: string;
    channelId: string | null;
    agentId?: string | null;
    authorName: string;
    contentPreview: string;
  }): Promise<boolean> {
    if (!userId || !args.messageId) return false;

    manualUnreadMessageIdsRef.current.add(args.messageId);
    if (args.channelId) clearedChannelsRef.current.delete(args.channelId);

    const { error } = await supabase.from("notifications").insert({
      user_id: userId,
      channel_id: args.channelId ?? null,
      agent_id: args.agentId ?? null,
      message_id: args.messageId,
      author_name: args.authorName || "Mensagem",
      content_preview: (args.contentPreview || "").slice(0, 200),
      read: false,
    } as any);

    if (error) {
      manualUnreadMessageIdsRef.current.delete(args.messageId);
      console.warn("[useNotifications] markMessageAsUnread failed:", error);
      return false;
    }
    return true;
  }

  function setActiveChannel(channelId: string | null) {
    const previous = activeChannelRef.current;
    activeChannelRef.current = channelId;

    // When leaving a channel, remove it from the "cleared" set so future
    // messages for it will properly notify (otherwise once visited, a channel
    // would silently swallow notifications forever while the tab was active).
    if (previous && previous !== channelId) {
      clearedChannelsRef.current.delete(previous);
    }

    if (channelId && userId) {
      clearedChannelsRef.current.add(channelId);
      removeNotificationsForChannel(channelId);
    }
  }

  function setActiveAgent(agentId: string | null) {
    activeAgentRef.current = agentId;
  }

  const unreadByChannel = notifications.reduce<Record<string, number>>((acc, n) => {
    if (!n.read && n.channel_id) {
      acc[n.channel_id] = (acc[n.channel_id] || 0) + 1;
    }

    return acc;
  }, {});

  // Notificações de agente SEM canal (dm-agent-reply grava channel_id nulo
  // quando o canal de DM não resolve). Só as sem canal, de propósito: uma
  // linha com os dois campos já conta em unreadByChannel, e contá-la aqui de
  // novo dobraria o badge. Quem exibe soma os dois mapas.
  const unreadByAgentOnly = notifications.reduce<Record<string, number>>((acc, n) => {
    if (!n.read && !n.channel_id && n.agent_id) {
      acc[n.agent_id] = (acc[n.agent_id] || 0) + 1;
    }

    return acc;
  }, {});

  return {
    notifications,
    unreadCount,
    unreadByChannel,
    unreadByAgentOnly,
    markAsRead,
    markAllAsReadForChannel,
    markAllAsReadForAgent,
    markMessageAsUnread,
    setActiveChannel,
    setActiveAgent,
  };
}

