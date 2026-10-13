// frontend/src/hooks/use-resumo-em-audio.ts
/**
 * A preferência "receber resumo em áudio das respostas dos agentes".
 * Ligada por padrão (coluna `profiles.resumo_em_audio`, migração 019).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";

const CHAVE = ["perfil", "resumo_em_audio"];

export function useResumoEmAudio() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: async () => (await api<{ resumo_em_audio?: boolean }>("/profiles/me")).resumo_em_audio !== false,
    staleTime: 5 * 60_000,
  });
  const m = useMutation({
    mutationFn: async (ligado: boolean) =>
      api("/profiles/me", { method: "PATCH", body: { resumo_em_audio: ligado } }),
    onMutate: (ligado) => qc.setQueryData(CHAVE, ligado),
    onError: () => qc.invalidateQueries({ queryKey: CHAVE }),
  });
  return { ligado: data ?? true, alterar: (v: boolean) => m.mutateAsync(v).then(() => undefined) };
}
