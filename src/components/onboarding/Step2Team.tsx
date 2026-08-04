import { useEffect, useMemo, useState } from "react";
import { Loader2, Lock, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useAllAvatars } from "@/hooks/use-agent-avatar";
import { cn } from "@/lib/utils";

export interface AgentTemplateRow {
  agent_id: string;
  name: string;
  role: string;
  specialty: string | null;
  department: string | null;
  color: string | null;
  sort_order: number | null;
  is_default_active: boolean | null;
  is_leader_template: boolean | null;
}

interface Step2TeamProps {
  /** Currently selected agent_ids (persisted in step_data). */
  selectedAgentIds: string[];
  onChange: (ids: string[]) => void;
}

/**
 * Step 2 — Team selection.
 *
 * Renders one card per row from `agent_templates`. Selection rules:
 *  - `is_default_active = true`  → pre-selected on first render
 *  - `is_leader_template = true` → forced selected AND non-toggleable
 *
 * No agent_id is ever referenced in code — future leader changes only
 * require updating the seed.
 */
export function Step2Team({ selectedAgentIds, onChange }: Step2TeamProps) {
  const avatars = useAllAvatars();
  const [templates, setTemplates] = useState<AgentTemplateRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_templates")
        .select(
          "agent_id, name, role, specialty, department, color, sort_order, is_default_active, is_leader_template",
        )
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("name", { ascending: true });
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setTemplates([]);
        return;
      }
      setTemplates((data ?? []) as AgentTemplateRow[]);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // On first load, apply defaults + always-on leaders when nothing is
  // stored yet. Never overwrite an existing user choice.
  useEffect(() => {
    if (!templates) return;
    if (selectedAgentIds.length > 0) {
      // Guarantee any leader is always present even if a stale draft omitted it.
      const leaders = templates.filter((t) => t.is_leader_template).map((t) => t.agent_id);
      const missingLeader = leaders.filter((id) => !selectedAgentIds.includes(id));
      if (missingLeader.length > 0) {
        onChange([...selectedAgentIds, ...missingLeader]);
      }
      return;
    }
    const defaults = templates
      .filter((t) => t.is_default_active || t.is_leader_template)
      .map((t) => t.agent_id);
    if (defaults.length > 0) onChange(defaults);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [templates]);

  const selectedSet = useMemo(() => new Set(selectedAgentIds), [selectedAgentIds]);

  const toggle = (row: AgentTemplateRow) => {
    if (row.is_leader_template) return; // locked
    const next = new Set(selectedSet);
    if (next.has(row.agent_id)) next.delete(row.agent_id);
    else next.add(row.agent_id);
    onChange(Array.from(next));
  };

  if (templates === null) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (templates.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card/40 backdrop-blur-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="h-6 w-6" />
        </div>
        <h2 className="text-lg font-display font-semibold">Nenhum template disponível</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {error ?? "Não foi possível carregar os templates de agentes."}
        </p>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={200}>
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-display font-semibold">Escolha seu time</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            Selecione quais super-agentes serão ativados na sua dn.os. Você pode
            adicionar ou remover a qualquer momento depois.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {templates.map((row) => {
            const checked = selectedSet.has(row.agent_id) || Boolean(row.is_leader_template);
            const locked = Boolean(row.is_leader_template);
            const card = (
              <button
                type="button"
                onClick={() => toggle(row)}
                disabled={locked}
                className={cn(
                  "group relative w-full text-left rounded-xl border p-4 transition-all",
                  "bg-card/40 backdrop-blur-sm",
                  checked ? "border-primary/60 bg-primary/5" : "border-border hover:border-border/80",
                  locked ? "cursor-not-allowed opacity-95" : "hover:bg-card/60",
                )}
                aria-pressed={checked}
                aria-disabled={locked}
              >
                <div className="flex items-start gap-3">
                  {avatars[row.agent_id] ? (
                    <img
                      src={avatars[row.agent_id]}
                      alt={row.name}
                      className="mt-0.5 h-11 w-11 shrink-0 object-contain"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.display = "none";
                      }}
                      aria-hidden
                    />
                  ) : (
                    <div
                      className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg text-white text-sm font-semibold ring-1 ring-border/60"
                      style={{ backgroundColor: row.color ?? "hsl(var(--primary))" }}
                      aria-hidden
                    >
                      {row.name.slice(0, 1).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium truncate">{row.name}</span>
                      {locked && (
                        <Lock className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{row.role}</p>
                    {row.specialty && (
                      <p className="mt-1.5 text-xs text-muted-foreground/80 line-clamp-2">
                        {row.specialty}
                      </p>
                    )}
                  </div>
                  <Checkbox
                    checked={checked}
                    disabled={locked}
                    onCheckedChange={() => toggle(row)}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Selecionar ${row.name}`}
                    className="mt-1"
                  />
                </div>
              </button>
            );

            if (!locked) return <div key={row.agent_id}>{card}</div>;

            return (
              <Tooltip key={row.agent_id}>
                <TooltipTrigger asChild>
                  <div>{card}</div>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-xs text-xs">
                  {row.name} é obrigatória — ela coordena o setup dos demais agentes.
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          {selectedAgentIds.length} de {templates.length} agentes selecionados
        </p>
      </div>
    </TooltipProvider>
  );
}
