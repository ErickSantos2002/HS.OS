import { useMemo } from "react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Search, X, Check } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";

export type Preset = 7 | 30 | 90 | "custom";

interface Props {
  preset: Preset;
  onPreset: (p: Preset) => void;
  desde: string;                       // yyyy-mm-dd
  ate: string;                         // yyyy-mm-dd
  onRange: (desde: string, ate: string) => void;
  /** Dia em foco dentro do período, se houver. */
  dia: string | null;
  onDia: (dia: string | null) => void;
  /** Dias com consumo no período, do mais recente para o mais antigo. */
  diasDisponiveis: { dia: string; tokens: number }[];
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const curto = (d: string) => format(new Date(`${d}T12:00:00`), "dd MMM", { locale: ptBR });

/**
 * Barra única de recorte do Analytics: período (presets ou intervalo livre) e
 * dia em foco. Antes eram três controles soltos com inputs de data nativos —
 * que quebravam em duas linhas e ignoravam o design system.
 */
export default function PeriodoToolbar({
  preset, onPreset, desde, ate, onRange, dia, onDia, diasDisponiveis,
}: Props) {
  const range: DateRange | undefined = useMemo(
    () => ({ from: new Date(`${desde}T12:00:00`), to: new Date(`${ate}T12:00:00`) }),
    [desde, ate],
  );

  const maiorDoPeriodo = useMemo(
    () => diasDisponiveis.reduce((m, d) => Math.max(m, d.tokens), 0),
    [diasDisponiveis],
  );

  const botao = (ativo: boolean) =>
    cn(
      "inline-flex items-center gap-1.5 h-9 px-3.5 rounded-xl text-[13px] font-medium tracking-tight transition-all whitespace-nowrap",
      ativo
        ? "bg-primary/10 text-primary border border-primary/30 shadow-[0_0_20px_-5px_hsl(var(--primary)/0.35)]"
        : "text-muted-foreground hover:text-foreground hover:bg-white/5 border border-transparent",
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Período */}
      <div className="flex items-center gap-1 p-1 bg-background/60 backdrop-blur-2xl border border-white/10 rounded-2xl">
        {([7, 30, 90] as const).map((d) => (
          <button key={d} onClick={() => onPreset(d)} className={botao(preset === d)}>
            {d} dias
          </button>
        ))}

        <Popover>
          <PopoverTrigger asChild>
            <button
              onClick={() => onPreset("custom")}
              className={botao(preset === "custom")}
              title="Escolher um intervalo de datas"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              {preset === "custom" ? `${curto(desde)} – ${curto(ate)}` : "Personalizado"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-0">
            <Calendar
              mode="range"
              locale={ptBR}
              defaultMonth={range?.from}
              selected={range}
              disabled={{ after: new Date() }}
              onSelect={(r) => {
                if (r?.from) {
                  onPreset("custom");
                  onRange(iso(r.from), iso(r.to ?? r.from));
                }
              }}
              numberOfMonths={2}
              className="pointer-events-auto"
            />
          </PopoverContent>
        </Popover>
      </div>

      {/* Dia em foco — some quando não há dias medidos no período */}
      {diasDisponiveis.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              className={cn(
                "inline-flex items-center gap-1.5 h-11 px-3.5 rounded-2xl text-[13px] font-medium transition-all border",
                dia
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-background/60 backdrop-blur-2xl border-white/10 text-muted-foreground hover:text-foreground",
              )}
              title="Investigar um dia específico"
            >
              <Search className="h-3.5 w-3.5" />
              {dia ? format(new Date(`${dia}T12:00:00`), "dd 'de' MMMM", { locale: ptBR }) : "Investigar um dia"}
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 p-2">
            <p className="px-2 py-1.5 text-[11px] uppercase tracking-wider text-muted-foreground">
              Dias com consumo
            </p>
            <div className="max-h-72 overflow-y-auto space-y-0.5">
              {diasDisponiveis.map((d) => {
                const ativo = dia === d.dia;
                const pct = maiorDoPeriodo ? (d.tokens / maiorDoPeriodo) * 100 : 0;
                return (
                  <button
                    key={d.dia}
                    onClick={() => onDia(ativo ? null : d.dia)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors",
                      ativo ? "bg-primary/10 text-primary" : "hover:bg-white/5 text-foreground",
                    )}
                  >
                    <span className="text-[13px] w-24 shrink-0">
                      {format(new Date(`${d.dia}T12:00:00`), "dd 'de' MMM", { locale: ptBR })}
                    </span>
                    {/* A barra deixa o pico saltar aos olhos na própria lista */}
                    <span className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
                      <span className="block h-full rounded-full bg-primary/60" style={{ width: `${pct}%` }} />
                    </span>
                    <span className="text-[11px] tabular-nums text-muted-foreground w-14 text-right">
                      {new Intl.NumberFormat("pt-BR", { notation: "compact" }).format(d.tokens)}
                    </span>
                    {ativo && <Check className="h-3.5 w-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          </PopoverContent>
        </Popover>
      )}

      {dia && (
        <button
          onClick={() => onDia(null)}
          className="inline-flex items-center justify-center h-11 w-11 rounded-2xl border border-white/10 bg-background/60 backdrop-blur-2xl text-muted-foreground hover:text-foreground transition-colors"
          title="Voltar ao período completo"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
