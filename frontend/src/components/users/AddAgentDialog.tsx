import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Loader2,
  ChevronLeft,
  ChevronRight,
  Check,
  AlertTriangle,
  X,
  Circle,
  Plus,
  ExternalLink,
  Sparkles,
} from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { AvatarCropDialog } from "@/components/AvatarCropDialog";
import { uploadAgentAvatar } from "@/lib/avatar-upload";
import { Camera } from "lucide-react";
import { useGatewayModels } from "@/hooks/use-gateway-models";

export interface PendingAgent {
  agent_id: string;
  openclaw_id: string;
  name: string;
  emoji: string;
  specialty: string;
  pending: true;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (agent: PendingAgent) => void;
}

// Sem lista hardcoded: os modelos vêm do Gateway via useGatewayModels. Havia
// uma constante aqui e outra no AgentEditDrawer, independentes — elas
// divergiram e a do editor passou a gravar o modelo errado no Gateway.

interface IntegrationRow {
  id: string;
  name: string;
  icon: string | null;
  category: string;
  key_name: string;
  is_configured: boolean;
}

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
const TOTAL_STEPS = 8;

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

const ID_RE = /^[a-z0-9-]{2,}$/;

const STEP_TITLES: Record<Step, string> = {
  1: "Identidade",
  2: "Configuração técnica",
  3: "Habilidades",
  4: "Integrações",
  5: "Persona",
  6: "Automações",
  7: "Acesso",
  8: "Resumo e confirmação",
};

type AccessType = "all" | "admins_only" | "specific_users";

interface PlatformUser {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

export function AddAgentDialog({ open, onOpenChange, onCreated }: Props) {
  const [step, setStep] = useState<Step>(1);
  const { models: gatewayModels, isFallback: modelsAreFallback } = useGatewayModels();

  // Step 1
  const [name, setName] = useState("");
  const [agentId, setAgentId] = useState("");
  const [idEdited, setIdEdited] = useState(false);
  const [emoji, setEmoji] = useState("🤖");
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [specialty, setSpecialty] = useState("");
  const [description, setDescription] = useState("");

  const [checkingId, setCheckingId] = useState(false);
  const [idExists, setIdExists] = useState(false);

  // Step 2 — começa vazio e assume o primeiro modelo do Gateway quando a lista
  // chega (ver effectiveModel abaixo); a validação exige escolha explícita.
  const [model, setModel] = useState<string>("");
  const [workspace, setWorkspace] = useState("");
  const [workspaceEdited, setWorkspaceEdited] = useState(false);
  const [workspaceMode, setWorkspaceMode] = useState<"new" | "existing">("new");
  const [existingWorkspaces, setExistingWorkspaces] = useState<string[]>([]);
  const [workspaceOwners, setWorkspaceOwners] = useState<Record<string, string>>({});
  const [workspacesLoading, setWorkspacesLoading] = useState(false);
  const [workspacesLoadFailed, setWorkspacesLoadFailed] = useState(false);
  const [behavior, setBehavior] = useState("");

  // Step 3 — Skills
  const [skillsDescription, setSkillsDescription] = useState("");
  const [skillsTags, setSkillsTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");

  // Step 4 — Integrations
  const [integrations, setIntegrations] = useState<IntegrationRow[]>([]);
  const [existingAgents, setExistingAgents] = useState<{ id: string; name: string }[]>([]);
  const [integrationsLoading, setIntegrationsLoading] = useState(false);
  const [selectedIntegrations, setSelectedIntegrations] = useState<string[]>([]);

  // Step 5 — Persona
  const [personaDescription, setPersonaDescription] = useState("");
  const [behaviorRestrictions, setBehaviorRestrictions] = useState("");

  // Step 6 — Crons
  const [cronsDescription, setCronsDescription] = useState("");
  const [liaOnboarding, setLiaOnboarding] = useState(true);

  // Step 8 — Leadership
  interface LeaderOption { agent_id: string; name: string; emoji: string; is_leader: boolean }
  const [leaderOptions, setLeaderOptions] = useState<LeaderOption[]>([]);
  const [hasLeader, setHasLeader] = useState(false);
  const [selectedLeaderId, setSelectedLeaderId] = useState<string>("");

  // Step 7 — Access
  const [accessType, setAccessType] = useState<AccessType>("all");
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  const [platformUsers, setPlatformUsers] = useState<PlatformUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);

  type StepState = "pending" | "running" | "done" | "error";
  const [phase, setPhase] = useState<"form" | "progress" | "done" | "error">("form");
  const [progress, setProgress] = useState<{
    openclaw: StepState;
    supabase: StepState;
    lia: StepState;
  }>({ openclaw: "pending", supabase: "pending", lia: "pending" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [errorStep, setErrorStep] = useState<string | null>(null);

  const [errors, setErrors] = useState<Record<string, string>>({});

  // Reset
  useEffect(() => {
    if (!open) return;
    setStep(1);
    setName("");
    setAgentId("");
    setIdEdited(false);
    setEmoji("🤖");
    setAvatarDataUrl(null);
    setSpecialty("");
    setDescription("");
    setIdExists(false);
    setCheckingId(false);
    setModel("");
    setWorkspace("");
    setWorkspaceEdited(false);
    setWorkspaceMode("new");
    setExistingWorkspaces([]);
    setWorkspaceOwners({});
    setWorkspacesLoadFailed(false);
    setBehavior("");
    setSkillsDescription("");
    setSkillsTags([]);
    setTagDraft("");
    setSelectedIntegrations([]);
    setPersonaDescription("");
    setBehaviorRestrictions("");
    setCronsDescription("");
    setAccessType("all");
    setAllowedUserIds([]);
    setExistingAgents([]);
    setLeaderOptions([]);
    setHasLeader(false);
    setSelectedLeaderId("");
    setSubmitting(false);
    setErrors({});
    setPhase("form");
    setProgress({ openclaw: "pending", supabase: "pending", lia: "pending" });
    setErrorMsg(null);
    setErrorStep(null);
  }, [open]);

  // Load current user + platform users for access step
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;
      const uid = auth?.user?.id ?? null;
      setCurrentUserId(uid);
      if (uid) setAllowedUserIds((prev) => (prev.includes(uid) ? prev : [uid, ...prev]));
    })();
    return () => { cancelled = true; };
  }, [open]);

  useEffect(() => {
    if (!open || step !== 7 || platformUsers.length > 0) return;
    let cancelled = false;
    setUsersLoading(true);
    (async () => {
      const { data } = await api<any[]>("/profiles").then((d) => ({ data: d })).catch(() => ({ data: [] as any[] }));
      if (cancelled) return;
      setPlatformUsers((data ?? []) as PlatformUser[]);
      setUsersLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, step, platformUsers.length]);

  useEffect(() => {
    if (!idEdited) setAgentId(slugify(name));
  }, [name, idEdited]);

  useEffect(() => {
    setWorkspace(agentId ? `/root/.openclaw/workspace-${agentId}` : "");
  }, [agentId]);

  // Load existing workspaces from OpenClaw when reaching step 2
  useEffect(() => {
    if (!open || step !== 2 || existingWorkspaces.length > 0 || workspacesLoadFailed) return;
    let cancelled = false;
    setWorkspacesLoading(true);
    (async () => {
      try {
        // A edge só derivava isto do `agents.list` do gateway, e o nosso
        // `/agents` já devolve `workspace` — não precisa de endpoint próprio.
        const resposta = await api<{
          agents: Array<{ id: string; name: string | null; workspace: string | null }>;
        }>("/agents");
        if (cancelled) return;
        const agents = resposta.agents
          .filter((a) => !!a.workspace)
          .map((a) => ({ id: a.id, name: a.name, workspace: a.workspace as string }));
        const owners: Record<string, string> = {};
        for (const a of agents) {
          if (a.workspace && !owners[a.workspace]) {
            owners[a.workspace] = a.name ?? a.id ?? "agente";
          }
        }
        const uniq = Array.from(new Set(agents.map((a) => a.workspace).filter(Boolean))).sort();
        setExistingWorkspaces(uniq as string[]);
        setWorkspaceOwners(owners);
      } catch {
        if (cancelled) return;
        setWorkspacesLoadFailed(true);
        setWorkspaceMode("new");
        toast({
          title: "Não foi possível carregar workspaces existentes",
          description: "Continue criando um novo workspace abaixo.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setWorkspacesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, existingWorkspaces.length, workspacesLoadFailed]);

  // Load integrations when reaching step 4
  useEffect(() => {
    if (!open || step !== 4 || integrations.length > 0) return;
    let cancelled = false;
    setIntegrationsLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from("integrations")
        .select("id, name, icon, category, key_name, is_configured")
        .order("category", { ascending: true })
        .order("name", { ascending: true });
      if (cancelled) return;
      if (!error && data) setIntegrations(data as IntegrationRow[]);
      setIntegrationsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, step, integrations.length]);

  // Load existing agents (IDs + names) to filter per-agent integrations
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("agent_profiles")
        .select("agent_id, openclaw_id, name");
      if (cancelled) return;
      const agents = (data ?? []).map((row: any) => ({
        id: String(row.openclaw_id ?? row.agent_id ?? "").trim().toLowerCase(),
        name: String(row.name ?? "").trim().toLowerCase(),
      })).filter((a) => a.id || a.name);
      setExistingAgents(agents);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load leader options when reaching Step 8
  useEffect(() => {
    if (!open || step !== 8 || leaderOptions.length > 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("agent_profiles")
        .select("agent_id, name, emoji, is_leader")
        .order("name", { ascending: true });
      if (cancelled || !data) return;
      const opts: LeaderOption[] = (data as any[])
        .filter((a) => a.agent_id !== agentId)
        .map((a) => ({
          agent_id: a.agent_id,
          name: a.name ?? a.agent_id,
          emoji: a.emoji ?? "🤖",
          is_leader: !!a.is_leader,
        }));
      setLeaderOptions(opts);
      const defaultLeader = opts.find((o) => o.is_leader) ?? null;
      if (defaultLeader && !selectedLeaderId) {
        setSelectedLeaderId(defaultLeader.agent_id);
        setHasLeader(true);
      }
    })();
    return () => { cancelled = true; };
  }, [open, step, leaderOptions.length, agentId, selectedLeaderId]);

  const filteredIntegrations = useMemo(() => {
    const ids = new Set(existingAgents.map((a) => a.id).filter(Boolean));
    const names = new Set(existingAgents.map((a) => a.name).filter(Boolean));
    return integrations.filter((it) => {
      const keyName = it.key_name?.toLowerCase() ?? "";
      const name = it.name?.trim() ?? "";
      const nameLower = name.toLowerCase();
      // Exclude LLM providers (model is selected in Step 2)
      if (it.category?.toLowerCase() === "llm") return false;
      // Exclude any Telegram-related integration
      if (keyName.includes("telegram") || nameLower.includes("telegram")) return false;
      // Exclude if key_name contains an existing agent ID
      for (const id of ids) {
        if (id && keyName.includes(id)) return false;
      }
      // Exclude if name follows pattern "[Integration] — [Agent]" and the agent part matches an existing agent name
      const emDashIdx = name.indexOf("—");
      if (emDashIdx > 0) {
        const agentPart = name.slice(emDashIdx + 1).trim().toLowerCase();
        if (agentPart && names.has(agentPart)) return false;
      }
      return true;
    });
  }, [integrations, existingAgents]);


  // Enquanto a lista do Gateway não chega, `model` fica vazio — assumir o
  // primeiro modelo disponível evita um Select em branco na criação.
  const effectiveModel = model || gatewayModels[0]?.qualifiedId || "";

  const modelLabel = useMemo(
    () => gatewayModels.find((m) => m.qualifiedId === effectiveModel)?.label ?? effectiveModel,
    [gatewayModels, effectiveModel],
  );

  const integrationsByCategory = useMemo(() => {
    const map = new Map<string, IntegrationRow[]>();
    for (const it of filteredIntegrations) {
      const key = it.category || "Outros";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(it);
    }
    return Array.from(map.entries());
  }, [filteredIntegrations]);

  const selectedIntegrationRows = useMemo(
    () => filteredIntegrations.filter((i) => selectedIntegrations.includes(i.key_name)),
    [filteredIntegrations, selectedIntegrations],
  );

  function validateStep1(): boolean {
    const e: Record<string, string> = {};
    if (name.trim().length < 2) e.name = "Nome deve ter ao menos 2 caracteres.";
    if (!ID_RE.test(agentId)) e.id = "ID inválido. Use apenas letras minúsculas, números e hífen.";
    if (specialty.trim().length < 5) e.specialty = "Descreva a especialidade (mín. 5 caracteres).";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function validateStep2(): boolean {
    const e: Record<string, string> = {};
    if (!effectiveModel) e.model = "Selecione um modelo.";
    if (!workspace.trim()) e.workspace = "Workspace é obrigatório.";
    if (existingWorkspaces.includes(workspace))
      e.workspace = "Este workspace já existe. Volte ao Passo 1 e escolha outro ID.";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function checkIdExists() {
    if (!ID_RE.test(agentId)) return;
    setCheckingId(true);
    setIdExists(false);
    const { data } = await supabase
      .from("agent_profiles")
      .select("agent_id, openclaw_id")
      .or(`openclaw_id.eq.${agentId},agent_id.eq.${agentId}`)
      .maybeSingle();
    setIdExists(!!data);
    setCheckingId(false);
  }

  async function importExisting() {
    setSubmitting(true);
    try {
      await api("/agents/sync", { method: "POST" });
    } catch (e) {
      setSubmitting(false);
      toast({
        title: "Erro ao importar",
        description: (e as Error).message,
        variant: "destructive",
      });
      return;
    }
    setSubmitting(false);
    toast({
      title: "Importação concluída",
      description: "O agente existente foi sincronizado a partir do OpenClaw.",
    });
    onOpenChange(false);
    onCreated?.({
      agent_id: agentId,
      openclaw_id: agentId,
      name: name || agentId,
      emoji,
      specialty,
      pending: true,
    });
  }

  function addTag(raw: string) {
    const t = raw.trim().slice(0, 40);
    if (!t) return;
    setSkillsTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setTagDraft("");
  }

  function next() {
    if (step === 1) {
      if (!validateStep1()) return;
    } else if (step === 2) {
      if (!validateStep2()) return;
    }
    if (step < TOTAL_STEPS) setStep(((step as number) + 1) as Step);
  }

  function back() {
    if (step === 1) {
      onOpenChange(false);
      return;
    }
    setStep(((step as number) - 1) as Step);
  }

  async function submit() {
    setSubmitting(true);
    setPhase("progress");
    setErrorMsg(null);
    setErrorStep(null);
    setProgress({ openclaw: "running", supabase: "pending", lia: "pending" });

    try {
      const resultado = await api<{ orquestrador_avisado: boolean }>("/agents", {
        method: "POST",
        body: {
          openclaw_id: agentId,
          name,
          emoji,
          specialty,
          description,
          model: effectiveModel,
          workspace,
          channels: ["webchat"],
          behavior,
          skills_description: skillsDescription,
          skills_tags: skillsTags,
          integrations_used: selectedIntegrations,
          persona_description: personaDescription,
          behavior_restrictions: behaviorRestrictions,
          crons_description: cronsDescription || "",
          lia_onboarding: liaOnboarding,
          access_type: accessType,
          allowed_user_ids: accessType === "specific_users" ? allowedUserIds : [],
          leader_id: hasLeader && selectedLeaderId ? selectedLeaderId : null,
        },
      });

      // Não há mais como falhar "no meio": o endpoint só grava depois de o
      // gateway aceitar, então se chegou aqui as duas primeiras etapas deram
      // certo. O aviso ao orquestrador é best effort e vem no resultado.
      setProgress({
        openclaw: "done",
        supabase: "done",
        lia: resultado.orquestrador_avisado ? "done" : "error",
      });
      if (!resultado.orquestrador_avisado) {
        toast({
          title: "Agente criado, mas o orquestrador não foi avisado",
          description: "Ele existe no gateway e no banco. Reenvie o briefing pela tela do agente.",
          variant: "destructive",
        });
      }

      // Upload avatar if user picked one
      if (avatarDataUrl) {
        try {
          await uploadAgentAvatar(agentId, avatarDataUrl);
        } catch (err) {
          console.warn("[create-agent] avatar upload failed", err);
          toast({
            title: "Agente criado, mas a foto não pôde ser salva",
            description: (err as Error).message,
            variant: "destructive",
          });
        }
      }

      onCreated?.({
        agent_id: agentId,
        openclaw_id: agentId,
        name,
        emoji,
        specialty,
        pending: true,
      });

      setPhase("done");
      setSubmitting(false);
    } catch (e) {
      setProgress((p) => ({ ...p, openclaw: p.openclaw === "running" ? "error" : p.openclaw }));
      setErrorStep("openclaw");
      setErrorMsg((e as Error).message);
      setPhase("error");
      setSubmitting(false);
    }
  }

  function retry() {
    setPhase("form");
    setStep(8);
    setProgress({ openclaw: "pending", supabase: "pending", lia: "pending" });
    setErrorMsg(null);
    setErrorStep(null);
  }

  function openChat() {
    onOpenChange(false);
    window.location.href = `/chat?agent=${encodeURIComponent(agentId)}`;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-lg rounded-2xl p-0 gap-0">
        <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
          <DialogTitle className="font-display font-bold text-foreground relative z-10 flex items-center gap-2">
            <span className="text-xl">{emoji}</span>
            Adicionar Agente IA
          </DialogTitle>
          {/* Stepper */}
          <div className="relative z-10 mt-3 flex items-center gap-1.5">
            {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((n) => (
              <div key={n} className="flex items-center gap-1.5 flex-1">
                <div
                  className={`h-5 w-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                    step >= n
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary/50 text-muted-foreground"
                  }`}
                >
                  {step > n ? <Check className="h-3 w-3" /> : n}
                </div>
                <div
                  className={`h-0.5 flex-1 rounded-full ${
                    step > n ? "bg-primary" : "bg-secondary/40"
                  } ${n === TOTAL_STEPS ? "hidden" : ""}`}
                />
              </div>
            ))}
          </div>
          <p className="relative z-10 mt-2 text-xs text-muted-foreground">
            Passo {step} de {TOTAL_STEPS} · {STEP_TITLES[step]}
            {(step === 3 || step === 4 || step === 5 || step === 6) && (
              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-muted-foreground">
                {step === 6 ? "Opcional" : "Opcional"}
              </span>
            )}
          </p>
        </DialogHeader>

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {phase !== "form" && (
            <ProgressView
              phase={phase}
              progress={progress}
              name={name}
              emoji={emoji}
              errorMsg={errorMsg}
              errorStep={errorStep}
            />
          )}

          {phase === "form" && step === 1 && (
            <>
              <Field label="Nome*" error={errors.name}>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  placeholder="Ex: Nova"
                  className="glass-input w-full px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md"
                />
              </Field>

              <Field
                label="ID no OpenClaw*"
                hint="Usado como identificador técnico. Lowercase, sem espaços."
                error={errors.id}
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-mono">openclaw:</span>
                  <input
                    value={agentId}
                    onChange={(e) => {
                      setIdEdited(true);
                      setAgentId(slugify(e.target.value));
                      setIdExists(false);
                    }}
                    onBlur={checkIdExists}
                    maxLength={32}
                    placeholder="nova"
                    className="glass-input flex-1 px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md font-mono"
                  />
                  {checkingId && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </div>
                {idExists && (
                  <div className="mt-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-2">
                    <p className="flex items-start gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                      Este ID já existe no OpenClaw. Deseja importar a configuração existente em
                      vez de criar um novo?
                    </p>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={importExisting}
                        className="px-3 py-1.5 rounded-full bg-amber-500/30 hover:bg-amber-500/40 text-amber-100 text-xs font-medium disabled:opacity-50"
                      >
                        {submitting ? "Importando..." : "Importar existente"}
                      </button>
                      <button
                        type="button"
                        onClick={() => setIdExists(false)}
                        className="px-3 py-1.5 rounded-full border border-amber-500/40 text-amber-100 text-xs hover:bg-amber-500/10"
                      >
                        Continuar criando mesmo assim
                      </button>
                    </div>
                  </div>
                )}
              </Field>

              <Field label="Foto do agente" hint="Opcional — você pode mover e ajustar o zoom.">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setAvatarPickerOpen(true)}
                    className="relative h-16 w-16 rounded-full overflow-hidden border border-border/40 bg-secondary/30 hover:bg-secondary/60 flex items-center justify-center group"
                  >
                    {avatarDataUrl ? (
                      <img src={avatarDataUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Camera className="h-5 w-5 text-muted-foreground" />
                    )}
                    <span className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center text-[10px] text-white transition-opacity">
                      Editar
                    </span>
                  </button>
                  <div className="text-xs text-muted-foreground">
                    {avatarDataUrl ? "Clique para reajustar" : "Clique para enviar uma foto"}
                  </div>
                  {avatarDataUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarDataUrl(null)}
                      className="text-[10px] text-muted-foreground hover:text-destructive underline"
                    >
                      Remover
                    </button>
                  )}
                </div>
              </Field>

              <Field label="Emoji (fallback)">
                <input
                  value={emoji}
                  onChange={(e) => setEmoji(e.target.value.slice(0, 2) || "🤖")}
                  maxLength={2}
                  className="glass-input w-20 px-3 py-2.5 text-lg text-center bg-transparent text-foreground focus:outline-none rounded-md"
                />
              </Field>

              <Field label="Especialidade*" error={errors.specialty}>
                <input
                  value={specialty}
                  onChange={(e) => setSpecialty(e.target.value)}
                  maxLength={120}
                  placeholder="Ex: Suporte a clientes e retenção"
                  className="glass-input w-full px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md"
                />
              </Field>

              <Field label="Descrição" hint="Opcional">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  maxLength={500}
                  rows={2}
                  placeholder="Ex: Agente de atendimento pós-venda"
                  className="glass-input w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md resize-none"
                />
              </Field>
            </>
          )}

          {phase === "form" && step === 2 && (
            <>
              <Field label="Modelo de IA" error={errors.model}>
                <Select value={effectiveModel} onValueChange={setModel}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {gatewayModels.map((m) => (
                      <SelectItem key={m.qualifiedId} value={m.qualifiedId}>
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {modelsAreFallback && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Não foi possível confirmar os modelos com o Gateway — lista de referência.
                  </p>
                )}
              </Field>

              <Field
                label="Workspace"
                error={errors.workspace}
                hint="Derivado automaticamente do ID do agente. Cada agente tem seu próprio workspace no OpenClaw."
              >
                <div className="glass-input w-full px-3 py-2.5 text-xs font-mono bg-transparent text-muted-foreground rounded-md flex items-center gap-2">
                  <span className="text-primary">📁</span>
                  <span className="truncate">
                    {agentId ? `/root/.openclaw/workspace-${agentId}` : "/root/.openclaw/workspace-{id}"}
                  </span>
                </div>
                {agentId && existingWorkspaces.includes(`/root/.openclaw/workspace-${agentId}`) && (
                  <div className="mt-2 flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-foreground">
                    <Sparkles className="h-3.5 w-3.5 mt-0.5 text-destructive shrink-0" />
                    <span>
                      Já existe um agente <strong>{workspaceOwners[`/root/.openclaw/workspace-${agentId}`] ?? agentId}</strong> usando este workspace. Escolha outro ID no Passo 1.
                    </span>
                  </div>
                )}
              </Field>

              <Field label="Comportamento / Tom" hint="Opcional">
                <textarea
                  value={behavior}
                  onChange={(e) => setBehavior(e.target.value)}
                  rows={3}
                  maxLength={500}
                  placeholder="Descreva o tom e estilo do agente. Ex: Direto e técnico, sem rodeios."
                  className="glass-input w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md resize-none"
                />
              </Field>
            </>
          )}

          {phase === "form" && step === 3 && (
            <>
              <p className="text-sm text-muted-foreground">O que este agente sabe fazer?</p>

              <Field label="Especialidade principal" hint="Recomendado">
                <textarea
                  value={skillsDescription}
                  onChange={(e) => setSkillsDescription(e.target.value)}
                  rows={4}
                  maxLength={600}
                  placeholder="Ex: Analisa métricas de Meta Ads, monitora budget de campanhas e alerta sobre anomalias de performance."
                  className="glass-input w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md resize-none"
                />
              </Field>

              <Field label="Tags de habilidade" hint="Digite e pressione Enter para adicionar">
                <input
                  value={tagDraft}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag(tagDraft);
                    } else if (e.key === "Backspace" && !tagDraft && skillsTags.length) {
                      setSkillsTags((prev) => prev.slice(0, -1));
                    }
                  }}
                  placeholder="Ex: Meta Ads"
                  className="glass-input w-full px-3 py-2.5 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md"
                />
                {skillsTags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {skillsTags.map((t) => (
                      <span
                        key={t}
                        className="inline-flex items-center gap-1 pl-2.5 pr-1 py-0.5 rounded-full bg-primary/15 text-primary text-xs font-medium border border-primary/30"
                      >
                        {t}
                        <button
                          type="button"
                          onClick={() => setSkillsTags((prev) => prev.filter((x) => x !== t))}
                          className="h-4 w-4 rounded-full hover:bg-primary/20 flex items-center justify-center"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </Field>
            </>
          )}

          {phase === "form" && step === 4 && (
            <>
              <p className="text-sm text-muted-foreground">
                Quais APIs e ferramentas este agente vai usar?
              </p>

              {integrationsLoading ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Carregando integrações…
                </div>
              ) : filteredIntegrations.length === 0 ? (
                <div className="rounded-lg border border-border/40 bg-secondary/20 p-4 text-sm text-muted-foreground">
                  Nenhuma integração genérica disponível. Todas as integrações cadastradas pertencem a agentes existentes.
                </div>
              ) : (
                <TooltipProvider delayDuration={200}>
                  <div className="space-y-4">
                    {integrationsByCategory.map(([cat, items]) => (
                      <div key={cat} className="space-y-1.5">
                        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {cat}
                        </p>
                        <div className="space-y-1">
                          {items.map((it) => {
                            const checked = selectedIntegrations.includes(it.key_name);
                            const disabled = !it.is_configured;
                            const row = (
                              <label
                                key={it.id}
                                className={`flex items-center gap-2 px-2.5 py-2 rounded-md text-sm border border-border/30 bg-secondary/10 ${
                                  disabled
                                    ? "opacity-60 cursor-not-allowed"
                                    : "cursor-pointer hover:bg-secondary/30"
                                }`}
                              >
                                <Checkbox
                                  checked={checked}
                                  disabled={disabled}
                                  onCheckedChange={(v) => {
                                    if (disabled) return;
                                    setSelectedIntegrations((prev) =>
                                      v
                                        ? Array.from(new Set([...prev, it.key_name]))
                                        : prev.filter((x) => x !== it.key_name),
                                    );
                                  }}
                                />
                                <span className="text-base leading-none">{it.icon ?? "🔑"}</span>
                                <span className="text-foreground flex-1 truncate">{it.name}</span>
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-muted-foreground shrink-0">
                                  {it.category}
                                </span>
                                {disabled && (
                                  <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                                )}
                              </label>
                            );
                            return disabled ? (
                              <Tooltip key={it.id}>
                                <TooltipTrigger asChild>
                                  <div>{row}</div>
                                </TooltipTrigger>
                                <TooltipContent side="left">
                                  Integração pendente de configuração
                                </TooltipContent>
                              </Tooltip>
                            ) : (
                              <div key={it.id}>{row}</div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </TooltipProvider>
              )}

              <a
                href="/settings?tab=integrations"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline pt-1"
              >
                <Plus className="h-3 w-3" />
                Adicionar nova integração
                <ExternalLink className="h-3 w-3" />
              </a>
            </>
          )}

          {phase === "form" && step === 5 && (
            <>
              <p className="text-sm text-muted-foreground">
                Descreva como você quer que este agente seja. A Lia vai escrever a alma dele.
              </p>

              <Field label="Persona" hint="Recomendado">
                <textarea
                  value={personaDescription}
                  onChange={(e) => setPersonaDescription(e.target.value)}
                  rows={6}
                  maxLength={1500}
                  placeholder="Ex: Quero um agente direto ao ponto, que não enrola. Tom profissional mas sem formalidade excessiva. Especialista em dados, fala em números e porcentagens."
                  className="glass-input w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md resize-none"
                />
              </Field>

              <Field label="Alguma restrição importante?" hint="Recomendado">
                <textarea
                  value={behaviorRestrictions}
                  onChange={(e) => setBehaviorRestrictions(e.target.value)}
                  rows={3}
                  maxLength={600}
                  placeholder="Ex: Nunca tomar decisões financeiras sozinho. Sempre confirmar com o Rodrigo antes de publicar."
                  className="glass-input w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md resize-none"
                />
              </Field>
            </>
          )}

          {phase === "form" && step === 6 && (
            <>
              <p className="text-sm text-muted-foreground">
                Descreva tarefas que este agente deve executar automaticamente (opcional)
              </p>

              <Field label="Automações desejadas">
                <textarea
                  value={cronsDescription}
                  onChange={(e) => setCronsDescription(e.target.value)}
                  rows={6}
                  maxLength={1500}
                  placeholder="Ex: Todo dia às 9h, verificar o budget das campanhas Meta e me avisar se estiver acima de 80% do limite mensal. Toda segunda-feira, gerar relatório semanal de performance."
                  className="glass-input w-full px-3 py-2 text-sm bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none rounded-md resize-none"
                />
              </Field>

              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 text-primary shrink-0" />
                A Lia vai configurar os agendamentos no servidor com base na sua descrição.
              </div>

              <button
                type="button"
                onClick={() => {
                  setCronsDescription("");
                  setStep(7);
                }}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
              >
                Pular esta etapa
              </button>
            </>
          )}

          {phase === "form" && step === 7 && (
            <>
              <p className="text-sm text-muted-foreground">Quem pode conversar com este agente?</p>

              <div className="space-y-2">
                {([
                  { v: "all", title: "Todos da plataforma", desc: "Qualquer membro autenticado pode acessar este agente." },
                  { v: "admins_only", title: "Apenas administradores", desc: "Somente usuários com perfil Super Admin têm acesso." },
                  { v: "specific_users", title: "Usuários específicos", desc: "Selecione quais membros podem acessar este agente." },
                ] as const).map((opt) => {
                  const selected = accessType === opt.v;
                  return (
                    <label
                      key={opt.v}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                        selected
                          ? "border-primary/60 bg-primary/10"
                          : "border-border/40 bg-secondary/10 hover:bg-secondary/30"
                      }`}
                    >
                      <input
                        type="radio"
                        name="access_type"
                        checked={selected}
                        onChange={() => setAccessType(opt.v)}
                        className="mt-1 accent-primary"
                      />
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-foreground">{opt.title}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  );
                })}
              </div>

              {accessType === "specific_users" && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Usuários autorizados
                  </p>
                  {usersLoading ? (
                    <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando usuários…
                    </div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border border-border/40 p-1.5 bg-secondary/10">
                      {platformUsers.map((u) => {
                        const isCreator = u.id === currentUserId;
                        const checked = allowedUserIds.includes(u.id) || isCreator;
                        return (
                          <label
                            key={u.id}
                            className={`flex items-center gap-2.5 px-2.5 py-2 rounded-md text-sm ${
                              isCreator ? "opacity-80 cursor-not-allowed" : "cursor-pointer hover:bg-secondary/40"
                            }`}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={isCreator}
                              onCheckedChange={(v) => {
                                if (isCreator) return;
                                setAllowedUserIds((prev) =>
                                  v ? Array.from(new Set([...prev, u.id])) : prev.filter((x) => x !== u.id),
                                );
                              }}
                            />
                            <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/60 to-primary/20 flex items-center justify-center overflow-hidden shrink-0">
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-[10px] font-bold">
                                  {(u.full_name || u.email).charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-foreground truncate">
                                {u.full_name || u.email}
                                {isCreator && (
                                  <span className="ml-1.5 text-[10px] text-primary">(você · sempre)</span>
                                )}
                              </p>
                              {u.full_name && (
                                <p className="text-[10px] text-muted-foreground truncate">{u.email}</p>
                              )}
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {phase === "form" && step === 8 && (

            <>
              <div className="rounded-xl border border-border/40 bg-secondary/20 p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-violet-500/70 to-indigo-600/40 flex items-center justify-center text-2xl">
                    {emoji}
                  </div>
                  <div>
                    <p className="text-base font-display font-bold text-foreground">{name}</p>
                    <p className="text-xs text-muted-foreground font-mono">openclaw:{agentId}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-1.5 text-xs pt-2 border-t border-border/30">
                  <SummaryLine label="Especialidade" value={specialty} />
                  <SummaryLine label="Modelo" value={modelLabel} />
                  <SummaryLine label="Workspace" value={workspace} mono />
                  <SummaryLine
                    label="Acesso"
                    value={
                      accessType === "all"
                        ? "Todos"
                        : accessType === "admins_only"
                          ? "Apenas admins"
                          : `${allowedUserIds.length} usuário${allowedUserIds.length === 1 ? "" : "s"} específico${allowedUserIds.length === 1 ? "" : "s"}`
                    }
                  />
                </div>

                {(skillsTags.length > 0 || skillsDescription) && (
                  <div className="pt-3 border-t border-border/30 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Habilidades
                    </p>
                    {skillsTags.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {skillsTags.map((t) => (
                          <span
                            key={t}
                            className="text-[10px] px-2 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/30"
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {selectedIntegrationRows.length > 0 && (
                  <div className="pt-3 border-t border-border/30 space-y-1.5">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Integrações
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedIntegrationRows.map((i) => (
                        <span
                          key={i.id}
                          title={i.name}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-secondary/40 text-xs"
                        >
                          <span>{i.icon ?? "🔑"}</span>
                          <span className="text-foreground">{i.name}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {personaDescription && (
                  <div className="pt-3 border-t border-border/30">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                      Persona
                    </p>
                    <p className="text-xs text-foreground">
                      {personaDescription.slice(0, 100)}
                      {personaDescription.length > 100 ? "…" : ""}
                    </p>
                  </div>
                )}

                <div className="pt-3 border-t border-border/30">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                    Automações
                  </p>
                  <p className="text-xs text-foreground">
                    {cronsDescription
                      ? `${cronsDescription.slice(0, 80)}${cronsDescription.length > 80 ? "…" : ""}`
                      : "Nenhuma configurada"}
                  </p>
                </div>

                <div className="pt-3 border-t border-border/30">
                  <p className="text-xs font-semibold text-foreground mb-2">O que acontecerá:</p>
                  <ul className="text-xs text-muted-foreground space-y-1">
                    <li>• Agente registrado no OpenClaw</li>
                    <li>• Workspace criado no servidor</li>
                    <li>• Lia notificada para configurar arquivos (SOUL, persona, crons)</li>
                    <li>• Agente adicionado à lista de usuários</li>
                  </ul>
                </div>
              </div>

              <div className="border border-primary/30 rounded-xl p-4 bg-primary/5">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm flex items-center gap-2 text-foreground">
                      ✨ Onboarding completo pela Lia
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      A Lia vai criar SOUL.md, IDENTITY.md, TOOLS.md e configurar o agente com base no contexto que você forneceu.
                    </p>
                  </div>
                  <Switch checked={liaOnboarding} onCheckedChange={setLiaOnboarding} />
                </div>
              </div>

              {/* Leadership */}
              <div className="border border-border/40 rounded-xl p-4 bg-secondary/10 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-sm flex items-center gap-2 text-foreground">
                      🔗 Liderança
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Este agente será coordenado por um orquestrador?
                    </p>
                  </div>
                  <Switch
                    checked={hasLeader}
                    onCheckedChange={(v) => {
                      setHasLeader(v);
                      if (v && !selectedLeaderId) {
                        const def = leaderOptions.find((o) => o.is_leader) ?? leaderOptions[0];
                        if (def) setSelectedLeaderId(def.agent_id);
                      }
                    }}
                    disabled={leaderOptions.length === 0}
                  />
                </div>

                {hasLeader && leaderOptions.length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-border/30">
                    <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Orquestrador
                    </label>
                    <Select value={selectedLeaderId} onValueChange={setSelectedLeaderId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Selecione um orquestrador" />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          const onlyLeaders = leaderOptions.filter((o) => o.is_leader);
                          const list = onlyLeaders.length > 0 ? onlyLeaders : leaderOptions;
                          return list.map((agent) => (
                            <SelectItem key={agent.agent_id} value={agent.agent_id}>
                              <span className="inline-flex items-center gap-2">
                                <span>{agent.emoji}</span>
                                <span>{agent.name}</span>
                                {agent.is_leader && (
                                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                                    👑 Líder
                                  </span>
                                )}
                              </span>
                            </SelectItem>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      ℹ️ O orquestrador será informado sobre este agente e poderá coordená-lo.
                    </p>
                  </div>
                )}

                {leaderOptions.length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic">
                    Nenhum outro agente disponível para coordenar.
                  </p>
                )}
              </div>

              <p className="text-xs text-muted-foreground">
                ⏱ A Lia levará alguns minutos para configurar o workspace completo do agente. O
                status aparecerá como <span className="text-sky-400">🔵 Configurando</span> até a
                configuração ser concluída.
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border/30 flex items-center justify-between gap-2">
          {phase === "form" && (
            <>
              <button
                type="button"
                onClick={back}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-full text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              >
                {step === 1 ? (
                  "Cancelar"
                ) : (
                  <>
                    <ChevronLeft className="h-4 w-4" />
                    Voltar
                  </>
                )}
              </button>

              {step < TOTAL_STEPS ? (
                <button
                  type="button"
                  onClick={next}
                  className="inline-flex items-center gap-1 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
                >
                  Próximo
                  <ChevronRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Criando...
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      Criar Agente
                    </>
                  )}
                </button>
              )}
            </>
          )}

          {phase === "progress" && (
            <div className="w-full text-center text-xs text-muted-foreground">
              Aguarde, este processo pode levar alguns segundos…
            </div>
          )}

          {phase === "done" && (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-full text-muted-foreground hover:text-foreground transition-colors"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={openChat}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-violet-500 to-indigo-600 text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
              >
                Abrir Chat com {name}
              </button>
            </>
          )}

          {phase === "error" && (
            <>
              <button
                type="button"
                onClick={() => onOpenChange(false)}
                className="inline-flex items-center gap-1 px-4 py-2 text-sm rounded-full text-muted-foreground hover:text-foreground transition-colors"
              >
                Fechar
              </button>
              <button
                type="button"
                onClick={retry}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20"
              >
                Tentar novamente
              </button>
            </>
          )}
        </div>
      </DialogContent>
      <AvatarCropDialog
        open={avatarPickerOpen}
        onOpenChange={setAvatarPickerOpen}
        initialImage={avatarDataUrl}
        title="Foto do agente"
        onConfirm={(url) => setAvatarDataUrl(url)}
      />
    </Dialog>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-[11px] text-muted-foreground">{hint}</p>}
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </div>
  );
}

function SummaryLine({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground min-w-[100px]">{label}:</span>
      <span className={`text-foreground break-all ${mono ? "font-mono text-[11px]" : ""}`}>
        {value || "—"}
      </span>
    </div>
  );
}

type StepState = "pending" | "running" | "done" | "error";

function StepRow({ state, label }: { state: StepState; label: string }) {
  const icon =
    state === "done" ? (
      <Check className="h-4 w-4 text-emerald-500" />
    ) : state === "running" ? (
      <Loader2 className="h-4 w-4 animate-spin text-primary" />
    ) : state === "error" ? (
      <X className="h-4 w-4 text-destructive" />
    ) : (
      <Circle className="h-4 w-4 text-muted-foreground" />
    );
  const color =
    state === "done"
      ? "text-foreground"
      : state === "running"
      ? "text-foreground"
      : state === "error"
      ? "text-destructive"
      : "text-muted-foreground";
  return (
    <div className={`flex items-center gap-3 text-sm ${color}`}>
      <span className="shrink-0">{icon}</span>
      <span>{label}</span>
    </div>
  );
}

function ProgressView({
  phase,
  progress,
  name,
  emoji,
  errorMsg,
  errorStep,
}: {
  phase: "form" | "progress" | "done" | "error";
  progress: { openclaw: StepState; supabase: StepState; lia: StepState };
  name: string;
  emoji: string;
  errorMsg: string | null;
  errorStep: string | null;
}) {
  if (phase === "progress" || phase === "error") {
    return (
      <div className="space-y-4">
        <p className="text-sm font-display font-bold text-foreground">
          {phase === "progress" ? `Criando ${name}…` : `Falha ao criar ${name}`}
        </p>
        <div className="rounded-xl border border-border/40 bg-secondary/20 p-5 space-y-3">
          <StepRow state={progress.openclaw} label="Registrando no OpenClaw" />
          <StepRow state={progress.supabase} label="Salvando no dnos" />
          <StepRow state={progress.lia} label="Notificando Lia" />
        </div>
        {phase === "error" && errorMsg && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <strong className="capitalize">{errorStep ?? "Erro"}:</strong> {errorMsg}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border/40 bg-secondary/20 p-5 space-y-3">
        <StepRow state="done" label="Registrado no OpenClaw" />
        <StepRow state="done" label="Salvo no dnos" />
        <StepRow state="done" label="Lia notificada" />
      </div>
      <div className="rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 flex items-start gap-3">
        <span className="text-xl">{emoji}</span>
        <div className="text-sm text-foreground">
          <p>
            <span className="text-sky-400">🔵</span> <strong>{name}</strong> está sendo configurado.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            A Lia finalizará o setup em alguns minutos.
          </p>
        </div>
      </div>
    </div>
  );
}
