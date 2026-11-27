/**
 * "Limpar conversa" — some só para quem limpou (spec 2026-11-27-limpar-conversa).
 *
 * Três peças sem React, para o menu do desktop e a folha do celular usarem o
 * mesmo caminho:
 * - `pedirLimparConversa`: abre a confirmação (o `LimparConversaDialog`,
 *   montado uma vez no `App.tsx`);
 * - `executarLimpeza`: chama a API e oferece "Desfazer" no aviso;
 * - `ouvirConversaLimpa`: a conversa aberta e as prévias se refazem. Sem isto a
 *   tela seguia mostrando tudo até recarregar, e parecia que não tinha limpado.
 */
import { useSyncExternalStore } from "react";
import { toast } from "sonner";

import { api } from "@/lib/api";

export interface PedidoDeLimpeza { canalId: string; nome: string }

// ── confirmação ──────────────────────────────────────────────────────────────

let pedido: PedidoDeLimpeza | null = null;
const ouvintesDoPedido = new Set<() => void>();

export function pedirLimparConversa(p: PedidoDeLimpeza) {
  pedido = p;
  ouvintesDoPedido.forEach((f) => f());
}

export function fecharPedidoDeLimpeza() {
  pedido = null;
  ouvintesDoPedido.forEach((f) => f());
}

export function usePedidoDeLimpeza(): PedidoDeLimpeza | null {
  return useSyncExternalStore(
    (f) => { ouvintesDoPedido.add(f); return () => { ouvintesDoPedido.delete(f); }; },
    () => pedido,
  );
}

// ── aviso para as telas ──────────────────────────────────────────────────────

const ouvintesDaLimpeza = new Set<(canalId: string) => void>();

export function ouvirConversaLimpa(fn: (canalId: string) => void): () => void {
  ouvintesDaLimpeza.add(fn);
  return () => { ouvintesDaLimpeza.delete(fn); };
}

const avisar = (canalId: string) => ouvintesDaLimpeza.forEach((f) => f(canalId));

// ── API ──────────────────────────────────────────────────────────────────────

export async function executarLimpeza(canalId: string): Promise<void> {
  let limpoEm: string;
  try {
    ({ limpo_em: limpoEm } = await api<{ limpo_em: string; quantas: number }>(
      `/channels/${canalId}/limpar`, { method: "POST" }));
  } catch {
    toast.error("Não consegui limpar a conversa.");
    return;
  }
  avisar(canalId);
  toast.success("Conversa limpa", {
    description: "As mensagens sumiram só para você.",
    duration: 8000,
    action: {
      label: "Desfazer",
      onClick: async () => {
        try {
          await api(`/channels/${canalId}/limpar/desfazer`, { method: "POST", body: { limpo_em: limpoEm } });
          avisar(canalId);
        } catch {
          toast.error("Não consegui desfazer.");
        }
      },
    },
  });
}
