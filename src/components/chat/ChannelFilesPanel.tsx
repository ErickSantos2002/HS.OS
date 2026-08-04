import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ScrollArea } from "@/components/ui/scroll-area";
import { X, Search, FileText, Image as ImageIcon, Loader2, Download } from "lucide-react";
import { formatFileSize, downloadAttachment } from "@/lib/file-upload";
import { format, isThisWeek, isThisMonth, isToday, isYesterday, isValid, startOfMonth } from "date-fns";
import { ptBR } from "date-fns/locale";
import { toast } from "sonner";

interface Props {
  channelId: string;
  open: boolean;
  onClose: () => void;
}

interface FileItem {
  name: string;
  url: string;
  size: number;
  mimeType: string;
  created_at: string;
  author_name: string;
  message_id: string;
}

type Filter = "all" | "image" | "doc";

export default function ChannelFilesPanel({ channelId, open, onClose }: Props) {
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("channel_messages")
        .select("id, created_at, author_name, attachments")
        .eq("channel_id", channelId)
        .not("attachments", "is", null)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.error("[ChannelFilesPanel] load error", error);
        setItems([]);
      } else {
        const out: FileItem[] = [];
        for (const row of (data ?? []) as any[]) {
          const arr = Array.isArray(row.attachments) ? row.attachments : [];
          for (const a of arr) {
            if (!a?.url) continue;
            out.push({
              name: a.name || "arquivo",
              url: a.url,
              size: a.size ?? 0,
              mimeType: a.mimeType || "",
              created_at: row.created_at,
              author_name: row.author_name || "",
              message_id: row.id,
            });
          }
        }
        setItems(out);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, channelId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (filter === "image" && !it.mimeType.startsWith("image/")) return false;
      if (filter === "doc" && it.mimeType.startsWith("image/")) return false;
      if (q && !it.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [items, filter, search]);

  const grouped = useMemo(() => groupByPeriod(filtered), [filtered]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 z-50 flex w-80 flex-col overflow-hidden rounded-l-2xl border-l border-border/40 bg-card/95 shadow-2xl backdrop-blur-2xl animate-in slide-in-from-right-5 duration-200">
        <div className="aurora-glow h-14 border-b border-border/30 flex items-center justify-between px-4 shrink-0">
          <h3 className="font-display font-bold text-sm text-foreground relative z-10">
            Arquivos {items.length > 0 && <span className="text-muted-foreground font-normal">· {items.length}</span>}
          </h3>
          <button
            onClick={onClose}
            className="h-7 w-7 rounded-xl bg-secondary/50 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-all relative z-10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="p-3 border-b border-border/30 space-y-2">
          <div className="glass-input flex items-center gap-2 px-3">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar arquivo..."
              className="w-full bg-transparent py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1">
            {([
              { id: "all", label: "Todos" },
              { id: "image", label: "Imagens" },
              { id: "doc", label: "Documentos" },
            ] as { id: Filter; label: string }[]).map((opt) => (
              <button
                key={opt.id}
                onClick={() => setFilter(opt.id)}
                className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${
                  filter === opt.id
                    ? "border-primary/50 bg-primary/15 text-foreground"
                    : "border-border/40 bg-secondary/30 text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-4">
            {loading ? (
              <div className="flex items-center justify-center py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 text-xs text-muted-foreground">
                Nenhum arquivo compartilhado{search ? " para essa busca" : ""}.
              </div>
            ) : (
              grouped.map((group) => (
                <div key={group.key} className="space-y-1.5">
                  <h4 className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-1">
                    {group.label}
                  </h4>
                  <div className="space-y-1">
                    {group.items.map((f) => (
                      <FileRow key={`${f.message_id}-${f.url}`} file={f} />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </div>
    </>
  );
}

function FileRow({ file }: { file: FileItem }) {
  const isImage = file.mimeType.startsWith("image/");
  const Icon = isImage ? ImageIcon : FileText;
  const date = new Date(file.created_at);

  return (
    <div className="flex items-center gap-2 px-2 py-2 rounded-xl group hover:bg-primary/5 transition-colors">
      <button
        type="button"
        onClick={() => window.open(file.url, "_blank", "noopener,noreferrer")}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <div className="h-9 w-9 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center overflow-hidden">
          {isImage ? (
            <img src={file.url} alt={file.name} className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <Icon className="h-4 w-4 text-primary" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{file.name}</p>
          <p className="text-[10px] text-muted-foreground truncate">
            {file.author_name ? `${file.author_name} · ` : ""}
            {isValid(date) ? format(date, "d 'de' MMM, HH:mm", { locale: ptBR }) : ""}
            {file.size ? ` · ${formatFileSize(file.size)}` : ""}
          </p>
        </div>
      </button>
      <button
        type="button"
        onClick={async (e) => {
          e.preventDefault();
          e.stopPropagation();
          try {
            await downloadAttachment({ name: file.name, url: file.url });
          } catch (err: any) {
            toast.error(err?.message || "Não foi possível baixar.");
          }
        }}
        className="h-7 w-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 opacity-0 group-hover:opacity-100 transition-all shrink-0"
        aria-label={`Baixar ${file.name}`}
      >
        <Download className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

interface Group {
  key: string;
  label: string;
  items: FileItem[];
}

function groupByPeriod(items: FileItem[]): Group[] {
  const groups: Group[] = [];
  const map = new Map<string, Group>();
  const now = new Date();

  for (const it of items) {
    const d = new Date(it.created_at);
    if (!isValid(d)) continue;
    let key: string;
    let label: string;
    if (isToday(d)) {
      key = "today";
      label = "Hoje";
    } else if (isYesterday(d)) {
      key = "yesterday";
      label = "Ontem";
    } else if (isThisWeek(d, { weekStartsOn: 1 })) {
      key = "this-week";
      label = "Esta semana";
    } else if (isThisMonth(d)) {
      key = "this-month";
      label = "Este mês";
    } else {
      const m = startOfMonth(d);
      key = `m-${m.getFullYear()}-${m.getMonth()}`;
      const sameYear = m.getFullYear() === now.getFullYear();
      label = format(m, sameYear ? "MMMM" : "MMMM 'de' yyyy", { locale: ptBR });
      label = label.charAt(0).toUpperCase() + label.slice(1);
    }
    let g = map.get(key);
    if (!g) {
      g = { key, label, items: [] };
      map.set(key, g);
      groups.push(g);
    }
    g.items.push(it);
  }
  return groups;
}
