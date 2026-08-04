import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuthContext } from "@/contexts/auth-context";

export interface WikiDocument {
  id: string;
  space_id: string;
  title: string;
  content: string | null;
  created_by: string;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  is_pinned: boolean;
  order_index: number;
}

export function useWikiDocuments(spaceId: string | null) {
  return useQuery({
    queryKey: ["wiki-documents", spaceId],
    queryFn: async () => {
      if (!spaceId) return [];
      const { data, error } = await supabase
        .from("wiki_documents")
        .select("*")
        .eq("space_id", spaceId)
        .order("is_pinned", { ascending: false })
        .order("order_index", { ascending: true })
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as WikiDocument[];
    },
    enabled: !!spaceId,
  });
}

export function useWikiDocument(id: string | null) {
  return useQuery({
    queryKey: ["wiki-document", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase.from("wiki_documents").select("*").eq("id", id).single();
      if (error) throw error;
      return data as WikiDocument;
    },
    enabled: !!id,
  });
}

export function useCreateWikiDocument() {
  const qc = useQueryClient();
  const { user } = useAuthContext();
  return useMutation({
    mutationFn: async (spaceId: string) => {
      if (!user) throw new Error("Não autenticado");
      const { data, error } = await supabase
        .from("wiki_documents")
        .insert({
          space_id: spaceId,
          title: "Sem título",
          content: "",
          created_by: user.id,
          updated_by: user.id,
        })
        .select()
        .single();
      if (error) throw error;
      return data as WikiDocument;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["wiki-documents", doc.space_id] });
    },
  });
}

export function useUpdateWikiDocument() {
  const qc = useQueryClient();
  const { user } = useAuthContext();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      title?: string;
      content?: string;
      is_pinned?: boolean;
    }) => {
      const patch: Record<string, unknown> = { updated_by: user?.id };
      if (input.title !== undefined) patch.title = input.title;
      if (input.content !== undefined) patch.content = input.content;
      if (input.is_pinned !== undefined) patch.is_pinned = input.is_pinned;
      const { data, error } = await supabase
        .from("wiki_documents")
        .update(patch)
        .eq("id", input.id)
        .select()
        .single();
      if (error) throw error;
      return data as WikiDocument;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["wiki-document", doc.id] });
      qc.invalidateQueries({ queryKey: ["wiki-documents", doc.space_id] });
    },
  });
}

export function useDeleteWikiDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (doc: { id: string; space_id: string }) => {
      const { error } = await supabase.from("wiki_documents").delete().eq("id", doc.id);
      if (error) throw error;
      return doc;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["wiki-documents", doc.space_id] });
    },
  });
}
