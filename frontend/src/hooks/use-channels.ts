import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";

export interface Channel {
  id: string;
  name: string;
  description: string | null;
  type: "public" | "private" | "dm";
  created_by: string;
  created_at: string;
}

export interface ChannelAttachment {
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

export interface ChannelMessage {
  id: string;
  channel_id: string;
  author_id: string;
  author_type: "human" | "agent";
  author_name: string;
  author_avatar: string | null;
  content: string;
  thread_id: string | null;
  created_at: string;
  audio_url: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  attachments: ChannelAttachment[] | null;
}

export interface ChannelMember {
  channel_id: string;
  user_id: string;
  joined_at: string;
  member_type?: string;
}

/** Reconcile messages: merge by ID (incoming overwrites), replace optimistic, sort chronologically */
const reconcileMessages = (prev: ChannelMessage[], incoming: ChannelMessage[]): ChannelMessage[] => {
  const byId = new Map(prev.map(m => [m.id, m]));
  for (const m of incoming) {
    // Replace optimistic message with real one
    const optimistic = [...byId.values()].find(
      x => x.id.startsWith("optimistic-") && x.author_id === m.author_id && x.content === m.content && !x.thread_id && !m.thread_id
    );
    if (optimistic) byId.delete(optimistic.id);
    byId.set(m.id, { ...(byId.get(m.id) || {}), ...m });
  }
  return [...byId.values()].sort((a, b) => +new Date(a.created_at) - +new Date(b.created_at));
};

let cachedChannels: Channel[] | null = null;

export function useChannels() {
  const { user } = useAuthContext();
  const [channels, setChannels] = useState<Channel[]>(cachedChannels || []);
  const [loading, setLoading] = useState(!cachedChannels);

  const fetchChannels = useCallback(async () => {
    if (!user) return;
    const { data } = await supabase
      .from("channels")
      .select("*")
      .order("created_at", { ascending: true });
    if (data) {
      cachedChannels = data as unknown as Channel[];
      setChannels(cachedChannels);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const createChannel = async (
    name: string,
    description: string,
    type: "public" | "private" | "dm",
    memberIds?: string[],
    agentIds?: string[]
  ): Promise<Channel | null> => {
    if (!user) return null;
    const { data, error } = await supabase
      .from("channels")
      .insert({ name, description: description || null, type, created_by: user.id } as any)
      .select()
      .single();
    if (error) {
      console.error("Erro ao criar canal:", error);
      return null;
    }
    if (!data) return null;
    const channel = data as unknown as Channel;

    // Add creator as member
    const { error: memberErr } = await supabase
      .from("channel_members")
      .insert({ channel_id: channel.id, user_id: user.id, member_type: "human" } as any);
    if (memberErr) console.error("Erro ao adicionar criador como membro:", memberErr);

    // Add human members
    if (memberIds?.length) {
      const inserts = memberIds
        .filter((id) => id !== user.id)
        .map((id) => ({ channel_id: channel.id, user_id: id, member_type: "human" }));
      if (inserts.length) await supabase.from("channel_members").insert(inserts as any);
    }

    // Add agent members
    if (agentIds?.length) {
      const inserts = agentIds.map((id) => ({
        channel_id: channel.id,
        user_id: id,
        member_type: "agent",
      }));
      await supabase.from("channel_members").insert(inserts as any);
    }

    await fetchChannels();
    return channel;
  };

  const joinChannel = async (channelId: string) => {
    if (!user) return;
    // Use upsert-like approach: ignore duplicate
    const { error } = await supabase
      .from("channel_members")
      .upsert(
        { channel_id: channelId, user_id: user.id, member_type: "human" } as any,
        { onConflict: "channel_id,user_id", ignoreDuplicates: true }
      );
    if (error) console.error("Join channel error:", error);
  };

  return { channels, loading, createChannel, joinChannel, refetch: fetchChannels };
}

/* ── Module-level message cache for instant hydration ── */
const channelMessageCache: Record<string, ChannelMessage[]> = {};
const CHANNEL_MESSAGES_CACHE_LIMIT = 200;

/** Prefetch channel messages into cache (no-op if already cached) */
export async function prefetchChannelMessages(channelId: string): Promise<void> {
  if (channelMessageCache[channelId]) return;
  const { data } = await supabase
    .from("channel_messages")
    .select("*")
    .eq("channel_id", channelId)
    .is("thread_id", null)
    .order("created_at", { ascending: false })
    .limit(CHANNEL_MESSAGES_CACHE_LIMIT);
  if (data) {
    data.reverse();
    channelMessageCache[channelId] = data as unknown as ChannelMessage[];
  }
}

export function useChannelMessages(channelId: string | null) {
  const [messages, setMessages] = useState<ChannelMessage[]>(
    channelId ? (channelMessageCache[channelId] ?? []) : []
  );
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!channelId) {
      setMessages([]);
      return;
    }

    // Hydrate immediately from cache
    const cached = channelMessageCache[channelId];
    if (cached) {
      setMessages(cached);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }

    // Buffer realtime events that arrive before initial load completes
    const pendingBuffer: ChannelMessage[] = [];
    const loadedRef = { current: !!cached };

    // Atomic state+cache updater (guarded by cancellation)
    const updateMessages = (fn: (prev: ChannelMessage[]) => ChannelMessage[]) => {
      if (cancelled) return;
      setMessages(prev => {
        const next = fn(prev);
        channelMessageCache[channelId] = next;
        return next;
      });
    };

    // Background revalidation
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from("channel_messages")
          .select("*")
          .eq("channel_id", channelId)
          .is("thread_id", null)
          .order("created_at", { ascending: false })
          .limit(CHANNEL_MESSAGES_CACHE_LIMIT);
        if (cancelled) return;
        if (error) {
          console.error("Failed to load channel messages:", error);
          setLoading(false);
          loadedRef.current = true;
          return;
        }
        if (data) {
          data.reverse();
          const msgs = data as unknown as ChannelMessage[];
          if (msgs.length === 0 && (channelMessageCache[channelId]?.length ?? 0) > 0) {
            const buffered = pendingBuffer.splice(0);
            if (buffered.length > 0) {
              updateMessages(prev => reconcileMessages(prev, buffered));
            }
          } else {
            const buffered = pendingBuffer.splice(0);
            updateMessages(prev => reconcileMessages(prev, [...msgs, ...buffered]));
          }
        }
        if (cancelled) return;
        setLoading(false);
        loadedRef.current = true;
      } catch (err) {
        console.error("Channel messages load exception:", err);
        if (cancelled) return;
        setLoading(false);
        loadedRef.current = true;
      }
    };
    load();

    // Re-sync when tab regains focus
    const resync = () => {
      if (cancelled) return;
      if (document.visibilityState === "visible") {
        load();
      }
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);

    // Realtime subscription
    const channel = supabase
      .channel(`channel-messages-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (cancelled) return;
          const msg = payload.new as unknown as ChannelMessage;
          if (!msg.thread_id) {
            if (!loadedRef.current) {
              pendingBuffer.push(msg);
              return;
            }
            updateMessages(prev => reconcileMessages(prev, [msg]));
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (cancelled) return;
          const updated = payload.new as unknown as ChannelMessage;
          updateMessages(prev => reconcileMessages(prev, [updated]));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          if (cancelled) return;
          const deletedId = (payload.old as any)?.id;
          if (deletedId) {
            updateMessages(prev => prev.filter(m => m.id !== deletedId));
          }
        }
      )
      .subscribe();

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  /**
   * Ensure a specific message (by id) is loaded into state.
   * Used by deep-links from search to scroll to older messages
   * that fell outside the default page of CHANNEL_MESSAGES_CACHE_LIMIT.
   */
  const ensureMessageLoaded = useCallback(async (messageId: string): Promise<boolean> => {
    if (!channelId || !messageId) return false;
    // Already in cache?
    if ((channelMessageCache[channelId] ?? []).some((m) => m.id === messageId)) return true;

    // Fetch the target message
    const { data: target, error: targetErr } = await supabase
      .from("channel_messages")
      .select("*")
      .eq("id", messageId)
      .maybeSingle();
    if (targetErr || !target) return false;

    // Load everything from that timestamp forward (the message + newer context),
    // so we render a contiguous range from target → now.
    const { data: range } = await supabase
      .from("channel_messages")
      .select("*")
      .eq("channel_id", channelId)
      .is("thread_id", null)
      .gte("created_at", (target as any).created_at)
      .order("created_at", { ascending: true });

    const incoming = ((range as unknown as ChannelMessage[]) ?? []).concat([target as unknown as ChannelMessage]);
    setMessages((prev) => {
      const next = reconcileMessages(prev, incoming);
      channelMessageCache[channelId] = next;
      return next;
    });
    return true;
  }, [channelId]);




  const sendMessage = useCallback(async (
    channelId: string,
    authorId: string,
    authorName: string,
    content: string,
    authorType: "human" | "agent" = "human",
    authorAvatar?: string | null,
    audioUrl?: string | null,
    attachments?: ChannelAttachment[] | null,
    threadId?: string | null
  ) => {
    // Fallback: if profile context hasn't populated avatar yet, fetch it once
    // so replies (especially in threads) don't end up with a missing avatar.
    let resolvedAvatar = authorAvatar ?? null;
    let resolvedName = authorName;
    if (authorType === "human" && (!resolvedAvatar || !resolvedName || resolvedName.includes("@"))) {
      try {
        const { data: prof } = await supabase
          .from("profiles")
          .select("avatar_url, full_name")
          .eq("id", authorId)
          .maybeSingle();
        if (prof) {
          if (!resolvedAvatar && prof.avatar_url) resolvedAvatar = prof.avatar_url;
          if ((!resolvedName || resolvedName.includes("@")) && prof.full_name) resolvedName = prof.full_name;
        }
      } catch {
        // best-effort only
      }
    }

    // Optimistic: add message to state immediately
    const optimisticMsg: ChannelMessage = {
      id: `optimistic-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      channel_id: channelId,
      author_id: authorId,
      author_type: authorType,
      author_name: resolvedName,
      author_avatar: resolvedAvatar,
      content,
      thread_id: threadId ?? null,
      created_at: new Date().toISOString(),
      audio_url: audioUrl || null,
      edited_at: null,
      deleted_at: null,
      attachments: attachments || null,
    };
    if (!threadId) {
      setMessages(prev => {
        const next = [...prev, optimisticMsg];
        channelMessageCache[channelId] = next;
        return next;
      });
    } else {
      // Optimistically reflect the reply inside any open ThreadPanel
      const { pushOptimisticThreadMessage } = await import("@/hooks/use-channel-threads");
      pushOptimisticThreadMessage(channelId, optimisticMsg);
    }

    // Insert into DB (Realtime will replace the optimistic msg)
    const { error } = await supabase.from("channel_messages").insert({
      channel_id: channelId,
      author_id: authorId,
      author_type: authorType,
      author_name: resolvedName,
      content,
      author_avatar: resolvedAvatar,
      audio_url: audioUrl || null,
      attachments: attachments || null,
      thread_id: threadId ?? null,
    } as any);

    if (error) {
      // Rollback optimistic message on failure
      if (!threadId) {
        setMessages(prev => {
          const next = prev.filter(m => m.id !== optimisticMsg.id);
          channelMessageCache[channelId] = next;
          return next;
        });
      }
      console.error("Send message error:", error);
    }
  }, []);

  return { messages, loading, sendMessage, ensureMessageLoaded };
}

export function useChannelMembers(channelId: string | null, refreshKey?: number) {
  const [members, setMembers] = useState<ChannelMember[]>([]);

  useEffect(() => {
    if (!channelId) {
      setMembers([]);
      return;
    }

    let isActive = true;

    const loadMembers = async () => {
      const { data } = await supabase
        .from("channel_members")
        .select("*")
        .eq("channel_id", channelId);

      if (isActive && data) {
        setMembers(data as unknown as ChannelMember[]);
      }
    };

    void loadMembers();

    const channel = supabase
      .channel(`channel-members-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "channel_members",
          filter: `channel_id=eq.${channelId}`,
        },
        () => {
          void loadMembers();
        }
      )
      .subscribe();

    return () => {
      isActive = false;
      supabase.removeChannel(channel);
    };
  }, [channelId, refreshKey]);

  return members;
}
