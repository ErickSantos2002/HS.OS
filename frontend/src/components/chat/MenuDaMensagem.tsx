/**
 * A setinha no canto da bolha que abre as ações da mensagem — como no WhatsApp.
 *
 * Substituiu, em 13/10/2026, a barra de ícones que aparecia ao passar o mouse
 * (embaixo da mensagem quando ela era larga). Aparece no hover da bolha
 * (`group`), quando recebe foco, e fica visível enquanto o menu está aberto.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

export interface AcaoDaMensagem {
  rotulo: string;
  aoEscolher: () => void;
  icone?: LucideIcon;
  perigo?: boolean;
}

export default function MenuDaMensagem({ acoes, className }: { acoes: AcaoDaMensagem[]; className?: string }) {
  const [aberto, setAberto] = useState(false);
  if (acoes.length === 0) return null;
  return (
    <DropdownMenu open={aberto} onOpenChange={setAberto}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Opções da mensagem"
          className={cn(
            "absolute right-1.5 top-1.5 z-20 rounded-full bg-background/80 p-0.5 text-muted-foreground shadow-sm",
            "transition-opacity hover:text-foreground focus-visible:opacity-100",
            aberto ? "opacity-100" : "opacity-0 group-hover:opacity-100",
            className,
          )}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        {acoes.map(({ rotulo, aoEscolher, icone: Icone, perigo }) => (
          <DropdownMenuItem
            key={rotulo}
            onSelect={aoEscolher}
            className={cn("gap-2 text-sm", perigo && "text-destructive focus:text-destructive")}
          >
            {Icone && <Icone className="h-3.5 w-3.5" />}
            {rotulo}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
