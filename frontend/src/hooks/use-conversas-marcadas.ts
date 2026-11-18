/**
 * As conversas marcadas como não lidas, para as listas (desktop e celular).
 * O estado mora em `lib/conversas-marcadas-store.ts`; aqui só se assina.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import { useAuthContext } from "@/contexts/auth-context";
import type { AlvoDaMarca } from "@/lib/conversa-marcada";
import * as store from "@/lib/conversas-marcadas-store";

export function useConversasMarcadas() {
  const { user } = useAuthContext();
  const userId = user?.id ?? null;
  useEffect(() => (userId ? store.iniciar(userId) : undefined), [userId]);
  const marcadas = useSyncExternalStore(store.assinarMudancas, store.instantaneo, store.instantaneo);
  // `marcadas` na dependência: a função muda quando o conjunto muda, e quem a
  // usa num `useMemo` recalcula.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const estaMarcada = useCallback((alvo: AlvoDaMarca) => store.estaMarcada(alvo), [marcadas]);
  return { estaMarcada, marcar: store.marcar, desmarcar: store.desmarcar };
}
