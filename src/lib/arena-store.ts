/**
 * Arena persistence layer – Supabase based.
 */

import { supabase } from "@/integrations/supabase/client";

export interface ArenaAgent {
  id: string;
  name: string;
  isNew?: boolean;
}

export interface Arena {
  id: string;
  name: string;
  description: string;
  emoji?: string;
  agents: ArenaAgent[];
  reactCode: string;
  createdAt: string;
  prompt: string;
  voiceId?: string;
  openingMessage?: string;
  convaiAgentId?: string;
}

function rowToArena(row: any): Arena {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? "",
    emoji: row.emoji ?? "",
    agents: Array.isArray(row.agents) ? row.agents : [],
    reactCode: row.react_code ?? "",
    createdAt: row.created_at,
    prompt: row.prompt ?? "",
    voiceId: row.voice_id ?? undefined,
    openingMessage: row.opening_message ?? undefined,
    convaiAgentId: row.convai_agent_id ?? undefined,
  };
}

export async function loadArenas(): Promise<Arena[]> {
  const { data, error } = await supabase
    .from("arenas")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("[arena-store] loadArenas:", error.message);
    return [];
  }
  return (data ?? []).map(rowToArena);
}

/**
 * Insere a arena; propaga created_by com o usuário atual (necessário pelas RLS).
 * Retorna { error } para o caller decidir rollback / toast.
 */
export async function saveArena(arena: Arena): Promise<{ error: Error | null }> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) return { error: new Error("Usuário não autenticado.") };

  const { error } = await supabase.from("arenas").upsert({
    id: arena.id,
    name: arena.name,
    description: arena.description,
    emoji: arena.emoji ?? "",
    agents: arena.agents as any,
    react_code: arena.reactCode,
    prompt: arena.prompt,
    created_at: arena.createdAt,
    created_by: userId,
    voice_id: arena.voiceId ?? null,
    opening_message: arena.openingMessage ?? null,
    convai_agent_id: arena.convaiAgentId ?? null,
  } as any);

  if (error) console.error("[arena-store] saveArena:", error.message);
  return { error: error ? new Error(error.message) : null };
}

export async function deleteArena(id: string): Promise<{ error: Error | null }> {
  // FKs têm ON DELETE CASCADE — banco cuida de arena_agents / arena_sessions / arena_messages.
  const { error } = await supabase.from("arenas").delete().eq("id", id);
  if (error) console.error("[arena-store] deleteArena:", error.message);
  return { error: error ? new Error(error.message) : null };
}

export async function getArena(id: string): Promise<Arena | undefined> {
  const { data, error } = await supabase
    .from("arenas")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("[arena-store] getArena:", error.message);
    return undefined;
  }
  return data ? rowToArena(data) : undefined;
}
