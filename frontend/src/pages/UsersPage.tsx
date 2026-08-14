import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
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
  KeyRound,
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
  departamento: string | null;
  cargo: string | null;
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
  departamento: string | null;
  cargo: string | null;
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
  administrador: "Administrador",
  colaborador: "Colaborador",
  // Não é papel: é o que o backend devolve para quem não tem linha em
  // `user_roles`. Aparece na tela para a pessoa saber que falta atribuir,
  // em vez de a coluna ficar vazia e parecer erro de carregamento.
  sem_papel: "Sem papel",
};

const roleIcons: Record<AppRole, React.ReactNode> = {
  administrador: <ShieldCheck className="h-3.5 w-3.5" />,
  colaborador: <Shield className="h-3.5 w-3.5" />,
  sem_papel: <UserIcon className="h-3.5 w-3.5" />,
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

/**
 * Campo de texto que vive dentro da linha da tabela.
 *
 * Salva ao sair do campo, e **só quando mudou** — sem isso, cada clique numa
 * célula viraria um PATCH. O valor exibido volta do servidor, porque é lá que o
 * `btrim` acontece: mostrar o que foi digitado esconderia a normalização e
 * faria "RH " parecer que ficou com o espaço.
 */
function CampoLinha({
  valor,
  aoSalvar,
  sugestoes,
  placeholder,
}: {
  valor: string | null;
  aoSalvar: (v: string) => void;
  sugestoes?: string;
  placeholder?: string;
}) {
  const [texto, setTexto] = useState(valor ?? "");
  // Quando a linha recarrega (outro campo salvou, ou a lista atualizou), o
  // valor de fora tem que vencer o estado local — senão o campo mostra o que
  // foi digitado antes de um erro.
  useEffect(() => { setTexto(valor ?? ""); }, [valor]);
  return (
    <input
      list={sugestoes}
      value={texto}
      placeholder={placeholder}
      onChange={(e) => setTexto(e.target.value)}
      onBlur={() => { if (texto.trim() !== (valor ?? "").trim()) aoSalvar(texto); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="w-full max-w-[190px] bg-transparent border border-transparent rounded px-2 py-1 text-xs text-foreground
                 placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/50 focus:outline-none transition-colors"
    />
  );
}

export default function UsersPage({ embedded }: { embedded?: boolean } = {}) {
  const { user: currentUser, role } = useAuthContext();
  const isAdmin = role === "administrador";
  const navigate = useNavigate();
  const [humans, setHumans] = useState<HumanRow[]>([]);
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<FilterKind>("all");

  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteRole, setInviteRole] = useState<AppRole>("colaborador");
  const [invitePassword, setInvitePassword] = useState("");
  const [inviteDepartamento, setInviteDepartamento] = useState("");
  const [inviteCargo, setInviteCargo] = useState("");
  // Departamento é texto livre (são 27 pessoas e uma dúzia de áreas — tabela
  // seria máquina demais). O risco é grafia divergente, e a mitigação é esta:
  // sugerir o que já existe, para digitar do zero ser a exceção.
  const departamentosConhecidos = useMemo(
    () => [...new Set(humans.map((h) => h.departamento).filter(Boolean) as string[])].sort(),
    [humans],
  );
  const [inviting, setInviting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Row | null>(null);
  const [deleting, setDeleting] = useState(false);
  // Quem define senha aqui é o administrador, para outra pessoa. O colaborador
  // não troca a própria: as credenciais vivem no FortiPAM.
  const [senhaTarget, setSenhaTarget] = useState<HumanRow | null>(null);
  const [novaSenha, setNovaSenha] = useState("");
  const [salvandoSenha, setSalvandoSenha] = useState(false);
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
      // GET porque é leitura pura. O `agent_id` vai na rota, não no corpo.
      const data = await api<{ hsos_version?: string; dnos_version?: string; agent?: { agent_id?: string } }>(
        `/agents/${encodeURIComponent(id)}/export`,
      );
      if (!(data?.hsos_version ?? data?.dnos_version) || !data.agent?.agent_id) {
        throw new Error("Resposta inválida do servidor");
      }
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.hsos`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "Exportado", description: `${agent.name} exportado como ${id}.hsos` });
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
    // mesma regra de prioridade que estava aqui (administrador > member > user).
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
        role: (p.role ?? "sem_papel") as AppRole,
        departamento: p.departamento ?? null,
        cargo: p.cargo ?? null,
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

  // Não há mais convite por e-mail: o admin cria a conta com uma senha inicial
  // e entrega as credenciais pelo canal interno da empresa. Decisão do Erick em
  // 06/08/2026 — some a dependência de servidor de e-mail e o estado "pendente"
  // de quem foi convidado mas nunca clicou no link.
  /** Grava um campo de texto do perfil. Sem otimismo: a linha só muda depois
   *  que o servidor confirmou, porque o `btrim` acontece lá e o valor exibido
   *  tem que ser o guardado, não o digitado. */
  async function salvarCampo(id: string, campo: "departamento" | "cargo", valor: string) {
    try {
      const p = await api<PerfilApi>(`/profiles/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { [campo]: valor.trim() || null },
      });
      setHumans((atual) =>
        atual.map((h) => (h.id === id ? { ...h, departamento: p.departamento ?? null, cargo: p.cargo ?? null } : h)),
      );
    } catch (e) {
      toast({
        title: `Não consegui salvar ${campo}`,
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  const handleInvite = async () => {
    if (!inviteEmail || !inviteName.trim() || invitePassword.length < 8) return;
    setInviting(true);
    try {
      await api("/profiles", {
        method: "POST",
        body: {
          email: inviteEmail,
          nome: inviteName.trim(),
          senha: invitePassword,
          role: inviteRole,
          departamento: inviteDepartamento.trim() || null,
          cargo: inviteCargo.trim() || null,
        },
      });
      toast({
        title: "Conta criada",
        description: `${inviteEmail} já pode entrar com a senha definida.`,
      });
      setInviteEmail("");
      setInviteName("");
      setInvitePassword("");
      setInviteDepartamento("");
      setInviteCargo("");
      setInviteOpen(false);
      fetchAll();
    } catch (e) {
      toast({
        title: "Erro ao criar a conta",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setInviting(false);
    }
  };

  // A trilha em `access_logs` saiu do cliente: o endpoint grava o log na mesma
  // transação da mudança. Antes eram duas escritas independentes, e a segunda
  // podia falhar em silêncio deixando a mudança sem registro.
  const handleRoleChange = async (userId: string, newRole: AppRole) => {
    try {
      await api(`/profiles/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: { role: newRole },
      });
      toast({ title: "Role atualizado" });
      fetchAll();
    } catch (e) {
      toast({
        title: "Erro ao alterar o papel",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  const handleToggleStatus = async (userId: string, currentStatus: string) => {
    const newStatus = currentStatus === "active" ? "inactive" : "active";
    try {
      await api(`/profiles/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: { status: newStatus },
      });
      toast({ title: newStatus === "inactive" ? "Usuário desativado" : "Usuário reativado" });
      fetchAll();
    } catch (e) {
      toast({
        title: "Erro ao alterar o status",
        description: (e as Error).message,
        variant: "destructive",
      });
    }
  };

  // Não pede a senha atual: quem troca é o administrador, que por definição não
  // a conhece. O que autoriza é o papel, conferido no backend — o `isAdmin`
  // daqui só decide o que aparece na tela.
  const handleDefinirSenha = async () => {
    if (!senhaTarget || novaSenha.length < 8) return;
    setSalvandoSenha(true);
    try {
      await api(`/profiles/${encodeURIComponent(senhaTarget.id)}/senha`, {
        method: "POST",
        body: { senha: novaSenha },
      });
      toast({
        title: "Senha definida",
        description: `${senhaTarget.email} já entra com a senha nova. Guarde-a no FortiPAM.`,
      });
      setSenhaTarget(null);
      setNovaSenha("");
      fetchAll();
    } catch (e) {
      toast({
        title: "Erro ao definir a senha",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSalvandoSenha(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    if (deleteTarget.kind === "human") {
      try {
        await api(`/profiles/${encodeURIComponent(deleteTarget.id)}`, { method: "DELETE" });
        toast({ title: "Usuário excluído" });
        setDeleteTarget(null);
        fetchAll();
      } catch (e) {
        toast({
          title: "Erro ao excluir",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    } else {
      // Exclusão dura do agente: sai do OpenClaw e do nosso banco. O `agent_id`
      // basta — o endpoint resolve o `openclaw_id` sozinho.
      const agent = deleteTarget as AgentRow;
      try {
        const d = await api<{ removido_do_gateway: boolean; aviso_gateway: string | null }>(
          `/agents/${encodeURIComponent(agent.id)}`,
          { method: "DELETE" },
        );
        toast({
          title: "Agente excluído",
          description: d.removido_do_gateway
            ? "Removido do OpenClaw e do HS.OS."
            : `Removido do banco. Aviso do gateway: ${d.aviso_gateway}`,
        });
        setDeleteTarget(null);
        fetchAll();
      } catch (e) {
        toast({
          title: "Erro ao excluir agente",
          description: (e as Error).message,
          variant: "destructive",
        });
      }
    }
    setDeleting(false);
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const d = await api<{ criados: number; atualizados: number; total_no_gateway: number }>(
        "/agents/sync",
        { method: "POST" },
      );
      toast({
        title: "Sincronização concluída",
        description: `${d.criados} agentes importados, ${d.atualizados} já estavam sincronizados`,
      });
      fetchAll();
    } catch (e) {
      toast({
        title: "Erro ao sincronizar",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setSyncing(false);
    }
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
                  Criar Conta
                </button>
              </DialogTrigger>
              <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl p-0 gap-0">
                <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
                  <DialogTitle className="font-display font-bold text-foreground relative z-10">Criar conta de colaborador</DialogTitle>
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
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Senha inicial</label>
                    <div className="glass-input flex items-center gap-2 px-3">
                      <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
                      <input
                        type="text"
                        value={invitePassword}
                        onChange={(e) => setInvitePassword(e.target.value)}
                        placeholder="mínimo de 8 caracteres"
                        className="w-full bg-transparent py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                      />
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      Visível de propósito — você precisa copiar e repassar pelo canal interno.
                      Não há e-mail de convite.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Departamento</label>
                      <input
                        list="lista-departamentos"
                        value={inviteDepartamento}
                        onChange={(e) => setInviteDepartamento(e.target.value)}
                        placeholder="RECURSOS HUMANOS"
                        className="w-full rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Cargo</label>
                      <input
                        value={inviteCargo}
                        onChange={(e) => setInviteCargo(e.target.value)}
                        placeholder="Coordenadora de RH Junior"
                        className="w-full rounded-lg border border-border bg-transparent px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary/50"
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
                        <SelectItem value="administrador">Administrador</SelectItem>
                        <SelectItem value="colaborador">Colaborador</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <button
                    onClick={handleInvite}
                    disabled={inviting || !inviteEmail || !inviteName.trim() || invitePassword.length < 8}
                    className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
                  >
                    {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Criar conta"}
                  </button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        </div>

        {/* Definir a senha de outra pessoa. Não pede a senha atual — quem troca
            é o administrador, que não a conhece; é o papel que autoriza. */}
        <Dialog
          open={senhaTarget !== null}
          onOpenChange={(aberto) => { if (!aberto) { setSenhaTarget(null); setNovaSenha(""); } }}
        >
          <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl p-0 gap-0">
            <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
              <DialogTitle className="font-display font-bold text-foreground relative z-10">
                Definir senha
              </DialogTitle>
            </DialogHeader>
            <div className="space-y-4 p-6">
              <p className="text-sm text-muted-foreground">
                Nova senha de <span className="text-foreground font-medium">{senhaTarget?.full_name || senhaTarget?.email}</span>.
                A pessoa passa a entrar com ela imediatamente, e não recebe aviso —
                combine a entrega e guarde no FortiPAM.
              </p>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  Senha (mínimo 8 caracteres)
                </label>
                <Input
                  type="text"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  placeholder="cole aqui a senha do cofre"
                  autoComplete="off"
                  className="font-mono"
                />
              </div>
              <button
                onClick={handleDefinirSenha}
                disabled={salvandoSenha || novaSenha.length < 8}
                className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
              >
                {salvandoSenha ? <Loader2 className="h-4 w-4 animate-spin" /> : "Definir senha"}
              </button>
            </div>
          </DialogContent>
        </Dialog>

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
                {/* Sugere os departamentos que já existem, para "RH" e "Recursos
                    Humanos" não virarem duas áreas. Serve os campos da tabela e o
                    do formulário de criação, por isso é um só. */}
                <datalist id="lista-departamentos">
                  {departamentosConhecidos.map((d) => <option key={d} value={d} />)}
                </datalist>
                <TableHeader>
                  <TableRow>
                    <TableHead>Usuário</TableHead>
                    <TableHead>Departamento</TableHead>
                    <TableHead>Cargo</TableHead>
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
                          {/* Editável na própria linha: o RH cadastra dezenas de
                              pessoas de uma vez, e abrir um diálogo por campo
                              transformaria isso numa tarde. Salva ao sair do
                              campo, e só quando mudou. */}
                          <TableCell>
                            <CampoLinha
                              valor={r.departamento}
                              sugestoes="lista-departamentos"
                              placeholder="—"
                              aoSalvar={(v) => salvarCampo(r.id, "departamento", v)}
                            />
                          </TableCell>
                          <TableCell>
                            <CampoLinha
                              valor={r.cargo}
                              placeholder="—"
                              aoSalvar={(v) => salvarCampo(r.id, "cargo", v)}
                            />
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
                                  <SelectItem value="administrador">Administrador</SelectItem>
                                  <SelectItem value="colaborador">Colaborador</SelectItem>
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
                              {!isSelf && (
                                <button
                                  onClick={() => { setSenhaTarget(r); setNovaSenha(""); }}
                                  title="Definir a senha desta pessoa"
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                  <KeyRound className="h-3.5 w-3.5" />
                                  Senha
                                </button>
                              )}
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
                        {/* Agente não tem departamento nem cargo. As células
                            vazias mantêm o alinhamento — a tabela é a mesma
                            para pessoas e agentes. */}
                        <TableCell className="text-muted-foreground/50">—</TableCell>
                        <TableCell className="text-muted-foreground/50">—</TableCell>
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
