/**
 * As ações de uma mensagem — fonte ÚNICA para a seta do desktop
 * (`MenuDaMensagem`) e para a folha de "segurar" do celular.
 *
 * Saíram de dentro do `ChatPage` e do `MessageBubble` (03/11/2026, app do
 * celular) para não existir uma segunda lista: quem pode editar ou apagar,
 * "Apagar para mim" em qualquer mensagem, nada em mensagem otimista ou
 * apagada. Mudou uma regra, muda aqui, e os dois lados acompanham.
 */
import { BellDot, Copy, EyeOff, Info, Pencil, Reply, Trash2 } from "lucide-react";
import { toast } from "sonner";

import type { AcaoDaMensagem } from "@/components/chat/MenuDaMensagem";
import { markAgentUnread } from "@/lib/chat-sender";
import { copyToClipboard } from "@/lib/clipboard";
import type { ChatMessage } from "@/lib/mock-data";
import type { ChannelMessage } from "@/hooks/use-channels";

function copiar(texto: string) {
  void copyToClipboard(texto).then((ok) => (ok ? toast.success("Mensagem copiada") : toast.error("Não consegui copiar")));
}

/** Conversa com agente. */
export function acoesDaMensagemDoAgente(msg: ChatMessage, effectiveAgentId: string): AcaoDaMensagem[] {
  if (msg.id.startsWith("optimistic-") || msg.isError) return [];
  return [
    ...(msg.content ? [{ rotulo: "Copiar", icone: Copy, aoEscolher: () => copiar(msg.content) }] : []),
    ...(msg.role === "agent" && effectiveAgentId ? [{ rotulo: "Marcar como não lida", icone: BellDot, aoEscolher: () => {
      markAgentUnread(effectiveAgentId);
      toast.success("Marcada como não lida");
    } }] : []),
  ];
}

export interface ContextoDaMensagemDoCanal {
  souAutor: boolean;
  /** Responder citando — substituiu o "Responder em thread" em 10/11/2026. */
  aoResponder?: () => void;
  aoMarcarNaoLida: () => Promise<boolean> | boolean;
  aoEditar: () => void;
  aoApagar: () => void;
  aoDados?: () => void;
  /** "Apagar para mim": some só para quem está vendo (30/10/2026). */
  aoApagarParaMim?: () => void;
  /** Depois de responder, dados, editar, apagar e apagar-para-mim — o desktop
   *  usa para fechar o menu de toque antigo. */
  depois?: () => void;
}

/** Canal, DM e thread. */
export function acoesDaMensagemDoCanal(
  msg: Pick<ChannelMessage, "id" | "content" | "deleted_at">,
  ctx: ContextoDaMensagemDoCanal,
): AcaoDaMensagem[] {
  if (msg.id.startsWith("optimistic-") || msg.deleted_at) return [];
  const e = (fn: () => void) => () => { fn(); ctx.depois?.(); };
  return [
    // Sem `aoResponder` (canal em que a pessoa não escreve), sem a opção.
    ...(ctx.aoResponder ? [{ rotulo: "Responder", icone: Reply, aoEscolher: e(ctx.aoResponder) }] : []),
    ...(msg.content ? [{ rotulo: "Copiar", icone: Copy, aoEscolher: () => copiar(msg.content) }] : []),
    { rotulo: "Marcar como não lida", icone: BellDot, aoEscolher: () => {
      void Promise.resolve(ctx.aoMarcarNaoLida()).then(
        (ok) => (ok ? toast.success("Marcada como não lida") : toast.error("Não foi possível marcar como não lida")),
        () => toast.error("Não foi possível marcar como não lida"));
    } },
    ...(ctx.souAutor ? [
      ...(ctx.aoDados ? [{ rotulo: "Dados da mensagem", icone: Info, aoEscolher: e(ctx.aoDados) }] : []),
      { rotulo: "Editar", icone: Pencil, aoEscolher: e(ctx.aoEditar) },
      { rotulo: "Apagar", icone: Trash2, perigo: true, aoEscolher: e(ctx.aoApagar) },
    ] : []),
    // Em qualquer mensagem, inclusive a minha — como no WhatsApp. O autor não
    // fica sabendo; o "Apagar" de cima é que some para todos.
    ...(ctx.aoApagarParaMim ? [{ rotulo: "Apagar para mim", icone: EyeOff, aoEscolher: e(ctx.aoApagarParaMim) }] : []),
  ];
}

/** Resposta dentro de uma thread: o autor edita e apaga. Era o array do
 *  `ThreadMessageCard`; o celular soma o "Copiar" (`acoesDoToque`). */
export function acoesDaRespostaNaThread(
  ctx: { souAutor: boolean; aoEditar?: () => void; aoApagar?: () => void },
): AcaoDaMensagem[] {
  return [
    ...(ctx.souAutor && ctx.aoEditar ? [{ rotulo: "Editar", icone: Pencil, aoEscolher: ctx.aoEditar }] : []),
    ...(ctx.souAutor && ctx.aoApagar ? [{ rotulo: "Apagar", icone: Trash2, perigo: true, aoEscolher: ctx.aoApagar }] : []),
  ];
}
