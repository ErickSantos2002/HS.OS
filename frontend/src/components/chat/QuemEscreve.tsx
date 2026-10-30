import { Megaphone } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface CandidatoEscritor { id: string; nome: string; avatar_url?: string | null }

/**
 * "Só quem eu escolher envia mensagens" — o canal de avisos, igual ao grupo do
 * WhatsApp em que só o Nicholson e o RH mandam. Usado ao criar e ao editar o
 * canal; só o administrador o vê. O administrador sempre escreve, por isso não
 * precisa estar na lista.
 */
export default function QuemEscreve({
  ativo, onAtivo, candidatos, escolhidos, onAlternar,
}: {
  ativo: boolean;
  onAtivo: (v: boolean) => void;
  candidatos: CandidatoEscritor[];
  escolhidos: string[];
  onAlternar: (id: string) => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
          <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Só quem eu escolher envia mensagens
          </Label>
        </div>
        <Switch checked={ativo} onCheckedChange={onAtivo} aria-label="Só quem eu escolher envia mensagens" />
      </div>
      {ativo && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Os outros membros só leem. Administrador sempre envia.
            {candidatos.length === 0 && " Escolha as pessoas do canal primeiro."}
          </p>
          <div className="grid grid-cols-2 gap-2">
            {candidatos.map((c) => {
              const sel = escolhidos.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => onAlternar(c.id)}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-all text-left ${
                    sel
                      ? "border-primary/40 bg-primary/10 text-foreground"
                      : "border-border/20 bg-secondary/15 text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                  }`}
                >
                  <div className="h-6 w-6 rounded-full shrink-0 overflow-hidden flex items-center justify-center bg-gradient-to-br from-primary/40 to-primary/10">
                    {c.avatar_url ? (
                      <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-bold text-foreground">{c.nome.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  <span className="truncate text-xs">{c.nome}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
