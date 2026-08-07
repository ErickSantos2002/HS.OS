import { api } from "@/lib/api";

export type AutomationEvent =
  | "gateway.offline"
  | "integration.added"
  | "integration.expired"
  | "user.joined"
  | "agent.error";

/**
 * Fires a trigger-type automation event. Any active automations listening for
 * this event will be dispatched (one-shot) to the OpenClaw gateway.
 */
export async function triggerAutomation(
  event: AutomationEvent,
  payload?: Record<string, unknown>,
): Promise<void> {
  try {
    await api("/automacoes/gatilho", { method: "POST", body: { event, payload } });
  } catch (err) {
    console.warn("[trigger-automation] dispatch failed:", err);
  }
}
