import { useEffect, useState } from "react";
import { format } from "date-fns";
import { ArrowLeft, Copy, Loader2, Quote } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { MarkdownMessageContent } from "@/components/chat/MessageContent";
import { api } from "@/lib/api";
import { copyToClipboard } from "@/lib/clipboard";
import type { ConversaAnterior } from "@/lib/conversas-anteriores";

interface MensagemAntiga {
  id: string;
  role: string;
  content: string;
  created_at: string;
}

/**
 * Conversas encerradas por "Nova conversa", como no ChatGPT e no Claude —
 * pedido da Lidisay (RH), 14/10/2026. Spec:
 * docs/superpowers/specs/2026-10-14-conversas-anteriores-design.md
 *
 * ⚠️ Só leitura, de propósito: não há campo de digitar aqui. O objetivo é pegar
 * informação de lá; o que se reaproveita vai para a conversa de HOJE por
 * "Citar", e a sessão antiga não é retomada.
 */
export default function ConversasAnteriores({
  agentId,
  open,
  onOpenChange,
  onCitar,
  abrirConversa = null,
  destacarMensagem = null,
}: {
  agentId: string;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
  onCitar: (texto: string) => void;
  /** Vem da busca global: abre direto nesta conversa (uuid do reset). */
  abrirConversa?: string | null;
  /** Vem da busca global: rola até esta mensagem e a realça. */
  destacarMensagem?: string | null;
}) {
  const [lista, setLista] = useState<ConversaAnterior[] | null>(null);
  const [aberta, setAberta] = useState<ConversaAnterior | null>(null);
  const [mensagens, setMensagens] = useState<MensagemAntiga[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !agentId) return;
    let cancelado = false;
    setLista(null);
    setAberta(null);
    setErro(null);
    api<ConversaAnterior[]>(`/conversations/${encodeURIComponent(agentId)}/anteriores`)
      .then((l) => {
        if (cancelado) return;
        setLista(l);
        const pedida = abrirConversa ? l.find((c) => c.id === abrirConversa) : undefined;
        if (pedida) setAberta(pedida);
      })
      .catch(() => { if (!cancelado) setErro("Não consegui carregar as conversas anteriores."); });
    return () => { cancelado = true; };
  }, [open, agentId, abrirConversa]);

  useEffect(() => {
    if (!aberta) { setMensagens(null); return; }
    let cancelado = false;
    setMensagens(null);
    api<MensagemAntiga[]>(`/conversations/${encodeURIComponent(agentId)}/anteriores/${aberta.id}`)
      .then((m) => { if (!cancelado) setMensagens(m); })
      .catch(() => { if (!cancelado) setErro("Não consegui abrir esta conversa."); });
    return () => { cancelado = true; };
  }, [aberta, agentId]);

  useEffect(() => {
    if (!mensagens || !destacarMensagem) return;
    const frame = requestAnimationFrame(() => {
      const el = document.querySelector<HTMLElement>(`[data-msg-antiga="${destacarMensagem}"]`);
      if (!el) return;
      el.scrollIntoView?.({ behavior: "smooth", block: "center" });
      el.classList.add("msg-highlight");
      window.setTimeout(() => el.classList.remove("msg-highlight"), 2400);
    });
    return () => cancelAnimationFrame(frame);
  }, [mensagens, destacarMensagem]);

  const copiar = (texto: string) => {
    void copyToClipboard(texto).then((ok) => (ok ? toast.success("Mensagem copiada") : toast.error("Não consegui copiar")));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="border-b border-border/40 px-4 py-3 text-left">
          <SheetTitle>Conversas anteriores</SheetTitle>
          <SheetDescription className="sr-only">
            Conversas encerradas com este agente, para consulta.
          </SheetDescription>
        </SheetHeader>

        {erro ? (
          <p className="p-4 text-sm text-muted-foreground">{erro}</p>
        ) : !aberta ? (
          !lista ? (
            <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
          ) : lista.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">Ainda não há conversas anteriores com este agente.</p>
          ) : (
            <ul className="flex-1 space-y-1 overflow-y-auto p-2">
              {lista.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => setAberta(c)}
                    className="w-full rounded-lg px-3 py-2 text-left transition-colors hover:bg-secondary/60"
                  >
                    <span className="block truncate text-sm font-medium text-foreground">{c.titulo}</span>
                    <span className="block text-xs text-muted-foreground">
                      {format(new Date(c.inicio), "dd/MM/yyyy")} · {c.mensagens} {c.mensagens === 1 ? "mensagem" : "mensagens"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : (
          <>
            <div className="flex items-center gap-2 border-b border-border/40 bg-secondary/30 px-3 py-2">
              <button
                type="button"
                onClick={() => setAberta(null)}
                className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Voltar à lista"
                title="Voltar à lista"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">
                Conversa encerrada em {format(new Date(aberta.ate), "dd/MM")} — só leitura
              </span>
            </div>
            {!mensagens ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <div className="flex-1 space-y-3 overflow-y-auto p-3">
                {mensagens.map((m) => {
                  const minha = m.role === "user";
                  return (
                    <div key={m.id} data-msg-antiga={m.id} className={`flex flex-col ${minha ? "items-end" : "items-start"}`}>
                      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${minha ? "bg-primary/15 text-foreground" : "bg-secondary/60 text-foreground"}`}>
                        <MarkdownMessageContent text={m.content} />
                      </div>
                      <div className="mt-1 flex items-center gap-1 text-[10px] text-muted-foreground">
                        <span>{format(new Date(m.created_at), "HH:mm")}</span>
                        <button
                          type="button"
                          onClick={() => copiar(m.content)}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground"
                          aria-label="Copiar"
                          title="Copiar"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onCitar(m.content)}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-secondary hover:text-foreground"
                          aria-label="Citar na conversa atual"
                          title="Citar na conversa atual"
                        >
                          <Quote className="h-3 w-3" />
                          <span>Citar</span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
