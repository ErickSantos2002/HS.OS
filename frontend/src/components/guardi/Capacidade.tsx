import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, Loader2, RefreshCw } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useCapacidadeDoGuardi } from "@/hooks/use-capacidade-do-guardi";
import {
  resumoDoSistema, textoDoEstado, tituloDoFazer,
  type ItemDaCapacidade, type SistemaDaCapacidade,
} from "@/lib/capacidade";

/**
 * O que o Guardi alcança agora, com o login de quem pergunta — spec
 * `docs/superpowers/specs/2026-11-13-capacidade-do-guardi-design.md`.
 *
 * Um componente só para desktop (dentro do `Sheet`) e celular (painel
 * `painel=capacidade` da pilha): a regra do repo é lógica compartilhada, não
 * copiada.
 */
export default function Capacidade({ agentId, aberto }: { agentId: string; aberto: boolean }) {
  const { dados, erro, carregando, atualizar } = useCapacidadeDoGuardi(agentId, aberto);
  const [expandido, setExpandido] = useState<string | null>(null);

  const alternar = (s: string) => setExpandido((atual) => (atual === s ? null : s));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          O que o seu Guardi consegue fazer em cada sistema, com o <b>seu</b> login.
        </p>
        <button
          type="button"
          onClick={() => void atualizar()}
          disabled={carregando}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border/40 px-2.5 py-1 text-[11px] text-muted-foreground hover:bg-secondary/50 hover:text-foreground disabled:opacity-40"
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
              <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum sistema ligado ao seu Guardi ainda.</p>
            ) : dados.sistemas.map((s) => (
              <LinhaDoSistema key={s.sistema} s={s} aberto={expandido === s.sistema} aoAlternar={() => alternar(s.sistema)} />
            ))}
          </Grupo>
          <Grupo titulo="No HS.OS">
            {dados.no_hsos.map((s) => (
              <LinhaDoSistema key={s.sistema} s={s} aberto={expandido === s.sistema} aoAlternar={() => alternar(s.sistema)} />
            ))}
          </Grupo>
        </>
      )}
    </div>
  );
}

function Grupo({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</h3>
      <div className="divide-y divide-border/40 rounded-lg border border-border/40">{children}</div>
    </section>
  );
}

function LinhaDoSistema({ s, aberto, aoAlternar }: { s: SistemaDaCapacidade; aberto: boolean; aoAlternar: () => void }) {
  const explicacao = textoDoEstado(s.estado);
  const Seta = aberto ? ChevronDown : ChevronRight;
  return (
    <div>
      <button
        type="button"
        onClick={aoAlternar}
        aria-expanded={aberto}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-secondary/40"
      >
        <Seta className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">{s.nome}</span>
          {s.papel && <span className="block truncate text-[11px] text-muted-foreground">seu papel lá: {s.papel}</span>}
        </span>
        <span className={`shrink-0 text-[11px] ${s.estado === "ok" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400"}`}>
          {resumoDoSistema(s)}
        </span>
      </button>
      {aberto && (
        <div className="space-y-3 px-3 pb-3 pl-9">
          {explicacao && <p className="text-sm text-muted-foreground">{explicacao}</p>}
          {s.estado === "ok" && s.consultar.length === 0 && s.fazer.length === 0 && (
            <p className="text-sm text-muted-foreground">O seu login não alcança nada aqui pelo Guardi.</p>
          )}
          <Secao titulo="Consultar" itens={s.consultar} />
          <Secao titulo={tituloDoFazer(s.fazer)} itens={s.fazer} marcarConfirmacao={!s.fazer.every((i) => i.confirma)} />
        </div>
      )}
    </div>
  );
}

function Secao({ titulo, itens, marcarConfirmacao = false }: { titulo: string; itens: ItemDaCapacidade[]; marcarConfirmacao?: boolean }) {
  if (itens.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1 text-xs font-semibold text-foreground">{titulo}</h4>
      <ul className="space-y-1.5">
        {itens.map((i) => (
          <li key={i.rotulo} className="text-sm leading-snug text-foreground/90">
            {i.rotulo}
            {marcarConfirmacao && i.confirma && <span className="ml-1 text-[11px] text-muted-foreground">(com sua confirmação)</span>}
            {i.exemplo && <span className="block text-xs italic text-muted-foreground">“{i.exemplo}”</span>}
          </li>
        ))}
      </ul>
    </div>
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
