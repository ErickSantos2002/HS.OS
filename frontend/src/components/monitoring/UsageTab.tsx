import { api } from "@/lib/api";
import { useState, useEffect, useMemo, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip,
  ResponsiveContainer, CartesianGrid, Legend,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { BarChart2, AlertTriangle, TrendingUp, Coins, Crown, CalendarDays } from "lucide-react";
import {
  getPricingFor, getModelLabel, formatTokensShort,
} from "@/lib/model-pricing";
import { useAgentCatalog } from "@/hooks/use-agent-catalog";
import { getAgentColor, getAgentDisplayNameById, getOfficialAgentIds } from "@/lib/active-agents";

const RANGES = [
  { id: "1",  label: "Hoje",    days: 1 },
  { id: "7",  label: "7 dias",  days: 7 },
  { id: "14", label: "14 dias", days: 14 },
  { id: "30", label: "30 dias", days: 30 },
];

interface DayAgent {
  day: string;       // yyyy-mm-dd
  agentId: string;
  tokens: number;
  input: number;
  output: number;
  /** Custo já calculado no banco (preço do modelo real ou derivado do gateway). */
  cost?: number;
  model: string | null;
}

interface UsageTabProps {
  data: unknown;
  agentStats?: unknown[];
  isLoading: boolean;
}

export function UsageTab(_props: UsageTabProps) {
  const navigate = useNavigate();
  useAgentCatalog();
  const [rangeId, setRangeId] = useState("7");
  const [rows, setRows] = useState<DayAgent[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const days = RANGES.find((r) => r.id === rangeId)?.days ?? 7;
  const AGENT_ORDER = getOfficialAgentIds();
  const nameOf = (id: string) => getAgentDisplayNameById(id);
  const colorOf = (id: string) => getAgentColor(id);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      since.setDate(since.getDate() - (days - 1));

      // Fonte MEDIDA (task #19). Antes lia agent_token_snapshots — tabela
      // alimentada por relato de agente, sem ninguém medindo — e por isso
      // esta aba e o Analytics mostravam números em que não dava pra confiar.
      // Aqui cada linha é um evento medido; o "acumulado por dia" some, o que
      // simplifica: basta somar.
      const evts = await api<Record<string, unknown>[]>(
        `/uso/eventos?desde=${since.toISOString()}`,
      );
      // Adapta ao formato que o resto desta aba já espera (agente+dia),
      // somando em vez de tirar diferença entre acumulados.
      const data = (evts ?? []).map((e: Record<string, unknown>) => ({
        agent_id: e.agent_id,
        total_tokens: e.total_tokens,
        input_tokens: e.input_tokens,
        output_tokens: e.output_tokens,
        model: e.model,
        cost_usd: e.cost_usd,
        snapshot_at: e.ts,
      }));

      // Agrupa por agente + dia SOMANDO. A lógica antiga tirava max−min
      // porque os snapshots eram acumulados; cada evento medido já é o
      // consumo daquele momento — somar é o certo, e não perde o primeiro
      // registro do dia (o max−min descartava a base silenciosamente).
      const grp: Record<string, { t: number; i: number; o: number; c: number; model: string | null }> = {};
      for (const r of data || []) {
        const id = r.agent_id as string;
        if (!id) continue;
        const day = (r.snapshot_at as string).slice(0, 10);
        const key = `${id}__${day}`;
        const m = r.model && r.model !== "unknown" ? (r.model as string) : null;
        const cur = grp[key] ?? { t: 0, i: 0, o: 0, c: 0, model: null };
        cur.t += (r.total_tokens as number) ?? 0;
        cur.i += (r.input_tokens as number) ?? 0;
        cur.o += (r.output_tokens as number) ?? 0;
        cur.c += Number(r.cost_usd) || 0;
        if (m) cur.model = m;
        grp[key] = cur;
      }
      const list: DayAgent[] = Object.entries(grp).map(([k, v]) => {
        const [agentId, day] = k.split("__");
        return { agentId, day, tokens: v.t, input: v.i, output: v.o, cost: v.c, model: v.model };
      });
      setRows(list);
    } catch (e: any) {
      setError(e?.message || "Erro ao carregar dados");
      setRows(null);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { load(); }, [load]);

  /* ---------- derived ---------- */
  const summary = useMemo(() => {
    if (!rows) return null;
    let totalTokens = 0;
    let totalCost = 0;
    const perAgent: Record<string, number> = {};
    const perDay: Record<string, number> = {};
    for (const r of rows) {
      totalTokens += r.tokens;
      // Custo do banco (preço do modelo real, ou derivado da conta do
      // gateway). A tabela local de preços vira fallback — eventos da
      // varredura não têm divisão entrada/saída e dariam custo zero por ela.
      const p = getPricingFor(r.model);
      totalCost += r.cost ?? (r.input * p.input + r.output * p.output);
      perAgent[r.agentId] = (perAgent[r.agentId] || 0) + r.tokens;
      perDay[r.day] = (perDay[r.day] || 0) + r.tokens;
    }
    const topAgent = Object.entries(perAgent).sort((a, b) => b[1] - a[1])[0];
    const peakDay = Object.entries(perDay).sort((a, b) => b[1] - a[1])[0];
    return { totalTokens, totalCost, topAgent, peakDay };
  }, [rows]);

  // Build chart data: 1 entry per day, keys per agent
  const chartData = useMemo(() => {
    if (!rows) return [];
    const dayList: string[] = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      dayList.push(d.toISOString().slice(0, 10));
    }
    return dayList.map((day) => {
      const entry: Record<string, any> = { day, label: day.slice(5).replace("-", "/") };
      for (const id of AGENT_ORDER) entry[id] = 0;
      for (const r of rows.filter((x) => x.day === day)) {
        entry[r.agentId] = (entry[r.agentId] || 0) + r.tokens;
      }
      return entry;
    });
  }, [rows, days]);

  const tableData = useMemo(() => {
    if (!rows) return [];
    const map: Record<string, { agentId: string; tokens: number; input: number; output: number; cost: number; model: string | null; activeDays: Set<string> }> = {};
    for (const r of rows) {
      const m = map[r.agentId] || (map[r.agentId] = {
        agentId: r.agentId, tokens: 0, input: 0, output: 0, cost: 0, model: r.model, activeDays: new Set<string>(),
      });
      m.tokens += r.tokens;
      m.input  += r.input;
      m.output += r.output;
      const p = getPricingFor(r.model);
      m.cost   += r.cost ?? (r.input * p.input + r.output * p.output);
      if (r.tokens > 0) m.activeDays.add(r.day);
      if (r.model) m.model = r.model;
    }
    return Object.values(map).sort((a, b) => b.tokens - a.tokens);
  }, [rows]);

  /* ---------- render ---------- */
  if (loading && !rows) {
    return (
      <div className="space-y-4">
        <div className="flex gap-2">
          {RANGES.map((r) => <Skeleton key={r.id} className="h-9 w-20 rounded-full" />)}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="glass-card rounded-2xl p-4"><Skeleton className="h-12 w-full" /></div>
          ))}
        </div>
        <div className="glass-card rounded-2xl p-4"><Skeleton className="h-64 w-full" /></div>
        <div className="glass-card rounded-2xl p-4"><Skeleton className="h-48 w-full" /></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card rounded-2xl p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-destructive mx-auto mb-2" />
        <p className="text-sm text-destructive mb-3">Erro ao carregar dados. Tente novamente.</p>
        <Button variant="outline" size="sm" onClick={load} className="rounded-full">Recarregar</Button>
      </div>
    );
  }

  const isEmpty = !summary || summary.totalTokens === 0;

  return (
    <div className="space-y-4">
      {/* Range selector */}
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.id}
            variant={rangeId === r.id ? "default" : "outline"}
            size="sm"
            className="rounded-full text-xs"
            onClick={() => setRangeId(r.id)}
          >
            {r.label}
          </Button>
        ))}
        {loading && <span className="text-xs text-muted-foreground animate-pulse self-center">Carregando…</span>}
      </div>

      {isEmpty ? (
        <div className="glass-card rounded-2xl py-12 text-center">
          <BarChart2 className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            Nenhum dado de uso nos últimos {days} dias.
          </p>
          <p className="text-[11px] text-muted-foreground/70 mt-1">
            Snapshots são coletados automaticamente a cada 15 minutos.
          </p>
        </div>
      ) : (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<Coins className="h-4 w-4" />}
              label="Total de tokens"
              value={summary!.totalTokens.toLocaleString("pt-BR")}
              sub={formatTokensShort(summary!.totalTokens)}
            />
            <SummaryCard
              icon={<TrendingUp className="h-4 w-4" />}
              label="Custo estimado"
              value={summary!.totalCost < 0.01 ? "$0.00" : `$${summary!.totalCost.toFixed(2)}`}
              sub={`≈ R$ ${(summary!.totalCost * 5.8).toFixed(2)}`}
            />
            <SummaryCard
              icon={<Crown className="h-4 w-4" />}
              label="Agente mais ativo"
              value={summary!.topAgent ? nameOf(summary!.topAgent[0]) : "—"}
              sub={summary!.topAgent ? `${formatTokensShort(summary!.topAgent[1])} tokens` : undefined}
            />
            <SummaryCard
              icon={<CalendarDays className="h-4 w-4" />}
              label="Dia de pico"
              value={summary!.peakDay ? summary!.peakDay[0].slice(5).replace("-", "/") : "—"}
              sub={summary!.peakDay ? `${formatTokensShort(summary!.peakDay[1])} tokens` : undefined}
            />
          </div>

          {/* Stacked bar chart */}
          <div className="glass-card rounded-2xl p-4">
            <h3 className="text-sm font-display font-semibold text-foreground mb-3">
              Tokens por dia (por agente)
            </h3>
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                  tickFormatter={(v) => formatTokensShort(Number(v))}
                />
                <RechartsTooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 }}
                  formatter={(v: number, name: string) => [Number(v).toLocaleString("pt-BR"), nameOf(name)]}
                  labelFormatter={(l, items) => {
                    const total = (items || []).reduce((s, it: any) => s + (Number(it.value) || 0), 0);
                    return `${l} — Total: ${total.toLocaleString("pt-BR")}`;
                  }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11 }}
                  formatter={(v) => nameOf(v)}
                />
                {AGENT_ORDER.map((id) => (
                  <Bar key={id} dataKey={id} stackId="a" fill={colorOf(id)} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Per-agent table */}
          <div className="glass-card rounded-2xl p-4">
            <h3 className="text-sm font-display font-semibold text-foreground mb-3">
              Uso por agente
            </h3>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="border-border/30">
                    <TableHead className="text-xs">Agente</TableHead>
                    <TableHead className="text-xs">Modelo</TableHead>
                    <TableHead className="text-xs text-right">Tokens</TableHead>
                    <TableHead className="text-xs text-right">Input</TableHead>
                    <TableHead className="text-xs text-right">Output</TableHead>
                    <TableHead className="text-xs text-right">Custo</TableHead>
                    <TableHead className="text-xs text-right">Dias ativo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tableData.map((a) => {
                    const cost = a.cost < 0.01 ? "$0.00" : `$${a.cost.toFixed(2)}`;
                    return (
                      <TableRow
                        key={a.agentId}
                        className="border-border/20 cursor-pointer hover:bg-card/60"
                        onClick={() => navigate(`/agents/${a.agentId}`)}
                      >
                        <TableCell>
                          <Badge
                            variant="outline"
                            className="text-[10px] rounded-full"
                            style={{ borderColor: colorOf(a.agentId) || undefined }}
                          >
                            {nameOf(a.agentId)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {a.model ? getModelLabel(a.model) : "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-right">{formatTokensShort(a.tokens)}</TableCell>
                        <TableCell className="text-xs font-mono text-right text-muted-foreground">{formatTokensShort(a.input)}</TableCell>
                        <TableCell className="text-xs font-mono text-right text-muted-foreground">{formatTokensShort(a.output)}</TableCell>
                        <TableCell className="text-xs font-mono text-right">{cost}</TableCell>
                        <TableCell className="text-xs font-mono text-right">{a.activeDays.size}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- helpers ---------- */
function SummaryCard({ icon, label, value, sub }: {
  icon: React.ReactNode; label: string; value: string; sub?: string;
}) {
  return (
    <div className="glass-card rounded-2xl p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-1">
        {icon}
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <p className="text-xl font-mono font-bold text-foreground truncate">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">{sub}</p>}
    </div>
  );
}
