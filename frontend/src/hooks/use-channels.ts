import { useState, useEffect, useCallback } from "react";
import { api } from "@/lib/api";
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
    try {
      cachedChannels = await api<Channel[]>("/channels");
      setChannels(cachedChannels);
    } catch (e) {
      console.error("Erro ao carregar canais:", e);
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
    // Uma chamada só. Eram quatro inserts independentes, cada um podendo falhar
    // sozinho — dava para criar canal sem membro nenhum, inclusive sem o
    // criador, e aí o RLS escondia o canal de todo mundo. Agora é transação no
    // servidor: ou tudo entra, ou nada entra.
    let channel: Channel;
    try {
      channel = await api<Channel>("/channels", {
        method: "POST",
        body: {
          name,
          description: description || null,
          type,
          member_ids: memberIds ?? [],
          agent_ids: agentIds ?? [],
        },
      });
    } catch (e) {
      console.error("Erro ao criar canal:", e);
      return null;
    }

    await fetchChannels();
    return channel;
  };

  const joinChannel = async (channelId: string) => {
    if (!user) return;
    // Use upsert-like approach: ignore duplicate
    try {
      await api(`/channels/${encodeURIComponent(channelId)}/members/me`, { method: "PUT" });
    } catch (e) {
      console.error("Join channel error:", e);
    }
  };

  return { channels, loading, createChannel, joinChannel, refetch: fetchChannels };
}

/* ── Module-level message cache for instant hydration ── */
const channelMessageCache: Record<string, ChannelMessage[]> = {};
const CHANNEL_MESSAGES_CACHE_LIMIT = 200;

/** Prefetch channel messages into cache (no-op if already cached) */
export async function prefetchChannelMessages(channelId: string): Promise<void> {
  if (channelMessageCache[channelId]) return;
  try {
    // Já vem em ordem cronológica e só o nível de cima (sem respostas de
    // thread) — o filtro que era `.is("thread_id", null)` agora é do endpoint.
    channelMessageCache[channelId] = await api<ChannelMessage[]>(
      `/channels/${encodeURIComponent(channelId)}/messages?limite=${CHANNEL_MESSAGES_CACHE_LIMIT}`,
    );
  } catch (e) {
    console.error("Failed to prefetch channel messages:", e);
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
        const data = await api<ChannelMessage[]>(
          `/channels/${encodeURIComponent(channelId)}/messages?limite=${CHANNEL_MESSAGES_CACHE_LIMIT}`,
        );
        if (cancelled) return;
        {
          const msgs = data;
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

    // ⚠️ Aqui havia assinatura de `postgres_changes` em três eventos (INSERT,
    // UPDATE, DELETE). O Realtime do Supabase saiu e a substituição é um
    // intervalo: o `load()` acima já reconcilia por id, então repetir é barato
    // e idempotente.
    //
    // 4 segundos é o meio-termo entre parecer vivo e não martelar o servidor.
    // Enquanto a aba está oculta o navegador já estrangula timers sozinho, e o
    // `resync` acima cobre a volta ao foco.
    //
    // O caminho definitivo é o backend empurrar evento por WebSocket — mesma
    // peça que daria streaming ao chat. Está na fila do pós-entrega.
    const enquete = window.setInterval(load, 4000);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
      window.clearInterval(enquete);
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

    let incoming: ChannelMessage[];
    try {
      const target = await api<ChannelMessage>(
        `/channels/${encodeURIComponent(channelId)}/messages/${encodeURIComponent(messageId)}`,
      );
      // Tudo daquele instante em diante, para a tela renderizar um trecho
      // contíguo do alvo até agora — em vez de um buraco no meio da conversa.
      const range = await api<ChannelMessage[]>(
        `/channels/${encodeURIComponent(channelId)}/messages`
        + `?desde=${encodeURIComponent(target.created_at)}`,
      );
      incoming = [...range, target];
    } catch (e) {
      console.error("Erro ao carregar a mensagem:", e);
      return false;
    }
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
        const todos = await api<Array<{ id: string; avatar_url: string | null; full_name: string | null }>>("/profiles");
        const prof = todos.find((p) => p.id === authorId);
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
    let error: unknown = null;
    try {
      // O servidor resolve nome e avatar quando não vierem, então mandar
      // `resolvedName`/`resolvedAvatar` aqui é só o atalho de quem já os tem.
      await api(`/channels/${encodeURIComponent(channelId)}/messages`, {
        method: "POST",
        body: {
          author_id: authorId,
          author_type: authorType,
          author_name: resolvedName,
          author_avatar: resolvedAvatar,
          content,
          audio_url: audioUrl || null,
          attachments: attachments || null,
          thread_id: threadId ?? null,
        },
      });
    } catch (e) {
      error = e;
    }

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
      try {
        const data = await api<ChannelMember[]>(
          `/channels/${encodeURIComponent(channelId)}/members`,
        );
        if (isActive) setMembers(data);
      } catch (e) {
        console.error("Erro ao carregar membros do canal:", e);
      }
    };

    void loadMembers();

    // A lista de membros mudava por Realtime. Aqui o intervalo é bem mais
    // espaçado que o das mensagens: entrar e sair de canal é raro, e recarregar
    // isso de 4 em 4 segundos seria desperdício.
    const enquete = window.setInterval(() => void loadMembers(), 30_000);

    return () => {
      isActive = false;
      window.clearInterval(enquete);
    };
  }, [channelId, refreshKey]);

  return members;
}
