import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";

export interface WikiSpace {
  id: string;
  name: string;
  description: string | null;
  icon: string | null;
  color: string | null;
  created_by: string;
  created_at: string;
  order_index: number;
  parent_id: string | null;
}

export function useWikiSpaces() {
  return useQuery({
    queryKey: ["wiki-spaces"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("wiki_spaces")
        .select("*")
        .order("order_index", { ascending: true })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as WikiSpace[];
    },
  });
}

export function useCreateWikiSpace() {
  const qc = useQueryClient();
  const { user } = useAuthContext();
  return useMutation({
    mutationFn: async (input: { name: string; description?: string; icon?: string; color?: string; parent_id?: string | null }) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("wiki_spaces")
        .insert({
          name: input.name,
          description: input.description ?? "",
          icon: input.icon ?? "BookOpen",
          color: input.color ?? "#3D61FF",
          parent_id: input.parent_id ?? null,
          created_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as WikiSpace;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-spaces"] }),
  });
}

export function useUpdateWikiSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; name?: string; description?: string; icon?: string; color?: string; parent_id?: string | null; order_index?: number }) => {
      const { id, ...patch } = input;
      const { data, error } = await supabase
        .from("wiki_spaces")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as WikiSpace;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-spaces"] }),
  });
}

export function useDeleteWikiSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("wiki_spaces").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-spaces"] });
      qc.invalidateQueries({ queryKey: ["wiki-documents"] });
    },
  });
}
