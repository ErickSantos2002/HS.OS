/**
 * Cartão de confirmação de uma ação do bot pessoal num sistema interno
 * (`media[{type: "acao_aprovacao", id}]`). Mostra os CAMPOS do payload — é o
 * que o servidor executa — e o resumo só como título. Status atualizado no
 * estado local (o reconcile do chat não re-renderiza UPDATE).
 */
import { useCallback, useEffect, useState } from "react";
import { CheckSquare, ListTodo, Loader2, Square } from "lucide-react";
import { ErroApi } from "@/lib/api";
import { cartaoDaAcao, cancelarAcao, confirmarAcao, rotuloAcao, verAcao, type Acao } from "@/lib/acoes";

export default function CartaoAcao({ id }: { id: string }) {
  const [a, setA] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const carregar = useCallback(async () => {
    try { setA(await verAcao(id)); setErro(null); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : "Não consegui abrir a ação."); }
  }, [id]);
  useEffect(() => { void carregar(); }, [carregar]);

  const agir = async (f: () => Promise<{ status: string; resultado?: string }>) => {
    setOcupado(true);
    try { const r = await f(); if (a) setA({ ...a, status: r.status, resultado: r.resultado ?? a.resultado }); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : "Falhou."); await carregar(); }
    finally { setOcupado(false); }
  };

  if (!a && !erro) return <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> abrindo…</div>;

  const c = a ? cartaoDaAcao(a.acao, a.payload) : null;
  const corStatus = a?.status === "feita" ? "bg-success/15 text-success" : a?.status === "pendente"
    ? "bg-primary/15 text-primary" : a?.status === "erro" ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground";

  return (
    <div className="mt-2 w-full max-w-xl overflow-hidden rounded-xl border border-primary/30 bg-card/80 text-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/30 bg-secondary/20 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5 text-primary" /> {a?.sistema === "taskhs" ? "TaskHS" : a?.sistema}{c && ` · ${c.verbo}`}
        </span>
        {a && <span className={`rounded-full px-2 py-0.5 text-[11px] ${corStatus}`}>{rotuloAcao(a.status)}</span>}
      </div>
      <div className="space-y-3 p-3">
        {erro && <p className="text-xs text-destructive">{erro}</p>}
        {c && (
          <>
            {c.titulo && <p className="font-display text-[15px] font-semibold leading-snug text-foreground break-words">{c.titulo}</p>}
            {c.linhas.length > 0 && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                {c.linhas.map(([k, val]) => (
                  <div key={k} className="min-w-0">
                    <dt className="text-[10px] uppercase tracking-wide text-muted-foreground">{k}</dt>
                    <dd className="break-words text-foreground/90">{val}</dd>
                  </div>
                ))}
              </dl>
            )}
            {c.texto && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{c.texto.rotulo}</div>
                <p className="max-h-40 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-secondary/30 p-2 text-xs text-foreground/90">{c.texto.valor}</p>
              </div>
            )}
            {c.checklist && (
              <div>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {c.checklist.titulo} · {c.checklist.itens.length} {c.checklist.itens.length === 1 ? "item" : "itens"}
                </div>
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-secondary/30 p-2 text-xs">
                  {c.checklist.itens.map((it, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {it.feito ? <CheckSquare className="mt-px h-3.5 w-3.5 shrink-0 text-success" /> : <Square className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 break-words text-foreground/90">
                        {it.feito === false && <span className="text-muted-foreground">desmarcar: </span>}{it.texto}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {a?.resultado && <p className="text-xs text-muted-foreground">{a.resultado}</p>}
            {a?.status === "erro" && a.erro && <p className="text-xs text-destructive">{a.erro}</p>}
          </>
        )}
      </div>
      {a?.status === "pendente" && (
        <div className="flex justify-end gap-2 border-t border-border/30 px-3 py-2">
          <button disabled={ocupado} onClick={() => void agir(() => cancelarAcao(id))} className="rounded-full border border-border/40 px-3 py-1 text-xs hover:bg-secondary/50">Cancelar</button>
          <button disabled={ocupado} onClick={() => void agir(() => confirmarAcao(id))} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
            {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} Confirmar
          </button>
        </div>
      )}
    </div>
  );
}
