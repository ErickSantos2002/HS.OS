/**
 * "Marcar como não lida" na lista de conversas do desktop (18/11/2026).
 *
 * Spec: docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md.
 *
 * O ⋮ aparece no hover do item (`group`) e o clique direito abre o mesmo menu.
 * Clicar no ⋮ não abre a conversa. Sem alvo (DM com pessoa que nunca
 * conversou, sem canal ainda) não há menu: não há o que marcar.
 *
 * `IndicadorDaConversa` desenha o que `indicadorDaConversa` decidiu: número de
 * não lidas, a bolinha sem número da marca, ou nada.
 */
import { useState, type ReactNode } from "react";
import { BellDot, Check, MoreVertical } from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConversasMarcadas } from "@/hooks/use-conversas-marcadas";
import { podeMarcar, type AlvoDaMarca, type Indicador } from "@/lib/conversa-marcada";
import { cn } from "@/lib/utils";

export function MenuDaConversa({ alvo, children, className }: {
  alvo: AlvoDaMarca;
  children: ReactNode;
  className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const { estaMarcada, marcar, desmarcar } = useConversasMarcadas();
  if (!podeMarcar(alvo)) return <div className={cn("group relative", className)}>{children}</div>;
  const marcada = estaMarcada(alvo);
  const alternar = () => {
    void (marcada ? desmarcar(alvo) : marcar(alvo)).then((ok) => {
      if (!ok) toast.error(marcada ? "Não foi possível marcar como lida" : "Não foi possível marcar como não lida");
    });
  };
  return (
    <div
      className={cn("group relative", className)}
      onContextMenu={(e) => { e.preventDefault(); setAberto(true); }}
    >
      {children}
      <DropdownMenu open={aberto} onOpenChange={setAberto}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            aria-label="Opções da conversa"
            onClick={(e) => e.stopPropagation()}
            className={cn(
              "absolute right-1 top-1/2 -translate-y-1/2 z-10 rounded-md bg-background/80 p-1 text-muted-foreground shadow-sm",
              "transition-opacity hover:text-foreground focus-visible:opacity-100",
              aberto ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            )}
          >
            <MoreVertical className="h-3.5 w-3.5" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-[11rem]">
          <DropdownMenuItem onSelect={alternar} className="gap-2 text-sm">
            {marcada ? <Check className="h-3.5 w-3.5" /> : <BellDot className="h-3.5 w-3.5" />}
            {marcada ? "Marcar como lida" : "Marcar como não lida"}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** O número de não lidas ou a bolinha sem número da marca. `tom` segue o
 *  contador de cada lista: vermelho nas DMs e agentes, primário nos canais. */
export function IndicadorDaConversa({ indicador, tom = "destrutivo", className }: {
  indicador: Indicador;
  tom?: "destrutivo" | "primario";
  className?: string;
}) {
  if (!indicador) return null;
  const cor = tom === "primario" ? "bg-primary text-primary-foreground" : "bg-destructive text-destructive-foreground";
  if (indicador.tipo === "marca") {
    return (
      <span
        role="img"
        aria-label="Marcada como não lida"
        title="Marcada como não lida"
        className={cn("inline-block h-2.5 w-2.5 rounded-full shrink-0", cor, className)}
      />
    );
  }
  return (
    <span className={cn("flex items-center justify-center h-4 min-w-[16px] px-1 rounded-full text-[10px] font-bold shrink-0", cor, className)}>
      {indicador.texto}
    </span>
  );
}
