import { api } from "@/lib/api";
import { assinarTabela } from "@/lib/realtime";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { getAgentEmoji, getOfficialAgentEntries } from "@/lib/active-agents";
import {
  BookOpen,
  Check,
  Loader2,
  MessageSquare,
  Radio,
  Search,
  Send,
  Sparkles,
  Terminal,
  TerminalSquare,
  UserPlus,
  X,
  Zap,
} from "lucide-react";

type Activity = {
  id: string;
  agent_id: string;
  agent_name: string;
  agent_emoji: string | null;
  event_type: string;
  tool_name: string | null;
  detail: string;
  status: string;
  session_key: string | null;
  timestamp: string;
};

// Filters and emoji come from the runtime agent catalog (agent_profiles).

function actionIcon(a: Activity) {
  const key = (a.tool_name || a.event_type || "").toLowerCase();
  switch (key) {
    case "read":
      return <BookOpen className="h-3.5 w-3.5" />;
    case "exec":
      return <Zap className="h-3.5 w-3.5" />;
    case "web_search":
      return <Search className="h-3.5 w-3.5" />;
    case "sessions_spawn":
    case "delegation":
      return <UserPlus className="h-3.5 w-3.5" />;
    case "sessions_send":
      return <Send className="h-3.5 w-3.5" />;
    case "thinking":
      return <Sparkles className="h-3.5 w-3.5" />;
    case "reply":
      return <MessageSquare className="h-3.5 w-3.5" />;
    case "heartbeat":
      return <Radio className="h-3.5 w-3.5" />;
    default:
      return <Terminal className="h-3.5 w-3.5" />;
  }
}

function relativeTime(iso: string, now: number) {
  const diff = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
  if (diff < 5) return "agora";
  if (diff < 60) return `há ${diff}s`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `há ${m}min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `há ${h}h`;
  const d = Math.floor(h / 24);
  return `há ${d}d`;
}

function absoluteTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString("pt-BR", { hour12: false });
}

interface AgentActivityFeedProps {
  className?: string;
  maxItems?: number;
}

export function AgentActivityFeed({ className, maxItems = 100 }: AgentActivityFeedProps) {
  useAgentCatalog();
  const AGENT_FILTERS = getOfficialAgentEntries().map((e) => ({
    id: e.id,
    label: e.name || e.id,
    emoji: e.emoji || "🤖",
  }));
  const [items, setItems] = useState<Activity[]>([]);
  const [filter, setFilter] = useState<string>("all");
  const [now, setNow] = useState<number>(() => Date.now());
  const [connected, setConnected] = useState(false);
  const capRef = useRef(maxItems);
  capRef.current = maxItems;

  const refetch = async () => {
    const data = await api<Activity[]>("/agents/atividades/registro").catch(() => null);
    if (data) {
      setItems((prev) => {
        const map = new Map<string, Activity>();
        for (const row of data as Activity[]) map.set(row.id, row);
        for (const row of prev) if (!map.has(row.id)) map.set(row.id, row);
        return Array.from(map.values())
          .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, capRef.current);
      });
    }
  };

  useEffect(() => {
    let mounted = true;
    (async () => {
      if (mounted) await refetch();
    })();

    // `refetch` já mescla por id e ordena, então recarregar dá no mesmo que o
    // append incremental que havia aqui — e não depende do evento carregar a
    // linha, que ele deliberadamente não carrega.
    const cancelar = assinarTabela("agent_activity_log", () => { void refetch(); });
    setConnected(true);

    const tick = setInterval(() => setNow(Date.now()), 15000);

    return () => {
      mounted = false;
      clearInterval(tick);
      cancelar();
      setConnected(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    if (filter === "all") return items;
    return items.filter((i) => i.agent_id === filter);
  }, [items, filter]);

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border border-border/50 bg-card/40 backdrop-blur-xl shadow-lg",
        className
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/50 px-3 py-2">
        <TerminalSquare className="h-4 w-4 text-primary" />
        <span className="text-sm font-semibold">Atividade dos agentes</span>
        <span
          className={cn(
            "ml-auto flex items-center gap-1.5 text-[10px] uppercase tracking-wide",
            connected ? "text-emerald-500" : "text-muted-foreground"
          )}
        >
          <span
            className={cn(
              "h-1.5 w-1.5 rounded-full",
              connected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground/50"
            )}
          />
          {connected ? "ao vivo" : "conectando"}
        </span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-border/50 px-3 py-2">
        <FilterPill active={filter === "all"} onClick={() => setFilter("all")}>
          Todos
        </FilterPill>
        {AGENT_FILTERS.map((a) => (
          <FilterPill
            key={a.id}
            active={filter === a.id}
            onClick={() => setFilter(a.id)}
          >
            <span>{a.emoji}</span>
            <span>{a.label}</span>
          </FilterPill>
        ))}
      </div>

      <ul className="scrollbar-thin flex-1 divide-y divide-border/40 overflow-y-auto">
        {filtered.length === 0 ? (
          <li className="flex flex-col items-center justify-center gap-2 px-4 py-10 text-center text-muted-foreground">
            <TerminalSquare className="h-6 w-6 animate-pulse" />
            <span className="text-sm">Nenhuma atividade ainda</span>
          </li>
        ) : (
          filtered.map((a) => (
            <li
              key={a.id}
              className="flex items-start gap-3 px-3 py-2 text-sm animate-in fade-in slide-in-from-top-2 duration-200"
            >
              <span
                className="mt-0.5 font-mono text-[11px] text-muted-foreground shrink-0 w-14"
                title={absoluteTime(a.timestamp)}
              >
                {relativeTime(a.timestamp, now)}
              </span>

              <span className="shrink-0 text-base leading-none">
                {a.agent_emoji || getAgentEmoji(a.agent_id)}
              </span>

              <span className="shrink-0 font-medium">{a.agent_name}</span>

              <span
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px]",
                  a.status === "running" &&
                    "border-primary/40 text-primary bg-primary/10",
                  a.status === "done" &&
                    "border-emerald-500/40 text-emerald-500 bg-emerald-500/10",
                  a.status === "error" &&
                    "border-destructive/40 text-destructive bg-destructive/10"
                )}
              >
                {actionIcon(a)}
                <span className="font-mono">
                  {a.tool_name || a.event_type}
                </span>
              </span>

              <span className="flex-1 text-foreground/90 break-words">
                {a.detail}
              </span>

              <span className="shrink-0 mt-0.5">
                {a.status === "running" && (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                )}
                {a.status === "done" && (
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                )}
                {a.status === "error" && (
                  <X className="h-3.5 w-3.5 text-destructive" />
                )}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors",
        active
          ? "bg-primary/15 border-primary/40 text-primary"
          : "border-border/40 text-muted-foreground hover:text-foreground hover:border-border"
      )}
    >
      {children}
    </button>
  );
}

export default AgentActivityFeed;
