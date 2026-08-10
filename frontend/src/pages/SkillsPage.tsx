import { useMemo, useState } from "react";
import { Puzzle, Plus, Search, Loader2, AlertCircle, AlertTriangle, Bot, Trash2, Copy, Check, Github, Globe, FileText, User as UserIcon, Star, X, Pencil, CheckCircle2, CircleDashed, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useManagedSkills, type ManagedSkill, type SkillSource, type SkillSyncStatus } from "@/hooks/use-managed-skills";
import { useAgents } from "@/hooks/use-agents";
import { toast } from "@/hooks/use-toast";

/* ── Source badges ────────────────────────────────────── */
const SOURCE_META: Record<SkillSource, { label: string; icon: React.ElementType; cls: string }> = {
  clawhub: { label: "ClawHub", icon: Puzzle, cls: "bg-primary/15 text-primary border-primary/30" },
  git: { label: "Git", icon: Github, cls: "bg-info/15 text-info border-info/30" },
  manual: { label: "Manual", icon: FileText, cls: "bg-muted text-muted-foreground border-border" },
  agent: { label: "Agente", icon: Bot, cls: "bg-success/15 text-success border-success/30" },
};

function SyncDot({ status }: { status: SkillSyncStatus | "unassigned" }) {
  const cls =
    status === "synced" ? "bg-success" :
    status === "pending" ? "bg-warning" :
    status === "error" ? "bg-destructive" :
    "bg-muted-foreground/40";
  const label =
    status === "synced" ? "Sincronizado" :
    status === "pending" ? "Pendente" :
    status === "error" ? "Erro" :
    "Não atribuído";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
      <span className={`h-2 w-2 rounded-full ${cls}`} />
      {label}
    </span>
  );
}

function AgentAvatar({ name, avatar_url, size = 24 }: { name: string; avatar_url?: string | null; size?: number }) {
  const initial = (name?.[0] ?? "?").toUpperCase();
  return (
    <div
      className="rounded-full ring-2 ring-background overflow-hidden bg-primary/20 flex items-center justify-center text-[10px] font-semibold text-primary shrink-0"
      style={{ width: size, height: size }}
      title={name}
    >
      {avatar_url ? (
        <img src={avatar_url} alt={name} className="h-full w-full object-cover" />
      ) : (
        initial
      )}
    </div>
  );
}

/* ── Install skill dialog ─────────────────────────────── */
function InstallSkillDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: () => void;
}) {
  const { agents } = useAgents();
  const { create } = useManagedSkills();
  const [tab, setTab] = useState<"git" | "manual" | "clawhub">("manual");
  const [busy, setBusy] = useState(false);

  // shared
  const [selectedAgents, setSelectedAgents] = useState<Set<string>>(new Set());
  const [isDefault, setIsDefault] = useState(false);

  // manual
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [content, setContent] = useState("");

  // git
  const [gitUrl, setGitUrl] = useState("");
  const [gitName, setGitName] = useState("");

  function reset() {
    setSelectedAgents(new Set());
    setIsDefault(false);
    setSlug("");
    setName("");
    setDescription("");
    setContent("");
    setGitUrl("");
    setGitName("");

    setTab("manual");
  }

  function toggleAgent(id: string) {
    setSelectedAgents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function normalizeGitCloneUrl(rawInput: string): { ok: true; cloneUrl: string; slug: string } | { ok: false; title: string; description: string } {
    const raw = rawInput.trim();

    if (!/^https?:\/\//i.test(raw)) {
      return {
        ok: false,
        title: "URL inválida",
        description: "Cole apenas a URL HTTPS do repositório Git, não a mensagem de erro retornada pelo gateway.",
      };
    }

    if (/\s/.test(raw)) {
      return {
        ok: false,
        title: "URL inválida",
        description: "O campo deve conter somente uma URL de repositório, sem texto adicional.",
      };
    }

    let parsed: URL;
    try {
      parsed = new URL(raw);
    } catch {
      return {
        ok: false,
        title: "URL inválida",
        description: "Use uma URL HTTPS válida do repositório Git.",
      };
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      return {
        ok: false,
        title: "URL inválida",
        description: "Use uma URL HTTPS válida do repositório Git.",
      };
    }

    parsed.hash = "";
    parsed.search = "";

    if (parsed.hostname.toLowerCase() === "github.com") {
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts.length < 2) {
        return {
          ok: false,
          title: "URL inválida",
          description: "Use a URL do repositório GitHub no formato https://github.com/usuario/repositorio ou aponte para uma subpasta com /tree/branch/caminho.",
        };
      }
      const owner = parts[0];
      const repo = parts[1].replace(/\.git$/i, "");
      // Subpath (/tree/branch/...) é suportado — o gateway converte automaticamente.
      // Deriva o slug do último segmento da subpasta quando houver, senão do repo.
      let slugSource = repo;
      if (parts.length > 2 && parts[2] === "tree" && parts.length > 4) {
        slugSource = parts[parts.length - 1];
      }
      const slug = slugSource.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) {
        return { ok: false, title: "URL inválida", description: "Não foi possível identificar o nome da skill." };
      }
      return { ok: true, cloneUrl: parsed.toString(), slug };
    }


    if (!/\.git$/i.test(parsed.pathname)) {
      return {
        ok: false,
        title: "URL inválida",
        description: "Para repositórios fora do GitHub, use a URL HTTPS completa terminada em .git.",
      };
    }

    const repoName = parsed.pathname.split("/").filter(Boolean).pop()?.replace(/\.git$/i, "") ?? "";
    const slug = repoName.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) {
      return { ok: false, title: "URL inválida", description: "Não foi possível identificar o nome do repositório." };
    }

    return { ok: true, cloneUrl: parsed.toString(), slug };
  }

  async function handleSubmitManual() {
    if (!slug.trim() || !name.trim() || !content.trim()) {
      toast({ title: "Campos obrigatórios", description: "Slug, nome e conteúdo do SKILL.md", variant: "destructive" });
      return;
    }
    setBusy(true);
    try {
      const result = await create({
        slug: slug.trim(),
        name: name.trim(),
        description: description.trim() || undefined,
        content,
        source: "manual",
        is_default: isDefault,
        agent_ids: Array.from(selectedAgents),
      });
      const failed = Object.entries(result?.sync ?? {}).filter(([, r]) => !r.ok);
      if (failed.length) {
        const errors = failed.map(([agent, r]) => `${agent}: ${r.error ?? "erro"}`).join("; ");
        toast({
          title: "Skill criada com falhas de sincronização",
          description: errors,
          variant: "destructive",
        });
      } else {
        toast({ title: "Skill instalada", description: `${name} sincronizada` });
      }
      onCreated();
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha ao criar skill", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  async function handleSubmitGit() {
    if (!gitUrl.trim()) {
      toast({ title: "URL obrigatória", variant: "destructive" });
      return;
    }

    const normalized = normalizeGitCloneUrl(gitUrl);
    if (normalized.ok === false) {
      toast({
        title: normalized.title,
        description: normalized.description,
        variant: "destructive",
      });
      return;
    }

    const { cloneUrl, slug: guessSlug } = normalized;
    const finalName = gitName.trim() || guessSlug || "Git Skill";
    setBusy(true);
    try {
      await create({
        slug: guessSlug || `git-${Date.now()}`,
        name: finalName,
        description: `Instalada via Git: ${cloneUrl}`,
        content: `# Instalação via Git\n\nRepositório: ${cloneUrl}\n\nSincronização pendente — a Lia processará este item no próximo ciclo.`,
        source: "git",
        source_url: cloneUrl,
        is_default: isDefault,
        agent_ids: Array.from(selectedAgents),
      });

      toast({
        title: "Skill enfileirada",
        description: "A Lia buscará o SKILL.md no repositório e sincronizará em seguida.",
      });
      onCreated();
      reset();
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-display">
            <Plus className="h-4 w-4 text-primary" />
            Instalar Skill
          </DialogTitle>
          <DialogDescription>
            Adicione uma skill ao inventário do HS.OS e escolha quais agentes vão recebê-la.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={tab} onValueChange={(v) => setTab(v as any)} className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="manual" className="flex-1 gap-1.5">
              <FileText className="h-3.5 w-3.5" /> Manual
            </TabsTrigger>
            <TabsTrigger value="git" className="flex-1 gap-1.5">
              <Github className="h-3.5 w-3.5" /> Git
            </TabsTrigger>
            <TabsTrigger value="clawhub" disabled className="flex-1 gap-1.5">
              <Puzzle className="h-3.5 w-3.5" /> ClawHub
              <Badge variant="outline" className="ml-1 text-[9px] rounded-full">Em breve</Badge>
            </TabsTrigger>
          </TabsList>

          {/* Manual */}
          <TabsContent value="manual" className="space-y-3 pt-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Slug (único)</label>
                <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="loop-architecture" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Nome</label>
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Loop Architecture" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Descrição</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Descrição curta que aparece na UI" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Conteúdo do SKILL.md</label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="# Skill\n\nCole aqui o conteúdo completo do SKILL.md"
                className="min-h-[180px] font-mono text-xs"
              />
            </div>
          </TabsContent>

          {/* Git */}
          <TabsContent value="git" className="space-y-3 pt-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nome da skill</label>
              <Input value={gitName} onChange={(e) => setGitName(e.target.value)} placeholder="Ex: Marketing Social Skills" />
              <p className="text-[11px] text-muted-foreground">
                Opcional — se vazio, usamos o nome do repositório.
              </p>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">URL do repositório Git</label>
              <Input value={gitUrl} onChange={(e) => setGitUrl(e.target.value)} placeholder="https://github.com/owner/skill-repo" />
              <p className="text-[11px] text-muted-foreground">
                A skill é registrada como pendente — a Lia executa <code className="text-[10px] bg-secondary/40 px-1 rounded">openclaw skills install</code> no próximo ciclo.
              </p>
            </div>
          </TabsContent>


          {/* ClawHub disabled */}
          <TabsContent value="clawhub" className="pt-4">
            <div className="glass-card rounded-2xl p-6 text-center space-y-2">
              <Puzzle className="h-6 w-6 text-muted-foreground mx-auto" />
              <p className="text-sm text-foreground font-display">API pública do ClawHub em breve</p>
              <p className="text-xs text-muted-foreground">
                Enquanto isso, baixe o SKILL.md manualmente e cole na aba <span className="text-foreground">Manual</span>.
              </p>
            </div>
          </TabsContent>
        </Tabs>

        {tab !== "clawhub" && (
          <div className="space-y-3 border-t border-border/30 pt-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <p className="text-xs font-medium text-foreground">Padrão para todos os agentes</p>
                <p className="text-[11px] text-muted-foreground">
                  Vai para <code className="text-[10px] bg-secondary/40 px-1 rounded">defaults.skills</code> do openclaw.json.
                </p>
              </div>
              <Switch checked={isDefault} onCheckedChange={setIsDefault} />
            </div>

            {!isDefault && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-muted-foreground">Super agentes que vão receber</p>
                <div className="flex flex-wrap gap-1.5 max-h-40 overflow-y-auto p-2 rounded-md border border-border/40 bg-secondary/20">
                  {agents.length === 0 && (
                    <span className="text-xs text-muted-foreground">Nenhum agente disponível.</span>
                  )}
                  {agents.map((a) => {
                    const active = selectedAgents.has(a.id);
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => toggleAgent(a.id)}
                        className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] transition-colors ${
                          active
                            ? "bg-primary/15 border-primary/40 text-primary"
                            : "border-border/40 text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        <Bot className="h-3 w-3" />
                        <span className="capitalize">{a.name}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            onClick={tab === "git" ? handleSubmitGit : handleSubmitManual}
            disabled={busy || tab === "clawhub"}
            className="gap-1.5"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Instalar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ── Manage skill dialog ──────────────────────────────── */
function ManageSkillDialog({
  skill,
  open,
  onOpenChange,
}: {
  skill: ManagedSkill | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { agents } = useAgents();
  const { assign, retry, update, remove } = useManagedSkills();
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [editingContent, setEditingContent] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  if (!skill) return null;

  const assignedById = new Map(skill.agent_skills.map((s) => [s.agent_id, s]));

  async function toggleAgent(agentId: string) {
    setBusy(`toggle-${agentId}`);
    const nomeAgente = agents.find((x) => x.id === agentId)?.name ?? agentId;
    const removendo = !!assignedById.get(agentId);
    try {
      const r = await assign(skill.id, agentId, removendo);
      if (removendo) {
        // ⚠️ O gateway não tem desinstalação (`skills.uninstall` e irmãos
        // respondem `unknown method`). O vínculo sai do sistema e a skill
        // some da lista do agente, mas o arquivo continua no workspace dele
        // até alguém removê-lo na VPS. O texto diz isso — anunciar "não tem
        // mais" seria mentira parcial.
        toast({
          title: `${nomeAgente} não usa mais esta skill`,
          description: `${skill.name} saiu da lista. O arquivo continua no workspace do agente.`,
        });
        return;
      }
      // A confirmação relata o RESULTADO da instalação, não o clique: já
      // aconteceu de a skill constar no painel e não existir no lugar que o
      // agente consulta. `r` é o que o gateway respondeu de fato.
      if (r?.ok) {
        toast({ title: `${nomeAgente} recebeu a skill`, description: `${skill.name} instalada e pronta para uso.` });
      } else {
        toast({
          title: `${nomeAgente} ainda NÃO recebeu a skill`,
          description: r?.error ?? "A instalação falhou. Use o botão de tentar novamente.",
          variant: "destructive",
        });
      }
    } catch (e) {
      // Sem isto o erro morria em silêncio: o chip clareava e nada acontecia.
      toast({
        title: "Não consegui alterar a skill",
        description: e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function retryAgent(agentId: string) {
    setBusy(`retry-${agentId}`);
    const nomeAgente = agents.find((x) => x.id === agentId)?.name ?? agentId;
    try {
      const r = await retry(skill.id, agentId);
      if (r?.ok) {
        toast({ title: `${nomeAgente} recebeu a skill`, description: `${skill.name} instalada e pronta para uso.` });
      } else {
        toast({
          title: "A instalação falhou de novo",
          description: r?.error ?? "A instalação falhou de novo. O erro completo está no selo do agente.",
          variant: "destructive",
        });
      }
    } catch (e) {
      toast({
        title: "Não consegui tentar de novo",
        description: e instanceof Error ? e.message : "Não foi possível concluir. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  }

  async function toggleDefault(v: boolean) {
    setBusy("default");
    try {
      await update({ skill_id: skill.id, is_default: v });
    } finally {
      setBusy(null);
    }
  }

  async function saveContent() {
    if (editingContent == null) return;
    setBusy("content");
    try {
      await update({ skill_id: skill.id, content: editingContent });
      setEditingContent(null);
      toast({ title: "Skill atualizada", description: "Versão incrementada e marcada como pendente" });
    } finally {
      setBusy(null);
    }
  }

  async function saveName() {
    const trimmed = (editingName ?? "").trim();
    if (!trimmed || trimmed === skill.name) {
      setEditingName(null);
      return;
    }
    setBusy("name");
    try {
      await update({ skill_id: skill.id, name: trimmed });
      setEditingName(null);
      toast({ title: "Nome atualizado", description: trimmed });
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha ao renomear", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  async function handleDelete() {
    setBusy("delete");
    try {
      await remove(skill.id);
      setDeleteConfirmOpen(false);
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: "Erro", description: e?.message ?? "Falha ao excluir skill", variant: "destructive" });
    } finally {
      setBusy(null);
    }
  }

  const sourceMeta = SOURCE_META[skill.source];
  const SourceIcon = sourceMeta.icon;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display flex items-center gap-2 flex-wrap">
            <Puzzle className="h-4 w-4 text-primary shrink-0" />
            {editingName == null ? (
              <>
                <span>{skill.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => setEditingName(skill.name)}
                  title="Renomear skill"
                >
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </Button>
              </>
            ) : (
              <div className="flex items-center gap-1.5 flex-1 min-w-[240px]">
                <Input
                  autoFocus
                  value={editingName}
                  onChange={(e) => setEditingName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); saveName(); }
                    if (e.key === "Escape") setEditingName(null);
                  }}
                  className="h-8 text-sm"
                  disabled={busy === "name"}
                />
                <Button size="sm" className="h-8 px-2" onClick={saveName} disabled={busy === "name"}>
                  {busy === "name" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={() => setEditingName(null)} disabled={busy === "name"}>
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
            {editingName == null && skill.is_default && (
              <Badge variant="outline" className="text-[10px] rounded-full gap-1">
                <Star className="h-2.5 w-2.5" /> Padrão
              </Badge>
            )}
          </DialogTitle>
          <DialogDescription className="flex items-center gap-2 mt-1">
            <span className="font-mono text-[11px]">slug: {skill.slug}</span>
            <span>·</span>
            <Badge variant="outline" className={`text-[10px] rounded-full gap-1 ${sourceMeta.cls}`}>
              <SourceIcon className="h-2.5 w-2.5" /> {sourceMeta.label}
            </Badge>
            <span>·</span>
            <span className="text-[11px] font-mono text-muted-foreground">v{skill.version}</span>
          </DialogDescription>
        </DialogHeader>

        {skill.description && (
          <p className="text-xs text-muted-foreground border-l-2 border-primary/40 pl-3 py-1">
            {skill.description}
          </p>
        )}

        {/* Agents */}
        <div className="space-y-2 border-t border-border/30 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-muted-foreground">
              Super agentes que usam
            </h3>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground">Padrão para todos</span>
              <Switch
                checked={skill.is_default}
                onCheckedChange={toggleDefault}
                disabled={busy === "default"}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto p-2 rounded-md border border-border/40 bg-secondary/20">
            {agents.length === 0 && (
              <span className="text-xs text-muted-foreground">Nenhum agente disponível.</span>
            )}
            {agents.map((a) => {
              const link = assignedById.get(a.id);
              const active = !!link;
              const status = link?.sync_status;
              const errorText = link?.sync_error;
              return (
                <div key={a.id} className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleAgent(a.id)}
                    disabled={busy === `toggle-${a.id}` || busy === `retry-${a.id}`}
                    className={`inline-flex items-center gap-1 px-2 py-1 rounded-full border text-[11px] transition-colors disabled:opacity-50 ${
                      active
                        ? "bg-primary/15 border-primary/40 text-primary"
                        : "border-border/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {busy === `toggle-${a.id}` || busy === `retry-${a.id}`
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Bot className="h-3 w-3" />}
                    <span className="capitalize">{a.name}</span>
                    {active && status === "synced" && <CheckCircle2 className="h-2.5 w-2.5 text-success" />}
                    {active && status === "error" && <AlertCircle className="h-2.5 w-2.5 text-destructive" />}
                    {active && (String(status) === "pending" || String(status) === "removing") && <CircleDashed className="h-2.5 w-2.5 animate-spin-slow text-warning" />}
                  </button>
                  {active && status === "error" && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => retryAgent(a.id)}
                          disabled={busy === `retry-${a.id}` || busy === `toggle-${a.id}`}
                          className="inline-flex items-center justify-center h-6 w-6 rounded-full border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors disabled:opacity-50"
                          title="Tentar sincronizar novamente"
                        >
                          {busy === `retry-${a.id}` ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RefreshCw className="h-3 w-3" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs">
                        <div className="space-y-1">
                          <p>Erro: {errorText ?? "falha ao sincronizar"}</p>
                          <p className="text-[11px] text-muted-foreground">Clique para tentar novamente</p>
                        </div>
                      </TooltipContent>
                    </Tooltip>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Content */}
        <div className="space-y-2 border-t border-border/30 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-display font-semibold uppercase tracking-wider text-muted-foreground">
              Conteúdo SKILL.md
            </h3>
            <div className="flex items-center gap-1">
              {editingContent == null ? (
                <>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => {
                      navigator.clipboard.writeText(skill.content);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    }}
                  >
                    {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                    {copied ? "Copiado" : "Copiar"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={() => setEditingContent(skill.content)}
                  >
                    <FileText className="h-3 w-3" /> Editar
                  </Button>
                </>
              ) : (
                <>
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setEditingContent(null)}>
                    Cancelar
                  </Button>
                  <Button size="sm" className="h-7 text-xs" onClick={saveContent} disabled={busy === "content"}>
                    {busy === "content" ? <Loader2 className="h-3 w-3 animate-spin" /> : "Salvar"}
                  </Button>
                </>
              )}
            </div>
          </div>
          {editingContent == null ? (
            <pre className="text-[11px] font-mono bg-secondary/20 border border-border/30 rounded-lg p-3 max-h-64 overflow-auto whitespace-pre-wrap break-words">
              {skill.content}
            </pre>
          ) : (
            <Textarea
              value={editingContent}
              onChange={(e) => setEditingContent(e.target.value)}
              className="min-h-[240px] font-mono text-xs"
            />
          )}
        </div>

        {/* Danger zone — far from the dialog close X */}
        <div className="border-t border-destructive/20 pt-4 mt-2">
          <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 p-3 gap-3">
            <div className="space-y-0.5 min-w-0">
              <p className="text-xs font-medium text-destructive">Excluir skill</p>
              <p className="text-[11px] text-muted-foreground">Remove a skill e todas as associações com agentes.</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteConfirmOpen(true)}
              disabled={busy === "delete"}
              className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive gap-1.5 shrink-0"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Excluir
            </Button>
          </div>
        </div>
      </DialogContent>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 font-display">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              Excluir skill?
            </AlertDialogTitle>
            <AlertDialogDescription>
              A skill <span className="font-medium text-foreground">{skill.name}</span> será removida permanentemente. Todas as associações com agentes serão perdidas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === "delete"}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={busy === "delete"}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-1.5"
            >
              {busy === "delete" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
              Excluir
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}

/* ── Main page ────────────────────────────────────────── */
type SourceFilter = "all" | SkillSource;

export default function SkillsPage() {
  const { skills, loading, error } = useManagedSkills();
  const { agents } = useAgents();
  const [installOpen, setInstallOpen] = useState(false);
  // Guarda o ID, não o objeto: o objeto é uma foto. Com o sincronizador da
  // VPS confirmando de forma assíncrona, o diálogo aberto precisa refletir o
  // realtime — senão o selo só atualiza fechando e reabrindo (aconteceu).
  const [manageSkillId, setManageSkillId] = useState<string | null>(null);
  const manageSkill = useMemo(
    () => skills.find((sk) => sk.id === manageSkillId) ?? null,
    [skills, manageSkillId],
  );
  const [filter, setFilter] = useState<SourceFilter>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    let list = skills;
    if (filter !== "all") list = list.filter((s) => s.source === filter);
    if (agentFilter !== "all") {
      list = list.filter((s) => s.agent_skills.some((as) => as.agent_id === agentFilter));
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          s.slug.toLowerCase().includes(q) ||
          (s.description ?? "").toLowerCase().includes(q)
      );
    }
    return list;
  }, [skills, filter, agentFilter, search]);

  const filters: { key: SourceFilter; label: string }[] = [
    { key: "all", label: "Todas" },
    { key: "clawhub", label: "ClawHub" },
    { key: "git", label: "Git" },
    { key: "manual", label: "Manual" },
    { key: "agent", label: "Agente" },
  ];

  return (
    <TooltipProvider>
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <div className="h-9 w-9 rounded-xl bg-primary/15 flex items-center justify-center">
                <Puzzle className="h-4 w-4 text-primary" />
              </div>
              <h1 className="text-2xl font-display font-bold text-foreground">Skills dos Super agentes</h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Inventário central de skills. Instale, distribua e acompanhe a sincronização com o OpenClaw.
            </p>
          </div>
          <Button onClick={() => setInstallOpen(true)} className="gap-1.5">
            <Plus className="h-4 w-4" /> Instalar skill
          </Button>
        </div>

        {/* Filters + search */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-0.5 bg-secondary/40 border border-border/30 rounded-full p-1">
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

          <Select value={agentFilter} onValueChange={setAgentFilter}>
            <SelectTrigger className="h-9 w-[200px] rounded-full bg-secondary/30 border-border/40 text-xs px-3 gap-2">
              <Bot className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <SelectValue placeholder="Filtrar por agente" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="all" className="text-xs">Todos os agentes</SelectItem>
              {agents.map((a) => (
                <SelectItem key={a.id} value={a.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    <Bot className="h-3 w-3 text-muted-foreground" />
                    <span className="capitalize">{a.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {agentFilter !== "all" && (
            <button
              onClick={() => setAgentFilter("all")}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-border/40 bg-secondary/30 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="h-3 w-3" />
              Limpar agente
            </button>
          )}

          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por nome ou slug..."
              className="pl-9 h-9 rounded-full bg-secondary/30 border-border/40 text-xs"
            />
          </div>
          <Badge variant="secondary" className="text-[10px] rounded-full">
            {filtered.length} de {skills.length}
          </Badge>
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="glass-card rounded-2xl p-8 text-center space-y-2">
            <AlertCircle className="h-6 w-6 text-destructive mx-auto" />
            <p className="text-sm text-muted-foreground">{error}</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center space-y-3">
            <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
              <Puzzle className="h-6 w-6 text-primary" />
            </div>
            <p className="text-sm text-muted-foreground">
              {skills.length === 0 ? "Nenhuma skill instalada ainda." : "Nenhuma skill corresponde ao filtro."}
            </p>
            {skills.length === 0 && (
              <Button variant="outline" size="sm" onClick={() => setInstallOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Instalar primeira skill
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filtered.map((skill) => {
              const meta = SOURCE_META[skill.source];
              const Icon = meta.icon;
              const agents = skill.agent_skills;
              const visibleAgents = agents.slice(0, 4);
              const extra = agents.length - visibleAgents.length;
              return (
                <div
                  key={skill.id}
                  className="glass-card rounded-2xl p-4 space-y-3 hover:bg-secondary/20 transition-colors flex flex-col"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-sm font-display font-semibold text-foreground truncate">
                          {skill.name}
                        </span>
                        {skill.is_default && (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Star className="h-3 w-3 text-primary shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>Padrão para todos os agentes</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <p className="text-[11px] font-mono text-muted-foreground truncate">{skill.slug}</p>
                    </div>
                    <Badge variant="outline" className={`text-[10px] rounded-full gap-1 shrink-0 ${meta.cls}`}>
                      <Icon className="h-2.5 w-2.5" />
                      {meta.label}
                    </Badge>
                  </div>

                  {skill.description && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
                  )}

                  <div className="flex items-center justify-between gap-1.5 mt-auto pt-2">
                    {agents.length === 0 ? (
                      <span className="text-[11px] text-muted-foreground italic">Sem agentes</span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"
                        title={agents.map((l) => l.agent.name).join(", ")}
                      >
                        <Bot className="h-3 w-3" />
                        {agents.length}
                      </span>
                    )}
                    {(() => {
                      if (agents.length === 0) return null;
                      const synced = agents.filter((a) => a.sync_status === "synced").length;
                      const hasError = agents.some((a) => a.sync_status === "error");
                      const pending = agents.filter((a) => a.sync_status === "pending").length;
                      const allSynced = synced === agents.length;
                      const firstError = agents.find((a) => a.sync_status === "error");
                      if (allSynced) {
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-success bg-success/10 border border-success/30 rounded-full px-2 py-0.5">
                                <CheckCircle2 className="h-2.5 w-2.5" />
                                Ativa
                              </span>
                            </TooltipTrigger>
                            <TooltipContent>Instalada e sincronizada em todos os agentes</TooltipContent>
                          </Tooltip>
                        );
                      }
                      if (hasError) {
                        return (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <span className="inline-flex items-center gap-1 text-[10px] font-medium text-destructive bg-destructive/10 border border-destructive/30 rounded-full px-2 py-0.5">
                                <AlertCircle className="h-2.5 w-2.5" />
                                Erro
                              </span>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <div className="space-y-1">
                                <p>Falha ao sincronizar com o gateway</p>
                                {firstError?.sync_error && (
                                  <p className="text-[11px] text-muted-foreground">{firstError.sync_error}</p>
                                )}
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        );
                      }
                      return (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1 text-[10px] font-medium text-warning bg-warning/10 border border-warning/30 rounded-full px-2 py-0.5">
                              <CircleDashed className="h-2.5 w-2.5 animate-spin-slow" />
                              {synced}/{agents.length}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>
                            {pending === agents.length
                              ? "Aguardando processamento assíncrono"
                              : "Sincronização pendente"}
                          </TooltipContent>
                        </Tooltip>
                      );
                    })()}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full h-8 text-xs"
                    onClick={() => setManageSkillId(skill.id)}
                  >
                    Gerenciar
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <InstallSkillDialog
          open={installOpen}
          onOpenChange={setInstallOpen}
          onCreated={() => {}}
        />
        <ManageSkillDialog
          skill={manageSkill}
          open={!!manageSkill}
          onOpenChange={(v) => { if (!v) setManageSkillId(null); }}
        />
      </div>
    </TooltipProvider>
  );
}
