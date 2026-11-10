/**
 * O id da conversa consigo mesmo de quem está logado — criada pelo banco na
 * primeira chamada (`GET /channels/pessoal`, idempotente).
 *
 * Recebe os ids que a lista de canais da tela já conhece e o `recarregar`
 * dela: o `useChannels` guarda estado por instância, e na primeira vez a
 * conversa acabou de nascer e ainda não está lá. Sem recarregar, o item
 * fixo apareceria e o clique não acharia o canal.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";

import { useAuthContext } from "@/contexts/auth-context";
import { api } from "@/lib/api";

export function useConversaPessoal(idsConhecidos: string[], recarregar: () => void): { canalId: string | null } {
  const { user } = useAuthContext();
  const { data } = useQuery({
    queryKey: ["conversa-pessoal", user?.id ?? ""],
    queryFn: () => api<{ channel_id: string }>("/channels/pessoal"),
    enabled: !!user?.id,
    staleTime: Infinity,
    retry: 1,
  });
  const canalId = data?.channel_id ?? null;
  const falta = !!canalId && idsConhecidos.length > 0 && !idsConhecidos.includes(canalId);
  useEffect(() => {
    if (falta) recarregar();
  }, [falta, recarregar]);
  return { canalId };
}
