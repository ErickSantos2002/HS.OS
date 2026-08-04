import { useEffect, useState } from "react";

// Tracks which agentIds currently have a visible AgentActivityCard, so other
// UI (like the "Trabalhando..." typing indicator) can hide itself to avoid
// duplicated feedback.
const visibleAgents = new Set<string>();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function setAgentActivityVisible(agentId: string, visible: boolean) {
  if (!agentId) return;
  const had = visibleAgents.has(agentId);
  if (visible && !had) {
    visibleAgents.add(agentId);
    emit();
  } else if (!visible && had) {
    visibleAgents.delete(agentId);
    emit();
  }
}

export function useAgentActivityVisible(agentId: string | undefined | null): boolean {
  const [v, setV] = useState<boolean>(() => (agentId ? visibleAgents.has(agentId) : false));
  useEffect(() => {
    if (!agentId) {
      setV(false);
      return;
    }
    const update = () => setV(visibleAgents.has(agentId));
    update();
    listeners.add(update);
    return () => {
      listeners.delete(update);
    };
  }, [agentId]);
  return v;
}
