import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, RefreshCw, ChevronDown, ChevronRight, CheckCircle2, AlertCircle, Clock } from "lucide-react";

type LogRow = {
  id: string;
  agent_id: string;
  briefing: string;
  lia_session: string | null;
  lia_http_status: number | null;
  lia_response: string | null;
  lia_error: string | null;
  status: "sent" | "responded" | "failed" | "timeout";
  created_at: string;
  responded_at: string | null;
};

export default function LiaOnboardingLog({ agentId }: { agentId: string }) {
  const { role } = useAuth();
  const { toast } = useToast();
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [resending, setResending] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const isAdmin = role === "super_admin";

  async function load() {
    setLoading(true);
    let data: any[] | null = null;
    let error: any = null;
    try {
      data = await api<any[]>(`/agents/${encodeURIComponent(agentId)}/log-criacao`);
    } catch (e) {
      error = e;
    }
    if (error) {
      console.warn("[LiaOnboardingLog] load failed", error.message);
    }
    setRows((data as unknown as LogRow[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!isAdmin || !agentId) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, isAdmin]);

  async function resend() {
    setResending(true);
    try {
      const data = await api<any>(`/agents/${encodeURIComponent(agentId)}/briefing`, {
        method: "POST",
      });
      if ((data as any)?.success === false) {
        throw new Error((data as any)?.error || "Falha ao reenviar");
      }
      toast({ title: "Briefing reenviado para a Lia", description: "Aguardando resposta..." });
      setTimeout(load, 2000);
    } catch (e) {
      toast({ title: "Falha ao reenviar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setResending(false);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-display font-bold uppercase tracking-wider text-foreground">
            Onboarding da Lia
          </h3>
          <span className="text-[10px] font-mono text-muted-foreground">{rows.length} envio(s)</span>
        </div>
        <Button size="sm" variant="outline" onClick={resend} disabled={resending} className="gap-1.5">
          <RefreshCw className={`h-3.5 w-3.5 ${resending ? "animate-spin" : ""}`} />
          Reenviar briefing
        </Button>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Carregando histórico...</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Nenhum briefing registrado para este agente. Clique em "Reenviar briefing" para disparar agora — assim a Lia recebe os campos atuais do agente e cria/atualiza os arquivos no VPS.
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((r) => {
            const open = expanded[r.id];
            const statusColor =
              r.status === "responded" ? "text-success" :
              r.status === "sent" ? "text-warning" :
              "text-destructive";
            const StatusIcon =
              r.status === "responded" ? CheckCircle2 :
              r.status === "sent" ? Clock :
              AlertCircle;
            return (
              <div key={r.id} className="rounded-xl border border-border bg-card/40">
                <button
                  onClick={() => setExpanded((p) => ({ ...p, [r.id]: !p[r.id] }))}
                  className="w-full flex items-center gap-2 p-2.5 text-left hover:bg-card/70 transition-colors rounded-xl"
                >
                  {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <StatusIcon className={`h-3.5 w-3.5 ${statusColor}`} />
                  <span className={`text-[10px] font-mono uppercase font-bold ${statusColor}`}>{r.status}</span>
                  {r.lia_http_status != null && (
                    <span className="text-[10px] font-mono text-muted-foreground">HTTP {r.lia_http_status}</span>
                  )}
                  <span className="ml-auto text-[10px] font-mono text-muted-foreground">
                    {new Date(r.created_at).toLocaleString("pt-BR")}
                  </span>
                </button>
                {open && (
                  <div className="px-3 pb-3 space-y-3 text-xs">
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">Briefing enviado</div>
                      <pre className="whitespace-pre-wrap break-words rounded-lg bg-background/60 border border-border p-2 max-h-64 overflow-y-auto scrollbar-thin text-[11px] leading-relaxed">
{r.briefing}
                      </pre>
                    </div>
                    {r.lia_response && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1 font-mono">Resposta da Lia</div>
                        <pre className="whitespace-pre-wrap break-words rounded-lg bg-background/60 border border-border p-2 max-h-64 overflow-y-auto scrollbar-thin text-[11px] leading-relaxed">
{r.lia_response}
                        </pre>
                      </div>
                    )}
                    {r.lia_error && (
                      <div className="text-destructive text-[11px]">
                        Erro: {r.lia_error}
                      </div>
                    )}
                    {r.lia_session && (
                      <div className="text-[10px] font-mono text-muted-foreground">session: {r.lia_session}</div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
