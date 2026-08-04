import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Rocket, XCircle, PartyPopper } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface AgentMeta {
  agent_id: string;
  name: string;
  color: string | null;
}

interface ProgressEntry {
  agent_id: string;
  status: "pending" | "running" | "done" | "failed" | string;
  note?: string;
}

interface Step5ActivateProps {
  selectedAgentIds: string[];
  taskId: string | null;
  onTaskCreated: (id: string) => void;
  onDone: () => void;
}

type Phase = "idle" | "starting" | "running" | "done" | "failed";

export function Step5Activate({
  selectedAgentIds,
  taskId,
  onTaskCreated,
  onDone,
}: Step5ActivateProps) {
  const [phase, setPhase] = useState<Phase>(taskId ? "running" : "idle");
  const [progress, setProgress] = useState<ProgressEntry[]>([]);
  const [agents, setAgents] = useState<AgentMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<number | null>(null);

  // Load agent metadata (name/color) for the selected ids from agent_templates.
  useEffect(() => {
    if (selectedAgentIds.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("agent_templates")
        .select("agent_id, name, color")
        .in("agent_id", selectedAgentIds);
      if (cancelled) return;
      // preserve selection order
      const map = new Map((data ?? []).map((r: any) => [r.agent_id, r]));
      setAgents(
        selectedAgentIds
          .map((id) => map.get(id))
          .filter(Boolean)
          .map((r: any) => ({ agent_id: r.agent_id, name: r.name, color: r.color })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedAgentIds]);

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      window.clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const poll = useCallback(async (id: string) => {
    const { data, error } = await supabase.functions.invoke("agent-task", {
      body: { action: "get", task_id: id },
    });
    if (error) {
      setError(error.message);
      return;
    }
    const cp = (data?.checkpoint_data ?? {}) as any;
    if (Array.isArray(cp.progress)) setProgress(cp.progress);
    if (data?.status === "done") {
      setPhase("done");
      stopPolling();
    } else if (data?.status === "failed") {
      setPhase("failed");
      setError(cp?.notes ?? "A skill falhou. Verifique o gateway.");
      stopPolling();
    }
  }, [stopPolling]);

  useEffect(() => {
    if (!taskId) return;
    poll(taskId);
    pollTimer.current = window.setInterval(() => poll(taskId), 3000);
    return () => stopPolling();
  }, [taskId, poll, stopPolling]);

  const start = async () => {
    if (selectedAgentIds.length === 0) {
      toast.error("Selecione ao menos um agente no Passo 2");
      return;
    }
    setPhase("starting");
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("agent-task", {
        body: {
          action: "create",
          task_type: "onboarding",
          selected_agents: selectedAgentIds,
          lovable_project_url: window.location.origin,
        },
      });
      if (error) throw error;
      const id = data?.task_id ?? data?.taskId;
      if (!id) throw new Error("Resposta sem task_id");
      onTaskCreated(id);
      setPhase("running");
    } catch (e: any) {
      setPhase("failed");
      setError(e?.message ?? String(e));
      toast.error("Não foi possível iniciar", { description: e?.message });
    }
  };

  /**
   * Retoma a task existente em vez de criar outra.
   *
   * "Tentar novamente" antes chamava `start`, que abre uma task nova e refaz o
   * onboarding de todos — inclusive dos agentes que já tinham dado certo. O
   * checkpoint por agente existe justamente para isso: o backend filtra os que
   * ainda não terminaram e dispara a skill só para eles.
   */
  const resume = async () => {
    if (!taskId) return start();
    setPhase("starting");
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("agent-task", {
        body: { action: "resume", task_id: taskId },
      });
      if (error) throw error;
      if (data?.status === "done") {
        setPhase("done");
        return;
      }
      setPhase("running");
      const retomados = Array.isArray(data?.resumed) ? data.resumed.length : 0;
      if (retomados > 0) {
        toast.success(
          `Retomando ${retomados} ${retomados === 1 ? "agente" : "agentes"} — os já configurados foram preservados.`,
        );
      }
    } catch (e: any) {
      setPhase("failed");
      setError(e?.message ?? String(e));
      toast.error("Não foi possível retomar", { description: e?.message });
    }
  };

  const progressByAgent = useMemo(() => {
    const m = new Map<string, ProgressEntry>();
    for (const p of progress) m.set(p.agent_id, p);
    return m;
  }, [progress]);

  const doneCount = progress.filter((p) => p.status === "done").length;
  const total = agents.length || selectedAgentIds.length;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <Rocket className="h-5 w-5" />
          <h1 className="text-2xl font-display font-semibold text-foreground">
            Ativar time
          </h1>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          A Lia vai criar cada super agente no seu gateway usando a skill{" "}
          <code className="rounded bg-muted px-1 py-0.5 text-xs">superagent-onboards</code>.
          Isso leva ~1 minuto.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-5">
        <div className="mb-4 flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            {phase === "done"
              ? "Todos os agentes foram configurados."
              : phase === "running"
                ? `Progresso: ${doneCount}/${total}`
                : `${total} agentes a configurar`}
          </span>
          {phase === "running" && (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
        </div>

        <ul className="space-y-2">
          {agents.map((a) => {
            const p = progressByAgent.get(a.agent_id);
            const status = p?.status ?? "pending";
            return (
              <li
                key={a.agent_id}
                className={cn(
                  "flex items-center justify-between rounded-lg border px-3 py-2.5 transition-colors",
                  status === "done" && "border-primary/40 bg-primary/5",
                  status === "running" && "border-primary/40",
                  status === "failed" && "border-destructive/50 bg-destructive/5",
                  status === "pending" && "border-border bg-background/40",
                )}
              >
                <div className="flex items-center gap-3">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: a.color ?? "hsl(var(--muted-foreground))" }}
                  />
                  <span className="text-sm font-medium">{a.name}</span>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {status === "done" && (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                      <span className="text-primary">Configurado</span>
                    </>
                  )}
                  {status === "running" && (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                      <span className="text-muted-foreground">Configurando…</span>
                    </>
                  )}
                  {status === "failed" && (
                    <>
                      <XCircle className="h-4 w-4 text-destructive" />
                      <span className="text-destructive">Falhou</span>
                    </>
                  )}
                  {status === "pending" && (
                    <span className="text-muted-foreground">Aguardando</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>

        {error && (
          <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        )}
      </div>

      <div className="flex justify-center">
        {phase === "idle" && (
          <Button onClick={start} size="lg" className="bg-primary hover:bg-primary/90">
            <Rocket className="h-4 w-4 mr-2" />
            Ativar time agora
          </Button>
        )}
        {phase === "starting" && (
          <Button disabled size="lg">
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Iniciando…
          </Button>
        )}
        {phase === "done" && (
          <Button onClick={onDone} size="lg" className="bg-primary hover:bg-primary/90">
            <PartyPopper className="h-4 w-4 mr-2" />
            Entrar no dn.os
          </Button>
        )}
        {phase === "failed" && (
          <div className="flex flex-col items-center gap-2">
            <Button onClick={resume} size="lg" variant="outline">
              {taskId && doneCount > 0
                ? `Retomar (${doneCount} de ${total} já prontos)`
                : "Tentar novamente"}
            </Button>
            {taskId && doneCount > 0 && (
              <p className="text-xs text-muted-foreground">
                Só os agentes que faltam são refeitos.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
