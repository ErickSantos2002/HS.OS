/**
 * Cartão de aprovação do e-mail que o bot pessoal preparou (spec
 * 2026-11-05-bot-email-piloto). Vive dentro da mensagem do agente
 * (`media[{type: "email_aprovacao", id}]`).
 *
 * ⚠️ Esta é a única porta de saída para terceiros. "Enviar" manda o `hash` do
 * que está NA TELA; se o rascunho mudou no Outlook, o servidor responde 409 e o
 * cartão recarrega mostrando a versão nova.
 *
 * O status é atualizado no estado LOCAL depois da ação: o reconcile do chat
 * só percebe mensagem nova, não UPDATE de uma existente.
 */
import { useCallback, useEffect, useState } from "react";
import { Loader2, Mail } from "lucide-react";
import { ErroApi } from "@/lib/api";
import { descartarPendente, enviarPendente, linhasDoCartao, rotuloStatus, verPendente, type Pendente } from "@/lib/email";

export default function CartaoAprovacaoEmail({ id }: { id: string }) {
  const [p, setP] = useState<Pendente | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarDescarte, setConfirmarDescarte] = useState(false);

  const carregar = useCallback(async () => {
    try {
      setP(await verPendente(id));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Não consegui abrir o e-mail.");
    }
  }, [id]);

  useEffect(() => { void carregar(); }, [carregar]);

  const enviar = async () => {
    if (!p?.hash) return;
    setOcupado(true);
    setAviso(null);
    try {
      const r = await enviarPendente(id, p.hash);
      setP({ ...p, status: r.status });
    } catch (e) {
      if (e instanceof ErroApi && e.status === 409) {
        setAviso(e.message);
        await carregar();
      } else {
        setErro(e instanceof ErroApi ? e.message : "Falha ao enviar.");
        await carregar();
      }
    } finally {
      setOcupado(false);
    }
  };

  const descartar = async () => {
    setOcupado(true);
    try {
      const r = await descartarPendente(id);
      if (p) setP({ ...p, status: r.status });
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : "Falha ao descartar.");
    } finally {
      setOcupado(false);
      setConfirmarDescarte(false);
    }
  };

  if (!p && !erro) {
    return <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> abrindo e-mail…</div>;
  }

  return (
    <div className="mt-2 w-full max-w-xl rounded-xl border border-primary/30 bg-card/80 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-display font-semibold"><Mail className="h-4 w-4 text-primary" /> E-mail para aprovar</span>
        {p && <span className={`text-[11px] ${p.status === "enviado" ? "text-success" : p.status === "pendente" ? "text-primary" : "text-muted-foreground"}`}>{rotuloStatus(p.status)}</span>}
      </div>

      {erro && <p className="mb-2 text-xs text-destructive">{erro}</p>}
      {aviso && <p className="mb-2 rounded-md bg-amber-500/10 px-2 py-1 text-xs text-amber-500">{aviso}</p>}

      {p && (
        <>
          <dl className="space-y-0.5 text-xs">
            {linhasDoCartao(p).map((l) => (
              <div key={l.rotulo} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">{l.rotulo}</dt>
                <dd className={`min-w-0 break-words ${l.destaque ? "font-semibold text-foreground" : "text-foreground/90"}`}>{l.valor}</dd>
              </div>
            ))}
          </dl>
          {p.status === "pendente" && (
            <>
              <p className="mt-2 text-xs font-semibold">{p.assunto || "(sem assunto)"}</p>
              <pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md bg-secondary/30 p-2 font-sans text-xs text-foreground/90">{p.corpo}</pre>
              <div className="mt-3 flex items-center justify-end gap-2">
                {confirmarDescarte ? (
                  <>
                    <span className="text-xs text-muted-foreground">Descartar o rascunho?</span>
                    <button disabled={ocupado} onClick={() => setConfirmarDescarte(false)} className="rounded-full border border-border/40 px-3 py-1 text-xs">Não</button>
                    <button disabled={ocupado} onClick={() => void descartar()} className="rounded-full bg-destructive px-3 py-1 text-xs text-destructive-foreground">Descartar</button>
                  </>
                ) : (
                  <>
                    <button disabled={ocupado} onClick={() => setConfirmarDescarte(true)} className="rounded-full border border-border/40 px-3 py-1 text-xs hover:bg-secondary/50">Descartar</button>
                    <button disabled={ocupado || !p.hash} onClick={() => void enviar()} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground disabled:opacity-50">
                      {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} Enviar
                    </button>
                  </>
                )}
              </div>
            </>
          )}
          {p.status === "erro" && p.erro && <p className="mt-2 text-xs text-destructive">{p.erro}</p>}
        </>
      )}
    </div>
  );
}
