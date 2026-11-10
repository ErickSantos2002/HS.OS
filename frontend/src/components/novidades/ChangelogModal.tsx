/**
 * "O que há de novo?" — o changelog do HS.OS, igual ao do HSGrowth e do TaskHS.
 * O conteúdo é `src/data/changelog.ts`; quem abre é o `NovidadesProvider`.
 */
import { Sparkles, Wrench, Zap } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CHANGELOG, type TipoMudanca } from "@/data/changelog";
import { APP_VERSION, formatBuildDate } from "@/lib/app-version";
import { cn } from "@/lib/utils";

const TIPOS: Record<TipoMudanca, { rotulo: string; Icone: typeof Sparkles; classe: string }> = {
  novidade: { rotulo: "Novidade", Icone: Sparkles, classe: "border-sky-500/40 bg-sky-500/10 text-sky-400" },
  melhoria: { rotulo: "Melhoria", Icone: Zap, classe: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400" },
  correcao: { rotulo: "Corrigido", Icone: Wrench, classe: "border-orange-500/40 bg-orange-500/10 text-orange-400" },
};

function dataBr(iso: string): string {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

export function ChangelogModal({ aberto, aoFechar }: { aberto: boolean; aoFechar: () => void }) {
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && aoFechar()}>
      <DialogContent className="max-w-2xl w-[calc(100vw-2rem)] max-h-[85vh] p-0 gap-0 flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-4 border-b border-border/60 text-left">
          <DialogTitle className="text-xl">O que há de novo?</DialogTitle>
          <DialogDescription>Atualizações recentes do HS.OS</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4 space-y-6">
          {CHANGELOG.map((v, i) => (
            <section key={v.version} className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="rounded-md bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground font-mono">
                  v{v.version}
                </span>
                <span className="text-xs text-muted-foreground">{dataBr(v.date)}</span>
                {i === 0 && (
                  <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-400">
                    Versão atual
                  </span>
                )}
              </div>
              <ul className="space-y-2">
                {v.changes.map((c, j) => {
                  const t = TIPOS[c.kind];
                  return (
                    <li
                      key={j}
                      className="flex items-start gap-3 rounded-lg border border-border/60 bg-muted/20 px-3 py-2.5"
                    >
                      <span
                        className={cn(
                          "mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                          t.classe,
                        )}
                      >
                        <t.Icone className="h-3 w-3" />
                        {t.rotulo}
                      </span>
                      <span className="text-sm leading-relaxed text-foreground/90">{c.text}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>

        <div
          className="border-t border-border/60 px-6 py-3 text-center text-[11px] text-muted-foreground"
          title={`Build ${APP_VERSION} · ${formatBuildDate()}`}
        >
          HS.OS — desenvolvido internamente pela equipe
        </div>
      </DialogContent>
    </Dialog>
  );
}
