import { useState, type ReactNode } from "react";
import { ChevronDown, Loader2, RefreshCw, Zap } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCapacidadeDoGuardi } from "@/hooks/use-capacidade-do-guardi";
import { iconeDoAssunto } from "@/lib/capacidade-icones";
import {
  classesDaCor, resumoDoSistema, temConfirmacao, textoDoEstado,
  type AssuntoDaCapacidade, type SistemaDaCapacidade,
} from "@/lib/capacidade";

/**
 * O que o Guardi alcança agora, com o login de quem pergunta — spec
 * `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`.
 *
 * Organizado por ASSUNTO (13/11/2026): a primeira versão listava as consultas
 * cruas e o TalentHS saía com 42 linhas que ninguém entendia. Cada sistema é um
 * cartão com os ícones dos seus assuntos; aberto, cada assunto é um bloco com a
 * sua cor, o que ele vê, o que ele faz e o que dizer para experimentar.
 *
 * Um componente só para desktop (dentro do `Sheet`) e celular (painel
 * `painel=capacidade` da pilha): a regra do repo é lógica compartilhada, não
 * copiada. ⚠️ Cabe em ~360px: nada aqui tem largura fixa, texto quebra.
 */
export default function Capacidade({ agentId, aberto }: { agentId: string; aberto: boolean }) {
  const { dados, erro, carregando, atualizar } = useCapacidadeDoGuardi(agentId, aberto);
  const [expandido, setExpandido] = useState<string | null>(null);

  const alternar = (s: string) => setExpandido((atual) => (atual === s ? null : s));

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <p className="min-w-0 text-xs leading-relaxed text-muted-foreground">
          O que o seu Guardi consegue fazer em cada sistema, com o <b>seu</b> login. Toque num sistema para ver os assuntos.
        </p>
        <button
          type="button"
          onClick={() => void atualizar()}
          disabled={carregando}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/60 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          title="Perguntar de novo a cada sistema"
        >
          <RefreshCw className={`h-3 w-3 ${carregando ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </div>

      {erro && <p className="text-sm text-destructive">{erro}</p>}
      {!dados && !erro && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Perguntando a cada sistema…
        </div>
      )}

      {dados && (
        <>
          <Grupo titulo="Nos sistemas da empresa">
            {dados.sistemas.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border/60 px-3 py-3 text-sm text-muted-foreground">
                Nenhum sistema ligado ao seu Guardi ainda.
              </p>
            ) : dados.sistemas.map((s) => (
              <CartaoDoSistema key={s.sistema} s={s} aberto={expandido === s.sistema} aoAlternar={() => alternar(s.sistema)} />
            ))}
          </Grupo>
          <Grupo titulo="No HS.OS">
            {dados.no_hsos.map((s) => (
              <CartaoDoSistema key={s.sistema} s={s} aberto={expandido === s.sistema} aoAlternar={() => alternar(s.sistema)} />
            ))}
          </Grupo>
        </>
      )}
    </div>
  );
}

function IconeDoAssunto({ a, tamanho }: { a: AssuntoDaCapacidade; tamanho: "p" | "m" }) {
  const Icone = iconeDoAssunto(a.icone);
  const caixa = tamanho === "p" ? "h-6 w-6 rounded-md" : "h-8 w-8 rounded-lg";
  const icone = tamanho === "p" ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <span className={`inline-flex shrink-0 items-center justify-center ${caixa} ${classesDaCor(a.cor).icone}`}>
      <Icone className={icone} aria-hidden />
    </span>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold text-muted-foreground">{titulo}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function CartaoDoSistema({ s, aberto, aoAlternar }: { s: SistemaDaCapacidade; aberto: boolean; aoAlternar: () => void }) {
  const explicacao = textoDoEstado(s.estado);
  const temNaHora = s.assuntos.some((a) => a.na_hora.length > 0);
  return (
    <div className={`min-w-0 rounded-xl border bg-card transition-colors ${aberto ? "border-border" : "border-border/60"}`}>
      <button
        type="button"
        onClick={aoAlternar}
        aria-expanded={aberto}
        className="flex w-full min-w-0 items-start gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{s.nome}</span>
            <span className={`shrink-0 text-[11px] ${s.estado === "ok" ? "text-muted-foreground" : "text-amber-700 dark:text-amber-300"}`}>
              {resumoDoSistema(s)}
            </span>
          </span>
          {s.papel && <span className="block truncate text-[11px] text-muted-foreground">seu papel lá: {s.papel}</span>}
          {s.assuntos.length > 0 && (
            <span className="mt-2 flex flex-wrap gap-1" aria-label={`Assuntos: ${s.assuntos.map((a) => a.titulo).join(", ")}`}>
              {s.assuntos.map((a) => (
                <span key={a.chave} title={a.titulo}><IconeDoAssunto a={a} tamanho="p" /></span>
              ))}
            </span>
          )}
        </span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none ${aberto ? "rotate-180" : ""}`} />
      </button>

      {aberto && (
        <div className="min-w-0 space-y-2.5 border-t border-border/50 px-3 pb-3 pt-3">
          {explicacao && <p className="text-sm text-muted-foreground">{explicacao}</p>}
          {s.estado === "ok" && s.assuntos.length === 0 && (
            <p className="text-sm text-muted-foreground">O seu login não alcança nada aqui pelo Guardi.</p>
          )}
          {s.assuntos.length > 0 && (
            <p className="text-[11px] leading-snug text-muted-foreground">
              {temNaHora
                ? <>O que tem <Zap className="inline h-3 w-3 align-[-2px]" aria-label="raio" /> sai na hora; o resto vira um cartão para você confirmar.</>
                : temConfirmacao(s) ? "O que ele faz aqui vira um cartão no chat: só acontece quando você confirma." : null}
            </p>
          )}
          {s.assuntos.map((a) => <BlocoDoAssunto key={a.chave} a={a} />)}
        </div>
      )}
    </div>
  );
}

/** "a; b; c." — as frases do "vê" como uma linha corrida. */
function frase(itens: string[]): string {
  const t = itens.join("; ");
  return t.charAt(0).toUpperCase() + t.slice(1) + ".";
}

function BlocoDoAssunto({ a }: { a: AssuntoDaCapacidade }) {
  const cor = classesDaCor(a.cor);
  return (
    <section
      aria-label={a.titulo}
      className={`min-w-0 rounded-lg border border-l-[3px] border-border/50 bg-background/60 p-3 ${cor.faixa}`}
    >
      <h4 className="flex min-w-0 items-center gap-2">
        <IconeDoAssunto a={a} tamanho="m" />
        <span className="min-w-0 break-words text-sm font-semibold text-foreground">{a.titulo}</span>
      </h4>
      <dl className="mt-2.5 space-y-2 text-sm">
        {a.ve.length > 0 && (
          <div className="flex min-w-0 gap-2">
            <dt className="w-7 shrink-0 pt-px text-[11px] font-semibold text-muted-foreground">Vê</dt>
            <dd className="min-w-0 break-words leading-snug text-foreground/90">{frase(a.ve)}</dd>
          </div>
        )}
        {a.faz.length > 0 && (
          <div className="flex min-w-0 gap-2">
            <dt className="w-7 shrink-0 pt-1 text-[11px] font-semibold text-muted-foreground">Faz</dt>
            <dd className="flex min-w-0 flex-wrap gap-1.5">
              {a.faz.map((f) => {
                const naHora = a.na_hora.includes(f);
                return (
                  <span
                    key={f}
                    title={naHora ? "Sai na hora, sem cartão" : "Vira um cartão para você confirmar"}
                    className={`inline-flex max-w-full items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-snug ring-1 ring-inset ${cor.chip}`}
                  >
                    {naHora && <Zap className="h-3 w-3 shrink-0" aria-label="sai na hora" />}
                    <span className="min-w-0 break-words">{f}</span>
                  </span>
                );
              })}
            </dd>
          </div>
        )}
      </dl>
      {a.exemplos.length > 0 && (
        <div className="mt-2.5 space-y-0.5 text-xs text-muted-foreground">
          {a.exemplos.map((e) => (
            <p key={e} className="break-words">
              Experimente: <i className="text-foreground/80">“{e}”</i>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

/** O `Capacidade` num `Sheet` lateral — o desktop, igual a "Conversas anteriores". */
export function CapacidadeNoSheet({ agentId, open, onOpenChange }: {
  agentId: string;
  open: boolean;
  onOpenChange: (aberto: boolean) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="mb-4">
          <SheetTitle>Capacidade</SheetTitle>
          <SheetDescription>O que o seu Guardi alcança agora.</SheetDescription>
        </SheetHeader>
        <Capacidade agentId={agentId} aberto={open} />
      </SheetContent>
    </Sheet>
  );
}
