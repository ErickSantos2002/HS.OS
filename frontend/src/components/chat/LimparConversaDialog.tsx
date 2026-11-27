/**
 * Confirmação do "Limpar conversa" (spec 2026-11-27-limpar-conversa).
 * Montada uma vez no `App.tsx` — serve o menu do desktop e a folha do celular.
 */
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { executarLimpeza, fecharPedidoDeLimpeza, usePedidoDeLimpeza } from "@/lib/limpar-conversa";

export default function LimparConversaDialog() {
  const pedido = usePedidoDeLimpeza();
  return (
    <AlertDialog open={!!pedido} onOpenChange={(aberto) => { if (!aberto) fecharPedidoDeLimpeza(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Limpar a conversa com {pedido?.nome}?</AlertDialogTitle>
          <AlertDialogDescription>
            Todas as mensagens somem só para você. {pedido?.nome.startsWith("#") ? "Os outros participantes continuam" : `${pedido?.nome} continua`} vendo a conversa.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={() => { if (pedido) void executarLimpeza(pedido.canalId); fecharPedidoDeLimpeza(); }}>
            Limpar conversa
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
