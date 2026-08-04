import { useState, useEffect } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { RefreshCw, AlertTriangle, Clock, Bot, Wifi, Zap, BarChart2, Timer } from "lucide-react";
import { useMonitoringData } from "@/hooks/use-monitoring-data";
import { AgentsTab } from "@/components/monitoring/AgentsTab";
import { GatewayTab } from "@/components/monitoring/GatewayTab";
import { CronTab } from "@/components/monitoring/CronTab";
import { SkillsTab } from "@/components/monitoring/SkillsTab";
import { UsageTab } from "@/components/monitoring/UsageTab";

function timeAgo(date: Date | null) {
  if (!date) return "—";
  const secs = Math.floor((Date.now() - date.getTime()) / 1000);
  if (secs < 5) return "agora";
  if (secs < 60) return `${secs}s atrás`;
  return `${Math.floor(secs / 60)}m atrás`;
}

export default function MonitoringPage() {
  const {
    agents, health, cron, usage,
    gatewayStatus, processes, events,
    isLoading, error, lastUpdated, lastCollectedAt, gatewayOnline,
    healthLatencyMs, refetch,
  } = useMonitoringData();

  const [agoText, setAgoText] = useState("—");
  const [collectedAgoText, setCollectedAgoText] = useState("—");
  const [collectorAgeMin, setCollectorAgeMin] = useState(0);

  useEffect(() => {
    const tick = () => {
      setAgoText(timeAgo(lastUpdated));
      setCollectedAgoText(timeAgo(lastCollectedAt));
      if (lastCollectedAt) {
        setCollectorAgeMin(Math.floor((Date.now() - lastCollectedAt.getTime()) / 60000));
      }
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [lastUpdated, lastCollectedAt]);

  return (
    <div className="flex flex-col gap-6 p-4 md:p-6 max-w-7xl mx-auto w-full">
      {/* Header — Aurora glow */}
      <div className="glass-card rounded-2xl p-5 md:p-6 aurora-glow">
        <div className="relative z-10 flex items-center justify-between flex-wrap gap-3">
          <div className="space-y-1">
            <h1 className="text-xl md:text-2xl font-display font-bold text-foreground tracking-tight">
              Monitoramento
            </h1>
            <p className="text-xs md:text-sm text-muted-foreground">
              Visão geral do gateway, agentes e infraestrutura
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex flex-col items-end gap-0.5">
              <span className="flex items-center gap-1.5 text-[10px] md:text-xs text-muted-foreground font-mono">
                <Clock className="h-3 w-3" />
                Consulta: {agoText}
              </span>
              <span className="text-[10px] text-muted-foreground/70 font-mono">
                Última coleta: {collectedAgoText}
              </span>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetch()}
              disabled={isLoading}
              className="gap-1.5 rounded-full text-xs backdrop-blur-sm border-border/60 hover:border-primary/40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? "animate-spin" : ""}`} />
              Atualizar
            </Button>
          </div>
        </div>
      </div>

      {/* Gateway offline alert */}
      {!gatewayOnline && !isLoading && (
        <Alert variant="destructive" className="rounded-2xl border-destructive/30 bg-destructive/5 backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>⚠️ Gateway offline</AlertTitle>
          <AlertDescription className="flex items-center gap-2">
            Dados podem estar desatualizados.
            <Button variant="outline" size="sm" onClick={() => refetch()} className="ml-2 rounded-full">
              Tentar reconectar
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {/* Collector health alert */}
      {!isLoading && collectorAgeMin > 20 && collectorAgeMin <= 60 && (
        <Alert className="rounded-2xl border-warning/30 bg-warning/5 backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4 text-warning" />
          <AlertTitle className="text-warning">Coletor pode estar com problema</AlertTitle>
          <AlertDescription className="text-xs">
            Última coleta foi há {collectorAgeMin} minutos. O intervalo esperado é de 15 minutos.
          </AlertDescription>
        </Alert>
      )}
      {!isLoading && collectorAgeMin > 60 && (
        <Alert variant="destructive" className="rounded-2xl border-destructive/30 bg-destructive/5 backdrop-blur-sm">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>🔴 Coletor parado</AlertTitle>
          <AlertDescription className="text-xs">
            Última coleta foi há {collectorAgeMin} minutos. Verifique o script coletor na VPS.
          </AlertDescription>
        </Alert>
      )}

      {/* Tabs */}
      <Tabs defaultValue="agents" className="w-full">
        <TabsList className="w-full justify-start bg-transparent border-b border-border/40 rounded-none p-0 h-auto gap-0">
          {[
            { value: "agents", label: "Super agentes", icon: Bot },
            { value: "gateway", label: "Gateway & Watchdog", icon: Wifi },
            { value: "cron", label: "Cron", icon: Timer },
            { value: "skills", label: "Skills", icon: Zap },
            { value: "usage", label: "Uso & Custos", icon: BarChart2 },
          ].map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:border-b-2 data-[state=active]:border-primary data-[state=active]:text-primary rounded-none px-4 py-2.5 text-xs font-medium text-muted-foreground transition-colors gap-1.5"
            >
              <tab.icon className="h-3.5 w-3.5" />
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="agents" className="mt-6">
          <AgentsTab data={agents} isLoading={isLoading} gatewayOnline={gatewayOnline} lastUpdated={lastUpdated} />
        </TabsContent>

        <TabsContent value="gateway" className="mt-6">
          <GatewayTab
            data={health}
            gatewayStatus={gatewayStatus}
            processes={processes}
            events={events}
            isLoading={isLoading}
            gatewayOnline={gatewayOnline}
            healthLatencyMs={healthLatencyMs}
            onForceRefetch={refetch}
            cronSummary={cron}
            agentStats={agents}
          />
        </TabsContent>

        <TabsContent value="cron" className="mt-6">
          <CronTab data={cron} isLoading={isLoading} />
        </TabsContent>

        <TabsContent value="skills" className="mt-6">
          <SkillsTab />
        </TabsContent>

        <TabsContent value="usage" className="mt-6">
          <UsageTab data={usage} agentStats={agents} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
