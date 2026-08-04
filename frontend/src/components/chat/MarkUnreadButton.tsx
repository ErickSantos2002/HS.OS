import { useCallback } from "react";
import { BellDot } from "lucide-react";
import { toast } from "sonner";

interface Props {
  onMark: () => Promise<boolean> | boolean;
  className?: string;
}

/**
 * Generic "mark message as unread" button.
 * Renders inside a message hover/action bar.
 */
export default function MarkUnreadButton({ onMark, className }: Props) {
  const handle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      try {
        const ok = await Promise.resolve(onMark());
        if (ok) toast.success("Marcada como não lida");
        else toast.error("Não foi possível marcar como não lida");
      } catch {
        toast.error("Não foi possível marcar como não lida");
      }
    },
    [onMark],
  );

  return (
    <button
      type="button"
      onClick={handle}
      className={
        className ??
        "p-1.5 rounded hover:bg-secondary/80 text-muted-foreground hover:text-foreground transition-colors"
      }
      title="Marcar como não lida"
      aria-label="Marcar como não lida"
    >
      <BellDot className="h-3.5 w-3.5" />
    </button>
  );
}
