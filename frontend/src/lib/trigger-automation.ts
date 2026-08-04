import { supabase } from "@/integrations/supabase/client";

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
    await supabase.functions.invoke("trigger-automation", {
      body: { event, payload },
    });
  } catch (err) {
    console.warn("[trigger-automation] dispatch failed:", err);
  }
}
