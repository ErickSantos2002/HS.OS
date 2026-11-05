/**
 * Cartão de confirmação de uma ação do bot pessoal num sistema interno
 * (`media[{type: "acao_aprovacao", id}]`). Mostra os CAMPOS do payload — é o
 * que o servidor executa — e o resumo só como título. Status atualizado no
 * estado local (o reconcile do chat não re-renderiza UPDATE).
 */
import { useCallback, useEffect, useState } from "react";
import { ListTodo, Loader2 } from "lucide-react";
import { ErroApi } from "@/lib/api";
import { camposDaAcao, cancelarAcao, confirmarAcao, rotuloAcao, verAcao, type Acao } from "@/lib/acoes";

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

  return (
    <div className="mt-2 w-full max-w-xl rounded-xl border border-primary/30 bg-card/80 p-3 text-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 font-display font-semibold"><ListTodo className="h-4 w-4 text-primary" /> {a?.sistema === "taskhs" ? "TaskHS" : a?.sistema} — confirmar</span>
        {a && <span className={`text-[11px] ${a.status === "feita" ? "text-success" : a.status === "pendente" ? "text-primary" : "text-muted-foreground"}`}>{rotuloAcao(a.status)}</span>}
      </div>
      {erro && <p className="mb-2 text-xs text-destructive">{erro}</p>}
      {a && (
        <>
          <dl className="space-y-0.5 text-xs">
            {camposDaAcao(a.acao, a.payload).map(([k, v]) => (
              <div key={k} className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">{k}</dt>
                <dd className="min-w-0 whitespace-pre-wrap break-words text-foreground/90">{v}</dd>
              </div>
            ))}
          </dl>
          {a.status === "pendente" && (
            <div className="mt-3 flex justify-end gap-2">
              <button disabled={ocupado} onClick={() => void agir(() => cancelarAcao(id))} className="rounded-full border border-border/40 px-3 py-1 text-xs hover:bg-secondary/50">Cancelar</button>
              <button disabled={ocupado} onClick={() => void agir(() => confirmarAcao(id))} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
                {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} Confirmar
              </button>
            </div>
          )}
          {a.resultado && <p className="mt-2 text-xs text-muted-foreground">{a.resultado}</p>}
          {a.status === "erro" && a.erro && <p className="mt-2 text-xs text-destructive">{a.erro}</p>}
        </>
      )}
    </div>
  );
}
