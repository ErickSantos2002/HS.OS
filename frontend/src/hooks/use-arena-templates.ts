import { api } from "@/lib/api";
import { useState, useEffect } from "react";

export interface ArenaTemplate {
  id: string;
  name: string;
  emoji: string | null;
  description: string | null;
  agents: { id: string; name: string; role: string }[];
  suggested_sessions: string[];
  base_prompt: string | null;
  is_default: boolean;
}

export function useArenaTemplates() {
  const [templates, setTemplates] = useState<ArenaTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      let data: any[];
      try {
        data = await api<any[]>("/arenas/modelos");
      } catch (e) {
        console.error("[use-arena-templates]:", (e as Error).message);
        setTemplates([]);
        setLoading(false);
        return;
      }
      setTemplates(
        (data ?? []).map((r: any) => ({
          id: r.id,
          name: r.name,
          emoji: r.emoji,
          description: r.description,
          agents: Array.isArray(r.agents) ? r.agents : [],
          suggested_sessions: r.suggested_sessions ?? [],
          base_prompt: r.base_prompt,
          is_default: r.is_default ?? false,
        }))
      );
      setLoading(false);
    })();
  }, []);

  return { templates, loading };
}
