import { useEffect, useMemo, useState } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Zap,
  Clock,
  Plus,
  MoreVertical,
  Pencil,
  History,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Bot,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

type AutomationType = "scheduled" | "trigger";
type ScheduledDay =
  | "daily" | "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";
type TriggerEvent =
  | "gateway.offline" | "integration.added" | "integration.expired" | "user.joined" | "agent.error";
type RunStatus = "running" | "success" | "error";

interface Automation {
  id: string;
  name: string;
  agent_id: string | null;
  type: AutomationType;
  scheduled_day: ScheduledDay | null;
  scheduled_time: string | null;
  trigger_event: TriggerEvent | null;
  instruction: string;
  is_active: boolean;
  last_run_at: string | null;
  last_run_status: RunStatus | null;
  created_by: string | null;
  created_at: string;
}

interface AutomationRun {
  id: string;
  automation_id: string;
  cron_job_name: string | null;
  started_at: string;
  finished_at: string | null;
  status: RunStatus | null;
  output: string | null;
  error_message: string | null;
}

interface AgentOption {
  agent_id: string;
  name: string;
  specialty: string | null;
}

const DAYS: { value: ScheduledDay; label: string }[] = [
  { value: "daily", label: "Diariamente" },
  { value: "monday", label: "Segunda-feira" },
  { value: "tuesday", label: "Terça-feira" },
  { value: "wednesday", label: "Quarta-feira" },
  { value: "thursday", label: "Quinta-feira" },
  { value: "friday", label: "Sexta-feira" },
  { value: "saturday", label: "Sábado" },
  { value: "sunday", label: "Domingo" },
];

const TRIGGERS: { value: TriggerEvent; label: string }[] = [
  { value: "gateway.offline", label: "Gateway ficou offline" },
  { value: "integration.added", label: "Nova integração conectada" },
  { value: "integration.expired", label: "Integração expirada" },
  { value: "user.joined", label: "Novo usuário entrou" },
  { value: "agent.error", label: "Erro em agente" },
];

function dayLabel(d: ScheduledDay | null) {
  return DAYS.find((x) => x.value === d)?.label ?? "—";
}
function triggerLabel(t: TriggerEvent | null) {
  return TRIGGERS.find((x) => x.value === t)?.label ?? "—";
}

const DAY_INDEX: Record<Exclude<ScheduledDay, "daily">, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
};
const INDEX_DAY = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"] as const;
const pad = (n: number) => String(n).padStart(2, "0");

/** Convert (day, time) between America/Sao_Paulo (BRT, UTC-3, no DST) and UTC. */
const BRT_OFFSET_HOURS = 3; // BRT = UTC - 3
function convertSchedule(
  day: ScheduledDay | null,
  time: string | null,
  dir: "toUtc" | "toLocal",
): { day: ScheduledDay | null; time: string | null } {
  if (!time) return { day, time };
  const [hh, mm] = time.split(":").map(Number);
  if (Number.isNaN(hh) || Number.isNaN(mm)) return { day, time };
  // BRT -> UTC: add 3h. UTC -> BRT: subtract 3h.
  const delta = dir === "toUtc" ? BRT_OFFSET_HOURS : -BRT_OFFSET_HOURS;
  let totalMin = hh * 60 + mm + delta * 60;
  let dayShift = 0;
  while (totalMin < 0) { totalMin += 24 * 60; dayShift -= 1; }
  while (totalMin >= 24 * 60) { totalMin -= 24 * 60; dayShift += 1; }
  const newTime = `${pad(Math.floor(totalMin / 60))}:${pad(totalMin % 60)}`;
  if (!day || day === "daily") return { day: "daily", time: newTime };
  const idx = (DAY_INDEX[day] + dayShift + 7) % 7;
  return { day: INDEX_DAY[idx], time: newTime };
}


function localTzLabel(): string {
  try {
    const parts = new Intl.DateTimeFormat(undefined, { timeZoneName: "short" }).formatToParts(new Date());
    return parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  } catch {
    return "";
  }
}

function StatusBadge({ status }: { status: RunStatus | null }) {
  if (!status) return null;
  if (status === "success") {
    return (
      <Badge variant="outline" className="gap-1 border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-3 w-3" /> Sucesso
      </Badge>
    );
  }
  if (status === "error") {
    return (
      <Badge variant="outline" className="gap-1 border-destructive/40 bg-destructive/10 text-destructive">
        <AlertCircle className="h-3 w-3" /> Erro
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary animate-pulse">
      <Loader2 className="h-3 w-3 animate-spin" /> Executando
    </Badge>
  );
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Nunca executou";
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "Agora mesmo";
  if (m < 60) return `Há ${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `Há ${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `Há ${days}d`;
  return d.toLocaleDateString("pt-BR");
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return "—";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 100) / 10;
  return `${s}s`;
}

export default function AutomacoesPage() {
  const { user, role } = useAuthContext();
  const isAdmin = role === "super_admin";

  const [items, setItems] = useState<Automation[]>([]);
  const [agents, setAgents] = useState<AgentOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | null>(null);
  const [historyFor, setHistoryFor] = useState<Automation | null>(null);
  const [deleteFor, setDeleteFor] = useState<Automation | null>(null);
  const [agentFilter, setAgentFilter] = useState<string>("all");

  const filteredItems = useMemo(() => {
    if (agentFilter === "all") return items;
    return items.filter((a) => a.agent_id === agentFilter);
  }, [items, agentFilter]);


  const agentsById = useMemo(() => {
    const map = new Map<string, AgentOption>();
    for (const a of agents) map.set(a.agent_id, a);
    return map;
  }, [agents]);

  async function refresh() {
    setLoading(true);
    const [autosRes, agentsRes] = await Promise.all([
      supabase.from("automations").select("*").order("created_at", { ascending: false }),
      supabase.from("agent_profiles").select("agent_id, name, specialty").order("name"),
    ]);
    if (autosRes.error) toast.error(autosRes.error.message);
    else setItems((autosRes.data || []) as unknown as Automation[]);
    if (!agentsRes.error) setAgents((agentsRes.data || []) as AgentOption[]);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const channel = supabase
      .channel("automations-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "automations" }, () => refresh())
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function toggleActive(a: Automation, next: boolean) {
    // Optimistic update so the UI reflects immediately.
    setItems((prev) => prev.map((it) => (it.id === a.id ? { ...it, is_active: next } : it)));
    const { data, error } = await supabase
      .from("automations")
      .update({ is_active: next })
      .eq("id", a.id)
      .select("id,is_active");
    if (error) {
      // Roll back on failure.
      setItems((prev) => prev.map((it) => (it.id === a.id ? { ...it, is_active: a.is_active } : it)));
      toast.error(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setItems((prev) => prev.map((it) => (it.id === a.id ? { ...it, is_active: a.is_active } : it)));
      toast.error("Sem permissão para alterar essa automação");
      return;
    }
    toast.success(next ? "Automação ativada" : "Automação pausada");
  }

  async function handleDelete() {
    if (!deleteFor) return;
    const { error } = await supabase.from("automations").delete().eq("id", deleteFor.id);
    if (error) toast.error(error.message);
    else toast.success("Automação excluída");
    setDeleteFor(null);
  }

  return (
    <div className="flex flex-col h-full overflow-auto">
      <div className="px-6 py-5 border-b border-border/50 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-display font-semibold flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" /> Automações
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Tarefas que seus agentes executam automaticamente — agendadas ou por evento
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => { setEditing(null); setFormOpen(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Nova automação
          </Button>
        )}
      </div>

      <div className="flex-1 p-6">
        {loading ? (
          <div className="flex justify-center py-12 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground">
            <div className="h-16 w-16 rounded-2xl bg-secondary/40 flex items-center justify-center mb-4">
              <Zap className="h-8 w-8" />
            </div>
            <p className="font-medium text-foreground">Nenhuma automação configurada ainda</p>
            <p className="text-sm mt-1">Crie tarefas que rodam em horários fixos ou disparam por eventos do sistema</p>
            {isAdmin && (
              <Button className="mt-4 gap-2" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" /> Criar primeira automação
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4 max-w-7xl">
            <div className="flex items-center gap-3">
              <Select value={agentFilter} onValueChange={setAgentFilter}>
                <SelectTrigger className="w-full sm:w-[280px]" aria-label="Filtrar por agente">
                  <Bot className="h-4 w-4 text-muted-foreground mr-2" />
                  <SelectValue placeholder="Filtrar por agente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos os agentes</SelectItem>
                  {agents.map((a) => (
                    <SelectItem key={a.agent_id} value={a.agent_id}>
                      {a.name}{a.specialty ? ` · ${a.specialty}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {agentFilter !== "all" && (
                <Button variant="ghost" size="sm" onClick={() => setAgentFilter("all")}>
                  Limpar filtro
                </Button>
              )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {filteredItems.length === 0 ? (
                <p className="text-sm text-muted-foreground col-span-full py-8">
                  Nenhuma automação encontrada para este agente.
                </p>
              ) : (
                filteredItems.map((a) => {
                  const agent = a.agent_id ? agentsById.get(a.agent_id) : null;
                  const TypeIcon = a.type === "scheduled" ? Clock : Zap;
                  const local = a.type === "scheduled"
                    ? convertSchedule(a.scheduled_day, a.scheduled_time, "toLocal")
                    : { day: null, time: null };
                  const desc = a.type === "scheduled"
                    ? `${dayLabel(local.day as ScheduledDay)} às ${local.time ?? "—"} BRT`
                    : triggerLabel(a.trigger_event);
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "rounded-xl border border-border/50 bg-card p-4 flex flex-col gap-3 transition-colors hover:border-border",
                        !a.is_active && "opacity-60",
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                            <TypeIcon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium truncate">{a.name}</p>
                            <p className="text-xs text-muted-foreground truncate">{desc}</p>
                          </div>
                        </div>
                        {isAdmin && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button className="text-muted-foreground hover:text-foreground p-1 rounded">
                                <MoreVertical className="h-4 w-4" />
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => { setEditing(a); setFormOpen(true); }}>
                                <Pencil className="h-3.5 w-3.5 mr-2" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setHistoryFor(a)}>
                                <History className="h-3.5 w-3.5 mr-2" /> Ver histórico
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => setDeleteFor(a)} className="text-destructive focus:text-destructive">
                                <Trash2 className="h-3.5 w-3.5 mr-2" /> Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>

                      {agent && (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Bot className="h-3.5 w-3.5" />
                          <span className="font-medium text-foreground">{agent.name}</span>
                          {agent.specialty && <span>· {agent.specialty}</span>}
                        </div>
                      )}

                      <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
                        <div className="flex items-center gap-2 min-w-0">
                          <StatusBadge status={a.last_run_status} />
                          <span className="text-[11px] text-muted-foreground truncate">
                            {relativeTime(a.last_run_at)}
                          </span>
                        </div>
                        {isAdmin && (
                          <Switch
                            checked={a.is_active}
                            onCheckedChange={(v) => toggleActive(a, v)}
                            aria-label="Ativar/pausar"
                          />
                        )}
                      </div>
                    </div>
                  );
                }))}
          </div>
        </div>
      )}
      </div>

      {isAdmin && (
        <AutomationForm
          key={editing?.id ?? "new"}
          open={formOpen}
          onOpenChange={setFormOpen}
          editing={editing}
          agents={agents}
          currentUserId={user?.id ?? null}
          onSaved={() => { setFormOpen(false); refresh(); }}
        />
      )}

      <AutomationHistory
        automation={historyFor}
        onOpenChange={(o) => !o && setHistoryFor(null)}
      />

      <AlertDialog open={!!deleteFor} onOpenChange={(o) => !o && setDeleteFor(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir automação?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteFor?.name}" será removida permanentemente, junto com todo o histórico de execuções.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive hover:bg-destructive/90">
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* -------------------- Form drawer -------------------- */

interface FormProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Automation | null;
  agents: AgentOption[];
  currentUserId: string | null;
  onSaved: () => void;
}

function AutomationForm({ open, onOpenChange, editing, agents, currentUserId, onSaved }: FormProps) {
  // Convert stored UTC schedule back to local for editing.
  const initialLocal = editing && editing.type === "scheduled"
    ? convertSchedule(editing.scheduled_day, editing.scheduled_time, "toLocal")
    : { day: "daily" as ScheduledDay, time: "09:00" };
  const [name, setName] = useState(editing?.name ?? "");
  const [agentId, setAgentId] = useState(editing?.agent_id ?? "");
  const [type, setType] = useState<AutomationType>(editing?.type ?? "scheduled");
  const [scheduledDay, setScheduledDay] = useState<ScheduledDay>((initialLocal.day as ScheduledDay) ?? "daily");
  const [scheduledTime, setScheduledTime] = useState(initialLocal.time ?? "09:00");
  const [triggerEvent, setTriggerEvent] = useState<TriggerEvent>((editing?.trigger_event as TriggerEvent) ?? "gateway.offline");
  const [instruction, setInstruction] = useState(editing?.instruction ?? "");
  const [isActive, setIsActive] = useState(editing?.is_active ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    if (!name.trim() || !agentId || !instruction.trim()) {
      toast.error("Preencha nome, agente e instrução");
      return;
    }
    setSaving(true);
    const utc = type === "scheduled"
      ? convertSchedule(scheduledDay, scheduledTime, "toUtc")
      : { day: null, time: null };
    const payload = {
      name: name.trim(),
      agent_id: agentId,
      type,
      scheduled_day: type === "scheduled" ? utc.day : null,
      scheduled_time: type === "scheduled" ? utc.time : null,
      trigger_event: type === "trigger" ? triggerEvent : null,
      instruction: instruction.trim(),
      is_active: isActive,
      created_by: editing?.created_by ?? currentUserId,
    };
    const result = editing
      ? await supabase.from("automations").update(payload).eq("id", editing.id).select().single()
      : await supabase.from("automations").insert(payload).select().single();
    setSaving(false);
    if (result.error) {
      toast.error(result.error.message);
      return;
    }
    toast.success(editing ? "Automação atualizada" : "Automação criada");
    // Fire-and-forget confirmation DM via Lia
    try {
      supabase.functions.invoke("automations-api/notify", {
        body: { automation_id: result.data?.id, action: editing ? "updated" : "created" },
      });
    } catch (err) {
      console.warn("[automations] notify dispatch failed:", err);
    }
    onSaved();
  }


  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{editing ? "Editar automação" : "Nova automação"}</SheetTitle>
          <SheetDescription>
            Configure quando e como o agente deve ser disparado automaticamente
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-5 mt-6">
          <div className="space-y-2">
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Relatório diário de vendas" />
          </div>

          <div className="space-y-2">
            <Label>Agente responsável</Label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger><SelectValue placeholder="Selecione um agente" /></SelectTrigger>
              <SelectContent>
                {agents.map((a) => (
                  <SelectItem key={a.agent_id} value={a.agent_id}>
                    {a.name}{a.specialty ? ` · ${a.specialty}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Tipo</Label>
            <div className="grid grid-cols-2 gap-2">
              {([
                { v: "scheduled", icon: Clock, label: "Agendada", desc: "Horário fixo" },
                { v: "trigger", icon: Zap, label: "Gatilho", desc: "Por evento" },
              ] as const).map(({ v, icon: Icon, label, desc }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setType(v)}
                  className={cn(
                    "rounded-lg border p-3 text-left transition-colors",
                    type === v
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-border/80",
                  )}
                >
                  <Icon className={cn("h-4 w-4 mb-1.5", type === v ? "text-primary" : "text-muted-foreground")} />
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-[11px] text-muted-foreground">{desc}</p>
                </button>
              ))}
            </div>
          </div>

          {type === "scheduled" ? (
            <>
              <div className="space-y-2">
                <Label>Frequência</Label>
                <Select value={scheduledDay} onValueChange={(v) => setScheduledDay(v as ScheduledDay)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DAYS.map((d) => (
                      <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Horário (Brasil/São Paulo)</Label>
                <Input type="time" value={scheduledTime} onChange={(e) => setScheduledTime(e.target.value)} />
                <p className="text-[11px] text-muted-foreground">Horário de Brasília (GMT-3) — convertido automaticamente para UTC ao salvar</p>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <Label>Quando acontecer</Label>
              <Select value={triggerEvent} onValueChange={(v) => setTriggerEvent(v as TriggerEvent)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TRIGGERS.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-2">
            <Label>Instrução para o agente</Label>
            <Textarea
              rows={5}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Descreva o que o agente deve fazer quando esta automação rodar..."
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <Label className="cursor-pointer">Status</Label>
              <p className="text-[11px] text-muted-foreground">{isActive ? "Ativa — pode disparar" : "Pausada — não dispara"}</p>
            </div>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>
        </div>

        <SheetFooter className="mt-6 gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Salvar
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* -------------------- History drawer -------------------- */

function AutomationHistory({
  automation,
  onOpenChange,
}: {
  automation: Automation | null;
  onOpenChange: (v: boolean) => void;
}) {
  const [runs, setRuns] = useState<AutomationRun[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!automation) return;
    setLoading(true);
    supabase
      .from("automation_runs")
      .select("*")
      .eq("automation_id", automation.id)
      .order("started_at", { ascending: false })
      .limit(50)
      .then(({ data, error }) => {
        if (error) toast.error(error.message);
        else setRuns((data || []) as unknown as AutomationRun[]);
        setLoading(false);
      });
  }, [automation?.id]);

  return (
    <Sheet open={!!automation} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Histórico — {automation?.name}</SheetTitle>
          <SheetDescription>Últimas 50 execuções, mais recentes primeiro</SheetDescription>
        </SheetHeader>

        <div className="mt-6 space-y-2">
          {loading ? (
            <div className="flex justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : runs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              Esta automação ainda não foi executada
            </p>
          ) : (
            runs.map((r) => {
              const isOpen = expanded.has(r.id);
              return (
                <div key={r.id} className="rounded-lg border border-border/50 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <StatusBadge status={r.status} />
                      <span className="text-xs text-muted-foreground">
                        {new Date(r.started_at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted-foreground">
                      {durationLabel(r.started_at, r.finished_at)}
                    </span>
                  </div>

                  {r.error_message && (
                    <p className="text-xs text-destructive bg-destructive/10 rounded p-2">
                      {r.error_message}
                    </p>
                  )}

                  {r.output && (
                    <div>
                      <p className="text-xs text-foreground whitespace-pre-wrap">
                        {isOpen ? r.output : r.output.slice(0, 200)}
                        {!isOpen && r.output.length > 200 && "…"}
                      </p>
                      {r.output.length > 200 && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpanded((prev) => {
                              const next = new Set(prev);
                              if (next.has(r.id)) next.delete(r.id);
                              else next.add(r.id);
                              return next;
                            });
                          }}
                          className="text-[11px] text-primary hover:underline mt-1"
                        >
                          {isOpen ? "Ver menos" : "Ver completo"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
