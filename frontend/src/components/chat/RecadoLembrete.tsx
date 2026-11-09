/**
 * Recado de lembrete na conversa com o Guardi (`media[{type: "lembrete"}]`).
 * O texto ("⏰ Lembrete: …") já vem no conteúdo da mensagem; o cartão só põe
 * o relógio e o caminho de volta para a Agenda. A resposta do turno, quando
 * o lembrete tem instrução, chega depois como mensagem normal do agente.
 */
import { Link } from "react-router-dom";
import { AlarmClock } from "lucide-react";

export default function RecadoLembrete({ titulo }: { titulo?: string }) {
  return (
    <div className="mt-2 flex w-full max-w-xl items-center gap-2 rounded-xl border border-primary/30 bg-card/80 px-3 py-2 text-sm">
      <AlarmClock className="h-4 w-4 shrink-0 text-primary" />
      <span className="min-w-0 flex-1 break-words text-foreground">{titulo || "Lembrete"}</span>
      <Link to="/agenda" className="shrink-0 text-xs text-primary hover:underline">ver na Agenda</Link>
    </div>
  );
}
