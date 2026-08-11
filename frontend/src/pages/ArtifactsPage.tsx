import { api } from "@/lib/api";
import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuthContext } from "@/contexts/auth-context";
import LiveArtifactViewer from "@/components/LiveArtifactViewer";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Zap, Plus, Search, MoreHorizontal, ExternalLink, Copy, Trash2, Link2, Loader2, Globe, Pause, Bot,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";


interface LiveArtifactRow {
  id: string;
  agent_id: string | null;
  title: string;
  refresh_interval: number;
  is_published: boolean;
  published_slug: string | null;
  updated_at: string;
  view_count: number;
}

type Filter = "all" | "mine" | "published";

const LIVE_INTERVALS = [
  { label: "15s", value: 15 },
  { label: "30s", value: 30 },
  { label: "1min", value: 60 },
  { label: "5min", value: 300 },
  { label: "Manual", value: 0 },
];

const DEFAULT_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #0a0a0a; color: #fff; padding: 24px; }
    h1 { margin: 0 0 12px; font-size: 20px; }
    ul { margin: 0; padding-left: 20px; }
    li { padding: 6px 0; border-bottom: 1px solid #222; }
    .stamp { color: #888; font-size: 12px; margin-top: 16px; }
  </style>
</head>
<body>
  <h1>Meus últimos resultados</h1>
  <ul id="list"><li>Carregando…</li></ul>
  <div class="stamp" id="stamp"></div>
  <script>
    async function load() {
      try {
        const rows = await window.hsos.query('agent_results', {
          select: 'title, value, created_at',
          order: { column: 'created_at', ascending: false },
          limit: 10
        });
        document.getElementById('list').innerHTML = (rows || []).map(function (r) {
          return '<li>' + (r.title || '(sem título)') + ' — ' + (r.value ?? '') + '</li>';
        }).join('') || '<li>Sem resultados.</li>';
        document.getElementById('stamp').textContent = 'Atualizado ' + new Date().toLocaleTimeString();
      } catch (e) {
        document.getElementById('list').innerHTML = '<li style="color:#f87171">Erro: ' + e.message + '</li>';
      }
    }
    load();
    window.hsos.onRefresh(load);
  </script>
</body>
</html>`;

function ArtifactCard({
  a,
  onOpen,
  onDelete,
  onDuplicate,
  onCopyPublicLink,
}: {
  a: LiveArtifactRow;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onCopyPublicLink: (a: LiveArtifactRow) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const isLive = a.refresh_interval > 0;

  return (
    <div className="group relative rounded-xl border border-border/30 bg-card/60 backdrop-blur-xl p-4 hover:border-primary/40 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3 min-w-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary shrink-0">
            <Zap className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground truncate">{a.title}</div>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              {isLive ? (
                <>
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  </span>
                  <span className="uppercase tracking-wide text-emerald-500 font-semibold">Ao vivo</span>
                  <span className="opacity-60">·</span>
                  <span>
                    {a.refresh_interval < 60
                      ? `${a.refresh_interval}s`
                      : `${Math.round(a.refresh_interval / 60)}min`}
                  </span>
                </>
              ) : (
                <>
                  <Pause className="h-3 w-3" />
                  <span>Estático</span>
                </>
              )}
            </div>
          </div>
        </div>
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded-lg border border-border/50 bg-card/95 backdrop-blur-xl shadow-lg py-1">
                <button
                  onClick={() => { setMenuOpen(false); onOpen(a.id); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir
                </button>
                <button
                  onClick={() => { setMenuOpen(false); onDuplicate(a.id); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
                >
                  <Copy className="h-3.5 w-3.5" /> Duplicar
                </button>
                {a.is_published && (
                  <button
                    onClick={() => { setMenuOpen(false); onCopyPublicLink(a); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-xs text-foreground hover:bg-muted"
                  >
                    <Link2 className="h-3.5 w-3.5" /> Copiar link público
                  </button>
                )}
                <button
                  onClick={() => { setMenuOpen(false); onDelete(a.id); }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-xs text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Excluir
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          {a.agent_id ? (
            <>
              <Bot className="h-3 w-3" /> por {a.agent_id}
            </>
          ) : (
            <span className="opacity-70">criado por você</span>
          )}
        </div>
        {a.is_published && (
          <div className="flex items-center gap-1 text-primary">
            <Globe className="h-3 w-3" /> público
          </div>
        )}
      </div>

      <div className="mt-3">
        <button
          onClick={() => onOpen(a.id)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Abrir
        </button>
      </div>
    </div>
  );
}

export default function ArtifactsPage() {
  const navigate = useNavigate();
  const params = useParams();
  const openedId = (params as any).id as string | undefined;
  const { user } = useAuthContext();

  const [items, setItems] = useState<LiveArtifactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newInterval, setNewInterval] = useState(30);
  const [newHtml, setNewHtml] = useState(DEFAULT_TEMPLATE);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    // A lista não traz o `html_content`: são páginas inteiras, e trazer trinta
    // delas para desenhar títulos é o tipo de coisa que faz a tela demorar sem
    // ninguém entender por quê. O backend já as omite.
    const data = await api<any[]>("/artefatos/vivos").catch(() => []);
    setItems(data || []);
    setLoading(false);
  };

  useEffect(() => { void load(); }, [user]);

  const filtered = useMemo(() => {
    return items.filter((a) => {
      if (filter === "mine" && a.agent_id) return false;
      if (filter === "published" && !a.is_published) return false;
      if (search && !a.title.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [items, filter, search]);

  const openViewer = (id: string) => navigate(`/artefatos/${id}`);

  const handleCreate = async () => {
    if (!user) return;
    const title = newTitle.trim() || "Artefato vivo";
    setSaving(true);
    const { data, error } = await api<{ id: string }>("/artefatos/vivos", {
      method: "POST",
      body: { title, html_content: newHtml, refresh_interval: newInterval },
    }).then((d) => ({ data: d, error: null as Error | null }),
            (e: Error) => ({ data: null, error: e }));
    setSaving(false);
    if (error || !data) {
      toast.error("Falha ao criar artefato.");
      return;
    }
    setCreating(false);
    setNewTitle("");
    setNewHtml(DEFAULT_TEMPLATE);
    setNewInterval(30);
    toast.success("Artefato criado.");
    void load();
    openViewer((data as any).id);
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Excluir este artefato?")) return;
    // Exclusão lógica no servidor, que despublica e congela junto.
    const error = await api(`/artefatos/vivos/${id}`, { method: "DELETE" })
      .then(() => null, (e: Error) => e);
    if (error) { toast.error("Falha ao excluir."); return; }
    setItems((prev) => prev.filter((a) => a.id !== id));
    toast.success("Artefato removido.");
  };

  const handleDuplicate = async (id: string) => {
    if (!user) return;
    const src = await api<any>(`/artefatos/vivos/${id}`).catch(() => null);
    if (!src) return;
    const { data, error } = await api<{ id: string }>("/artefatos/vivos", {
      method: "POST",
      body: {
        title: `${src.title} (cópia)`,
        html_content: src.html_content,
        refresh_interval: src.refresh_interval,
      },
    }).then((d) => ({ data: d, error: null as Error | null }),
            (e: Error) => ({ data: null, error: e }));
    if (error || !data) { toast.error("Falha ao duplicar."); return; }
    toast.success("Duplicado.");
    void load();
    openViewer((data as any).id);
  };

  const handleCopyPublicLink = (a: LiveArtifactRow) => {
    if (!a.published_slug) return;
    const url = `${window.location.origin}/p/${a.published_slug}`;
    navigator.clipboard.writeText(url);
    toast.success("Link copiado.");
  };

  // If we're on /artefatos/:id, render the full viewer (still inside the page shell).
  if (openedId) {
    return (
      <div className="h-[calc(100vh-3rem)]">
        <LiveArtifactViewer artifactId={openedId} onClose={() => navigate("/artefatos")} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold text-foreground">
            <Zap className="h-6 w-6 text-primary" />
            Artefatos Vivos
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Painéis HTML/JS com dados reais, que atualizam sozinhos.
          </p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Novo artefato
        </button>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-lg border border-border/40 bg-card/60 p-1">
          {([
            { key: "all", label: "Todos" },
            { key: "mine", label: "Meus" },
            { key: "published", label: "Publicados" },
          ] as { key: Filter; label: string }[]).map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors",
                filter === f.key
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="relative flex-1 max-w-xs">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título…"
            className="w-full rounded-md border border-border/40 bg-card/60 py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary/50"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/40 bg-card/40 py-16 text-center text-sm text-muted-foreground">
          <Zap className="h-8 w-8 mx-auto mb-2 opacity-40" />
          <p>Nenhum artefato vivo por aqui.</p>
          <p className="text-xs mt-1">
            Peça a um agente para criar, ou clique em <strong>Novo artefato</strong>.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((a) => (
            <ArtifactCard
              key={a.id}
              a={a}
              onOpen={openViewer}
              onDelete={handleDelete}
              onDuplicate={handleDuplicate}
              onCopyPublicLink={handleCopyPublicLink}
            />
          ))}
        </div>
      )}

      {/* Create dialog */}
      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" /> Novo artefato vivo
            </DialogTitle>
            <DialogDescription>
              O objeto <code>window.hsos</code> fica disponível dentro do artefato.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Título *</label>
              <input
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="Meu dashboard"
                className="mt-1 w-full rounded-md border border-border/50 bg-card/60 px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Intervalo</label>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {LIVE_INTERVALS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setNewInterval(opt.value)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-xs font-medium border transition-colors",
                      newInterval === opt.value
                        ? "border-primary/50 bg-primary/15 text-primary"
                        : "border-border/50 bg-card/60 text-muted-foreground hover:text-foreground hover:bg-muted",
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Código HTML</label>
              <textarea
                value={newHtml}
                onChange={(e) => setNewHtml(e.target.value)}
                spellCheck={false}
                className="mt-1 min-h-[240px] w-full rounded-md border border-border/50 bg-card/60 p-3 font-mono text-xs outline-none focus:border-primary/50"
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setCreating(false)}
                className="rounded-md border border-border/50 bg-card/60 px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreate}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-60"
              >
                <Zap className="h-3.5 w-3.5" />
                {saving ? "Criando…" : "Criar e abrir"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
