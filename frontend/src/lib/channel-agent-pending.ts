type PendingListener = (agentIds: string[]) => void;

const pendingAgentsByChannel: Record<string, Set<string>> = {};
const pendingListenersByChannel: Record<string, Set<PendingListener>> = {};

function getSnapshot(channelId: string): string[] {
  return Array.from(pendingAgentsByChannel[channelId] ?? []);
}

function notify(channelId: string) {
  const snapshot = getSnapshot(channelId);
  pendingListenersByChannel[channelId]?.forEach((listener) => listener(snapshot));
}

export function getPendingAgentsForChannel(channelId?: string | null): string[] {
  if (!channelId) return [];
  return getSnapshot(channelId);
}

export function setChannelAgentPending(
  channelId: string | null | undefined,
  agentId: string,
  pending: boolean
) {
  if (!channelId) return;

  const channelSet = pendingAgentsByChannel[channelId] ?? new Set<string>();

  if (pending) {
    channelSet.add(agentId);
    pendingAgentsByChannel[channelId] = channelSet;
  } else {
    channelSet.delete(agentId);
    if (channelSet.size === 0) {
      delete pendingAgentsByChannel[channelId];
    } else {
      pendingAgentsByChannel[channelId] = channelSet;
    }
  }

  notify(channelId);
}

export function subscribeToChannelAgentPending(
  channelId: string | null | undefined,
  listener: PendingListener
) {
  if (!channelId) {
    listener([]);
    return () => undefined;
  }

  const listeners = pendingListenersByChannel[channelId] ?? new Set<PendingListener>();
  listeners.add(listener);
  pendingListenersByChannel[channelId] = listeners;
  listener(getSnapshot(channelId));

  return () => {
    const currentListeners = pendingListenersByChannel[channelId];
    if (!currentListeners) return;
    currentListeners.delete(listener);
    if (currentListeners.size === 0) {
      delete pendingListenersByChannel[channelId];
    }
  };
}