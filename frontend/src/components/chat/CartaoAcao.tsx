/**
 * Cartão de confirmação de uma ação do bot pessoal num sistema interno
 * (`media[{type: "acao_aprovacao", id}]`). Mostra os CAMPOS do payload — é o
 * que o servidor executa — e o resumo só como título. Status atualizado no
 * estado local (o reconcile do chat não re-renderiza UPDATE).
 *
 * Com `par` (26/11/2026, aviso de ausência ao RH): duas ações alternativas
 * num cartão só — os campos são os da principal e os botões são os rótulos
 * das duas (ex.: Recusar | Aprovar). Cada botão confirma a SUA ação, que
 * executa só o próprio payload gravado; o servidor cancela a outra.
 */
import { useCallback, useEffect, useState } from "react";
import { CheckSquare, ListTodo, Loader2, Square } from "lucide-react";
import { ErroApi } from "@/lib/api";
import { cartaoDaAcao, cancelarAcao, confirmarAcao, estadoDoPar, nomeDoSistema, rotuloAcao, verAcao, type Acao } from "@/lib/acoes";

interface Par { id: string; rotulo?: string }

export default function CartaoAcao({ id, rotulo, par }: { id: string; rotulo?: string; par?: Par }) {
  const [a, setA] = useState<Acao | null>(null);
  const [b, setB] = useState<Acao | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const parId = par?.id;
  const carregar = useCallback(async () => {
    try {
      const [x, y] = await Promise.all([verAcao(id), parId ? verAcao(parId) : Promise.resolve(null)]);
      setA(x); setB(y); setErro(null);
    }
    catch (e) { setErro(e instanceof ErroApi ? e.message : "Não consegui abrir a ação."); }
  }, [id, parId]);
  useEffect(() => { void carregar(); }, [carregar]);

  const agir = async (f: () => Promise<{ status: string; resultado?: string }>) => {
    setOcupado(true);
    try { const r = await f(); if (a) setA({ ...a, status: r.status, resultado: r.resultado ?? a.resultado }); }
    catch (e) { setErro(e instanceof ErroApi ? e.message : "Falhou."); await carregar(); }
    finally { setOcupado(false); }
  };

  // Par: escolher uma confirma a SUA ação; a outra o servidor cancela.
  const escolher = async (qual: "principal" | "outra") => {
    const alvo = qual === "principal" ? id : parId!;
    setOcupado(true);
    try {
      const r = await confirmarAcao(alvo);
      const feita = (x: Acao | null) => x && { ...x, status: r.status, resultado: r.resultado ?? x.resultado };
      const cancelada = (x: Acao | null) => x && { ...x, status: "cancelada" };
      if (qual === "principal") { setA(feita(a)); setB(cancelada(b)); } else { setB(feita(b)); setA(cancelada(a)); }
    }
    catch (e) { setErro(e instanceof ErroApi ? e.message : "Falhou."); await carregar(); }
    finally { setOcupado(false); }
  };

  if (!a && !erro) return <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> abrindo…</div>;

  const c = a ? cartaoDaAcao(a.acao, a.payload) : null;
  const ep = par ? estadoDoPar(a, b) : null;
  const escolhida = ep?.escolhida === "outra" ? b : a;
  const status = ep ? ep.status : a?.status;
  const rotuloDaEscolhida = ep?.escolhida === "outra" ? par?.rotulo : rotulo;
  const selo = !a ? "" : !ep ? rotuloAcao(a.status)
    : ep.pendente ? "Aguardando sua decisão"
    : ep.escolhida && status === "feita" ? `✓ ${rotuloDaEscolhida ?? "Feito"}`
    : rotuloAcao(status ?? "");
  const corStatus = status === "feita" ? "bg-success/15 text-success" : status === "pendente"
    ? "bg-primary/15 text-primary" : status === "erro" ? "bg-destructive/15 text-destructive" : "bg-secondary text-muted-foreground";

  return (
    <div className="mt-2 w-full max-w-xl overflow-hidden rounded-xl border border-primary/30 bg-card/80 text-sm">
      <div className="flex items-center justify-between gap-2 border-b border-border/30 bg-secondary/20 px-3 py-2">
        <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <ListTodo className="h-3.5 w-3.5 text-primary" /> {nomeDoSistema(a?.sistema)}
          {par ? ` · ${[par.rotulo, rotulo].filter(Boolean).join(" ou ")}` : c && ` · ${c.verbo}`}
        </span>
        {a && <span className={`rounded-full px-2 py-0.5 text-[11px] ${corStatus}`}>{selo}</span>}
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
            {c.checklists.map((cl, n) => (
              <div key={n}>
                <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {cl.titulo} · {cl.itens.length} {cl.itens.length === 1 ? "item" : "itens"}
                </div>
                <ul className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-secondary/30 p-2 text-xs">
                  {cl.itens.map((it, i) => (
                    <li key={i} className="flex items-start gap-2">
                      {it.feito ? <CheckSquare className="mt-px h-3.5 w-3.5 shrink-0 text-success" /> : <Square className="mt-px h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      <span className="min-w-0 break-words text-foreground/90">
                        {it.feito === false && <span className="text-muted-foreground">desmarcar: </span>}{it.texto}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {escolhida?.resultado && <p className="text-xs text-muted-foreground">{escolhida.resultado}</p>}
            {escolhida?.status === "erro" && escolhida.erro && <p className="text-xs text-destructive">{escolhida.erro}</p>}
          </>
        )}
      </div>
      {ep?.pendente && (
        <div className="flex justify-end gap-2 border-t border-border/30 px-3 py-2">
          <button disabled={ocupado} onClick={() => void escolher("outra")} className="rounded-full border border-border/40 px-3 py-1 text-xs hover:bg-secondary/50">
            {par?.rotulo ?? "Outra opção"}
          </button>
          <button disabled={ocupado} onClick={() => void escolher("principal")} className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1 text-xs text-primary-foreground">
            {ocupado && <Loader2 className="h-3 w-3 animate-spin" />} {rotulo ?? "Confirmar"}
          </button>
        </div>
      )}
      {!par && a?.status === "pendente" && (
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
