import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { AgentTask } from "@/hooks/use-agent-tasks";
import {
  setPendingAgentTask,
  clearPendingAgentTask,
  getPendingAgentTask,
  subscribePendingAgentTask,
} from "@/lib/pending-agent-task";

/**
 * Checks (once, on mount / agent change) whether the given agent has any
 * task with status "running" or "checkpoint" in agent_tasks. If so, stores it
 * so the chat sender can inject a system-level reminder into the next turn.
 *
 * Returns the current pending task (subscribed to updates) and a `dismiss`
 * callback that only hides the visual banner — it does NOT cancel the task
 * nor stop injection into the gateway context.
 */
export function usePendingAgentTask(agentId: string | null | undefined) {
  const id = agentId ?? "";
  const [task, setTask] = useState<AgentTask | null>(() => (id ? getPendingAgentTask(id) : null));
  const [dismissed, setDismissed] = useState(false);

  // Subscribe to store changes so completion elsewhere clears the banner.
  useEffect(() => {
    if (!id) {
      setTask(null);
      return;
    }
    setTask(getPendingAgentTask(id));
    setDismissed(false);
    const unsub = subscribePendingAgentTask(() => {
      setTask(getPendingAgentTask(id));
    });
    return () => { unsub(); };
  }, [id]);

  // Fetch on agent change and re-fetch whenever agent_tasks changes via realtime,
  // so the banner clears as soon as the task is completed/failed/deleted.
  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    const refresh = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData?.session?.access_token;
        if (!accessToken) return; // not signed in yet — skip to avoid 401
        const { data, error } = await supabase.functions.invoke("agent-task", {
          body: { action: "list", agent_id: id },
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (cancelled || error) return;
        const list = Array.isArray(data) ? (data as AgentTask[]) : [];
        const pending = list.find((t) => t.status === "running" || t.status === "checkpoint") ?? null;
        if (pending) {
          setPendingAgentTask(id, pending);
        } else {
          clearPendingAgentTask(id);
        }
      } catch {
        /* silent — do not block chat */
      }
    };

    refresh();

    const channel = supabase
      .channel(`pending-agent-task-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_tasks", filter: `agent_id=eq.${id}` },
        () => { refresh(); },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [id]);

  return {
    task: dismissed ? null : task,
    rawTask: task,
    dismiss: () => setDismissed(true),
  };
}
