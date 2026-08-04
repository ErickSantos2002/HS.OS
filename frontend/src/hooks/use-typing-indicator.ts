import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Lightweight "typing…" indicator using Supabase Realtime broadcast.
 * No DB writes, no schema changes. State is ephemeral and per-channel.
 *
 * - notifyTyping() throttles broadcasts to once every ~1.5s while the user types.
 * - typingUsers contains other users currently typing (self filtered out).
 * - Entries expire automatically 4s after the last broadcast.
 *
 * IMPORTANT: broadcasts are only sent after the channel reaches SUBSCRIBED.
 * Calls before that are queued (single pending flag) and flushed on subscribe.
 */

const HEARTBEAT_MS = 1500;
const EXPIRY_MS = 4000;
const TOPIC_RELEASE_DELAY_MS = 1200;

export interface TypingUser {
  userId: string;
  name: string;
  expiresAt: number;
}

type TypingPayload = Omit<TypingUser, "expiresAt">;
type TopicListener = (users: TypingUser[]) => void;
type TypingTopic = {
  channel: ReturnType<typeof supabase.channel>;
  users: Map<string, TypingUser>;
  listeners: Set<TopicListener>;
  subscribed: boolean;
  pendingPayload: TypingPayload | null;
  cleanupTimer: ReturnType<typeof setInterval>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
};

const typingTopics = new Map<string, TypingTopic>();

function syncRealtimeAuth() {
  try {
    void supabase.auth.getSession().then(({ data }) => {
      supabase.realtime.setAuth(data.session?.access_token ?? null);
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.debug("[typing] realtime auth skipped", error);
  }
}

function normalizeTypingPayload(payload: unknown): TypingPayload | null {
  const { userId, name } = (payload ?? {}) as { userId?: string; name?: string };
  if (!userId) return null;
  return {
    userId,
    name: name && name.trim().length > 0 ? name : "Alguém",
  };
}

function activeUsers(topic: TypingTopic) {
  const now = Date.now();
  let changed = false;
  topic.users.forEach((user, userId) => {
    if (user.expiresAt <= now) {
      topic.users.delete(userId);
      changed = true;
    }
  });
  return { users: Array.from(topic.users.values()), changed };
}

function emitTyping(topic: TypingTopic) {
  const { users } = activeUsers(topic);
  topic.listeners.forEach((listener) => listener(users));
}

function sendPayload(topicKey: string, topic: TypingTopic, payload: TypingPayload) {
  topic.pendingPayload = null;
  // eslint-disable-next-line no-console
  console.debug("[typing] sending", topicKey, payload.userId);
  void topic.channel.send({
    type: "broadcast",
    event: "typing",
    payload,
  });
}

function ensureTypingTopic(topicKey: string): TypingTopic {
  const existing = typingTopics.get(topicKey);
  if (existing) {
    if (existing.releaseTimer) {
      clearTimeout(existing.releaseTimer);
      existing.releaseTimer = null;
    }
    return existing;
  }

  const topic: TypingTopic = {
    channel: supabase.channel(`typing:${topicKey}`, { config: { broadcast: { ack: false, self: false } } }),
    users: new Map(),
    listeners: new Set(),
    subscribed: false,
    pendingPayload: null,
    cleanupTimer: setInterval(() => {
      const current = typingTopics.get(topicKey);
      if (!current) return;
      const { changed } = activeUsers(current);
      if (changed) emitTyping(current);
    }, 1000),
    releaseTimer: null,
  };

  topic.channel.on("broadcast", { event: "typing" }, (payload) => {
    const typingUser = normalizeTypingPayload(payload.payload);
    if (!typingUser) return;
    topic.users.set(typingUser.userId, { ...typingUser, expiresAt: Date.now() + EXPIRY_MS });
    // eslint-disable-next-line no-console
    console.debug("[typing] received", { topicKey, userId: typingUser.userId, name: typingUser.name });
    emitTyping(topic);
  });

  typingTopics.set(topicKey, topic);
  syncRealtimeAuth();
  topic.channel.subscribe((status) => {
    // eslint-disable-next-line no-console
    console.debug("[typing] subscribe status", topicKey, status);
    if (status === "SUBSCRIBED") {
      topic.subscribed = true;
      if (topic.pendingPayload) sendPayload(topicKey, topic, topic.pendingPayload);
      return;
    }
    topic.subscribed = false;
  });

  return topic;
}

function subscribeTypingTopic(topicKey: string, listener: TopicListener) {
  const topic = ensureTypingTopic(topicKey);
  topic.listeners.add(listener);
  listener(activeUsers(topic).users);

  return () => {
    topic.listeners.delete(listener);
    if (topic.listeners.size > 0) return;

    topic.releaseTimer = setTimeout(() => {
      const current = typingTopics.get(topicKey);
      if (!current || current.listeners.size > 0) return;
      clearInterval(current.cleanupTimer);
      void supabase.removeChannel(current.channel);
      typingTopics.delete(topicKey);
    }, TOPIC_RELEASE_DELAY_MS);
  };
}

function publishTyping(topicKey: string, payload: TypingPayload) {
  const topic = ensureTypingTopic(topicKey);
  if (!topic.subscribed) {
    topic.pendingPayload = payload;
    return;
  }
  sendPayload(topicKey, topic, payload);
}

export function useTypingIndicator(
  channelKey: string | null,
  currentUserId: string | null,
  currentUserName: string | null,
) {
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const lastSentRef = useRef<number>(0);
  const currentUserNameRef = useRef<string | null>(currentUserName);

  useEffect(() => {
    currentUserNameRef.current = currentUserName;
  }, [currentUserName]);

  useEffect(() => {
    if (!channelKey || !currentUserId) {
      setTypingUsers([]);
      return;
    }

    const unsubscribe = subscribeTypingTopic(channelKey, (users) => {
      setTypingUsers(users.filter((user) => user.userId !== currentUserId));
    });

    return () => {
      unsubscribe();
      setTypingUsers([]);
      lastSentRef.current = 0;
    };
  }, [channelKey, currentUserId]);

  const notifyTyping = useCallback(() => {
    if (!currentUserId) return;
    const now = Date.now();
    if (now - lastSentRef.current < HEARTBEAT_MS) return;

    if (!channelKey) return;
    lastSentRef.current = now;
    publishTyping(channelKey, { userId: currentUserId, name: currentUserNameRef.current ?? "" });
  }, [channelKey, currentUserId]);

  return { typingUsers, notifyTyping };
}

/** Format an array of typing users into a human-readable sentence (pt-BR). */
export function formatTypingLabel(users: TypingUser[]): string {
  if (users.length === 0) return "";
  if (users.length === 1) return `${users[0].name} está digitando…`;
  return `${users.map((user) => user.name).join(", ")} estão digitando…`;
}

export function useTypingActivity(channelKeys: string[], currentUserId: string | null) {
  const [typingByChannel, setTypingByChannel] = useState<Record<string, TypingUser[]>>({});
  const stableChannelKeys = useMemo(
    () => Array.from(new Set(channelKeys.filter(Boolean))).sort(),
    [channelKeys.join(",")],
  );
  const stableChannelKeyString = stableChannelKeys.join(",");

  useEffect(() => {
    if (!currentUserId || stableChannelKeys.length === 0) {
      setTypingByChannel({});
      return;
    }

    const unsubscribes = stableChannelKeys.map((channelKey) =>
      subscribeTypingTopic(channelKey, (users) => {
        const visibleUsers = users.filter((user) => user.userId !== currentUserId);
        setTypingByChannel((prev) => {
          if (visibleUsers.length === 0) {
            if (!prev[channelKey]) return prev;
            const next = { ...prev };
            delete next[channelKey];
            return next;
          }
          return { ...prev, [channelKey]: visibleUsers };
        });
      })
    );

    return () => {
      unsubscribes.forEach((unsubscribe) => unsubscribe());
      setTypingByChannel({});
    };
  }, [currentUserId, stableChannelKeyString]);

  return typingByChannel;
}
