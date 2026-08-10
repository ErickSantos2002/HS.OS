import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { assinar, enviar } from "@/lib/realtime";

/**
 * Indicador de "fulano está digitando", pelo nosso WebSocket.
 *
 * Sem escrita no banco e sem mudança de schema: o estado é efêmero, por canal,
 * e expira sozinho em 4 segundos.
 *
 * ⚠️ **Foi o último pedaço de Supabase Realtime do sistema.** Ele não coube na
 * portagem que substituiu o `postgres_changes` por trigger + `pg_notify`, e o
 * motivo é bom: isto não passa pelo banco e nem deve. Gravar cada tecla numa
 * tabela para um aviso que vale segundos seria caro e inútil.
 *
 * O caminho de agora é o `/ws`, que já estava aberto e escutando: o navegador
 * manda `{tipo: "digitando", topico: "canal:<id>"}` e o servidor republica no
 * tópico — depois de conferir que quem mandou já assina esse tópico, o que só
 * acontece se ele for membro do canal.
 *
 * - `notifyTyping()` estrangula os avisos em um a cada ~1.5s enquanto digita.
 * - `typingUsers` traz os outros; a própria pessoa é filtrada fora.
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
  cancelar: () => void;
  users: Map<string, TypingUser>;
  listeners: Set<TopicListener>;
  cleanupTimer: ReturnType<typeof setInterval>;
  releaseTimer: ReturnType<typeof setTimeout> | null;
};

const typingTopics = new Map<string, TypingTopic>();

/** O tópico do nosso realtime para um canal. */
const topicoDoCanal = (channelKey: string) => `canal:${channelKey}`;

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
    cancelar: () => {},
    users: new Map(),
    listeners: new Set(),
    // Varredura de 1s porque ninguém "para de digitar" explicitamente: a
    // ausência de aviso novo é o que apaga o rótulo.
    cleanupTimer: setInterval(() => {
      const current = typingTopics.get(topicKey);
      if (!current) return;
      const { changed } = activeUsers(current);
      if (changed) emitTyping(current);
    }, 1000),
    releaseTimer: null,
  };

  topic.cancelar = assinar(topicoDoCanal(topicKey), (tipo, dados) => {
    if (tipo !== "digitando") return;
    const typingUser = normalizeTypingPayload(dados);
    if (!typingUser) return;
    topic.users.set(typingUser.userId, { ...typingUser, expiresAt: Date.now() + EXPIRY_MS });
    emitTyping(topic);
  });

  typingTopics.set(topicKey, topic);
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
      current.cancelar();
      typingTopics.delete(topicKey);
    }, TOPIC_RELEASE_DELAY_MS);
  };
}

function publishTyping(topicKey: string, payload: TypingPayload) {
  // Garante a assinatura antes de anunciar: quem digita também precisa ouvir,
  // e é a assinatura que autoriza o envio do outro lado.
  ensureTypingTopic(topicKey);
  // O `userId` não vai no payload — o servidor o tira do token, que é a única
  // fonte que não dá para forjar. Só o nome de exibição sobe daqui.
  enviar({ tipo: "digitando", topico: topicoDoCanal(topicKey), name: payload.name });
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
