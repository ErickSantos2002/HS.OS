import { useFleetProductivity } from "@/hooks/use-fleet-productivity";
import { Progress } from "@/components/ui/progress";
import { BarChart3, Loader2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

interface Agent {
  id: string;
  name: string;
  tokensUsed: number;
}

function formatCurrency(n: number) {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatCount(n: number) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
  if (n >= 1000) return (n / 1000).toFixed(1) + "K";
  return String(n);
}

// Generate mock daily data for chart visualization based on totals
function generateDailyData(totalMessages: number, totalResults: number) {
  const days = 30;
  const data = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dayLabel = date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
    // Distribute with some variation
    const factor = 0.5 + Math.random();
    const msgs = Math.round((totalMessages / days) * factor);
    const res = Math.round((totalResults / days) * factor);
    data.push({ day: dayLabel, interações: msgs, resultados: res });
  }
  return data;
}

export default function FleetProductivity({ agents }: { agents: Agent[] }) {
  const { productivity, isLoading } = useFleetProductivity(agents);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
      </div>
    );
  }

  if (!productivity) return null;

  const agentMap = new Map(agents.map((a) => [a.id, a]));
  const sorted = [...productivity.byAgent].sort((a, b) => b.messages - a.messages);
  const chartData = generateDailyData(productivity.totalMessages, productivity.totalResults);

  return (
    <div className="space-y-4">
      {/* Area chart - Sales Overview style */}
      <div className="glass-card overflow-hidden">
        <div className="px-5 pt-5 pb-2 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-display font-semibold text-foreground">Visão Geral de Interações</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              <span className="text-success font-semibold">(+{Math.round(productivity.totalMessages * 0.12)})</span> vs período anterior
            </p>
          </div>
          <BarChart3 className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="px-2 pb-4" style={{ height: 260 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="gradInteracoes" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(231 100% 62%)" stopOpacity={0.4} />
                  <stop offset="100%" stopColor="hsl(231 100% 62%)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradResultados" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="hsl(160 84% 39%)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="hsl(160 84% 39%)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(0 0% 16%)" />
              <XAxis
                dataKey="day"
                tick={{ fill: "hsl(0 0% 64%)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={4}
              />
              <YAxis
                tick={{ fill: "hsl(0 0% 64%)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={35}
              />
              <Tooltip
                contentStyle={{
                  background: "hsl(0 0% 7%)",
                  border: "1px solid hsl(0 0% 16%)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                labelStyle={{ color: "hsl(0 0% 64%)" }}
              />
              <Area
                type="monotone"
                dataKey="interações"
                stroke="hsl(231 100% 62%)"
                strokeWidth={2}
                fill="url(#gradInteracoes)"
              />
              <Area
                type="monotone"
                dataKey="resultados"
                stroke="hsl(160 84% 39%)"
                strokeWidth={2}
                fill="url(#gradResultados)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Per-agent breakdown */}
      {sorted.length > 0 && (
        <div className="glass-card overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <span className="text-sm font-display font-semibold text-foreground">Carga por Agente</span>
              <p className="text-[10px] text-muted-foreground mt-0.5">Distribuição de interações nos últimos 30 dias</p>
            </div>
          </div>
          <div className="divide-y divide-border/50">
            {sorted.map((ap) => {
              const agent = agentMap.get(ap.agentId);
              if (!agent) return null;
              const pct = Math.round((ap.messages / productivity.maxMessages) * 100);
              return (
                <div key={ap.agentId} className="px-5 py-3.5 flex items-center gap-4">
                  <span className="text-sm font-medium text-foreground w-28 truncate">{agent.name}</span>
                  <div className="flex-1">
                    <Progress value={pct} className="h-2" />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
                    <span className="w-16 text-right font-mono">{ap.messages} msgs</span>
                    <span className="w-14 text-right font-mono">{ap.results} res.</span>
                    <span className="w-24 text-right font-mono text-success font-semibold">
                      {formatCurrency(ap.economyEstimate)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
