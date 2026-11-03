/**
 * Moldura dos painéis laterais do chat (Arquivos, Membros).
 *
 * Desktop: exatamente o que os dois painéis desenhavam antes — um backdrop
 * invisível e uma coluna `absolute` à direita, dentro da conversa. Celular:
 * `Sheet` de tela cheia, acima de tudo. A coluna `absolute` ficava atrás da
 * BottomNav (`z-50`) e não cabia em 360px (spec 2026-11-03, Frente C5).
 */
import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";

interface Props {
  aberto: boolean;
  aoFechar: () => void;
  /** Para leitor de tela; o título visível é do próprio painel. */
  titulo: string;
  largura: "w-80" | "w-72";
  children: ReactNode;
}

export default function PainelDoChat({ aberto, aoFechar, titulo, largura, children }: Props) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Sheet open={aberto} onOpenChange={(v) => { if (!v) aoFechar(); }}>
        {/* O X embutido do Sheet sai: o painel já tem o seu, no cabeçalho. */}
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 overflow-hidden border-l-0 bg-card p-0 pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)] sm:max-w-full [&>button:last-child]:hidden"
        >
          <SheetTitle className="sr-only">{titulo}</SheetTitle>
          <SheetDescription className="sr-only">{titulo}</SheetDescription>
          {children}
        </SheetContent>
      </Sheet>
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
