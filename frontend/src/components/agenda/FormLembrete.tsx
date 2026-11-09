/**
 * Criar ou editar um lembrete do Guardi. "Quando" é uma data e hora (único)
 * OU uma repetição — o servidor recusa os dois juntos. As regras de verdade
 * (5 min de antecedência, 1 ano, teto de 30 ativos) são do servidor; a tela
 * só mostra a mensagem que ele devolve.
 */
import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ErroApi } from "@/lib/api";
import {
  camposDaRegra,
  criarLembrete,
  diaEmBrasilia,
  editarLembrete,
  regraDoFormulario,
  type CamposQuando,
  type Lembrete,
  type TipoRepeticao,
} from "@/lib/agenda";
import { cn } from "@/lib/utils";

const DIAS_CURTOS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

const novoQuando = (): CamposQuando => ({
  modo: "unico", data: diaEmBrasilia(new Date()), hora: "09:00", tipo: "diario", dias: [0], dia: 1,
});

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** null = novo. */
  editando: Lembrete | null;
  aoSalvar: () => void;
}

export default function FormLembrete({ open, onOpenChange, editando, aoSalvar }: Props) {
  const [titulo, setTitulo] = useState("");
  const [instrucao, setInstrucao] = useState("");
  const [q, setQ] = useState<CamposQuando>(novoQuando);
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitulo(editando?.titulo ?? "");
    setInstrucao(editando?.instrucao ?? "");
    setQ(editando ? camposDaRegra(editando.regra) : novoQuando());
  }, [open, editando]);

  const muda = (parcial: Partial<CamposQuando>) => setQ((atual) => ({ ...atual, ...parcial }));
  const alternarDia = (d: number) =>
    muda({ dias: q.dias.includes(d) ? q.dias.filter((x) => x !== d) : [...q.dias, d] });

  const incompleto = !titulo.trim() || !q.hora || (q.modo === "unico" ? !q.data : q.tipo === "semanal" && q.dias.length === 0);

  const salvar = async () => {
    setSalvando(true);
    try {
      const regra = regraDoFormulario(q);
      const texto = instrucao.trim() || null;
      if (editando) {
        // A regra só vai se mudou: reenviar a de um único que já passou seria
        // recusada ("daqui a pelo menos 5 minutos") e travaria trocar o título.
        const antes = JSON.stringify(regraDoFormulario(camposDaRegra(editando.regra)));
        const mudouRegra = JSON.stringify(regra) !== antes;
        await editarLembrete(editando.id, { titulo: titulo.trim(), instrucao: texto, ...(mudouRegra ? regra : {}) });
        toast.success("Lembrete atualizado.");
      } else {
        await criarLembrete({ titulo: titulo.trim(), instrucao: texto, ...regra });
        toast.success("Lembrete criado.");
      }
      aoSalvar();
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof ErroApi ? e.message : "Não consegui salvar o lembrete.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editando ? "Editar lembrete" : "Novo lembrete"}</SheetTitle>
          <SheetDescription>Na hora marcada o Guardi te avisa na conversa — e, se você pedir, já faz algo.</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label htmlFor="lembrete-titulo">Título</Label>
            <Input id="lembrete-titulo" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ex.: Ligar para o cliente da proposta" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lembrete-instrucao">O que o Guardi faz na hora <span className="text-muted-foreground">(opcional)</span></Label>
            <Textarea id="lembrete-instrucao" value={instrucao} maxLength={2000} rows={3} onChange={(e) => setInstrucao(e.target.value)}
              placeholder="Ex.: Veja meus e-mails não lidos de clientes e me diga quais precisam de resposta hoje." />
          </div>

          <div className="space-y-3">
            <Label>Quando</Label>
            <div className="inline-flex rounded-lg border border-border/50 p-0.5">
              {(["unico", "repetir"] as const).map((m) => (
                <button key={m} type="button" onClick={() => muda({ modo: m })}
                  className={cn("rounded-md px-3 py-1 text-xs", q.modo === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {m === "unico" ? "Uma vez" : "Repetir"}
                </button>
              ))}
            </div>

            {q.modo === "unico" ? (
              <div className="flex gap-2">
                <Input type="date" aria-label="Data" value={q.data} onChange={(e) => muda({ data: e.target.value })} />
                <Input type="time" aria-label="Hora" value={q.hora} onChange={(e) => muda({ hora: e.target.value })} className="w-32" />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <Select value={q.tipo} onValueChange={(v) => muda({ tipo: v as TipoRepeticao })}>
                    <SelectTrigger aria-label="Repetição"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="diario">Todo dia</SelectItem>
                      <SelectItem value="dias_uteis">Dias úteis</SelectItem>
                      <SelectItem value="semanal">Dias da semana</SelectItem>
                      <SelectItem value="mensal">Dia do mês</SelectItem>
                    </SelectContent>
                  </Select>
                  <Input type="time" aria-label="Hora" value={q.hora} onChange={(e) => muda({ hora: e.target.value })} className="w-32" />
                </div>
                {q.tipo === "semanal" && (
                  <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dias da semana">
                    {DIAS_CURTOS.map((rotulo, d) => (
                      <button key={d} type="button" aria-pressed={q.dias.includes(d)} onClick={() => alternarDia(d)}
                        className={cn("h-8 min-w-[44px] rounded-full border px-2 text-xs",
                          q.dias.includes(d) ? "border-primary bg-primary/15 text-primary" : "border-border/50 text-muted-foreground hover:text-foreground")}>
                        {rotulo}
                      </button>
                    ))}
                  </div>
                )}
                {q.tipo === "mensal" && (
                  <div className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Todo dia</span>
                    <Input type="number" min={1} max={31} aria-label="Dia do mês" value={q.dia} className="w-20"
                      onChange={(e) => muda({ dia: Math.min(31, Math.max(1, Number(e.target.value) || 1)) })} />
                    <span className="text-muted-foreground">do mês</span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <SheetFooter className="mt-8">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={() => void salvar()} disabled={salvando || incompleto} className="gap-2">
            {salvando && <Loader2 className="h-4 w-4 animate-spin" />} Salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
