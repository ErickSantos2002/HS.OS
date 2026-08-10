import { api } from "@/lib/api";
import { useState, useEffect } from "react";
import { useAuthContext } from "@/contexts/auth-context";
import { useAgents } from "@/hooks/use-agents";
import { useAllAvatars, getAgentAvatar } from "@/hooks/use-agent-avatar";
import { getAgentDisplayName } from "@/lib/channel-agents";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { toast } from "@/hooks/use-toast";
import { X, UserPlus, Search, Bot, User, Trash2 } from "lucide-react";
import { UserStatusBadge } from "@/components/UserStatusBadge";
import { formatStatusAge } from "@/lib/user-status";

interface MemberInfo {
  user_id: string;
  member_type: string;
  display_name: string;
  avatar_url?: string | null;
  custom_status?: string | null;
  custom_status_emoji?: string | null;
  custom_status_set_at?: string | null;
}

interface Props {
  channelId: string;
  channelCreatedBy: string;
  open: boolean;
  onClose: () => void;
  onMembersChanged: () => void;
}

export default function ChannelMembersPanel({ channelId, channelCreatedBy, open, onClose, onMembersChanged }: Props) {
  const { user, role } = useAuthContext();
  const [members, setMembers] = useState<MemberInfo[]>([]);
  const [showInvite, setShowInvite] = useState(false);
  const [search, setSearch] = useState("");
  const [availableUsers, setAvailableUsers] = useState<{ id: string; name: string; type: "human" | "agent"; avatar_url?: string | null }[]>([]);
  const [removingMemberId, setRemovingMemberId] = useState<string | null>(null);
  const { agents } = useAgents();
  const agentAvatars = useAllAvatars();

  const canManage = role === "super_admin" || user?.id === channelCreatedBy;

  useEffect(() => {
    if (!open) return;
    loadMembers();
  }, [open, channelId]);

  const loadMembers = async () => {
    const data = await api<any[]>(`/channels/${channelId}/members`).catch(() => null);
    if (!data) return;

    const infos: MemberInfo[] = [];
    for (const m of data as any[]) {
      if (m.member_type === "agent") {
        infos.push({
          user_id: m.user_id,
          member_type: "agent",
          display_name: getAgentDisplayName(m.user_id),
          avatar_url: agentAvatars[m.user_id] || getAgentAvatar(m.user_id),
        });
      } else {
        const profile = await api<any>(
          `/profiles/${encodeURIComponent(m.user_id)}`,
        ).catch(() => null);
        infos.push({
          user_id: m.user_id,
          member_type: "human",
          display_name: profile?.full_name || profile?.email || m.user_id,
          avatar_url: profile?.avatar_url ?? null,
          custom_status: (profile as any)?.custom_status ?? null,
          custom_status_emoji: (profile as any)?.custom_status_emoji ?? null,
          custom_status_set_at: (profile as any)?.custom_status_set_at ?? null,
        });
      }
    }
    setMembers(infos);
  };

  const openInvite = async () => {
    setShowInvite(true);
    setSearch("");
    const memberIds = new Set(members.map((m) => m.user_id));

    const { data: profiles } = await api<any[]>("/profiles").then((d) => ({ data: d })).catch(() => ({ data: [] as any[] }));
    const humans = (profiles ?? [])
      .filter((p: any) => !memberIds.has(p.id))
      .map((p: any) => ({ id: p.id, name: p.full_name || p.email, type: "human" as const, avatar_url: p.avatar_url }));

    const availableAgents = agents
      .filter((agent) => !memberIds.has(agent.id))
      .map((agent) => ({
        id: agent.id,
        name: agent.name || getAgentDisplayName(agent.id),
        type: "agent" as const,
        avatar_url: agentAvatars[agent.id] || getAgentAvatar(agent.id),
      }));

    setAvailableUsers([...humans, ...availableAgents]);
  };

  const addMember = async (id: string, type: "human" | "agent") => {
    // Quem já está é ignorado pelo servidor — era o `ignoreDuplicates` daqui.
    await api(`/channels/${channelId}/members`, {
      method: "POST",
      body: type === "agent" ? { agent_ids: [id] } : { user_ids: [id] },
    }).catch(() => { /* o loadMembers abaixo mostra o estado real */ });
    setShowInvite(false);
    await loadMembers();
    onMembersChanged();
  };

  const removeMember = async (userId: string) => {
    setRemovingMemberId(userId);

    const error = await api(
      `/channels/${channelId}/members/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ).then(() => null, (e: Error) => e);

    setRemovingMemberId(null);

    if (error) {
      toast({
        title: "Não foi possível remover o membro",
        description: "Verifique suas permissões e tente novamente.",
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Membro removido",
      description: "O canal foi atualizado com sucesso.",
    });

    await loadMembers();
    onMembersChanged();
  };

  const filtered = availableUsers.filter(
    (u) => u.name.toLowerCase().includes(search.toLowerCase())
  );

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div className="absolute right-0 top-0 bottom-0 z-50 flex w-72 flex-col overflow-hidden rounded-l-2xl border-l border-border/40 bg-card/95 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-right-5 duration-200">
        <div className="aurora-glow h-14 border-b border-border/30 flex items-center justify-between px-4 shrink-0">
          <h3 className="font-display font-bold text-sm text-foreground relative z-10">Membros do canal</h3>
          <button onClick={onClose} className="h-7 w-7 rounded-xl bg-secondary/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all relative z-10">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {canManage && (
          <div className="p-3 border-b border-border/30">
            <button
              onClick={openInvite}
              className="w-full flex items-center justify-center gap-2 py-2 text-xs rounded-full border border-border/40 bg-secondary/30 text-foreground hover:bg-secondary/60 transition-colors"
            >
              <UserPlus className="h-3.5 w-3.5" /> Convidar membro
            </button>
          </div>
        )}

        {showInvite && (
          <div className="p-3 border-b border-border/30 space-y-2">
            <div className="glass-input flex items-center gap-2 px-3">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar usuário ou agente..."
                className="w-full bg-transparent py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
                autoFocus
              />
            </div>
            <ScrollArea className="max-h-40">
              {filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">Nenhum resultado</p>
              ) : (
                filtered.map((u) => (
                  <button
                    key={u.id}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-primary/10 text-left text-xs transition-colors"
                    onClick={() => addMember(u.id, u.type)}
                  >
                    <div className="h-6 w-6 rounded-full bg-gradient-to-br from-primary/40 to-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                      {u.type === "agent" ? (
                        <Bot className="h-3.5 w-3.5 text-primary" />
                      ) : u.avatar_url ? (
                        <img src={u.avatar_url} alt={u.name} className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-[9px] font-bold text-primary">{u.name?.charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                    <span className="truncate">{u.name}</span>
                    <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-auto shrink-0 rounded-full">
                      {u.type === "agent" ? "Agente" : "Humano"}
                    </Badge>
                  </button>
                ))
              )}
            </ScrollArea>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-1">
            {members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-2 px-2 py-1.5 rounded-xl group hover:bg-primary/5 transition-colors">
                <div className="relative shrink-0">
                  <div className="h-7 w-7 rounded-full bg-gradient-to-br from-primary/40 to-primary/10 flex items-center justify-center overflow-hidden">
                    {m.member_type === "agent" ? (
                      <Bot className="h-3.5 w-3.5 text-primary" />
                    ) : m.avatar_url ? (
                      <img src={m.avatar_url} alt={m.display_name} className="h-full w-full object-cover" />
                    ) : (
                      <span className="text-[10px] font-bold text-primary">{m.display_name.charAt(0).toUpperCase()}</span>
                    )}
                  </div>
                  {m.member_type !== "agent" && (
                    <UserStatusBadge
                      emoji={m.custom_status_emoji ?? null}
                      label={m.custom_status ?? null}
                      className="h-3.5 w-3.5 text-[9px]"
                    />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-medium text-foreground truncate block">{m.display_name}</span>
                  {m.custom_status && m.custom_status_emoji && (
                    <span className="text-[10px] text-muted-foreground truncate block">
                      {m.custom_status_emoji} {m.custom_status}
                      {m.custom_status_set_at ? ` · ${formatStatusAge(m.custom_status_set_at)}` : ""}
                    </span>
                  )}
                </div>
                <Badge variant="secondary" className="text-[9px] px-1 py-0 shrink-0 rounded-full">
                  {m.member_type === "agent" ? "Agente" : "Humano"}
                </Badge>
                {canManage && m.user_id !== user?.id && (
                  <button
                    disabled={removingMemberId === m.user_id}
                    className="h-5 w-5 flex items-center justify-center opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive shrink-0 transition-opacity"
                    onClick={() => removeMember(m.user_id)}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}
