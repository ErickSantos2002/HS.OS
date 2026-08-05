import { useState, useEffect, useCallback, useMemo } from "react";
import { useAgents } from "@/hooks/use-agents";
import { getGatewayConfig, gatewayNaoPortado } from "@/lib/gateway";
import { MessageSquare, Loader2, WifiOff, RefreshCw, ChevronRight, User, Bot, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";

interface Session {
  id: string;
  agentId: string;
  platform?: string;
  lastMessage?: string;
  updatedAt?: string;
  messageCount?: number;
}

interface SessionMessage {
  role: string;
  content: string;
  timestamp?: string;
}

function stripPrefix(id: string) {
  return id.includes(":") ? id.split(":").pop()! : id;
}

export default function SessionsPage() {
  const { agents, loading: agentsLoading } = useAgents();
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [selectedKind, setSelectedKind] = useState<"all" | "dm" | "channel" | "broadcast" | "legacy">("all");
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [viewingSession, setViewingSession] = useState<Session | null>(null);
  const [sessionMessages, setSessionMessages] = useState<SessionMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const fetchSessions = useCallback(async () => {
    const config = getGatewayConfig();
    const agentsToFetch = selectedAgent === "all" ? agents : agents.filter((a) => a.id === selectedAgent);
    if (agentsToFetch.length === 0) { setSessions([]); return; }

    setLoading(true);
    setError(null);

    try {
      const results = await Promise.all(
        agentsToFetch.map(async (agent) => {
          const shortId = stripPrefix(agent.id);
          const res = await fetch(`${config.url}/api/sessions/${shortId}`, {
            headers: { Authorization: `Bearer ${gatewayNaoPortado("Sessões do gateway")}` },
          });
          if (!res.ok) { if (res.status === 404) return []; throw new Error(`Erro ${res.status} ao buscar sessões de ${agent.name}`); }
          const data = await res.json();
          const list = Array.isArray(data) ? data : (data.sessions ?? data.data ?? []);
          return list.map((s: any) => ({
            id: s.id ?? s.session_id ?? "",
            agentId: agent.id,
            platform: s.platform ?? s.channel ?? "",
            lastMessage: s.last_message ?? s.lastMessage ?? "",
            updatedAt: s.updated_at ?? s.updatedAt ?? s.created_at ?? "",
            messageCount: s.message_count ?? s.messageCount ?? 0,
          }));
        })
      );
      setSessions(results.flat());
    } catch (err: any) {
      setError(err.message || "Falha ao buscar sessões");
      setSessions([]);
    } finally { setLoading(false); }
  }, [agents, selectedAgent]);

  useEffect(() => {
    if (!agentsLoading && agents.length > 0) fetchSessions();
  }, [fetchSessions, agentsLoading, agents.length]);

  const handleViewSession = async (session: Session) => {
    const config = getGatewayConfig();
    setViewingSession(session);
    setMessagesLoading(true);
    setSessionMessages([]);
    try {
      const shortId = stripPrefix(session.agentId);
      const res = await fetch(`${config.url}/api/sessions/${shortId}/${session.id}`, {
        headers: { Authorization: `Bearer ${gatewayNaoPortado("Sessões do gateway")}` },
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      const msgs = Array.isArray(data) ? data : (data.messages ?? data.data ?? []);
      setSessionMessages(
        msgs.map((m: any) => ({
          role: m.role ?? "user",
          content: m.content ?? "",
          timestamp: m.timestamp ?? m.created_at ?? "",
        }))
      );
    } catch (err: any) {
      setSessionMessages([{ role: "system", content: `Erro ao carregar: ${err.message}` }]);
    } finally { setMessagesLoading(false); }
  };

  const isLoading = loading || agentsLoading;

  const sessionKind = useCallback((id: string): "dm" | "channel" | "broadcast" | "legacy" => {
    if (id.startsWith("dm:")) return "dm";
    if (id.startsWith("channel:")) return "channel";
    if (id.startsWith("broadcast:")) return "broadcast";
    return "legacy";
  }, []);

  const filteredSessions = useMemo(() => {
    if (selectedKind === "all") return sessions;
    return sessions.filter((s) => sessionKind(s.id) === selectedKind);
  }, [sessions, selectedKind, sessionKind]);

  const legacyCount = useMemo(
    () => sessions.filter((s) => sessionKind(s.id) === "legacy").length,
    [sessions, sessionKind]
  );

  const cleanupLegacySessions = useCallback(async () => {
    const legacy = sessions.filter((s) => sessionKind(s.id) === "legacy");
    if (legacy.length === 0) {
      toast.info("Nenhuma sessão antiga para limpar.");
      return;
    }
    if (!confirm(`Apagar ${legacy.length} sessão(ões) antigas (fora do padrão dm:/channel:/broadcast:)?`)) return;
    const config = getGatewayConfig();
    setCleaning(true);
    let ok = 0;
    let fail = 0;
    await Promise.all(
      legacy.map(async (s) => {
        const shortId = stripPrefix(s.agentId);
        try {
          const res = await fetch(`${config.url}/api/sessions/${shortId}/${encodeURIComponent(s.id)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${gatewayNaoPortado("Sessões do gateway")}` },
          });
          if (res.ok || res.status === 404) ok++; else fail++;
        } catch { fail++; }
      })
    );
    setCleaning(false);
    toast.success(`Limpeza concluída: ${ok} apagada(s)${fail ? `, ${fail} falharam` : ""}.`);
    fetchSessions();
  }, [sessions, sessionKind, fetchSessions]);

  return (
    <div className="p-6 space-y-6">
      {/* Aurora header */}
      <div className="aurora-glow rounded-2xl px-5 py-4">
        <div className="relative z-10 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-[hsl(260,70%,55%)] flex items-center justify-center shadow-lg shadow-primary/20">
              <MessageSquare className="h-5 w-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-display font-bold text-foreground">Sessões</h1>
              <p className="text-[11px] text-muted-foreground">Histórico de conversas dos agentes</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={cleanupLegacySessions}
              disabled={isLoading || cleaning || legacyCount === 0}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-full glass-card hover:border-destructive/40 transition-colors disabled:opacity-50"
              title="Apaga sessões fora do padrão dm:/channel:/broadcast:"
            >
              <Trash2 className={`h-4 w-4 ${cleaning ? "animate-pulse" : ""}`} />
              Limpar antigas{legacyCount > 0 ? ` (${legacyCount})` : ""}
            </button>
            <button
              onClick={fetchSessions}
              disabled={isLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-full glass-card hover:border-primary/30 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? "animate-spin" : ""}`} /> Atualizar
            </button>
          </div>
        </div>
      </div>

      {/* Kind filter tabs */}
      <div className="glass-input flex gap-1 p-1 w-fit">
        {([
          ["all", "Todas"],
          ["dm", "DMs"],
          ["channel", "Canais"],
          ["broadcast", "Broadcast"],
          ["legacy", "Antigas"],
        ] as const).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSelectedKind(k)}
            className={`px-3 py-1.5 text-xs rounded-full transition-all ${
              selectedKind === k
                ? "bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground shadow-lg shadow-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter tabs */}
      <div className="glass-input flex gap-1 p-1 w-fit">
        <button
          onClick={() => setSelectedAgent("all")}
          className={`px-3 py-1.5 text-xs rounded-full transition-all ${
            selectedAgent === "all"
              ? "bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground shadow-lg shadow-primary/20"
              : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
          }`}
        >
          Todos
        </button>
        {agents.map((a) => (
          <button
            key={a.id}
            onClick={() => setSelectedAgent(a.id)}
            className={`px-3 py-1.5 text-xs rounded-full transition-all ${
              selectedAgent === a.id
                ? "bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground shadow-lg shadow-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/30"
            }`}
          >
            {a.name}
          </button>
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-destructive glass-card rounded-2xl px-4 py-3 border border-destructive/30">
          <WifiOff className="h-4 w-4" /> {error}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : filteredSessions.length === 0 && !error ? (
        <div className="glass-card rounded-2xl p-12 text-center">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Nenhuma sessão encontrada</p>
        </div>
      ) : (
        <div className="glass-card-glow glow-accent overflow-hidden rounded-2xl">
          <div className="glass-card-glow-effect" />
          <div className="relative z-10">
            <div className="aurora-glow px-5 py-3 border-b border-border/40 flex items-center gap-2">
              <MessageSquare className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-display font-semibold text-foreground">Sessões</h2>
              <span className="ml-auto text-xs text-muted-foreground font-mono">{filteredSessions.length} de {sessions.length} sessão(ões)</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/50 sticky top-0 bg-card/50 backdrop-blur-sm">
                    <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">ID</th>
                    <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">Agente</th>
                    <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">Plataforma</th>
                    <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">Última Msg</th>
                    <th className="px-4 py-2.5 text-left text-xs text-muted-foreground uppercase tracking-wider font-medium">Data</th>
                    <th className="px-4 py-2.5 text-right text-xs text-muted-foreground uppercase tracking-wider font-medium">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSessions.map((s) => {
                    const agent = agents.find((a) => a.id === s.agentId);
                    return (
                      <tr key={`${s.agentId}-${s.id}`} className="border-b border-border/30 hover:bg-primary/5 transition-colors duration-150">
                        <td className="px-4 py-3 font-mono text-xs text-primary truncate max-w-[150px]">{s.id}</td>
                        <td className="px-4 py-3 text-xs text-muted-foreground">{agent?.name ?? stripPrefix(s.agentId)}</td>
                        <td className="px-4 py-3">
                          {s.platform && (
                            <span className="px-1.5 py-0.5 text-[10px] font-mono rounded-lg bg-primary/10 text-primary border border-primary/30 uppercase">
                              {s.platform}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-muted-foreground truncate max-w-[200px]">{s.lastMessage}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {s.updatedAt ? new Date(s.updatedAt).toLocaleDateString("pt-BR") : "—"}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => handleViewSession(s)}
                            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors duration-150"
                            title="Ver histórico"
                          >
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Session messages dialog */}
      <Dialog open={!!viewingSession} onOpenChange={(open) => !open && setViewingSession(null)}>
        <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-2xl rounded-2xl p-0 gap-0">
          <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
            <DialogTitle className="font-display flex items-center gap-2 text-sm">
              <MessageSquare className="h-4 w-4 text-primary" />
              <span>Sessão {viewingSession?.id?.slice(0, 12)}...</span>
            </DialogTitle>
          </DialogHeader>
          <ScrollArea className="max-h-[60vh] p-4">
            {messagesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              </div>
            ) : sessionMessages.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">Nenhuma mensagem</p>
            ) : (
              <div className="space-y-3 p-2">
                {sessionMessages.map((msg, i) => (
                  <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}>
                    {msg.role !== "user" && (
                      <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0">
                        <Bot className="h-3 w-3 text-foreground" />
                      </div>
                    )}
                    <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      msg.role === "user"
                        ? "bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground"
                        : "bg-secondary/30 text-foreground border border-border/30 backdrop-blur-md"
                    }`}>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                      {msg.timestamp && (
                        <span className="text-[10px] opacity-60 font-mono block mt-1">
                          {new Date(msg.timestamp).toLocaleString("pt-BR")}
                        </span>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="h-6 w-6 rounded-lg bg-secondary/50 flex items-center justify-center shrink-0">
                        <User className="h-3 w-3 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
