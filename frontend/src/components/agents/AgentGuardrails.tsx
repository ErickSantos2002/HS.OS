import { api } from "@/lib/api";
import { useQuery } from "@tanstack/react-query";
import { Shield } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { normalizeAgentId } from "@/lib/active-agents";

interface Guardrail {
  name: string;
  description: string;
  category: string;
  status: "active" | "inactive";
}

interface Props {
  agentId: string;
}

export default function AgentGuardrails({ agentId }: Props) {
  const shortId = normalizeAgentId(agentId);
  const { data, isLoading } = useQuery({
    queryKey: ["agent-guardrails", shortId],
    queryFn: async () => {
      return await api<Guardrail[]>(
        `/agents/${encodeURIComponent(shortId)}/guardrails`,
      );
    },
    staleTime: 30_000,
  });

  const items = data ?? [];

  return (
    <section className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Shield className="h-3.5 w-3.5 text-primary" />
        <h3 className="text-[10px] font-display font-bold text-muted-foreground uppercase tracking-[0.2em]">
          Guardrails
        </h3>
        <span className="ml-auto text-[10px] font-mono text-muted-foreground">
          {isLoading ? "…" : items.length}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-14 w-full rounded-xl" />
          <Skeleton className="h-14 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center py-4">
          Nenhum guardrail cadastrado
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((g, idx) => {
            const isActive = g.status === "active";
            return (
              <li
                key={`${g.name}-${idx}`}
                className="rounded-xl border border-border/60 bg-card/40 p-3 space-y-1.5"
              >
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-xs font-display font-bold text-foreground flex-1 min-w-0">
                    {g.name}
                  </span>
                  <span className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md border border-border/60 text-muted-foreground">
                    {g.category}
                  </span>
                  <span
                    className={`text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-md ${
                      isActive
                        ? "bg-success/15 text-success"
                        : "bg-muted/50 text-muted-foreground"
                    }`}
                  >
                    {isActive ? "active" : "inactive"}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {g.description}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
