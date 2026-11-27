/**
 * "Marcar como não lida" na lista de conversas do desktop (18/11/2026).
 *
 * Spec: docs/superpowers/specs/2026-11-18-marcar-conversa-nao-lida-design.md.
 *
 * No hover, a hora cede o lugar a um ˅ (`CEDE_AO_MENU`); o clique direito abre o
 * mesmo item no ponto do cursor. Clicar no ˅ não abre a conversa. Sem alvo (DM com pessoa que nunca
 * conversou, sem canal ainda) não há menu: não há o que marcar.
 *
 * `IndicadorDaConversa` desenha o que `indicadorDaConversa` decidiu: número de
 * não lidas, a bolinha sem número da marca, ou nada.
 */
import { useState, type ReactNode } from "react";
import { BellDot, Check, ChevronDown, Eraser } from "lucide-react";
import { toast } from "sonner";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useConversasMarcadas } from "@/hooks/use-conversas-marcadas";
import { podeMarcar, type AlvoDaMarca, type Indicador } from "@/lib/conversa-marcada";
import { pedirLimparConversa } from "@/lib/limpar-conversa";
import { cn } from "@/lib/utils";

/**
 * Classe para o que fica no canto do item (hora, contador) e cede o lugar ao
 * botão no hover — o padrão do Gmail. A 1ª versão punha o ⋮ POR CIMA da hora,
 * cortando-a, e o menu abria solto sobre a conversa de baixo (18/11/2026).
 */
export const CEDE_AO_MENU = "transition-opacity group-hover/conversa:opacity-0";

const CONTEUDO = "min-w-[12rem] rounded-xl p-1 shadow-lg";
const ITEM = "gap-2.5 rounded-lg px-2.5 py-2 text-sm cursor-pointer";

export function MenuDaConversa({ alvo, children, className, posicao = "topo", limpar }: {
  alvo: AlvoDaMarca;
  /** DM e grupo: "Limpar conversa" (27/11/2026). Agente e anotações não passam. */
  limpar?: { nome: string };
  children: ReactNode;
  className?: string;
  /** Onde fica o botão: na linha do nome (`topo`, junto da hora) ou no meio do item. */
  posicao?: "topo" | "meio";
}) {
  const [aberto, setAberto] = useState(false);
  const { estaMarcada, marcar, desmarcar } = useConversasMarcadas();
  if (!podeMarcar(alvo)) return <div className={cn("relative", className)}>{children}</div>;
  const marcada = estaMarcada(alvo);
  const alternar = () => {
    void (marcada ? desmarcar(alvo) : marcar(alvo)).then((ok) => {
      if (!ok) toast.error(marcada ? "Não foi possível marcar como lida" : "Não foi possível marcar como não lida");
    });
  };
  const Icone = marcada ? Check : BellDot;
  const canalId = alvo.canalId;
  const aoLimpar = limpar && canalId ? () => pedirLimparConversa({ canalId, nome: limpar.nome }) : null;
  const rotulo = marcada ? "Marcar como lida" : "Marcar como não lida";
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div className={cn("group/conversa relative", className)}>
          {children}
          <DropdownMenu open={aberto} onOpenChange={setAberto}>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Opções da conversa"
                onClick={(e) => e.stopPropagation()}
                className={cn(
                  "absolute right-2 z-10 flex h-6 w-6 items-center justify-center rounded-full",
                  "bg-secondary text-muted-foreground shadow-sm transition-opacity hover:text-foreground",
                  "focus-visible:opacity-100",
                  posicao === "topo" ? "top-1.5" : "top-1/2 -translate-y-1/2",
                  aberto ? "opacity-100" : "opacity-0 group-hover/conversa:opacity-100",
                )}
              >
                <ChevronDown className="h-4 w-4" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={4} className={CONTEUDO}>
              <DropdownMenuItem onSelect={alternar} className={ITEM}>
                <Icone className="h-4 w-4" />{rotulo}
              </DropdownMenuItem>
              {aoLimpar && (
                <DropdownMenuItem onSelect={aoLimpar} className={ITEM}>
                  <Eraser className="h-4 w-4" />Limpar conversa
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </ContextMenuTrigger>
      {/* Clique direito: abre no ponto do cursor, como em qualquer lista do sistema. */}
      <ContextMenuContent className={CONTEUDO}>
        <ContextMenuItem onSelect={alternar} className={ITEM}>
          <Icone className="h-4 w-4" />{rotulo}
        </ContextMenuItem>
        {aoLimpar && (
          <ContextMenuItem onSelect={aoLimpar} className={ITEM}>
            <Eraser className="h-4 w-4" />Limpar conversa
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
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
