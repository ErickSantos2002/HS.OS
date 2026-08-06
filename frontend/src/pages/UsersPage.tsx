import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { api } from "@/lib/api";
import { useAuthContext } from "@/contexts/auth-context";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  UserPlus,
  Mail,
  Shield,
  ShieldCheck,
  User as UserIcon,
  Ban,
  CheckCircle2,
  Clock,
  Trash2,
  Bot,
  Plus,
  MessageSquare,
  RefreshCw,
  
  Upload,
  MoreVertical,
  Download,
  Settings as SettingsIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AgentEditDrawer, type EditableAgent } from "@/components/agents/AgentEditDrawer";
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
import { toast } from "@/hooks/use-toast";
import type { AppRole } from "@/hooks/use-auth";
import { AddAgentDialog, type PendingAgent } from "@/components/users/AddAgentDialog";
import ImportAgentDialog from "@/components/agents/ImportAgentDialog";

import { AgentAccessDialog } from "@/components/users/AgentAccessDialog";
import { AvatarCropDialog } from "@/components/AvatarCropDialog";
import { uploadUserAvatar, uploadAgentAvatar } from "@/lib/avatar-upload";

/** O que `GET /profiles` devolve — só o que esta tela usa. */
interface PerfilApi {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  status: string;
  role: string;
}

/** O que `GET /agents` devolve — só o que esta tela usa. */
interface AgenteApi {
  id: string;
  name: string | null;
  emoji: string | null;
  specialty: string | null;
  description: string | null;
  openclawId: string | null;
  /** Status gravado em agent_profiles, não a liveness do gateway. */
  profileStatus: string;
  lastActive: string | null;
  isLeader: boolean;
  leaderId: string | null;
}
import { useAllAvatars } from "@/hooks/use-agent-avatar";
import { Camera, Lock } from "lucide-react";

interface HumanRow {
  kind: "human";
  id: string;
  email: string;
  full_name: string;
  avatar_url: string | null;
  status: string;
  role: AppRole;
}

interface AgentRow {
  kind: "agent";
  id: string; // agent_id
  openclaw_id: string | null;
  name: string;
  emoji: string;
  specialty: string | null;
  status: string; // active/inactive
  presence: "online" | "recent" | "offline" | "configuring";
  is_leader: boolean;
  leader_id: string | null;
}

type Row = HumanRow | AgentRow;
type FilterKind = "all" | "human" | "agent";

const roleLabels: Record<AppRole, string> = {
  super_admin: "Super Admin",
  member: "Membro",
  user: "Usuário",
};

const roleIcons: Record<AppRole, React.ReactNode> = {
  super_admin: <ShieldCheck className="h-3.5 w-3.5" />,
  member: <Shield className="h-3.5 w-3.5" />,
  user: <UserIcon className="h-3.5 w-3.5" />,
};

const statusConfig: Record<string, { label: string; icon: React.ReactNode; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "Ativo", icon: <CheckCircle2 className="h-3 w-3" />, variant: "default" },
  pending: { label: "Pendente", icon: <Clock className="h-3 w-3" />, variant: "secondary" },
  inactive: { label: "Inativo", icon: <Ban className="h-3 w-3" />, variant: "destructive" },
};

function presenceDot(p: AgentRow["presence"]) {
  if (p === "online") return { dot: "bg-emerald-500", label: "Online" };
  if (p === "recent") return { dot: "bg-amber-500", label: "Recente" };
  if (p === "configuring") return { dot: "bg-sky-500 animate-pulse", label: "Configurando" };
  return { dot: "bg-muted-foreground", label: "Offline" };
}

export default function UsersPage({ embedded }: { embedded?: boolean } = {}) {
  const { user: currentUser, role } = useAuthContext();
  const isAdmin = role === "super_admin";
  const navigate = useNavigate();
  const [humans, setHumans] = useState<HumanRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKind>("all");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("member");
  const [inviting, setInviting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [addAgentOpen, setAddAgentOpen] = useState(false);
  const [importAgentOpen, setImportAgentOpen] = useState(false);
  const [pendingAgents, setPendingAgents] = useState<AgentRow[]>([]);
  const [avatarTarget, setAvatarTarget] = useState<Row | null>(null);
  const [accessTarget, setAccessTarget] = useState<AgentRow | null>(null);
  const [editingAgent, setEditingAgent] = useState<EditableAgent | null>(null);
  const agentAvatars = useAllAvatars();
  const [exportingId, setExportingId] = useState<string | null>(null);

  const handleExportAgent = async (agent: AgentRow) => {
    const id = agent.openclaw_id ?? agent.id;
    setExportingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("export-agent", {
        body: { agent_id: id },
      });
      if (error) {
        let msg = error.message || "Falha ao exportar";
        try {
          const ctx = (error as any).context;
          if (ctx && typeof ctx.json === "function") {
            const parsed = await ctx.json();
            if (parsed?.error) msg = parsed.error;
          }
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      if (!data || typeof data !== "object" || !(data as any).dnos_version || !(data as any).agent?.agent_id) {
        throw new Error((data as any)?.error || "Resposta inválida do servidor");
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.dnos`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Exportado", description: `${agent.name} exportado como ${id}.dnos` });
    } catch (err) {
      toast({ title: "Erro ao exportar", description: (err as Error).message, variant: "destructive" });
    } finally {
      setExportingId(null);
    }
  };

  const fetchAll = useCallback(async () => {
    setLoading(true);

    // Duas chamadas à nossa API no lugar de quatro consultas ao Supabase.
    // `user_roles` sumiu do cliente: o papel já vem em /profiles, resolvido pela
    // mesma regra de prioridade que estava aqui (super_admin > member > user).
    // `agent_stats` também: a última atividade vem em `lastActive`.
    //
    // `incluir_inativos` é obrigatório aqui — esta é a tela onde se reativa um
    // agente desativado, e sem isso ele sumiria da lista e não teria como voltar.
    const [perfisRes, agentesRes] = await Promise.allSettled([
      api<PerfilApi[]>("/profiles"),
      api<{ agents: AgenteApi[] }>("/agents?incluir_inativos=true"),
    ]);

    if (perfisRes.status === "rejected") {
      toast({
        title: "Erro ao carregar usuários",
        description: (perfisRes.reason as Error).message,
        variant: "destructive",
      });
    }
    if (agentesRes.status === "rejected") {
      toast({
        title: "Erro ao carregar agentes",
        description: (agentesRes.reason as Error).message,
        variant: "destructive",
      });
    }

    const perfis = perfisRes.status === "fulfilled" ? perfisRes.value : [];
    const agentesApi = agentesRes.status === "fulfilled" ? agentesRes.value.agents ?? [] : [];

    setHumans(
      perfis.map((p) => ({
        kind: "human" as const,
        id: p.id,
        email: p.email,
        full_name: p.full_name ?? "",
        avatar_url: p.avatar_url ?? null,
        status: p.status,
        role: (p.role ?? "user") as AppRole,
      })),
    );

    // O filtro por `access_type` que estava aqui saiu: o endpoint já aplica o
    // mesmo controle no servidor, onde ele de fato protege. Repetir no cliente
    // não acrescentava nada — os dados já teriam chegado ao navegador.
    const now = Date.now();
    setAgents(
      agentesApi.map((a) => {
        const elapsed = a.lastActive ? now - new Date(a.lastActive).getTime() : Infinity;
        const presence: AgentRow["presence"] =
          a.profileStatus === "configuring"
            ? "configuring"
            : elapsed < 5 * 60_000
            ? "online"
            : elapsed < 30 * 60_000
            ? "recent"
            : "offline";
        return {
          kind: "agent" as const,
          id: a.id,
          openclaw_id: a.openclawId ?? a.id,
          name: a.name ?? a.id,
          emoji: a.emoji ?? "🤖",
          specialty: a.specialty ?? a.description ?? null,
          // O status do banco, não a liveness do gateway: é o que decide se a
          // linha aparece como desativada e se o botão oferece reativar.
          status: a.profileStatus ?? "active",
          presence,
          is_leader: !!a.isLeader,
          leader_id: a.leaderId ?? null,
        };
      }),
    );

    setLoading(false);
  }, []);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const rows: Row[] = useMemo(() => {
    const allAgents = [...pendingAgents, ...agents];
    if (filter === "human") return humans;
    if (filter === "agent") return allAgents;
    return [...humans, ...allAgents];
  }, [filter, humans, agents, pendingAgents]);

  const leaderMap = useMemo(() => {
    const map: Record<string, { name: string; emoji: string }> = {};
    for (const a of agents) {
      map[a.id] = { name: a.name, emoji: a.emoji };
      if (a.openclaw_id) map[a.openclaw_id] = { name: a.name, emoji: a.emoji };
    }
    return map;
  }, [agents]);

  const handleAgentCreated = useCallback((a: PendingAgent) => {
    setPendingAgents((prev) => [
      {
        kind: "agent" as const,
        id: a.agent_id,
        openclaw_id: a.openclaw_id,
        name: a.name,
        emoji: a.emoji,
        specialty: a.specialty || null,
        status: "active",
        presence: "configuring" as const,
        is_leader: false,
        leader_id: null,
      },
      ...prev.filter((p) => p.id !== a.agent_id),
    ]);
  }, []);

  const handleInvite = async () => {
    if (!inviteEmail) return;
    setInviting(true);
    const { data, error } = await supabase.functions.invoke("invite-user", {
      body: { email: inviteEmail, role: inviteRole, full_name: inviteName.trim() },
    });
    if (error || data?.error) {
      toast({
        title: "Erro ao convidar",
        description: data?.error || error?.message || "Erro desconhecido",
        variant: "destructive",
      });
    } else {
      toast({ title: "Convite enviado", description: `Email enviado para ${inviteEmail}` });
      setInviteEmail("");
      setInviteName("");
      setInviteOpen(false);
      fetchAll();
    }
    setInviting(false);
  };

  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    await supabase.from("user_roles").delete().eq("user_id", userId);
    await supabase.from("user_roles").insert({ user_id: userId, role: newRole });
    if (currentUser) {
      await supabase.from("access_logs").insert({
        user_id: currentUser.id,
        action: "change_role",
        metadata: { target_user: userId, new_role: newRole },
      });
    }
    toast({ title: "Role atualizado" });
    fetchAll();
  };

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    await supabase
      .from("profiles")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (currentUser) {
      await supabase.from("access_logs").insert({
        user_id: currentUser.id,
        action: newStatus === "inactive" ? "deactivate_user" : "activate_user",
        metadata: { target_user: userId },
      });
    }
    toast({ title: newStatus === "inactive" ? "Usuário desativado" : "Usuário reativado" });
    fetchAll();
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    if (deleteTarget.kind === "human") {
      const { data, error } = await supabase.functions.invoke("delete-user", {
        body: { user_id: deleteTarget.id },
      });
      if (error || data?.error) {
        toast({
          title: "Erro ao excluir",
          description: data?.error || error?.message || "Erro desconhecido",
          variant: "destructive",
        });
      } else {
        toast({ title: "Usuário excluído" });
        setDeleteTarget(null);
        fetchAll();
      }
    } else {
      // Hard-delete agent: remove from OpenClaw + Supabase
      const agent = deleteTarget as AgentRow;
      const { data, error } = await supabase.functions.invoke("delete-agent", {
        body: {
          agent_id: agent.openclaw_id ?? agent.id,
          profile_agent_id: agent.id,
          name: agent.name,
        },
      });
      if (error || data?.error) {
        toast({
          title: "Erro ao excluir agente",
          description: data?.error || error?.message || "Erro desconhecido",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Agente excluído",
          description: data?.openclaw_warning
            ? `Removido do banco. Aviso OpenClaw: ${data.openclaw_warning}`
            : "Removido do OpenClaw e do HS.OS.",
        });
        setDeleteTarget(null);
        fetchAll();
      }
    }
    setDeleting(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke("sync-agents", { body: {} });
    if (error || data?.error) {
      toast({
        title: "Erro ao sincronizar",
        description: data?.error || error?.message || "Verifique OPENCLAW_ADMIN_TOKEN",
        variant: "destructive",
      });
    } else {
      toast({
        title: "Sincronização concluída",
        description: `${data?.imported ?? 0} agentes importados, ${data?.existing ?? 0} já estavam sincronizados`,
      });
      fetchAll();
    }
    setSyncing(false);
  };

  const goToAgentChat = (openclawId: string) => {
    navigate(`/chat?agent=${encodeURIComponent(openclawId)}`);
  };

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="aurora-glow rounded-2xl px-5 py-4">
        <div className="relative z-10 flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-lg font-display font-bold text-foreground flex items-center gap-2">
              <div className="h-8 w-8 rounded-full bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center">
                <UserIcon className="h-4 w-4 text-foreground" />
              </div>
              Usuários
            </h1>
            <p className="text-xs text-muted-foreground mt-1 ml-10">Gerencie os acessos ao HS.OS</p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddAgentOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
            >
              <Plus className="h-4 w-4" />
              Adicionar Agente
            </button>

            <button
              onClick={() => setImportAgentOpen(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
            >
              <Upload className="h-4 w-4" />
              Importar Agente
            </button>

            <Dialog open={inviteOpen} onOpenChange={setInviteOpen}>
              <DialogTrigger asChild>
                <button className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20">
                  <UserPlus className="h-4 w-4" />
                  Convidar Usuário
                </button>
              </DialogTrigger>
              <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl p-0 gap-0">
                <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
                  <DialogTitle className="font-display font-bold text-foreground relative z-10">Convidar novo usuário</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 p-6">
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nome</label>
                    <div className="glass-input flex items-center gap-2 px-3">
                      <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={inviteName}
                        onChange={(e) => setInviteName(e.target.value)}
                        placeholder="Ex: Maria Silva"
                        className="w-full bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Será a identificação visual na plataforma.</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Email</label>
                    <div className="glass-input flex items-center gap-2 px-3">
                      <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={(e) => setInviteEmail(e.target.value)}
                        placeholder="novo@usuario.com"
                        className="w-full bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Perfil de acesso</label>
                    <Select value={inviteRole} onValueChange={(v) => setInviteRole(v as AppRole)}>
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="super_admin">Super Admin</SelectItem>
                        <SelectItem value="member">Membro</SelectItem>
                        <SelectItem value="user">Usuário</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail}
                    className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar convite"}
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Filter toggle */}
        <div className="relative z-10 mt-4 flex items-center gap-1 p-1 rounded-full bg-secondary/40 border border-border/40 w-fit">
          {([
            { v: "all", label: "Todos" },
            { v: "human", label: "Humanos" },
            { v: "agent", label: "Super agentes IA" },
          ] as const).map((opt) => (
            <button
              key={opt.v}
              onClick={() => setFilter(opt.v)}
              className={`px-4 py-1.5 text-xs rounded-full transition-colors ${
                filter === opt.v
                  ? "bg-primary text-primary-foreground shadow"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table card */}
      <div className="glass-card-glow glow-accent">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10">
          <div className="px-5 py-3 border-b border-border/40 flex items-center justify-between gap-3">
            <p className="text-sm font-display text-muted-foreground">
              {rows.length} {rows.length === 1 ? "registro" : "registros"}
              {filter !== "all" && ` (${filter === "human" ? "humanos" : "agentes"})`}
            </p>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              title="Sincronizar agentes a partir do OpenClaw"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
              Sincronizar com OpenClaw
            </button>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Perfil</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Ações</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    if (r.kind === "human") {
                      const st = statusConfig[r.status] ?? statusConfig.active;
                      const isSelf = r.id === currentUser?.id;
                      return (
                        <TableRow key={`h-${r.id}`}>
                          <TableCell>
                            <div className="flex items-center gap-3">
                              <button
                                onClick={() => setAvatarTarget(r)}
                                title="Editar foto"
                                className="relative h-8 w-8 rounded-full bg-gradient-to-br from-primary/60 to-primary/20 flex items-center justify-center shrink-0 overflow-hidden group"
                              >
                                {r.avatar_url ? (
                                  <img src={r.avatar_url} alt={r.full_name} className="h-full w-full object-cover" />
                                ) : (
                                  <span className="text-xs font-bold text-foreground">
                                    {(r.full_name || r.email).charAt(0).toUpperCase()}
                                  </span>
                                )}
                                <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                  <Camera className="h-3.5 w-3.5 text-white" />
                                </span>
                              </button>
                              <div>
                                <p className="text-sm font-medium text-foreground">{r.full_name || r.email}</p>
                                {r.full_name && <p className="text-xs text-muted-foreground">{r.email}</p>}
                              </div>
                            </div>
                          </TableCell>
                          <TableCell>
                            {isSelf ? (
                              <Badge variant="outline" className="gap-1 rounded-full">
                                {roleIcons[r.role]}
                                {roleLabels[r.role]}
                              </Badge>
                            ) : (
                              <Select value={r.role} onValueChange={(v) => handleRoleChange(r.id, v as AppRole)}>
                                <SelectTrigger className="w-[140px] h-8 text-xs rounded-full">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="super_admin">Super Admin</SelectItem>
                                  <SelectItem value="member">Membro</SelectItem>
                                  <SelectItem value="user">Usuário</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge variant={st.variant} className="gap-1 rounded-full">
                              {st.icon}
                              {st.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-2">
                              {!isSelf && r.status !== "pending" && (
                                <button
                                  onClick={() => handleToggleStatus(r.id, r.status)}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                  {r.status === "active" ? (
                                    <>
                                      <Ban className="h-3.5 w-3.5" />
                                      Desativar
                                    </>
                                  ) : (
                                    <>
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Reativar
                                    </>
                                  )}
                                </button>
                              )}
                              {!isSelf && (
                                <button
                                  onClick={() => setDeleteTarget(r)}
                                  title="Excluir usuário"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Excluir
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    }

                    // Agent row
                    const pres = presenceDot(r.presence);
                    return (
                      <TableRow key={`a-${r.id}`}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={() => setAvatarTarget(r)}
                              title="Editar foto"
                              className="relative h-8 w-8 rounded-full bg-gradient-to-br from-violet-500/70 to-indigo-600/40 flex items-center justify-center shrink-0 text-sm overflow-hidden group"
                            >
                              {agentAvatars[r.openclaw_id ?? r.id] ? (
                                <img src={agentAvatars[r.openclaw_id ?? r.id]} alt={r.name} className="h-full w-full object-cover" />
                              ) : (
                                <span>{r.emoji}</span>
                              )}
                              <span className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <Camera className="h-3.5 w-3.5 text-white" />
                              </span>
                            </button>
                            <div>
                              <p className="text-sm font-medium text-foreground">
                                {r.name}
                                {r.specialty && (
                                  <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                                    · {r.specialty}
                                  </span>
                                )}
                                {r.is_leader && (
                                  <span className="ml-2 inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 align-middle">
                                    👑 Orquestrador
                                  </span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono">
                                openclaw:{r.openclaw_id ?? r.id}
                              </p>
                              {r.leader_id && leaderMap[r.leader_id] && (
                                <p className="text-[10px] text-muted-foreground mt-0.5 inline-flex items-center gap-1">
                                  <span className="opacity-60">Liderado por</span>
                                  <span>{leaderMap[r.leader_id].emoji}</span>
                                  <span className="text-foreground/80">{leaderMap[r.leader_id].name}</span>
                                </p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className="gap-1 rounded-full border-transparent bg-violet-500/20 text-violet-300 hover:bg-violet-500/30">
                            <Bot className="h-3 w-3" />
                            Agente IA
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="inline-flex items-center gap-2 text-xs text-foreground">
                            <span className={`h-2 w-2 rounded-full ${pres.dot}`} />
                            {r.status === "inactive" ? "Inativo" : pres.label}
                          </div>
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <button
                                title="Ações"
                                className="inline-flex items-center justify-center h-8 w-8 rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
                              >
                                {exportingId === (r.openclaw_id ?? r.id) ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <MoreVertical className="h-4 w-4" />
                                )}
                              </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-52">
                              <DropdownMenuItem onClick={() => goToAgentChat(r.openclaw_id ?? r.id)}>
                                <MessageSquare className="h-4 w-4 mr-2" />
                                Abrir chat
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() =>
                                  setEditingAgent({
                                    agent_id: r.id,
                                    openclaw_id: r.openclaw_id,
                                    name: r.name,
                                    emoji: r.emoji,
                                  })
                                }
                              >
                                <SettingsIcon className="h-4 w-4 mr-2" />
                                Configurar
                              </DropdownMenuItem>
                              {isAdmin && (
                                <DropdownMenuItem onClick={() => setAccessTarget(r)}>
                                  <Lock className="h-4 w-4 mr-2" />
                                  Gerenciar acesso
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuItem
                                onClick={() => handleExportAgent(r)}
                                disabled={exportingId === (r.openclaw_id ?? r.id)}
                              >
                                <Download className="h-4 w-4 mr-2" />
                                Exportar
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => setDeleteTarget(r)}
                                className="text-destructive focus:text-destructive"
                              >
                                <Trash2 className="h-4 w-4 mr-2" />
                                Excluir
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>

                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {deleteTarget?.kind === "agent" ? "Excluir agente?" : "Excluir usuário?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.kind === "agent"
                ? `Esta ação é permanente. O agente "${(deleteTarget as AgentRow).name}" será removido do OpenClaw e do HS.OS, junto com avatar e integrações.`
                : `Esta ação é permanente. ${(deleteTarget as HumanRow | null)?.full_name || (deleteTarget as HumanRow | null)?.email} perderá imediatamente o acesso ao HS.OS e seu perfil será removido.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDelete();
              }}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Confirmar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AddAgentDialog
        open={addAgentOpen}
        onOpenChange={setAddAgentOpen}
        onCreated={(a) => {
          handleAgentCreated(a);
          fetchAll();
        }}
      />

      <ImportAgentDialog
        open={importAgentOpen}
        onOpenChange={setImportAgentOpen}
        onImported={() => fetchAll()}
      />

      <AvatarCropDialog
        open={!!avatarTarget}
        onOpenChange={(o) => !o && setAvatarTarget(null)}
        initialImage={
          avatarTarget?.kind === "human"
            ? (avatarTarget as HumanRow).avatar_url ?? null
            : avatarTarget
              ? agentAvatars[(avatarTarget as AgentRow).openclaw_id ?? avatarTarget.id] ?? null
              : null
        }
        title={
          avatarTarget?.kind === "agent"
            ? `Foto de ${(avatarTarget as AgentRow).name}`
            : avatarTarget
              ? `Foto de ${(avatarTarget as HumanRow).full_name || (avatarTarget as HumanRow).email}`
              : "Editar foto"
        }
        onConfirm={async (dataUrl) => {
          if (!avatarTarget) return;
          try {
            if (avatarTarget.kind === "human") {
              await uploadUserAvatar(avatarTarget.id, dataUrl);
            } else {
              const agent = avatarTarget as AgentRow;
              await uploadAgentAvatar(agent.openclaw_id ?? agent.id, dataUrl);
            }
            toast({ title: "Foto atualizada" });
            setAvatarTarget(null);
            // Refresh data + avatar caches
            await fetchAll();
            window.location.reload();
          } catch (err) {
            toast({
              title: "Erro ao salvar foto",
              description: (err as Error).message,
              variant: "destructive",
            });
          }
        }}
      />

      {accessTarget && (
        <AgentAccessDialog
          open={!!accessTarget}
          onOpenChange={(o) => !o && setAccessTarget(null)}
          agentId={accessTarget.openclaw_id ?? accessTarget.id}
          agentName={accessTarget.name}
          onSaved={fetchAll}
        />
      )}

      <AgentEditDrawer
        agent={editingAgent}
        onOpenChange={(o) => !o && setEditingAgent(null)}
        onSaved={fetchAll}
        onDeleted={() => {
          setEditingAgent(null);
          fetchAll();
        }}
      />
    </div>
  );
}
