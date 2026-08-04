import { useEffect, useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import type { ChannelMessage } from "@/hooks/use-channels";

export interface ThreadMeta {
  count: number;
  lastReplyAt: string;
  lastAuthorName: string;
  lastAuthorAvatar: string | null;
}

type ThreadMetaMap = Record<string, ThreadMeta>;

const threadMessageCache: Record<string, ChannelMessage[]> = {};

function getThreadKey(channelId: string, rootMessageId: string) {
  return `${channelId}:${rootMessageId}`;
}

/**
 * Optimistically inject a thread reply into the cache and notify any open ThreadPanel
 * so the reply appears instantly without waiting for the Realtime round-trip.
 */
export function pushOptimisticThreadMessage(channelId: string, message: ChannelMessage) {
  if (!message.thread_id) return;
  const key = getThreadKey(channelId, message.thread_id);
  const current = threadMessageCache[key] ?? [];
  if (current.some((m) => m.id === message.id)) return;
  threadMessageCache[key] = [...current, message];
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("thread-message-optimistic", {
        detail: { channelId, rootMessageId: message.thread_id, message },
      }),
    );
  }
}

const VIEWED_KEY = (rootId: string) => `thread-last-viewed:${rootId}`;

export function getThreadLastViewed(rootId: string): number {
  if (typeof window === "undefined") return 0;
  const v = window.localStorage.getItem(VIEWED_KEY(rootId));
  return v ? Number(v) : 0;
}

/**
 * Marca a thread como visualizada.
 *
 * IMPORTANTE: o timestamp deve ser baseado no created_at do servidor do último reply
 * conhecido (não em Date.now() do cliente). Usar Date.now() causa falsos "não lidos"
 * por skew de relógio entre cliente e servidor e por replies de realtime que chegam
 * logo após o clique. Adicionamos 1s de buffer para absorver microssegundos de jitter.
 */
export function markThreadViewed(rootId: string, lastReplyAt?: string | number | null) {
  if (typeof window === "undefined") return;
  let ts: number;
  if (lastReplyAt != null && lastReplyAt !== "") {
    const parsed = typeof lastReplyAt === "number" ? lastReplyAt : new Date(lastReplyAt).getTime();
    ts = Number.isFinite(parsed) ? parsed + 1000 : Date.now();
  } else {
    ts = Date.now();
  }
  const prev = Number(window.localStorage.getItem(VIEWED_KEY(rootId)) ?? 0);
  // Nunca diminuir o "visto até" — eventos fora de ordem podem trazer ts menor.
  if (ts < prev) ts = prev;
  window.localStorage.setItem(VIEWED_KEY(rootId), String(ts));
  window.dispatchEvent(new CustomEvent("thread-viewed", { detail: { rootId } }));
}

export function useThreadCounts(channelId: string | null) {
  const [meta, setMeta] = useState<ThreadMetaMap>({});

  useEffect(() => {
    if (!channelId) {
      setMeta({});
      return;
    }

    const load = async () => {
      const { data } = await supabase
        .from("channel_messages")
        .select("thread_id, created_at, author_id, author_type, author_name, author_avatar")
        .eq("channel_id", channelId)
        .not("thread_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(1000);

      type Row = { thread_id: string | null; created_at: string; author_id: string; author_type: string; author_name: string; author_avatar: string | null };
      const next: ThreadMetaMap = {};
      const lastAuthorByThread: Record<string, { id: string; type: string }> = {};
      for (const row of (data as Row[]) ?? []) {
        if (!row.thread_id) continue;
        const cur = next[row.thread_id];
        if (!cur) {
          next[row.thread_id] = {
            count: 1,
            lastReplyAt: row.created_at,
            lastAuthorName: row.author_name,
            lastAuthorAvatar: row.author_avatar,
          };
          lastAuthorByThread[row.thread_id] = { id: row.author_id, type: row.author_type };
        } else {
          cur.count += 1;
          if (new Date(row.created_at) >= new Date(cur.lastReplyAt)) {
            cur.lastReplyAt = row.created_at;
            cur.lastAuthorName = row.author_name;
            cur.lastAuthorAvatar = row.author_avatar;
            lastAuthorByThread[row.thread_id] = { id: row.author_id, type: row.author_type };
          }
        }
      }

      // Fallback: resolve missing avatars for human authors from profiles
      const missingHumanIds = Array.from(
        new Set(
          Object.entries(next)
            .filter(([tid, m]) => !m.lastAuthorAvatar && lastAuthorByThread[tid]?.type === "human")
            .map(([tid]) => lastAuthorByThread[tid].id),
        ),
      );
      if (missingHumanIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, avatar_url, full_name")
          .in("id", missingHumanIds);
        const profMap = new Map((profs ?? []).map((p: any) => [p.id, p]));
        for (const [tid, meta] of Object.entries(next)) {
          const last = lastAuthorByThread[tid];
          if (!last || meta.lastAuthorAvatar) continue;
          const p = profMap.get(last.id);
          if (p?.avatar_url) meta.lastAuthorAvatar = p.avatar_url;
          if (p?.full_name && (!meta.lastAuthorName || meta.lastAuthorName.includes("@"))) {
            meta.lastAuthorName = p.full_name;
          }
        }
      }

      setMeta(next);
    };

    load();

    const channel = supabase
      .channel(`channel-thread-counts-${channelId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const msg = payload.new as ChannelMessage;
          if (!msg.thread_id) return;
          setMeta((prev) => {
            const cur = prev[msg.thread_id!];
            const curTs = cur ? new Date(cur.lastReplyAt).getTime() : 0;
            const newTs = new Date(msg.created_at).getTime();
            const keepLast = cur && newTs < curTs;
            return {
              ...prev,
              [msg.thread_id!]: {
                count: (cur?.count ?? 0) + 1,
                lastReplyAt: keepLast ? cur!.lastReplyAt : msg.created_at,
                lastAuthorName: keepLast ? cur!.lastAuthorName : msg.author_name,
                lastAuthorAvatar: keepLast ? cur!.lastAuthorAvatar : (msg.author_avatar ?? null),
              },
            };
          });
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channelId]);

  return meta;
}

export function useThreadMessages(channelId: string | null, rootMessageId: string | null) {
  const cacheKey = channelId && rootMessageId ? getThreadKey(channelId, rootMessageId) : null;
  const [messages, setMessages] = useState<ChannelMessage[]>(cacheKey ? (threadMessageCache[cacheKey] ?? []) : []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!channelId || !rootMessageId) {
      setMessages([]);
      setLoading(false);
      return;
    }

    const key = getThreadKey(channelId, rootMessageId);
    const cached = threadMessageCache[key];

    if (cached) {
      setMessages(cached);
      setLoading(false);
    } else {
      setMessages([]);
      setLoading(true);
    }

    const load = async () => {
      const { data } = await supabase
        .from("channel_messages")
        .select("*")
        .eq("channel_id", channelId)
        .eq("thread_id", rootMessageId)
        .order("created_at", { ascending: true })
        .limit(200);

      const nextMessages = (data as unknown as ChannelMessage[]) ?? [];
      threadMessageCache[key] = nextMessages;
      setMessages(nextMessages);
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel(`channel-thread-${channelId}-${rootMessageId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "channel_messages",
          filter: `channel_id=eq.${channelId}`,
        },
        (payload) => {
          const msg = payload.new as ChannelMessage;
          if (msg.thread_id !== rootMessageId) return;

          setMessages((prev) => {
            // Drop any optimistic placeholder for the same author+content
            const withoutOptimistic = prev.filter(
              (item) =>
                !(
                  item.id.startsWith("optimistic-") &&
                  item.author_id === msg.author_id &&
                  item.content === msg.content
                ),
            );
            if (withoutOptimistic.some((item) => item.id === msg.id)) {
              threadMessageCache[key] = withoutOptimistic;
              return withoutOptimistic;
            }
            const nextMessages = [...withoutOptimistic, msg];
            threadMessageCache[key] = nextMessages;
            return nextMessages;
          });
        },
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
          const msg = payload.new as ChannelMessage;
          if (msg.thread_id !== rootMessageId) return;

          setMessages((prev) => {
            const nextMessages = prev.map((item) => (item.id === msg.id ? msg : item));
            threadMessageCache[key] = nextMessages;
            return nextMessages;
          });
        },
      )
      .subscribe();

    const handleOptimistic = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { channelId: string; rootMessageId: string; message: ChannelMessage }
        | undefined;
      if (!detail) return;
      if (detail.channelId !== channelId || detail.rootMessageId !== rootMessageId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === detail.message.id)) return prev;
        const nextMessages = [...prev, detail.message];
        threadMessageCache[key] = nextMessages;
        return nextMessages;
      });
    };
    window.addEventListener("thread-message-optimistic", handleOptimistic);

    return () => {
      supabase.removeChannel(channel);
      window.removeEventListener("thread-message-optimistic", handleOptimistic);
    };
  }, [channelId, rootMessageId]);

  return { messages, loading };
}
