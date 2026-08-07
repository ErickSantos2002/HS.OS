import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type AccessType = "all" | "admins_only" | "specific_users";

interface PlatformUser {
  id: string;
  full_name: string | null;
  email: string;
  avatar_url: string | null;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agentId: string;
  agentName: string;
  onSaved?: () => void;
}

export function AgentAccessDialog({ open, onOpenChange, agentId, agentName, onSaved }: Props) {
  const [accessType, setAccessType] = useState<AccessType>("all");
  const [allowedUserIds, setAllowedUserIds] = useState<string[]>([]);
  const [users, setUsers] = useState<PlatformUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      const [eu, profileRes, usersRes] = await Promise.all([
        api<{ id: string }>("/profiles/me").catch(() => null),
        api<any>(`/agents/${encodeURIComponent(agentId)}`)
          .then((d) => ({ data: d })).catch(() => ({ data: null })),
        api<any[]>("/profiles")
          .then((d) => ({ data: d })).catch(() => ({ data: [] as any[] })),
      ]);
      if (cancelled) return;
      const uid = eu?.id ?? null;
      setCurrentUserId(uid);
      const at = (profileRes.data?.access_type as AccessType) ?? "all";
      const ids = (profileRes.data?.allowed_user_ids as string[] | null) ?? [];
      setAccessType(at);
      setAllowedUserIds(uid && !ids.includes(uid) ? [uid, ...ids] : ids);
      setUsers((usersRes.data ?? []) as PlatformUser[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [open, agentId]);

  async function save() {
    setSaving(true);
    let data: any = null;
    let error: Error | null = null;
    try {
      data = await api<any>(`/agents/${encodeURIComponent(agentId)}/acesso`, {
        method: "PUT",
        body: {
          agent_name: agentName,
          access_type: accessType,
          allowed_user_ids: accessType === "specific_users" ? allowedUserIds : [],
        },
      });
    } catch (e: any) {
      error = e;
    }
    setSaving(false);
    if (error || data?.success === false) {
      toast({
        title: "Erro ao salvar acesso",
        description: data?.error || error?.message || "Erro desconhecido",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "Acesso atualizado", description: "Lia foi notificada." });
    onSaved?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-lg rounded-2xl p-0 gap-0">
        <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
          <DialogTitle className="font-display font-bold text-foreground relative z-10">
            🔒 Gerenciar acesso · {agentName}
          </DialogTitle>
        </DialogHeader>

        <div className="p-6 space-y-4 max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <>
              <div className="space-y-2">
                {([
                  { v: "all", title: "Todos da plataforma", desc: "Qualquer membro autenticado pode acessar este agente." },
                  { v: "admins_only", title: "Apenas administradores", desc: "Somente Super Admins têm acesso." },
                  { v: "specific_users", title: "Usuários específicos", desc: "Selecione quem pode acessar." },
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
                  <div className="max-h-64 overflow-y-auto space-y-1 rounded-lg border border-border/40 p-1.5 bg-secondary/10">
                    {users.map((u) => {
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
                          </div>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-border/30 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            disabled={saving}
            className="px-4 py-2 text-sm rounded-full text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving || loading}
            className="inline-flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-white hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 disabled:opacity-60"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Salvar"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
