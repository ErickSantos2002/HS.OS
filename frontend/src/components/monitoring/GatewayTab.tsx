import { api } from "@/lib/api";
import { useState, useEffect, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Server, Clock, Gauge, Tag, RefreshCw, Zap, ShieldCheck,
  Activity, Bot, MessageSquare, AlertTriangle, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { postProxyAction } from "@/hooks/use-monitoring-data";

/* ---------- types ---------- */
interface GatewayTabProps {
  data: any | null;
  gatewayStatus: any | null;
  processes: any | null;
  events: any | null;
  isLoading: boolean;
  /** `null` = nunca houve coleta. Não é o mesmo que o gateway estar fora. */
  gatewayOnline: boolean | null;
  healthLatencyMs: number | null;
  onForceRefetch: () => void;
  cronSummary?: any[] | null;
  agentStats?: any[] | null;
}

/* ---------- helpers ---------- */
function formatUptime(seconds: number | undefined | null): string {
  if (seconds == null) return "—";
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

function relativeTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `há ${diff}s`;
  if (diff < 3600) return `há ${Math.floor(diff / 60)}min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)}h`;
  return `há ${Math.floor(diff / 86400)}d`;
}

/* ---------- component ---------- */
export function GatewayTab({
  data, gatewayStatus, processes, events,
  isLoading, gatewayOnline, healthLatencyMs, onForceRefetch,
  cronSummary, agentStats,
}: GatewayTabProps) {
  const [restartDialogOpen, setRestartDialogOpen] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [healthHistory, setHealthHistory] = useState<any[]>([]);

  useEffect(() => () => { if (pollingRef.current) clearInterval(pollingRef.current); }, []);

  useEffect(() => {
    api<any[]>("/gateway/monitoramento/historico")
      .then((rows) => { if (rows) setHealthHistory(rows); })
      .catch(() => { /* o gráfico simplesmente não desenha */ });
  }, [data]);

  const handleRestart = useCallback(async () => {
    setRestarting(true);
    setRestartDialogOpen(false);
    toast.info("Gateway reiniciando...");
    try {
      const result = await postProxyAction("restart");
      if (result?.error) { toast.error(result.error); setRestarting(false); return; }
      let attempts = 0;
      pollingRef.current = setInterval(async () => {
        attempts++;
        onForceRefetch();
        if (attempts >= 12) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          setRestarting(false);
          toast.error("Gateway não voltou a responder após 60s");
        }
      }, 5000);
    } catch (err: any) {
      toast.error("Falha ao reiniciar: " + (err.message || "erro desconhecido"));
      setRestarting(false);
    }
  }, [onForceRefetch]);

  useEffect(() => {
    if (restarting && gatewayOnline === true) {
      if (pollingRef.current) clearInterval(pollingRef.current);
      setRestarting(false);
      toast.success("Gateway voltou online!");
    }
  }, [restarting, gatewayOnline]);

  if (isLoading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <div className="space-y-2 flex-1"><Skeleton className="h-5 w-48" /><Skeleton className="h-4 w-32" /></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  const version = data?.version || gatewayStatus?.version || "—";
  const uptimeSecs = data?.uptime_seconds ?? gatewayStatus?.uptime_seconds;
  const latency = healthLatencyMs ?? data?.latency_ms ?? gatewayStatus?.latency_ms;
  const lastCollected = data?.collected_at || gatewayStatus?.collected_at;

  const totalChecks = healthHistory.length;
  const onlineChecks = healthHistory.filter((h) => h.status === "online").length;
  const uptimePct = totalChecks > 0 ? ((onlineChecks / totalChecks) * 100) : null;

  // "SEM DADOS" é um terceiro estado de verdade: nunca houve coleta, então
  // não se sabe se está online. Dizer OFFLINE aqui era afirmar o que ninguém
  // mediu.
  const statusLabel =
    gatewayOnline === null ? "SEM DADOS" : !gatewayOnline ? "OFFLINE" : restarting ? "REINICIANDO" : "ONLINE";
  const statusGlow = statusLabel === "ONLINE"
    ? "border-success/40 shadow-[0_0_24px_-6px_hsl(var(--success)/0.3)]"
    : statusLabel === "OFFLINE"
    ? "border-destructive/40 shadow-[0_0_24px_-6px_hsl(var(--destructive)/0.3)]"
    : "border-warning/40 shadow-[0_0_24px_-6px_hsl(var(--warning)/0.3)]";
  const statusDotColor = statusLabel === "ONLINE" ? "bg-success" : statusLabel === "OFFLINE" ? "bg-destructive" : "bg-warning";

  const totalAgents = agentStats?.length ?? 0;
  const onlineAgents = agentStats?.filter((a: any) => a.status === "online").length ?? 0;
  const totalCrons = cronSummary?.length ?? 0;
  const activeCrons = cronSummary?.filter((c: any) => c.enabled !== false).length ?? 0;
  const totalMsgs = agentStats?.reduce((s: number, a: any) => s + (a.messages_today ?? 0), 0) ?? 0;
  const totalErrors = agentStats?.reduce((s: number, a: any) => s + (a.errors_today ?? 0), 0) ?? 0;

  return (
    <div className="space-y-5">
      {/* ── STATUS HERO ── */}
      <div className={`glass-card-glow rounded-2xl border-2 ${statusGlow}`}>
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 p-5">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={`h-14 w-14 rounded-2xl ${statusDotColor} flex items-center justify-center shadow-lg`}>
                <Server className="h-7 w-7 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-display font-bold text-foreground">Gateway OpenClaw</h2>
                  <Badge variant="outline" className="text-[10px] font-bold uppercase rounded-full border-current gap-1">
                    <span className={`h-2 w-2 rounded-full ${statusDotColor} inline-block`} />
                    {statusLabel}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-4 mt-1.5 text-muted-foreground">
                  <span className="flex items-center gap-1 font-mono text-xs">
                    <Tag className="h-3.5 w-3.5" /> v{version}
                  </span>
                  {uptimeSecs != null && (
                    <span className="flex items-center gap-1 font-mono text-xs">
                      <Clock className="h-3.5 w-3.5" /> {formatUptime(uptimeSecs)}
                    </span>
                  )}
                  {latency != null && (
                    <span className="flex items-center gap-1 font-mono text-xs">
                      <Gauge className="h-3.5 w-3.5" /> {latency}ms
                    </span>
                  )}
                  <span className="flex items-center gap-1 font-mono text-xs">
                    <Clock className="h-3.5 w-3.5" /> Coleta: {relativeTime(lastCollected)}
                  </span>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => onForceRefetch()} disabled={isLoading} className="gap-1.5 rounded-full">
                <RefreshCw className="h-3.5 w-3.5" /> Verificar agora
              </Button>
              <Dialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10 rounded-full" disabled={restarting}>
                    <Zap className="h-3.5 w-3.5" />
                    {restarting ? "Reiniciando..." : "Reiniciar Gateway"}
                  </Button>
                </DialogTrigger>
                <DialogContent className="glass-card rounded-2xl">
                  <DialogHeader>
                    <DialogTitle className="font-display">Reiniciar Gateway?</DialogTitle>
                    <DialogDescription>Tem certeza? Os agentes ficam offline por ~30 segundos durante o reinício.</DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRestartDialogOpen(false)} className="rounded-full">Cancelar</Button>
                    <Button variant="destructive" onClick={handleRestart} className="rounded-full">Confirmar reinício</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </div>
      </div>

      {/* ── FLEET OVERVIEW ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: Bot, label: "Super agentes", value: `${onlineAgents}/${totalAgents}`, color: onlineAgents === totalAgents ? "text-success" : "text-warning" },
          { icon: Clock, label: "Cron Jobs", value: `${activeCrons}/${totalCrons} ativos`, color: "text-foreground" },
          { icon: MessageSquare, label: "Mensagens hoje", value: totalMsgs.toLocaleString("pt-BR"), color: "text-foreground" },
          { icon: AlertTriangle, label: "Erros hoje", value: String(totalErrors), color: totalErrors > 0 ? "text-destructive" : "text-success" },
        ].map((s) => (
          <div key={s.label} className="glass-card rounded-2xl p-4 space-y-1">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <s.icon className="h-3.5 w-3.5" /> {s.label}
            </span>
            <span className={`text-2xl font-mono font-bold block ${s.color}`}>{s.value}</span>
          </div>
        ))}
      </div>

      {/* ── HEALTH TIMELINE ── */}
      <div className="glass-card-glow rounded-2xl">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <h3 className="text-sm font-display font-semibold text-foreground">Health Check Timeline</h3>
            </div>
            <div className="flex items-center gap-3">
              {uptimePct != null && (
                <span className={`text-sm font-mono font-bold ${uptimePct >= 99 ? "text-success" : uptimePct >= 95 ? "text-warning" : "text-destructive"}`}>
                  {uptimePct.toFixed(1)}% uptime
                </span>
              )}
              <Badge variant="outline" className="text-[10px] rounded-full font-mono">
                {totalChecks} checks
              </Badge>
            </div>
          </div>

          {healthHistory.length > 0 ? (
            <div className="space-y-4">
              {/* Dot grid visualization */}
              <div className="bg-card/40 backdrop-blur-sm rounded-xl p-4 border border-border/30">
                <div className="flex flex-wrap gap-1.5">
                  {healthHistory.slice(0, 60).reverse().map((h, i) => (
                    <div
                      key={i}
                      className="group relative"
                    >
                      <div
                        className={`h-4 w-4 rounded-md transition-all duration-200 cursor-default ${
                          h.status === "online"
                            ? "bg-success/60 group-hover:bg-success group-hover:shadow-sm group-hover:shadow-success/40"
                            : "bg-destructive/60 group-hover:bg-destructive group-hover:shadow-sm group-hover:shadow-destructive/40"
                        }`}
                      />
                      {/* Tooltip */}
                      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block z-20">
                        <div className="bg-card border border-border/50 rounded-lg px-2.5 py-1.5 shadow-lg text-[10px] font-mono whitespace-nowrap">
                          <div className="text-foreground">{formatDate(h.collected_at)}</div>
                          <div className={h.status === "online" ? "text-success" : "text-destructive"}>
                            {h.status} {h.version ? `• v${h.version}` : ""}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex justify-between mt-3 text-[10px] text-muted-foreground font-mono">
                  <span>← mais antigo</span>
                  <span>mais recente →</span>
                </div>
              </div>

              {/* Recent checks list */}
              <div className="space-y-0">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2 block">
                  Últimas verificações
                </span>
                {healthHistory.slice(0, 5).map((h, i) => (
                  <div key={i} className="flex items-center gap-3 text-xs py-2.5 border-b border-border/20 last:border-0">
                    <div className={`h-2.5 w-2.5 rounded-full shrink-0 ${h.status === "online" ? "bg-success shadow-sm shadow-success/30" : "bg-destructive shadow-sm shadow-destructive/30"}`} />
                    <span className="font-mono text-muted-foreground">{formatDate(h.collected_at)}</span>
                    <span className="text-muted-foreground">{relativeTime(h.collected_at)}</span>
                    <span className="ml-auto flex items-center gap-2">
                      {h.version && <span className="font-mono text-xs text-muted-foreground">v{h.version}</span>}
                      <Badge variant={h.status === "online" ? "default" : "destructive"} className="text-[10px] rounded-full capitalize">
                        {h.status === "online" ? <CheckCircle2 className="h-2.5 w-2.5 mr-1" /> : <AlertTriangle className="h-2.5 w-2.5 mr-1" />}
                        {h.status}
                      </Badge>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-2 opacity-40" />
              <p className="text-xs text-muted-foreground">Nenhum registro de verificação encontrado</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
