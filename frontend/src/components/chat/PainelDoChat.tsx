/**
 * Moldura dos painéis laterais do chat (Arquivos, Membros).
 *
 * Desktop: um backdrop invisível e uma coluna `absolute` à direita, dentro da
 * conversa. App do celular (spec 2026-11-03, app próprio): o painel é uma TELA
 * empilhada, e quem dá a moldura é ela — aqui o conteúdo só ocupa o espaço
 * (`PainelEmbutido`). Assim o celular mostra o mesmo conteúdo do desktop sem
 * uma segunda cópia do painel.
 */
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

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  /** Para leitor de tela; o título visível é do próprio painel. */
  titulo: string;
  largura: "w-80" | "w-72";
  children: ReactNode;
}

export default function PainelDoChat({ aberto, aoFechar, titulo, largura, children }: Props) {
  const embutido = usePainelEmbutido();

  if (embutido) {
    return (
      <section aria-label={titulo} className="painel-embutido flex min-h-0 flex-1 flex-col overflow-hidden">
        {children}
      </section>
    );
  }

  if (!aberto) return null;
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={aoFechar} />
      <div className={`absolute right-0 top-0 bottom-0 z-50 flex ${largura} flex-col overflow-hidden rounded-l-2xl border-l border-border/40 bg-card/95 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-right-5 duration-200`}>
        {children}
      </div>
    </>
  );
}
