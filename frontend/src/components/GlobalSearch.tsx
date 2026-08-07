import { api } from "@/lib/api";
import { useState, useRef, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { Search, Bot, Hash, MessageSquare, X } from "lucide-react";
import { useAgents, type GatewayAgent } from "@/hooks/use-agents";
import { useChannels } from "@/hooks/use-channels";
import { useAuthContext } from "@/contexts/auth-context";
import { useNavigate } from "react-router-dom";

type SearchResult = {
  id: string;
  type: "agent-message" | "channel-message";
  title: string;
  subtitle: string;
  preview: string;
  target: string;
  icon: "bot" | "channel";
  createdAt: string;
};

function normalizePreview(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const { agents } = useAgents();
  const { channels } = useChannels();
  const { user } = useAuthContext();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);

  const agentNameById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const channelNameById = useMemo(
    () => new Map(channels.map((channel) => [channel.id, channel.name])),
    [channels],
  );

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!open || !user?.id) return;

    const search = query.trim();
    if (search.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    const run = async () => {
      setLoading(true);

      // Uma consulta só: o backend procura nas duas fontes e o RLS decide o
      // que aparece de canal.
      const achados = await api<Array<{
        tipo: string;
        id: string;
        origem: string;
        autor: string | null;
        content: string;
        created_at: string;
      }>>(`/busca?q=${encodeURIComponent(search)}`).catch(() => []);
      const conversationResponse = { data: achados.filter((a) => a.tipo === "conversa") };
      const channelResponse = { data: achados.filter((a) => a.tipo === "canal") };

      if (cancelled) return;

      const conversationResults: SearchResult[] = (conversationResponse.data ?? [])
        .filter((item) => item.content)
        .map((item) => ({
          id: `conversation-${item.id}`,
          type: "agent-message",
          title: agentNameById.get(item.origem) ?? item.origem,
          subtitle: "Conversa privada",
          preview: normalizePreview(item.content ?? ""),
          target: `/chat?agent=${encodeURIComponent(item.origem)}&message=${encodeURIComponent(item.id)}`,
          icon: "bot",
          createdAt: item.created_at,
        }));

      const channelResults: SearchResult[] = (channelResponse.data ?? [])
        .filter((item) => item.content)
        .map((item) => ({
          id: `channel-${item.id}`,
          type: "channel-message",
          title: channelNameById.get(item.origem) ?? "Canal",
          subtitle: item.autor ?? "",
          preview: normalizePreview(item.content ?? ""),
          target: `/chat?channel=${encodeURIComponent(item.origem)}&message=${encodeURIComponent(item.id)}`,
          icon: "channel",
          createdAt: item.created_at,
        }));

      setResults(
        [...conversationResults, ...channelResults]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 12),
      );
      setLoading(false);
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [agentNameById, channelNameById, open, query, user?.id]);

  const quickAgents = query.trim()
    ? agents.filter(
        (a) =>
          a.name.toLowerCase().includes(query.toLowerCase()) ||
          a.id.toLowerCase().includes(query.toLowerCase()) ||
          a.model.toLowerCase().includes(query.toLowerCase())
      )
    : agents.slice(0, 5);

  const handleAgentSelect = (agent: GatewayAgent) => {
    setOpen(false);
    setQuery("");
    navigate(`/agents/${encodeURIComponent(agent.id)}`);
  };

  const handleResultSelect = (target: string) => {
    setOpen(false);
    setQuery("");
    navigate(target);
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`flex items-center ${compact ? "justify-center px-2.5" : "w-full justify-between px-4"} gap-2 rounded-xl border border-border bg-card/50 text-muted-foreground backdrop-blur-md transition-colors duration-150 hover:text-foreground ${compact ? "py-1.5 text-xs" : "py-2 text-sm shadow-[var(--shadow-glass)]"}`}
      >
        <div className="flex items-center gap-2 min-w-0">
          <Search className="h-3.5 w-3.5 shrink-0" />
          {!compact && <span className="truncate">Buscar em todo o chat...</span>}
        </div>
        {!compact && (
          <kbd className="hidden sm:inline-flex h-5 items-center gap-0.5 rounded border border-border bg-muted px-1.5 font-mono text-[10px] text-muted-foreground">
            ⌘K
          </kbd>
        )}
      </button>

      {open && createPortal(
        <div className="fixed inset-0 z-[200] isolate flex items-start justify-center pt-[20vh]" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 z-0 bg-background/95 backdrop-blur-md" />
          <div
            className="relative z-10 w-full max-w-2xl mx-4 rounded-2xl border border-border bg-card shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <Search className="h-4 w-4 text-muted-foreground shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Pesquisar mensagens em conversas e canais que você pode acessar..."
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
              />
              <button onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="max-h-[28rem] overflow-y-auto p-2 space-y-3 bg-card">
              {query.trim().length >= 2 && results.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 pt-1 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Mensagens</p>
                  {results.map((result) => (
                    <button
                      key={result.id}
                      onClick={() => handleResultSelect(result.target)}
                      className="w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left hover:bg-secondary/60 transition-colors duration-150"
                    >
                      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0">
                        {result.icon === "bot" ? <Bot className="h-4 w-4 text-foreground" /> : <Hash className="h-4 w-4 text-foreground" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="text-sm text-foreground truncate">{result.title}</p>
                          <span className="text-[10px] text-muted-foreground truncate">{result.subtitle}</span>
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{result.preview}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {quickAgents.length > 0 && (
                <div className="space-y-1">
                  <p className="px-2 pt-1 text-[10px] font-mono uppercase tracking-[0.2em] text-muted-foreground">Super agentes</p>
                  {quickAgents.map((agent) => (
                  <button
                    key={agent.id}
                    onClick={() => handleAgentSelect(agent)}
                    className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-left hover:bg-secondary/60 transition-colors duration-150"
                  >
                    <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-primary/80 to-primary/40 flex items-center justify-center shrink-0">
                      <Bot className="h-3.5 w-3.5 text-foreground" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm text-foreground truncate">{agent.name}</p>
                      <p className="text-[10px] font-mono text-muted-foreground truncate">{agent.id} · {agent.model}</p>
                    </div>
                  </button>
                ))}
                </div>
              )}

              {loading && (
                <div className="p-6 text-center text-sm text-muted-foreground">Buscando no histórico...</div>
              )}

              {query.trim().length >= 2 && !loading && results.length === 0 && quickAgents.length === 0 && (
                <div className="p-6 text-center text-sm text-muted-foreground">
                  Nenhuma mensagem encontrada nas conversas e canais com acesso.
                </div>
              )}

              {!query.trim() && (
                <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
                  <MessageSquare className="h-4 w-4" />
                  Digite pelo menos 2 caracteres para pesquisar em todo o chat.
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
