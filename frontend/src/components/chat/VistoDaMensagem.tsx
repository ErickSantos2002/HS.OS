import { AlertTriangle, Check, CheckCheck, Clock } from "lucide-react";
import type { EstadoDoVisto } from "@/lib/vistos";

const ROTULO: Record<EstadoDoVisto, string> = {
  pendente: "Enviando…", enviada: "Enviada", entregue: "Entregue",
  lida: "Lida", falhou: "Não foi entregue",
};

/** O visto do WhatsApp ao lado do horário — só em mensagem minha. */
export default function VistoDaMensagem({ estado, className = "" }: { estado: EstadoDoVisto; className?: string }) {
  const comum = `h-3.5 w-3.5 shrink-0 ${className}`;
  const icone =
    estado === "pendente" ? <Clock className={comum} /> :
    estado === "enviada" ? <Check className={comum} /> :
    estado === "entregue" ? <CheckCheck className={comum} /> :
    estado === "lida" ? <CheckCheck className={`${comum} text-sky-500`} /> :
    <AlertTriangle className={`${comum} text-destructive`} />;
  return <span role="img" aria-label={ROTULO[estado]} title={ROTULO[estado]} className="inline-flex">{icone}</span>;
}
