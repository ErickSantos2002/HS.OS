import { api } from "@/lib/api";
/**
 * Arena persistence layer – Supabase based.
 */


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
  try {
    const data = await api<any[]>("/arenas");
    return (data ?? []).map(rowToArena);
  } catch (e) {
    console.error("[arena-store] loadArenas:", (e as Error).message);
    return [];
  }
}

/**
 * Insere a arena; propaga created_by com o usuário atual (necessário pelas RLS).
 * Retorna { error } para o caller decidir rollback / toast.
 */
export async function saveArena(arena: Arena): Promise<{ error: Error | null }> {
  // O dono sai do token no backend — mandá-lo no corpo era abrir para gravar
  // em nome de outra pessoa.
  try {
    await api(`/arenas/${arena.id}`, {
      method: "PUT",
      body: {
        id: arena.id,
        name: arena.name,
        description: arena.description,
        emoji: arena.emoji ?? "",
        agents: arena.agents,
        react_code: arena.reactCode,
        prompt: arena.prompt,
        created_at: arena.createdAt,
        voice_id: arena.voiceId ?? null,
        opening_message: arena.openingMessage ?? null,
        convai_agent_id: arena.convaiAgentId ?? null,
      },
    });
    return { error: null };
  } catch (e) {
    console.error("[arena-store] saveArena:", (e as Error).message);
    return { error: e as Error };
  }
}

export async function deleteArena(id: string): Promise<{ error: Error | null }> {
  // FKs têm ON DELETE CASCADE — banco cuida de arena_agents / arena_sessions / arena_messages.
  try {
    await api(`/arenas/${id}`, { method: "DELETE" });
    return { error: null };
  } catch (e) {
    console.error("[arena-store] deleteArena:", (e as Error).message);
    return { error: e as Error };
  }
}

export async function getArena(id: string): Promise<Arena | undefined> {
  try {
    return rowToArena(await api<any>(`/arenas/${id}`));
  } catch (e) {
    console.error("[arena-store] getArena:", (e as Error).message);
    return undefined;
  }
}
