/** "↪ Encaminhada" acima do conteúdo da bolha (spec 2026-11-27-encaminhar-mensagem). */
import { Forward } from "lucide-react";

export default function SeloEncaminhada({ className = "text-muted-foreground" }: { className?: string }) {
  return (
    <div className={`mt-1 flex items-center gap-1 text-[10px] italic ${className}`}>
      <Forward className="h-3 w-3" />
      Encaminhada
    </div>
  );
}
