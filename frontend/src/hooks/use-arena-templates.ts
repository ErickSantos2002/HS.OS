import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

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
      const { data, error } = await supabase
        .from("arena_templates" as any)
        .select("*")
        .order("name");
      if (error) {
        console.error("[use-arena-templates]:", error.message);
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
