import { Bell, BellOff } from "lucide-react";
import { useCanaisSilenciados } from "@/hooks/use-canais-silenciados";

/**
 * Silenciar/Reativar no cabeçalho do canal — **só no desktop** (`hidden md:flex`).
 * No celular a opção entra no menu ⋮ que a Frente C está montando; ela usa o
 * mesmo `useCanaisSilenciados().alternar`.
 */
export function BotaoSilenciarCanal({ channelId }: { channelId: string }) {
  const { estaSilenciado, alternar } = useCanaisSilenciados();
  const silenciado = estaSilenciado(channelId);
  const rotulo = silenciado ? "Reativar notificações" : "Silenciar canal";
  return (
    <button
      type="button"
      className="hidden md:flex items-center gap-1.5 rounded-full border border-border/50 bg-card/60 backdrop-blur-sm px-2 py-1 hover:border-primary/40 hover:text-foreground transition-colors text-xs font-medium"
      onClick={() => void alternar(channelId, !silenciado)}
      title={silenciado
        ? "Reativar: volta o push, o som e a notificação deste canal"
        : "Silenciar: sem push, som e notificação — menções a você ainda chegam"}
      aria-label={rotulo}
      aria-pressed={silenciado}
    >
      {silenciado ? <BellOff className="h-3.5 w-3.5" /> : <Bell className="h-3.5 w-3.5" />}
      <span>{silenciado ? "Reativar" : "Silenciar"}</span>
    </button>
  );
}

/** Sino cortado ao lado do nome, na lista de conversas. */
export function IconeSilenciado({ channelId }: { channelId: string }) {
  const { estaSilenciado } = useCanaisSilenciados();
  if (!estaSilenciado(channelId)) return null;
  return (
    <BellOff
      className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
      aria-label="Canal silenciado"
    />
  );
}
