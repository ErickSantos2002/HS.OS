import { useMemo, useState } from "react";
import { BarChart3, CheckCircle2, DollarSign, Loader2, Trophy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { ResultsPeriod, useResults, getResultValue } from "@/hooks/use-results";

const periodOptions: { value: ResultsPeriod; label: string }[] = [
  { value: "7d", label: "7 dias" },
  { value: "30d", label: "30 dias" },
  { value: "90d", label: "90 dias" },
  { value: "all", label: "Todos" },
];

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function GlowStatCard({
  label,
  value,
  sub,
  icon: Icon,
  glowClass,
  iconGradient,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ElementType;
  glowClass?: string;
  iconGradient: string;
}) {
  return (
    <div className={cn("glass-card-glow backdrop-blur-xl bg-card/88 p-4 md:p-5 rounded-2xl", glowClass)}>
      <div className="glass-card-glow-effect" />
      <div className="relative z-10 flex items-center justify-between">
        <div className="space-y-1 min-w-0 flex-1">
          <p className="text-[10px] md:text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
          <p className="text-2xl font-bold font-display text-foreground">{value}</p>
          <p className="text-[10px] md:text-xs text-muted-foreground">{sub}</p>
        </div>
        <div className={cn("h-10 w-10 md:h-11 md:w-11 rounded-xl flex items-center justify-center shadow-lg shrink-0", iconGradient)}>
          <Icon className="h-5 w-5 text-foreground" />
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const [period, setPeriod] = useState<ResultsPeriod>("30d");
  const [category, setCategory] = useState("all");
  const [agentId, setAgentId] = useState("all");
  const [userId, setUserId] = useState("all");

  const filters = useMemo(
    () => ({ period, category, agentId, userId }),
    [agentId, category, period, userId],
  );

  const {
    results,
    totalCount,
    totalEconomy,
    monthlyCount,
    categoryOptions,
    agentOptions,
    userOptions,
    agentNameMap,
    profileMap,
    isLoading,
  } = useResults(filters);

  return (
    <div className="p-4 md:p-6 space-y-6">
      {/* Header Aurora */}
      <div className="aurora-glow rounded-2xl px-5 py-4 backdrop-blur-xl bg-card/88">
        <div className="relative z-10 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary/80 to-accent/60 flex items-center justify-center shadow-lg shadow-primary/20">
            <Trophy className="h-5 w-5 text-foreground" />
          </div>
          <div>
            <h1 className="text-lg font-display font-bold text-foreground">Resultados</h1>
            <p className="text-xs text-muted-foreground">Visão institucional dos resultados gerados pela operação</p>
          </div>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <GlowStatCard
          label="Total de resultados"
          value={isLoading ? "—" : String(totalCount)}
          sub="Período selecionado"
          icon={CheckCircle2}
          iconGradient="bg-gradient-to-br from-chart-2/80 to-chart-2/40"
        />
        <GlowStatCard
          label="Economia estimada"
          value={isLoading ? "—" : formatCurrency(totalEconomy)}
          sub="Soma dos valores do período filtrado"
          icon={DollarSign}
          glowClass="glow-success"
          iconGradient="bg-gradient-to-br from-success/80 to-success/40"
        />
        <GlowStatCard
          label="Resultados este mês"
          value={isLoading ? "—" : String(monthlyCount)}
          sub="Mês atual"
          icon={BarChart3}
          glowClass="glow-accent"
          iconGradient="bg-gradient-to-br from-primary/80 to-accent/60"
        />
      </div>

      {/* Filtros + Tabela */}
      <div className="rounded-2xl p-4 md:p-5 space-y-4 border border-border/50 backdrop-blur-xl bg-card/88">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-display font-semibold text-foreground">Filtros</h2>
            <p className="text-xs text-muted-foreground">Refine a visão por período, categoria, agente e usuário.</p>
          </div>

          <div className="flex flex-wrap gap-2">
            {periodOptions.map((option) => (
              <Button
                key={option.value}
                type="button"
                variant={period === option.value ? "default" : "glass"}
                className={cn(
                  "rounded-full",
                  period === option.value && "bg-gradient-to-r from-primary to-accent shadow-md shadow-primary/20"
                )}
                onClick={() => setPeriod(option.value)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-4 gap-3">
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue placeholder="Categoria" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas as categorias</SelectItem>
              {categoryOptions.map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={agentId} onValueChange={setAgentId}>
            <SelectTrigger>
              <SelectValue placeholder="Agente" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os agentes</SelectItem>
              {agentOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={userId} onValueChange={setUserId}>
            <SelectTrigger>
              <SelectValue placeholder="Usuário" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os usuários</SelectItem>
              {userOptions.map((option) => (
                <SelectItem key={option.id} value={option.id}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="glass-input flex items-center rounded-full px-4 text-xs text-muted-foreground backdrop-blur-md">
            {isLoading ? "Carregando resultados..." : `${results.length} registros exibidos`}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/30 backdrop-blur-xl bg-card/88">
          <Table>
            <TableHeader>
              <TableRow className="border-border/30 bg-muted/30">
                <TableHead>Título</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Agente</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                <TableHead>Data</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center">
                    <div className="flex items-center justify-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Carregando resultados...
                    </div>
                  </TableCell>
                </TableRow>
              ) : results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="h-28 text-center text-muted-foreground">
                    Nenhum resultado encontrado para os filtros selecionados.
                  </TableCell>
                </TableRow>
              ) : (
                results.map((result) => {
                  const profile = result.user_id ? profileMap.get(result.user_id) : null;
                  const userLabel = profile?.full_name?.trim() || profile?.email || result.user_id || "Sistema";
                  const agentLabel = agentNameMap.get(result.agent_id) ?? result.agent_id;

                  return (
                    <TableRow key={result.id} className="border-border/20 hover:bg-primary/5">
                      <TableCell className="min-w-[180px] font-medium text-foreground">{result.title}</TableCell>
                      <TableCell className="min-w-[260px] max-w-[340px] text-muted-foreground whitespace-normal break-words">
                        {result.description || "—"}
                      </TableCell>
                      <TableCell className="min-w-[140px]">{agentLabel}</TableCell>
                      <TableCell className="min-w-[180px]">{userLabel}</TableCell>
                      <TableCell>
                        <Badge className="bg-primary/10 text-primary border border-primary/20 hover:bg-primary/15">
                          {result.category ?? "Sem categoria"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-mono text-success">
                        {(() => {
                          const computed = getResultValue(result);
                          const isEstimated = !result.value || result.value <= 0;
                          return (
                            <span>
                              {formatCurrency(computed)}
                              {isEstimated && (
                                <span className="ml-1 text-[10px] text-muted-foreground font-sans">(estimado)</span>
                              )}
                            </span>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="min-w-[140px] text-muted-foreground">{formatDate(result.created_at)}</TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
}
