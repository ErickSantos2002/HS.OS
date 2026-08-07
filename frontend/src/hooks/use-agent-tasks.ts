import { api } from "@/lib/api";
import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type TaskStatus = "running" | "checkpoint" | "done" | "failed";

export interface TaskChunk {
  id: number;
  label: string;
  status: "pending" | "running" | "done" | "failed";
}

export interface AgentTask {
  id: string;
  agent_id: string;
  title: string;
  status: TaskStatus;
  chunks: TaskChunk[];
  checkpoint_data: { notes?: string; currentChunk?: number; lastChunkDone?: number } | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

/**
 * Normalize chunks — agents sometimes store `chunks` as a plain string array
 * (["step 1","step 2"]) instead of the expected {id,label,status} objects.
 * We synthesize objects so the panel can render + compute progress using
 * `checkpoint_data.lastChunkDone` / `currentChunk` as the source of truth.
 */
function normalizeChunks(raw: unknown, checkpoint: AgentTask["checkpoint_data"]): TaskChunk[] {
  if (!Array.isArray(raw)) return [];
  const lastDoneRaw = checkpoint?.lastChunkDone;
  const currentRaw = checkpoint?.currentChunk;
  const lastDoneNum = typeof lastDoneRaw === "number" ? lastDoneRaw : Number(lastDoneRaw);
  const currentNum = typeof currentRaw === "number" ? currentRaw : Number(currentRaw);

  return raw.map((c: any, idx) => {
    // Already a proper object: keep it as-is.
    if (c && typeof c === "object" && "status" in c) {
      return {
        id: c.id ?? idx + 1,
        label: c.label ?? c.title ?? `Chunk ${idx + 1}`,
        status: c.status ?? "pending",
      } as TaskChunk;
    }
    // String chunk: derive status from checkpoint_data.
    const pos = idx + 1;
    let status: TaskChunk["status"] = "pending";
    if (Number.isFinite(lastDoneNum) && pos <= lastDoneNum) status = "done";
    else if (Number.isFinite(currentNum) && pos === currentNum) status = "running";
    return {
      id: pos,
      label: typeof c === "string" ? c : `Chunk ${pos}`,
      status,
    };
  });
}

async function fetchTasks(): Promise<AgentTask[]> {
  const data = await api<any[]>("/tarefas");
  if (!Array.isArray(data)) return [];
  return data.map((t: any) => ({
    ...t,
    chunks: normalizeChunks(t.chunks, t.checkpoint_data),
  })) as AgentTask[];
}

export function useAgentTasks() {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["agent-tasks"],
    queryFn: fetchTasks,
    // Fallback polling — realtime carries most updates, this catches misses.
    refetchInterval: 10_000,
    staleTime: 3_000,
    refetchOnWindowFocus: true,
  });

  // Realtime: keep the panel in sync with chunk/checkpoint progress written
  // by the agent-task edge function during a running loop.
  useEffect(() => {
    const channel = supabase
      .channel("agent-tasks-feed")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "agent_tasks" },
        () => {
          qc.invalidateQueries({ queryKey: ["agent-tasks"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc]);

  return query;
}
