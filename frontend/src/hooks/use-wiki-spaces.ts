import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
      const data = await api<WikiSpace[]>("/wiki/espacos");
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
      // O `created_by` sai do token no servidor — mandá-lo daqui era abrir para
      // criar em nome de outra pessoa.
      const data = await api<WikiSpace>("/wiki/espacos", {
        method: "POST",
        body: {
          name: input.name,
          description: input.description ?? "",
          icon: input.icon ?? "BookOpen",
          color: input.color ?? "#3D61FF",
          parent_id: input.parent_id ?? null,
        },
      });
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
      const data = await api<WikiSpace>(`/wiki/espacos/${id}`, { method: "PATCH", body: patch });
      return data as WikiSpace;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wiki-spaces"] }),
  });
}

export function useDeleteWikiSpace() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await api(`/wiki/espacos/${id}`, { method: "DELETE" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["wiki-spaces"] });
      qc.invalidateQueries({ queryKey: ["wiki-documents"] });
    },
  });
}
