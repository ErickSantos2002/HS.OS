import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Clock, AlertCircle, Bot, Timer, AlertTriangle, CheckCircle2 } from "lucide-react";

interface CronTabProps {
  data: any | null;
  isLoading: boolean;
}

/* Human-readable cron expression */
function describeCron(expr: string | null | undefined): string {
  if (!expr) return "";
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  // Every N minutes
  if (min.startsWith("*/") && hour === "*") return `A cada ${min.slice(2)} minutos`;
  // Every hour at :MM
  if (hour === "*" && !min.startsWith("*")) return `A cada hora, no minuto ${min}`;
  // Daily at HH:MM
  if (dom === "*" && mon === "*" && dow === "*") return `Diariamente às ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  // Weekdays
  if (dow === "1-5") return `Dias úteis às ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  // Specific days
  if (dow !== "*") return `${dowLabel(dow)} às ${hour.padStart(2, "0")}:${min.padStart(2, "0")}`;
  return expr;
}

function dowLabel(dow: string): string {
  const map: Record<string, string> = { "0": "Dom", "1": "Seg", "2": "Ter", "3": "Qua", "4": "Qui", "5": "Sex", "6": "Sáb" };
  return dow.split(",").map((d) => map[d] || d).join(", ");
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

const STATUS_MAP: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  ok: { label: "Ativo", variant: "default" },
  active: { label: "Ativo", variant: "default" },
  disabled: { label: "Desativado", variant: "secondary" },
  error: { label: "Erro", variant: "destructive" },
  failed: { label: "Falhou", variant: "destructive" },
};

export function CronTab({ data, isLoading }: CronTabProps) {
  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-4"><Skeleton className="h-5 w-full" /></div>
        ))}
      </div>
    );
  }

  const cronList: any[] = Array.isArray(data) ? data : data?.crons ?? data?.jobs ?? [];

  const activeCount = cronList.filter((c) => c.enabled !== false && c.status !== "disabled").length;
  const errorCount = cronList.filter((c) => c.status === "error" || c.status === "failed").length;

  if (!cronList.length) {
    return (
      <div className="glass-card rounded-2xl py-12 text-center">
        <AlertCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
        <p className="text-sm text-muted-foreground">
          Nenhum cron job configurado ou dados não disponíveis.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Description */}
      <div className="glass-card rounded-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
            <Timer className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h3 className="text-sm font-display font-semibold text-foreground mb-1">Cron Jobs dos Super agentes</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Tarefas agendadas que os agentes executam automaticamente em horários definidos. 
              Cada cron job dispara uma ação específica — como gerar relatórios, publicar conteúdo, 
              varrer dados de mercado ou processar filas de atendimento.
            </p>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="glass-card rounded-2xl p-3 text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Total</span>
          <span className="text-xl font-mono font-bold block text-foreground">{cronList.length}</span>
        </div>
        <div className="glass-card rounded-2xl p-3 text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Ativos</span>
          <span className="text-xl font-mono font-bold block text-success">{activeCount}</span>
        </div>
        <div className="glass-card rounded-2xl p-3 text-center">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Com erro</span>
          <span className={`text-xl font-mono font-bold block ${errorCount > 0 ? "text-destructive" : "text-success"}`}>{errorCount}</span>
        </div>
      </div>

      {/* Warning if few crons */}
      {cronList.length < 10 && (
        <Alert className="rounded-2xl border-warning/30 bg-warning/5 backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="text-xs">
            Apenas {cronList.length} cron jobs listados. O coletor da VPS pode não estar enviando todos os crons. 
            Verifique se o script está coletando a lista completa do gateway.
          </AlertDescription>
        </Alert>
      )}

      {/* Cron list */}
      <div className="space-y-3">
        {cronList.map((cron: any, i: number) => {
          const status = STATUS_MAP[cron.status] || STATUS_MAP[cron.enabled === false ? "disabled" : "ok"];
          const cronDesc = describeCron(cron.cron_expression || cron.expression);

          return (
            <div key={cron.id || i} className="glass-card-glow rounded-2xl">
              <div className="glass-card-glow-effect" />
              <div className="relative z-10 p-4">
                {/* Header */}
                <div className="flex items-center gap-2 mb-2">
                  <Clock className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-display font-semibold text-foreground">{cron.name || cron.id || `Cron #${i + 1}`}</h3>
                  {cron.agent && (
                    <Badge variant="outline" className="text-[10px] rounded-full border-primary/30 text-primary gap-1">
                      <Bot className="h-2.5 w-2.5" />
                      {cron.agent}
                    </Badge>
                  )}
                  <Badge variant={status.variant} className="ml-auto text-[10px] rounded-full">
                    {status.variant === "default" && <CheckCircle2 className="h-2.5 w-2.5 mr-1" />}
                    {status.variant === "destructive" && <AlertCircle className="h-2.5 w-2.5 mr-1" />}
                    {status.label}
                  </Badge>
                </div>

                {/* Cron expression + human description */}
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground mb-2">
                  <span className="font-mono bg-card/60 px-2 py-0.5 rounded-md border border-border/30">
                    {cron.cron_expression || cron.expression || "—"}
                  </span>
                  {cronDesc && (
                    <span className="text-primary/80 italic">{cronDesc}</span>
                  )}
                </div>

                {/* Timing info */}
                <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
                  {cron.last_run && (
                    <span>Última execução: <span className="font-mono">{formatDate(cron.last_run)}</span></span>
                  )}
                  {cron.next_run && (
                    <span>Próxima: <span className="font-mono">{formatDate(cron.next_run)}</span></span>
                  )}
                  {!cron.last_run && !cron.next_run && (
                    <span className="italic">Sem execuções registradas</span>
                  )}
                </div>

                {/* Description/prompt */}
                {(cron.description || cron.prompt) && (
                  <p className="text-xs text-muted-foreground mt-2 bg-card/40 rounded-lg px-3 py-2 border border-border/20">
                    {cron.description || cron.prompt}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
