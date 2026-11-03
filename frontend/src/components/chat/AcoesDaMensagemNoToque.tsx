/**
 * Folha de baixo que abre ao segurar a mensagem no celular — spec 2026-11-03,
 * Frente C3. Reações rápidas no topo e, embaixo, as ações da mensagem.
 *
 * ⚠️ As ações chegam prontas: são as mesmas do `MenuDaMensagem` do desktop
 * (ver `acoesDoToque`). Este componente só as desenha.
 */
import { useState } from "react";
import { Plus } from "lucide-react";

import {
  Drawer,
  DrawerContent,
  DrawerNested,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import EmojiPickerLargo from "@/components/chat/EmojiPickerLargo";
import type { AcaoDaMensagem } from "@/components/chat/MenuDaMensagem";
import { REACOES_RAPIDAS } from "@/lib/acoes-do-toque";
import { cn } from "@/lib/utils";

interface Props {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  acoes: AcaoDaMensagem[];
  /** Sem ele (conversa com agente) a linha de reações não aparece. */
  aoReagir?: (emoji: string) => void;
  /** Dentro do Drawer da thread: vira NestedRoot, senão os dois disputam o
   *  arrasto e o fundo escala errado. */
  aninhada?: boolean;
}

export default function AcoesDaMensagemNoToque({ aberto, aoMudar, acoes, aoReagir, aninhada = false }: Props) {
  const Raiz = aninhada ? DrawerNested : Drawer;
  const [todosEmojis, setTodosEmojis] = useState(false);

  const mudar = (v: boolean) => {
    if (!v) setTodosEmojis(false);
    aoMudar(v);
  };
  // Fecha antes de agir: "Editar" e "Apagar" abrem outra coisa por cima, e a
  // folha ainda aberta disputaria o foco com ela.
  const escolher = (fn: () => void) => {
    mudar(false);
    window.setTimeout(fn, 0);
  };

  return (
    <Raiz open={aberto} onOpenChange={mudar}>
      <DrawerContent
        className="max-h-[85dvh] pb-[max(env(safe-area-inset-bottom,0px),12px)]"
        // Ao fechar, o Radix devolve o foco a quem tinha antes — o composer —
        // e no celular isso abre o teclado por cima da conversa.
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DrawerHeader className="sr-only">
          <DrawerTitle>Ações da mensagem</DrawerTitle>
          <DrawerDescription>Reagir ou escolher uma ação para esta mensagem.</DrawerDescription>
        </DrawerHeader>

        {aoReagir && (
          <div className="flex items-center justify-between gap-1 px-4 pt-4 pb-2">
            {REACOES_RAPIDAS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                aria-label={`Reagir com ${emoji}`}
                onClick={() => escolher(() => aoReagir(emoji))}
                className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50 text-2xl active:bg-secondary"
              >
                {emoji}
              </button>
            ))}
            <button
              type="button"
              aria-label="Mais reações"
              aria-pressed={todosEmojis}
              onClick={() => setTodosEmojis((v) => !v)}
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-full bg-secondary/50 text-muted-foreground active:bg-secondary",
                todosEmojis && "bg-primary/15 text-primary",
              )}
            >
              <Plus className="h-5 w-5" />
            </button>
          </div>
        )}

        {aoReagir && todosEmojis ? (
          <div className="px-2 pb-2">
            <EmojiPickerLargo onSelect={(emoji) => escolher(() => aoReagir(emoji))} />
          </div>
        ) : (
          acoes.length > 0 && (
            <ul className="overflow-y-auto px-2 py-2">
              {acoes.map(({ rotulo, aoEscolher, icone: Icone, perigo }) => (
                <li key={rotulo}>
                  <button
                    type="button"
                    onClick={() => escolher(aoEscolher)}
                    className={cn(
                      "flex min-h-[48px] w-full items-center gap-3 rounded-lg px-3 text-left text-[15px] active:bg-secondary/70",
                      perigo ? "text-destructive" : "text-foreground",
                    )}
                  >
                    {Icone && <Icone className="h-5 w-5 shrink-0" />}
                    {rotulo}
                  </button>
                </li>
              ))}
            </ul>
          )
        )}
      </DrawerContent>
    </Raiz>
  );
}
