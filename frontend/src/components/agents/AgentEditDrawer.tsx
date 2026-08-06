import { useEffect, useState } from "react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useGatewayModels } from "@/hooks/use-gateway-models";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, X, Crown, Link2, Bot, Globe, Lock, Users as UsersIcon, Camera, RefreshCw, Sparkles, AlertTriangle, CheckCircle2, XCircle, Zap } from "lucide-react";
import { api } from "@/lib/api";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { useAgentAvatar } from "@/hooks/use-agent-avatar";
import { AvatarCropDialog } from "@/components/AvatarCropDialog";

export interface EditableAgent {
  agent_id: string;
  openclaw_id?: string | null;
  name: string;
  emoji: string;
}

interface Props {
  agent: EditableAgent | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  onDeleted?: () => void;
}

type AccessType = "all" | "admins_only" | "specific_users";

interface PlatformUser {
  id: string;
  full_name: string | null;
  email: string;
}

interface AgentOption {
  agent_id: string;
  name: string;
  emoji: string;
  avatar_url: string | null;
  is_leader: boolean;
  leader_id: string | null;
}

/** Sentinela de UI para "sem modelo próprio — herda o padrão do Gateway". */
const INHERIT_MODEL = "__inherit__";

// A lista de modelos vem do Gateway (useGatewayModels) — não hardcode aqui. O
// `value` selecionado é gravado no Gateway via update-agent-profile →
// agents.update, então uma lista local pode divergir da realidade: foi assim que
// o item rotulado "DeepSeek V4 Pro" passou a gravar deepseek/deepseek-chat
// (janela 131k em vez de 1M) e colocou vários agentes no modelo errado.

export function AgentEditDrawer({ agent, onOpenChange, onSaved, onDeleted }: Props) {
  const open = !!agent;
  const { models: gatewayModels, isFallback: modelsAreFallback } = useGatewayModels();
  const [loading, setLoading] = useState(false);
  // Verificação de modelo: `agents.update` aceita qualquer string como modelo
  // sem validar, então um id errado deixa o agente mudo em silêncio. O endpoint
  // cruza `models.list` (o modelo existe e está disponível?) com
  // `models.authStatus` (a credencial do provedor está válida?). Ele **não**
  // prova que a LLM respondeu — a rota que fazia isso não existe mais no
  // gateway. Ver `POST /agents/test-model` no backend.
  const [modelTest, setModelTest] = useState<{ status: string; mensagem: string } | null>(null);
  const [testingModel, setTestingModel] = useState(false);
  const [savingTab, setSavingTab] = useState<string | null>(null);

  // Geral
  const [form, setForm] = useState({
    name: "",
    emoji: "",
    specialty: "",
    // "" = herda o modelo padrão do Gateway. Não usar um modelo concreto como
    // padrão: agentes que herdam (lia, milo, rodrigo) não têm modelo próprio, e
    // um padrão concreto aqui gravaria esse modelo neles ao salvar a aba por
    // qualquer outro motivo (só mudar o nome, por exemplo).
    model: "",
    persona_description: "",
    skills_description: "",
    skills_tags: [] as string[],
    crons_description: "",
    is_leader: false,
    leader_id: "" as string,
    status: "active",
  });
  const [tagInput, setTagInput] = useState("");

  // Acesso
  const [accessType, setAccessType] = useState<AccessType>("all");
  const [allowedUsers, setAllowedUsers] = useState<string[]>([]);
  const [allUsers, setAllUsers] = useState<PlatformUser[]>([]);

  // Liderança
  const [hasLeader, setHasLeader] = useState(false);
  const [previousLeaderId, setPreviousLeaderId] = useState<string | null>(null);
  const [allAgents, setAllAgents] = useState<AgentOption[]>([]);

  // Delete
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteName, setDeleteName] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Avatar
  const { avatar, setAvatar } = useAgentAvatar(agent?.agent_id ?? "");
  const [cropOpen, setCropOpen] = useState(false);
  const [cropInitial, setCropInitial] = useState<string | null>(null);

  useEffect(() => {
    if (!agent) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      // Três chamadas à nossa API no lugar de quatro consultas diretas ao
      // Supabase. `allSettled` porque uma lista de apoio que falha não deve
      // impedir a edição do agente em si.
      const [perfilRes, usuariosRes, agentesRes] = await Promise.allSettled([
        api<any>(`/agents/${encodeURIComponent(agent.agent_id)}`),
        api<PlatformUser[]>("/profiles"),
        api<{ agents: Array<{ id: string; name: string; emoji?: string | null; isLeader?: boolean; avatarUrl?: string | null }> }>("/agents"),
      ]);
      if (cancelled) return;
      const p: any = perfilRes.status === "fulfilled" ? perfilRes.value : {};
      setForm({
        name: p.name ?? agent.name ?? "",
        emoji: p.emoji ?? agent.emoji ?? "🤖",
        specialty: p.specialty ?? "",
        model: p.model ?? "",
        persona_description: p.persona_description ?? "",
        skills_description: p.skills_description ?? "",
        skills_tags: Array.isArray(p.skills_tags) ? p.skills_tags : [],
        crons_description: p.crons_description ?? "",
        is_leader: !!p.is_leader,
        leader_id: p.leader_id ?? "",
        status: p.status ?? "active",
      });
      setAccessType((p.access_type as AccessType) ?? "all");
      setAllowedUsers(Array.isArray(p.allowed_user_ids) ? p.allowed_user_ids : []);
      setHasLeader(!!p.leader_id);
      setPreviousLeaderId(p.leader_id ?? null);
      setAllUsers(usuariosRes.status === "fulfilled" ? usuariosRes.value : []);
      const listaAgentes =
        agentesRes.status === "fulfilled" ? agentesRes.value.agents ?? [] : [];
      setAllAgents(
        listaAgentes.map((a: any) => ({
          agent_id: a.id,
          name: a.name ?? a.id,
          emoji: a.emoji ?? "🤖",
          // O avatar vem junto na lista agora — antes era uma quarta consulta
          // só para montar um mapa de agent_id → url.
          avatar_url: a.avatarUrl ?? null,
          is_leader: !!a.isLeader,
          leader_id: a.leaderId ?? null,
        })),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [agent]);

  if (!agent) return null;

  const leaderCandidates = (() => {
    const others = allAgents.filter((a) => a.agent_id !== agent.agent_id);
    const leaders = others.filter((a) => a.is_leader);
    return leaders.length > 0 ? leaders : others;
  })();

  const callEdge = async (fn: string, body: any) => {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error || data?.success === false) {
      throw new Error(data?.error || error?.message || "Erro desconhecido");
    }
    return data;
  };

  /** Grava o perfil pela nossa API. Substitui a edge `update-agent-profile`.
   *
   *  Nome e modelo também vivem no Gateway: o endpoint escreve **lá primeiro** e
   *  aborta sem tocar no banco se ele recusar. Um 502 aqui significa que nada
   *  mudou em lugar nenhum — é seguro mostrar o erro e deixar o usuário tentar
   *  de novo. */
  const salvarPerfil = (campos: Record<string, unknown>) =>
    api(`/agents/${encodeURIComponent(agent.agent_id)}`, { method: "PATCH", body: campos });

  const handleTestModel = async () => {
    if (!form.model) return;
    setTestingModel(true);
    setModelTest(null);
    try {
      const data = await api<{ status: string; mensagem: string }>("/agents/test-model", {
        method: "POST",
        body: { model: form.model },
      });
      setModelTest({ status: data.status, mensagem: data.mensagem });
    } catch (e) {
      setModelTest({ status: "erro", mensagem: (e as Error).message });
    } finally {
      setTestingModel(false);
    }
  };

  const handleSaveGeral = async () => {
    setSavingTab("geral");
    try {
      await salvarPerfil({
        name: form.name,
        emoji: form.emoji,
        specialty: form.specialty,
        // Só manda `model` quando há escolha explícita. Mandar sempre gravaria
        // um modelo concreto em agente que hoje herda o padrão do Gateway.
        ...(form.model ? { model: form.model } : {}),
      });
      toast({ title: "Agente atualizado", description: "Alterações salvas com sucesso." });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro ao salvar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTab(null);
    }
  };

  const handleSaveAcesso = async () => {
    setSavingTab("acesso");
    try {
      await callEdge("update-agent-access", {
        agent_id: agent.openclaw_id ?? agent.agent_id,
        agent_name: form.name,
        access_type: accessType,
        allowed_user_ids: accessType === "specific_users" ? allowedUsers : [],
      });
      toast({ title: "Acesso atualizado" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro ao salvar acesso", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTab(null);
    }
  };

  const handleSaveLideranca = async () => {
    setSavingTab("lideranca");
    try {
      // Persist is_leader change
      await salvarPerfil({ is_leader: form.is_leader });
      // Update leader_id (and notify orchestrators)
      const newLeader = hasLeader && form.leader_id ? form.leader_id : null;
      await callEdge("update-agent-leadership", {
        agent_id: agent.agent_id,
        leader_id: newLeader,
        agent_name: form.name,
        agent_emoji: form.emoji,
        previous_leader_id: previousLeaderId,
      });
      setPreviousLeaderId(newLeader);
      toast({ title: "Liderança atualizada" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro ao salvar liderança", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTab(null);
    }
  };

  const handleSavePersona = async () => {
    setSavingTab("persona");
    try {
      await salvarPerfil({
        persona_description: form.persona_description,
        skills_description: form.skills_description,
        skills_tags: form.skills_tags,
      });
      toast({ title: "Persona atualizada" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro ao salvar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTab(null);
    }
  };

  const handleSyncWithOrchestrator = async () => {
    const leader = allAgents.find((a) => a.is_leader);
    if (!leader) {
      toast({ title: "Nenhum orquestrador ativo", variant: "destructive" });
      return;
    }
    try {
      await callEdge("update-agent-leadership", {
        agent_id: agent.agent_id,
        leader_id: leader.agent_id,
        agent_name: form.name,
        agent_emoji: form.emoji,
        previous_leader_id: previousLeaderId,
      });
      toast({
        title: "Sincronização iniciada",
        description: `${leader.name} foi notificado para atualizar o IDENTITY.md.`,
      });
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleSaveAutomacoes = async () => {
    setSavingTab("automacoes");
    try {
      await salvarPerfil({ crons_description: form.crons_description });
      toast({ title: "Automações atualizadas" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro ao salvar", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTab(null);
    }
  };

  const handleReconfigure = async () => {
    const leader = allAgents.find((a) => a.is_leader);
    if (!leader) {
      toast({ title: "Nenhum orquestrador ativo", variant: "destructive" });
      return;
    }
    toast({
      title: "Re-configuração solicitada",
      description: `${leader.name} vai reescrever os arquivos do agente.`,
    });
    // Reuse leadership notify channel as a generic trigger
    try {
      await callEdge("update-agent-leadership", {
        agent_id: agent.agent_id,
        leader_id: leader.agent_id,
        agent_name: form.name,
        agent_emoji: form.emoji,
        previous_leader_id: previousLeaderId,
      });
    } catch {/* best-effort */}
  };

  const handleDeactivate = async () => {
    setSavingTab("deactivate");
    try {
      const next = form.status === "inactive" ? "active" : "inactive";
      await salvarPerfil({ status: next });
      setForm((f) => ({ ...f, status: next }));
      toast({ title: next === "inactive" ? "Agente desativado" : "Agente reativado" });
      onSaved?.();
    } catch (e) {
      toast({ title: "Erro", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSavingTab(null);
    }
  };

  const handleDelete = async () => {
    if (deleteName.trim() !== form.name.trim()) {
      toast({ title: "Nome não confere", variant: "destructive" });
      return;
    }
    setDeleting(true);
    try {
      await callEdge("delete-agent", {
        agent_id: agent.openclaw_id ?? agent.agent_id,
        profile_agent_id: agent.agent_id,
        name: form.name,
      });
      toast({ title: "Agente excluído" });
      setShowDeleteConfirm(false);
      onDeleted?.();
      onOpenChange(false);
    } catch (e) {
      toast({ title: "Erro ao excluir", description: (e as Error).message, variant: "destructive" });
    } finally {
      setDeleting(false);
    }
  };

  const addTag = (raw: string) => {
    const t = raw.trim();
    if (!t) return;
    if (form.skills_tags.includes(t)) return;
    setForm({ ...form, skills_tags: [...form.skills_tags, t] });
    setTagInput("");
  };
  const removeTag = (t: string) =>
    setForm({ ...form, skills_tags: form.skills_tags.filter((x) => x !== t) });

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onOpenChange(false)}>
      <SheetContent
        side="right"
        className="w-[560px] sm:max-w-[560px] overflow-y-auto glass-card border-l border-border/30 bg-card/95 backdrop-blur-xl p-0"
      >
        <div className="aurora-glow px-6 py-5 border-b border-border/30">
          <SheetHeader className="relative z-10 text-left space-y-2">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => { setCropInitial(avatar ?? null); setCropOpen(true); }}
                className="relative h-14 w-14 rounded-2xl overflow-hidden border-2 border-border bg-secondary/40 flex items-center justify-center group shrink-0"
                title="Alterar foto"
              >
                {avatar ? (
                  <img src={avatar} alt={form.name || agent.name} className="h-full w-full object-cover" />
                ) : (
                  <Bot className="h-6 w-6 text-muted-foreground" />
                )}
                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                  <Camera className="h-4 w-4 text-white" />
                </span>
              </button>
              <div className="min-w-0">
                <SheetTitle className="font-display font-bold text-foreground truncate">
                  Editar {form.name || agent.name}
                </SheetTitle>
                <SheetDescription className="font-mono text-[11px] text-muted-foreground">
                  openclaw:{agent.openclaw_id ?? agent.agent_id}
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>
        </div>
        <div className="px-6 py-5">

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        ) : (
          <Tabs defaultValue="geral" className="mt-2">
            <TabsList className="grid grid-cols-3 w-full mb-2 bg-secondary/40 border border-border/40 rounded-full p-1 h-auto">
              <TabsTrigger value="geral" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow text-xs">Geral</TabsTrigger>
              <TabsTrigger value="acesso" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow text-xs">Acesso</TabsTrigger>
              <TabsTrigger value="lideranca" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow text-xs">Liderança</TabsTrigger>
            </TabsList>
            <TabsList className="grid grid-cols-3 w-full bg-secondary/40 border border-border/40 rounded-full p-1 h-auto">
              <TabsTrigger value="persona" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow text-xs">Persona</TabsTrigger>
              <TabsTrigger value="automacoes" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow text-xs">Automações</TabsTrigger>
              <TabsTrigger value="avancado" className="rounded-full data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow text-xs">Avançado</TabsTrigger>
            </TabsList>

            {/* GERAL */}
            <TabsContent value="geral" className="space-y-4 mt-4">
              <div className="flex items-start gap-3">
                <div className="space-y-1.5">
                  <Label>Foto</Label>
                  <button
                    type="button"
                    onClick={() => { setCropInitial(avatar ?? null); setCropOpen(true); }}
                    className="relative h-16 w-16 rounded-2xl overflow-hidden border-2 border-border bg-secondary/40 flex items-center justify-center group"
                    title="Alterar foto"
                  >
                    {avatar ? (
                      <img src={avatar} alt={form.name} className="h-full w-full object-cover" />
                    ) : (
                      <Bot className="h-7 w-7 text-muted-foreground" />
                    )}
                    <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Camera className="h-5 w-5 text-white" />
                    </span>
                  </button>
                  <p className="text-[10px] text-muted-foreground">Usada em toda a HS.OS</p>
                </div>
                <div className="flex-1">
                  <Label>Nome</Label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </div>
              </div>
              <div>
                <Label>Especialidade</Label>
                <Input
                  value={form.specialty}
                  onChange={(e) => setForm({ ...form, specialty: e.target.value })}
                  placeholder="Ex: Marketing, Financeiro, Vendas..."
                />
              </div>
              <div>
                <Label>Modelo</Label>
                {/* Radix não aceita SelectItem com value "", então o estado
                    "herda do Gateway" usa um sentinela e é traduzido de volta
                    para "" ao salvar. */}
                <Select
                  value={form.model || INHERIT_MODEL}
                  onValueChange={(v) => {
                    setForm({ ...form, model: v === INHERIT_MODEL ? "" : v });
                    setModelTest(null); // resultado antigo não vale pro modelo novo
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={INHERIT_MODEL}>Padrão do Gateway</SelectItem>
                    {gatewayModels.map((m) => (
                      <SelectItem key={m.qualifiedId} value={m.qualifiedId}>
                        {m.label}
                      </SelectItem>
                    ))}
                    {/* O modelo salvo pode não estar na lista do Gateway (modelo
                        removido da config, ou Gateway fora do ar). Sem esta
                        opção o Select apareceria vazio e um save acidental
                        trocaria o modelo do agente sem querer. */}
                    {form.model && !gatewayModels.some((m) => m.qualifiedId === form.model) && (
                      <SelectItem value={form.model}>
                        {form.model} (não confirmado no Gateway)
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
                {modelsAreFallback && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Não foi possível confirmar os modelos com o Gateway — lista de referência.
                  </p>
                )}

                <div className="flex items-center gap-2 mt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestModel}
                    disabled={!form.model || testingModel}
                    title={
                      form.model
                        ? "Confere se o modelo está registrado no Gateway, disponível e com credencial válida"
                        : "Escolha um modelo específico para verificar"
                    }
                  >
                    {testingModel ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : (
                      <Zap className="h-3.5 w-3.5 mr-1.5" />
                    )}
                    {testingModel ? "Testando..." : "Testar modelo"}
                  </Button>
                  {modelTest && (
                    <span
                      className={`flex items-center gap-1.5 text-xs ${
                        modelTest.status === "ok" ? "text-emerald-500" : "text-destructive"
                      }`}
                    >
                      {modelTest.status === "ok" ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {modelTest.mensagem}
                    </span>
                  )}
                </div>
              </div>
              <Button onClick={handleSaveGeral} disabled={savingTab === "geral"} className="w-full">
                {savingTab === "geral" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar alterações"}
              </Button>
            </TabsContent>

            {/* ACESSO */}
            <TabsContent value="acesso" className="space-y-4 mt-4">
              <div className="space-y-3">
                {(["all", "admins_only", "specific_users"] as const).map((type) => (
                  <button
                    key={type}
                    onClick={() => setAccessType(type)}
                    className={`w-full text-left p-3 rounded-lg border transition-colors ${
                      accessType === type ? "border-primary bg-primary/10" : "border-border hover:bg-secondary/30"
                    }`}
                  >
                    <div className="font-medium text-sm flex items-center gap-2">
                      {type === "all" && (<><Globe className="h-4 w-4 text-muted-foreground" /> Todos os usuários</>)}
                      {type === "admins_only" && (<><Lock className="h-4 w-4 text-muted-foreground" /> Somente admins</>)}
                      {type === "specific_users" && (<><UsersIcon className="h-4 w-4 text-muted-foreground" /> Usuários específicos</>)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {type === "all" && "Qualquer membro da equipe pode conversar com este agente"}
                      {type === "admins_only" && "Apenas administradores têm acesso"}
                      {type === "specific_users" && "Selecione quais pessoas podem acessar"}
                    </div>
                  </button>
                ))}
              </div>
              {accessType === "specific_users" && (
                <div className="space-y-2">
                  <Label>Usuários autorizados</Label>
                  <div className="max-h-64 overflow-y-auto rounded-lg border border-border/40 p-1.5 bg-secondary/10 space-y-1">
                    {allUsers.map((u) => (
                      <label
                        key={u.id}
                        className="flex items-center gap-2 p-2 rounded hover:bg-secondary/40 cursor-pointer"
                      >
                        <Checkbox
                          checked={allowedUsers.includes(u.id)}
                          onCheckedChange={(checked) => {
                            setAllowedUsers((prev) =>
                              checked ? [...prev, u.id] : prev.filter((id) => id !== u.id),
                            );
                          }}
                        />
                        <span className="text-sm">{u.full_name || u.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <Button onClick={handleSaveAcesso} disabled={savingTab === "acesso"} className="w-full">
                {savingTab === "acesso" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar acesso"}
              </Button>
            </TabsContent>

            {/* LIDERANÇA */}
            <TabsContent value="lideranca" className="space-y-4 mt-4">
              <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                <div className="pr-3 flex items-start gap-2">
                  <Crown className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                  <div>
                    <p className="text-sm font-medium">Este agente é um orquestrador?</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Orquestradores coordenam e lideram outros agentes
                    </p>
                  </div>
                </div>
                <Switch
                  checked={form.is_leader}
                  onCheckedChange={(v) => setForm({ ...form, is_leader: v })}
                />
              </div>

              <div className="flex items-center justify-between p-3 border border-border rounded-lg">
                <div className="pr-3 flex items-center gap-2">
                  <Link2 className="h-4 w-4 text-muted-foreground shrink-0" />
                  <p className="text-sm font-medium">Liderado por um orquestrador?</p>
                </div>
                <Switch checked={hasLeader} onCheckedChange={setHasLeader} />
              </div>

              {hasLeader && (
                <Select
                  value={form.leader_id || undefined}
                  onValueChange={(v) => setForm({ ...form, leader_id: v })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecionar orquestrador..." />
                  </SelectTrigger>
                  <SelectContent>
                    {leaderCandidates.map((a) => (
                      <SelectItem key={a.agent_id} value={a.agent_id}>
                        <span className="inline-flex items-center gap-2">
                          {a.avatar_url ? (
                            <img src={a.avatar_url} alt={a.name} className="h-5 w-5 rounded-full object-cover border border-border" />
                          ) : (
                            <span className="h-5 w-5 rounded-full bg-secondary/60 border border-border flex items-center justify-center">
                              <Bot className="h-3 w-3 text-muted-foreground" />
                            </span>
                          )}
                          <span>{a.name}</span>
                          {a.is_leader && <Crown className="h-3 w-3 text-primary" />}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}

              <Button onClick={handleSaveLideranca} disabled={savingTab === "lideranca"} className="w-full">
                {savingTab === "lideranca" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar liderança"}
              </Button>

              {/* ⚠️ Este botão é inócuo, e já era assim na edge function: ele lê
                  is_leader/leader_id do banco e devolve os mesmos valores, então o
                  round-trip nunca muda nada. O texto promete ler o SOUL.md, que
                  nunca chegou a acontecer aqui — quem faz isso é o agente
                  orquestrador na VPS, que chama o endpoint com um payload de
                  verdade. Portado como estava, de propósito; corrigir o produto
                  está registrado em docs/ROADMAP.md. */}
              <div className="pt-2 border-t border-border/40">
                <p className="text-xs text-muted-foreground mb-2">
                  Regrava <code className="font-mono">is_leader</code> e{" "}
                  <code className="font-mono">leader_id</code> de todos os agentes a partir do
                  estado atual do banco. A leitura do <code className="font-mono">SOUL.md</code>{" "}
                  de cada agente, que é a fonte canônica, é feita pelo orquestrador na VPS.
                </p>
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={savingTab === "sync-leadership"}
                  onClick={async () => {
                    setSavingTab("sync-leadership");
                    try {
                      const payload = {
                        // Cada agente devolve o **próprio** estado. Mandar null
                        // para os outros apagaria a liderança deles.
                        agents: allAgents.map((a) => ({
                          agent_id: a.agent_id,
                          is_leader: a.is_leader,
                          leader_id: a.leader_id,
                        })),
                      };
                      const d = await api<{
                        total: number;
                        atualizados: number;
                        agents: Array<{ agent_id: string; is_leader: boolean }>;
                      }>("/agents/leadership/sync", { method: "POST", body: payload });
                      const leaders = d.agents.filter((r) => r.is_leader).map((r) => r.agent_id).join(", ") || "nenhum";
                      toast({
                        title: "Liderança sincronizada",
                        description: `${d.atualizados}/${d.total} agentes atualizados. Líderes: ${leaders}.`,
                      });
                      onSaved?.();
                    } catch (e) {
                      toast({ title: "Erro ao sincronizar", description: (e as Error).message, variant: "destructive" });
                    } finally {
                      setSavingTab(null);
                    }
                  }}
                >
                  {savingTab === "sync-leadership" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Sincronizar liderança dos agentes"
                  )}
                </Button>
              </div>
            </TabsContent>

            {/* PERSONA */}
            <TabsContent value="persona" className="space-y-4 mt-4">
              <div>
                <Label>Descrição da persona</Label>
                <Textarea
                  value={form.persona_description}
                  onChange={(e) => setForm({ ...form, persona_description: e.target.value })}
                  placeholder="Como este agente se comporta, seu tom, seus valores..."
                  rows={4}
                />
              </div>
              <div>
                <Label>Habilidades</Label>
                <Textarea
                  value={form.skills_description}
                  onChange={(e) => setForm({ ...form, skills_description: e.target.value })}
                  placeholder="O que este agente sabe fazer..."
                  rows={3}
                />
              </div>
              <div>
                <Label>Tags de habilidades</Label>
                <div className="flex flex-wrap gap-2 p-2 border rounded-lg min-h-[42px]">
                  {form.skills_tags.map((tag) => (
                    <span
                      key={tag}
                      className="bg-primary/15 text-primary text-xs px-2 py-1 rounded-full flex items-center gap-1"
                    >
                      {tag}
                      <button onClick={() => removeTag(tag)} className="hover:text-destructive">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="Adicionar tag..."
                    className="bg-transparent text-sm outline-none flex-1 min-w-[100px]"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addTag(e.currentTarget.value);
                      }
                    }}
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleSavePersona} disabled={savingTab === "persona"} className="flex-1">
                  {savingTab === "persona" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar persona"}
                </Button>
                <Button variant="outline" onClick={handleSyncWithOrchestrator}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Sincronizar
                </Button>
              </div>
            </TabsContent>

            {/* AUTOMAÇÕES */}
            <TabsContent value="automacoes" className="space-y-4 mt-4">
              <p className="text-sm text-muted-foreground">
                Automações configuradas neste agente (crons e tarefas recorrentes).
              </p>
              <Textarea
                value={form.crons_description}
                onChange={(e) => setForm({ ...form, crons_description: e.target.value })}
                placeholder="Descreva as automações deste agente..."
                rows={5}
              />
              <div className="flex gap-2">
                <Button onClick={handleSaveAutomacoes} disabled={savingTab === "automacoes"} className="flex-1">
                  {savingTab === "automacoes" ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
                </Button>
                <Button variant="outline" onClick={handleSyncWithOrchestrator}>
                  <RefreshCw className="h-4 w-4 mr-2" /> Sincronizar
                </Button>
              </div>
            </TabsContent>

            {/* AVANÇADO */}
            <TabsContent value="avancado" className="space-y-4 mt-4">
              <div className="p-4 border border-border rounded-lg space-y-2">
                <p className="text-sm font-medium flex items-center gap-2"><Sparkles className="h-4 w-4" /> Re-configurar com orquestrador</p>
                <p className="text-xs text-muted-foreground">
                  O orquestrador vai reescrever o SOUL.md, IDENTITY.md e TOOLS.md deste agente com base nas
                  configurações atuais.
                </p>
                <Button variant="outline" className="w-full" onClick={handleReconfigure}>
                  Iniciar re-configuração
                </Button>
              </div>

              <div className="p-4 border border-border rounded-lg space-y-2">
                <p className="text-sm font-medium text-yellow-500 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" /> {form.status === "inactive" ? "Reativar agente" : "Desativar agente"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {form.status === "inactive"
                    ? "O agente voltará a ficar visível para os usuários."
                    : "O agente ficará invisível para os usuários mas seus dados serão preservados."}
                </p>
                <Button
                  variant="outline"
                  className="w-full border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10"
                  onClick={handleDeactivate}
                  disabled={savingTab === "deactivate"}
                >
                  {savingTab === "deactivate" ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : form.status === "inactive" ? (
                    "Reativar"
                  ) : (
                    "Desativar"
                  )}
                </Button>
              </div>

              <div className="p-4 border border-destructive/50 rounded-lg space-y-2">
                <p className="text-sm font-medium text-destructive">🗑 Excluir agente</p>
                <p className="text-xs text-muted-foreground">
                  Remove permanentemente o agente do OpenClaw e do banco de dados. Esta ação não pode ser
                  desfeita.
                </p>
                <Button variant="destructive" className="w-full" onClick={() => setShowDeleteConfirm(true)}>
                  Excluir agente
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        )}

        <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Excluir {form.name}?</AlertDialogTitle>
              <AlertDialogDescription>
                Esta ação é permanente. Digite <strong>{form.name}</strong> abaixo para confirmar.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <Input
              value={deleteName}
              onChange={(e) => setDeleteName(e.target.value)}
              placeholder={form.name}
              autoFocus
            />
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => {
                  e.preventDefault();
                  handleDelete();
                }}
                disabled={deleting || deleteName.trim() !== form.name.trim()}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Excluir permanentemente"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        </div>

        <AvatarCropDialog
          open={cropOpen}
          onOpenChange={setCropOpen}
          initialImage={cropInitial}
          title="Foto do agente"
          onConfirm={async (dataUrl) => {
            try {
              await setAvatar(dataUrl);
              toast({ title: "Foto atualizada" });
              setCropOpen(false);
              onSaved?.();
            } catch (e) {
              toast({ title: "Erro ao salvar foto", description: (e as Error).message, variant: "destructive" });
            }
          }}
        />
      </SheetContent>
    </Sheet>
  );
}
