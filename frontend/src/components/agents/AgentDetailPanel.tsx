import { api } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  X, Bot, Zap, MessageSquare, CheckCircle2, DollarSign, ExternalLink, AlertCircle,
  Send, Slack, Phone, Plug, Wrench, Settings2,
  Clock, Calendar, FileText, ClipboardList, Layout, Share2, MoreVertical, Plus, Trash2, Edit3, Play, AlertTriangle,
  User, Hash, Volume2, Mic2, Theater, FolderOpen, ChevronRight, Loader2, TrendingUp, TrendingDown, Users, Crown, Link2,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import StatCard from "@/components/dashboard/StatCard";
import { getAgentDisplayNameById, normalizeAgentId, getModelForAgent } from "@/lib/active-agents";
import type { GatewayAgent, ChannelConfig, AgentTool } from "@/hooks/use-agents";
import { useAgents } from "@/hooks/use-agents";
import { useAgentAvatar } from "@/hooks/use-agent-avatar";
import { useAgentResults, type AgentResult } from "@/hooks/use-agent-results";
import { useAgentCrons, type AgentCron } from "@/hooks/use-agent-crons";
import AgentGuardrails from "./AgentGuardrails";
import {
  getPricingFor, getModelLabel, getContextWindowFor, formatPricingNote, formatTokensShort,
} from "@/lib/model-pricing";

interface Props {
  agent?: GatewayAgent;
  agentId?: string;
  avatar?: string | null;
  onClose?: () => void;
  fullWidth?: boolean;
}

/* ── Profile (agent_profiles) ────────────────────────── */

interface AgentProfile {
  avatar_url: string | null;
  department: string | null;
  role: string | null;
  description: string | null;
  is_leader: boolean;
  leader_id: string | null;
  leader_name: string | null;
  leader_emoji: string | null;
}

function useAgentProfile(shortId: string) {
  const [data, setData] = useState<AgentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    (async () => {
      let prof: any = null;
      let err: Error | null = null;
      try {
        prof = await api<any>(`/agents/${encodeURIComponent(shortId)}`);
      } catch (e) {
        err = e as Error;
      }
      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }
      let leader_name: string | null = null;
      let leader_emoji: string | null = null;
      if (prof?.leader_id) {
        const lead = await api<any>(
          `/agents/${encodeURIComponent(prof.leader_id)}`,
        ).catch(() => null);
        leader_name = lead?.name ?? null;
        leader_emoji = lead?.emoji ?? null;
      }
      setData({
        avatar_url: prof?.avatar_url ?? null,
        department: prof?.department ?? null,
        role: prof?.role ?? null,
        description: prof?.description ?? null,
        is_leader: !!prof?.is_leader,
        leader_id: prof?.leader_id ?? null,
        leader_name,
        leader_emoji,
      });
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [shortId]);

  return { data, loading, error };
}

/* ── Consumo de hoje/ontem, MEDIDO (task #19) ──
 *
 * Antes vinha de agent_token_snapshots — tabela alimentada por relato de
 * agente, que ninguém preenchia de forma medida — e o custo saía de uma
 * tabela de preços local. Agora vem de usage_events: cada linha é uma chamada
 * de LLM real, com o custo já calculado pelo preço do modelo certo.
 *
 * A conta também mudou de forma: os snapshots eram acumulados (por isso o
 * max−min), os eventos são o consumo em si — soma. O jeito antigo descartava
 * silenciosamente a primeira medição de cada dia.
 */

interface TodayStats {
  tokensToday: number;
  inputToday: number;
  outputToday: number;
  costToday: number;
  tokensYesterday: number;
  costYesterday: number;
  model: string | null;
}

function useAgentStats(shortId: string) {
  const [data, setData] = useState<TodayStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);

      const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
      const startOfYesterday = new Date(startOfToday.getTime() - 24 * 60 * 60 * 1000);

      const { data: rows, error: err } = await api<any[]>(
        `/agents/${encodeURIComponent(shortId)}/consumo` +
          `?desde=${encodeURIComponent(startOfYesterday.toISOString())}`,
      ).then((d) => ({ data: d, error: null as Error | null }),
             (e: Error) => ({ data: null, error: e }));

      if (cancelled) return;
      if (err) { setError(err.message); setLoading(false); return; }

      const all = (rows ?? []) as any[];
      const today = all.filter((r) => new Date(r.ts) >= startOfToday);
      const yesterday = all.filter((r) => {
        const t = new Date(r.ts);
        return t >= startOfYesterday && t < startOfToday;
      });
      const somar = (rs: any[], campo: string) =>
        rs.reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);

      const model =
        [...all].reverse().find((r) => r.model)?.model ?? null;

      const tokensToday = somar(today, "total_tokens");
      const inputToday  = somar(today, "input_tokens");
      const outputToday = somar(today, "output_tokens");
      // Custo já calculado no banco com o preço do modelo real.
      const costToday = somar(today, "cost_usd");
      const tokensYesterday = somar(yesterday, "total_tokens");
      const costYesterday = somar(yesterday, "cost_usd");

      setData({
        tokensToday, inputToday, outputToday, costToday,
        tokensYesterday, costYesterday, model,
      });
      setLoading(false);
    };

    load();

    // ⚠️ Sem tempo real aqui, de propósito. `usage_events` não tem trigger de
    // notificação: recebe escrita em lote pela varredura de uso, e um evento por
    // linha faria tempestade. O consumo atualiza ao abrir o painel.
    return () => {
      cancelled = true;
    };
  }, [shortId]);

  return { data, loading, error };
}

/* ── agent_stats meta (sessions, last activity, top_sessions) ── */

interface AgentMeta {
  session_count: number | null;
  latest_updated_at: string | null;
  top_sessions: any[] | null;
  model: string | null;
}

function useAgentMeta(shortId: string) {
  const [data, setData] = useState<AgentMeta | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api<any>(`/agents/${encodeURIComponent(shortId)}/estatisticas`)
      .then((d) => ({ data: d, error: null }), (e: Error) => ({ data: null, error: e }))
      .then(({ data, error }: any) => {
        if (cancelled) return;
        if (error) setError(error.message);
        else {
          const ts = Array.isArray(data?.top_sessions) ? data.top_sessions : [];
          setData({
            session_count: data?.session_count ?? null,
            latest_updated_at: data?.latest_updated_at ?? null,
            top_sessions: ts,
            model: data?.model ?? null,
          });
        }
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [shortId]);

  return { data, loading, error };
}

/* ── Delta vs yesterday helper ── */

function pctChange(today: number, yesterday: number): number | null {
  if (!yesterday || yesterday <= 0) return null;
  return Math.round(((today - yesterday) / yesterday) * 100);
}

function DeltaPill({ pct }: { pct: number | null }) {
  if (pct === null || pct === 0) return null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span
      className={`inline-flex items-center gap-0.5 text-[9px] font-mono mt-1 ${
        up ? "text-success" : "text-destructive"
      }`}
    >
      <Icon className="h-2.5 w-2.5" />
      {Math.abs(pct)}% vs ontem
    </span>
  );
}

/* ── Live status derivation from latest_updated_at ── */

type LiveStatus = "online" | "recent" | "offline";

function liveStatusFrom(latest: string | null): LiveStatus {
  if (!latest) return "offline";
  const diff = Date.now() - new Date(latest).getTime();
  if (diff < 5 * 60 * 1000) return "online";
  if (diff < 30 * 60 * 1000) return "recent";
  return "offline";
}

/* ── Tasks completed today (agent_results) ───────────── */

function useTasksTodayCount(shortId: string) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    api<{ count: number }>(
      `/agents/resultados?apenas_contagem=true&agent_id=${encodeURIComponent(shortId)}` +
        `&desde=${encodeURIComponent(startOfDay.toISOString())}`,
    )
      .then(({ count }) => {
        if (cancelled) return;
        setCount(count ?? 0);
        setLoading(false);
      })
      .catch((e: Error) => {
        if (cancelled) return;
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [shortId]);

  return { count, loading, error };
}

/* ── Formatters ──────────────────────────────────────── */

const fmtMoney = (n: number) => `$${n.toFixed(2)}`;
const fmtTokens = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : `${n}`);

/* ── Initials avatar ─────────────────────────────────── */

function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? "")
    .join("") || "?";
}

/* ── Component ───────────────────────────────────────── */

export default function AgentDetailPanel({ agent: agentProp, agentId, avatar: avatarProp, onClose, fullWidth }: Props) {
  const navigate = useNavigate();
  const { agents } = useAgents();
  const resolvedAgent =
    agentProp ??
    (agentId
      ? agents.find((a) => a.id === agentId || normalizeAgentId(a.id) === normalizeAgentId(agentId))
      : undefined);
  const fallbackId = agentId ?? agentProp?.id ?? "";
  const shortId = normalizeAgentId(resolvedAgent?.id ?? fallbackId);
  const displayName = getAgentDisplayNameById(resolvedAgent?.id ?? fallbackId, resolvedAgent?.name);
  const isActive = resolvedAgent?.status === "active";

  const profile = useAgentProfile(shortId);
  const stats = useAgentStats(shortId);
  const meta = useAgentMeta(shortId);
  const tasks = useTasksTodayCount(shortId);
  const { avatar: avatarFromHook } = useAgentAvatar(shortId);

  const detectedModel = stats.data?.model ?? meta.data?.model ?? null;
  const live = liveStatusFrom(meta.data?.latest_updated_at ?? null);
  const liveColor =
    live === "online" ? "bg-success" : live === "recent" ? "bg-warning" : "bg-muted-foreground";
  const liveBorder =
    live === "online" ? "hsl(160 84% 39%)" : live === "recent" ? "hsl(38 92% 50%)" : "hsl(0 0% 25%)";

  const avatarUrl = avatarFromHook ?? avatarProp ?? profile.data?.avatar_url ?? null;
  const department = profile.data?.department;

  if (!resolvedAgent) {
    return (
      <div className={fullWidth ? "p-6" : "absolute inset-y-0 right-0 w-[420px] z-30 p-6"}>
        <div className="glass-card p-12 text-center">
          <Bot className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">Carregando agente…</p>
        </div>
      </div>
    );
  }

  // Provide a non-null agent reference for the rest of the component
  const agent = resolvedAgent;

  const containerCls = fullWidth
    ? "w-full flex flex-col rounded-2xl overflow-hidden"
    : "absolute inset-y-0 right-0 w-[420px] z-30 animate-slide-in-right backdrop-blur-2xl border-l border-border flex flex-col rounded-l-2xl overflow-hidden";

  return (
    <div
      className={containerCls}
      style={fullWidth ? undefined : { background: "hsl(0 0% 6% / 0.95)" }}
    >
      {/* Top bar */}
      {!fullWidth && (
        <div className="p-4 border-b border-border/50 flex items-center justify-between shrink-0">
          <h3 className="text-sm font-display font-bold text-foreground">Agent Intel</h3>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-xl bg-secondary/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* ── HEADER ── */}
        <section className="glass-card-glow rounded-2xl p-4 relative">
          <div className="glass-card-glow-effect" />
          <div className="relative z-10 flex items-start gap-3">
            {/* Avatar */}
            <div className="relative shrink-0">
              {profile.loading ? (
                <Skeleton className="h-16 w-16 rounded-2xl" />
              ) : avatarUrl ? (
                <div
                  className="h-16 w-16 rounded-2xl overflow-hidden border-2 bg-gradient-to-br from-card to-secondary"
                  style={{
                    borderColor: isActive ? "hsl(160 84% 39%)" : agent.status === "inactive" ? "hsl(0 0% 25%)" : "hsl(38 92% 50%)",
                    boxShadow: isActive ? "0 0 20px hsl(160 84% 39% / 0.3)" : "none",
                  }}
                >
                  <img src={avatarUrl} alt={displayName} className="w-full h-full object-cover" />
                </div>
              ) : (
                <div
                  className="h-16 w-16 rounded-2xl flex items-center justify-center border-2 text-foreground font-display font-bold text-lg bg-gradient-to-br from-primary/40 to-primary/10"
                  style={{
                    borderColor: isActive ? "hsl(160 84% 39%)" : agent.status === "inactive" ? "hsl(0 0% 25%)" : "hsl(38 92% 50%)",
                  }}
                >
                  {initialsOf(displayName)}
                </div>
              )}
              <div
                className={`absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full border-2 border-card ${liveColor}`}
                title={live === "online" ? "Online" : live === "recent" ? "Recente" : "Offline"}
              />
            </div>

            {/* Identity */}
            <div className="flex-1 min-w-0">
              <h4 className="text-base font-display font-bold text-foreground truncate">{displayName}</h4>
              {profile.loading ? (
                <Skeleton className="h-3 w-40 mt-1" />
              ) : profile.data?.description ? (
                <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2 leading-snug">
                  {profile.data.description}
                </p>
              ) : profile.data?.role ? (
                <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{profile.data.role}</p>
              ) : null}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-[hsl(260_70%_55%/0.15)] text-[hsl(260_85%_75%)] border border-[hsl(260_70%_55%/0.35)]">
                  {getModelLabel(detectedModel ?? getModelForAgent(shortId))}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  · Última atividade: {relTime(meta.data?.latest_updated_at)}
                </span>
              </div>

              <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                {/* Department chip */}
                {profile.loading ? (
                  <Skeleton className="h-5 w-24 rounded-lg" />
                ) : profile.error ? (
                  <span className="text-[10px] text-destructive flex items-center gap-1">
                    <AlertCircle className="h-3 w-3" /> dpt indisponível
                  </span>
                ) : department ? (
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-lg bg-primary/15 text-primary border border-primary/30">
                    {department}
                  </span>
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">Sem departamento</span>
                )}

                {/* Live status */}
                <span
                  className={`inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg ${
                    live === "online"
                      ? "bg-success/15 text-success"
                      : live === "recent"
                      ? "bg-warning/15 text-warning"
                      : "bg-muted/50 text-muted-foreground"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${liveColor}`} />
                  {live === "online" ? "ONLINE" : live === "recent" ? "RECENTE" : "OFFLINE"}
                </span>

                {/* Leadership */}
                {profile.data?.is_leader ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2 py-0.5 rounded-lg bg-primary/15 text-primary border border-primary/30"
                    title="Agente orquestrador"
                  >
                    <Crown className="h-3 w-3" /> ORQUESTRADOR
                  </span>
                ) : profile.data?.leader_id ? (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-mono font-medium px-2 py-0.5 rounded-lg bg-muted/50 text-muted-foreground border border-border/50"
                    title={`Orquestrado por ${profile.data.leader_name ?? profile.data.leader_id}`}
                  >
                    <Link2 className="h-3 w-3" />
                    {profile.data.leader_emoji ?? ""} @{profile.data.leader_id}
                  </span>
                ) : null}
              </div>

              {/* Header actions */}
              <div className="flex items-center gap-1.5 mt-2.5">
                <button
                  onClick={() => navigate(`/chat?agent=${encodeURIComponent(shortId)}`)}
                  className="flex items-center gap-1 text-[10px] font-semibold px-2.5 py-1 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                >
                  <MessageSquare className="h-3 w-3" /> Abrir Chat
                </button>
                <button
                  onClick={() => navigate(`/agents/${encodeURIComponent(agent.id)}?tab=settings`)}
                  className="flex items-center gap-1 text-[10px] font-medium px-2.5 py-1 rounded-lg bg-secondary/60 text-foreground hover:bg-secondary transition-colors"
                >
                  <Edit3 className="h-3 w-3" /> Editar
                </button>
              </div>
            </div>
          </div>
        </section>

        {/* ── METRICS ROW ── */}
        <section className="grid grid-cols-2 gap-2">
          {/* Cost today */}
          {stats.loading ? (
            <Skeleton className="h-[88px] rounded-2xl" />
          ) : stats.error ? (
            <ErrorCard label="Custo hoje" />
          ) : (
            <DeltaStatCard
              label="Custo hoje"
              value={`$${(stats.data?.costToday ?? 0).toFixed(2)}`}
              icon={DollarSign}
              gradient="bg-gradient-to-br from-primary/30 to-primary/10"
              pct={pctChange(stats.data?.costToday ?? 0, stats.data?.costYesterday ?? 0)}
            />
          )}

          {/* Tokens today */}
          {stats.loading ? (
            <Skeleton className="h-[88px] rounded-2xl" />
          ) : stats.error ? (
            <ErrorCard label="Tokens hoje" />
          ) : (
            <DeltaStatCard
              label="Tokens hoje"
              value={formatTokensShort(stats.data?.tokensToday ?? 0)}
              icon={Zap}
              gradient="bg-gradient-to-br from-primary/30 to-primary/10"
              pct={pctChange(stats.data?.tokensToday ?? 0, stats.data?.tokensYesterday ?? 0)}
            />
          )}

          {/* Tasks completed today */}
          {tasks.loading ? (
            <Skeleton className="h-[88px] rounded-2xl" />
          ) : tasks.error ? (
            <ErrorCard label="Tarefas hoje" />
          ) : (
            <StatCard
              label="Tarefas hoje"
              value={String(tasks.count ?? 0)}
              icon={CheckCircle2}
              gradient="bg-gradient-to-br from-success/30 to-success/10"
            />
          )}

          {/* Sessions (from agent_stats) */}
          {meta.loading ? (
            <Skeleton className="h-[88px] rounded-2xl" />
          ) : meta.error ? (
            <ErrorCard label="Sessões" />
          ) : (
            <StatCard
              label="Sessões"
              value={meta.data?.session_count != null ? String(meta.data.session_count) : "—"}
              icon={MessageSquare}
              gradient="bg-gradient-to-br from-primary/30 to-primary/10"
            />
          )}
        </section>

        {/* ── USAGE & COST ── */}
        <UsageCostCard agentId={shortId} />

        {/* ── SKILLS (full width) ── */}
        <SkillsListCard agentId={shortId} />

        {/* ── GUARDRAILS (full width) ── */}
        <AgentGuardrails agentId={shortId} />

        {/* ── INTEGRATIONS + TOOLS (2-col) ── */}
        <section className="grid grid-cols-2 gap-2">
          <IntegrationsCard agentId={shortId} />
          <SkillsCard agentId={shortId} />
        </section>

        {/* ── CRON JOBS + RECENT SESSIONS (2-col) ── */}
        <section className="grid grid-cols-2 gap-2">
          <CronsCard agentId={shortId} />
          <SessionsCard agent={agent} />
        </section>

        {/* ── RECENT USERS (top_sessions) ── */}
        <RecentUsersSection topSessions={meta.data?.top_sessions ?? []} loading={meta.loading} error={meta.error} />

        {/* ── COMPLETED TASKS FEED (full width) ── */}
        <ResultsFeed agentId={shortId} />

        {/* ── VOZ — pausada em 10/08/2026 junto com a integração ElevenLabs.
             O card escolhia a voz do agente e testava o TTS. A função
             `VoiceSection` continua abaixo, sem ser montada, para voltar ser
             descomentar esta linha. Ver `docs/EM-CONSTRUCAO.md`. ── */}
        {/* <VoiceSection agentId={shortId} /> */}

        {/* ── WORKSPACE ── */}
      </div>
    </div>
  );
}

/* ── Small error stat card ───────────────────────────── */

function ErrorCard({ label }: { label: string }) {
  return (
    <div className="glass-card p-3 md:p-5 space-y-2 rounded-2xl">
      <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</p>
      <p className="text-xs text-destructive flex items-center gap-1">
        <AlertCircle className="h-3 w-3 shrink-0" /> indisponível
      </p>
    </div>
  );
}

/* ── Integrations & Tools from agent_integrations ─────── */

interface AgentIntegrationRow {
  id: string;
  name: string;
  type: string | null;
  status: string | null;
  config: any;
  description: string | null;
}

function useAgentIntegrationsTable(agentId: string, typeFilter?: string) {
  const [rows, setRows] = useState<AgentIntegrationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      const data = await api<AgentIntegrationRow[]>(
        `/agents/${encodeURIComponent(agentId)}/integracoes` +
          (typeFilter ? `?tipo=${encodeURIComponent(typeFilter)}` : ""),
      ).catch(() => null);
      if (!cancelled) {
        setRows((data ?? []) as AgentIntegrationRow[]);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId, typeFilter]);

  return { rows, loading };
}

function statusDotClass(status: string | null) {
  const s = (status || "").toLowerCase();
  if (s === "active") return "bg-success shadow-[0_0_6px_hsl(160_84%_39%_/_0.6)]";
  if (s === "error") return "bg-destructive shadow-[0_0_6px_hsl(0_84%_60%_/_0.6)]";
  return "bg-yellow-500 shadow-[0_0_6px_hsl(45_93%_47%_/_0.5)]";
}

function typeBadge(type: string | null) {
  const t = (type || "").toLowerCase();
  const isMcp = t === "mcp";
  return (
    <span
      className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border ${
        isMcp
          ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
          : "bg-primary/15 text-primary border-primary/30"
      }`}
    >
      {isMcp ? "MCP" : "API"}
    </span>
  );
}

function IntegrationsCard({ agentId }: { agentId: string }) {
  const { rows, loading } = useAgentIntegrationsTable(agentId, "channel");

  return (
    <div className="glass-card rounded-2xl p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <MessageSquare className="h-3 w-3 text-primary" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Integrações</p>
      </div>
      {loading ? (
        <p className="text-[10px] text-muted-foreground italic">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Nenhum canal configurado</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDotClass(r.status)}`} />
              <span className="flex-1 truncate text-foreground">{r.name}</span>
              {(r.status || "").toLowerCase() === "error" && (
                <button className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-destructive/15 text-destructive border border-destructive/30 hover:bg-destructive/25 transition-colors">
                  Corrigir
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillsCard({ agentId }: { agentId: string }) {
  const { rows, loading } = useAgentIntegrationsTable(agentId, "tool");

  return (
    <div className="glass-card rounded-2xl p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <Wrench className="h-3 w-3 text-primary" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Ferramentas & APIs</p>
      </div>
      {loading ? (
        <p className="text-[10px] text-muted-foreground italic">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Nenhuma ferramenta configurada</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((r) => (
            <div key={r.id} className="flex items-center gap-2 text-[11px]">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${statusDotClass(r.status)}`} />
              <span className="flex-1 truncate text-foreground">{r.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SkillsListCard({ agentId }: { agentId: string }) {
  const { rows, loading } = useAgentIntegrationsTable(agentId, "skill");

  useEffect(() => {
    if (!loading) {
      console.log(`[Skills] agentId=${agentId} → ${rows.length} skills carregadas`);
    }
  }, [agentId, loading, rows.length]);

  return (
    <div className="glass-card rounded-2xl p-3">
      <div className="flex items-center gap-1.5 mb-2">
        <Zap className="h-3 w-3 text-primary" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Skills</p>
      </div>
      {loading ? (
        <p className="text-[10px] text-muted-foreground italic">Carregando…</p>
      ) : rows.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Nenhuma skill configurada</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {rows.map((r) => (
            <span
              key={r.id}
              title={r.description || undefined}
              className="text-[11px] px-2 py-1 rounded-md bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15 transition-colors cursor-default"
            >
              {r.name}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}


function relTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return formatDistanceToNow(new Date(iso), { addSuffix: true, locale: ptBR });
  } catch {
    return "—";
  }
}

function describeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [min, hour, dom, mon, dow] = parts;
  const hh = (h: string, m: string) =>
    `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
  // daily at H:M
  if (dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(hour) && /^\d+$/.test(min))
    return `Todos os dias às ${hh(hour, min)}`;
  // hourly
  if (hour === "*" && dom === "*" && mon === "*" && dow === "*" && /^\d+$/.test(min))
    return `A cada hora aos ${min} min`;
  // every N minutes
  if (/^\*\/\d+$/.test(min) && hour === "*" && dom === "*" && mon === "*" && dow === "*")
    return `A cada ${min.slice(2)} minutos`;
  // weekly
  if (dom === "*" && mon === "*" && /^\d+$/.test(dow) && /^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const days = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
    return `${days[Number(dow) % 7]} às ${hh(hour, min)}`;
  }
  return expr;
}

/* ── Category meta for results feed ──────────────────── */

const CATEGORY_META: Record<string, { Icon: any; label: string; color: string }> = {
  post_published:     { Icon: Share2,        label: "Post",      color: "hsl(199 89% 48%)" },
  task_created:       { Icon: ClipboardList, label: "Tarefa",    color: "hsl(38 92% 50%)" },
  report_generated:   { Icon: FileText,      label: "Relatório", color: "hsl(280 65% 60%)" },
  artifact_published: { Icon: Layout,        label: "Artefato",  color: "hsl(231 100% 62%)" },
  task:               { Icon: CheckCircle2,  label: "Tarefa",    color: "hsl(160 84% 39%)" },
};

function categoryMeta(cat: string | null | undefined) {
  return CATEGORY_META[cat ?? ""] ?? { Icon: CheckCircle2, label: cat ?? "Concluído", color: "hsl(160 84% 39%)" };
}

/* ── Results feed ────────────────────────────────────── */

type FeedItem = {
  id: string;
  title: string;
  description: string | null;
  category: string;
  created_at: string;
};

function useArtifactsFeed(agentId: string) {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      // ⚠️ `artifacts_published` **não tem** coluna `agent_id` — conferido no
      // schema em 07/08. O comentário anterior já suspeitava disso ("best-effort
      // … gracefully fall back to empty"), e a consulta de fato nunca devolveu
      // nada: era um erro engolido a cada abertura do painel.
      //
      // Enquanto não existir vínculo entre artefato publicado e agente, a lista
      // fica vazia — mas agora explicitamente, e não por acidente.
      try {
        const data: any[] = [];
        const error = null;
        if (cancelled) return;
        if (error || !data) {
          setItems([]);
        } else {
          setItems(
            (data as any[]).map((a) => ({
              id: a.id,
              title: a.title ?? "Artefato publicado",
              description: null,
              category: "artifact_published",
              created_at: a.created_at,
            }))
          );
        }
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  return { items, loading };
}

function ResultsFeed({ agentId }: { agentId: string }) {
  const { results, isLoading } = useAgentResults(agentId);
  const artifacts = useArtifactsFeed(agentId);
  const [visible, setVisible] = useState(5);

  const merged: FeedItem[] = useMemo(() => {
    const r: FeedItem[] = (results as AgentResult[]).map((x) => ({
      id: x.id,
      title: x.title,
      description: x.description,
      category: x.category ?? "task",
      created_at: x.created_at,
    }));
    return [...r, ...artifacts.items].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
  }, [results, artifacts.items]);

  const loading = isLoading || artifacts.loading;

  return (
    <section>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Tarefas concluídas</p>
      <div className="glass-card rounded-2xl p-3 space-y-2">
        {loading ? (
          <>
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </>
        ) : merged.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-3 text-center">
            Nenhuma tarefa concluída ainda
          </p>
        ) : (
          <>
            {merged.slice(0, visible).map((it) => {
              const meta = categoryMeta(it.category);
              const Icon = meta.Icon;
              return (
                <div key={it.id} className="flex items-start gap-2.5">
                  <div
                    className="h-8 w-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: `${meta.color}1F`, color: meta.color }}
                  >
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[11px] font-semibold text-foreground truncate flex-1">{it.title}</p>
                      <span className="text-[9px] text-muted-foreground shrink-0">{relTime(it.created_at)}</span>
                    </div>
                    {it.description && (
                      <p className="text-[10px] text-muted-foreground line-clamp-2 leading-snug mt-0.5">
                        {it.description}
                      </p>
                    )}
                    <span
                      className="inline-block mt-1 text-[9px] font-medium px-1.5 py-0.5 rounded-md border"
                      style={{ background: `${meta.color}14`, color: meta.color, borderColor: `${meta.color}40` }}
                    >
                      {meta.label}
                    </span>
                  </div>
                </div>
              );
            })}
            {visible < merged.length && (
              <button
                onClick={() => setVisible((v) => v + 5)}
                className="w-full text-[10px] font-medium text-primary hover:text-primary/80 pt-1"
              >
                Ver mais ({merged.length - visible})
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

/* ── Crons card (read-only from cron_jobs telemetry) ── */

interface CronJobRow {
  id: string;
  name: string | null;
  cron_expression: string | null;
  last_run: string | null;
  next_run: string | null;
  status: string | null;
  enabled: boolean | null;
}

function useGatewayCrons(agentId: string) {
  const [crons, setCrons] = useState<CronJobRow[]>([]);
  const [isLoading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    // ⚠️ Estes são os crons do GATEWAY (tabela `cron_jobs`), não os da
    // plataforma (`agent_crons`). Podem divergir — é para isso que existe o
    // sincronizar-status.
    api<any[]>(`/agents/${encodeURIComponent(agentId)}/agendamentos-do-gateway`)
      .then((d) => ({ data: d }), () => ({ data: [] }))
      .then(({ data }: any) => {
        if (cancelled) return;
        setCrons((data ?? []) as CronJobRow[]);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [agentId]);

  return { crons, isLoading };
}

function statusDot(status: string | null, enabled: boolean | null): string {
  if (enabled === false || status === "disabled") return "bg-muted-foreground/50";
  if (status === "error" || status === "failed") return "bg-destructive shadow-[0_0_6px_hsl(var(--destructive)/0.6)]";
  return "bg-success shadow-[0_0_6px_hsl(160_84%_39%_/_0.6)]";
}

function CronsCard({ agentId }: { agentId: string }) {
  const { crons, isLoading } = useGatewayCrons(agentId);

  return (
    <div className="glass-card rounded-2xl p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <Clock className="h-3 w-3 text-primary" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">Cron jobs</p>
        <button
          disabled
          title="Gerenciado via gateway"
          className="h-5 w-5 rounded-md bg-secondary/40 text-muted-foreground/60 flex items-center justify-center cursor-not-allowed"
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>

      {isLoading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-full rounded-xl" />
          <Skeleton className="h-8 w-full rounded-xl" />
        </div>
      ) : crons.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Nenhum cron configurado</p>
      ) : (
        <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
          {crons.map((c) => (
            <div key={c.id} className="rounded-xl border border-border/50 bg-card/40 p-2 space-y-1">
              <div className="flex items-start gap-2">
                <span className={`h-1.5 w-1.5 mt-1.5 rounded-full shrink-0 ${statusDot(c.status, c.enabled)}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-foreground truncate">{c.name || c.id}</p>
                  <p className="text-[9px] font-mono text-primary mt-0.5">
                    {c.cron_expression ? describeCron(c.cron_expression) : "—"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-[9px] text-muted-foreground pl-3.5">
                <span className="flex items-center gap-1">
                  <Play className="h-2.5 w-2.5" /> {relTime(c.last_run)}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-2.5 w-2.5" /> {relTime(c.next_run)}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── Recent sessions ─────────────────────────────────── */

interface SessionItem {
  key: string;
  kind: "dm" | "channel";
  label: string;
  preview: string;
  created_at: string;
}

function useRecentSessions(agentId: string) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await api<any[]>(
          `/agents/${encodeURIComponent(agentId)}/atividade-recente`,
        ).catch(() => null);
        if (cancelled) return;
        if (!data) {
          setItems([]);
          setLoading(false);
          return;
        }
        const seen = new Set<string>();
        const distinct: any[] = [];
        for (const r of data) {
          if (!r.user_id || seen.has(r.user_id)) continue;
          seen.add(r.user_id);
          distinct.push(r);
          if (distinct.length >= 3) break;
        }
        const userIds = distinct.map((d) => d.user_id);
        const profiles: Record<string, string> = {};
        if (userIds.length > 0) {
          const { data: ppl } = await api<any[]>("/profiles").then((d) => ({ data: d })).catch(() => ({ data: [] as any[] }));
          (ppl ?? []).forEach((p: any) => {
            profiles[p.id] = p.full_name || (p.email ?? "").split("@")[0] || "Usuário";
          });
        }
        if (cancelled) return;
        setItems(
          distinct.map((r) => ({
            key: r.user_id,
            kind: "dm",
            label: profiles[r.user_id] ?? "Usuário",
            preview: (r.content ?? "").slice(0, 60),
            created_at: r.created_at,
          }))
        );
      } catch {
        if (!cancelled) setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  return { items, loading };
}

function contextColor(pct: number): string {
  if (pct <= 50) return "hsl(160 84% 39%)";
  if (pct <= 70) return "hsl(231 100% 62%)";
  if (pct <= 85) return "hsl(38 92% 50%)";
  return "hsl(0 72% 51%)";
}

function SessionsCard({ agent }: { agent: GatewayAgent }) {
  const shortId = normalizeAgentId(agent.id);
  const { items, loading } = useRecentSessions(shortId);
  const isActive = agent.status === "active";
  const ctxPct = (agent as any).contextPct as number | undefined;
  const showCtx = isActive && typeof ctxPct === "number" && ctxPct > 0;
  const color = showCtx ? contextColor(ctxPct!) : "transparent";

  return (
    <div className="glass-card rounded-2xl p-3 flex flex-col">
      <div className="flex items-center gap-1.5 mb-2">
        <MessageSquare className="h-3 w-3 text-primary" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">Sessões recentes</p>
        <span className="text-[9px] font-mono text-muted-foreground">{agent.sessions}</span>
      </div>

      {showCtx && (
        <div className="mb-2">
          <div className="flex items-center justify-between text-[9px] text-muted-foreground mb-1">
            <span>Contexto</span>
            <span style={{ color }}>{ctxPct}%</span>
          </div>
          <div className="h-1 w-full rounded-full bg-secondary/60 overflow-hidden">
            <div
              className="h-full transition-all"
              style={{ width: `${Math.min(100, ctxPct!)}%`, background: color }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="space-y-1.5">
          <Skeleton className="h-9 w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-xl" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-[10px] text-muted-foreground italic">Nenhuma conversa recente</p>
      ) : (
        <div className="space-y-1.5">
          {items.map((s) => {
            const idleMs = Date.now() - new Date(s.created_at).getTime();
            const idle = idleMs > 6 * 60 * 60 * 1000;
            const Icon = s.kind === "channel" ? Hash : User;
            return (
              <div key={s.key} className="flex items-start gap-2 rounded-xl p-1.5 hover:bg-secondary/40 transition-colors">
                <div className="h-6 w-6 rounded-lg bg-primary/15 text-primary flex items-center justify-center shrink-0">
                  <Icon className="h-3 w-3" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-1">
                    <p className="text-[11px] font-semibold text-foreground truncate flex-1">{s.label}</p>
                    <span className="text-[9px] text-muted-foreground shrink-0">{relTime(s.created_at)}</span>
                  </div>
                  <p className="text-[10px] text-muted-foreground truncate">{s.preview || "—"}</p>
                </div>
                {idle && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-md bg-warning/15 text-warning border border-warning/30 shrink-0">
                    IDLE
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Voz — PAUSADA em 10/08/2026 ─────────────────────────
   O card de voz (escolher voz do agente, testar TTS, aplicar em arenas)
   saiu junto com a integração ElevenLabs. O código está preservado
   abaixo em bloco de comentário porque é curto e vive no meio deste
   arquivo — mover só ele para `_legado/` deixaria um buraco pior de
   entender. Ver `docs/EM-CONSTRUCAO.md`.

/\* ── Voice section (TTS + ConvAI sub-cards) ──────────── *\/

import VoicePicker from "@/components/VoicePicker";
import { setVoiceForAgent, speakText } from "@/lib/elevenlabs";

interface ArenaVoiceRow {
  arena_id: string;
  arena_name: string;
  convai_agent_id: string | null;
}

/\**
 * ⚠️ **Arena pausada em 10/08/2026.** Este hook buscava em quais arenas o agente
 * participa, para o card de voz oferecer "aplicar a mesma voz em todas". Com a
 * Arena fora do ar ele devolve vazio — o card some sozinho, sem `if` espalhado
 * pela tela.
 *
 * O corpo original está no histórico do git e o endpoint
 * `GET /arenas/por-agente/{id}` continua no backend. Para voltar, restaure a
 * busca. Ver `docs/EM-CONSTRUCAO.md`.
 *\/
function useAgentArenas(_agentId: string) {
  return { rows: [] as ArenaVoiceRow[], loading: false };
}

function VoiceSection({ agentId }: { agentId: string }) {
  const [voiceId, setVoiceId] = useState<string | null>(null);
  const [voiceName, setVoiceName] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [syncAllArenas, setSyncAllArenas] = useState(false);
  const arenas = useAgentArenas(agentId);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const data = await api<any>(
          `/agents/${encodeURIComponent(agentId)}`,
        ).catch(() => null);
        if (cancelled) return;
        setVoiceId(data?.tts_voice_id ?? null);
        setVoiceName(data?.tts_voice_name ?? "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [agentId]);

  const handleVoiceChange = async (newId: string | null) => {
    if (!newId) return;
    try {
      await setVoiceForAgent(agentId, { voiceId: newId, voiceName: voiceName || "" });
      setVoiceId(newId);
      toast.success("Voz atualizada");

      if (syncAllArenas && arenas.rows.length > 0) {
        const ids = arenas.rows.map((a) => a.arena_id);
        // Uma chamada por arena: são poucas, e o PUT de arena já existe com a
        // conferência de dono. Um endpoint em lote só para isto não se paga.
        const falhas = (
          await Promise.all(
            ids.map((id) =>
              api(`/arenas/${id}`, { method: "PUT", body: { id, voice_id: newId } })
                .then(() => null, () => id),
            ),
          )
        ).filter(Boolean);
        if (falhas.length === 0) toast.success(`Voz aplicada em ${ids.length} arena(s)`);
        else toast.error(`Falhou em ${falhas.length} de ${ids.length} arena(s)`);
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao salvar voz");
    }
  };

  const handleTest = async () => {
    if (!voiceId) return;
    setTesting(true);
    try {
      const audio = await speakText("Olá, essa é a minha voz.", voiceId);
      audio.onended = () => setTesting(false);
      audio.onerror = () => setTesting(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Falha ao testar voz");
      setTesting(false);
    }
  };

  return (
    <section>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">Voz</p>
      <div className="grid grid-cols-2 gap-2">
        {/\* TTS sub-card *\/}
        <div className="glass-card rounded-2xl p-3 flex flex-col">
          <div className="flex items-center gap-1.5 mb-2">
            <Volume2 className="h-3 w-3 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">TTS · Chat & DMs</p>
            <span
              className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                voiceId ? "bg-success shadow-[0_0_6px_hsl(160_84%_39%_/_0.6)]" : "bg-muted-foreground/40"
              }`}
            />
          </div>
          {loading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : (
            <>
              <div className="text-[11px] mb-2">
                {voiceId ? (
                  <p className="text-foreground">
                    <span className="text-muted-foreground">Voz: </span>
                    <span className="font-mono text-primary">{voiceName || voiceId}</span>
                  </p>
                ) : (
                  <p className="text-muted-foreground italic">Nenhuma voz selecionada</p>
                )}
              </div>
              <div className="max-h-44 overflow-y-auto pr-1 -mr-1">
                <VoicePicker value={voiceId} onChange={handleVoiceChange} />
              </div>
              <button
                onClick={handleTest}
                disabled={!voiceId || testing}
                className="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] font-medium px-2 py-1.5 rounded-xl bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {testing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Testar
              </button>
            </>
          )}
        </div>

        {/\* ConvAI sub-card *\/}
        <div className="glass-card rounded-2xl p-3 flex flex-col">
          <div className="flex items-center gap-1.5 mb-2">
            <Theater className="h-3 w-3 text-primary" />
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground flex-1">ConvAI · Arenas</p>
          </div>
          {arenas.loading ? (
            <Skeleton className="h-16 w-full rounded-xl" />
          ) : arenas.rows.length === 0 ? (
            <p className="text-[10px] text-muted-foreground italic">
              Este agente não está em nenhuma arena com voz ativa
            </p>
          ) : (
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {arenas.rows.map((a) => {
                const ok = !!a.convai_agent_id;
                return (
                  <div key={a.arena_id} className="flex items-center gap-2 text-[11px]">
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        ok ? "bg-success shadow-[0_0_6px_hsl(160_84%_39%_/_0.6)]" : "bg-muted-foreground/40"
                      }`}
                    />
                    <span className="flex-1 truncate text-foreground">{a.arena_name}</span>
                    <a
                      href={`/arenas/${a.arena_id}/settings`}
                      className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25 transition-colors"
                    >
                      Configurar
                    </a>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/\* O "usar a mesma voz em todas as arenas" saiu com a Arena — ver
          `docs/EM-CONSTRUCAO.md`. *\/}
    </section>
  );
}

──────────────────────────────────────────────────────── */


/* ── Usage & Cost (delta over period from agent_token_snapshots) ── */

type UsagePeriod = "today" | "7d" | "30d" | "all";

const PERIOD_LABELS: Record<UsagePeriod, string> = {
  today: "Hoje",
  "7d": "7 dias",
  "30d": "30 dias",
  all: "Desde sempre",
};

function periodSince(p: UsagePeriod): string | null {
  const now = new Date();
  if (p === "today") {
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    return d.toISOString();
  }
  if (p === "7d") return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
  if (p === "30d") return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  return null;
}

function UsageCostCard({ agentId }: { agentId: string }) {
  const [period, setPeriod] = useState<UsagePeriod>("today");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    tokens: number;
    input: number;
    output: number;
    cost: number;
    cacheRead: number;
    model: string | null;
  }>({ tokens: 0, input: 0, output: 0, cost: 0, cacheRead: 0, model: null });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError(null);
      // Medido (task #19): usage_events em vez de agent_token_snapshots.
      const since = periodSince(period);
      const { data: rows, error: err } = await api<any[]>(
        `/agents/${encodeURIComponent(agentId)}/consumo?limite=20000` +
          (since ? `&desde=${encodeURIComponent(since)}` : ""),
      ).then((d) => ({ data: d, error: null as Error | null }),
             (e: Error) => ({ data: null, error: e }));
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      const list = (rows ?? []) as any[];
      if (list.length === 0) {
        setData({ tokens: 0, input: 0, output: 0, cost: 0, cacheRead: 0, model: null });
        setLoading(false);
        return;
      }
      // Soma, não max−min: cada evento JÁ é o consumo daquela chamada.
      const somar = (campo: string) =>
        list.reduce((acc, r) => acc + (Number(r[campo]) || 0), 0);
      const tokens = somar("total_tokens");
      const input = somar("input_tokens");
      const output = somar("output_tokens");
      const cacheRead = somar("cached_tokens");
      // Modelo mais usado no período (não o último visto).
      const porModelo = new Map<string, number>();
      for (const r of list) {
        if (!r.model) continue;
        porModelo.set(r.model, (porModelo.get(r.model) ?? 0) + (Number(r.total_tokens) || 0));
      }
      const model = [...porModelo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      const cost = somar("cost_usd");
      setData({ tokens, input, output, cost, cacheRead, model });
      setLoading(false);
    };
    load();
    // Sem tempo real: `usage_events` não tem trigger de notificação — escreve
    // em lote e um evento por linha faria tempestade. Atualiza ao abrir.
    return () => { cancelled = true; };
  }, [agentId, period]);

  return (
    <section className="glass-card rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <DollarSign className="h-3.5 w-3.5 text-primary" />
          <h5 className="text-xs font-display font-bold text-foreground">Uso & Custo</h5>
          {data.model && (
            <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-md bg-[hsl(260_70%_55%/0.15)] text-[hsl(260_85%_75%)] border border-[hsl(260_70%_55%/0.35)]">
              {getModelLabel(data.model)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 p-0.5 bg-secondary/40 rounded-xl">
          {(Object.keys(PERIOD_LABELS) as UsagePeriod[]).map((p) => {
            const active = p === period;
            return (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                className={`px-2 py-1 text-[10px] font-medium rounded-lg transition-all ${
                  active
                    ? "bg-primary/15 text-primary border border-primary/30"
                    : "text-muted-foreground hover:text-foreground border border-transparent"
                }`}
              >
                {PERIOD_LABELS[p]}
              </button>
            );
          })}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
          <Skeleton className="h-16 rounded-xl" />
        </div>
      ) : error ? (
        <p className="text-[11px] text-destructive flex items-center gap-1">
          <AlertCircle className="h-3 w-3" /> Falha ao carregar uso & custo
        </p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            <UsageStat label="Tokens consumidos" value={formatTokensShort(data.tokens)} icon={Zap} />
            <UsageStat label="Custo estimado" value={`$${data.cost.toFixed(2)}`} icon={DollarSign} />
            <UsageStat label="Modelo em uso" value={getModelLabel(data.model)} icon={Bot} mono />
            <UsageStat label="Cache economizado" value={formatTokensShort(data.cacheRead)} icon={CheckCircle2} />
          </div>
          <p className="text-[10px] text-muted-foreground">
            Input: <span className="font-mono text-foreground">{formatTokensShort(data.input)}</span>
            {" · "}Output: <span className="font-mono text-foreground">{formatTokensShort(data.output)}</span>
            {" · "}Total: <span className="font-mono text-foreground">{formatTokensShort(data.tokens)}</span>
          </p>
        </>
      )}

      <p className="text-[10px] text-muted-foreground italic">
        {formatPricingNote(data.model)}
      </p>
    </section>
  );
}

function UsageStat({
  label, value, icon: Icon, mono,
}: { label: string; value: string; icon: any; mono?: boolean }) {
  return (
    <div className="rounded-xl bg-secondary/30 border border-border/40 p-2.5 space-y-1">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" />
        <span className="truncate">{label}</span>
      </div>
      <p className={`text-sm font-display font-bold text-foreground truncate ${mono ? "font-mono text-[11px]" : ""}`}>
        {value}
      </p>
    </div>
  );
}

/* ── Stat card with delta vs yesterday ───────────────── */

function DeltaStatCard({
  label, value, icon: Icon, gradient, pct,
}: { label: string; value: string; icon: any; gradient: string; pct: number | null }) {
  return (
    <div className="glass-card p-3 md:p-5 rounded-2xl flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider truncate">{label}</p>
        <div className={`h-7 w-7 rounded-xl ${gradient} flex items-center justify-center shrink-0`}>
          <Icon className="h-3.5 w-3.5 text-foreground" />
        </div>
      </div>
      <p className="text-lg md:text-2xl font-display font-bold text-foreground">{value}</p>
      <DeltaPill pct={pct} />
    </div>
  );
}

/* ── Recent users (from agent_stats.top_sessions) ────── */

function RecentUsersSection({
  topSessions, loading, error,
}: { topSessions: any[]; loading: boolean; error: string | null }) {
  type RU = { userId: string; sessionKey: string; lastAt: string | null };
  const users: RU[] = useMemo(() => {
    if (!Array.isArray(topSessions)) return [];
    const seen = new Set<string>();
    const out: RU[] = [];
    for (const s of topSessions) {
      const uid = (s?.userId ?? s?.user_id ?? null) as string | null;
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      out.push({
        userId: uid,
        sessionKey: s?.session ?? s?.sessionId ?? uid,
        lastAt: s?.lastUpdatedAt ?? s?.updatedAt ?? s?.lastActive ?? null,
      });
      if (out.length >= 50) break;
    }
    return out;
  }, [topSessions]);

  const [showAll, setShowAll] = useState(false);
  const [profiles, setProfiles] = useState<Record<string, { name: string; email: string | null; avatar: string | null }>>({});

  useEffect(() => {
    const ids = users.map((u) => u.userId);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const data = await api<any[]>("/profiles").catch(() => null);
      if (cancelled || !data) return;
      const map: Record<string, { name: string; email: string | null; avatar: string | null }> = {};
      for (const p of data as any[]) {
        const name =
          (p.full_name && p.full_name.trim()) ||
          (p.email ? p.email.split("@")[0] : "") ||
          "Usuário";
        map[p.id] = { name, email: p.email ?? null, avatar: p.avatar_url ?? null };
      }
      setProfiles(map);
    })();
    return () => { cancelled = true; };
  }, [users]);

  const visible = showAll ? users : users.slice(0, 5);
  const hasNullOnly = !loading && users.length === 0 && (topSessions?.length ?? 0) > 0;

  return (
    <section>
      <div className="flex items-center gap-1.5 mb-2">
        <Users className="h-3 w-3 text-primary" />
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Usuários recentes</p>
      </div>
      <div className="glass-card rounded-2xl p-3 space-y-2">
        {loading ? (
          <>
            <Skeleton className="h-9 w-full rounded-xl" />
            <Skeleton className="h-9 w-full rounded-xl" />
          </>
        ) : error ? (
          <p className="text-[11px] text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> Falha ao carregar usuários
          </p>
        ) : users.length === 0 ? (
          <p className="text-[11px] text-muted-foreground italic py-2 text-center">
            {hasNullOnly
              ? "🤖 Sessões agendadas / sistema — sem usuários identificados"
              : "Nenhuma sessão com usuários identificados ainda."}
          </p>
        ) : (
          <>
            {visible.map((u) => {
              const p = profiles[u.userId];
              const displayName = p?.name ?? `${u.userId.slice(0, 8)}…`;
              const initials =
                (p?.name ?? u.userId.replace(/-/g, ""))
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("") || "?";
              return (
                <div key={u.userId} className="flex items-center gap-2.5">
                  {p?.avatar ? (
                    <img
                      src={p.avatar}
                      alt={displayName}
                      className="h-7 w-7 rounded-full object-cover shrink-0"
                    />
                  ) : (
                    <div className="h-7 w-7 rounded-full bg-primary/15 text-primary flex items-center justify-center text-[10px] font-bold shrink-0">
                      {initials}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-foreground truncate">{displayName}</p>
                    <p className="text-[10px] text-muted-foreground truncate">
                      {p?.email ? `${p.email} · ` : ""}{relTime(u.lastAt)}
                    </p>
                  </div>
                </div>
              );
            })}
            {users.length > 5 && !showAll && (
              <button
                onClick={() => setShowAll(true)}
                className="w-full text-[10px] font-medium text-primary hover:text-primary/80 pt-1"
              >
                Ver todos ({users.length})
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}

