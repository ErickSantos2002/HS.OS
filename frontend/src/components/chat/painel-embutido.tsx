/** O painel do chat está numa tela do app do celular? Ver `PainelDoChat`. */
import { createContext, useContext, type ReactNode } from "react";

const PainelEmbutidoContext = createContext(false);

/** Embrulha um painel do chat para ele virar conteúdo de tela cheia. */
export function PainelEmbutido({ children }: { children: ReactNode }) {
  return <PainelEmbutidoContext.Provider value>{children}</PainelEmbutidoContext.Provider>;
}

/** O painel está numa tela do celular? Os alvos de toque crescem para 44px. */
export function usePainelEmbutido(): boolean {
  return useContext(PainelEmbutidoContext);
}

