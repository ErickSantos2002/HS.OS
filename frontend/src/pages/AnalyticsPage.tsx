import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format, subDays, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from "recharts";
import { BarChart3, Coins, Trophy, Layers, ArrowDown, ArrowUp, Users, Cpu, ListTree, TrendingUp } from "lucide-react";
import { useUsage, agregar, explicarDia, KIND_LABEL } from "@/hooks/use-usage";
import PeriodoToolbar, { type Preset } from "@/components/analytics/PeriodoToolbar";

type Range = Preset;

/** yyyy-mm-dd de hoje, no fuso local (evita o pulo de dia do toISOString). */
function hojeISO(offsetDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDias);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// COST_PER_TOKEN removido: era UM preço fixo para TODOS os modelos, cravado
// no código. Foi ele que produziu US$19/dia na tela contra US$61/mês na
// fatura. Agora o custo vem por evento, calculado com o preço do modelo de
// verdade (tabela model_pricing) ou derivado da conta do próprio gateway.

const PALETTE = [
  "hsl(231, 100%, 62%)",
  "hsl(280, 80%, 65%)",
  "hsl(170, 70%, 50%)",
  "hsl(35, 95%, 60%)",
  "hsl(0, 80%, 65%)",
  "hsl(200, 90%, 60%)",
  "hsl(140, 60%, 55%)",
  "hsl(310, 70%, 65%)",
];

function formatNumber(n: number) {
  return new Intl.NumberFormat("pt-BR").format(Math.round(n));
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(n);
}

type UserActivityRow = {
  user_id: string;
  agent_id: string;
  session_count: number;
  last_active: string;
};

type ProfileLite = { id: string; full_name: string | null; email: string };

export default function AnalyticsPage() {
  const [range, setRange] = useState<Range>(7);
  const [desdeCustom, setDesdeCustom] = useState(hojeISO(-6));
  const [ateCustom, setAteCustom] = useState(hojeISO());

  const { desde, ate, diasNoPeriodo } = useMemo(() => {
    if (range === "custom") {
      const ini = new Date(`${desdeCustom}T00:00:00`);
      const fim = new Date(`${ateCustom}T00:00:00`);
      const d = Math.max(1, Math.round((fim.getTime() - ini.getTime()) / 86400000) + 1);
      return { desde: desdeCustom, ate: ateCustom, diasNoPeriodo: d };
    }
    return { desde: hojeISO(-(range - 1)), ate: hojeISO(), diasNoPeriodo: range };
  }, [range, desdeCustom, ateCustom]);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [userActivity, setUserActivity] = useState<UserActivityRow[]>([]);
  const [profilesMap, setProfilesMap] = useState<Map<string, ProfileLite>>(new Map());
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function loadActivity() {
      setActivityLoading(true);
      setActivityError(null);
      const since = new Date(`${desde}T00:00:00`).toISOString();
      const { data, error } = await supabase.rpc("get_user_agent_activity", { _since: since });
      if (cancelled) return;
      if (error) {
        console.error("Failed to load user activity:", error);
        setActivityError(error.message);
        setUserActivity([]);
        setProfilesMap(new Map());
        setActivityLoading(false);
        return;
      }
      const activity = (data || []) as UserActivityRow[];
      setUserActivity(activity);

      const userIds = [...new Set(activity.map((r) => r.user_id).filter(Boolean))];
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, full_name, email")
          .in("id", userIds);
        if (cancelled) return;
        setProfilesMap(new Map((profs || []).map((p: any) => [p.id, p as ProfileLite])));
      } else {
        setProfilesMap(new Map());
      }
      setActivityLoading(false);
    }
    loadActivity();
    return () => {
      cancelled = true;
    };
  }, [desde]);

  // Fonte MEDIDA (task #19). Os memos antigos derivavam de
  // agent_token_snapshots — tabela alimentada por relato, não por medição.
  const uso = useUsage(desde, ate);

  // Dia em foco: clicar numa barra da tendência (ou escolher no seletor)
  // recorta TODA a tela para aquele dia — é assim que "ontem gastou mais"
  // vira "ontem, a rotina X do agente Y consumiu Z".
  const [dia, setDia] = useState<string | null>(null);

  const linhasDoDia = useMemo(
    () => (dia ? uso.rows.filter((r) => r.ts.slice(0, 10) === dia) : uso.rows),
    [uso.rows, dia],
  );
  const visao = useMemo(() => agregar(linhasDoDia), [linhasDoDia]);
  const culpados = useMemo(
    () => (dia ? explicarDia(uso.rows, dia) : []),
    [uso.rows, dia],
  );
  const diasDisponiveis = useMemo(
    () => [...uso.porDia].reverse().map((d) => ({ dia: d.day, tokens: d.tokens })),
    [uso.porDia],
  );

  const totals = useMemo(() => ({
    totalTokens: visao.tokens,
    estimatedCost: visao.cost,
    topAgent: visao.porAgente[0]?.key ?? "—",
    topTokens: visao.porAgente[0]?.tokens ?? 0,
    totalSessions: visao.eventos,
  }), [visao]);

  const tokensPerAgent = useMemo(
    () => visao.porAgente.map((a) => ({ agent_id: a.key, total_tokens: a.tokens })),
    [visao.porAgente],
  );

  const { trendData, agents } = useMemo(() => {
    const agentSet = new Set<string>();
    const data = uso.porDia.map((d) => {
      const row: Record<string, unknown> = { date: d.day };
      for (const [agente, tokens] of Object.entries(d.porAgente)) {
        agentSet.add(agente);
        row[agente] = tokens;
      }
      return row;
    });
    return { trendData: data, agents: [...agentSet] };
  }, [uso.porDia]);

  const isEmpty = !uso.loading && uso.vazio;

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Analytics de Uso
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Consumo de tokens, custo estimado e atividade por agente.
          </p>
        </div>
        <PeriodoToolbar
          preset={range}
          onPreset={setRange}
          desde={desde}
          ate={ate}
          onRange={(d, a) => { setDesdeCustom(d); setAteCustom(a); }}
          dia={dia}
          onDia={setDia}
          diasDisponiveis={diasDisponiveis}
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryCard
          icon={<Coins className="h-4 w-4" />}
          label="Tokens consumidos"
          value={formatNumber(totals.totalTokens)}
          hint={!dia && uso.variacaoTokens != null
            ? `${uso.variacaoTokens >= 0 ? "+" : ""}${uso.variacaoTokens.toFixed(0)}% vs ${diasNoPeriodo} dias anteriores`
            : undefined}
        />
        <SummaryCard
          icon={<BarChart3 className="h-4 w-4" />}
          label="Custo estimado"
          value={totals.estimatedCost > 0 ? formatCurrency(totals.estimatedCost) : "—"}
          hint={visao.tokensSemCusto > 0
            ? `${formatNumber(visao.tokensSemCusto)} tokens sem preço conhecido`
            : (!dia && uso.variacaoCusto != null
                ? `${uso.variacaoCusto >= 0 ? "+" : ""}${uso.variacaoCusto.toFixed(0)}% vs período anterior`
                : "preço por modelo")}
        />
        <SummaryCard
          icon={<Trophy className="h-4 w-4" />}
          label="Agente mais ativo"
          value={totals.topAgent}
          hint={totals.topTokens ? `${formatNumber(totals.topTokens)} tokens` : undefined}
        />
        <SummaryCard
          icon={<Layers className="h-4 w-4" />}
          label="Servido por cache"
          value={`${uso.cache.taxa.toFixed(0)}%`}
          hint={`${formatNumber(uso.cache.tokens)} tokens a preço reduzido`}
        />
      </div>

      {isEmpty ? (
        <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-2xl p-12 text-center">
          <BarChart3 className="h-10 w-10 text-muted-foreground/50 mx-auto mb-4" />
          <h3 className="text-base font-display font-semibold text-foreground">
            Sem dados ainda
          </h3>
          <p className="text-sm text-muted-foreground mt-1">
            A medição registra cada resposta do agente e varre as sessões a cada 15 minutos.
          </p>
        </div>
      ) : (
        <>
          <div className="pt-4 first:pt-0">
            <h2 className="text-[13px] font-display font-semibold uppercase tracking-[0.14em] text-muted-foreground">Panorama</h2>
            <p className="text-xs text-muted-foreground/70 mt-1">Quanto está sendo consumido e como isso evoluiu</p>
          </div>

          {/* Line chart */}
          <ChartCard
            title="Tendência diária"
            subtitle="Clique num dia para investigar o que aconteceu nele"
          >
            <ResponsiveContainer width="100%" height={320}>
              <LineChart
                data={trendData}
                onClick={(e: { activeLabel?: string }) => {
                  const d = e?.activeLabel;
                  if (typeof d === "string") setDia((atual) => (atual === d ? null : d));
                }}
                style={{ cursor: "pointer" }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="date"
                  stroke="hsl(var(--muted-foreground))"
                  fontSize={12}
                  tickFormatter={(d) => format(new Date(d), "dd/MM")}
                />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  labelFormatter={(d) => format(new Date(d), "dd 'de' MMM", { locale: ptBR })}
                  formatter={(v: number) => formatNumber(v)}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                {agents.map((a, i) => (
                  <Line
                    key={a}
                    type="monotone"
                    dataKey={a}
                    stroke={PALETTE[i % PALETTE.length]}
                    strokeWidth={2}
                    dot={{ r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

                {dia && culpados.length > 0 && (
            <ChartCard
              title={`O que puxou o consumo de ${format(new Date(`${dia}T12:00:00`), "dd 'de' MMMM", { locale: ptBR })}`}
              subtitle="Comparado com a média da própria tarefa nos outros dias do período"
            >
              <div className="space-y-2">
                {culpados.map((c) => (
                  <div key={c.tarefa} className="flex items-center gap-3 text-sm">
                    <TrendingUp className="h-3.5 w-3.5 text-destructive shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-foreground" title={c.tarefa}>
                      {c.tarefa}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums w-28 text-right">
                      {formatNumber(c.noDia)} tokens
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums w-32 text-right">
                      média {formatNumber(c.mediaOutrosDias)}
                    </span>
                    <span className="text-xs font-medium text-destructive tabular-nums w-24 text-right">
                      +{formatNumber(c.delta)}
                    </span>
                  </div>
                ))}
              </div>
            </ChartCard>
          )}

          <div className="pt-4 first:pt-0">
            <h2 className="text-[13px] font-display font-semibold uppercase tracking-[0.14em] text-muted-foreground">Para onde vai o consumo</h2>
            <p className="text-xs text-muted-foreground/70 mt-1">Quem gasta, em qual modelo e em que tipo de trabalho</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Bar chart */}
          <ChartCard title="Tokens por agente" subtitle={dia ? "No dia em foco" : `Soma de ${diasNoPeriodo} dias`}>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={tokensPerAgent}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis dataKey="agent_id" stroke="hsl(var(--muted-foreground))" fontSize={12} />
                <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickFormatter={formatNumber} />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--popover))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 12,
                    fontSize: 12,
                  }}
                  formatter={(v: number) => formatNumber(v)}
                />
                <Bar dataKey="total_tokens" fill="hsl(var(--primary))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* Tático: comparar LLMs — a dimensão que só existe agora que dá
              pra trocar de modelo por agente */}
          <ChartCard
            title="Por LLM"
            subtitle={dia ? "No dia em foco, por modelo" : "Onde o consumo está indo, por modelo"}
          >
            {visao.porModelo.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Ainda sem eventos com modelo identificado.
              </p>
            ) : (
              <div className="space-y-2">
                {visao.porModelo.map((m) => {
                  const pct = visao.tokens ? (m.tokens / visao.tokens) * 100 : 0;
                  return (
                    <div key={m.key} className="flex items-center gap-3">
                      <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-sm text-foreground w-44 truncate" title={m.key}>{m.key}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-24 text-right">
                        {formatNumber(m.tokens)}
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                        {m.tokensSemCusto > 0 && m.cost === 0 ? "—" : formatCurrency(m.cost)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </ChartCard>
          </div>

          {/* Onde o trabalho acontece: automação x conversa */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <ChartCard title="Automação x conversa" subtitle="De onde vem o consumo">
              <div className="space-y-2 py-2">
                {visao.porTipo.map((t) => {
                  const pct = visao.tokens ? (t.tokens / visao.tokens) * 100 : 0;
                  return (
                    <div key={t.key} className="flex items-center gap-3">
                      <span className="text-sm text-foreground w-28">{KIND_LABEL[t.key] ?? t.key}</span>
                      <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                        <div className="h-full rounded-full bg-primary/70" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums w-14 text-right">
                        {pct.toFixed(0)}%
                      </span>
                      <span className="text-xs text-muted-foreground tabular-nums w-24 text-right">
                        {formatNumber(t.tokens)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ChartCard>

            <ChartCard title="Por hora do dia" subtitle="Quando o consumo acontece">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={uso.porHora}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={10} interval={2} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} tickFormatter={formatNumber} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 12,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [formatNumber(v), "tokens"]}
                  />
                  <Bar dataKey="tokens" fill="hsl(231, 100%, 62%)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          <div className="pt-4 first:pt-0">
            <h2 className="text-[13px] font-display font-semibold uppercase tracking-[0.14em] text-muted-foreground">Onde investigar</h2>
            <p className="text-xs text-muted-foreground/70 mt-1">As tarefas e as chamadas individuais que mais pesaram</p>
          </div>

          {/* Operacional: "ontem gastou mais — o quê?" */}
          <ChartCard
            title="Por tarefa"
            subtitle={dia
              ? "Tudo que rodou no dia em foco, do maior consumo para o menor"
              : "Rotinas, sub-agentes e conversas — do maior consumo para o menor"}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-white/10">
                    <th className="py-2 pr-4 font-medium">Tarefa</th>
                    <th className="py-2 pr-4 font-medium">
                      <button
                        onClick={() => setSortDir(sortDir === "desc" ? "asc" : "desc")}
                        className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                      >
                        Tokens
                        {sortDir === "desc" ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />}
                      </button>
                    </th>
                    <th className="py-2 pr-4 font-medium">Custo</th>
                    <th className="py-2 pr-4 font-medium">Eventos</th>
                  </tr>
                </thead>
                <tbody>
                  {(sortDir === "desc" ? visao.porTarefa : [...visao.porTarefa].reverse())
                    .slice(0, 40)
                    .map((t) => (
                      <tr key={t.key} className="border-b border-white/5 hover:bg-white/[0.02]">
                        <td className="py-2.5 pr-4 font-medium text-foreground">
                          <span className="inline-flex items-center gap-2">
                            <ListTree className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                            <span className="truncate max-w-md" title={t.key}>{t.key}</span>
                          </span>
                        </td>
                        <td className="py-2.5 pr-4 text-foreground tabular-nums">{formatNumber(t.tokens)}</td>
                        <td className="py-2.5 pr-4 text-muted-foreground tabular-nums">
                          {t.cost > 0 ? formatCurrency(t.cost) : "—"}
                        </td>
                        <td className="py-2.5 pr-4 text-muted-foreground tabular-nums">{t.eventos}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </ChartCard>

          {/* Outliers: uma única chamada muito grande costuma ser conversa
              longa demais ou rotina mal dimensionada */}
          <ChartCard title="Chamadas mais pesadas" subtitle="Onde procurar desperdício">
            <div className="space-y-1.5">
              {uso.maiores.slice(0, 8).map((r, i) => (
                <div key={`${r.ts}-${i}`} className="flex items-center gap-3 text-sm">
                  <span className="text-xs text-muted-foreground tabular-nums w-24 shrink-0">
                    {format(new Date(r.ts), "dd/MM HH:mm")}
                  </span>
                  <span className="text-xs text-muted-foreground w-20 shrink-0 truncate">{r.agent_id}</span>
                  <span className="flex-1 min-w-0 truncate text-foreground" title={r.label ?? undefined}>
                    {r.label ?? KIND_LABEL[r.kind] ?? r.kind}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums w-24 text-right">
                    {formatNumber(r.total_tokens)}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums w-20 text-right">
                    {r.cost_usd ? formatCurrency(Number(r.cost_usd)) : "—"}
                  </span>
                </div>
              ))}
            </div>
          </ChartCard>

          <div className="pt-4 first:pt-0">
            <h2 className="text-[13px] font-display font-semibold uppercase tracking-[0.14em] text-muted-foreground">Pessoas</h2>
            <p className="text-xs text-muted-foreground/70 mt-1">Interação humano × agente no período</p>
          </div>

          {/* Atividade por usuário */}
          <ChartCard
            title="Atividade por usuário"
            subtitle={`Interações humano × agente em ${diasNoPeriodo} dias`}
          >
            {activityError ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Acesso restrito a super admins.
              </div>
            ) : activityLoading ? (
              <div className="text-sm text-muted-foreground py-6 text-center">Carregando…</div>
            ) : userActivity.length === 0 ? (
              <div className="text-sm text-muted-foreground py-6 text-center">
                Nenhuma interação registrada no período.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground border-b border-white/10">
                      <th className="py-2 pr-4 font-medium">
                        <span className="inline-flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          Usuário
                        </span>
                      </th>
                      <th className="py-2 pr-4 font-medium">Agente</th>
                      <th className="py-2 pr-4 font-medium text-right">Sessões</th>
                      <th className="py-2 pr-4 font-medium">Última interação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {userActivity.map((r) => {
                      const profile = profilesMap.get(r.user_id);
                      const label = profile?.full_name?.trim() || profile?.email || r.user_id;
                      return (
                        <tr
                          key={`${r.user_id}-${r.agent_id}`}
                          className="border-b border-white/5 hover:bg-white/[0.02]"
                        >
                          <td className="py-2.5 pr-4 font-medium text-foreground">{label}</td>
                          <td className="py-2.5 pr-4 text-foreground">{r.agent_id}</td>
                          <td className="py-2.5 pr-4 text-right text-foreground tabular-nums">
                            {formatNumber(r.session_count)}
                          </td>
                          <td className="py-2.5 pr-4 text-muted-foreground">
                            {format(new Date(r.last_active), "dd MMM yyyy HH:mm", { locale: ptBR })}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        </>
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-2xl p-4 shadow-2xl">
      <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
        <span className="text-primary">{icon}</span>
        {label}
      </div>
      <div className="mt-2 text-2xl font-display font-bold text-foreground truncate">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-background/60 backdrop-blur-2xl p-5 shadow-2xl">
      <div className="mb-4">
        <h3 className="text-sm font-display font-semibold text-foreground">{title}</h3>
        {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
