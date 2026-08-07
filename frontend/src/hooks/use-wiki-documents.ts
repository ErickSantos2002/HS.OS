import { api } from "@/lib/api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
      const data = await api<WikiDocument[]>(`/wiki/espacos/${spaceId}/documentos`);
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
      const data = await api<WikiDocument>(`/wiki/documentos/${id}`);
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
      const data = await api<WikiDocument>("/wiki/documentos", {
        method: "POST",
        body: { space_id: spaceId, title: "Sem título", content: "" },
      });
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
      // `updated_by` e `updated_at` são carimbados pelo servidor. O horário
      // vinha do navegador, e adiantado fazia "editado há 5 minutos" virar
      // "daqui a 5 minutos" para quem via.
      const patch: Record<string, unknown> = {};
      if (input.title !== undefined) patch.title = input.title;
      if (input.content !== undefined) patch.content = input.content;
      if (input.is_pinned !== undefined) patch.is_pinned = input.is_pinned;
      const data = await api<WikiDocument>(`/wiki/documentos/${input.id}`, {
        method: "PATCH",
        body: patch,
      });
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
      await api(`/wiki/documentos/${doc.id}`, { method: "DELETE" });
      return doc;
    },
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: ["wiki-documents", doc.space_id] });
    },
  });
}
