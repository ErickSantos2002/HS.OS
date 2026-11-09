/**
 * O que o bot pessoal lembrou (`lembrar` → `MEMORY.md`). A pessoa vê e apaga.
 * ⚠️ É o contrapeso de a memória não pedir confirmação: algo plantado por um
 * e-mail aparece aqui e sai com um clique.
 */
import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { apagarLinhaMemoria, apagarMemoria, verMemoria } from "@/lib/acoes";

export default function MemoriaDoBot() {
  const [bot, setBot] = useState<string | null>(null);
  const [linhas, setLinhas] = useState<string[]>([]);
  const [confirmar, setConfirmar] = useState(false);

  useEffect(() => {
    verMemoria().then((r) => { setBot(r.bot_nome || r.bot); setLinhas(r.linhas); }).catch(() => setBot(null));
  }, []);
  if (!bot) return null;

  const apagar = async (i: number) => {
    try { setLinhas((await apagarLinhaMemoria(i)).linhas); } catch { toast.error("Não consegui apagar."); }
  };
  const apagarTudo = async () => {
    try { setLinhas((await apagarMemoria()).linhas); setConfirmar(false); } catch { toast.error("Não consegui apagar."); }
  };

  return (
    <div className="rounded-xl border border-border/30 bg-secondary/20 px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-display font-semibold text-foreground">Memória do {bot}</h3>
        {linhas.length > 0 && (confirmar ? (
          <span className="flex items-center gap-2 text-xs">
            Apagar tudo?
            <button onClick={() => setConfirmar(false)} className="rounded-full border border-border/40 px-2 py-0.5">Não</button>
            <button onClick={() => void apagarTudo()} className="rounded-full bg-destructive px-2 py-0.5 text-destructive-foreground">Apagar</button>
          </span>
        ) : (
          <button onClick={() => setConfirmar(true)} className="text-xs text-muted-foreground hover:text-destructive">Apagar tudo</button>
        ))}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">O que o seu Guardi guardou para lembrar sempre. Apague o que não estiver certo.</p>
      {linhas.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground italic">Nada guardado ainda.</p>
      ) : (
        <ul className="mt-2 space-y-1">
          {linhas.map((l, i) => (
            <li key={`${i}-${l}`} className="flex items-start justify-between gap-2 text-xs text-foreground/90">
              <span className="min-w-0 break-words">{l}</span>
              <button onClick={() => void apagar(i)} aria-label="Apagar" className="shrink-0 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
