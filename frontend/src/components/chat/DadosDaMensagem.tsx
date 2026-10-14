import { useEffect, useState } from "react";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import VistoDaMensagem from "./VistoDaMensagem";

interface Recibo {
  user_id: string;
  nome: string;
  entregue_em: string | null;
  lida_em: string | null;
}

/**
 * "Dados da mensagem", como no WhatsApp: quem leu, quem recebeu e quem ainda
 * não recebeu, cada um com o horário. Só o autor abre — o servidor confere.
 */
export default function DadosDaMensagem({
  channelId,
  messageId,
  onClose,
}: {
  channelId: string;
  messageId: string | null;
  onClose: () => void;
}) {
  const [recibos, setRecibos] = useState<Recibo[] | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    if (!messageId) return;
    let cancelado = false;
    setRecibos(null);
    setErro(false);
    api<Recibo[]>(`/channels/${channelId}/messages/${messageId}/recibos`)
      .then((r) => { if (!cancelado) setRecibos(r); })
      .catch(() => { if (!cancelado) setErro(true); });
    return () => { cancelado = true; };
  }, [channelId, messageId]);

  const lidas = recibos?.filter((r) => r.lida_em) ?? [];
  const entregues = recibos?.filter((r) => r.entregue_em && !r.lida_em) ?? [];
  const aguardando = recibos?.filter((r) => !r.entregue_em && !r.lida_em) ?? [];

  return (
    <Dialog open={!!messageId} onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Dados da mensagem</DialogTitle>
        </DialogHeader>
        {erro ? (
          <p className="text-sm text-muted-foreground">Não consegui carregar os dados da mensagem.</p>
        ) : !recibos ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : recibos.length === 0 ? (
          <p className="text-sm text-muted-foreground">Ninguém mais recebe mensagens neste canal.</p>
        ) : (
          <div className="space-y-4">
            <Secao titulo="Lida por" estado="lida" pessoas={lidas} horario={(r) => r.lida_em} />
            <Secao titulo="Entregue a" estado="entregue" pessoas={entregues} horario={(r) => r.entregue_em} />
            <Secao titulo="Aguardando" estado="enviada" pessoas={aguardando} horario={() => null} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Secao({
  titulo,
  estado,
  pessoas,
  horario,
}: {
  titulo: string;
  estado: "lida" | "entregue" | "enviada";
  pessoas: Recibo[];
  horario: (r: Recibo) => string | null;
}) {
  if (pessoas.length === 0) return null;
  return (
    <section>
      <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <VistoDaMensagem estado={estado} />
        {titulo}
      </h3>
      <ul className="space-y-1">
        {pessoas.map((p) => {
          const h = horario(p);
          return (
            <li key={p.user_id} className="flex items-center justify-between text-sm">
              <span className="truncate">{p.nome}</span>
              {h && <span className="shrink-0 text-xs text-muted-foreground">{format(new Date(h), "dd/MM HH:mm")}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
