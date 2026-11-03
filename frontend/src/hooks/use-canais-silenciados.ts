import { useCallback, useEffect, useSyncExternalStore } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import {
  definirSilenciados,
  estaSilenciado,
  listaDeSilenciados,
  ouvirSilenciados,
} from "@/lib/canais-silenciados";

const CHAVE = ["canais-silenciados"] as const;

/**
 * Silenciar canal, por pessoa (spec 2026-11-03, `025_silenciar_canal.sql`).
 *
 * A lista vem de `GET /channels/silenciados` e mora num estado de módulo
 * (`lib/canais-silenciados.ts`), para o `use-notifications` também calar o som
 * e a notificação local sem depender de React.
 */
export function useCanaisSilenciados(ativo = true) {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: CHAVE,
    queryFn: () => api<string[]>("/channels/silenciados"),
    enabled: ativo,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (data) definirSilenciados(data);
  }, [data]);

  const versao = useSyncExternalStore(ouvirSilenciados, () => listaDeSilenciados().join(","));

  const alternar = useCallback(
    async (channelId: string, silenciar: boolean) => {
      const antes = listaDeSilenciados();
      const depois = silenciar
        ? [...new Set([...antes, channelId])]
        : antes.filter((id) => id !== channelId);
      definirSilenciados(depois);
      queryClient.setQueryData(CHAVE, depois);
      try {
        await api(`/channels/${channelId}/silenciar`, {
          method: "PUT",
          body: { silenciado: silenciar },
        });
      } catch (e) {
        definirSilenciados(antes);
        queryClient.setQueryData(CHAVE, antes);
        toast.error(`Não consegui ${silenciar ? "silenciar" : "reativar"} o canal: ${(e as Error).message}`);
      }
    },
    [queryClient],
  );

  return { versao, estaSilenciado, alternar };
}
