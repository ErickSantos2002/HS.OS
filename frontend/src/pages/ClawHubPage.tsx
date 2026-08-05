import { useState, useMemo } from "react";
import { useSkills, useAgentSkills, type Skill } from "@/hooks/use-skills";
import { useAgents } from "@/hooks/use-agents";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Zap,
  Search,
  Loader2,
  AlertCircle,
  Bot,
  Plus,
  Trash2,
  MessageSquare,
  Puzzle,
  ServerCog,
  Key,
  Copy,
  Check,
  CheckCircle2,
} from "lucide-react";
import { getGatewayConfig, gatewayNaoPortado } from "@/lib/gateway";

/* ── Platform helpers ─────────────────────────────────── */

type PlatformFilter = "all" | "vps" | "mac" | "hardware";

function getPlatformBadge(skill: Skill) {
  if (skill.type === "custom") return { label: "Custom HS.OS", cls: "bg-primary/15 text-primary border-primary/30" };
  if (skill.platform === "mac") return { label: "Mac only", cls: "bg-muted text-muted-foreground border-border" };
  if (!skill.installable) return { label: "Hardware", cls: "bg-muted text-muted-foreground border-border" };
  return { label: "VPS", cls: "bg-success/15 text-success border-success/30" };
}

function isUnavailable(skill: Skill) {
  return skill.platform === "mac" || !skill.installable;
}

/* ── Install Command Box ──────────────────────────────── */

function InstallBox() {
  const [pm, setPm] = useState<"npx" | "pnpm" | "bun">("npx");
  const [copied, setCopied] = useState(false);

  const commands: Record<typeof pm, string> = {
    npx: "npx clawhub@latest install sonoscli",
    pnpm: "pnpm dlx clawhub@latest install sonoscli",
    bun: "bunx clawhub@latest install sonoscli",
  };

  function handleCopy() {
    navigator.clipboard.writeText(commands[pm]);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="glass-card-glow glow-accent rounded-2xl p-6 space-y-4 max-w-lg w-full">
      <div className="glass-card-glow-effect" />
      <div className="relative z-10 space-y-4">
        <p className="text-sm text-muted-foreground">
          Search skills. Versioned, rollback-ready.
        </p>
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">Install any skill folder in one shot:</p>
          <div className="flex items-center gap-0.5 bg-secondary/60 backdrop-blur-sm rounded-full p-0.5">
            {(["npx", "pnpm", "bun"] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPm(p)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  pm === p ? "bg-primary/20 text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 bg-secondary/40 backdrop-blur-sm border border-border/30 rounded-xl px-4 py-3">
          <code className="text-sm text-foreground font-mono flex-1 select-all">{commands[pm]}</code>
          <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors">
            {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Hero Section ─────────────────────────────────────── */

function HeroSection() {
  return (
    <div className="aurora-glow rounded-2xl px-6 py-8">
      <div className="relative z-10 flex flex-col lg:flex-row items-start lg:items-center gap-8 lg:gap-12">
        <div className="space-y-5 max-w-xl flex-shrink-0">
          <Badge variant="outline" className="bg-accent/10 text-accent border-accent/30 text-xs rounded-full px-3">
            Lobster-light. Agent-right.
          </Badge>
          <h1 className="text-4xl lg:text-5xl font-display font-bold text-foreground leading-tight tracking-tight">
            ClawHub, the skill dock for sharp agents.
          </h1>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-md">
            Upload AgentSkills bundles, version them like npm, and make them searchable with vectors. No gatekeeping, just signal.
          </p>
          <div className="flex items-center gap-3">
            <button className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 font-display font-bold">
              <Plus className="h-4 w-4" /> Publish a skill
            </button>
            <button className="flex items-center gap-2 px-5 py-2.5 text-sm rounded-full bg-secondary/40 backdrop-blur-md border border-border/30 text-foreground hover:bg-secondary/60 transition-colors font-display font-medium">
              <Search className="h-4 w-4" /> Browse skills
            </button>
          </div>
        </div>
        <InstallBox />
      </div>
    </div>
  );
}


/* ── Activate Skill Modal ─────────────────────────────── */

function ActivateSkillModal({
  skill,
  open,
  onOpenChange,
}: {
  skill: Skill | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { agents } = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const { agentSkills } = useAgentSkills(selectedAgentId);
  const [credential, setCredential] = useState("");
  const [activating, setActivating] = useState(false);

  const isAlreadyActive = useMemo(
    () => agentSkills.some((s) => s.name.toLowerCase() === skill?.name.toLowerCase()),
    [agentSkills, skill]
  );

  async function handleActivate() {
    if (!skill || !selectedAgentId) return;
    setActivating(true);
    try {
      const config = getGatewayConfig();
      const agentIdClean = selectedAgentId.replace(/^openclaw:/, "");

      if (skill.requiresCredentials && credential.trim()) {
        const toolsRes = await fetch(`${config.url}/api/files/${agentIdClean}/TOOLS.md`, {
          headers: { Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}` },
        });
        let toolsContent = "";
        if (toolsRes.ok) {
          const d = await toolsRes.json();
          toolsContent = d.content ?? "";
        }
        const entry = `\n\n## ${skill.name}\nCredential: ${credential.trim()}`;
        await fetch(`${config.url}/api/files/${agentIdClean}`, {
          method: "POST",
          headers: { Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ filename: "TOOLS.md", content: toolsContent + entry }),
        });
      }

      await fetch(`${config.url}/api/skills/${agentIdClean}/request`, {
        method: "POST",
        headers: { Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ skill: skill.name }),
      });

      onOpenChange(false);
      setSelectedAgentId(null);
      setCredential("");
    } catch (err) {
      console.error("Erro ao ativar skill:", err);
    } finally {
      setActivating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setSelectedAgentId(null); setCredential(""); } }}>
      <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-md rounded-2xl p-0 gap-0">
        <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
          <DialogTitle className="flex items-center gap-2 font-display font-bold text-foreground relative z-10">
            <Zap className="h-4 w-4 text-primary" />
            Ativar {skill?.name}
          </DialogTitle>
          <DialogDescription className="relative z-10">Escolha o agente que deve usar esta skill</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 p-6">
          <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Selecione um agente:</p>
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl border text-sm transition-all text-left ${
                  selectedAgentId === agent.id
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border/20 bg-secondary/15 text-muted-foreground hover:bg-secondary/30 hover:text-foreground"
                }`}
              >
                <div className={`h-6 w-6 rounded-full shrink-0 flex items-center justify-center ${
                  selectedAgentId === agent.id ? "ring-2 ring-primary/30 bg-gradient-to-br from-primary/60 to-primary/20" : "bg-secondary/40"
                }`}>
                  <Bot className="h-3 w-3" />
                </div>
                <span className="text-xs truncate">{agent.name}</span>
              </button>
            ))}
          </div>

          {selectedAgentId && isAlreadyActive && (
            <Badge variant="secondary" className="text-xs flex items-center gap-1 rounded-full"><CheckCircle2 className="h-3 w-3" /> Já ativo neste agente</Badge>
          )}

          {skill?.requiresCredentials && selectedAgentId && !isAlreadyActive && (
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground flex items-center gap-1.5 font-semibold uppercase tracking-wider">
                <Key className="h-3 w-3" />
                {skill.requiresCredentials}
              </label>
              <div className="glass-input px-3 py-0">
                <input
                  type="password"
                  value={credential}
                  onChange={(e) => setCredential(e.target.value)}
                  placeholder="Cole a chave aqui..."
                  className="w-full bg-transparent py-2.5 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:outline-none"
                />
              </div>
            </div>
          )}

          <button
            onClick={handleActivate}
            disabled={!selectedAgentId || isAlreadyActive || activating || (!!skill?.requiresCredentials && !credential.trim())}
            className="w-full py-3 rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground font-display font-bold text-sm transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg shadow-primary/20 flex items-center justify-center gap-2"
          >
            {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            {isAlreadyActive ? "Já ativo" : "Ativar para agente"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── All Skills Grid ──────────────────────────────────── */

function AllSkillsGrid() {
  const { skills, loading, error } = useSkills();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<PlatformFilter>("all");
  const [activateSkill, setActivateSkill] = useState<Skill | null>(null);

  const filtered = useMemo(() => {
    let list = skills;
    if (filter === "vps") list = list.filter((s) => s.installable && s.platform !== "mac");
    else if (filter === "mac") list = list.filter((s) => s.platform === "mac");
    else if (filter === "hardware") list = list.filter((s) => !s.installable);
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.name.toLowerCase().includes(q));
    }
    return list;
  }, [skills, search, filter]);

  const filters: { key: PlatformFilter; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "vps", label: "Instaláveis no VPS" },
    { key: "mac", label: "Só Mac" },
    { key: "hardware", label: "Hardware específico" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card-glow rounded-2xl p-8 text-center space-y-2">
        <div className="glass-card-glow-effect" />
        <AlertCircle className="h-6 w-6 text-destructive mx-auto relative z-10" />
        <p className="text-sm text-muted-foreground relative z-10">{error}</p>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <div className="space-y-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-0.5 bg-secondary/40 backdrop-blur-sm border border-border/30 rounded-full p-1">
            {filters.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                  filter === f.key
                    ? "bg-primary/20 text-primary shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="glass-input flex items-center gap-2 px-3 flex-1 max-w-sm">
            <Search className="h-4 w-4 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar skill..."
              className="w-full bg-transparent py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <span className="text-xs text-muted-foreground font-mono">{filtered.length} skills</span>
        </div>

        {filtered.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((skill) => {
              const badge = getPlatformBadge(skill);
              const unavailable = isUnavailable(skill);

              return (
                <div
                  key={skill.name}
                  className={`glass-card-glow rounded-2xl p-4 space-y-3 transition-opacity ${unavailable ? "opacity-50" : ""}`}
                >
                  <div className="glass-card-glow-effect" />
                  <div className="relative z-10 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                          <Zap className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <span className="text-sm font-display font-semibold text-foreground truncate">
                          {skill.name}
                        </span>
                      </div>
                      <Badge variant="outline" className={`text-[10px] shrink-0 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </Badge>
                    </div>

                    <p className="text-xs text-muted-foreground line-clamp-2">
                      {skill.description || "Sem descrição disponível"}
                    </p>

                    {skill.requiresCredentials && (
                      <p className="text-[11px] text-warning flex items-center gap-1">
                        <Key className="h-3 w-3" />
                        Precisa de {skill.requiresCredentials}
                      </p>
                    )}

                    {unavailable ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="w-full">
                            <button disabled className="w-full py-2 rounded-full text-xs bg-secondary/40 backdrop-blur-sm border border-border/30 text-muted-foreground opacity-60 cursor-not-allowed">
                              Não disponível
                            </button>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p>Não disponível no VPS Linux</p>
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      <button
                        className="w-full py-2 rounded-full text-xs bg-secondary/40 backdrop-blur-sm border border-border/30 text-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all flex items-center justify-center gap-1.5 font-medium"
                        onClick={() => setActivateSkill(skill)}
                      >
                        <Zap className="h-3 w-3" /> Ativar para agente
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="glass-card-glow rounded-2xl p-12 text-center space-y-2">
            <div className="glass-card-glow-effect" />
            <div className="relative z-10 space-y-2">
              <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                <Zap className="h-6 w-6 text-primary" />
              </div>
              <p className="text-sm text-muted-foreground">
                {search || filter !== "all" ? "Nenhuma skill encontrada" : "Nenhuma skill disponível"}
              </p>
            </div>
          </div>
        )}

        <ActivateSkillModal
          skill={activateSkill}
          open={!!activateSkill}
          onOpenChange={(v) => { if (!v) setActivateSkill(null); }}
        />
      </div>
    </TooltipProvider>
  );
}

/* ── Skills by Agent Tab ──────────────────────────────── */

function AgentSkillsTab() {
  const { agents } = useAgents();
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const { agentSkills, loading, refetch } = useAgentSkills(selectedAgentId);
  const { skills: allSkills } = useSkills();
  const [showAddModal, setShowAddModal] = useState(false);
  const [addingSkill, setAddingSkill] = useState<string | null>(null);
  const [removingSkill, setRemovingSkill] = useState<string | null>(null);

  const agentSkillNames = useMemo(
    () => new Set(agentSkills.map((s) => s.name.toLowerCase())),
    [agentSkills]
  );

  const availableToAdd = useMemo(
    () => allSkills.filter((s) => !agentSkillNames.has(s.name.toLowerCase())),
    [allSkills, agentSkillNames]
  );

  async function addSkillToAgent(skillName: string) {
    if (!selectedAgentId) return;
    setAddingSkill(skillName);
    try {
      const config = getGatewayConfig();
      const filesRes = await fetch(`${config.url}/api/files/${selectedAgentId}`, {
        headers: { Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}` },
      });
      let soulContent = "";
      if (filesRes.ok) {
        const filesData = await filesRes.json();
        const soulFile = (filesData.files ?? []).find((f: any) => f.name === "SOUL.md");
        if (soulFile) {
          const contentRes = await fetch(
            `${config.url}/api/files/${selectedAgentId}/SOUL.md`,
            { headers: { Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}` } }
          );
          if (contentRes.ok) {
            const cData = await contentRes.json();
            soulContent = cData.content ?? "";
          }
        }
      }
      const updated = soulContent
        ? `${soulContent}\n\n## Skill: ${skillName}\nUse a skill "${skillName}" quando apropriado.`
        : `# SOUL\n\n## Skill: ${skillName}\nUse a skill "${skillName}" quando apropriado.`;

      await fetch(`${config.url}/api/files/${selectedAgentId}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ filename: "SOUL.md", content: updated }),
      });
      refetch();
    } catch (err) {
      console.error("Erro ao adicionar skill:", err);
    } finally {
      setAddingSkill(null);
      setShowAddModal(false);
    }
  }

  async function removeSkillFromAgent(skillName: string) {
    if (!selectedAgentId) return;
    setRemovingSkill(skillName);
    try {
      const config = getGatewayConfig();
      const contentRes = await fetch(
        `${config.url}/api/files/${selectedAgentId}/SOUL.md`,
        { headers: { Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}` } }
      );
      if (contentRes.ok) {
        const cData = await contentRes.json();
        let content: string = cData.content ?? "";
        const regex = new RegExp(
          `\\n*## Skill: ${skillName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?(?=\\n## |$)`,
          "gi"
        );
        content = content.replace(regex, "").trim();

        await fetch(`${config.url}/api/files/${selectedAgentId}`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${gatewayNaoPortado("ClawHub")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ filename: "SOUL.md", content }),
        });
        refetch();
      }
    } catch (err) {
      console.error("Erro ao remover skill:", err);
    } finally {
      setRemovingSkill(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        {agents.map((agent) => (
          <button
            key={agent.id}
            onClick={() => setSelectedAgentId(agent.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full border text-sm transition-all ${
              selectedAgentId === agent.id
                ? "bg-primary/10 text-primary border-primary/30 shadow-sm shadow-primary/10"
                : "bg-secondary/30 backdrop-blur-sm text-muted-foreground border-border/30 hover:text-foreground hover:bg-secondary/50"
            }`}
          >
            <Bot className="h-3.5 w-3.5" />
            {agent.name}
          </button>
        ))}
      </div>

      {!selectedAgentId ? (
        <div className="glass-card-glow glow-accent rounded-2xl">
          <div className="glass-card-glow-effect" />
          <div className="relative z-10 p-12 flex flex-col items-center justify-center text-center space-y-2">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Bot className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Selecione um agente para ver suas skills</p>
            <p className="text-xs text-muted-foreground/60">Skills são ativadas por menção no SOUL.md / AGENTS.md do agente</p>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">
              Skills mencionadas no SOUL.md e AGENTS.md — qualquer agente pode usar qualquer skill global
            </p>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-full bg-gradient-to-r from-primary to-[hsl(260,70%,55%)] text-primary-foreground hover:opacity-90 transition-opacity shadow-lg shadow-primary/20 font-display font-bold"
            >
              <Plus className="h-3.5 w-3.5" /> Adicionar skill
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : agentSkills.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {agentSkills.map((s) => (
                <div key={s.name} className="glass-card-glow rounded-2xl p-4 group">
                  <div className="glass-card-glow-effect" />
                  <div className="relative z-10 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center">
                        <Zap className="h-3.5 w-3.5 text-primary" />
                      </div>
                      <span className="text-sm font-display font-semibold text-foreground">{s.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px] rounded-full">{s.source}</Badge>
                      <button
                        onClick={() => removeSkillFromAgent(s.name)}
                        disabled={removingSkill === s.name}
                        className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover:opacity-100 transition-all disabled:opacity-50"
                      >
                        {removingSkill === s.name ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="glass-card-glow rounded-2xl p-10 text-center space-y-2">
              <div className="glass-card-glow-effect" />
              <div className="relative z-10 space-y-2">
                <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Zap className="h-5 w-5 text-primary" />
                </div>
                <p className="text-sm text-muted-foreground">Nenhuma skill mencionada nos arquivos deste agente</p>
              </div>
            </div>
          )}

          <Dialog open={showAddModal} onOpenChange={setShowAddModal}>
            <DialogContent className="glass-card border-border/30 bg-card/95 backdrop-blur-xl max-w-lg max-h-[70vh] overflow-y-auto rounded-2xl p-0 gap-0">
              <DialogHeader className="aurora-glow px-6 py-4 border-b border-border/30">
                <DialogTitle className="font-display font-bold text-foreground relative z-10">Adicionar Skill</DialogTitle>
                <DialogDescription className="relative z-10">Selecione uma skill para adicionar ao SOUL.md do agente</DialogDescription>
              </DialogHeader>
              <div className="space-y-2 p-4">
                {availableToAdd.length > 0 ? (
                  availableToAdd.map((skill) => (
                    <button
                      key={skill.name}
                      onClick={() => addSkillToAgent(skill.name)}
                      disabled={addingSkill === skill.name}
                      className="w-full flex items-center justify-between p-3 rounded-xl border border-border/30 hover:bg-primary/5 hover:border-primary/30 transition-all text-left disabled:opacity-50"
                    >
                      <div className="flex items-center gap-2">
                        <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                          <Zap className="h-3.5 w-3.5 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{skill.name}</p>
                          <p className="text-xs text-muted-foreground line-clamp-1">{skill.description || "Sem descrição"}</p>
                        </div>
                      </div>
                      {addingSkill === skill.name ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Plus className="h-4 w-4 text-muted-foreground" />
                      )}
                    </button>
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-6">Todas as skills já estão adicionadas</p>
                )}
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}
    </div>
  );
}

/* ── Custom Skills Tab ────────────────────────────────── */

function CustomSkillsTab() {
  const { skills } = useSkills();
  const customSkills = useMemo(() => skills.filter((s) => s.type === "custom"), [skills]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Skills customizadas instaladas em ~/.openclaw/skills/</p>
      {customSkills.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {customSkills.map((skill) => (
            <div key={skill.name} className="glass-card-glow rounded-2xl p-4 space-y-2">
              <div className="glass-card-glow-effect" />
              <div className="relative z-10 space-y-2">
                <div className="flex items-center gap-2">
                  <div className="h-7 w-7 rounded-lg bg-primary/15 flex items-center justify-center">
                    <Puzzle className="h-3.5 w-3.5 text-primary" />
                  </div>
                  <span className="text-sm font-display font-semibold text-foreground">{skill.name}</span>
                  <Badge variant="default" className="text-[10px] rounded-full">custom</Badge>
                </div>
                <p className="text-xs text-muted-foreground">{skill.description || "Sem descrição"}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="glass-card-glow glow-accent rounded-2xl">
          <div className="glass-card-glow-effect" />
          <div className="relative z-10 p-12 flex flex-col items-center text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Puzzle className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">Nenhuma skill customizada instalada</p>
            <button
              className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-full bg-secondary/40 backdrop-blur-sm border border-border/30 text-foreground hover:bg-secondary/60 transition-colors font-medium"
              onClick={() => window.dispatchEvent(new CustomEvent("open-orchestrator"))}
            >
              <MessageSquare className="h-3.5 w-3.5" /> Solicitar nova skill
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── MCPs Tab ─────────────────────────────────────────── */

function McpsTab() {
  return (
    <div className="glass-card-glow glow-accent rounded-2xl">
      <div className="glass-card-glow-effect" />
      <div className="relative z-10 p-12 flex flex-col items-center text-center space-y-3">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <ServerCog className="h-6 w-6 text-primary" />
        </div>
        <p className="text-sm text-foreground font-display font-medium">Nenhum MCP configurado</p>
        <p className="text-xs text-muted-foreground">Em breve.</p>
        <button
          className="flex items-center gap-1.5 px-4 py-2 text-xs rounded-full bg-secondary/40 backdrop-blur-sm border border-border/30 text-foreground hover:bg-secondary/60 transition-colors font-medium"
          onClick={() => window.dispatchEvent(new CustomEvent("open-orchestrator"))}
        >
          <MessageSquare className="h-3.5 w-3.5" /> Solicitar integração MCP
        </button>
      </div>
    </div>
  );
}

/* ── Main Page ────────────────────────────────────────── */

export default function SkillsPage() {

  return (
    <div className="p-6 space-y-10">
      {/* Hero */}
      <HeroSection />

      {/* Tabs */}
      <Tabs defaultValue="library" className="w-full">
        <TabsList className="bg-secondary/40 backdrop-blur-sm border border-border/30 rounded-full p-1">
          <TabsTrigger value="library" className="gap-1.5 text-xs rounded-full data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Zap className="h-3.5 w-3.5" /> Biblioteca
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1.5 text-xs rounded-full data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Bot className="h-3.5 w-3.5" /> Por Agente
          </TabsTrigger>
          <TabsTrigger value="custom" className="gap-1.5 text-xs rounded-full data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <Puzzle className="h-3.5 w-3.5" /> Customizadas
          </TabsTrigger>
          <TabsTrigger value="mcps" className="gap-1.5 text-xs rounded-full data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            <ServerCog className="h-3.5 w-3.5" /> MCPs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="library">
          <AllSkillsGrid />
        </TabsContent>
        <TabsContent value="agents">
          <AgentSkillsTab />
        </TabsContent>
        <TabsContent value="custom">
          <CustomSkillsTab />
        </TabsContent>
        <TabsContent value="mcps">
          <McpsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
