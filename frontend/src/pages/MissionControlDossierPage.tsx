import {
  ArrowRight,
  BarChart3,
  Bot,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  LayoutDashboard,
  MessageSquare,
  Puzzle,
  ShieldCheck,
  Sparkles,
  Users,
  Waypoints,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useBranding } from "@/hooks/use-branding";

const strategicPillars = [
  {
    icon: Users,
    title: "Operação integrada",
    description:
      "Humanos e agentes de IA trabalham lado a lado em canais temáticos, DMs e threads — como um Slack corporativo onde a equipe inteira (real e artificial) colabora em tempo real.",
  },
  {
    icon: Sparkles,
    title: "Artefatos e inteligência sob demanda",
    description:
      "Super agentes geram dashboards, relatórios, análises e documentos diretamente no chat. Peça e receba — em segundos, não dias.",
  },
  {
    icon: BarChart3,
    title: "Decisão orientada por dados",
    description:
      "Cada interação vira sinal. Acompanhe economia gerada, produtividade por agente e impacto real em tempo real — sem planilhas paralelas.",
  },
];

const featuredResources = [
  {
    icon: MessageSquare,
    title: "Chat corporativo",
    description: "Canais, threads e DMs com agentes e humanos. Comunicação unificada estilo Slack.",
  },
  {
    icon: LayoutDashboard,
    title: "Geração de artefatos",
    description: "Dashboards, relatórios HTML e análises criadas por agentes sob demanda no chat.",
  },
  {
    icon: FolderOpen,
    title: "Gestão de arquivos",
    description: "Conhecimento compartilhado entre times com upload, organização e acesso controlado.",
  },
  {
    icon: Bot,
    title: "Times híbridos",
    description: "Organize equipes com humanos e agentes de IA no mesmo time, com papéis claros.",
  },
  {
    icon: Zap,
    title: "Arenas de simulação",
    description: "Teste cenários, treine agentes e valide estratégias antes de colocar em produção.",
  },
  {
    icon: ShieldCheck,
    title: "Controle de acesso",
    description: "Autenticação, papéis e rastreabilidade para operação segura e auditável.",
  },
];

const integrations = [
  {
    icon: Globe,
    name: "Nexus",
    description: "CRM e gestão de leads integrada à operação dos agentes.",
    status: "active" as const,
  },
  {
    icon: Zap,
    name: "dnMkt",
    description: "Automação de marketing e campanhas com inteligência operacional.",
    status: "soon" as const,
  },
  {
    icon: Bot,
    name: "mentor.ia",
    description: "Treinamento e capacitação com IA para equipes e novos agentes.",
    status: "soon" as const,
  },
  {
    icon: LayoutDashboard,
    name: "DnDash",
    description: "Dashboards com dados integrados de toda a operação em tempo real.",
    status: "soon" as const,
  },
];

const impactMetrics = [
  { value: "80%", label: "menos tempo em tarefas operacionais" },
  { value: "24/7", label: "agentes ativos sem custo adicional de equipe" },
  { value: "Segundos", label: "para gerar artefatos que levariam dias" },
];

const executiveOutcomes = [
  {
    title: "Escala com supervisão",
    description:
      "Amplie o uso de agentes mantendo acompanhamento completo da operação, sem perder controle sobre qualidade e continuidade.",
  },
  {
    title: "Menos opacidade, mais previsibilidade",
    description:
      "Substitua decisões baseadas em percepção por acompanhamento estruturado de atividade, desempenho e sinais de risco.",
  },
  {
    title: "Governança incorporada",
    description:
      "Rastreabilidade, papéis de acesso e artefatos operacionais centralizados — menos processos paralelos.",
  },
  {
    title: "Execução conectada ao negócio",
    description:
      "Conecte a camada operacional aos objetivos executivos: eficiência, produtividade e valor percebido.",
  },
];

const useCases = [
  "Acompanhar a saúde da operação e identificar gargalos antes que se tornem incidentes.",
  "Entender quais agentes, canais e times estão gerando mais tração ou exigindo mais atenção.",
  "Criar rituais executivos com narrativa clara sobre adoção, performance e impacto.",
  "Dar previsibilidade para expansão da operação com governança, segurança e histórico consolidado.",
];

export default function MissionControlDossierPage({ embedded }: { embedded?: boolean } = {}) {
  const { branding } = useBranding();

  return (
    <main className="p-4 md:p-6 space-y-6 md:space-y-8">
      {/* Hero */}
      <section className="glass-card-glow rounded-3xl overflow-hidden border border-border/60">
        <div className="glass-card-glow-effect" />
        <div className="relative z-10 grid gap-8 px-6 py-8 md:px-8 md:py-10 lg:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.8fr)] lg:items-end">
          <div className="space-y-5">
            <Badge variant="outline" className="w-fit border-primary/30 bg-primary/10 text-primary">
              Plataforma Operacional
            </Badge>
            <div className="space-y-3">
              <h1 className="max-w-4xl text-3xl font-display font-bold tracking-tight text-foreground md:text-5xl">
                Humanos, IAs (super agents) e arquivos em um único sistema operacional.
              </h1>
              <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-base">
                O dn.os conecta a operação da {branding.companyName} em um ambiente integrado: chat
                corporativo com agentes de IA, geração de artefatos sob demanda e resultados
                mensuráveis — tudo em tempo real, com governança e escala.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button variant="default" className="rounded-2xl">
                Explorar recursos
                <ArrowRight className="h-4 w-4" />
              </Button>
              <Button variant="glass" className="rounded-2xl">
                Ver integrações
              </Button>
            </div>
          </div>

          <Card className="rounded-3xl border-border/60 bg-card/80 backdrop-blur-sm">
            <CardHeader className="space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <FileText className="h-6 w-6" />
              </div>
              <CardTitle className="font-display text-xl">Resumo para liderança</CardTitle>
              <CardDescription>
                Uma plataforma para unificar operação humana e IA, gerar artefatos e traduzir
                atividade em resultado de negócio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                <div className="rounded-2xl border border-border/60 bg-secondary/40 p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Função</p>
                  <p className="mt-2 text-sm font-medium text-foreground">Unificar operação humana e IA</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-secondary/40 p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Foco</p>
                  <p className="mt-2 text-sm font-medium text-foreground">Produtividade, colaboração e visibilidade</p>
                </div>
                <div className="rounded-2xl border border-border/60 bg-secondary/40 p-4">
                  <p className="text-[11px] font-mono uppercase tracking-[0.18em] text-muted-foreground">Resultado</p>
                  <p className="mt-2 text-sm font-medium text-foreground">Resultados absurdos com menos esforço</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Pilares estratégicos */}
      <section className="grid gap-4 lg:grid-cols-3">
        {strategicPillars.map((pillar) => (
          <Card key={pillar.title} className="rounded-3xl border-border/60 bg-card/85">
            <CardHeader className="space-y-4">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-primary">
                <pillar.icon className="h-5 w-5" />
              </div>
              <div className="space-y-2">
                <CardTitle className="font-display text-xl">{pillar.title}</CardTitle>
                <CardDescription className="leading-6">{pillar.description}</CardDescription>
              </div>
            </CardHeader>
          </Card>
        ))}
      </section>

      {/* Recursos em destaque + Segurança */}
      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <Card className="rounded-3xl border-border/60 bg-card/85">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Recursos em destaque</CardTitle>
            <CardDescription>
              Tudo o que a operação precisa em uma arquitetura pensada para escala, clareza e
              evolução contínua.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {featuredResources.map((resource) => (
                <div
                  key={resource.title}
                  className="flex gap-3 rounded-2xl border border-border/60 bg-secondary/35 p-4"
                >
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <resource.icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{resource.title}</p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {resource.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/85">
          <CardHeader>
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-success">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <CardTitle className="font-display text-2xl">Segurança e governança</CardTitle>
            <CardDescription>
              O dn.os foi concebido para sustentar operação crítica com autenticação,
              rastreabilidade e separação clara de acessos.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm leading-6 text-muted-foreground">
            <p>
              Em vez de dispersar informação em múltiplos fluxos, a operação passa a existir em um
              ambiente único, com histórico, contexto e responsabilidade bem delimitados.
            </p>
            <p>
              Isso fortalece compliance operacional, reduz ambiguidades de execução e melhora a
              confiança executiva sobre como a camada de agentes está sendo administrada.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Ecossistema de integrações */}
      <section>
        <Card className="rounded-3xl border-border/60 bg-card/85">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-secondary text-primary">
                <Puzzle className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="font-display text-2xl">Ecossistema de integrações</CardTitle>
                <CardDescription>
                  Plataformas conectadas que ampliam o alcance operacional do dn.os.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {integrations.map((item) => (
                <div
                  key={item.name}
                  className="rounded-2xl border border-primary/20 bg-secondary/30 p-4 space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <item.icon className="h-5 w-5" />
                    </div>
                    <Badge
                      variant={item.status === "active" ? "default" : "outline"}
                      className={
                        item.status === "active"
                          ? "bg-success/20 text-success border-success/30 text-[10px]"
                          : "text-muted-foreground text-[10px]"
                      }
                    >
                      {item.status === "active" ? "Ativo" : "Em breve"}
                    </Badge>
                  </div>
                  <div>
                    <p className="text-sm font-display font-semibold text-foreground">
                      {item.name}
                    </p>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">
                      {item.description}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Métricas de impacto + Outcomes */}
      <section className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-3xl border-border/60 bg-card/85">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Resultados que falam por si</CardTitle>
            <CardDescription>
              A operação com dn.os traduz atividade em números reais de eficiência e produtividade.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3">
              {impactMetrics.map((metric) => (
                <div
                  key={metric.label}
                  className="flex items-center gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4"
                >
                  <span className="text-2xl font-display font-bold text-primary min-w-[80px]">
                    {metric.value}
                  </span>
                  <span className="text-sm text-muted-foreground">{metric.label}</span>
                </div>
              ))}
            </div>
            <div className="grid gap-3 pt-2">
              {executiveOutcomes.map((item) => (
                <div
                  key={item.title}
                  className="rounded-2xl border border-border/60 bg-secondary/35 p-4"
                >
                  <h3 className="text-base font-display font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {item.description}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-3xl border-border/60 bg-card/85">
          <CardHeader>
            <CardTitle className="font-display text-2xl">Impacto esperado</CardTitle>
            <CardDescription>
              Na prática, o dn.os apoia uma operação mais madura, previsível e pronta para crescer
              com disciplina.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
              {useCases.map((item) => (
                <li
                  key={item}
                  className="flex gap-3 rounded-2xl border border-border/60 bg-secondary/35 p-4"
                >
                  <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
