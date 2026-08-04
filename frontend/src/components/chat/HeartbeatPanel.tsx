import React, { useEffect, useRef, useState } from "react";
import { CHAT_HEARTBEAT_EVENT, type ChatHeartbeatDetail } from "@/lib/chat-sender";
import { cn } from "@/lib/utils";
import { AlertTriangle } from "lucide-react";

interface Heartbeat {
  id: string;
  content: string;
  timestamp: string;
  receivedAt: number;
}

interface HeartbeatPanelProps {
  agentId: string;
  /** Only render when true (long-task placeholder is visible). */
  active: boolean;
}

/** Per-agent in-memory store so heartbeats persist across component remounts. */
const store = new Map<string, Heartbeat[]>();

function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `há ${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  return rs > 0 ? `há ${m}min ${rs}s` : `há ${m}min`;
}

function livenessColor(elapsedMs: number): { dot: string; label: string; warn: boolean } {
  const min = elapsedMs / 60_000;
  if (min < 3) return { dot: "bg-emerald-500", label: "🟢", warn: false };
  if (min < 5) return { dot: "bg-amber-500", label: "🟡", warn: true };
  return { dot: "bg-red-500", label: "🔴", warn: true };
}

const HeartbeatPanel = React.memo(function HeartbeatPanel({ agentId, active }: HeartbeatPanelProps) {
  const [beats, setBeats] = useState<Heartbeat[]>(() => store.get(agentId) ?? []);
  const [now, setNow] = useState(() => Date.now());
  const activeRef = useRef(active);
  activeRef.current = active;

  // Listen for heartbeat events.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<ChatHeartbeatDetail>).detail;
      if (detail.agentId !== agentId) return;
      if (detail.reset || detail.heartbeat === null) {
        store.delete(agentId);
        setBeats([]);
        if (!detail.heartbeat) return;
      }
      if (detail.heartbeat) {
        const hb: Heartbeat = { ...detail.heartbeat, receivedAt: Date.now() };
        setBeats((prev) => {
          if (prev.some((b) => b.id === hb.id)) return prev;
          const next = [...prev, hb].slice(-8);
          store.set(agentId, next);
          return next;
        });
      }
    };
    window.addEventListener(CHAT_HEARTBEAT_EVENT, handler);
    return () => window.removeEventListener(CHAT_HEARTBEAT_EVENT, handler);
  }, [agentId]);

  // Tick for liveness label (every 5s).
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(id);
  }, [active]);

  // Clear when the panel is no longer active for a while (task ended without explicit reset).
  useEffect(() => {
    if (active) return;
    const id = setTimeout(() => {
      store.delete(agentId);
      setBeats([]);
    }, 2000);
    return () => clearTimeout(id);
  }, [active, agentId]);

  if (!active) return null;
  if (beats.length === 0) return null;

  const last = beats[beats.length - 1];
  const elapsed = now - last.receivedAt;
  const live = livenessColor(elapsed);

  return (
    <div className="pl-11 md:pl-12 mt-2 flex flex-col gap-1.5">
      <div className="rounded-lg border border-border/30 bg-secondary/20 backdrop-blur-sm px-3 py-2 space-y-1 max-w-[85%] md:max-w-[70%]">
        {beats.map((b) => (
          <div
            key={b.id}
            className="text-xs text-foreground/85 leading-snug animate-in fade-in slide-in-from-bottom-1 duration-300"
          >
            {b.content}
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", live.dot, elapsed < 180_000 && "animate-pulse")} />
        <span>
          Última atualização: {formatAgo(elapsed)}
        </span>
        {live.warn && elapsed > 300_000 && (
          <span className="inline-flex items-center gap-1 text-red-500 ml-1">
            <AlertTriangle className="h-3 w-3" />
            O agente pode ter travado.
          </span>
        )}
      </div>
    </div>
  );
});

export default HeartbeatPanel;
